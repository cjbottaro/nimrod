//! Shared native window composition/presentation, separate from navigation security.
//! Feature owners retain identity, geometry, close policy and passive-reference behavior.
use std::sync::{Mutex, atomic::Ordering};
use tauri::Manager;

pub fn prepare<'a>(
    builder: tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle>,
    app: &tauri::AppHandle,
    label: &str,
) -> tauri::WebviewWindowBuilder<'a, tauri::Wry, tauri::AppHandle> {
    let builder = crate::window_appearance::prepare(builder);
    crate::webview_navigation::guard(builder, app, label)
}

/// Explicit user-requested focus, never the passive pop-out restoration path.
pub fn focus(app: &tauri::AppHandle, window: &tauri::WebviewWindow) -> Result<(), String> {
    if window.label() == crate::settings_window::LABEL && !crate::settings_window::is_ready(app) {
        return Ok(());
    }
    #[cfg(target_os = "macos")]
    app.show().map_err(|error| error.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    focus_native(window)
}

/// Reference ownership/eligibility is checked by its feature owner. Preserve
/// its existing explicit show/focus behavior without adding app activation.
pub fn focus_reference(window: &tauri::WebviewWindow) -> Result<(), String> {
    focus_native(window)
}

fn focus_native(window: &tauri::WebviewWindow) -> Result<(), String> {
    window.show().map_err(|error| error.to_string())?;
    window.unminimize().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
}

pub fn focus_existing(app: &tauri::AppHandle) -> Result<(), String> {
    if app
        .state::<crate::ExitState>()
        .closing
        .load(Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    let windows = app.webview_windows();
    let window = windows
        .values()
        .find(|w| w.is_focused().unwrap_or(false))
        .or_else(|| {
            windows.values().find(|window| {
                window.label() != crate::settings_window::LABEL
                    || crate::settings_window::is_ready(app)
            })
        })
        .ok_or("No open project window")?;
    focus(app, window)
}

#[derive(Default)]
pub struct PreparationGate(Mutex<Option<Preparation>>);
struct Preparation {
    generation: String,
    ready: bool,
}
impl PreparationGate {
    pub fn begin(&self) -> String {
        let generation = uuid::Uuid::new_v4().to_string();
        *self.0.lock().unwrap() = Some(Preparation {
            generation: generation.clone(),
            ready: false,
        });
        generation
    }
    pub fn ready(&self) -> bool {
        self.0.lock().unwrap().as_ref().is_some_and(|state| state.ready)
    }
    /// Return true exactly once for the current native creation; stale tokens never consume readiness.
    pub fn accept(&self, generation: &str) -> Result<bool, String> {
        let mut state = self.0.lock().unwrap();
        let state = state
            .as_mut()
            .filter(|state| state.generation == generation)
            .ok_or("startup belongs to a closed window")?;
        let reveal = !state.ready;
        state.ready = true;
        Ok(reveal)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn current_creation_reveals_once_and_old_generations_never_consume_new_readiness() {
        let gate = PreparationGate::default();
        let first = gate.begin();
        assert!(gate.accept("old").is_err()); assert!(!gate.ready());
        assert!(gate.accept(&first).unwrap()); assert!(!gate.accept(&first).unwrap());
        let second = gate.begin();
        assert!(gate.accept(&first).is_err()); assert!(!gate.ready());
        assert!(gate.accept(&second).unwrap());
    }
    #[test]
    fn all_window_constructors_use_one_composition_boundary() {
        for (source, count) in [
            (include_str!("workspace_windows.rs"), 2),
            (include_str!("settings_window.rs"), 1),
            (include_str!("popouts.rs"), 1),
        ] {
            assert_eq!(source.matches("WebviewWindowBuilder::").count(), count);
            assert_eq!(source.matches("window_presentation::prepare(").count(), count);
            assert!(!source.contains("webview_navigation::guard("));
        }
        let navigation = include_str!("webview_navigation.rs");
        assert!(!navigation.contains("window_appearance::prepare("));
    }
}
