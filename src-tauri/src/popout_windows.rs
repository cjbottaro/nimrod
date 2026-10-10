//! Pop-outs are auxiliary references, not peers in macOS native window cycling.
//! Automatic visibility must not activate a reference window; explicit Pop out
//! clicks retain the ordinary show/unminimize/set_focus path in popouts.rs.

fn needs_show(visible: bool, minimized: bool) -> bool {
    !visible && !minimized
}

#[cfg(target_os = "macos")]
fn reference_collection_behavior(
    mut current: objc2_app_kit::NSWindowCollectionBehavior,
) -> objc2_app_kit::NSWindowCollectionBehavior {
    use objc2_app_kit::NSWindowCollectionBehavior;
    current.remove(NSWindowCollectionBehavior::ParticipatesInCycle);
    current.insert(NSWindowCollectionBehavior::IgnoresCycle);
    current
}

/// Apply before a new/restored pop-out can be shown. This changes only native
/// cycle eligibility, not focusability, window type, level, or Spaces behavior.
#[cfg(target_os = "macos")]
pub async fn configure_reference(window: &tauri::WebviewWindow) -> Result<(), String> {
    let target = window.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                let pointer = target.ns_window().map_err(|e| e.to_string())?;
                if pointer.is_null() {
                    return Err("Pop-out native window is unavailable".into());
                }
                // SAFETY: Tauri supplies the NSWindow for this retained handle. Resolve
                // and use the pointer only within the application's main-thread callback.
                let native = unsafe { &*pointer.cast::<objc2_app_kit::NSWindow>() };
                native.setCollectionBehavior(reference_collection_behavior(
                    native.collectionBehavior(),
                ));
                Ok(())
            })();
            let _ = send.send(result);
        })
        .map_err(|e| e.to_string())?;
    receive
        .await
        .map_err(|_| "Pop-out configuration callback was canceled".to_string())?
}

#[cfg(not(target_os = "macos"))]
pub async fn configure_reference(_window: &tauri::WebviewWindow) -> Result<(), String> {
    // Other desktops have different native cycling conventions. Keep their
    // current behavior rather than inventing a global keyboard interception.
    Ok(())
}

#[cfg(target_os = "macos")]
pub async fn show_restored(
    window: &tauri::WebviewWindow,
    still_visible: impl FnOnce() -> bool + Send + 'static,
) -> Result<(), String> {
    let target = window.clone();
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let result = (|| {
                // Focus/session selection may change while this callback is queued.
                if !still_visible() {
                    return Ok(());
                }
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
pub async fn show_restored(
    window: &tauri::WebviewWindow,
    still_visible: impl FnOnce() -> bool + Send + 'static,
) -> Result<(), String> {
    // Preserve the existing platform API, but never re-show an already visible or
    // minimized window. Native Windows/Linux focus acceptance remains separate.
    if still_visible()
        && needs_show(
            window.is_visible().map_err(|e| e.to_string())?,
            window.is_minimized().map_err(|e| e.to_string())?,
        )
    {
        window.show().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(target_os = "macos")]
    #[test]
    fn reference_windows_ignore_cycle_and_preserve_unrelated_collection_flags() {
        use objc2_app_kit::NSWindowCollectionBehavior as Behavior;
        let unrelated =
            Behavior::Managed | Behavior::CanJoinAllSpaces | Behavior::FullScreenAuxiliary;
        let current = unrelated | Behavior::ParticipatesInCycle;
        let configured = reference_collection_behavior(current);
        assert!(configured.contains(Behavior::IgnoresCycle));
        assert!(!configured.contains(Behavior::ParticipatesInCycle));
        assert_eq!(configured & !Behavior::IgnoresCycle, unrelated);
    }
    #[cfg(target_os = "macos")]
    #[test]
    fn reference_cycle_configuration_is_idempotent_and_handles_default_behavior() {
        use objc2_app_kit::NSWindowCollectionBehavior as Behavior;
        assert_eq!(
            reference_collection_behavior(Behavior::empty()),
            Behavior::IgnoresCycle
        );
        let configured = Behavior::Stationary | Behavior::IgnoresCycle;
        assert_eq!(reference_collection_behavior(configured), configured);
    }
    #[test]
    fn all_new_and_restored_popouts_are_configured_while_hidden_and_remain_focusable() {
        let source = include_str!("popouts.rs");
        let creation = source
            .split("async fn create_window")
            .nth(1)
            .unwrap()
            .split("fn save_geometry")
            .next()
            .unwrap();
        assert!(creation.contains(".visible(false)"));
        assert!(creation.contains(".focused(false)"));
        assert!(!creation.contains("focusable(false)"));
        assert!(
            creation.find("configure_reference(&window).await").unwrap()
                < creation.find("window_state::restore_geometry").unwrap()
        );
    }
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
