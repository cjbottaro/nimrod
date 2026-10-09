//! Project navigation lives in the native File menu. Keep native editing/window
//! actions, but route macOS Quit through observed owned-child shutdown.
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

pub const QUIT_ID: &str = "nimrod.quit";
pub const OPEN_PROJECT_ID: &str = "nimrod.open-project";
pub const MINIMIZE_ID: &str = "nimrod.minimize";
pub const CLOSE_WINDOW_ID: &str = "nimrod.close-window";

pub fn is_quit(id: &str) -> bool {
    id == QUIT_ID
}
pub fn is_open_project(id: &str) -> bool {
    id == OPEN_PROJECT_ID
}

pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
    let menu = Menu::default(app)?;
    let open = MenuItem::with_id(
        app,
        OPEN_PROJECT_ID,
        "Open project…",
        true,
        Some("CmdOrCtrl+O"),
    )?;
    let mut inserted = false;
    #[cfg(target_os = "macos")]
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    let minimize_text = PredefinedMenuItem::minimize(app, None)?.text()?;
    let minimize = MenuItem::with_id(app, MINIMIZE_ID, &minimize_text, true, None::<&str>)?;
    let close_text = PredefinedMenuItem::close_window(app, None)?.text()?;
    let close = MenuItem::with_id(app, CLOSE_WINDOW_ID, &close_text, true, None::<&str>)?;
    #[cfg(target_os = "macos")]
    let quit = MenuItem::with_id(app, QUIT_ID, &quit_text, true, Some("CmdOrCtrl+Q"))?;
    #[cfg(target_os = "macos")]
    let mut replaced = 0;
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            if submenu.text()? == "File" {
                submenu.insert_items(&[&open, &PredefinedMenuItem::separator(app)?], 0)?;
                inserted = true;
            }
            for (index, item) in submenu.items()?.into_iter().enumerate() {
                if let MenuItemKind::Predefined(item) = item {
                    // Keep Minimize in the menu, but free Cmd-M for Select model.
                    // Custom items without accelerators keep native menus from
                    // consuming keys before the webview applies user overrides.
                    if item.text()? == minimize_text {
                        submenu.remove(&item)?;
                        submenu.insert(&minimize, index)?;
                    }
                    // Cmd-W belongs to the configurable Close session action.
                    if item.text()? == close_text {
                        submenu.remove(&item)?;
                        submenu.insert(&close, index)?;
                    }
                    // The predefined macOS Quit bypasses cancellable shutdown.
                    #[cfg(target_os = "macos")]
                    if item.text()? == quit_text {
                        submenu.remove(&item)?;
                        submenu.insert(&quit, index)?;
                        replaced += 1;
                    }
                }
            }
        }
    }
    if !inserted {
        // Tauri's Linux default has no File submenu.
        menu.insert(&Submenu::with_items(app, "File", true, &[&open])?, 0)?;
    }
    #[cfg(target_os = "macos")]
    if replaced != 1 {
        return Err(tauri::Error::Io(std::io::Error::other(
            "Expected exactly one macOS Quit item in Tauri's default menu",
        )));
    }
    app.set_menu(menu)?;
    Ok(())
}

pub fn open_project(app: &tauri::AppHandle) {
    let mut dialog = app.dialog().file().set_title("Open project directory");
    if let Some(window) = app
        .webview_windows()
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
    {
        dialog = dialog.set_parent(window);
    }
    let app = app.clone();
    dialog.pick_folder(move |path| {
        let Some(path) = path else { return };
        match path.into_path() {
            Ok(path) => {
                // App-level navigation, including when a reference window is focused.
                // Reuse the ordered router; never launch/resume a session here.
                app.state::<crate::cli::CliRequests>()
                    .enqueue(&app, crate::cli::Request::Workspace(path));
            }
            Err(error) => crate::cli::report(&app, error.to_string()),
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_app_owned_quit_action_requests_shutdown() {
        assert!(is_quit(QUIT_ID));
        assert!(!is_quit("quit"));
        assert!(!is_quit("nimrod.close-session"));
        assert!(!is_quit(OPEN_PROJECT_ID));
    }
    #[test]
    fn project_navigation_has_a_distinct_native_action() {
        assert!(is_open_project(OPEN_PROJECT_ID));
        assert!(!is_open_project(QUIT_ID));
        assert!(!is_open_project("nimrod.restart-session"));
    }
}
