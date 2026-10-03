//! Keep Tauri's native menus, but make macOS Quit an app-owned action.
//! The predefined Quit item invokes NSApplication terminate: directly; it does
//! not pass through the cancellable ExitRequested save/child-shutdown boundary.
pub const QUIT_ID: &str = "nimrod.quit";

pub fn is_quit(id: &str) -> bool {
    id == QUIT_ID
}

#[cfg(target_os = "macos")]
pub fn install(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, MenuItemKind, PredefinedMenuItem};
    let menu = Menu::default(app)?;
    let quit_text = PredefinedMenuItem::quit(app, None)?.text()?;
    let quit = MenuItem::with_id(app, QUIT_ID, &quit_text, true, Some("CmdOrCtrl+Q"))?;
    let mut replaced = 0;
    // The macOS default contains Quit in the application submenu. Preserve all
    // other entries (Edit, Services, Hide, Window, etc.) and their native actions.
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item {
            for (index, item) in submenu.items()?.into_iter().enumerate() {
                if let MenuItemKind::Predefined(item) = item {
                    if item.text()? == quit_text {
                        submenu.remove(&item)?;
                        submenu.insert(&quit, index)?;
                        replaced += 1;
                    }
                }
            }
        }
    }
    if replaced != 1 {
        return Err(tauri::Error::Io(std::io::Error::other(
            "Expected exactly one macOS Quit item in Tauri's default menu",
        )));
    }
    app.set_menu(menu)?;
    Ok(())
}

#[cfg(not(target_os = "macos"))]
pub fn install(_app: &tauri::AppHandle) -> tauri::Result<()> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_the_app_owned_quit_action_requests_shutdown() {
        assert!(is_quit(QUIT_ID));
        assert!(!is_quit("quit"));
        assert!(!is_quit("nimrod.close-session"));
    }
}
