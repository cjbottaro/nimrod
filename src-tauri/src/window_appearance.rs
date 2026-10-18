//! Portable appearance commands. Platform implementation stays behind this boundary.
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
    let reduced_transparency = crate::macos_window_appearance::reduced_transparency();
    #[cfg(not(target_os = "macos"))]
    let reduced_transparency = false;
    Capabilities {
        platform: std::env::consts::OS,
        transparency: cfg!(any(target_os = "macos", target_os = "linux")),
        frost: {
            #[cfg(target_os = "macos")]
            {
                crate::macos_window_appearance::blur_supported()
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        },
        reduced_transparency,
    }
}

pub fn prepare<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let builder = builder.transparent(true);
    #[cfg(target_os = "macos")]
    let builder = builder.title_bar_style(tauri::TitleBarStyle::Transparent);
    builder
}

async fn on_main_thread<T: Send + 'static>(
    window: &tauri::WebviewWindow,
    operation: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    window
        .run_on_main_thread(move || {
            let _ = send.send(operation());
        })
        .map_err(|error| error.to_string())?;
    receive.await.map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn window_appearance_capabilities(
    window: tauri::WebviewWindow,
) -> Result<Capabilities, String> {
    on_main_thread(&window, || Ok(capabilities())).await
}

#[tauri::command]
pub async fn apply_window_appearance(
    window: tauri::WebviewWindow,
    blur: u8,
    dark: Option<bool>,
    update_theme: bool,
) -> Result<Capabilities, String> {
    if blur > 40 {
        return Err("Background blur must be from 0 to 40".into());
    }
    let target = window.clone();
    on_main_thread(&window, move || {
        let support = capabilities();
        #[cfg(target_os = "macos")]
        crate::macos_window_appearance::apply(
            &target,
            if support.reduced_transparency {
                0
            } else {
                blur
            },
            dark,
            update_theme,
        )?;
        #[cfg(not(target_os = "macos"))]
        let _ = (target, blur, dark, update_theme);
        Ok(support)
    })
    .await
}

#[tauri::command]
pub async fn tint_window_titlebar(
    window: tauri::WebviewWindow,
    color: [u8; 4],
) -> Result<(), String> {
    let target = window.clone();
    on_main_thread(&window, move || {
        #[cfg(target_os = "macos")]
        crate::macos_window_appearance::tint_titlebar(&target, color)?;
        #[cfg(not(target_os = "macos"))]
        let _ = (target, color);
        Ok(())
    })
    .await
}

#[cfg(test)]
mod tests {
    #[test]
    fn appkit_is_isolated_and_keeps_native_controls_nearly_clear_backing_and_bounded_tint() {
        let source = include_str!("macos_window_appearance.rs");
        assert!(!source.contains(".set_theme("));
        assert!(source.contains("native.setAppearance(Some(&appearance))"));
        assert!(source.contains("native.setAppearance(None)"));
        assert!(source.contains("native.setOpaque(false)"));
        assert!(source.contains("NATIVE_BACKING_ALPHA: f64 = 0.0001"));
        assert!(!source.contains("NSColor::clearColor()"));
        assert!(source.contains("native.invalidateShadow()"));
        assert!(source.contains("if update_theme"));
        assert!(source.contains("CGSSetWindowBackgroundBlurRadius"));
        assert!(source.contains("CGSMainConnectionID"));
        assert!(source.contains("fn blur_supported()"));
        assert!(!source.contains("apply_vibrancy"));
        assert!(source.contains("standardWindowButton(NSWindowButton::CloseButton)"));
        assert!(source.contains("size.height <= 120.0"));
        assert!(source.contains("layer.setBackgroundColor"));
        let presentation = include_str!("window_appearance.rs")
            .split("#[cfg(test)]")
            .next()
            .unwrap();
        assert!(presentation.contains("title_bar_style(tauri::TitleBarStyle::Transparent)"));
        assert!(!presentation.contains("title_visible(false)"));
        assert!(!presentation.contains("TitleBarStyle::Overlay"));
    }
}
