//! Nimrod's SDK bridge boundary. These records are not ACP or Pi messages.
use crate::{
    process::{Output, Packet},
    workspace_windows::WorkspaceWindows,
};
use futures_util::StreamExt;
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
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

// Like Pi get_messages, an SDK connection snapshot contains the entire history.
const MAX_RECORD: usize = 256 * 1024 * 1024;
type Write = (Value, oneshot::Sender<Result<(), String>>);
struct FailedStop {
    child: Child,
    group: u32,
    error: String,
}
type Stop = (oneshot::Sender<()>, JoinHandle<Result<(), FailedStop>>);
#[derive(Default)]
struct StopState {
    task: Option<Stop>,
    failed: Option<FailedStop>,
    poison: Option<String>,
}
struct Owned {
    window: String,
    writer: mpsc::Sender<Write>,
    stop: Mutex<StopState>,
}
#[derive(Default)]
struct Windows {
    closing: HashSet<String>,
    generations: HashMap<String, String>,
    retired: HashSet<(String, String)>,
}
#[derive(Default)]
pub struct CopilotHost {
    sessions: Mutex<HashMap<String, Arc<Owned>>>,
    windows: Mutex<Windows>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    cwd: PathBuf,
    node: Option<PathBuf>,
    cli: Option<PathBuf>,
    generation: String,
}

impl CopilotHost {
    pub async fn retire_window(&self, window: &str) {
        self.windows.lock().await.closing.insert(window.into());
    }
    pub async fn stop_window(
        &self,
        window: &str,
        token: Option<&str>,
        closing: bool,
    ) -> Result<(), String> {
        {
            let mut state = self.windows.lock().await;
            if closing {
                state.closing.insert(window.into());
            }
            if let Some(token) = token {
                state.retired.insert((window.into(), token.into()));
            }
        }
        self.stop_matching(|id, owner| {
            owner.window == window && token.is_none_or(|token| id == token)
        })
        .await
    }
    async fn reset_window(&self, window: &str) -> Result<String, String> {
        let generation = uuid::Uuid::new_v4().to_string();
        {
            let mut state = self.windows.lock().await;
            state.generations.insert(window.into(), generation.clone());
            state.retired.retain(|(owner, _)| owner != window);
        }
        self.stop_matching(|_, owner| owner.window == window)
            .await?;
        Ok(generation)
    }
    pub async fn shutdown(&self) -> Result<(), String> {
        self.windows.lock().await.closing.insert("*".into());
        self.stop_matching(|_, _| true).await
    }
    async fn stop_matching(&self, matches: impl Fn(&str, &Owned) -> bool) -> Result<(), String> {
        let selected: Vec<_> = self
            .sessions
            .lock()
            .await
            .iter()
            .filter(|(id, owner)| matches(id, owner))
            .map(|(id, owner)| (id.clone(), owner.clone()))
            .collect();
        let mut errors = Vec::new();
        for (id, owner) in selected {
            let mut stop = owner.stop.lock().await;
            if let Some(error) = stop.poison.as_ref() {
                errors.push(error.clone());
                continue;
            }
            if let Some(mut failed) = stop.failed.take() {
                if let Err(error) = terminate(&mut failed.child, failed.group, None).await {
                    failed.error = error.clone();
                    stop.failed = Some(failed);
                    errors.push(error);
                    continue;
                }
            }
            if let Some((signal, task)) = stop.task.take() {
                let _ = signal.send(());
                match task.await {
                    Ok(Ok(())) => {}
                    Ok(Err(failed)) => {
                        errors.push(failed.error.clone());
                        stop.failed = Some(failed);
                        continue;
                    }
                    Err(error) => {
                        let error = error.to_string();
                        stop.poison = Some(error.clone());
                        errors.push(error);
                        continue;
                    }
                }
            }
            let mut sessions = self.sessions.lock().await;
            if sessions
                .get(&id)
                .is_some_and(|current| Arc::ptr_eq(current, &owner))
            {
                sessions.remove(&id);
            }
        }
        if errors.is_empty() {
            Ok(())
        } else {
            Err(errors.join("\n"))
        }
    }
}
fn validate_prompt(value: &Value) -> Result<(), String> {
    let text = value["text"].as_str().ok_or("Invalid Copilot prompt")?;
    if text.chars().count() > 1_000_000
        || serde_json::to_vec(value)
            .map_err(|error| error.to_string())?
            .len()
            > 13 * 1024 * 1024
    {
        return Err("Copilot prompt exceeds the size limit".into());
    }
    let mut count = 0;
    let mut total = 0;
    if let Some(images) = value.get("images") {
        let images = images.as_array().ok_or("Invalid Copilot image attachments")?;
        count = images.len();
        if count > 8 {
            return Err("Too many Copilot image attachments".into());
        }
        for image in images {
            let data = image["data"].as_str().ok_or("Invalid Copilot image data")?;
            let unpadded = data.trim_end_matches('=');
            let padding = data.len() - unpadded.len();
            if image["type"].as_str() != Some("image")
                || !matches!(
                    image["mimeType"].as_str(),
                    Some("image/png" | "image/jpeg" | "image/webp" | "image/gif")
                )
                || unpadded.is_empty()
                || data.len() % 4 != 0
                || padding > 2
                || data.len() > (4 * 1024 * 1024_usize).div_ceil(3) * 4
                || !unpadded.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/'
                })
            {
                return Err("Invalid Copilot image attachment".into());
            }
            let bytes = data.len() / 4 * 3 - padding;
            total += bytes;
            if bytes > 4 * 1024 * 1024 || total > 8 * 1024 * 1024 {
                return Err("Copilot image attachments exceed the size limit".into());
            }
        }
    }
    if text.trim().is_empty() && count == 0 || count > 0 && text.trim_start().starts_with('/') {
        return Err("Images require a message, not a slash command".into());
    }
    Ok(())
}
fn validate_message(value: &Value) -> Result<(), String> {
    if !value.is_object()
        || value["id"]
            .as_str()
            .is_none_or(|id| id.is_empty() || id.len() > 128)
        || serde_json::to_vec(value)
            .map_err(|error| error.to_string())?
            .len()
            > MAX_RECORD
    {
        return Err("Invalid Copilot SDK bridge record".into());
    }
    match value["method"].as_str() {
        Some("initialize" | "list" | "connect" | "cancel" | "commands" | "usage" | "context") => {}
        Some("command")
            if value["name"].as_str().is_some_and(|name| {
                !name.is_empty()
                    && !name
                        .chars()
                        .any(|c| c.is_whitespace() || c.is_control() || c == '/')
            }) && value.get("input").is_none_or(|input| input.is_string()) => {}
        Some("permission-change") if value["value"].as_str() == Some("allow-all") => {}
        Some("prompt") => validate_prompt(value)?,
        Some("configure")
            if matches!(
                value["setting"].as_str(),
                Some("model" | "effort" | "mode" | "context-tier")
            ) && value["value"].is_string() => {}
        Some("delete") if value["sessionId"].as_str().is_some_and(|id| !id.is_empty()) => {}
        Some("decision") if value["decisionId"].is_string() && value["value"].is_object() => {}
        _ => return Err("Unsupported Copilot SDK bridge operation".into()),
    }
    if value
        .get("sessionId")
        .is_some_and(|id| !id.is_string() || id.as_str().is_none_or(|id| id.trim().is_empty()))
    {
        return Err("Invalid saved Copilot session ID".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn start_copilot(
    app: tauri::AppHandle,
    window: tauri::Window,
    host: tauri::State<'_, CopilotHost>,
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
        return Err("Invalid Copilot token".into());
    }
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
        return Err("Copilot requires this window's canonical project directory".into());
    }
    let node = config
        .node
        .or_else(|| crate::find_program("node"))
        .ok_or("Node was not found; configure Runtime paths")?;
    let node = crate::executable(&node)?;
    let cli = config
        .cli
        .map(|path| {
            if path.is_absolute() {
                Ok(path)
            } else {
                path.to_str()
                    .and_then(crate::find_program)
                    .ok_or("Configured Copilot CLI executable was not found".to_owned())
            }
        })
        .transpose()?
        .or_else(|| crate::find_program("copilot"))
        .ok_or("Install and authenticate Copilot CLI, or configure its Runtime path")?;
    let cli = crate::executable(&cli)?;
    let bridge = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../copilot/bridge.mjs")
    } else {
        app.path()
            .resource_dir()
            .map_err(|error| error.to_string())?
            .join("resources/copilot/bridge.mjs")
    };
    if !bridge.is_file() {
        return Err("The bundled Copilot SDK bridge is missing".into());
    }
    #[cfg(not(unix))]
    return Err(
        "Copilot SDK process-tree ownership is currently implemented for macOS and Linux only"
            .into(),
    );
    #[cfg(unix)]
    {
        let windows = host.windows.lock().await;
        if windows.closing.contains(window.label()) || windows.closing.contains("*") {
            return Err("Project is closing".into());
        }
        if windows.generations.get(window.label()) != Some(&config.generation) {
            return Err("Copilot launch belongs to an obsolete window generation".into());
        }
        if windows
            .retired
            .contains(&(window.label().into(), token.clone()))
        {
            return Err("Copilot launch token was already stopped".into());
        }
        let mut sessions = host.sessions.lock().await;
        if sessions.contains_key(&token) {
            return Err("Copilot token is already owned".into());
        }
        let mut command = Command::new(&node);
        command
            .arg(bridge)
            .arg(&cli)
            .arg(&cwd)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .process_group(0);
        let mut paths = Vec::new();
        if let Some(path) = node.parent() {
            paths.push(path.to_path_buf());
        }
        if let Some(path) = cli.parent() {
            paths.push(path.to_path_buf());
        }
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|error| error.to_string())?,
        );
        let mut child = command
            .spawn()
            .map_err(|error| format!("Could not start Copilot SDK bridge: {error}"))?;
        let stdin = child.stdin.take().ok_or("Missing bridge stdin")?;
        let stdout = child.stdout.take().ok_or("Missing bridge stdout")?;
        let stderr = child.stderr.take().ok_or("Missing bridge stderr")?;
        let (writer, writes) = mpsc::channel(32);
        let (stop, stopped) = oneshot::channel();
        let output = Output::channel(window.clone(), on_event);
        let task = tokio::spawn(supervise(
            child, stdin, stdout, stderr, writes, stopped, output,
        ));
        sessions.insert(
            token,
            Arc::new(Owned {
                window: window.label().into(),
                writer,
                stop: Mutex::new(StopState {
                    task: Some((stop, task)),
                    ..StopState::default()
                }),
            }),
        );
        Ok(cwd)
    }
}
#[tauri::command]
pub async fn write_copilot(
    host: tauri::State<'_, CopilotHost>,
    window: tauri::Window,
    token: String,
    message: Value,
) -> Result<(), String> {
    validate_message(&message)?;
    let windows = host.windows.lock().await;
    if windows.closing.contains(window.label())
        || windows.closing.contains("*")
        || windows
            .retired
            .contains(&(window.label().into(), token.clone()))
    {
        return Err("Copilot connection was already stopped".into());
    }
    let owner = host
        .sessions
        .lock()
        .await
        .get(&token)
        .filter(|owner| owner.window == window.label())
        .cloned()
        .ok_or("Unknown Copilot connection or wrong window")?;
    let (reply, result) = oneshot::channel();
    drop(windows);
    owner
        .writer
        .send((message, reply))
        .await
        .map_err(|_| "Copilot bridge disconnected")?;
    result
        .await
        .map_err(|_| "Copilot delivery outcome is unknown".to_owned())?
}
#[tauri::command]
pub async fn stop_copilot(
    host: tauri::State<'_, CopilotHost>,
    window: tauri::Window,
    token: Option<String>,
) -> Result<String, String> {
    if token.is_none() {
        return host.reset_window(window.label()).await;
    }
    host.stop_window(window.label(), token.as_deref(), false)
        .await?;
    Ok(String::new())
}
async fn supervise(
    mut child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    writes: mpsc::Receiver<Write>,
    mut stop: oneshot::Receiver<()>,
    output: Output,
) -> Result<(), FailedStop> {
    let group = child.id().expect("newly spawned owned child has a PID");
    let mut records = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_RECORD));
    let mut errors = FramedRead::new(stderr, LinesCodec::new_with_max_length(64 * 1024));
    let mut stderr_open = true;
    let mut tail = String::new();
    let mut graceful = false;
    let reason = {
        let writer = write_records(stdin, writes);
        tokio::pin!(writer);
        loop {
            tokio::select! {
                reason = &mut writer => break reason,
                _ = &mut stop => break "Copilot connection stopped by Nimrod".to_owned(),
                record = records.next() => match record {
                    Some(Ok(line)) if line.trim().is_empty() => {},
                    Some(Ok(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(value) if value["kind"] == "stopped" => { graceful = true; break "Copilot bridge stopped".into(); },
                        Ok(value) if value.is_object() && value["kind"].is_string() => {
                            tokio::select! {
                                _ = &mut stop => break "Copilot connection stopped by Nimrod".to_owned(),
                                result = output.send(Packet::Rpc { value }) => if result.is_err() { break "Copilot frontend disconnected".into(); },
                                reason = &mut writer => break reason,
                            }
                        },
                        _ => break "Invalid Copilot bridge record".into(),
                    },
                    Some(Err(error)) => break format!("Invalid Copilot bridge stdout: {error}"),
                    None => break format!("Copilot bridge closed: {tail}"),
                },
                line = errors.next(), if stderr_open => match line {
                    Some(Ok(line)) => tail = line.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect(),
                    Some(Err(error)) => break format!("Copilot stderr framing failed: {error}"),
                    None => stderr_open = false,
                },
            }
        }
    };
    let result = {
        let (confirmed, confirmation) = oneshot::channel();
        let mut confirmed = Some(confirmed);
        if graceful {
            let _ = confirmed.take().unwrap().send(());
        }
        let stopping = terminate(&mut child, group, Some(confirmation));
        tokio::pin!(stopping);
        let mut stdout_open = true;
        loop {
            tokio::select! {
                result = &mut stopping => break result,
                record = records.next(), if stdout_open => {
                    match record {
                        None => stdout_open = false,
                        Some(Ok(line)) if serde_json::from_str::<Value>(&line).is_ok_and(|value| value["kind"] == "stopped") => {
                            if let Some(confirmed) = confirmed.take() { let _ = confirmed.send(()); }
                        },
                        _ => {},
                    }
                },
                line = errors.next(), if stderr_open => {
                    if line.is_none() { stderr_open = false; }
                },
            }
        }
    };
    let message = match &result {
        Ok(()) => reason,
        Err(error) => format!("{reason}; {error}"),
    };
    let _ = output.notify(Packet::Disconnected { message });
    result.map_err(|error| FailedStop {
        child,
        group,
        error,
    })
}
async fn write_records(
    mut stdin: tokio::process::ChildStdin,
    mut writes: mpsc::Receiver<Write>,
) -> String {
    while let Some((value, reply)) = writes.recv().await {
        let mut bytes = serde_json::to_vec(&value).expect("JSON value serializes");
        bytes.push(b'\n');
        let result = match timeout(Duration::from_secs(5), stdin.write_all(&bytes)).await {
            Ok(Ok(())) => Ok(()),
            Ok(Err(error)) => Err(format!(
                "Copilot bridge write failed; delivery is unknown: {error}"
            )),
            Err(_) => Err("Copilot bridge write timed out; delivery is unknown".into()),
        };
        let error = result.as_ref().err().cloned();
        let _ = reply.send(result);
        if let Some(error) = error {
            return error;
        }
    }
    "Copilot bridge writer closed".into()
}
#[cfg(test)]
#[path = "copilot_tests.rs"]
mod tests;

async fn terminate(
    child: &mut Child,
    group: u32,
    confirmation: Option<oneshot::Receiver<()>>,
) -> Result<(), String> {
    #[cfg(unix)]
    {
        use nix::{
            errno::Errno,
            sys::signal::{Signal, killpg},
            unistd::Pid,
        };
        let group = Pid::from_raw(group as i32);
        if child.id().is_none() {
            return match killpg(group, None) {
                Err(Errno::ESRCH) => Ok(()),
                Ok(()) => Err("Owned bridge was reaped; group exit is unconfirmed. Reservation retained without re-signaling a potentially reused group ID".into()),
                Err(error) => Err(format!("Could not observe owned group exit: {error}; reservation retained")),
            };
        }
        // EOF asks the bridge to disconnect and stop its SDK-owned CLI. Keep
        // the leader unreaped until the final signal so its PID cannot recycle.
        let graceful = if let Some(confirmation) = confirmation {
            matches!(
                timeout(Duration::from_secs(5), confirmation).await,
                Ok(Ok(()))
            )
        } else {
            false
        };
        if !graceful {
            match killpg(group, Signal::SIGTERM) {
                Ok(()) | Err(Errno::ESRCH) => {}
                Err(error) => return Err(error.to_string()),
            }
            tokio::time::sleep(Duration::from_millis(500)).await;
        }
        killpg(group, Signal::SIGKILL)
            .or_else(|error| {
                if error == Errno::ESRCH {
                    Ok(())
                } else {
                    Err(error)
                }
            })
            .map_err(|error| error.to_string())?;
        timeout(Duration::from_secs(3), child.wait())
            .await
            .map_err(|_| "Owned Copilot bridge did not exit")?
            .map_err(|error| error.to_string())?;
        let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
        loop {
            match killpg(group, None) {
                Err(Errno::ESRCH) => return Ok(()),
                Ok(()) => {}
                Err(error) => return Err(error.to_string()),
            }
            if tokio::time::Instant::now() >= deadline {
                return Err(
                    "Owned Copilot process group has not exited; reservation retained".into(),
                );
            }
            tokio::time::sleep(Duration::from_millis(25)).await;
        }
    }
    #[cfg(not(unix))]
    {
        let _ = (group, confirmation);
        child.start_kill().map_err(|error| error.to_string())?;
        child.wait().await.map_err(|error| error.to_string())?;
        Ok(())
    }
}
