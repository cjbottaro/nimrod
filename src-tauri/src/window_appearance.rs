//! Transparent native backings; CSS owns palette tint and surface coverage.
//! Linux blur is compositor-owned. No native effect or parity claim on Windows.
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    platform: &'static str,
    transparency: bool,
    frost: bool,
    reduced_transparency: bool,
}

fn capabilities() -> Capabilities {
    #[cfg(target_os = "macos")]
    let reduced_transparency =
        objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency();
    #[cfg(not(target_os = "macos"))]
    let reduced_transparency = false;
    Capabilities {
        platform: std::env::consts::OS,
        transparency: cfg!(any(target_os = "macos", target_os = "linux")),
        frost: cfg!(target_os = "macos"),
        reduced_transparency,
    }
}

pub fn prepare<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    // Keep windows transparency-capable from creation; opaque CSS is the default.
    // No recreation, focus changes or geometry mutation when preferences change.
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let builder = builder.transparent(true);
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent);
    builder
}

#[tauri::command]
pub async fn window_appearance_capabilities(
    window: tauri::WebviewWindow,
) -> Result<Capabilities, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = send.send(capabilities());
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn apply_window_appearance(
    window: tauri::WebviewWindow,
    frosted: bool,
    dark: Option<bool>,
) -> Result<Capabilities, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = apply(&target, frosted, dark);
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

fn apply(
    window: &tauri::WebviewWindow,
    frosted: bool,
    dark: Option<bool>,
) -> Result<Capabilities, String> {
    let support = capabilities();
    #[cfg(target_os = "macos")]
    {
        // Tauri 2.11's set_effects(None) does not clear macOS vibrancy and its
        // apply path discards errors. Use its same underlying library directly,
        // awaited on the main thread, with a real removal path and error result.
        // The helper adds a view on each application; remove ours first so
        // dark/light theme previews never stack additional blur layers.
        window_vibrancy::clear_vibrancy(window).map_err(|error| error.to_string())?;
        use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSColor, NSWindow};
        let pointer = window.ns_window().map_err(|error| error.to_string())?;
        if pointer.is_null() {
            return Err("Native window is unavailable".into());
        }
        // SAFETY: Tauri retains the window; resolve/use its pointer only in the
        // main-thread callback. NSWindow appearance is local; Tauri/Tao's
        // set_theme changes NSApplication appearance and leaks across windows.
        let native = unsafe { &*pointer.cast::<NSWindow>() };
        native.setOpaque(false);
        native.setBackgroundColor(Some(&NSColor::clearColor()));
        // Title/text appearance follows the window theme even without frosting.
        if let Some(dark) = dark {
            // SAFETY: AppKit's named appearance constants are immutable globals.
            let name = unsafe {
                if dark {
                    objc2_app_kit::NSAppearanceNameDarkAqua
                } else {
                    objc2_app_kit::NSAppearanceNameAqua
                }
            };
            let appearance = NSAppearance::appearanceNamed(name)
                .ok_or("Native window appearance is unavailable")?;
            native.setAppearance(Some(&appearance));
        } else {
            // Nimrod (system) must keep following OS appearance changes.
            native.setAppearance(None);
        }
        if frosted && !support.reduced_transparency {
            window_vibrancy::apply_vibrancy(
                window,
                // Sidebar intentionally carries a dense fill. Popover is a
                // more translucent standard recipe; CSS owns our theme tint.
                window_vibrancy::NSVisualEffectMaterial::Popover,
                Some(window_vibrancy::NSVisualEffectState::Active),
                None,
            )
            .map_err(|error| error.to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, frosted, dark);
    Ok(support)
}

/// Tint only the existing native title-bar container, never the NSWindow backing.
/// No replacement chrome, content overlay, geometry change or click interception.
#[tauri::command]
pub async fn tint_window_titlebar(
    window: tauri::WebviewWindow,
    color: [u8; 4],
) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let target = window.clone();
    window
        .run_on_main_thread(move || {
            let result = tint_titlebar(&target, color);
            let _ = send.send(result);
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[cfg(target_os = "macos")]
fn tint_titlebar(window: &tauri::WebviewWindow, color: [u8; 4]) -> Result<(), String> {
    use objc2_app_kit::{NSColor, NSWindow, NSWindowButton};
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("Native window is unavailable".into());
    }
    // SAFETY: this runs on the main thread and Tauri retains the target window.
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    native.setTitlebarAppearsTransparent(true);
    let Some(button) = native.standardWindowButton(NSWindowButton::CloseButton) else {
        return Ok(());
    };
    let Some(content) = native.contentView() else {
        return Ok(());
    };
    // Prepare native frame layout even while first-open Settings is hidden.
    if let Some(frame) = unsafe { content.superview() } {
        frame.layoutSubtreeIfNeeded();
    }
    let width = content.bounds().size.width;
    // AppKit can nest the traffic lights. Use public NSView ancestry, bounded
    // to a full-width, title-height container; never tint the full frame/content.
    // Full-screen/unsupported hierarchies keep transparent native chrome.
    let mut parent = unsafe { button.superview() };
    for _ in 0..4 {
        let Some(view) = parent else {
            return Ok(());
        };
        let size = view.bounds().size;
        if width > 0.0
            && size.width >= width * 0.9
            && size.height > 0.0
            && size.height <= 120.0
        {
            view.setWantsLayer(true);
            if let Some(layer) = view.layer() {
                let fill = NSColor::colorWithSRGBRed_green_blue_alpha(
                    color[0] as f64 / 255.0,
                    color[1] as f64 / 255.0,
                    color[2] as f64 / 255.0,
                    color[3] as f64 / 255.0,
                );
                layer.setBackgroundColor(Some(&fill.CGColor()));
            }
            return Ok(());
        }
        parent = unsafe { view.superview() };
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn tint_titlebar(_window: &tauri::WebviewWindow, _color: [u8; 4]) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn frosting_keeps_appearance_window_local_and_backing_clear() {
        // Source guard, not evidence of material density or native appearance.
        let source = include_str!("window_appearance.rs");
        let implementation = source.split("#[cfg(test)]").next().unwrap();
        assert!(!implementation.contains(".set_theme("));
        assert!(implementation.contains("native.setAppearance(Some(&appearance))"));
        assert!(implementation.contains("native.setAppearance(None)"));
        assert!(implementation.contains("native.setOpaque(false)"));
        assert!(implementation.contains("NSColor::clearColor()"));
        assert!(implementation.contains("NSVisualEffectMaterial::Popover"));
    }

    #[test]
    fn titlebar_keeps_native_controls_and_tints_only_a_bounded_title_height_view() {
        let source = include_str!("window_appearance.rs");
        let implementation = source.split("#[cfg(test)]").next().unwrap();
        assert!(implementation.contains("title_bar_style(tauri::TitleBarStyle::Transparent)"));
        assert!(!implementation.contains("title_visible(false)"));
        assert!(!implementation.contains("TitleBarStyle::Overlay"));
        assert!(implementation.contains("standardWindowButton(NSWindowButton::CloseButton)"));
        assert!(implementation.contains("size.height <= 120.0"));
        assert!(implementation.contains("layer.setBackgroundColor"));
    }

    #[test]
    fn every_native_window_uses_the_transparent_backing_boundary() {
        let navigation = include_str!("webview_navigation.rs");
        assert!(navigation.contains("crate::window_appearance::prepare(builder)"));
        for source in [
            include_str!("workspace_windows.rs"),
            include_str!("settings_window.rs"),
            include_str!("popouts.rs"),
        ] {
            assert!(source.contains("crate::webview_navigation::guard(builder"));
        }
    }
}
