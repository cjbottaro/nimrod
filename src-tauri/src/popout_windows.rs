//! Automatic pop-out visibility must not activate a reference window. Explicit
//! Pop out clicks retain the ordinary show/unminimize/set_focus path in popouts.rs.

fn needs_show(visible: bool, minimized: bool) -> bool {
    !visible && !minimized
}

#[cfg(target_os = "macos")]
pub async fn show_restored(window: &tauri::WebviewWindow) -> Result<(), String> {
    let target = window.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let pointer = target.ns_window().map_err(|e| e.to_string())?;
                if pointer.is_null() {
                    return Err("Pop-out native window is unavailable".into());
                }
                // SAFETY: Tauri supplies the NSWindow for this retained window handle.
                // Resolve and use it only inside the application's main-thread callback.
                let native = unsafe { &*pointer.cast::<objc2_app_kit::NSWindow>() };
                if needs_show(native.isVisible(), native.isMiniaturized()) {
                    // Tauri/Tao's show() calls makeKeyAndOrderFront on macOS. orderFront
                    // changes visibility/z-order without changing the keyboard target.
                    native.orderFront(None);
                }
                Ok(())
            })();
            let _ = send.send(result);
        })
        .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "Pop-out visibility callback was canceled".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn show_restored(window: &tauri::WebviewWindow) -> Result<(), String> {
    // Preserve the existing platform API, but never re-show an already visible or
    // minimized window. Native Windows/Linux focus acceptance remains separate.
    if needs_show(
        window.is_visible().map_err(|e| e.to_string())?,
        window.is_minimized().map_err(|e| e.to_string())?,
    ) {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn passive_visibility_does_not_reshow_visible_or_minimized_popouts() {
        assert!(needs_show(false, false));
        assert!(!needs_show(true, false));
        assert!(!needs_show(false, true));
        assert!(!needs_show(true, true));
    }
    #[test]
    fn automatic_restore_and_explicit_open_have_separate_focus_paths() {
        let source = include_str!("popouts.rs");
        let automatic = source
            .split("pub async fn sync_popout_sessions")
            .nth(1)
            .unwrap()
            .split("pub async fn open_code_popout")
            .next()
            .unwrap();
        assert!(automatic.contains("popout_windows::show_restored"));
        assert!(!automatic.contains("window.show()"));
        assert!(!automatic.contains("set_focus()"));
        let explicit = source
            .split("pub async fn open_code_popout")
            .nth(1)
            .unwrap()
            .split("pub fn notify_error")
            .next()
            .unwrap();
        assert!(explicit.contains("popout.show()"));
        assert!(explicit.contains("popout.set_focus()"));
    }
}
