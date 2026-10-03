//! Native ownership boundary for workspace windows and independently live session tabs.
//! Each live tab has its own ordered transport and supervised child.
use crate::process::{Output, ProcessHost};
use serde_json::Value;
use std::{collections::HashMap, path::PathBuf, sync::Arc};
use tokio::{process::Command, sync::Mutex};

struct OwnedSession {
    window: String,
    cwd: PathBuf,
    file: Option<PathBuf>,
    host: Arc<ProcessHost>,
    shutdown_error: Option<String>,
}

#[derive(Default)]
pub struct WorkspaceHost {
    // Serialize reservation/start/observed shutdown, including duplicate-file checks.
    sessions: Mutex<HashMap<String, OwnedSession>>,
    closing: Mutex<std::collections::HashSet<String>>,
}

impl WorkspaceHost {
    pub async fn start(
        &self,
        window: &str,
        command: Command,
        cwd: PathBuf,
        token: String,
        file: Option<PathBuf>,
        output: Output,
    ) -> Result<(), String> {
        let closing = self.closing.lock().await;
        if closing.contains(window) || closing.contains("*") {
            return Err("Project is closing".into());
        }
        let mut sessions = self.sessions.lock().await;
        if sessions.contains_key(&token) {
            return Err("Session token is already owned".into());
        }
        if sessions
            .values()
            .any(|s| s.window == window && s.cwd != cwd)
        {
            return Err("A project window cannot run sessions from different directories".into());
        }
        if let Some(file) = &file {
            ensure_file_available(&sessions, file, &token)?;
        }
        let host = Arc::new(ProcessHost::default());
        host.start(command, cwd.clone(), token.clone(), output)
            .await?;
        sessions.insert(
            token,
            OwnedSession {
                window: window.into(),
                cwd,
                file,
                host,
                shutdown_error: None,
            },
        );
        Ok(())
    }

    async fn owned(&self, window: &str, token: &str) -> Result<Arc<ProcessHost>, String> {
        self.sessions
            .lock()
            .await
            .get(token)
            .filter(|s| s.window == window)
            .map(|s| s.host.clone())
            .ok_or_else(|| "Unknown session or wrong project window".into())
    }

    pub async fn write(&self, window: &str, token: &str, message: Value) -> Result<(), String> {
        self.owned(window, token).await?.write(token, message).await
    }

    pub async fn cwd(&self, window: &str, token: &str) -> Result<PathBuf, String> {
        self.owned(window, token).await?.cwd(token).await
    }

    /// Reserve Pi's canonical identity as soon as it reports one, even before first save.
    pub async fn bind_file(&self, window: &str, token: &str, file: PathBuf) -> Result<(), String> {
        let mut sessions = self.sessions.lock().await;
        let session = sessions
            .get(token)
            .filter(|s| s.window == window)
            .ok_or("Unknown session or wrong project window")?;
        if session
            .file
            .as_ref()
            .is_some_and(|current| current != &file)
        {
            return Err("Pi unexpectedly changed session file".into());
        }
        ensure_file_available(&sessions, &file, token)?;
        sessions.get_mut(token).expect("checked session").file = Some(file);
        Ok(())
    }

    /// No token means this window's children only (reload/disconnect), never another window.
    pub async fn stop_window(&self, window: &str, token: Option<&str>) -> Result<(), String> {
        // Serialize lifecycle changes, but do not hold the routing map while reaping:
        // sibling writes and metadata lookups must continue during slow shutdown.
        let _lifecycle = self.closing.lock().await;
        let tokens: Vec<_> = self
            .sessions
            .lock()
            .await
            .iter()
            .filter(|(id, s)| s.window == window && token.is_none_or(|token| token == id.as_str()))
            .map(|(id, _)| id.clone())
            .collect();
        stop_sessions(&self.sessions, tokens).await
    }

    pub async fn close_window(&self, window: &str) -> Result<(), String> {
        self.closing.lock().await.insert(window.into());
        self.stop_window(window, None).await
    }

    pub async fn shutdown(&self) -> Result<(), String> {
        self.closing.lock().await.insert("*".into());
        self.stop_all().await
    }

    pub async fn stop_all(&self) -> Result<(), String> {
        let _lifecycle = self.closing.lock().await;
        let tokens = self.sessions.lock().await.keys().cloned().collect();
        stop_sessions(&self.sessions, tokens).await
    }
}

fn ensure_file_available(
    sessions: &HashMap<String, OwnedSession>,
    file: &PathBuf,
    token: &str,
) -> Result<(), String> {
    if sessions
        .iter()
        .any(|(id, s)| id != token && s.file.as_ref() == Some(file))
    {
        Err("This session file is already open in Nimrod".into())
    } else {
        Ok(())
    }
}

async fn stop_sessions(
    sessions: &Mutex<HashMap<String, OwnedSession>>,
    tokens: Vec<String>,
) -> Result<(), String> {
    let mut errors = Vec::new();
    for token in tokens {
        // A failed supervisor has already consumed its task. A retry cannot prove exit;
        // retain its reservation until app exit rather than treating an empty slot as success.
        let (host, shutdown_error) = {
            let sessions = sessions.lock().await;
            let session = &sessions[&token];
            (session.host.clone(), session.shutdown_error.clone())
        };
        if let Some(error) = shutdown_error {
            errors.push(error);
            continue;
        }
        match host.stop().await {
            Ok(()) => {
                sessions.lock().await.remove(&token);
            }
            Err(error) => {
                sessions
                    .lock()
                    .await
                    .get_mut(&token)
                    .expect("owned session")
                    .shutdown_error = Some(error.clone());
                errors.push(error);
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("\n"))
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use crate::process::Packet;
    use serde_json::json;
    use tokio::{
        sync::mpsc,
        time::{Duration, timeout},
    };

    fn echo() -> Command {
        let mut command = Command::new("/bin/sh");
        command.args([
            "-c",
            "while IFS= read -r line; do printf '%s\\n' \"$line\"; done",
        ]);
        command
    }

    fn output() -> (Output, mpsc::UnboundedReceiver<Packet>) {
        let (tx, rx) = mpsc::unbounded_channel();
        (
            Arc::new(move |packet| tx.send(packet).map_err(|e| e.to_string())),
            rx,
        )
    }

    #[tokio::test]
    async fn independent_tabs_route_output_and_survive_sibling_shutdown() {
        let host = WorkspaceHost::default();
        let (a, mut ra) = output();
        let (b, mut rb) = output();
        let cwd = std::env::temp_dir();
        host.start("window", echo(), cwd.clone(), "a".into(), None, a)
            .await
            .unwrap();
        host.start("window", echo(), cwd, "b".into(), None, b)
            .await
            .unwrap();
        host.write("window", "a", json!({"type":"get_state", "id":"a"}))
            .await
            .unwrap();
        host.write("window", "b", json!({"type":"get_state", "id":"b"}))
            .await
            .unwrap();
        for (rx, id) in [(&mut ra, "a"), (&mut rb, "b")] {
            let packet = timeout(Duration::from_secs(3), rx.recv())
                .await
                .unwrap()
                .unwrap();
            assert!(matches!(packet, Packet::Rpc {value} if value["id"] == id));
        }
        host.stop_window("window", Some("a")).await.unwrap();
        assert!(host.cwd("window", "a").await.is_err());
        host.stop_window("window", Some("a")).await.unwrap(); // stale cleanup
        assert!(host.cwd("window", "b").await.is_ok());
        host.stop_all().await.unwrap();
    }

    #[tokio::test]
    async fn window_scoping_and_duplicate_file_reservations() {
        let host = WorkspaceHost::default();
        let cwd = std::env::temp_dir();
        let file = cwd.join("nimrod-owned-fixture.jsonl"); // reservation only, never read/written
        let (a, _ra) = output();
        let (b, _rb) = output();
        host.start(
            "one",
            echo(),
            cwd.clone(),
            "a".into(),
            Some(file.clone()),
            a.clone(),
        )
        .await
        .unwrap();
        assert!(
            host.start(
                "two",
                echo(),
                cwd.clone(),
                "b".into(),
                Some(file.clone()),
                b.clone()
            )
            .await
            .is_err()
        );
        assert!(
            host.start(
                "one",
                echo(),
                cwd.join("different"),
                "b".into(),
                None,
                b.clone()
            )
            .await
            .is_err()
        );
        assert!(
            host.start("two", echo(), cwd.clone(), "a".into(), None, b.clone())
                .await
                .is_err()
        );
        host.start("two", echo(), cwd.clone(), "b".into(), None, b)
            .await
            .unwrap();
        assert!(host.cwd("two", "a").await.is_err());
        assert!(
            host.write("two", "a", json!({"type":"get_state", "id":"x"}))
                .await
                .is_err()
        );
        assert!(host.bind_file("two", "a", file.clone()).await.is_err());
        assert!(host.bind_file("two", "b", file.clone()).await.is_err());
        host.stop_window("two", Some("a")).await.unwrap();
        assert!(host.cwd("one", "a").await.is_ok());
        host.stop_window("one", None).await.unwrap();
        assert!(host.cwd("two", "b").await.is_ok());
        host.bind_file("two", "b", file.clone()).await.unwrap();
        assert!(
            host.bind_file("two", "b", cwd.join("changed.jsonl"))
                .await
                .is_err()
        );
        host.stop_all().await.unwrap();
        host.start("one", echo(), cwd, "c".into(), Some(file), a)
            .await
            .unwrap();
        host.stop_all().await.unwrap();
    }

    #[tokio::test]
    async fn failed_shutdown_keeps_reservation_but_does_not_skip_other_children() {
        let host = WorkspaceHost::default();
        let cwd = std::env::temp_dir();
        let file = cwd.join("nimrod-shutdown-fixture.jsonl");
        host.sessions.lock().await.insert(
            "failed".into(),
            OwnedSession {
                window: "one".into(),
                cwd: cwd.clone(),
                file: Some(file.clone()),
                host: Arc::new(ProcessHost::default()),
                shutdown_error: Some("exit not observed".into()),
            },
        );
        let (out, _rx) = output();
        host.start(
            "two",
            echo(),
            cwd.clone(),
            "other".into(),
            None,
            out.clone(),
        )
        .await
        .unwrap();
        assert!(host.stop_all().await.is_err());
        assert!(host.cwd("two", "other").await.is_err());
        assert!(host.stop_all().await.is_err());
        assert!(
            host.start("two", echo(), cwd, "replacement".into(), Some(file), out)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn sibling_writes_continue_while_another_child_needs_escalated_shutdown() {
        let host = WorkspaceHost::default();
        let cwd = std::env::temp_dir();
        let (slow_output, mut slow_rx) = output();
        let (fast_output, _fast_rx) = output();
        let mut slow = Command::new("/bin/sh");
        slow.args([
            "-c",
            "trap '' TERM; printf '{\"type\":\"ready\"}\\n'; exec /bin/sleep 10",
        ]);
        host.start("one", slow, cwd.clone(), "slow".into(), None, slow_output)
            .await
            .unwrap();
        timeout(Duration::from_secs(3), slow_rx.recv())
            .await
            .unwrap()
            .unwrap();
        host.start("two", echo(), cwd, "fast".into(), None, fast_output)
            .await
            .unwrap();
        let stop = host.stop_window("one", None);
        tokio::pin!(stop);
        timeout(Duration::from_millis(750), async {
            tokio::select! {
                biased;
                result = &mut stop => panic!("Expected slow child to require escalation: {result:?}"),
                result = host.write("two", "fast", json!({"type":"get_state", "id":"during-stop"})) => result.unwrap(),
            }
        }).await.unwrap();
        stop.await.unwrap();
        host.stop_all().await.unwrap();
    }

    #[tokio::test]
    async fn closing_a_window_rejects_late_starts_without_stopping_other_windows() {
        let host = WorkspaceHost::default();
        let cwd = std::env::temp_dir();
        let (out, _rx) = output();
        host.start(
            "other",
            echo(),
            cwd.clone(),
            "other-session".into(),
            None,
            out.clone(),
        )
        .await
        .unwrap();
        host.close_window("closing").await.unwrap();
        assert!(
            host.start(
                "closing",
                echo(),
                cwd.clone(),
                "late".into(),
                None,
                out.clone()
            )
            .await
            .is_err()
        );
        assert!(host.cwd("other", "other-session").await.is_ok());
        host.shutdown().await.unwrap();
        assert!(
            host.start("new", echo(), cwd, "late-quit".into(), None, out)
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn failed_spawn_releases_reservation() {
        let host = WorkspaceHost::default();
        let cwd = std::env::temp_dir();
        let file = cwd.join("nimrod-failed-fixture.jsonl");
        let (out, _rx) = output();
        assert!(
            host.start(
                "one",
                Command::new(cwd.join("nonexistent-nimrod-executable")),
                cwd.clone(),
                "a".into(),
                Some(file.clone()),
                out.clone()
            )
            .await
            .is_err()
        );
        host.start("one", echo(), cwd, "a".into(), Some(file), out)
            .await
            .unwrap();
        host.stop_all().await.unwrap();
    }
}
