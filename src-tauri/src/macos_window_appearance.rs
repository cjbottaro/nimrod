//! AppKit-only material/title implementation. All entry points run on the main thread.
//! The portable presentation layer owns callers, ordering and error routing.

pub fn reduced_transparency() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
}

pub fn apply(
    window: &tauri::WebviewWindow,
    frosted: bool,
    dark: Option<bool>,
) -> Result<(), String> {
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
        let appearance =
            NSAppearance::appearanceNamed(name).ok_or("Native window appearance is unavailable")?;
        native.setAppearance(Some(&appearance));
    } else {
        // Nimrod (system) must keep following OS appearance changes.
        native.setAppearance(None);
    }
    if frosted {
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
    Ok(())
}

pub fn tint_titlebar(window: &tauri::WebviewWindow, color: [u8; 4]) -> Result<(), String> {
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
        if width > 0.0 && size.width >= width * 0.9 && size.height > 0.0 && size.height <= 120.0 {
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
