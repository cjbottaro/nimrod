//! AppKit-only window presentation. All entry points run on the main thread.
//! Private material/filter operations and Objective-C exceptions are isolated in macos_blur.m.

use block2::{DynBlock, RcBlock};
use std::ffi::c_void;
use tauri::Emitter;

unsafe extern "C" {
    fn nimrod_blur_supported() -> i32;
    fn nimrod_blur_apply(
        window: *mut c_void,
        radius: u8,
        failure: *const DynBlock<dyn Fn(i32)>,
    ) -> i32;
}

pub fn blur_supported() -> bool {
    // SAFETY: portable dispatch calls this on AppKit's main thread.
    unsafe { nimrod_blur_supported() != 0 }
}

fn blur_error(status: i32) -> String {
    let reason = match status {
        1 => "adjustable material blur is unavailable",
        2 => "the native window frame is unsupported",
        3 => "background blur must be from 0 to 40",
        4 => "the native material has an unsupported filter layout",
        _ => "macOS could not configure the native blur material",
    };
    format!("{reason}; using plain transparency")
}

#[derive(Clone, serde::Serialize)]
struct BlurFailure {
    request: String,
    message: String,
}

pub fn reduced_transparency() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
}

// A fully clear NSWindow uses content-derived shadows, which can leave stale
// rectangular backdrops with WindowServer blur. A 0.01%-alpha backing keeps the
// standard titled-window frame/shadow path without a visible material tint.
// Prior art: Ghostty TerminalWindow.syncAppearance and Zed PR #27403.
const NATIVE_BACKING_ALPHA: f64 = 0.0001;

pub fn apply(
    window: &tauri::WebviewWindow,
    blur: u8,
    dark: Option<bool>,
    update_theme: bool,
    request: &str,
) -> Result<(), String> {
    if blur > 40 {
        return Err("Background blur must be from 0 to 40".into());
    }
    use objc2_app_kit::{NSAppearance, NSAppearanceCustomization, NSColor, NSWindow};
    let pointer = window.ns_window().map_err(|error| error.to_string())?;
    if pointer.is_null() {
        return Err("Native window is unavailable".into());
    }
    // SAFETY: Tauri retains the window; resolve/use its pointer only in the
    // main-thread callback. NSWindow appearance is local; Tauri/Tao's
    // set_theme changes NSApplication appearance and leaks across windows.
    let native = unsafe { &*pointer.cast::<NSWindow>() };
    // Initialize backing once; changing blur must not reset the native frame,
    // rebuild its shadow or reapply an unchanged theme on every slider tick.
    if native.isOpaque() || native.backgroundColor().alphaComponent() == 0.0 {
        native.setOpaque(false);
        native.setBackgroundColor(Some(&NSColor::colorWithSRGBRed_green_blue_alpha(
            0.0,
            0.0,
            0.0,
            NATIVE_BACKING_ALPHA,
        )));
        native.invalidateShadow();
    }
    // Title/text appearance follows the window theme even without blur.
    if update_theme {
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
    }
    let target = window.clone();
    let request = request.to_owned();
    let failure = RcBlock::new(move |status: i32| {
        // Rebuild failures can occur after the command has returned. Both the
        // event target and opaque request identity fence other/newer windows.
        let _ = target.emit_to(
            tauri::EventTarget::webview_window(target.label()),
            "nimrod-window-appearance-error",
            BlurFailure {
                request: request.clone(),
                message: blur_error(status),
            },
        );
    });
    // SAFETY: native remains retained by Tauri on the main thread. The helper
    // copies this block while needed and releases it when blur is removed or
    // the native window closes. Private ObjC exceptions never cross this FFI.
    let status = unsafe { nimrod_blur_apply(pointer, blur, RcBlock::as_ptr(&failure)) };
    if status != 0 {
        return Err(blur_error(status));
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

