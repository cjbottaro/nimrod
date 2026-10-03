//! Native window geometry is app-managed state, not an application preference.
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::Manager;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub(crate) struct Geometry {
    width: f64,
    height: f64,
    x: i32,
    y: i32,
    maximized: bool,
}
#[derive(Default)]
pub struct WindowStates(Mutex<HashMap<String, Geometry>>);

fn key(cwd: Option<&Path>) -> String {
    format!(
        "window:{}",
        cwd.map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|| "welcome".into())
    )
}

pub fn capture(window: &tauri::Window) {
    if window.is_minimized().unwrap_or(true) || window.is_fullscreen().unwrap_or(true) {
        return;
    }
    match window.is_maximized() {
        Ok(true) => {
            // Retain the last normal bounds, but remember the new window mode.
            if let Some(geometry) = window
                .app_handle()
                .state::<WindowStates>()
                .0
                .lock()
                .unwrap()
                .get_mut(window.label())
            {
                geometry.maximized = true;
            }
            return;
        }
        Ok(false) => {}
        Err(error) => {
            eprintln!("Nimrod geometry capture: {error}");
            return;
        }
    }
    let (Ok(size), Ok(position), Ok(scale)) = (
        window.inner_size(),
        window.outer_position(),
        window.scale_factor(),
    ) else {
        return;
    };
    let size = size.to_logical::<f64>(scale);
    window
        .app_handle()
        .state::<WindowStates>()
        .0
        .lock()
        .unwrap()
        .insert(
            window.label().into(),
            Geometry {
                width: size.width,
                height: size.height,
                x: position.x,
                y: position.y,
                maximized: false,
            },
        );
}

pub fn save(window: &tauri::Window) {
    capture(window);
    let app = window.app_handle();
    let Some(mut geometry) = app
        .state::<WindowStates>()
        .0
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
    else {
        return;
    };
    geometry.maximized = window.is_maximized().unwrap_or(false);
    let cwd = app
        .state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .cloned();
    let mut entries = serde_json::Map::new();
    entries.insert(key(cwd.as_deref()), serde_json::to_value(geometry).unwrap());
    if let Err(error) = app
        .state::<crate::preferences::Preferences>()
        .update_state(entries)
    {
        eprintln!("Nimrod window state: {error}");
    }
}

fn cached_entries(
    cache: &HashMap<String, Geometry>,
    directories: &HashMap<String, PathBuf>,
) -> serde_json::Map<String, serde_json::Value> {
    cache
        .iter()
        .filter_map(|(label, geometry)| {
            if !valid(geometry) {
                return None;
            }
            let cwd = directories.get(label);
            // A forgotten project must not be reclassified as the welcome window.
            if cwd.is_none() && label != "main" {
                return None;
            }
            Some((
                key(cwd.map(PathBuf::as_path)),
                serde_json::to_value(geometry).unwrap(),
            ))
        })
        .collect()
}

/// AppKit termination (for example Dock Quit) can deliver only RunEvent::Exit.
/// Flush the last event-captured geometry there without querying dying windows
/// or relying on a cancellable exit request / an asynchronous task.
pub fn save_cached(app: &tauri::AppHandle) {
    let cache = app.state::<WindowStates>().0.lock().unwrap().clone();
    let directories = app
        .state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .clone();
    let entries = cached_entries(&cache, &directories);
    if entries.is_empty() {
        return;
    }
    if let Err(error) = app
        .state::<crate::preferences::Preferences>()
        .update_state(entries)
    {
        eprintln!("Nimrod final window state: {error}");
    }
}

pub fn valid_for(geometry: &Geometry, minimum: (f64, f64)) -> bool {
    geometry.width.is_finite()
        && geometry.height.is_finite()
        && (minimum.0..=20_000.0).contains(&geometry.width)
        && (minimum.1..=20_000.0).contains(&geometry.height)
}

fn valid(geometry: &Geometry) -> bool {
    valid_for(geometry, (560.0, 420.0))
}

pub fn cached(app: &tauri::AppHandle, label: &str) -> Option<Geometry> {
    app.state::<WindowStates>()
        .0
        .lock()
        .unwrap()
        .get(label)
        .cloned()
}

pub fn restore(window: &tauri::WebviewWindow, cwd: Option<&Path>) {
    let app = window.app_handle();
    let snapshot = app.state::<crate::preferences::Preferences>().snapshot();
    let Some(value) = snapshot.state.get(&key(cwd)) else {
        return;
    };
    let Ok(geometry) = serde_json::from_value::<Geometry>(value.clone()) else {
        return;
    };
    restore_geometry(window, geometry, (560.0, 420.0));
}

pub fn restore_geometry(
    window: &tauri::WebviewWindow,
    mut geometry: Geometry,
    minimum: (f64, f64),
) {
    let app = window.app_handle();
    if !valid_for(&geometry, minimum) {
        return;
    }
    // Placement is physical; dimensions are logical so changing DPI doesn't shrink the UI.
    // If the remembered display disappeared, center on the current display instead.
    let monitors = window.available_monitors().unwrap_or_default();
    let monitor = monitors.iter().find(|monitor| {
        let position = monitor.position();
        let size = monitor.size();
        let x = i64::from(geometry.x);
        let y = i64::from(geometry.y);
        x >= i64::from(position.x)
            && y >= i64::from(position.y)
            && x + 100 <= i64::from(position.x) + i64::from(size.width)
            && y + 100 <= i64::from(position.y) + i64::from(size.height)
    });
    let fallback = window.current_monitor().ok().flatten();
    if let Some(screen) = monitor.or(fallback.as_ref()) {
        let available = screen.size().to_logical::<f64>(screen.scale_factor());
        geometry.width = geometry.width.min((available.width - 40.0).max(minimum.0));
        geometry.height = geometry
            .height
            .min((available.height - 80.0).max(minimum.1));
        if monitor.is_some() {
            geometry.x = geometry.x.min(screen.position().x.saturating_add(
                (f64::from(screen.size().width) - geometry.width * screen.scale_factor()).max(0.0)
                    as i32,
            ));
            geometry.y = geometry.y.min(screen.position().y.saturating_add(
                (f64::from(screen.size().height) - geometry.height * screen.scale_factor()).max(0.0)
                    as i32,
            ));
        }
    }
    let _ = window.set_size(tauri::LogicalSize::new(geometry.width, geometry.height));
    if monitor.is_some() {
        let _ = window.set_position(tauri::PhysicalPosition::new(geometry.x, geometry.y));
    } else {
        let _ = window.center();
    }
    app.state::<WindowStates>()
        .0
        .lock()
        .unwrap()
        .insert(window.label().into(), geometry.clone());
    if geometry.maximized {
        let _ = window.maximize();
    }
}

pub fn forget(window: &tauri::Window) {
    window
        .app_handle()
        .state::<WindowStates>()
        .0
        .lock()
        .unwrap()
        .remove(window.label());
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn final_exit_flush_uses_cached_geometry_and_canonical_project_keys() {
        let cache = HashMap::from([
            (
                "workspace-0".into(),
                Geometry {
                    width: 900.0,
                    height: 640.0,
                    x: 120,
                    y: 80,
                    maximized: false,
                },
            ),
            (
                "workspace-1".into(),
                Geometry {
                    width: 1200.0,
                    height: 900.0,
                    x: -1500,
                    y: 200,
                    maximized: true,
                },
            ),
            (
                "orphan".into(),
                Geometry {
                    width: 1100.0,
                    height: 800.0,
                    x: 0,
                    y: 0,
                    maximized: false,
                },
            ),
        ]);
        let directories = HashMap::from([
            ("workspace-0".into(), PathBuf::from("/project/a")),
            ("workspace-1".into(), PathBuf::from("/project/b")),
        ]);
        let entries = cached_entries(&cache, &directories);
        assert_eq!(entries.len(), 2);
        assert_eq!(entries["window:/project/a"]["width"], 900.0);
        assert_eq!(entries["window:/project/a"]["x"], 120);
        assert_eq!(entries["window:/project/b"]["maximized"], true);
        assert!(!entries.contains_key("window:welcome"));
    }
    #[test]
    fn geometry_is_project_scoped_and_bounded() {
        assert_ne!(key(Some(Path::new("/a"))), key(Some(Path::new("/b"))));
        let mut geometry = Geometry {
            width: 1100.0,
            height: 800.0,
            x: -1000,
            y: 0,
            maximized: false,
        };
        assert!(valid(&geometry));
        geometry.width = f64::NAN;
        assert!(!valid(&geometry));
        geometry.width = 1100.0;
        geometry.height = 0.0;
        assert!(!valid(&geometry));
    }
}
