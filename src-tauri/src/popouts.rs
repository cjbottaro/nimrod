use crate::{
    popout_store::{CodeSnapshot, PiSessionRef, SavedPopout, SnapshotStore, fingerprint},
    preferences::Preferences,
    window_state,
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
};
use tauri::{Emitter, Manager};

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionBinding {
    pub runtime_id: String,
    pub pi: Option<PiSessionRef>,
}

#[derive(Clone)]
struct PopoutEntry {
    owner: String,
    runtime_id: String,
    cwd: PathBuf,
    snapshot: Arc<CodeSnapshot>,
    fingerprint: String,
    saved: Option<SavedPopout>,
}
#[derive(Default)]
struct Registry {
    entries: HashMap<String, PopoutEntry>, // Nimrod UUID -> window and snapshot.
    bindings: HashMap<String, Vec<SessionBinding>>,
    desired: HashMap<String, (u64, Option<String>)>,
    retired: HashSet<String>,
}
#[derive(Default)]
pub struct Popouts {
    registry: Mutex<Registry>,
    next: AtomicU64,
    operations: tokio::sync::Mutex<()>,
}
impl Popouts {
    pub fn retire(&self, owner: &str) {
        let mut registry = self.registry.lock().unwrap();
        registry.retired.insert(owner.into());
        registry.desired.remove(owner);
    }
    pub fn forget_window(&self, label: &str) {
        if let Some(id) = label.strip_prefix("popout-") {
            self.registry.lock().unwrap().entries.remove(id);
        }
    }
    fn selected(&self, owner: &str, runtime: &str) -> bool {
        let registry = self.registry.lock().unwrap();
        !registry.retired.contains(owner)
            && registry
                .desired
                .get(owner)
                .and_then(|(_, id)| id.as_deref())
                == Some(runtime)
    }
    fn current(&self, owner: &str, revision: u64) -> bool {
        let registry = self.registry.lock().unwrap();
        !registry.retired.contains(owner)
            && registry
                .desired
                .get(owner)
                .is_some_and(|(v, _)| *v == revision)
    }
    fn owned(&self, owner: &str) -> Vec<(String, PopoutEntry)> {
        self.registry
            .lock()
            .unwrap()
            .entries
            .iter()
            .filter(|(_, e)| e.owner == owner)
            .map(|(id, e)| (id.clone(), e.clone()))
            .collect()
    }
}

#[derive(Default, Serialize)]
pub struct SyncResult {
    warnings: Vec<String>,
}

fn project(app: &tauri::AppHandle, owner: &str) -> Result<PathBuf, String> {
    if app
        .state::<crate::ExitState>()
        .closing
        .load(Ordering::SeqCst)
        || app
            .state::<Popouts>()
            .registry
            .lock()
            .unwrap()
            .retired
            .contains(owner)
    {
        return Err("Project is closing".into());
    }
    app.state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(owner)
        .cloned()
        .ok_or_else(|| "Pop-outs must originate from a project window".into())
}

fn label(id: &str) -> String {
    format!("popout-{id}")
}

fn same_session(entry: &PopoutEntry, owner: &str, binding: &SessionBinding) -> bool {
    entry.owner == owner
        && match (&entry.saved, &binding.pi) {
            (Some(saved), Some(pi)) => &saved.pi == pi,
            (None, _) => entry.runtime_id == binding.runtime_id,
            _ => false,
        }
}

fn create_window(app: &tauri::AppHandle, id: &str, entry: PopoutEntry) -> Result<(), String> {
    let geometry = entry.saved.as_ref().and_then(|s| s.geometry.clone());
    app.state::<Popouts>()
        .registry
        .lock()
        .unwrap()
        .entries
        .insert(id.into(), entry);
    let result = tauri::WebviewWindowBuilder::new(
        app,
        label(id),
        tauri::WebviewUrl::App("index.html?popout".into()),
    )
    .title("Nimrod") // The rendered pop-out sets its content-derived title.
    .inner_size(720.0, 540.0)
    .min_inner_size(320.0, 220.0)
    .visible(false)
    .focused(false)
    .build();
    let window = match result {
        Ok(window) => window,
        Err(e) => {
            app.state::<Popouts>()
                .registry
                .lock()
                .unwrap()
                .entries
                .remove(id);
            return Err(e.to_string());
        }
    };
    if let Some(geometry) = geometry {
        window_state::restore_geometry(&window, geometry, (320.0, 220.0));
    }
    window_state::capture(&window.as_ref().window());
    Ok(())
}

fn save_geometry(app: &tauri::AppHandle, id: &str, capture: bool) -> Result<(), String> {
    if capture && let Some(window) = app.get_webview_window(&label(id)) {
        window_state::capture(&window.as_ref().window());
    }
    let geometry = window_state::cached(app, &label(id));
    let state = app.state::<Popouts>();
    let saved = state
        .registry
        .lock()
        .unwrap()
        .entries
        .get(id)
        .and_then(|e| e.saved.clone());
    if let (Some(mut saved), Some(geometry)) = (saved, geometry) {
        if saved.geometry.as_ref() == Some(&geometry) {
            return Ok(());
        }
        saved.geometry = Some(geometry);
        SnapshotStore(&app.state::<Preferences>()).save_geometry(&saved)?;
        if let Some(entry) = state.registry.lock().unwrap().entries.get_mut(id) {
            entry.saved = Some(saved);
        }
    }
    Ok(())
}

/// The shell reports all mounted sessions, including background sessions gaining
/// their first verified Pi file. No transcript or process is restored here.
#[tauri::command]
pub async fn sync_popout_sessions(
    app: tauri::AppHandle,
    window: tauri::Window,
    sessions: Vec<SessionBinding>,
    active: Option<String>,
) -> Result<SyncResult, String> {
    let owner = window.label();
    let cwd = project(&app, owner)?;
    if sessions.len() > 512
        || sessions
            .iter()
            .any(|s| s.runtime_id.is_empty() || s.runtime_id.len() > 256)
        || active
            .as_ref()
            .is_some_and(|id| !sessions.iter().any(|s| &s.runtime_id == id))
    {
        return Err("Invalid pop-out session selection".into());
    }
    let state = app.state::<Popouts>();
    let revision = state.next.fetch_add(1, Ordering::SeqCst);
    state
        .registry
        .lock()
        .unwrap()
        .desired
        .insert(owner.into(), (revision, active.clone()));
    let _operations = state.operations.lock().await;
    if !state.current(owner, revision) {
        return Ok(SyncResult::default());
    }
    // Hide outgoing windows before potentially expensive disk validation/restoration.
    for (id, entry) in state.owned(owner) {
        if active.as_deref() != Some(&entry.runtime_id) {
            if let Some(window) = app.get_webview_window(&label(&id)) {
                window.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    let previous = state
        .registry
        .lock()
        .unwrap()
        .bindings
        .get(owner)
        .cloned()
        .unwrap_or_default();
    let mut verified = Vec::new();
    let mut result = SyncResult::default();
    for mut binding in sessions {
        if let Some(pi) = &binding.pi {
            if pi.session_id.is_empty() || pi.session_id.len() > 256 || !pi.path.is_absolute() {
                return Err("Invalid Pi pop-out owner".into());
            }
            if !previous
                .iter()
                .any(|old| old.runtime_id == binding.runtime_id && old.pi == binding.pi)
            {
                let path = pi.path.clone();
                let id = pi.session_id.clone();
                let cwd = cwd.clone();
                let info = tauri::async_runtime::spawn_blocking(move || {
                    crate::sessions::reported_file(&path, &cwd, &id)
                })
                .await
                .map_err(|e| e.to_string())?;
                match info {
                    Ok(info) if info.exists => {
                        binding.pi = Some(PiSessionRef {
                            path: info.path,
                            session_id: info.session_id,
                        })
                    }
                    Ok(_) => {
                        result.warnings.push(
                            "Pi session file is not yet saved; pop-outs remain runtime-only".into(),
                        );
                        binding.pi = None;
                    }
                    Err(e) => {
                        result
                            .warnings
                            .push(format!("Could not verify pop-out session: {e}"));
                        binding.pi = None;
                    }
                }
            }
        }
        verified.push(binding);
    }
    if !state.current(owner, revision) {
        return Ok(SyncResult::default());
    }
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    for (id, entry) in state.owned(owner) {
        if entry.saved.is_none()
            && let Some(pi) = verified
                .iter()
                .find(|s| s.runtime_id == entry.runtime_id)
                .and_then(|s| s.pi.clone())
        {
            let saved = SavedPopout {
                id: id.clone(),
                cwd: entry.cwd.clone(),
                pi,
                fingerprint: entry.fingerprint.clone(),
                geometry: window_state::cached(&app, &label(&id)),
            };
            match store.save_new(&saved, &entry.snapshot) {
                Ok(()) => {
                    if let Some(entry) = state.registry.lock().unwrap().entries.get_mut(&id) {
                        entry.saved = Some(saved);
                    }
                }
                Err(e) => result
                    .warnings
                    .push(format!("Could not persist pop-out: {e}")),
            }
        }
        if let Err(e) = save_geometry(&app, &id, true) {
            result
                .warnings
                .push(format!("Could not save pop-out geometry: {e}"));
        }
        if !verified
            .iter()
            .any(|binding| same_session(&entry, owner, binding))
        {
            // Session Close/reload releases native windows, not saved references.
            if let Some(window) = app.get_webview_window(&label(&id)) {
                let _ = window.hide();
                state.registry.lock().unwrap().entries.remove(&id);
                window_state::forget(&window.as_ref().window());
                let _ = window.destroy();
            }
        }
    }
    state
        .registry
        .lock()
        .unwrap()
        .bindings
        .insert(owner.into(), verified.clone());
    if let Some(binding) = verified
        .iter()
        .find(|s| Some(&s.runtime_id) == active.as_ref())
    {
        if let Some(pi) = &binding.pi {
            let (references, warnings) = store.references(&cwd, pi);
            result.warnings.extend(warnings);
            for saved in references {
                if !state.current(owner, revision) {
                    return Ok(result);
                }
                if !state
                    .registry
                    .lock()
                    .unwrap()
                    .entries
                    .contains_key(&saved.id)
                {
                    match store.load(&saved) {
                        Ok(snapshot) => {
                            let id = saved.id.clone();
                            let entry = PopoutEntry {
                                owner: owner.into(),
                                runtime_id: binding.runtime_id.clone(),
                                cwd: saved.cwd.clone(),
                                snapshot: Arc::new(snapshot),
                                fingerprint: saved.fingerprint.clone(),
                                saved: Some(saved),
                            };
                            if let Err(e) = create_window(&app, &id, entry) {
                                result
                                    .warnings
                                    .push(format!("Could not restore pop-out {id}: {e}"));
                            }
                        }
                        Err(e) => result
                            .warnings
                            .push(format!("Could not restore pop-out {}: {e}", saved.id)),
                    }
                }
            }
        }
        // Reopening the same session has a new mounted identity. Reattach by Pi provenance.
        let ids: Vec<String> = state
            .owned(owner)
            .into_iter()
            .filter(|(_, e)| same_session(e, owner, binding))
            .map(|(id, _)| id)
            .collect();
        for id in ids {
            if let Some(entry) = state.registry.lock().unwrap().entries.get_mut(&id) {
                entry.runtime_id = binding.runtime_id.clone();
            }
        }
    }
    for (id, entry) in state.owned(owner) {
        if !state.current(owner, revision) {
            return Ok(result);
        }
        if let Some(window) = app.get_webview_window(&label(&id)) {
            if active.as_deref() == Some(&entry.runtime_id) {
                crate::popout_windows::show_restored(&window).await?;
            } else {
                window.hide().map_err(|e| e.to_string())?;
            }
        }
    }
    Ok(result)
}

#[tauri::command]
pub async fn open_code_popout(
    app: tauri::AppHandle,
    window: tauri::Window,
    snapshot: CodeSnapshot,
) -> Result<(), String> {
    snapshot.validate()?;
    let cwd = project(&app, window.label())?;
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    if !state.selected(window.label(), &snapshot.session) {
        return Err("Select the source session before opening its pop-out".into());
    }
    let binding = state
        .registry
        .lock()
        .unwrap()
        .bindings
        .get(window.label())
        .and_then(|sessions| sessions.iter().find(|s| s.runtime_id == snapshot.session))
        .cloned()
        .ok_or("Pop-out session is not registered")?;
    let hash = fingerprint(&snapshot.language, &snapshot.text);
    let mut existing = state
        .owned(window.label())
        .into_iter()
        .find(|(_, e)| same_session(e, window.label(), &binding) && e.fingerprint == hash)
        .map(|(id, _)| id);
    if existing.is_none()
        && let Some(pi) = &binding.pi
    {
        let preferences = app.state::<Preferences>();
        let store = SnapshotStore(&preferences);
        let (references, warnings) = store.references(&cwd, pi);
        for warning in warnings {
            notify_error(&app, warning);
        }
        if let Some(saved) = references.into_iter().find(|s| s.fingerprint == hash) {
            let restored = store.load(&saved)?;
            let id = saved.id.clone();
            create_window(
                &app,
                &id,
                PopoutEntry {
                    owner: window.label().into(),
                    runtime_id: binding.runtime_id.clone(),
                    cwd: cwd.clone(),
                    snapshot: Arc::new(restored),
                    fingerprint: hash.clone(),
                    saved: Some(saved),
                },
            )?;
            existing = Some(id);
        }
    }
    let id = if let Some(id) = existing {
        id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        let saved = binding.pi.clone().map(|pi| SavedPopout {
            id: id.clone(),
            cwd: cwd.clone(),
            pi,
            fingerprint: hash.clone(),
            geometry: None,
        });
        if let Some(saved) = &saved {
            SnapshotStore(&app.state::<Preferences>()).save_new(saved, &snapshot)?;
        }
        let entry = PopoutEntry {
            owner: window.label().into(),
            runtime_id: binding.runtime_id.clone(),
            cwd,
            snapshot: Arc::new(snapshot),
            fingerprint: hash,
            saved,
        };
        // If native creation fails, the durable snapshot remains referenced for retry.
        create_window(&app, &id, entry)?;
        id
    };
    if state.selected(window.label(), &binding.runtime_id)
        && let Some(popout) = app.get_webview_window(&label(&id))
    {
        popout.show().map_err(|e| e.to_string())?;
        popout.unminimize().map_err(|e| e.to_string())?;
        popout.set_focus().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn notify_error(app: &tauri::AppHandle, error: impl Into<String>) {
    let _ = app.emit("nimrod-popout-error", error.into());
}

/// Explicit pop-out Close removes persistence; project Close and app Quit do not.
pub async fn close_popout(window: tauri::Window) {
    let app = window.app_handle();
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    let Some(id) = window.label().strip_prefix("popout-") else {
        return;
    };
    if app
        .state::<crate::ExitState>()
        .closing
        .load(Ordering::SeqCst)
    {
        if let Err(e) = save_geometry(app, id, true) {
            notify_error(app, e);
        }
        return;
    }
    let saved = state
        .registry
        .lock()
        .unwrap()
        .entries
        .get(id)
        .is_some_and(|e| e.saved.is_some());
    if saved {
        match SnapshotStore(&app.state::<Preferences>()).remove(id) {
            Ok(Some(warning)) => notify_error(app, warning),
            Ok(None) => {}
            Err(e) => {
                notify_error(
                    app,
                    format!("Could not close pop-out; saved snapshot retained: {e}"),
                );
                return;
            }
        }
    }
    state.registry.lock().unwrap().entries.remove(id);
    window_state::forget(&window);
    let _ = window.destroy();
}

pub async fn close_project(app: &tauri::AppHandle, owner: &str) {
    let state = app.state::<Popouts>();
    state.retire(owner);
    let _operations = state.operations.lock().await;
    for (id, _) in state.owned(owner) {
        if let Err(e) = save_geometry(app, &id, true) {
            notify_error(app, e);
        }
        if let Some(window) = app.get_webview_window(&label(&id)) {
            let _ = window.hide();
            state.registry.lock().unwrap().entries.remove(&id);
            window_state::forget(&window.as_ref().window());
            let _ = window.destroy();
        }
    }
    state.registry.lock().unwrap().bindings.remove(owner);
}

pub async fn flush(app: &tauri::AppHandle) {
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    save_cached(app);
}
pub fn save_cached(app: &tauri::AppHandle) {
    let ids: Vec<String> = app
        .state::<Popouts>()
        .registry
        .lock()
        .unwrap()
        .entries
        .keys()
        .cloned()
        .collect();
    for id in ids {
        if let Err(e) = save_geometry(app, &id, false) {
            eprintln!("Nimrod pop-out state: {e}");
        }
    }
}

#[tauri::command]
pub async fn open_popout_link(
    state: tauri::State<'_, Popouts>,
    window: tauri::Window,
    href: String,
) -> Result<(), String> {
    let id = window
        .label()
        .strip_prefix("popout-")
        .ok_or("Not a pop-out window")?;
    let cwd = state
        .registry
        .lock()
        .unwrap()
        .entries
        .get(id)
        .map(|e| e.cwd.clone())
        .ok_or("This code pop-out is no longer available")?;
    crate::open_link_at(&href, &cwd).await
}
#[tauri::command]
pub fn code_popout_snapshot(
    state: tauri::State<'_, Popouts>,
    window: tauri::Window,
) -> Result<CodeSnapshot, String> {
    let id = window
        .label()
        .strip_prefix("popout-")
        .ok_or("Not a pop-out window")?;
    state
        .registry
        .lock()
        .unwrap()
        .entries
        .get(id)
        .map(|e| e.snapshot.as_ref().clone())
        .ok_or_else(|| "This code pop-out is no longer available".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn selection_is_window_scoped_and_retirement_invalidates_in_flight_work() {
        let state = Popouts::default();
        state
            .registry
            .lock()
            .unwrap()
            .desired
            .insert("project-a".into(), (1, Some("session-a".into())));
        state
            .registry
            .lock()
            .unwrap()
            .desired
            .insert("project-b".into(), (2, Some("session-b".into())));
        assert!(state.selected("project-a", "session-a"));
        assert!(!state.selected("project-a", "session-b"));
        assert!(!state.current("project-a", 0));
        assert!(state.current("project-a", 1));
        state.retire("project-a");
        assert!(!state.current("project-a", 1));
        assert!(!state.selected("project-a", "session-a"));
        assert!(state.selected("project-b", "session-b"));
    }
    #[test]
    fn persistent_matching_ignores_runtime_and_transcript_identity_but_not_session() {
        let pi = PiSessionRef {
            path: "/project/a.jsonl".into(),
            session_id: "a".into(),
        };
        let snapshot = CodeSnapshot {
            session: "old-runtime".into(),
            title: "A".into(),
            text: "same".into(),
            language: "ts".into(),
        };
        let saved = SavedPopout {
            id: uuid::Uuid::new_v4().to_string(),
            cwd: "/project".into(),
            pi: pi.clone(),
            fingerprint: fingerprint("ts", "same"),
            geometry: None,
        };
        let entry = PopoutEntry {
            owner: "window-a".into(),
            runtime_id: snapshot.session.clone(),
            cwd: saved.cwd.clone(),
            fingerprint: saved.fingerprint.clone(),
            snapshot: Arc::new(snapshot),
            saved: Some(saved),
        };
        let binding = SessionBinding {
            runtime_id: "new-runtime".into(),
            pi: Some(pi),
        };
        assert!(same_session(&entry, "window-a", &binding));
        assert!(!same_session(&entry, "window-b", &binding));
        let other = SessionBinding {
            pi: Some(PiSessionRef {
                path: "/project/a.jsonl".into(),
                session_id: "replacement".into(),
            }),
            ..binding
        };
        assert!(!same_session(&entry, "window-a", &other));
    }
}
