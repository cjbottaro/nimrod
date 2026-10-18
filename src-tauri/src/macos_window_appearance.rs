//! AppKit/WindowServer-only blur/title implementation. All entry points run on the main thread.
//! The portable presentation layer owns callers, ordering and error routing.

// This private WindowServer API applies blur without an NSVisualEffectView's
// material tint. Resolve at runtime: unsupported systems retain plain alpha.
// Keep the framework loaded for the lifetime of these cached function pointers.
struct BackgroundBlur {
    connection: unsafe extern "C" fn() -> *mut std::ffi::c_void,
    set_radius: unsafe extern "C" fn(*mut std::ffi::c_void, isize, i64) -> i32,
}

fn background_blur() -> Option<&'static BackgroundBlur> {
    use std::ffi::{c_char, c_int, c_void};
    unsafe extern "C" {
        fn dlopen(path: *const c_char, mode: c_int) -> *mut c_void;
        fn dlsym(handle: *mut c_void, name: *const c_char) -> *mut c_void;
    }
    static API: std::sync::OnceLock<Option<BackgroundBlur>> = std::sync::OnceLock::new();
    API.get_or_init(|| {
        // SAFETY: fixed framework/symbol names, checked pointers, C signatures
        // used by winit 0.30.13's macOS ffi.rs. Connection IDs are opaque:
        // never dereference the returned pointer.
        unsafe {
            let handle = dlopen(
                c"/System/Library/PrivateFrameworks/SkyLight.framework/SkyLight".as_ptr(),
                1,
            );
            if handle.is_null() {
                return None;
            }
            let connection = dlsym(handle, c"CGSMainConnectionID".as_ptr());
            let set_radius = dlsym(handle, c"CGSSetWindowBackgroundBlurRadius".as_ptr());
            if connection.is_null() || set_radius.is_null() {
                return None;
            }
            Some(BackgroundBlur {
                connection: std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> *mut c_void>(connection),
                set_radius: std::mem::transmute::<
                    *mut c_void,
                    unsafe extern "C" fn(*mut c_void, isize, i64) -> i32,
                >(set_radius),
            })
        }
    })
    .as_ref()
}

pub fn blur_supported() -> bool {
    background_blur().is_some()
}

pub fn reduced_transparency() -> bool {
    objc2_app_kit::NSWorkspace::sharedWorkspace().accessibilityDisplayShouldReduceTransparency()
}

pub fn apply(window: &tauri::WebviewWindow, blur: u8, dark: Option<bool>) -> Result<(), String> {
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
    native.setOpaque(false);
    native.setBackgroundColor(Some(&NSColor::clearColor()));
    // Title/text appearance follows the window theme even without blur.
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
    if let Some(api) = background_blur() {
        let number = native.windowNumber();
        if number <= 0 {
            return Err("Native window number is unavailable".into());
        }
        // SAFETY: AppKit owns this invoking window; called on the main thread.
        // Radius zero explicitly removes a previous blur, including under
        // Reduce Transparency. No screenshot capture or background pixel access.
        let result = unsafe { (api.set_radius)((api.connection)(), number, i64::from(blur)) };
        if result != 0 {
            // Best effort removal; never substitute a tinted material.
            let cleared = unsafe { (api.set_radius)((api.connection)(), number, 0) };
            return Err(if cleared == 0 {
                format!("Native background blur failed ({result}); using plain transparency")
            } else {
                format!(
                    "Native background blur failed ({result}); could not remove the previous blur ({cleared})"
                )
            });
        }
    } else if blur != 0 {
        return Err("Native background blur is unavailable; using plain transparency".into());
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
