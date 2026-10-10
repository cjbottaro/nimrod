//! Freedesktop default-action routing. No plugin fire-and-forget delivery.
//! No OS interaction in tests; native desktop acceptance is still required.
use super::NotificationDispatch;

pub async fn send(
    app: &tauri::AppHandle,
    window: tauri::Window,
    selected: bool,
    title: String,
    body: String,
    identifier: Option<String>,
) -> Result<NotificationDispatch, String> {
    if super::suppressed(app, &window, selected)? {
        return Ok(NotificationDispatch::Suppressed);
    }
    let mut notification = notify_rust::Notification::new();
    // Desktop services may interpret markup. Always display literal response text.
    let body = body
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;");
    notification
        .appname("Nimrod")
        .summary(&title)
        .body(&body)
        .auto_icon();
    if identifier.is_some() {
        notification.action("default", "Open session");
    }
    let handle = notification.show_async().await.map_err(|e| e.to_string())?;
    if let Some(identifier) = identifier {
        let app = app.clone();
        // Async waiter, not a blocked worker per alert. Ends on action/closure or
        // service disconnect; remaining waiters end with the application runtime.
        tauri::async_runtime::spawn(async move {
            handle
                .wait_for_action_async(|action| {
                    if matches!(action, notify_rust::ActionResponse::Custom("default")) {
                        super::clicked(&app, &identifier);
                    }
                })
                .await;
        });
    }
    Ok(NotificationDispatch::Submitted)
}
