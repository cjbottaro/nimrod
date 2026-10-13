//! A single app-owned Settings window; no project, sessions or child processes.
use tauri::Manager;

pub const LABEL: &str = "settings";

#[derive(Default)]
pub struct SettingsWindow {
    creation: std::sync::Mutex<()>,
    projects: std::sync::Mutex<std::collections::HashSet<String>>,
    keybindings_requested: std::sync::Mutex<bool>,
}

pub fn open(app: &tauri::AppHandle, category: Option<&str>) -> Result<(), String> {
    if app
        .state::<crate::ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    let state = app.state::<SettingsWindow>();
    let _guard = state.creation.lock().unwrap();
    let category = if category == Some("keybindings") {
        "keybindings"
    } else {
        "appearance"
    };
    if category == "keybindings" {
        *state.keybindings_requested.lock().unwrap() = true;
    }
    if let Some(window) = app.get_webview_window(LABEL) {
        crate::workspace_windows::focus_window(app, &window)?;
        if category == "keybindings" {
            use tauri::Emitter;
            window
                .emit("nimrod-settings-category", category)
                .map_err(|error| error.to_string())?;
        }
        return Ok(());
    }
    // A failed/closed earlier window must not leave a stale category request.
    *state.keybindings_requested.lock().unwrap() = category == "keybindings";
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App(format!("index.html?settings={category}").into()),
    );
    let window = crate::webview_navigation::guard(builder, app, LABEL)
        .title("Nimrod Settings")
        .inner_size(880.0, 700.0)
        .min_inner_size(560.0, 420.0)
        .build()
        .map_err(|error| error.to_string())?;
    crate::workspace_windows::focus_window(app, &window)
}

pub fn open_project(app: &tauri::AppHandle, label: &str) -> Result<(), String> {
    use tauri::Emitter;
    let window = app
        .get_webview_window(label)
        .ok_or("Project window is no longer open")?;
    app.state::<SettingsWindow>()
        .projects
        .lock()
        .unwrap()
        .insert(label.into());
    crate::workspace_windows::focus_window(app, &window)?;
    window
        .emit("nimrod-project-settings", ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_owned_project_settings(
    app: tauri::AppHandle,
    cwd: std::path::PathBuf,
) -> Result<(), String> {
    let label = app
        .state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .iter()
        .find(|(_, path)| **path == cwd)
        .map(|(label, _)| label.clone())
        .ok_or("Project window is no longer open")?;
    open_project(&app, &label)
}

#[tauri::command]
pub fn take_project_settings_request(app: tauri::AppHandle, window: tauri::Window) -> bool {
    app.state::<SettingsWindow>()
        .projects
        .lock()
        .unwrap()
        .remove(window.label())
}

#[tauri::command]
pub fn take_settings_category(app: tauri::AppHandle, window: tauri::Window) -> bool {
    if window.label() != LABEL {
        return false;
    }
    let state = app.state::<SettingsWindow>();
    std::mem::take(&mut *state.keybindings_requested.lock().unwrap())
}

#[tauri::command]
pub fn open_global_settings(app: tauri::AppHandle, category: Option<String>) -> Result<(), String> {
    open(&app, category.as_deref())
}
