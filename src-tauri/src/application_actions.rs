//! Narrow, caller-window-bound replacements for Linux app-menu actions.
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[derive(serde::Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ApplicationAction {
    OpenProject,
    Quit,
    MinimizeWindow,
    ToggleMaximizeWindow,
    CloseWindow,
    About,
}

#[tauri::command]
pub fn application_action(
    window: tauri::WebviewWindow,
    action: ApplicationAction,
) -> Result<(), String> {
    let app = window.app_handle();
    match action {
        ApplicationAction::OpenProject => crate::native_menu::open_project_in(&window),
        ApplicationAction::Quit => crate::request_exit(app),
        ApplicationAction::MinimizeWindow => window.minimize().map_err(|error| error.to_string())?,
        ApplicationAction::ToggleMaximizeWindow => {
            if window.is_maximized().map_err(|error| error.to_string())? {
                window.unmaximize().map_err(|error| error.to_string())?;
            } else {
                window.maximize().map_err(|error| error.to_string())?;
            }
        }
        ApplicationAction::CloseWindow => window.close().map_err(|error| error.to_string())?,
        ApplicationAction::About => {
            app.dialog()
                .message(format!(
                    "Nimrod {}\n\nLicense: {}",
                    app.package_info().version,
                    env!("CARGO_PKG_LICENSE")
                ))
                .title("About Nimrod")
                .parent(&window)
                .show(|_| {});
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_the_explicit_application_actions_decode() {
        for action in [
            "open-project",
            "quit",
            "minimize-window",
            "toggle-maximize-window",
            "close-window",
            "about",
        ] {
            assert!(serde_json::from_value::<ApplicationAction>(serde_json::json!(action)).is_ok());
        }
        for action in ["exit", "kill", "close-session", "unknown"] {
            assert!(serde_json::from_value::<ApplicationAction>(serde_json::json!(action)).is_err());
        }
    }
}
