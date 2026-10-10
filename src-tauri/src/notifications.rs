#[cfg(target_os = "linux")]
#[path = "linux_notifications.rs"]
mod linux;
#[cfg(target_os = "macos")]
#[path = "macos_notifications.rs"]
mod macos;

use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "macos", target_os = "linux"))]
use tauri::Emitter;
use tauri::Manager;
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
use tauri_plugin_notification::NotificationExt;

use crate::{ExitState, preferences::Preferences, workspace_windows::WorkspaceWindows};

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AttentionKind {
    Completed,
    Input,
    Failed,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum NotificationDispatch {
    Submitted,
    Suppressed,
}

/// Runtime identities only: no names, paths, prompts or automatic history resume.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct NotificationTarget {
    session: String,
    token: String,
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
#[derive(Deserialize, Serialize)]
struct ClickRoute {
    event: String,
    process: String,
    window: String,
    target: NotificationTarget,
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn process_identity() -> &'static str {
    static ID: std::sync::OnceLock<String> = std::sync::OnceLock::new();
    ID.get_or_init(|| uuid::Uuid::new_v4().to_string())
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn click_identifier(window: &str, target: NotificationTarget) -> String {
    serde_json::to_string(&ClickRoute {
        event: uuid::Uuid::new_v4().to_string(),
        process: process_identity().into(),
        window: window.into(),
        target,
    })
    .expect("notification routing consists only of strings")
}

#[cfg(any(target_os = "macos", target_os = "linux", test))]
fn click_route(identifier: &str) -> Option<ClickRoute> {
    let route: ClickRoute = serde_json::from_str(identifier).ok()?;
    (route.process == process_identity()).then_some(route)
}

/// Do not focus here: the owning frontend must reject closed/restarted targets first.
#[cfg(any(target_os = "macos", target_os = "linux"))]
fn clicked(app: &tauri::AppHandle, identifier: &str) {
    let Some(route) = click_route(identifier) else {
        return;
    };
    if app
        .state::<ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return;
    }
    if let Some(window) = app.get_webview_window(&route.window) {
        let _ = app.emit_to(
            tauri::EventTarget::webview_window(window.label()),
            "nimrod-notification-click",
            route.target,
        );
    }
}

/// Called only after frontend runtime-identity validation; never starts a child.
#[tauri::command]
pub async fn focus_notification_window(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    project(&app, &window)?;
    if app
        .state::<ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Ok(());
    }
    if let Some(window) = app.get_webview_window(window.label()) {
        crate::workspace_windows::focus_window(&app, &window)?;
    }
    Ok(())
}

fn label(text: &str) -> String {
    text.chars()
        .filter(|c| !c.is_control() && !matches!(c, '\u{2028}' | '\u{2029}' | '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}'))
        .take(100)
        .collect()
}

fn title(project: &str, session: &str) -> String {
    format!("{project} · {session}")
}

fn body(kind: AttentionKind, preview: Option<&str>) -> String {
    if matches!(kind, AttentionKind::Completed) {
        let clean: String = preview
            .unwrap_or_default()
            .chars()
            .take(16_384)
            .filter(|c| {
                (!c.is_control() || c.is_whitespace())
                    && !matches!(c, '\u{202a}'..='\u{202e}' | '\u{2066}'..='\u{2069}')
            })
            .collect();
        let clean = clean.split_whitespace().collect::<Vec<_>>().join(" ");
        let mut characters: Vec<_> = clean.chars().take(1001).collect();
        if characters.len() > 1000 {
            characters.truncate(999);
            characters.push('…');
        }
        if !characters.is_empty() {
            return characters.into_iter().collect();
        }
    }
    match kind {
        AttentionKind::Completed => "Agent finished.",
        AttentionKind::Input => "Agent needs your input.",
        AttentionKind::Failed => "Session failed. Check Nimrod for details.",
    }
    .into()
}

fn project(app: &tauri::AppHandle, window: &tauri::Window) -> Result<String, String> {
    app.state::<WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .map(|path| {
            path.file_name()
                .map(|name| label(&name.to_string_lossy()))
                .unwrap_or_else(|| "Project".into())
        })
        .ok_or_else(|| "Open a project window to send notifications".into())
}

fn suppressed(
    app: &tauri::AppHandle,
    window: &tauri::Window,
    selected: bool,
) -> Result<bool, String> {
    Ok(app
        .state::<ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
        || !app.state::<Preferences>().notifications_enabled()
        || app.get_webview_window(window.label()).is_none()
        || (selected && window.is_focused().map_err(|e| e.to_string())?))
}

pub fn initialize(app: &tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    macos::initialize(app)?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    Ok(())
}

/// Native policy and foreground-handler observation only. No alert/permission request.
#[tauri::command]
pub async fn notification_diagnostics(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<String, String> {
    project(&app, &window)?;
    #[cfg(target_os = "macos")]
    {
        macos::diagnostics(&app).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        Ok("Detailed OS notification diagnostics are currently available only on macOS.".into())
    }
}

/// Permission preparation is separate so the shell can revalidate the originating
/// session after an OS prompt, before dispatching anything.
#[tauri::command]
pub async fn prepare_notifications(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<(), String> {
    project(&app, &window)?;
    if suppressed(&app, &window, false)? {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    macos::prepare(&app).await?;
    Ok(())
}

async fn dispatch(
    app: &tauri::AppHandle,
    window: tauri::Window,
    selected: bool,
    title: String,
    body: String,
    target: Option<NotificationTarget>,
) -> Result<NotificationDispatch, String> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let identifier = target.map(|target| click_identifier(window.label(), target));
    #[cfg(target_os = "macos")]
    {
        macos::send(app, window, selected, title, body, identifier).await
    }
    #[cfg(target_os = "linux")]
    {
        linux::send(app, window, selected, title, body, identifier).await
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        if suppressed(app, &window, selected)? {
            return Ok(NotificationDispatch::Suppressed);
        }
        let _ = target; // Windows click routing remains unsupported.
        app.notification()
            .builder()
            .title(title)
            .body(body)
            .show()
            .map_err(|e| e.to_string())?;
        Ok(NotificationDispatch::Submitted)
    }
}

/// User-triggered diagnostic: same authorization/dispatch path, explicitly allowed
/// while this project window is focused. No process/model request or session data.
#[tauri::command]
pub async fn test_notification(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<NotificationDispatch, String> {
    let project = project(&app, &window)?;
    prepare_notifications(app.clone(), window.clone()).await?;
    dispatch(
        &app,
        window,
        false,
        title(&project, "Notification test"),
        "This is a test notification from Nimrod.".into(),
        None,
    )
    .await
}

/// Project-scoped alerts, with response previews and exact runtime click targets.
#[tauri::command]
pub async fn notify_session(
    app: tauri::AppHandle,
    window: tauri::Window,
    kind: AttentionKind,
    session: String,
    selected: bool,
    preview: Option<String>,
    target: NotificationTarget,
) -> Result<NotificationDispatch, String> {
    let project = project(&app, &window)?;
    if suppressed(&app, &window, selected)? {
        return Ok(NotificationDispatch::Suppressed);
    }
    let session = label(&session);
    dispatch(
        &app,
        window,
        selected,
        title(&project, &session),
        body(kind, preview.as_deref()),
        Some(target),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn click_routes_are_exact_unique_and_process_local() {
        let target = NotificationTarget {
            session: "runtime-session".into(),
            token: "launch-token".into(),
        };
        let id = click_identifier("project-window", target.clone());
        let route = click_route(&id).unwrap();
        assert_eq!(route.window, "project-window");
        assert_eq!(route.target, target);
        assert_ne!(id, click_identifier("project-window", target));
        assert!(click_route("test-notification-with-no-target").is_none());
        let mut retired: serde_json::Value = serde_json::from_str(&id).unwrap();
        retired["process"] = "previous-process".into();
        assert!(click_route(&retired.to_string()).is_none());
    }

    #[test]
    fn bounded_labels_and_fixed_bodies() {
        assert_eq!(title("project", "Session"), "project · Session");
        assert_eq!(label("name\n\0\u{202e}text"), "nametext");
        assert_eq!(label(&"界".repeat(200)).chars().count(), 100);
        assert_eq!(body(AttentionKind::Completed, None), "Agent finished.");
        assert_eq!(body(AttentionKind::Input, None), "Agent needs your input.");
        assert_eq!(
            body(AttentionKind::Failed, None),
            "Session failed. Check Nimrod for details."
        );
        assert!(serde_json::from_str::<AttentionKind>("\"unknown\"").is_err());
    }

    #[test]
    fn completed_response_preview_is_bounded_and_other_alerts_stay_generic() {
        assert_eq!(
            body(AttentionKind::Completed, Some(" Done.\n\tTests passed. ")),
            "Done. Tests passed."
        );
        assert_eq!(
            body(AttentionKind::Completed, Some("\0\u{202e} \n")),
            "Agent finished."
        );
        let preview = body(AttentionKind::Completed, Some(&"界".repeat(1200)));
        assert_eq!(preview.chars().count(), 1000);
        assert!(preview.ends_with('…'));
        assert_eq!(
            body(AttentionKind::Input, Some("private dialog")),
            "Agent needs your input."
        );
        assert_eq!(
            body(AttentionKind::Failed, Some("private error")),
            "Session failed. Check Nimrod for details."
        );
    }
}
