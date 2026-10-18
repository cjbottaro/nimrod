//! Native session-row popup presentation only. The owning frontend revalidates
//! the captured target and dispatches the existing session actions.
use std::{collections::HashMap, sync::Mutex};
use tauri::{
    menu::{ContextMenu, Menu, MenuItem, PredefinedMenuItem},
    Emitter, Manager,
};

#[derive(Default)]
pub struct SessionMenus(Mutex<HashMap<String, Menu<tauri::Wry>>>);

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMenuOptions {
    pin_label: String,
    pin_enabled: bool,
    close_enabled: bool,
    delete_label: String,
    delete_enabled: bool,
    x: f64,
    y: f64,
}

const PREFIX: &str = "nimrod.session-menu:";

fn item_id(window: &str, request: &str, action: &str) -> String {
    format!("{PREFIX}{}", serde_json::json!([window, request, action]))
}

#[tauri::command]
pub fn popup_session_menu(
    window: tauri::Window,
    menus: tauri::State<'_, SessionMenus>,
    request: String,
    options: SessionMenuOptions,
) -> Result<(), String> {
    if !(window.label() == "main" || window.label().starts_with("workspace-"))
        || request.len() > 80
        || request.is_empty()
        || !request.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        || !options.x.is_finite()
        || !options.y.is_finite()
        || !["Pin session", "Unpin session"].contains(&options.pin_label.as_str())
        || !["Delete session…", "Delete session tree…"].contains(&options.delete_label.as_str())
    {
        return Err("Invalid session menu request".into());
    }
    let build = || -> tauri::Result<Menu<tauri::Wry>> {
        let pin = MenuItem::with_id(
            &window,
            item_id(window.label(), &request, "pin"),
            &options.pin_label,
            options.pin_enabled,
            None::<&str>,
        )?;
        let close = MenuItem::with_id(
            &window,
            item_id(window.label(), &request, "close"),
            "Close session",
            options.close_enabled,
            None::<&str>,
        )?;
        let remove = MenuItem::with_id(
            &window,
            item_id(window.label(), &request, "delete"),
            &options.delete_label,
            options.delete_enabled,
            None::<&str>,
        )?;
        Menu::with_items(
            &window,
            &[&pin, &close, &PredefinedMenuItem::separator(&window)?, &remove],
        )
    };
    let menu = build().map_err(|error| error.to_string())?;
    // Linux popup completion is not a dismissal signal. Keep the menu alive
    // until replacement/window destruction, without a per-popup resource cache.
    menus.0.lock().unwrap().insert(window.label().into(), menu.clone());
    menu.popup_at(window, tauri::PhysicalPosition::new(options.x, options.y))
        .map_err(|error| error.to_string())
}

fn decode(id: &str) -> Option<[String; 3]> {
    let parts: [String; 3] = serde_json::from_str(id.strip_prefix(PREFIX)?).ok()?;
    if !["pin", "close", "delete"].contains(&parts[2].as_str()) {
        return None;
    }
    Some(parts)
}

pub fn dispatch(app: &tauri::AppHandle, id: &str) {
    let Some([window, request, action]) = decode(id) else {
        return;
    };
    let _ = app.emit_to(
        tauri::EventTarget::webview_window(window),
        "nimrod-session-menu",
        serde_json::json!({ "request": request, "action": action }),
    );
}

pub fn forget(window: &tauri::Window) {
    window
        .app_handle()
        .state::<SessionMenus>()
        .0
        .lock()
        .unwrap()
        .remove(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn delayed_actions_keep_their_exact_window_and_popup_request() {
        let id = item_id("workspace-one", "old-request", "delete");
        assert_eq!(
            decode(&id),
            Some(["workspace-one".into(), "old-request".into(), "delete".into()])
        );
        assert_ne!(id, item_id("workspace-two", "old-request", "delete"));
        assert_ne!(id, item_id("workspace-one", "new-request", "delete"));
        assert_eq!(decode("nimrod.quit"), None);
        assert_eq!(decode(&item_id("main", "request", "reload")), None);
    }
}
