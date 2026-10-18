//! AppKit/WindowServer-only blur/title implementation. All entry points run on the main thread.
//! The portable presentation layer owns callers, ordering and error routing.

// This private WindowServer API applies blur without an NSVisualEffectView's
// material tint. Resolve at runtime: unsupported systems retain plain alpha.
// Keep the framework loaded for the lifetime of these cached function pointers.
struct BackgroundBlur {
    connection: unsafe extern "C" fn() -> *mut std::ffi::c_void,
    set_radius: unsafe extern "C" fn(*mut std::ffi::c_void, isize, i64) -> i32,
    disable_updates: unsafe extern "C" fn(i32) -> i32,
    reenable_updates: unsafe extern "C" fn(i32) -> i32,
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
            let disable_updates = dlsym(handle, c"SLSDisableUpdate".as_ptr());
            let reenable_updates = dlsym(handle, c"SLSReenableUpdate".as_ptr());
            if connection.is_null() || set_radius.is_null()
                || disable_updates.is_null() || reenable_updates.is_null() {
                return None;
            }
            Some(BackgroundBlur {
                connection: std::mem::transmute::<*mut c_void, unsafe extern "C" fn() -> *mut c_void>(connection),
                set_radius: std::mem::transmute::<
                    *mut c_void,
                    unsafe extern "C" fn(*mut c_void, isize, i64) -> i32,
                >(set_radius),
                // CGSConnectionID is an int32 token; see yabai's extern.h.
                disable_updates: std::mem::transmute::<*mut c_void, unsafe extern "C" fn(i32) -> i32>(disable_updates),
                reenable_updates: std::mem::transmute::<*mut c_void, unsafe extern "C" fn(i32) -> i32>(reenable_updates),
            })
        }
    })
    .as_ref()
}

// Balance connection-scoped WindowServer update suppression in this stack
// frame, even when the operation fails or unwinds. Never await, sleep, call
// WebKit/display code or return to the run loop while a batch is open.
struct UpdateBatch<F: FnOnce() -> i32>(Option<F>);
impl<F: FnOnce() -> i32> UpdateBatch<F> {
    fn finish(mut self) -> i32 {
        self.0.take().expect("unfinished update batch")()
    }
}
impl<F: FnOnce() -> i32> Drop for UpdateBatch<F> {
    fn drop(&mut self) {
        if let Some(resume) = self.0.take() {
            resume();
        }
    }
}

fn with_update_batch<T>(
    begin: impl FnOnce() -> i32,
    resume: impl FnOnce() -> i32,
    operation: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    let status = begin();
    if status != 0 {
        return Err(format!("Could not begin background-blur update ({status})"));
    }
    let guard = UpdateBatch(Some(resume));
    let result = operation();
    let status = guard.finish();
    if status != 0 {
        let cause = result
            .err()
            .map(|error| format!("; {error}"))
            .unwrap_or_default();
        return Err(format!("Could not resume window updates ({status}){cause}"));
    }
    result
}

pub fn blur_supported() -> bool {
    background_blur().is_some()
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
    if let Some(api) = background_blur() {
        let number = native.windowNumber();
        if number <= 0 {
            return Err("Native window number is unavailable".into());
        }
        // SAFETY: only the invoking window is mutated on the main thread.
        // The borrowed winit ABI represents the connection token as a pointer;
        // update batching uses its underlying CGSConnectionID (int32), not an
        // address to dereference. No external connection/window is accessed.
        let connection = unsafe { (api.connection)() };
        let connection_id = connection as usize as i32;
        with_update_batch(
            || unsafe { (api.disable_updates)(connection_id) },
            || unsafe { (api.reenable_updates)(connection_id) },
            || {
                // Batch only these synchronous setters: don't present the
                // intermediate WindowServer backdrop when blur is enabled.
                // Zero still removes blur, including under Reduce Transparency.
                let result = unsafe { (api.set_radius)(connection, number, i64::from(blur)) };
                if result == 0 {
                    return Ok(());
                }
                // Best effort removal stays inside the same presentation batch.
                let cleared = unsafe { (api.set_radius)(connection, number, 0) };
                Err(if cleared == 0 {
                    format!("Native background blur failed ({result}); using plain transparency")
                } else {
                    format!(
                        "Native background blur failed ({result}); could not remove the previous blur ({cleared})"
                    )
                })
            },
        )?;
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

#[cfg(test)]
mod tests {
    use super::with_update_batch;
    use std::cell::{Cell, RefCell};

    #[test]
    fn update_batch_resumes_once_after_success_or_native_failure() {
        for fail in [false, true] {
            let trace = RefCell::new(Vec::new());
            let result = with_update_batch(
                || {
                    trace.borrow_mut().push("begin");
                    0
                },
                || {
                    trace.borrow_mut().push("resume");
                    0
                },
                || {
                    trace.borrow_mut().push("set blur");
                    if fail {
                        Err("blur failed".into())
                    } else {
                        Ok(())
                    }
                },
            );
            assert_eq!(*trace.borrow(), ["begin", "set blur", "resume"]);
            assert_eq!(result.is_err(), fail);
        }
    }

    #[test]
    fn failed_begin_does_not_change_blur_or_unbalance_updates() {
        let result = with_update_batch(
            || 17,
            || panic!("must not resume a batch that never opened"),
            || -> Result<(), String> { panic!("must not change blur") },
        );
        assert!(result.unwrap_err().contains("17"));
    }

    #[test]
    fn failed_resume_is_reported_with_the_native_failure() {
        let result = with_update_batch(
            || 0,
            || 23,
            || -> Result<(), String> { Err("blur failed".into()) },
        );
        let error = result.unwrap_err();
        assert!(error.contains("resume window updates (23)"));
        assert!(error.contains("blur failed"));
    }

    #[test]
    fn update_batch_resumes_even_when_the_operation_unwinds() {
        let resumes = Cell::new(0);
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = with_update_batch(
                || 0,
                || {
                    resumes.set(resumes.get() + 1);
                    0
                },
                || -> Result<(), String> { panic!("operation unwound") },
            );
        }));
        assert!(result.is_err());
        assert_eq!(resumes.get(), 1);
    }
}
