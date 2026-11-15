//! Window/token-scoped Codex daemon connections; the shared server is never Nimrod-owned.
use crate::{
    process::{Output, Packet},
    workspace_windows::WorkspaceWindows,
};
use serde::Deserialize;
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::Arc,
    time::Duration,
};
use tauri::{Manager, ipc::Channel};
use tokio::{
    sync::{Mutex, RwLock, mpsc, oneshot},
    task::JoinHandle,
};
#[path = "codex_daemon.rs"]
mod daemon;

// Codex history is paginated; cap each wire record independently.
const MAX_RECORD: usize = 16 * 1024 * 1024;
type Write = (Value, oneshot::Sender<Result<Option<String>, String>>);
type Stop = (oneshot::Sender<()>, JoinHandle<()>);
#[derive(Default)]
struct StopState {
    task: Option<Stop>,
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

// Discovery and launch must resolve the same configured executable.
fn resolve_cli(configured: Option<PathBuf>) -> Result<PathBuf, String> {
    let cli = configured
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
    crate::executable(&cli)
}

#[tauri::command]
pub fn codex_runtime_available(cli: Option<PathBuf>) -> bool {
    cfg!(unix) && resolve_cli(cli).is_ok_and(|path| which::which(path).is_ok())
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
            if let Some((signal, task)) = stop.task.take() {
                let _ = signal.send(());
                match task.await {
                    Ok(()) => {}
                    Err(error) => {
                        let error = error.to_string();
                        stop.poison = Some(error.clone());
                        errors.push(error);
                        continue;
                    }
                }
            }
            // Socket closure does not cancel a mutation already accepted by a shared server.
            if owner.catalog && owner.delete_request.lock().await.is_some() {
                self.deletion.write().await.mark_uncertain(&id);
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
                | "turn/start" | "turn/steer" | "turn/interrupt" | "model/list" | "thread/delete" | "thread/name/set"
                | "thread/compact/start" | "thread/read" | "thread/settings/update" | "mcpServerStatus/list" | "thread/backgroundTerminals/list" | "skills/list" | "hooks/list") if valid_id(&value["id"]) => {},
            _ => return Err("Unsupported Codex operation".into()),
        }
        if matches!(method.as_str(), Some("thread/resume" | "thread/turns/list" | "thread/items/list" | "turn/start" | "turn/steer" | "turn/interrupt" | "thread/delete" | "thread/name/set"
            | "thread/compact/start" | "thread/read" | "thread/settings/update" | "mcpServerStatus/list" | "thread/backgroundTerminals/list"))
            && value["params"]["threadId"].as_str().is_none_or(|id| id.is_empty() || id.len() > 128) {
            return Err("Codex operation requires a thread ID".into());
        }
        if matches!(method.as_str(), Some("thread/compact/start" | "thread/read" | "mcpServerStatus/list" | "thread/backgroundTerminals/list" | "skills/list" | "hooks/list")) {
            let params = value["params"].as_object().ok_or("Invalid Codex command parameters")?;
            let allowed: &[&str] = match method.as_str() {
                Some("thread/compact/start") => &["threadId"],
                Some("thread/read") => &["threadId", "includeTurns"],
                Some("mcpServerStatus/list") => &["threadId", "cursor", "limit", "detail"],
                Some("thread/backgroundTerminals/list") => &["threadId", "cursor", "limit"],
                _ => &["cwds"],
            };
            if params.keys().any(|key| !allowed.contains(&key.as_str())) { return Err("Unsupported Codex command parameter".into()); }
            if method.as_str() == Some("thread/read") && value["params"]["includeTurns"] != false { return Err("Command reports require metadata-only thread reads".into()); }
            if matches!(method.as_str(), Some("skills/list" | "hooks/list")) && value["params"]["cwds"].as_array().is_none_or(|cwds|
                cwds.len() != 1 || cwds[0].as_str().is_none_or(|cwd| cwd.is_empty())) { return Err("Codex catalog report requires one project".into()); }
            if matches!(method.as_str(), Some("mcpServerStatus/list" | "thread/backgroundTerminals/list")) {
                if value["params"]["limit"] != 100 || value["params"].get("cursor").is_some_and(|cursor| cursor.as_str().is_none_or(|cursor| cursor.is_empty())) {
                    return Err("Invalid Codex command pagination".into());
                }
                if method.as_str() == Some("mcpServerStatus/list") && !matches!(value["params"]["detail"].as_str(), Some("full" | "toolsAndAuthOnly")) {
                    return Err("Invalid Codex MCP detail".into());
                }
            }
        }
        if method.as_str() == Some("thread/settings/update") {
            let params = value["params"].as_object().ok_or("Invalid Codex settings parameters")?;
            // This boundary permits only one advertised model/effort change,
            // never cwd, permissions, sandbox or other settings mutations.
            if params.len() != 2 || params.keys().any(|key| !matches!(key.as_str(), "threadId" | "model" | "effort"))
                || params.get("model").is_some_and(|model| model.as_str().is_none_or(|model| model.trim().is_empty()))
                || params.get("effort").is_some_and(|effort| !matches!(effort.as_str(), Some("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" | "ultra"))) {
                return Err("Unsupported Codex settings update".into());
            }
        }
        if method.as_str() == Some("thread/name/set") && value["params"]["name"].as_str().is_none_or(|name|
            name.trim().is_empty() || name.chars().any(char::is_control)) {
            return Err("Invalid Codex session name".into());
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
    let cli = resolve_cli(config.cli)?;
    #[cfg(not(unix))]
    return Err(
        "Codex daemon connections are currently implemented for macOS and Linux only"
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
        let (writer, writes) = mpsc::channel(32);
        let (stop, stopped) = oneshot::channel();
        let (ready, readiness) = oneshot::channel();
        let output = Output::channel(on_event);
        let binding = Arc::new(Mutex::new(None));
        let metadata = Arc::new(Mutex::new(HashMap::new()));
        let delete_request = Arc::new(Mutex::new(None));
        let wire_owner = WireOwner { catalog: config.catalog, token: token.clone(), cwd: cwd.clone(),
            binding: binding.clone(), metadata: metadata.clone(), delete_request: delete_request.clone(),
            incoming: Arc::new(Mutex::new(HashSet::new())), gate: host.deletion.clone() };
        // Setup is cancellable and does not hold window transition locks while Codex starts.
        let task = tokio::spawn(daemon::supervise(cli, writes, stopped, ready, output, wire_owner));
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
        drop(sessions);
        drop(windows);
        // Do not start frontend RPC deadlines until the daemon socket is usable.
        // Teardown can retire/stop this token while setup is pending.
        readiness.await.map_err(|_| "Codex daemon setup ended without readiness".to_owned())??;
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
    if matches!(message["method"].as_str(), Some("skills/list" | "hooks/list"))
        && message["params"]["cwds"].as_array().is_none_or(|cwds| cwds.len() != 1 || cwds[0].as_str() != owner.cwd.to_str()) {
        return Err("Codex command catalog must match its project".into());
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
    incoming: Arc<Mutex<HashSet<String>>>,
    gate: Arc<RwLock<deletion::Gate>>,
}
async fn observe_record(owner: &WireOwner, value: &Value) -> Result<(), String> {
    if value.get("result").is_some() || value.get("error").is_some() {
        let mut pending = owner.delete_request.lock().await;
        if pending.as_ref().is_some_and(|id| value.get("id") == Some(id)) { *pending = None; }
    }
    if owner.catalog {
        // A metadata-only read can recover a saved named-empty root hidden by
        // thread/list's preview filter, without binding this catalog to it.
        let mut rows: Vec<&Value> = value["result"]["data"].as_array().into_iter().flatten().collect();
        if let Some(thread) = value["result"].get("thread") { rows.push(thread); }
        if !rows.is_empty() {
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
#[cfg(test)]
#[path = "codex_tests.rs"]
mod tests;
