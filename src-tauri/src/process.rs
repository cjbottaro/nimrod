//! Own exactly one child. All stdout records (including responses) use one ordered channel.
use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::{path::PathBuf, process::Stdio, sync::Arc, time::Duration};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, Command},
    sync::{Mutex, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use tokio_util::codec::{FramedRead, LinesCodec};

const MAX_RECORD: usize = 16 * 1024 * 1024;

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Packet {
    Rpc { value: Value },
    Disconnected { message: String },
}

pub type Output = Arc<dyn Fn(Packet) -> Result<(), String> + Send + Sync>;

struct WriteRequest {
    message: Value,
    reply: oneshot::Sender<Result<(), String>>,
}

struct Session {
    token: String,
    cwd: PathBuf,
    writer: mpsc::Sender<WriteRequest>,
    stop: oneshot::Sender<()>,
    task: JoinHandle<Result<(), String>>,
}

#[derive(Default)]
pub struct ProcessHost {
    session: Mutex<Option<Session>>,
}

impl ProcessHost {
    pub async fn start(
        &self,
        mut command: Command,
        cwd: PathBuf,
        token: String,
        output: Output,
    ) -> Result<(), String> {
        let mut slot = self.session.lock().await;
        if slot.is_some() {
            return Err("A session is already owned. Disconnect before starting another.".into());
        }
        command
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
        let mut child = command
            .spawn()
            .map_err(|e| format!("Could not start Pi: {e}"))?;
        let stdin = child.stdin.take().ok_or("Missing child stdin")?;
        let stdout = child.stdout.take().ok_or("Missing child stdout")?;
        let stderr = child.stderr.take().ok_or("Missing child stderr")?;
        let (writer, writes) = mpsc::channel(32);
        let (stop, stopped) = oneshot::channel();
        let task = tokio::spawn(supervise(
            child, stdin, stdout, stderr, writes, stopped, output,
        ));
        *slot = Some(Session {
            token,
            cwd,
            writer,
            stop,
            task,
        });
        Ok(())
    }

    pub async fn write(&self, token: &str, message: Value) -> Result<(), String> {
        validate_command(&message)?;
        let writer = {
            let slot = self.session.lock().await;
            let session = slot.as_ref().ok_or("No owned Pi session")?;
            if session.token != token {
                return Err("Stale session request".into());
            }
            session.writer.clone()
        };
        let (reply, result) = oneshot::channel();
        writer
            .send(WriteRequest { message, reply })
            .await
            .map_err(|_| "Pi disconnected")?;
        result
            .await
            .map_err(|_| "Pi disconnected during write".to_string())?
    }

    pub async fn cwd(&self, token: &str) -> Result<PathBuf, String> {
        let slot = self.session.lock().await;
        let session = slot.as_ref().ok_or("No owned Pi session")?;
        if session.token != token {
            return Err("Stale session request".into());
        }
        Ok(session.cwd.clone())
    }

    pub async fn stop(&self) -> Result<(), String> {
        self.stop_for(None).await
    }

    pub async fn stop_for(&self, token: Option<&str>) -> Result<(), String> {
        // Hold the lock through observed exit so start cannot race shutdown.
        let mut slot = self.session.lock().await;
        if token.is_some_and(|token| slot.as_ref().is_none_or(|session| session.token != token)) {
            return Ok(()); // Late cleanup must never stop a newer owned child.
        }
        if let Some(session) = slot.take() {
            let _ = session.stop.send(());
            session
                .task
                .await
                .map_err(|e| format!("Pi supervisor failed: {e}"))??;
        }
        Ok(())
    }
}

pub fn validate_command(value: &Value) -> Result<(), String> {
    let command = value
        .get("type")
        .and_then(Value::as_str)
        .ok_or("Missing RPC command type")?;
    let allowed = matches!(
        command,
        "get_state"
            | "get_messages"
            | "get_commands"
            | "get_session_stats"
            | "get_available_models"
            | "get_available_thinking_levels"
            | "set_model"
            | "set_thinking_level"
            | "set_session_name"
            | "compact"
            | "prompt"
            | "clear_queue"
            | "abort"
            | "extension_ui_response"
    );
    if !allowed {
        return Err(format!("Unsupported PoC RPC command: {command}"));
    }
    let id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or("Missing RPC request id")?;
    if id.is_empty()
        || id.len() > 128
        || serde_json::to_vec(value).map_err(|e| e.to_string())?.len() > 2_000_000
    {
        return Err("Invalid or oversized RPC request".into());
    }
    Ok(())
}

async fn supervise(
    mut child: Child,
    mut stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    mut writes: mpsc::Receiver<WriteRequest>,
    mut stop: oneshot::Receiver<()>,
    output: Output,
) -> Result<(), String> {
    // LinesCodec only splits LF (not Unicode separators) and validates UTF-8.
    let mut records = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_RECORD));
    let mut errors = FramedRead::new(stderr, LinesCodec::new_with_max_length(MAX_RECORD));
    let mut stderr_open = true;
    let mut tail = String::new();
    let reason = loop {
        tokio::select! {
            biased;
            _ = &mut stop => break "Session disconnected by Nimrod".to_owned(),
            record = records.next() => {
                match record {
                    Some(Ok(line)) if line.trim().is_empty() => {},
                    Some(Ok(line)) => match parse_record(&line) {
                        Ok(value) => if output(Packet::Rpc { value }).is_err() {
                            break "Frontend disconnected".to_owned();
                        },
                        Err(error) => break error,
                    },
                    Some(Err(error)) => break format!("Invalid Pi stdout: {error}"),
                    None => break if tail.is_empty() { "Pi stdout closed".into() } else { format!("Pi stdout closed: {tail}") },
                }
            }
            request = writes.recv() => {
                let Some(request) = request else { break "Transport closed".into(); };
                let mut bytes = serde_json::to_vec(&request.message).expect("JSON Value serializes");
                bytes.push(b'\n');
                let result = match timeout(Duration::from_secs(5), stdin.write_all(&bytes)).await {
                    Ok(Ok(())) => Ok(()),
                    Ok(Err(error)) => Err(format!("Pi stdin failed: {error}")),
                    Err(_) => Err("Pi stdin timed out; acceptance is unknown".into()),
                };
                let failed = result.as_ref().err().cloned();
                let _ = request.reply.send(result);
                if let Some(error) = failed { break error; }
            }
            line = errors.next(), if stderr_open => {
                match line {
                    Some(Ok(line)) => tail = line.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect(),
                    Some(Err(_)) => break "Pi stderr stream failed".into(),
                    None => stderr_open = false,
                }
            }
        }
    };
    drop(stdin);
    let result = terminate(&mut child).await;
    let message = match &result {
        Ok(()) => reason,
        Err(error) => format!("{reason}; {error}"),
    };
    let _ = output(Packet::Disconnected { message });
    result
}

fn parse_record(line: &str) -> Result<Value, String> {
    let value: Value = serde_json::from_str(line).map_err(|e| format!("Invalid Pi JSON: {e}"))?;
    if !value.is_object() || !value.get("type").is_some_and(Value::is_string) {
        return Err("Invalid Pi RPC record: expected an object with a type".into());
    }
    Ok(value)
}

async fn terminate(child: &mut Child) -> Result<(), String> {
    if child.try_wait().map_err(|e| e.to_string())?.is_some() {
        return Ok(());
    }
    #[cfg(unix)]
    if let Some(id) = child.id() {
        use nix::{
            sys::signal::{Signal, kill},
            unistd::Pid,
        };
        let _ = kill(Pid::from_raw(id as i32), Signal::SIGTERM);
    }
    #[cfg(windows)]
    child.start_kill().map_err(|e| e.to_string())?;
    if let Ok(status) = timeout(Duration::from_millis(1500), child.wait()).await {
        status.map_err(|e| e.to_string())?;
        return Ok(());
    }
    child.start_kill().map_err(|e| e.to_string())?;
    timeout(Duration::from_secs(3), child.wait())
        .await
        .map_err(|_| "Owned Pi process did not exit".to_string())?
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
#[path = "process_smoke.rs"]
mod smoke;

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn validates_records_and_commands() {
        assert_eq!(
            parse_record("{\"type\":\"test\",\"text\":\"a\u{2028}🦀\u{2029}b\"}").unwrap()["text"],
            "a\u{2028}🦀\u{2029}b"
        );
        assert!(parse_record("[]").is_err());
        assert!(parse_record("{broken").is_err());
        assert!(validate_command(&json!({"type":"bash", "id":"1"})).is_err());
        assert!(validate_command(&json!({"type":"compact", "id":"1"})).is_ok());
        assert!(validate_command(&json!({"type":"prompt", "id":"1", "message":"hi"})).is_ok());
    }

    #[tokio::test]
    async fn framing_preserves_unicode_crlf_and_final_record() {
        let input = "{\"type\":\"one\",\"text\":\"🦀\u{2028}x\"}\r\n{\"type\":\"two\"}";
        let mut lines = FramedRead::new(
            input.as_bytes(),
            LinesCodec::new_with_max_length(MAX_RECORD),
        );
        assert_eq!(
            parse_record(&lines.next().await.unwrap().unwrap()).unwrap()["text"],
            "🦀\u{2028}x"
        );
        assert_eq!(
            parse_record(&lines.next().await.unwrap().unwrap()).unwrap()["type"],
            "two"
        );
        assert!(lines.next().await.is_none());
        let mut oversized =
            FramedRead::new("123456\n".as_bytes(), LinesCodec::new_with_max_length(3));
        assert!(oversized.next().await.unwrap().is_err());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn owns_child_orders_output_rejects_stale_writes_and_waits_for_exit() {
        let host = ProcessHost::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let output: Output = Arc::new(move |p| tx.send(p).map_err(|e| e.to_string()));
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf '{\"type\":\"first\"}\\n'; while IFS= read -r line; do printf '%s\\n' \"$line\"; done"]);
        let cwd = std::env::temp_dir();
        host.start(command, cwd.clone(), "one".into(), output.clone())
            .await
            .unwrap();
        assert!(
            host.start(Command::new("/bin/sh"), cwd, "two".into(), output)
                .await
                .is_err()
        );
        assert!(
            host.write("stale", json!({"id":"1", "type":"get_state"}))
                .await
                .is_err()
        );
        host.stop_for(Some("stale")).await.unwrap();
        assert!(host.cwd("one").await.is_ok());
        host.write("one", json!({"id":"1", "type":"get_state"}))
            .await
            .unwrap();
        let Packet::Rpc { value } = timeout(Duration::from_secs(3), rx.recv())
            .await
            .unwrap()
            .unwrap()
        else {
            panic!()
        };
        assert_eq!(value["type"], "first");
        let Packet::Rpc { value } = timeout(Duration::from_secs(3), rx.recv())
            .await
            .unwrap()
            .unwrap()
        else {
            panic!()
        };
        assert_eq!(value["id"], "1");
        host.stop().await.unwrap();
        assert!(matches!(rx.recv().await, Some(Packet::Disconnected { .. })));
        assert!(host.cwd("one").await.is_err());
        host.stop().await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn malformed_stdout_disconnects_and_reaps_process() {
        let host = ProcessHost::default();
        let (tx, mut rx) = mpsc::unbounded_channel();
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "printf 'not-json\\n'; read -r line"]);
        host.start(
            command,
            std::env::temp_dir(),
            "test".into(),
            Arc::new(move |p| tx.send(p).map_err(|e| e.to_string())),
        )
        .await
        .unwrap();
        let packet = timeout(Duration::from_secs(5), rx.recv())
            .await
            .unwrap()
            .unwrap();
        assert!(
            matches!(packet, Packet::Disconnected { message } if message.contains("Invalid Pi JSON"))
        );
        host.stop().await.unwrap();
    }
}
