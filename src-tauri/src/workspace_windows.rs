//! Directory-to-window routing. Opening a workspace never launches Pi.
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};
use tauri::Manager;

#[derive(Default)]
pub struct WorkspaceWindows {
    pub directories: Mutex<HashMap<String, PathBuf>>,
    next: AtomicUsize,
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceOpened {
    pub cwd: PathBuf,
    pub current: bool,
}

#[tauri::command]
pub async fn window_workspace(
    window: tauri::Window,
    workspaces: tauri::State<'_, WorkspaceWindows>,
) -> Result<Option<PathBuf>, String> {
    Ok(workspaces
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .cloned())
}

/// Read app-managed history and native window membership without launching agents.
#[tauri::command]
pub async fn list_projects(app: tauri::AppHandle) -> Vec<ProjectEntry> {
    let snapshot = app.state::<crate::preferences::Preferences>().snapshot();
    let open: Vec<_> = app
        .state::<WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect();
    project_entries(snapshot.state.get("nimrod.workspaces.v1"), &open)
}

#[derive(serde::Serialize)]
pub struct ProjectEntry {
    cwd: String,
    open: bool,
}

fn project_entries(recent: Option<&serde_json::Value>, open: &[PathBuf]) -> Vec<ProjectEntry> {
    let mut paths: Vec<String> = recent
        .and_then(serde_json::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(serde_json::Value::as_str)
        .map(str::to_owned)
        .collect();
    let mut extra: Vec<_> = open
        .iter()
        .map(|p| p.to_string_lossy().into_owned())
        .collect();
    extra.sort();
    paths.extend(extra);
    let mut seen = std::collections::HashSet::new();
    paths
        .into_iter()
        .filter(|p| seen.insert(p.clone()))
        .map(|cwd| ProjectEntry {
            open: open.iter().any(|p| p == std::path::Path::new(&cwd)),
            cwd,
        })
        .collect()
}

#[tauri::command]
pub async fn open_project_directory(
    app: tauri::AppHandle,
    cwd: PathBuf,
) -> Result<WorkspaceOpened, String> {
    // App navigation never rebinds a welcome window, unlike its launch form.
    route_workspace(&app, None, cwd)
}

#[tauri::command]
pub async fn open_workspace(
    app: tauri::AppHandle,
    window: tauri::Window,
    cwd: PathBuf,
) -> Result<WorkspaceOpened, String> {
    route_workspace(&app, Some(window.label()), cwd)
}

/// Create exactly one initial window. Configured windows have `create: false`,
/// so a cold CLI launch never creates a welcome window alongside its workspace.
/// The workspace router registers the directory before mounting its frontend.
pub fn open_initial_window(app: &tauri::AppHandle, cwd: Option<PathBuf>) -> Result<(), String> {
    if let Some(cwd) = cwd {
        route_workspace(app, None, cwd)?;
    } else {
        let config = app
            .config()
            .app
            .windows
            .iter()
            .find(|window| window.label == "main")
            .ok_or("Missing welcome window configuration")?;
        let window = tauri::WebviewWindowBuilder::from_config(app, config)
            .map_err(|e| e.to_string())?
            .build()
            .map_err(|e| e.to_string())?;
        crate::window_state::restore(&window, None);
    }
    Ok(())
}

/// Shared route for GUI actions, initial CLI launch and forwarded CLI requests.
/// An absent source creates a new workspace window rather than rebinding a live welcome page.
pub fn route_workspace(
    app: &tauri::AppHandle,
    source: Option<&str>,
    cwd: PathBuf,
) -> Result<WorkspaceOpened, String> {
    let workspaces = app.state::<WorkspaceWindows>();
    let cwd = cwd
        .canonicalize()
        .map_err(|e| format!("Invalid project directory: {e}"))?;
    if !cwd.is_dir() {
        return Err("Project must be a directory".into());
    }
    if app
        .state::<crate::ExitState>()
        .closing
        .load(Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    let mut directories = workspaces.directories.lock().unwrap();
    if let Some((label, _)) = directories.iter().find(|(_, directory)| **directory == cwd) {
        if let Some(existing) = app.get_webview_window(label) {
            focus_window(app, &existing)?;
            return Ok(WorkspaceOpened {
                cwd,
                current: Some(label.as_str()) == source,
            });
        }
        return Err("Project window is closing; try again once it has closed".into());
    }
    if let Some(source) = source.filter(|label| !directories.contains_key(*label)) {
        let window = app
            .get_webview_window(source)
            .ok_or("Project window is no longer available")?;
        directories.insert(source.into(), cwd.clone());
        let _ = window.set_title(&format!("Nimrod — {}", cwd.display()));
        crate::window_state::restore(&window, Some(&cwd));
        return Ok(WorkspaceOpened { cwd, current: true });
    }
    let label = format!(
        "workspace-{}",
        workspaces.next.fetch_add(1, Ordering::SeqCst)
    );
    directories.insert(label.clone(), cwd.clone());
    let result =
        tauri::WebviewWindowBuilder::new(app, &label, tauri::WebviewUrl::App("index.html".into()))
            .title(format!("Nimrod — {}", cwd.display()))
            .inner_size(1100.0, 800.0)
            .min_inner_size(560.0, 420.0)
            .build();
    let window = match result {
        Ok(window) => window,
        Err(e) => {
            directories.remove(&label);
            return Err(e.to_string());
        }
    };
    crate::window_state::restore(&window, Some(&cwd));
    focus_window(app, &window)?;
    Ok(WorkspaceOpened {
        cwd,
        current: false,
    })
}

pub(crate) fn focus_window(
    app: &tauri::AppHandle,
    window: &tauri::WebviewWindow,
) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    app.show().map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    let _ = app;
    window.show().map_err(|e| e.to_string())?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
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
        .or_else(|| windows.values().next())
        .ok_or("No open project window")?;
    focus_window(app, window)
}

#[tauri::command]
pub async fn inspect_workspace_session(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: PathBuf,
) -> Result<crate::sessions::SessionFile, String> {
    let cwd = app
        .state::<WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or("Open a project first")?;
    tauri::async_runtime::spawn_blocking(move || crate::sessions::inspect(&path, &cwd))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn list_workspace_sessions(
    app: tauri::AppHandle,
    window: tauri::Window,
) -> Result<crate::session_catalog::Catalog, String> {
    let cwd = app
        .state::<WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or("Open a project first")?;
    let home = app.path().home_dir().map_err(|e| e.to_string())?;
    let expand = |value: String| -> PathBuf {
        if value == "~" {
            home.clone()
        } else if let Some(rest) = value
            .strip_prefix("~/")
            .or_else(|| value.strip_prefix("~\\"))
        {
            home.join(rest)
        } else {
            let path = PathBuf::from(value);
            if path.is_absolute() {
                path
            } else {
                cwd.join(path)
            }
        }
    };
    // The child inherits these Pi environment variables. Custom session-dir is a
    // flat directory; default storage is grouped by Pi's encoded cwd.
    let dir = if let Some(custom) = std::env::var("PI_CODING_AGENT_SESSION_DIR")
        .ok()
        .filter(|s| !s.is_empty())
    {
        expand(custom)
    } else {
        let agent = std::env::var("PI_CODING_AGENT_DIR")
            .ok()
            .filter(|s| !s.is_empty())
            .map(expand)
            .unwrap_or_else(|| home.join(".pi/agent"));
        crate::session_catalog::project_dir(&agent.join("sessions"), &cwd)
    };
    tauri::async_runtime::spawn_blocking(move || crate::session_catalog::list(&dir, &cwd))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    #[test]
    fn projects_keep_recent_order_dedupe_and_use_native_membership() {
        let recent = serde_json::json!(["/b", 42, "/a", "/b"]);
        let open = vec![
            std::path::PathBuf::from("/a"),
            std::path::PathBuf::from("/c"),
        ];
        let entries = super::project_entries(Some(&recent), &open);
        assert_eq!(
            entries
                .iter()
                .map(|p| (p.cwd.as_str(), p.open))
                .collect::<Vec<_>>(),
            vec![("/b", false), ("/a", true), ("/c", true)]
        );
        assert_eq!(super::project_entries(None, &open).len(), 2);
    }
    #[test]
    fn startup_windows_are_created_only_by_explicit_routing() {
        let config: tauri::Config =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        assert!(
            config.app.windows.iter().all(|window| !window.create),
            "Automatic windows would create a welcome window before CLI routing"
        );
        assert_eq!(
            config
                .app
                .windows
                .iter()
                .filter(|window| window.label == "main")
                .count(),
            1,
            "Normal app launches need exactly one welcome window configuration"
        );
    }
}
