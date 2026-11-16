//! Narrow request/reply CLI control. Separate from fire-and-forget launch forwarding.
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicBool, Ordering},
    },
};
use tauri::{Emitter, Manager};
use tokio::sync::oneshot;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub enum Action {
    #[serde(rename = "reload-customizations")]
    ReloadCustomizations,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct ActionRequest {
    pub version: u8,
    pub action: Action,
    pub project: PathBuf,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TemplateResult {
    pub applied: bool,
    pub error: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardReport {
    pub personal_loaded: usize,
    pub cache_hits: usize,
    pub manifest_loaded: usize,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CardResult {
    pub report: Option<CardReport>,
    pub error: Option<String>,
}
#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReloadResult {
    pub ui_templates: TemplateResult,
    pub card_plugins: CardResult,
}
fn bounded_message(message: String) -> String {
    if message.chars().count() > 2_000 {
        format!(
            "{}… [truncated]",
            message.chars().take(2_000).collect::<String>()
        )
    } else {
        message
    }
}
impl ReloadResult {
    fn ok(&self) -> bool {
        self.ui_templates.applied
            && self.ui_templates.error.is_none()
            && self.card_plugins.report.is_some()
            && self.card_plugins.error.is_none()
    }
    fn bound_errors(&mut self) {
        for error in [&mut self.ui_templates.error, &mut self.card_plugins.error]
            .into_iter()
            .flatten()
        {
            *error = bounded_message(std::mem::take(error));
        }
    }
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Outcome {
    Completed,
    NotDispatched,
    Unknown,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActionResponse {
    pub ok: bool,
    pub action: Action,
    pub project: Option<PathBuf>,
    pub outcome: Outcome,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub result: Option<ReloadResult>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}
impl ActionResponse {
    fn failure(project: Option<PathBuf>, outcome: Outcome, error: impl Into<String>) -> Self {
        Self {
            ok: false,
            action: Action::ReloadCustomizations,
            project,
            outcome,
            result: None,
            error: Some(bounded_message(error.into())),
        }
    }
}
struct Pending {
    window: String,
    result: oneshot::Sender<ReloadResult>,
}
#[derive(Default)]
pub struct CliActions {
    ready: Mutex<HashSet<String>>,
    pending: Mutex<HashMap<String, Pending>>,
    stopping: AtomicBool,
    #[cfg(unix)]
    endpoint: Mutex<Option<unix::EndpointOwner>>,
}
impl CliActions {
    fn complete(
        &self,
        window: &str,
        request_id: &str,
        mut result: ReloadResult,
    ) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        let owner = pending
            .get(request_id)
            .ok_or("CLI request expired or window closed")?;
        if owner.window != window {
            return Err("CLI request belongs to another window".into());
        }
        result.bound_errors();
        let owner = pending.remove(request_id).unwrap();
        owner
            .result
            .send(result)
            .map_err(|_| "CLI caller is no longer waiting".into())
    }
    pub fn forget_window(&self, label: &str) {
        self.ready.lock().unwrap().remove(label);
        self.pending
            .lock()
            .unwrap()
            .retain(|_, pending| pending.window != label);
    }
    pub fn shutdown(&self) {
        self.stopping.store(true, Ordering::SeqCst);
        self.ready.lock().unwrap().clear();
        self.pending.lock().unwrap().clear();
        #[cfg(unix)]
        self.endpoint.lock().unwrap().take();
    }
}

#[tauri::command]
pub fn cli_action_window_ready(
    window: tauri::Window,
    host: tauri::State<'_, CliActions>,
) -> Result<(), String> {
    if host.stopping.load(Ordering::SeqCst) {
        return Err("Nimrod is shutting down".into());
    }
    if !window
        .app_handle()
        .state::<crate::workspace_windows::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .contains_key(window.label())
    {
        return Err("CLI actions require a project window".into());
    }
    host.ready.lock().unwrap().insert(window.label().into());
    Ok(())
}
#[tauri::command]
pub fn complete_cli_action(
    window: tauri::Window,
    host: tauri::State<'_, CliActions>,
    request_id: String,
    result: ReloadResult,
) -> Result<(), String> {
    host.complete(window.label(), &request_id, result)
}

fn target_label(
    directories: &HashMap<String, PathBuf>,
    project: &std::path::Path,
) -> Result<String, String> {
    let labels: Vec<_> = directories
        .iter()
        .filter(|(_, path)| path.as_path() == project)
        .map(|(label, _)| label.clone())
        .collect();
    match labels.as_slice() {
        [label] => Ok(label.clone()),
        [] => Err("No open Nimrod window for this project".into()),
        _ => {
            Err("More than one Nimrod window claims this project; action was not dispatched".into())
        }
    }
}

async fn dispatch(app: &tauri::AppHandle, request: ActionRequest) -> ActionResponse {
    let failure = |outcome, error: String| {
        ActionResponse::failure(Some(request.project.clone()), outcome, error)
    };
    if request.version != 1 {
        return failure(
            Outcome::NotDispatched,
            "Unsupported CLI control version".into(),
        );
    }
    let project = match request.project.canonicalize() {
        Ok(project) if request.project.is_absolute() && project.is_dir() => project,
        _ => {
            return failure(
                Outcome::NotDispatched,
                "Project must be an existing absolute directory".into(),
            );
        }
    };
    let label = {
        let windows = app.state::<crate::workspace_windows::WorkspaceWindows>();
        let directories = windows.directories.lock().unwrap();
        target_label(&directories, &project)
    };
    let label = match label {
        Ok(label) => label,
        Err(error) => return failure(Outcome::NotDispatched, error),
    };
    let Some(window) = app.get_webview_window(&label) else {
        return failure(Outcome::NotDispatched, "Project window is closing".into());
    };
    let host = app.state::<CliActions>();
    let request_id = uuid::Uuid::new_v4().to_string();
    let (sender, receiver) = oneshot::channel();
    {
        let ready = host.ready.lock().unwrap();
        if host.stopping.load(Ordering::SeqCst) || !ready.contains(&label) {
            return failure(
                Outcome::NotDispatched,
                "Project window is not ready for CLI actions".into(),
            );
        }
        host.pending.lock().unwrap().insert(
            request_id.clone(),
            Pending {
                window: label,
                result: sender,
            },
        );
    }
    let event = match request.action {
        Action::ReloadCustomizations => "nimrod-cli-action",
    };
    if let Err(error) = app.emit_to(
        tauri::EventTarget::webview_window(window.label()),
        event,
        serde_json::json!({ "requestId": request_id }),
    ) {
        host.pending.lock().unwrap().remove(&request_id);
        return failure(
            Outcome::Unknown,
            format!("Could not deliver action: {error}. Do not automatically retry."),
        );
    }
    let response = match tokio::time::timeout(std::time::Duration::from_secs(120), receiver).await {
        Ok(Ok(result)) => ActionResponse { ok: result.ok(), action: request.action, project: Some(project), outcome: Outcome::Completed, result: Some(result), error: None },
        _ => failure(Outcome::Unknown, "No completion received (timeout, shutdown or window closed). The action may have run; do not automatically retry.".into()),
    };
    host.pending.lock().unwrap().remove(&request_id);
    response
}

pub fn start(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(unix)]
    {
        unix::start(app)
    }
    #[cfg(not(unix))]
    {
        let _ = app;
        Ok(())
    }
}

/// Invoked before Context, single-instance election, GTK/AppKit or any app window.
pub fn client(request: ActionRequest, json: bool) -> i32 {
    #[cfg(unix)]
    let response = unix::client(&request);
    #[cfg(not(unix))]
    let response = ActionResponse::failure(
        Some(request.project),
        Outcome::NotDispatched,
        "CLI actions currently support macOS and Linux only",
    );
    if json {
        println!("{}", serde_json::to_string(&response).unwrap());
    } else if let Some(result) = &response.result {
        println!(
            "UI templates: {}",
            if result.ui_templates.applied {
                "reloaded"
            } else {
                "not applied"
            }
        );
        if let Some(report) = &result.card_plugins.report {
            println!(
                "Card plugins: {} personal, {} cached, {} manifest packages",
                report.personal_loaded, report.cache_hits, report.manifest_loaded
            );
        }
        for error in [&result.ui_templates.error, &result.card_plugins.error]
            .into_iter()
            .flatten()
        {
            eprintln!("nimrod: {error}");
        }
    } else {
        eprintln!(
            "nimrod: {}",
            response.error.as_deref().unwrap_or("CLI action failed")
        );
    }
    if response.ok { 0 } else { 1 }
}

#[cfg(test)]
#[path = "cli_actions_tests.rs"]
mod tests;

#[cfg(unix)]
mod unix {
    use super::*;
    use nix::fcntl::{Flock, FlockArg};
    use std::{
        fs::{self, File, OpenOptions},
        os::unix::{
            fs::{DirBuilderExt, MetadataExt, OpenOptionsExt, PermissionsExt},
            net::UnixListener,
        },
        path::Path,
        sync::Arc,
        time::Duration,
    };
    use tokio::{
        io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader},
        net::UnixStream,
    };
    const MAX_REQUEST: u64 = 16 * 1024;
    const MAX_RESPONSE: u64 = 64 * 1024;

    fn root() -> PathBuf {
        // Fixed short path avoids macOS Unix-socket length limits. Per-user private parent.
        let uid = unsafe { nix::libc::geteuid() };
        PathBuf::from(format!("/tmp/nimrod-control-v1-{uid}"))
    }
    fn validate_root(root: &Path) -> Result<(), String> {
        let metadata = fs::symlink_metadata(root)
            .map_err(|error| format!("Nimrod control endpoint is unavailable: {error}"))?;
        let uid = unsafe { nix::libc::geteuid() };
        if !metadata.is_dir() || metadata.uid() != uid || metadata.mode() & 0o077 != 0 {
            return Err(
                "Nimrod control directory must be owned by this user with mode 0700".into(),
            );
        }
        Ok(())
    }
    pub(super) struct EndpointOwner {
        socket: PathBuf,
        _lock: Flock<File>,
    }
    impl Drop for EndpointOwner {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.socket);
        }
    }
    fn bind(root: &Path) -> Result<(UnixListener, EndpointOwner), String> {
        match fs::DirBuilder::new().mode(0o700).create(root) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
        validate_root(root)?;
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .mode(0o600)
            .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_CLOEXEC)
            .open(root.join("owner.lock"))
            .map_err(|error| error.to_string())?;
        let lock = Flock::lock(file, FlockArg::LockExclusiveNonblock)
            .map_err(|(_, error)| format!("Another Nimrod instance owns CLI control: {error}"))?;
        let socket = root.join("control.sock");
        match fs::remove_file(&socket) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
        let listener = UnixListener::bind(&socket).map_err(|error| error.to_string())?;
        let owner = EndpointOwner {
            socket,
            _lock: lock,
        };
        fs::set_permissions(&owner.socket, fs::Permissions::from_mode(0o600))
            .map_err(|error| error.to_string())?;
        listener
            .set_nonblocking(true)
            .map_err(|error| error.to_string())?;
        Ok((listener, owner))
    }
    async fn read_frame<R: AsyncRead + Unpin>(reader: R, max: u64) -> Result<Vec<u8>, String> {
        let mut bytes = Vec::new();
        let mut reader = BufReader::new(reader.take(max + 1));
        reader
            .read_until(b'\n', &mut bytes)
            .await
            .map_err(|error| error.to_string())?;
        if bytes.len() as u64 > max || bytes.last() != Some(&b'\n') {
            return Err("Incomplete or oversized CLI frame".into());
        }
        Ok(bytes)
    }
    async fn write_frame<W: AsyncWrite + Unpin>(
        mut writer: W,
        value: &impl Serialize,
    ) -> Result<(), String> {
        let mut bytes = serde_json::to_vec(value).map_err(|error| error.to_string())?;
        bytes.push(b'\n');
        writer
            .write_all(&bytes)
            .await
            .map_err(|error| error.to_string())
    }
    async fn serve(mut stream: UnixStream, app: tauri::AppHandle) {
        let request =
            tokio::time::timeout(Duration::from_secs(5), read_frame(&mut stream, MAX_REQUEST))
                .await;
        let response = match request {
            Ok(Ok(bytes)) => match serde_json::from_slice::<ActionRequest>(&bytes) {
                Ok(request) => dispatch(&app, request).await,
                Err(error) => ActionResponse::failure(
                    None,
                    Outcome::NotDispatched,
                    format!("Invalid CLI action request: {error}"),
                ),
            },
            _ => ActionResponse::failure(
                None,
                Outcome::NotDispatched,
                "Incomplete, oversized or timed-out CLI request",
            ),
        };
        let _ =
            tokio::time::timeout(Duration::from_secs(5), write_frame(&mut stream, &response)).await;
    }
    pub(super) fn start(app: &tauri::AppHandle) -> Result<(), String> {
        let (listener, owner) = bind(&root())?;
        *app.state::<CliActions>().endpoint.lock().unwrap() = Some(owner);
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let listener = match tokio::net::UnixListener::from_std(listener) {
                Ok(listener) => listener,
                Err(error) => {
                    eprintln!("CLI control: {error}");
                    app.state::<CliActions>().endpoint.lock().unwrap().take();
                    return;
                }
            };
            let permits = Arc::new(tokio::sync::Semaphore::new(8));
            while !app.state::<CliActions>().stopping.load(Ordering::SeqCst) {
                let accepted =
                    tokio::time::timeout(Duration::from_millis(200), listener.accept()).await;
                let (mut stream, _) = match accepted {
                    Ok(Ok(pair)) => pair,
                    Ok(Err(error)) => {
                        eprintln!("CLI control accept: {error}");
                        break;
                    }
                    Err(_) => continue,
                };
                {
                    let Ok(permit) = permits.clone().try_acquire_owned() else {
                        let response = ActionResponse::failure(
                            None,
                            Outcome::NotDispatched,
                            "Nimrod CLI control is busy",
                        );
                        let _ = tokio::time::timeout(
                            Duration::from_millis(100),
                            write_frame(&mut stream, &response),
                        )
                        .await;
                        continue;
                    };
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _permit = permit;
                        serve(stream, app).await;
                    });
                }
            }
            app.state::<CliActions>().endpoint.lock().unwrap().take();
        });
        Ok(())
    }
    async fn exchange(socket: &Path, request: &ActionRequest) -> ActionResponse {
        let failure = |outcome, message: String| {
            ActionResponse::failure(Some(request.project.clone()), outcome, message)
        };
        let mut stream =
            match tokio::time::timeout(Duration::from_secs(3), UnixStream::connect(socket)).await {
                Ok(Ok(stream)) => stream,
                _ => {
                    return failure(
                        Outcome::NotDispatched,
                        "Cannot connect to a running Nimrod instance. No app or window was opened."
                            .into(),
                    );
                }
            };
        let result = tokio::time::timeout(Duration::from_secs(135), async {
            write_frame(&mut stream, request).await?;
            let bytes = read_frame(&mut stream, MAX_RESPONSE).await?;
            serde_json::from_slice::<ActionResponse>(&bytes).map_err(|error| error.to_string())
        })
        .await;
        match result {
            Ok(Ok(response)) => response,
            _ => failure(Outcome::Unknown, "CLI completion was lost or timed out. The action may have run; do not automatically retry.".into()),
        }
    }
    pub(super) fn client(request: &ActionRequest) -> ActionResponse {
        let root = root();
        if let Err(error) = validate_root(&root) {
            return ActionResponse::failure(
                Some(request.project.clone()),
                Outcome::NotDispatched,
                error,
            );
        }
        match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(runtime) => runtime.block_on(exchange(&root.join("control.sock"), request)),
            Err(error) => ActionResponse::failure(
                Some(request.project.clone()),
                Outcome::NotDispatched,
                error.to_string(),
            ),
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        #[test]
        fn endpoint_has_one_owner_and_only_owner_removes_socket() {
            let dir = tempfile::tempdir().unwrap();
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o700)).unwrap();
            let (listener, owner) = bind(dir.path()).unwrap();
            assert!(bind(dir.path()).is_err());
            assert!(dir.path().join("control.sock").exists());
            drop(listener);
            drop(owner);
            assert!(!dir.path().join("control.sock").exists());
            assert!(bind(dir.path()).is_ok());
        }
        #[test]
        fn private_parent_rejects_symlink_and_public_directory() {
            let dir = tempfile::tempdir().unwrap();
            let link = dir.path().join("link");
            std::os::unix::fs::symlink(dir.path(), &link).unwrap();
            assert!(validate_root(&link).is_err());
            fs::set_permissions(dir.path(), fs::Permissions::from_mode(0o755)).unwrap();
            assert!(validate_root(dir.path()).is_err());
        }
        #[tokio::test]
        async fn a_lost_fixture_reply_is_unknown_and_never_replayed() {
            let dir = tempfile::tempdir().unwrap();
            let socket = dir.path().join("lost.sock");
            let listener = tokio::net::UnixListener::bind(&socket).unwrap();
            let task = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let _ = read_frame(&mut stream, MAX_REQUEST).await.unwrap();
                // Dispose the fixture endpoint without acknowledging the completed write.
            });
            let request = ActionRequest {
                version: 1,
                action: Action::ReloadCustomizations,
                project: dir.path().into(),
            };
            let response = exchange(&socket, &request).await;
            assert_eq!(response.outcome, Outcome::Unknown);
            assert!(!response.ok);
            task.await.unwrap();
        }
        #[tokio::test]
        async fn frame_limits_and_completed_reply_are_fixture_only() {
            let (mut client, mut server) = UnixStream::pair().unwrap();
            let task = tokio::spawn(async move {
                server.write_all(b"oversized\n").await.unwrap();
            });
            assert!(read_frame(&mut client, 3).await.is_err());
            task.await.unwrap();
            let dir = tempfile::tempdir().unwrap();
            let socket = dir.path().join("fixture.sock");
            let listener = tokio::net::UnixListener::bind(&socket).unwrap();
            let request = ActionRequest {
                version: 1,
                action: Action::ReloadCustomizations,
                project: dir.path().into(),
            };
            let task = tokio::spawn(async move {
                let (mut stream, _) = listener.accept().await.unwrap();
                let bytes = read_frame(&mut stream, MAX_REQUEST).await.unwrap();
                let received: ActionRequest = serde_json::from_slice(&bytes).unwrap();
                write_frame(
                    &mut stream,
                    &ActionResponse::failure(
                        Some(received.project),
                        Outcome::Completed,
                        "fixture template failure",
                    ),
                )
                .await
                .unwrap();
            });
            let response = exchange(&socket, &request).await;
            assert!(!response.ok);
            assert_eq!(response.outcome, Outcome::Completed);
            task.await.unwrap();
        }
    }
}
