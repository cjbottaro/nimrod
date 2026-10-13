//! A single app-owned Settings window; no project, sessions or child processes.
use tauri::Manager;

pub const LABEL: &str = "settings";

#[derive(Default)]
pub struct SettingsWindow {
    creation: std::sync::Mutex<()>,
    projects: std::sync::Mutex<std::collections::HashSet<String>>,
    keybindings_requested: std::sync::Mutex<bool>,
    presentation: crate::window_presentation::PreparationGate,
}

pub fn is_ready(app: &tauri::AppHandle) -> bool {
    app.state::<SettingsWindow>().presentation.ready()
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
        if state.presentation.ready() {
            crate::window_presentation::focus(app, &window)?;
        }
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
    let generation = state.presentation.begin();
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        LABEL,
        tauri::WebviewUrl::App(
            format!("index.html?settings={category}&settingsGeneration={generation}").into(),
        ),
    );
    crate::window_presentation::prepare(builder, app, LABEL)
        .visible(false)
        .focused(false)
        .title("Nimrod Settings")
        .inner_size(880.0, 700.0)
        .min_inner_size(560.0, 420.0)
        .build()
        .map_err(|error| error.to_string())?;
    Ok(())
}

/// Only the freshly mounted global Settings frontend can complete first reveal.
/// Repeated calls never refocus; ordinary opens focus an already-ready window.
#[tauri::command]
pub fn settings_window_ready(
    app: tauri::AppHandle,
    window: tauri::WebviewWindow,
    generation: String,
) -> Result<(), String> {
    if window.label() != LABEL {
        return Err("Only the Settings window can finish Settings startup".into());
    }
    if app
        .state::<crate::ExitState>()
        .closing
        .load(std::sync::atomic::Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    let state = app.state::<SettingsWindow>();
    let _guard = state.creation.lock().unwrap();
    if !accept_ready(&state, &generation)? {
        return Ok(());
    }
    crate::window_presentation::focus(&app, &window)
}

fn accept_ready(state: &SettingsWindow, generation: &str) -> Result<bool, String> {
    state
        .presentation
        .accept(generation)
        .map_err(|error| format!("Settings {error}"))
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
    crate::window_presentation::focus(app, &window)?;
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

#[cfg(test)]
mod tests {
    #[test]
    fn new_settings_is_hidden_until_its_own_frontend_ready_signal() {
        let source = include_str!("settings_window.rs");
        let implementation = source.split("#[cfg(test)]").next().unwrap();
        assert!(implementation.contains(".visible(false)"));
        assert!(implementation.contains(".focused(false)"));
        assert!(implementation.contains("settingsGeneration={generation}"));
        assert!(implementation.contains("window.label() != LABEL"));
    }
}
