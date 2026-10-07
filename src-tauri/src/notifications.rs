#[cfg(target_os = "macos")]
#[path = "macos_notifications.rs"]
mod macos;

use serde::{Deserialize, Serialize};
use tauri::Manager;
#[cfg(not(target_os = "macos"))]
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
) -> Result<NotificationDispatch, String> {
    #[cfg(target_os = "macos")]
    {
        macos::send(app, window, selected, title, body).await
    }
    #[cfg(not(target_os = "macos"))]
    {
        if suppressed(app, &window, selected)? {
            return Ok(NotificationDispatch::Suppressed);
        }
        // Desktop Linux services may interpret body markup; keep response text literal.
        #[cfg(target_os = "linux")]
        let body = body
            .replace('&', "&amp;")
            .replace('<', "&lt;")
            .replace('>', "&gt;");
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
    )
    .await
}

/// Project-scoped alerts, with assistant-text previews for completion only. No actions/launches.
#[tauri::command]
pub async fn notify_session(
    app: tauri::AppHandle,
    window: tauri::Window,
    kind: AttentionKind,
    session: String,
    selected: bool,
    preview: Option<String>,
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
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

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
