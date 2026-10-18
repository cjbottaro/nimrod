//! ACP-only launch/JSON-RPC boundary. Pi's host and validators remain independent.
use crate::{
    process::{Output, Packet},
    workspace_windows::WorkspaceWindows,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    process::Stdio,
    sync::Arc,
    time::Duration,
};
use tauri::{Manager, ipc::Channel};
use tokio::{
    io::AsyncWriteExt,
    process::{Child, Command},
    sync::{Mutex, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use tokio_util::codec::{FramedRead, LinesCodec};

const MAX_RECORD: usize = 16 * 1024 * 1024;
type Write = (Value, oneshot::Sender<Result<(), String>>);
type StopTask = (oneshot::Sender<()>, JoinHandle<Result<(), String>>);
#[derive(Default)]
struct StopState {
    task: Option<StopTask>,
    error: Option<String>,
}
struct Owned {
    window: String,
    cwd: PathBuf,
    writer: mpsc::Sender<Write>,
    stop: Mutex<StopState>,
}
#[derive(Default)]
pub struct AcpHost {
    sessions: Mutex<HashMap<String, Arc<Owned>>>,
    lifecycle: Mutex<HashSet<String>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    cwd: PathBuf,
    command: String,
    args: Vec<String>,
    #[serde(default)]
    env: HashMap<String, String>,
    node: Option<PathBuf>,
}
impl AcpHost {
    async fn start(
        &self,
        window: &str,
        token: String,
        cwd: PathBuf,
        mut command: Command,
        output: Output,
    ) -> Result<(), String> {
        let closing = self.lifecycle.lock().await;
        if closing.contains(window) || closing.contains("*") {
            return Err("Project is closing".into());
        }
        let mut sessions = self.sessions.lock().await;
        if sessions.contains_key(&token) {
            return Err("ACP token is already owned".into());
        }
        if sessions
            .values()
            .any(|session| session.window == window && session.cwd != cwd)
        {
            return Err("ACP sessions must use the project directory".into());
        }
        command
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start ACP agent: {error}"))?;
        let stdin = child.stdin.take().ok_or("Missing ACP stdin")?;
        let stdout = child.stdout.take().ok_or("Missing ACP stdout")?;
        let stderr = child.stderr.take().ok_or("Missing ACP stderr")?;
        let (writer, writes) = mpsc::channel(32);
        let (stop, stopped) = oneshot::channel();
        let task = tokio::spawn(supervise(
            child, stdin, stdout, stderr, writes, stopped, output,
        ));
        sessions.insert(
            token,
            Arc::new(Owned {
                window: window.into(),
                cwd,
                writer,
                stop: Mutex::new(StopState {
                    task: Some((stop, task)),
                    error: None,
                }),
            }),
        );
        Ok(())
    }
    async fn owned(&self, window: &str, token: &str) -> Result<Arc<Owned>, String> {
        self.sessions
            .lock()
            .await
            .get(token)
            .filter(|session| session.window == window)
            .cloned()
            .ok_or_else(|| "Unknown ACP session or wrong project window".into())
    }
    async fn write(&self, window: &str, token: &str, message: Value) -> Result<(), String> {
        let session = self.owned(window, token).await?;
        validate_message(&message, &session.cwd)?;
        let (reply, result) = oneshot::channel();
        session
            .writer
            .send((message, reply))
            .await
            .map_err(|_| "ACP agent disconnected")?;
        result
            .await
            .map_err(|_| "ACP write outcome is unknown".to_string())?
    }
    pub async fn stop_window(
        &self,
        window: &str,
        token: Option<&str>,
        closing: bool,
    ) -> Result<(), String> {
        let mut lifecycle = self.lifecycle.lock().await;
        if closing {
            lifecycle.insert(window.into());
        }
        self.stop_matching(|id, session| {
            session.window == window && token.is_none_or(|token| id == token)
        })
        .await
    }
    pub async fn shutdown(&self) -> Result<(), String> {
        let mut lifecycle = self.lifecycle.lock().await;
        lifecycle.insert("*".into());
        self.stop_matching(|_, _| true).await
    }
    async fn stop_matching(&self, matches: impl Fn(&str, &Owned) -> bool) -> Result<(), String> {
        let selected: Vec<_> = self
            .sessions
            .lock()
            .await
            .iter()
            .filter(|(id, session)| matches(id, session))
            .map(|(id, session)| (id.clone(), session.clone()))
            .collect();
        let mut errors = Vec::new();
        for (id, session) in selected {
            let mut state = session.stop.lock().await;
            if let Some(error) = &state.error {
                errors.push(error.clone());
                continue;
            }
            if let Some((stop, task)) = state.task.take() {
                let _ = stop.send(());
                let result = task
                    .await
                    .map_err(|error| error.to_string())
                    .and_then(|result| result);
                if let Err(error) = result {
                    state.error = Some(error.clone());
                    errors.push(error);
                    continue;
                }
            }
            self.sessions.lock().await.remove(&id);
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }
}
fn valid_id(value: &Value) -> bool {
    value.as_str().is_some_and(|id| id.len() <= 128)
        || value
            .as_i64()
            .is_some_and(|id| id.unsigned_abs() <= 9_007_199_254_740_991)
}
fn validate_message(message: &Value, cwd: &Path) -> Result<(), String> {
    if !message.is_object()
        || message["jsonrpc"] != "2.0"
        || serde_json::to_vec(message)
            .map_err(|error| error.to_string())?
            .len()
            > MAX_RECORD
    {
        return Err("Invalid or oversized ACP packet".into());
    }
    if let Some(method) = message.get("method") {
        let method = method.as_str().ok_or("Invalid ACP method")?;
        if message.get("result").is_some()
            || message.get("error").is_some()
            || !message["params"].is_object()
        {
            return Err("Invalid ACP request".into());
        }
        match method {
            "initialize"
            | "session/new"
            | "session/load"
            | "session/list"
            | "session/delete"
            | "session/prompt"
            | "session/set_config_option"
            | "session/set_mode"
            | "session/set_model"
                if valid_id(&message["id"]) => {}
            "session/cancel" if message.get("id").is_none() => {}
            _ => return Err("Unsupported ACP operation".into()),
        }
        if matches!(method, "session/new" | "session/load" | "session/list")
            && message["params"]["cwd"].as_str() != cwd.to_str()
        {
            return Err("ACP session cwd must match its project".into());
        }
        if matches!(method, "session/load" | "session/delete")
            && message["params"]["sessionId"]
                .as_str()
                .is_none_or(|id| id.trim().is_empty())
        {
            return Err("ACP loading/deletion requires a session ID".into());
        }
        if method == "session/list"
            && message["params"]
                .get("cursor")
                .is_some_and(|cursor| cursor.as_str().is_none_or(|value| value.is_empty()))
        {
            return Err("ACP listing requires a nonempty string cursor".into());
        }
    } else if !valid_id(&message["id"])
        || (message.get("result").is_some() == message.get("error").is_some())
    {
        return Err("Invalid ACP client response".into());
    }
    Ok(())
}
fn validate_config(config: &Config) -> Result<(), String> {
    if config.command.is_empty()
        || config.command.len() > 4096
        || config.command.contains('\0')
        || config.args.len() > 128
        || config
            .args
            .iter()
            .any(|arg| arg.len() > 8192 || arg.contains('\0'))
        || config.env.len() > 64
        || config.env.iter().any(|(key, value)| {
            key.is_empty()
                || key.contains(['=', '\0'])
                || key.len() > 128
                || value.len() > 8192
                || value.contains('\0')
        })
    {
        return Err("Invalid ACP launch configuration".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn start_acp(
    app: tauri::AppHandle,
    window: tauri::Window,
    host: tauri::State<'_, AcpHost>,
    config: Config,
    token: String,
    on_event: Channel<Packet>,
) -> Result<PathBuf, String> {
    if app
        .state::<crate::ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    if token.is_empty() || token.len() > 128 {
        return Err("Invalid ACP token".into());
    }
    validate_config(&config)?;
    let cwd = config
        .cwd
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !cwd.is_dir()
        || app
            .state::<WorkspaceWindows>()
            .directories
            .lock()
            .unwrap()
            .get(window.label())
            != Some(&cwd)
    {
        return Err("ACP launch requires this window's canonical project directory".into());
    }
    let executable = if Path::new(&config.command).is_absolute() {
        PathBuf::from(&config.command)
    } else if let Some(path) = config.env.get("PATH") {
        which::which_in(&config.command, Some(path), &cwd)
            .map_err(|_| "ACP executable not found on the configured PATH".to_string())?
    } else {
        crate::find_program(&config.command)
            .ok_or("ACP executable not found; configure its absolute path")?
    };
    if !executable.is_file() {
        return Err("ACP executable does not exist".into());
    }
    #[cfg(windows)]
    if executable
        .extension()
        .is_some_and(|extension| extension == "cmd" || extension == "bat")
    {
        return Err("Use the agent's executable or node.exe plus its JS entry point, not a Windows command wrapper".into());
    }
    let mut command = Command::new(&executable);
    command.args(&config.args).envs(&config.env);
    let mut paths = Vec::new();
    // Native ACP agents do not require Node. Enrich PATH when a configured
    // Node is available, without turning Pi's runtime into an ACP prerequisite.
    let node_parent = config
        .node
        .as_ref()
        .and_then(|node| crate::executable(node).ok())
        .and_then(|node| node.parent().map(Path::to_path_buf));
    if let Some(parent) = node_parent {
        paths.push(parent);
    }
    if let Some(parent) = executable.parent() {
        paths.push(parent.to_path_buf());
    }
    let inherited_path = std::env::var_os("PATH").unwrap_or_default();
    let search_path = config
        .env
        .get("PATH")
        .map(std::ffi::OsStr::new)
        .unwrap_or(inherited_path.as_os_str());
    paths.extend(std::env::split_paths(search_path));
    command.env(
        "PATH",
        std::env::join_paths(paths).map_err(|error| error.to_string())?,
    );
    host.start(
        window.label(),
        token,
        cwd.clone(),
        command,
        Output::channel(window.clone(), on_event),
    )
    .await?;
    Ok(cwd)
}
#[tauri::command]
pub async fn write_acp(
    host: tauri::State<'_, AcpHost>,
    window: tauri::Window,
    token: String,
    message: Value,
) -> Result<(), String> {
    host.write(window.label(), &token, message).await
}
#[tauri::command]
pub async fn stop_acp(
    host: tauri::State<'_, AcpHost>,
    window: tauri::Window,
    token: Option<String>,
) -> Result<(), String> {
    host.stop_window(window.label(), token.as_deref(), false)
        .await
}

async fn supervise(
    mut child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    writes: mpsc::Receiver<Write>,
    mut stop: oneshot::Receiver<()>,
    output: Output,
) -> Result<(), String> {
    let mut records = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_RECORD));
    let mut errors = FramedRead::new(stderr, LinesCodec::new_with_max_length(64 * 1024));
    let mut stderr_open = true;
    let mut tail = String::new();
    let reason = {
        // Keep the ordered writer alive across select iterations. A pending
        // stdin write must not suspend stdout/stderr draining or owned Stop.
        // Leaving this scope drops stdin and rejects all unfinished writes;
        // no detached writer can outlive the observed child shutdown.
        let writer = write_records(stdin, writes);
        tokio::pin!(writer);
        loop {
            tokio::select! {
                reason = &mut writer => break reason,
                _ = &mut stop => break "ACP session stopped by Nimrod".to_owned(),
                record = records.next() => match record {
                    Some(Ok(line)) if line.trim().is_empty() => {},
                    Some(Ok(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(value) if value.is_object() && value["jsonrpc"] == "2.0" => {
                            tokio::select! {
                                _ = &mut stop => break "ACP session stopped by Nimrod".to_owned(),
                                result = output.send(Packet::Rpc { value }) => if result.is_err() { break "ACP frontend disconnected".into(); },
                                reason = &mut writer => break reason,
                            }
                        },
                        _ => break "Invalid ACP stdout JSON-RPC record".into(),
                    },
                    Some(Err(error)) => break format!("Invalid ACP stdout: {error}"),
                    None => break if tail.is_empty() { "ACP stdout closed".into() } else { format!("ACP stdout closed: {tail}") },
                },
                line = errors.next(), if stderr_open => match line {
                    Some(Ok(line)) => tail = line.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect(),
                    Some(Err(_)) => break "ACP stderr framing failed".into(),
                    None => stderr_open = false,
                },
            }
        }
    };
    let result = terminate(&mut child).await;
    let message = match &result {
        Ok(()) => reason,
        Err(error) => format!("{reason}; {error}"),
    };
    let _ = output.notify(Packet::Disconnected { message });
    result
}
async fn write_records(
    mut stdin: tokio::process::ChildStdin,
    mut writes: mpsc::Receiver<Write>,
) -> String {
    while let Some((message, reply)) = writes.recv().await {
        let mut bytes = serde_json::to_vec(&message).expect("JSON Value serializes");
        bytes.push(b'\n');
        let result = match timeout(Duration::from_secs(5), stdin.write_all(&bytes)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(format!("ACP stdin failed; delivery is unknown: {error}")),
            Err(_) => Err("ACP stdin timed out; delivery is unknown".into()),
        };
        let error = result.as_ref().err().cloned();
        let _ = reply.send(result);
        if let Some(error) = error {
            return error;
        }
    }
    "ACP writer closed".into()
}

async fn terminate(child: &mut Child) -> Result<(), String> {
    if child
        .try_wait()
        .map_err(|error| error.to_string())?
        .is_some()
    {
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
    child.start_kill().map_err(|error| error.to_string())?;
    if let Ok(status) = timeout(Duration::from_millis(1500), child.wait()).await {
        status.map_err(|error| error.to_string())?;
        return Ok(());
    }
    child.start_kill().map_err(|error| error.to_string())?;
    timeout(Duration::from_secs(3), child.wait())
        .await
        .map_err(|_| "Owned ACP process did not exit".to_string())?
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn acp_is_not_an_arbitrary_rpc_or_cross_project_interface() {
        let cwd = Path::new("/fixture/project");
        assert!(validate_message(&json!({"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/fixture/project","mcpServers":[]}}), cwd).is_ok());
        assert!(
            validate_message(
                &json!({"jsonrpc":"2.0","id":1,"method":"session/new","params":{"cwd":"/other"}}),
                cwd
            )
            .is_err()
        );
        assert!(
            validate_message(
                &json!({"jsonrpc":"2.0","id":1,"method":"session/delete","params":{}}),
                cwd
            )
            .is_err()
        );
        assert!(validate_message(&json!({"type":"prompt","id":"pi"}), cwd).is_err());
        assert!(validate_message(&json!({"jsonrpc":"2.0","id":"permission","result":{"outcome":{"outcome":"cancelled"}}}), cwd).is_ok());
    }
    #[test]
    fn saved_loading_requires_the_owned_project_and_an_explicit_identity() {
        let cwd = Path::new("/fixture/project");
        let load = |project: &str, id: Value| json!({"jsonrpc":"2.0","id":1,"method":"session/load","params":{"cwd":project,"sessionId":id,"mcpServers":[]}});
        assert!(validate_message(&load("/fixture/project", json!("saved-id")), cwd).is_ok());
        assert!(validate_message(&load("/other", json!("saved-id")), cwd).is_err());
        for id in [Value::Null, json!(""), json!(" "), json!(42)] {
            assert!(validate_message(&load("/fixture/project", id), cwd).is_err());
        }
    }
    #[test]
    fn listing_requires_the_owned_project_and_a_valid_cursor() {
        let cwd = Path::new("/fixture/project");
        let list = |params: Value| {
            json!({"jsonrpc":"2.0","id":1,"method":"session/list","params":params})
        };
        assert!(validate_message(&list(json!({"cwd":"/fixture/project"})), cwd).is_ok());
        assert!(
            validate_message(
                &list(json!({"cwd":"/fixture/project","cursor":"next"})),
                cwd
            )
            .is_ok()
        );
        assert!(validate_message(&list(json!({"cwd":"/other"})), cwd).is_err());
        assert!(validate_message(&list(json!({})), cwd).is_err());
        for cursor in [Value::Null, json!(""), json!(42)] {
            assert!(validate_message(
                &list(json!({"cwd":"/fixture/project","cursor":cursor})),
                cwd
            )
            .is_err());
        }
    }
    #[test]
    fn deletion_requires_an_explicit_saved_identity_and_request_id() {
        let cwd = Path::new("/fixture/project");
        let delete = |id: Value| {
            json!({"jsonrpc":"2.0","id":1,"method":"session/delete","params":{"sessionId":id}})
        };
        assert!(validate_message(&delete(json!("saved-id")), cwd).is_ok());
        for id in [Value::Null, json!(""), json!(" "), json!(42)] {
            assert!(validate_message(&delete(id), cwd).is_err());
        }
        assert!(
            validate_message(
                &json!({"jsonrpc":"2.0","method":"session/delete","params":{"sessionId":"saved-id"}}),
                cwd
            )
            .is_err()
        );
    }
    #[cfg(unix)]
    #[tokio::test]
    async fn owned_processes_route_and_stop_by_window_and_token() {
        let host = AcpHost::default();
        let command = || {
            let mut command = Command::new("/bin/sh");
            command.args([
                "-c",
                "while IFS= read -r line; do printf '%s\\n' \"$line\"; done",
            ]);
            command
        };
        let (tx, mut rx) = mpsc::unbounded_channel();
        let output = Output::new(move |packet| tx.send(packet).map_err(|error| error.to_string()));
        let cwd = std::env::temp_dir();
        host.start(
            "one",
            "first".into(),
            cwd.clone(),
            command(),
            output.clone(),
        )
        .await
        .unwrap();
        host.start("two", "second".into(), cwd, command(), output)
            .await
            .unwrap();
        let packet = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}});
        assert!(host.write("two", "first", packet.clone()).await.is_err());
        host.write("one", "first", packet.clone()).await.unwrap();
        assert!(matches!(
            timeout(Duration::from_secs(2), rx.recv()).await.unwrap(),
            Some(Packet::Rpc { .. })
        ));
        host.stop_window("one", Some("first"), false).await.unwrap();
        assert!(host.write("one", "first", packet.clone()).await.is_err());
        host.write("two", "second", packet).await.unwrap();
        host.shutdown().await.unwrap();
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn full_duplex_pipes_drain_output_during_large_writes() {
        let host = AcpHost::default();
        let mut command = Command::new("/bin/sh");
        // Fill stdout before reading stdin. Both directions exceed a pipe's
        // capacity; serial write-then-read supervision deadlocks until timeout.
        command.args([
            "-c",
            r#"printf '{"jsonrpc":"2.0","method":"fixture/output","params":{"text":"'
                i=0
                while [ "$i" -lt 8192 ]; do
                    printf 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx'
                    i=$((i + 1))
                done
                printf '"}}\n'
                IFS= read -r request
                printf '%s\n' "$request"
                while IFS= read -r request; do :; done"#,
        ]);
        let (tx, mut rx) = mpsc::unbounded_channel();
        let output = Output::new(move |packet| tx.send(packet).map_err(|error| error.to_string()));
        host.start(
            "duplex",
            "large".into(),
            std::env::temp_dir(),
            command,
            output,
        )
        .await
        .unwrap();
        let packet = json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"fixture":"x".repeat(1024 * 1024)}});
        let write = timeout(
            Duration::from_secs(10),
            host.write("duplex", "large", packet.clone()),
        )
        .await;
        let observed = timeout(Duration::from_secs(10), async {
            let mut packets = Vec::new();
            while packets.len() < 2 {
                match rx.recv().await {
                    Some(Packet::Rpc { value }) => packets.push(value),
                    other => panic!("Expected ACP fixture records, got {other:?}"),
                }
            }
            packets
        })
        .await;
        host.shutdown().await.unwrap();
        write.unwrap().unwrap();
        let packets = observed.unwrap();
        assert_eq!(
            packets[0]["params"]["text"].as_str().unwrap().len(),
            8192 * 64
        );
        assert_eq!(
            packets[1], packet,
            "partial writes must not restart when reads win"
        );
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn stop_does_not_wait_for_a_blocked_stdin_deadline() {
        let host = Arc::new(AcpHost::default());
        let mut command = Command::new("/bin/sh");
        command.args(["-c", "exec sleep 30"]);
        host.start(
            "blocked",
            "stop".into(),
            std::env::temp_dir(),
            command,
            Output::new(|_| Ok(())),
        )
        .await
        .unwrap();
        let writer = host.clone();
        let mut pending = tokio::spawn(async move {
            writer
                .write(
                    "blocked",
                    "stop",
                    json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"fixture":"x".repeat(1024 * 1024)}}),
                )
                .await
        });
        assert!(
            timeout(Duration::from_millis(100), &mut pending)
                .await
                .is_err()
        );
        let stopper = host.clone();
        let mut stopped =
            tokio::spawn(async move { stopper.stop_window("blocked", Some("stop"), false).await });
        let fast = timeout(Duration::from_secs(2), &mut stopped).await;
        // Do not cancel an in-flight ownership cleanup just to assert latency.
        if fast.is_err() {
            stopped.await.unwrap().unwrap();
        }
        host.shutdown().await.unwrap();
        fast.unwrap().unwrap().unwrap();
        assert!(pending.await.unwrap().is_err());
    }
}
