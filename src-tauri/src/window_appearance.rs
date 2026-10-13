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
    dark: bool,
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

fn apply(window: &tauri::WebviewWindow, frosted: bool, dark: bool) -> Result<Capabilities, String> {
    let support = capabilities();
    #[cfg(target_os = "macos")]
    {
        // Tauri 2.11's set_effects(None) does not clear macOS vibrancy and its
        // apply path discards errors. Use its same underlying library directly,
        // awaited on the main thread, with a real removal path and error result.
        // The helper adds a view on each application; remove ours first so
        // dark/light theme previews never stack additional blur layers.
        window_vibrancy::clear_vibrancy(window).map_err(|error| error.to_string())?;
        if frosted && !support.reduced_transparency {
            window
                .set_theme(Some(if dark {
                    tauri::Theme::Dark
                } else {
                    tauri::Theme::Light
                }))
                .map_err(|error| error.to_string())?;
            window_vibrancy::apply_vibrancy(
                window,
                window_vibrancy::NSVisualEffectMaterial::Sidebar,
                Some(window_vibrancy::NSVisualEffectState::Active),
                None,
            )
            .map_err(|error| error.to_string())?;
        } else {
            window
                .set_theme(None)
                .map_err(|error| error.to_string())?;
        }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (window, frosted, dark);
    Ok(support)
}

#[cfg(test)]
mod tests {
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
