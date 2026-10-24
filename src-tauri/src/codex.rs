//! Codex app-server stdio ownership; Codex protocol semantics remain concrete.
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
    sync::{Mutex, RwLock, mpsc, oneshot},
    task::JoinHandle,
    time::timeout,
};
use tokio_util::codec::{FramedRead, LinesCodec};

// Codex history is paginated; cap each wire record independently.
const MAX_RECORD: usize = 16 * 1024 * 1024;
type Write = (Value, oneshot::Sender<Result<Option<String>, String>>);
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
#[path = "codex_deletion.rs"]
pub(crate) mod deletion;
struct CatalogThread { cwd: PathBuf, parent: Option<String>, fork: Option<String>, ephemeral: bool }
struct Owned {
    window: String,
    catalog: bool,
    binding: Arc<Mutex<Option<String>>>,
    metadata: Arc<Mutex<HashMap<String, CatalogThread>>>,
    delete_request: Arc<Mutex<Option<Value>>>,
    cwd: PathBuf,
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
pub struct CodexHost {
    sessions: Mutex<HashMap<String, Arc<Owned>>>,
    windows: Mutex<Windows>,
    deletion: Arc<RwLock<deletion::Gate>>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Config {
    cwd: PathBuf,
    cli: Option<PathBuf>,
    generation: String,
    #[serde(default)]
    catalog: bool,
}

impl CodexHost {
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
        }).await?;
        if closing { self.release_window_deletion(window).await; }
        Ok(())
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
        self.release_window_deletion(window).await;
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
fn validate_message(value: &Value) -> Result<(), String> {
    if !value.is_object() || value.get("jsonrpc").is_some()
        || serde_json::to_vec(value).map_err(|error| error.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Invalid or oversized Codex record".into());
    }
    let valid_id = |id: &Value| id.as_str().is_some_and(|s| !s.is_empty() && s.len() <= 128)
        || id.as_i64().is_some_and(|n| n.unsigned_abs() <= 9_007_199_254_740_991);
    if let Some(method) = value.get("method") {
        if !value["params"].is_object() || value.get("result").is_some() || value.get("error").is_some() {
            return Err("Invalid Codex request".into());
        }
        match method.as_str() {
            Some("initialized") if value.get("id").is_none() => {},
            Some("initialize" | "thread/start" | "thread/resume" | "thread/list"
                | "thread/turns/list" | "thread/items/list"
                | "turn/start" | "turn/steer" | "turn/interrupt" | "model/list" | "thread/delete") if valid_id(&value["id"]) => {},
            _ => return Err("Unsupported Codex operation".into()),
        }
        if matches!(method.as_str(), Some("thread/resume" | "thread/turns/list" | "thread/items/list" | "turn/start" | "turn/steer" | "turn/interrupt" | "thread/delete"))
            && value["params"]["threadId"].as_str().is_none_or(|id| id.is_empty() || id.len() > 128) {
            return Err("Codex operation requires a thread ID".into());
        }
        if matches!(method.as_str(), Some("turn/start" | "turn/steer")) {
            let params = &value["params"];
            let input = params["input"].as_array().ok_or("Invalid Codex input")?;
            if input.is_empty() || input.len() > 9 || params["clientUserMessageId"].as_str().is_none_or(|id| id.is_empty() || id.len() > 128) {
                return Err("Invalid Codex message identity or input count".into());
            }
            let mut images = 0;
            let mut image_bytes = 0;
            for part in input {
                match part["type"].as_str() {
                    Some("text") if part["text"].as_str().is_some_and(|text| text.chars().count() <= 1_000_000)
                        && part["text_elements"].as_array().is_some_and(Vec::is_empty) => {},
                    Some("image") if method.as_str() == Some("turn/start") => {
                        let url = part["url"].as_str().ok_or("Invalid Codex image URL")?;
                        let (header, data) = url.split_once(',').ok_or("Invalid Codex image URL")?;
                        if !matches!(header, "data:image/png;base64" | "data:image/jpeg;base64" | "data:image/webp;base64" | "data:image/gif;base64") {
                            return Err("Codex accepts inline image bytes only".into());
                        }
                        let raw = data.trim_end_matches('=');
                        let padding = data.len() - raw.len();
                        if raw.is_empty() || data.len() % 4 != 0 || padding > 2 || !raw.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'+' || byte == b'/') {
                            return Err("Invalid Codex inline image bytes".into());
                        }
                        let bytes = data.len() / 4 * 3 - padding;
                        images += 1; image_bytes += bytes;
                        if images > 8 || bytes > 4 * 1024 * 1024 || image_bytes > 8 * 1024 * 1024 {
                            return Err("Codex image input exceeds shared limits".into());
                        }
                    },
                    _ => return Err("Unsupported Codex input type".into()),
                }
            }
        }
        if value["params"].get("config").is_some_and(|config| {
            method.as_str() != Some("thread/resume") || config.as_object().is_none_or(|map|
                map.len() != 1 || map.get("model_reasoning_effort").is_none_or(|effort|
                    !matches!(effort.as_str(), Some("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max"))))
        }) || value["params"].get("path").is_some()
            || value["params"].get("history").is_some() {
            return Err("Codex raw configuration/history injection is unavailable".into());
        }
    } else if !valid_id(&value["id"]) || (value.get("result").is_some() == value.get("error").is_some()) {
        return Err("Invalid Codex response".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn start_codex(
    app: tauri::AppHandle,
    window: tauri::Window,
    host: tauri::State<'_, CodexHost>,
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
        return Err("Invalid Codex token".into());
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
        return Err("Codex requires this window's canonical project directory".into());
    }
    let cli = config
        .cli
        .map(|path| {
            if path.is_absolute() {
                Ok(path)
            } else {
                path.to_str()
                    .and_then(crate::find_program)
                    .ok_or("Configured Codex CLI executable was not found".to_owned())
            }
        })
        .transpose()?
        .or_else(|| crate::find_program("codex"))
        .ok_or("Install and authenticate Codex CLI, or configure its Runtime path")?;
    let cli = crate::executable(&cli)?;
    #[cfg(not(unix))]
    return Err(
        "Codex process-tree ownership is currently implemented for macOS and Linux only"
            .into(),
    );
    #[cfg(unix)]
    {
        let windows = host.windows.lock().await;
        if windows.closing.contains(window.label()) || windows.closing.contains("*") {
            return Err("Project is closing".into());
        }
        if windows.generations.get(window.label()) != Some(&config.generation) {
            return Err("Codex launch belongs to an obsolete window generation".into());
        }
        if windows
            .retired
            .contains(&(window.label().into(), token.clone()))
        {
            return Err("Codex launch token was already stopped".into());
        }
        let mut sessions = host.sessions.lock().await;
        if sessions.contains_key(&token) {
            return Err("Codex token is already owned".into());
        }
        let mut command = Command::new(&cli);
        command
            .arg("app-server")
            .arg("--listen")
            .arg("stdio://")
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .process_group(0);
        let mut paths = Vec::new();
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
            .map_err(|error| format!("Could not start Codex app-server: {error}"))?;
        let stdin = child.stdin.take().ok_or("Missing app-server stdin")?;
        let stdout = child.stdout.take().ok_or("Missing app-server stdout")?;
        let stderr = child.stderr.take().ok_or("Missing app-server stderr")?;
        let (writer, writes) = mpsc::channel(32);
        let (stop, stopped) = oneshot::channel();
        let output = Output::channel(on_event);
        let binding = Arc::new(Mutex::new(None));
        let metadata = Arc::new(Mutex::new(HashMap::new()));
        let delete_request = Arc::new(Mutex::new(None));
        let wire_owner = WireOwner { catalog: config.catalog, token: token.clone(), cwd: cwd.clone(),
            binding: binding.clone(), metadata: metadata.clone(), delete_request: delete_request.clone(), gate: host.deletion.clone() };
        let task = tokio::spawn(supervise(
            child, stdin, stdout, stderr, writes, stopped, output, wire_owner,
        ));
        sessions.insert(
            token,
            Arc::new(Owned {
                window: window.label().into(),
                cwd: cwd.clone(),
                catalog: config.catalog, binding, metadata, delete_request,
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
pub async fn write_codex(
    host: tauri::State<'_, CodexHost>,
    window: tauri::Window,
    token: String,
    message: Value,
) -> Result<Option<String>, String> {
    validate_message(&message)?;
    let windows = host.windows.lock().await;
    if windows.closing.contains(window.label())
        || windows.closing.contains("*")
        || windows
            .retired
            .contains(&(window.label().into(), token.clone()))
    {
        return Err("Codex connection was already stopped".into());
    }
    let owner = host
        .sessions
        .lock()
        .await
        .get(&token)
        .filter(|owner| owner.window == window.label())
        .cloned()
        .ok_or("Unknown Codex connection or wrong window")?;
    if let Some(cwd) = message["params"].get("cwd") {
        if cwd.as_str() != owner.cwd.to_str() { return Err("Codex cwd must match its project".into()); }
    }
    if matches!(message["method"].as_str(), Some("thread/start" | "thread/resume"))
        && message["params"]["cwd"].as_str() != owner.cwd.to_str() {
        return Err("Codex opening/discovery requires its exact project".into());
    }
    if message["method"] == "thread/list" && message["params"].get("cwd").is_none() {
        let kinds = message["params"]["sourceKinds"].as_array().ok_or("Unscoped Codex catalog requires all source kinds")?;
        let expected = ["cli", "vscode", "exec", "appServer", "subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther", "unknown"];
        if !owner.catalog || kinds.len() != expected.len() || expected.iter().any(|kind| !kinds.iter().any(|value| value.as_str() == Some(kind))) || !message["params"]["archived"].is_boolean() {
            return Err("Unscoped Codex inventory requires a catalog and complete source/archive filters".into());
        }
    }
    let (reply, result) = oneshot::channel();
    drop(windows);
    owner
        .writer
        .send((message, reply))
        .await
        .map_err(|_| "Codex app-server disconnected")?;
    result
        .await
        .map_err(|_| "Codex delivery outcome is unknown".to_owned())?
}
#[tauri::command]
pub async fn stop_codex(
    host: tauri::State<'_, CodexHost>,
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
#[derive(Clone)]
struct WireOwner {
    catalog: bool, token: String, cwd: PathBuf,
    binding: Arc<Mutex<Option<String>>>,
    metadata: Arc<Mutex<HashMap<String, CatalogThread>>>,
    delete_request: Arc<Mutex<Option<Value>>>,
    gate: Arc<RwLock<deletion::Gate>>,
}
async fn supervise(
    mut child: Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::process::ChildStdout,
    stderr: tokio::process::ChildStderr,
    writes: mpsc::Receiver<Write>,
    mut stop: oneshot::Receiver<()>,
    output: Output,
    owner: WireOwner,
) -> Result<(), FailedStop> {
    let group = child.id().expect("newly spawned owned child has a PID");
    let mut records = FramedRead::new(stdout, LinesCodec::new_with_max_length(MAX_RECORD));
    let mut errors = FramedRead::new(stderr, LinesCodec::new_with_max_length(64 * 1024));
    let mut stderr_open = true;
    let mut tail = String::new();
    let reason = {
        let writer = write_records(stdin, writes, owner.clone());
        tokio::pin!(writer);
        loop {
            tokio::select! {
                reason = &mut writer => break reason,
                _ = &mut stop => break "Codex connection stopped by Nimrod".to_owned(),
                record = records.next() => match record {
                    Some(Ok(line)) if line.trim().is_empty() => {},
                    Some(Ok(line)) => match serde_json::from_str::<Value>(&line) {
                        Ok(value) if value.is_object() && value.get("jsonrpc").is_none() => {
                            let observed = tokio::select! {
                                _ = &mut stop => break "Codex connection stopped by Nimrod".to_owned(),
                                reason = &mut writer => break reason,
                                result = observe_record(&owner, &value) => result,
                            };
                            if let Err(error) = observed { break error; }
                            tokio::select! {
                                _ = &mut stop => break "Codex connection stopped by Nimrod".to_owned(),
                                result = output.send(Packet::Rpc { value }) => if result.is_err() { break "Codex frontend disconnected".into(); },
                                reason = &mut writer => break reason,
                            }
                        },
                        _ => break "Invalid Codex app-server record".into(),
                    },
                    Some(Err(error)) => break format!("Invalid Codex app-server stdout: {error}"),
                    None => break format!("Codex app-server closed: {tail}"),
                },
                line = errors.next(), if stderr_open => match line {
                    Some(Ok(line)) => tail = line.chars().rev().take(2000).collect::<Vec<_>>().into_iter().rev().collect(),
                    Some(Err(error)) => break format!("Codex stderr framing failed: {error}"),
                    None => stderr_open = false,
                },
            }
        }
    };
    // Closing stdin is the app-server shutdown boundary. Signal only the owned
    // group and keep its leader unreaped until the last signal.
    let result = {
        let stopping = async {
            // Give stdin EOF a bounded flush opportunity while still draining both pipes.
            tokio::time::sleep(Duration::from_millis(500)).await;
            terminate(&mut child, group, None).await
        };
        tokio::pin!(stopping);
        let mut stdout_open = true;
        loop {
            tokio::select! {
                result = &mut stopping => break result,
                record = records.next(), if stdout_open => { if record.is_none() { stdout_open = false; } },
                line = errors.next(), if stderr_open => { if line.is_none() { stderr_open = false; } },
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
async fn observe_record(owner: &WireOwner, value: &Value) -> Result<(), String> {
    if value.get("result").is_some() || value.get("error").is_some() {
        let mut pending = owner.delete_request.lock().await;
        if pending.as_ref().is_some_and(|id| value.get("id") == Some(id)) { *pending = None; }
    }
    if owner.catalog {
        if let Some(rows) = value["result"]["data"].as_array() {
            let mut metadata = owner.metadata.lock().await;
            for row in rows {
                if let (Some(id), Some(cwd)) = (row["id"].as_str(), row["cwd"].as_str()) {
                    if id.is_empty() || id.len() > 128 || cwd.is_empty() || cwd.len() > 32768 { return Err("Invalid Codex catalog identity".into()); }
                    let lineage = |field: &str| -> Result<Option<String>, String> {
                        match row.get(field) {
                            Some(Value::Null) => Ok(None),
                            Some(Value::String(id)) if !id.is_empty() && id.len() <= 128 => Ok(Some(id.clone())),
                            _ => Err("Codex catalog omitted stable spawned/fork lineage".into()),
                        }
                    };
                    let parent = lineage("parentThreadId")?;
                    let fork = lineage("forkedFromId")?;
                    let ephemeral = row["ephemeral"].as_bool().ok_or("Codex catalog omitted persistence state")?;
                    metadata.insert(id.into(), CatalogThread { cwd: PathBuf::from(cwd), parent, fork, ephemeral });
                    if metadata.len() > 100_000 { return Err("Codex catalog identity inventory exceeds 100,000 threads".into()); }
                }
            }
        }
    } else if let Some(id) = value["result"]["thread"]["id"].as_str() {
        if id.is_empty() || id.len() > 128 || value["result"]["thread"]["cwd"].as_str() != owner.cwd.to_str() {
            return Err("Codex returned a conflicting native thread/project".into());
        }
        let gate = owner.gate.read().await;
        let mut bound = owner.binding.lock().await;
        if bound.as_ref().is_some_and(|current| current != id) || bound.is_none() && gate.blocks(id) {
            return Err("Codex identity is conflicting or reserved for deletion".into());
        }
        *bound = Some(id.into());
    }
    Ok(())
}
async fn write_records(
    mut stdin: tokio::process::ChildStdin,
    mut writes: mpsc::Receiver<Write>,
    owner: WireOwner,
) -> String {
    while let Some((value, reply)) = writes.recv().await {
        // Recheck at actual write, not merely when enqueuing. The read lease
        // excludes scope changes until this bounded pipe write completes.
        let gate = owner.gate.read().await;
        let mut binding = owner.binding.lock().await;
        let validation = gate.check(owner.catalog, binding.as_deref(), &owner.token, &value);
        if let Err(error) = validation { let _ = reply.send(Ok(Some(error))); continue; }
        if value["method"] == "thread/delete" {
            let metadata = owner.metadata.lock().await;
            if let Err(error) = gate.validate_deletion(&metadata, &owner.cwd) { let _ = reply.send(Ok(Some(error))); continue; }
        }
        if !owner.catalog {
            if let Some(id) = value["params"]["threadId"].as_str() {
                if binding.as_ref().is_some_and(|current| current != id) { let error = "Codex writer changed its bound thread".to_owned(); let _ = reply.send(Err(error.clone())); return error; }
                *binding = Some(id.into());
            }
        }
        drop(binding);
        if owner.catalog && value["method"] == "thread/list" && value["params"]["archived"] == false
            && value["params"]["sourceKinds"].as_array().is_some_and(|kinds| kinds.len() == 10)
            && value["params"].get("cwd").is_none() && value["params"].get("cursor").is_none() {
            owner.metadata.lock().await.clear();
        }
        if value["method"] == "thread/delete" {
            let mut pending = owner.delete_request.lock().await;
            if pending.is_some() { let error = "A Codex deletion is already in flight".to_owned(); let _ = reply.send(Err(error.clone())); return error; }
            *pending = Some(value["id"].clone());
        }
        let mut bytes = serde_json::to_vec(&value).expect("JSON value serializes");
        bytes.push(b'\n');
        let result = match timeout(Duration::from_secs(5), stdin.write_all(&bytes)).await {
            Ok(Ok(())) => Ok(None),
            Ok(Err(error)) => Err(format!(
                "Codex app-server write failed; delivery is unknown: {error}"
            )),
            Err(_) => Err("Codex app-server write timed out; delivery is unknown".into()),
        };
        let error = result.as_ref().err().cloned();
        let _ = reply.send(result);
        if let Some(error) = error {
            return error;
        }
    }
    "Codex app-server writer closed".into()
}

use crate::owned_process::terminate;
#[cfg(test)]
#[path = "codex_tests.rs"]
mod tests;
