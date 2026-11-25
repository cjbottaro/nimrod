use crate::{
    popout_store::{
        CodeSnapshot, NamedSessionRef, NoteDetails, NoteSession, PiSessionRef, ResponseTrim,
        SavedPopout, SnapshotStore,
    },
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
    pub named: Option<NamedSessionRef>,
}
impl SessionBinding {
    fn session(&self) -> Option<NoteSession> {
        self.pi
            .clone()
            .map(NoteSession::Pi)
            .or_else(|| self.named.clone().map(NoteSession::Named))
    }
}

#[derive(Clone)]
struct PopoutEntry {
    owner: String,
    runtime_id: String,
    cwd: PathBuf,
    snapshot: Arc<CodeSnapshot>,
    fingerprint: String,
    saved: Option<SavedPopout>,
    trim: Option<ResponseTrim>,
    details: NoteDetails,
    open: bool,
    runtime_geometry: Option<window_state::Geometry>,
}
#[derive(Default)]
struct Registry {
    entries: HashMap<String, PopoutEntry>, // Nimrod UUID -> window and snapshot.
    bindings: HashMap<String, Vec<SessionBinding>>,
    desired: HashMap<String, (u64, Option<String>)>,
    retired: HashSet<String>,
    focused_window: Option<String>,
    deleted_named: HashSet<(PathBuf, String)>,
}
impl Registry {
    fn focused_owner(&self) -> Option<&str> {
        let label = self.focused_window.as_deref()?;
        if let Some(id) = label.strip_prefix("popout-") {
            self.entries.get(id).map(|entry| entry.owner.as_str())
        } else {
            Some(label)
        }
    }
    fn selected(&self, owner: &str, runtime: &str) -> bool {
        !self.retired.contains(owner)
            && self.desired.get(owner).and_then(|(_, id)| id.as_deref()) == Some(runtime)
    }
}
#[derive(Default)]
pub struct Popouts {
    registry: Mutex<Registry>,
    next: AtomicU64,
    operations: tokio::sync::Mutex<()>,
}
impl Popouts {
    pub fn reference_project(&self, label: &str) -> Option<PathBuf> {
        let id = label.strip_prefix("popout-")?;
        self.registry
            .lock()
            .unwrap()
            .entries
            .get(id)
            .map(|entry| entry.cwd.clone())
    }
    pub fn focused_owner(&self) -> Option<String> {
        self.registry
            .lock()
            .unwrap()
            .focused_owner()
            .map(str::to_owned)
    }
    pub fn retire(&self, owner: &str) {
        let mut registry = self.registry.lock().unwrap();
        registry.retired.insert(owner.into());
        registry.desired.remove(owner);
    }
    pub fn forget_window(&self, label: &str) {
        if let Some(id) = label.strip_prefix("popout-") {
            let mut registry = self.registry.lock().unwrap();
            if registry.entries.get(id).is_some_and(|entry| entry.open) {
                registry.entries.remove(id);
            }
        }
    }
    // Ignore blur: moving from the project to its own reference must not hide it.
    // Record focus synchronously, before any queued native visibility work.
    pub fn on_focus(&self, label: &str, focused: bool) -> bool {
        if !focused {
            return false;
        }
        let mut registry = self.registry.lock().unwrap();
        if registry.retired.contains(label)
            || label
                .strip_prefix("popout-")
                .is_some_and(|id| !registry.entries.get(id).is_some_and(|entry| entry.open))
        {
            return false;
        }
        let previous = registry.focused_owner().map(str::to_owned);
        registry.focused_window = Some(label.into());
        previous.as_deref() != registry.focused_owner()
    }
    fn visible(&self, owner: &str, runtime: &str) -> bool {
        let registry = self.registry.lock().unwrap();
        registry.focused_owner() == Some(owner) && registry.selected(owner, runtime)
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
        && match &entry.saved {
            Some(saved) => binding.session().as_ref() == Some(&saved.session),
            None => entry.runtime_id == binding.runtime_id,
        }
}

impl PopoutEntry {
    fn restored(
        owner: &str,
        binding: &SessionBinding,
        saved: SavedPopout,
        snapshot: CodeSnapshot,
    ) -> Self {
        let details = saved
            .details
            .clone()
            .unwrap_or_else(|| NoteDetails::capture(&snapshot, 0));
        Self {
            owner: owner.into(),
            runtime_id: binding.runtime_id.clone(),
            cwd: saved.cwd.clone(),
            fingerprint: saved.fingerprint.clone(),
            trim: saved.trim,
            details,
            open: saved.open,
            runtime_geometry: None,
            snapshot: Arc::new(snapshot),
            saved: Some(saved),
        }
    }
    fn reference(
        &self,
        id: &str,
        session: NoteSession,
        geometry: Option<window_state::Geometry>,
    ) -> SavedPopout {
        SavedPopout {
            id: id.into(),
            cwd: self.cwd.clone(),
            session,
            fingerprint: self.fingerprint.clone(),
            open: self.open,
            geometry: geometry.or_else(|| self.runtime_geometry.clone()),
            trim: self.trim,
            details: Some(self.details.clone()),
        }
    }
}

async fn create_window(app: &tauri::AppHandle, id: &str, entry: PopoutEntry) -> Result<(), String> {
    let geometry = entry
        .saved
        .as_ref()
        .and_then(|s| s.geometry.clone())
        .or_else(|| entry.runtime_geometry.clone());
    app.state::<Popouts>()
        .registry
        .lock()
        .unwrap()
        .entries
        .insert(id.into(), entry);
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        label(id),
        tauri::WebviewUrl::App("index.html?popout".into()),
    );
    let result = crate::window_presentation::prepare(builder, app, &label(id))
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
    if let Err(error) = crate::popout_windows::configure_reference(&window).await {
        app.state::<Popouts>()
            .registry
            .lock()
            .unwrap()
            .entries
            .remove(id);
        window_state::forget(&window.as_ref().window());
        let _ = window.destroy();
        // Keep any saved snapshot/reference so a later restore can retry.
        return Err(error);
    }
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
        SnapshotStore(&app.state::<Preferences>()).update_reference(&saved)?;
        if let Some(entry) = state.registry.lock().unwrap().entries.get_mut(id) {
            entry.saved = Some(saved);
        }
    }
    Ok(())
}

async fn apply_visibility(
    app: &tauri::AppHandle,
    id: &str,
    entry: &PopoutEntry,
) -> Result<(), String> {
    if !entry.open {
        return Ok(());
    }
    let Some(window) = app.get_webview_window(&label(id)) else {
        return Ok(());
    };
    if app
        .state::<Popouts>()
        .visible(&entry.owner, &entry.runtime_id)
    {
        let app = app.clone();
        let owner = entry.owner.clone();
        let runtime = entry.runtime_id.clone();
        crate::popout_windows::show_restored(&window, move || {
            !app.state::<crate::ExitState>()
                .closing
                .load(Ordering::SeqCst)
                && app.state::<Popouts>().visible(&owner, &runtime)
        })
        .await?;
    } else {
        window.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Hide outgoing references immediately, without waiting behind snapshot IO or
/// window restoration. Focus events call this after updating the scope registry.
pub fn hide_inactive(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Popouts>();
    let entries: Vec<_> = state
        .registry
        .lock()
        .unwrap()
        .entries
        .iter()
        .map(|(id, entry)| (id.clone(), entry.clone()))
        .collect();
    for (id, entry) in entries {
        if !state.visible(&entry.owner, &entry.runtime_id)
            && let Some(window) = app.get_webview_window(&label(&id))
        {
            window.hide().map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

/// Focus routing has no session launch/restore or persistence side effects. It only
/// presents existing reference windows using the latest project/session selection.
pub async fn reconcile_visibility(app: &tauri::AppHandle) -> Result<(), String> {
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    if app
        .state::<crate::ExitState>()
        .closing
        .load(Ordering::SeqCst)
    {
        return Ok(());
    }
    let entries: Vec<_> = state
        .registry
        .lock()
        .unwrap()
        .entries
        .iter()
        .map(|(id, entry)| (id.clone(), entry.clone()))
        .collect();
    // Hide every outgoing project's windows before revealing the incoming ones.
    hide_inactive(app)?;
    for (id, entry) in &entries {
        if state.visible(&entry.owner, &entry.runtime_id) {
            apply_visibility(app, id, entry).await?;
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
    // Initial native focus can precede frontend mounting. Do not overwrite a newer
    // focus event while seeding the first selection if no event was observed.
    if window.is_focused().unwrap_or(false) {
        let mut registry = state.registry.lock().unwrap();
        if registry.focused_window.is_none() {
            registry.focused_window = Some(owner.into());
        }
    }
    let revision = state.next.fetch_add(1, Ordering::SeqCst);
    state
        .registry
        .lock()
        .unwrap()
        .desired
        .insert(owner.into(), (revision, active.clone()));
    hide_inactive(&app)?;
    let _operations = state.operations.lock().await;
    if !state.current(owner, revision) {
        return Ok(SyncResult::default());
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
        if let Some(named) = &binding.named {
            if binding.pi.is_some() || !named.valid() {
                return Err("Invalid session note owner".into());
            }
            if state
                .registry
                .lock()
                .unwrap()
                .deleted_named
                .contains(&(cwd.clone(), NoteSession::Named(named.clone()).key()))
            {
                continue;
            }
        }
        if let Some(pi) = &binding.pi {
            if app
                .state::<crate::session_deletion::SessionDeletion>()
                .removed(&pi.path)
            {
                continue;
            }
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
            && let Some(session) = verified
                .iter()
                .find(|s| s.runtime_id == entry.runtime_id)
                .and_then(SessionBinding::session)
        {
            let saved = entry.reference(&id, session, window_state::cached(&app, &label(&id)));
            match store.save_new(&saved, &entry.snapshot) {
                Ok(()) => {
                    let mut registry = state.registry.lock().unwrap();
                    if !entry.open {
                        registry.entries.remove(&id);
                        continue;
                    }
                    if let Some(entry) = registry.entries.get_mut(&id) {
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
            // Session Close/reload releases native windows, not saved notes.
            state.registry.lock().unwrap().entries.remove(&id);
            if let Some(window) = app.get_webview_window(&label(&id)) {
                let _ = window.hide();
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
        if let Some(session) = binding.session() {
            let (references, warnings) = store.references(&cwd, &session);
            result.warnings.extend(warnings);
            for saved in references.into_iter().filter(|note| note.open) {
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
                            let entry = PopoutEntry::restored(owner, binding, saved, snapshot);
                            if let Err(e) = create_window(&app, &id, entry).await {
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
        // Reopening the same session can change the mounted identity, not the saved note owner.
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
        apply_visibility(&app, &id, &entry).await?;
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
    if !state.visible(window.label(), &snapshot.session) {
        return Err("Select the source project and session before opening its pop-out".into());
    }
    let binding = note_binding(&app, window.label(), &snapshot.session)?;
    let hash = snapshot.fingerprint();
    if let Some((id, entry)) = state.owned(window.label()).into_iter().find(|(_, entry)| {
        same_session(entry, window.label(), &binding) && entry.fingerprint == hash
    }) {
        return open_note_entry(&app, &id, entry).await;
    }
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    if let Some(saved) = note_references(&app, &store, &cwd, &binding)
        .into_iter()
        .find(|s| s.fingerprint == hash)
    {
        let id = saved.id.clone();
        let restored = store.load(&saved)?;
        return open_note_entry(
            &app,
            &id,
            PopoutEntry::restored(window.label(), &binding, saved, restored),
        )
        .await;
    }
    let id = uuid::Uuid::new_v4().to_string();
    let created = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let details = NoteDetails::capture(&snapshot, created);
    let mut entry = PopoutEntry {
        owner: window.label().into(),
        runtime_id: binding.runtime_id.clone(),
        cwd,
        details,
        snapshot: Arc::new(snapshot),
        fingerprint: hash,
        saved: None,
        trim: None,
        open: true,
        runtime_geometry: None,
    };
    if let Some(session) = binding.session() {
        let saved = entry.reference(&id, session, None);
        store.save_new(&saved, &entry.snapshot)?;
        entry.saved = Some(saved);
    }
    open_note_entry(&app, &id, entry).await
}

fn note_binding(
    app: &tauri::AppHandle,
    owner: &str,
    session: &str,
) -> Result<SessionBinding, String> {
    let binding = app
        .state::<Popouts>()
        .registry
        .lock()
        .unwrap()
        .bindings
        .get(owner)
        .and_then(|sessions| sessions.iter().find(|s| s.runtime_id == session))
        .cloned()
        .ok_or("Session is not registered for notes")?;
    if binding.pi.as_ref().is_some_and(|pi| {
        app.state::<crate::session_deletion::SessionDeletion>()
            .notes_blocked(&pi.path)
    }) {
        return Err("This session is unavailable after deletion".into());
    }
    Ok(binding)
}

fn note_references(
    app: &tauri::AppHandle,
    store: &SnapshotStore<'_>,
    cwd: &std::path::Path,
    binding: &SessionBinding,
) -> Vec<SavedPopout> {
    let Some(session) = binding.session() else {
        return Vec::new();
    };
    let (references, warnings) = store.references(cwd, &session);
    for warning in warnings {
        notify_error(app, warning);
    }
    references
}

async fn open_note_entry(
    app: &tauri::AppHandle,
    id: &str,
    mut entry: PopoutEntry,
) -> Result<(), String> {
    let state = app.state::<Popouts>();
    if !state.visible(&entry.owner, &entry.runtime_id) {
        return Err("Select the note’s session before opening it".into());
    }
    if app.get_webview_window(&label(id)).is_none() {
        if let Some(saved) = entry.saved.as_mut().filter(|saved| !saved.open) {
            saved.open = true;
            SnapshotStore(&app.state::<Preferences>()).update_reference(saved)?;
        }
        entry.open = true;
        if let Err(error) = create_window(app, id, entry.clone()).await {
            if entry.saved.is_none() {
                entry.open = false;
                state
                    .registry
                    .lock()
                    .unwrap()
                    .entries
                    .insert(id.into(), entry);
            }
            return Err(error);
        }
    }
    if state.visible(&entry.owner, &entry.runtime_id)
        && let Some(popout) = app.get_webview_window(&label(id))
    {
        crate::window_presentation::focus_reference(&popout)?;
    }
    Ok(())
}

#[derive(Serialize)]
pub struct NoteSummary {
    id: String,
    open: bool,
    #[serde(flatten)]
    details: NoteDetails,
}

#[tauri::command]
pub async fn list_session_notes(
    app: tauri::AppHandle,
    window: tauri::Window,
    session: String,
) -> Result<Vec<NoteSummary>, String> {
    let owner = window.label();
    let cwd = project(&app, owner)?;
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    let binding = note_binding(&app, owner, &session)?;
    let mut notes: HashMap<_, _> = state
        .owned(owner)
        .into_iter()
        .filter(|(_, e)| same_session(e, owner, &binding))
        .map(|(id, entry)| {
            (
                id.clone(),
                NoteSummary {
                    id,
                    open: entry.open,
                    details: entry.details,
                },
            )
        })
        .collect();
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    for saved in note_references(&app, &store, &cwd, &binding) {
        if notes.contains_key(&saved.id) {
            continue;
        }
        let details = saved
            .details
            .clone()
            .or_else(|| {
                store
                    .load(&saved)
                    .ok()
                    .map(|snapshot| NoteDetails::capture(&snapshot, 0))
            })
            .unwrap_or(NoteDetails {
                title: "Saved note".into(),
                preview: "Preview unavailable".into(),
                created: 0,
            });
        notes.insert(
            saved.id.clone(),
            NoteSummary {
                id: saved.id,
                open: false,
                details,
            },
        );
    }
    let mut notes: Vec<_> = notes.into_values().collect();
    notes.sort_by(|a, b| {
        b.details
            .created
            .cmp(&a.details.created)
            .then_with(|| a.id.cmp(&b.id))
    });
    Ok(notes)
}

#[tauri::command]
pub async fn open_session_note(
    app: tauri::AppHandle,
    window: tauri::Window,
    session: String,
    id: String,
) -> Result<(), String> {
    let owner = window.label();
    let cwd = project(&app, owner)?;
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    if !state.visible(owner, &session) {
        return Err("Select the note’s session before opening it".into());
    }
    let binding = note_binding(&app, owner, &session)?;
    if let Some((_, entry)) = state
        .owned(owner)
        .into_iter()
        .find(|(key, e)| key == &id && same_session(e, owner, &binding))
    {
        return open_note_entry(&app, &id, entry).await;
    }
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    let saved = note_references(&app, &store, &cwd, &binding)
        .into_iter()
        .find(|note| note.id == id)
        .ok_or("Note is no longer available")?;
    let snapshot = store.load(&saved)?;
    open_note_entry(
        &app,
        &id,
        PopoutEntry::restored(owner, &binding, saved, snapshot),
    )
    .await
}

#[tauri::command]
pub async fn delete_session_note(
    app: tauri::AppHandle,
    window: tauri::Window,
    session: String,
    id: String,
) -> Result<(), String> {
    let owner = window.label();
    let cwd = project(&app, owner)?;
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    let binding = note_binding(&app, owner, &session)?;
    let entry = state
        .owned(owner)
        .into_iter()
        .find(|(key, e)| key == &id && same_session(e, owner, &binding));
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    let saved = note_references(&app, &store, &cwd, &binding)
        .into_iter()
        .any(|note| note.id == id)
        || entry.as_ref().is_some_and(|(_, e)| e.saved.is_some());
    if !saved && entry.is_none() {
        return Err("Note is no longer available".into());
    }
    let warning = if saved { store.remove(&id)? } else { None };
    destroy_note_window(&app, &id)?;
    if let Some(warning) = warning {
        return Err(warning);
    }
    Ok(())
}

fn destroy_note_window(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    app.state::<Popouts>()
        .registry
        .lock()
        .unwrap()
        .entries
        .remove(id);
    if let Some(window) = app.get_webview_window(&label(id)) {
        let _ = window.hide();
        window_state::forget(&window.as_ref().window());
        window.destroy().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn notify_error(app: &tauri::AppHandle, error: impl Into<String>) {
    let _ = app.emit("nimrod-popout-error", error.into());
}

/// Successful session deletion is distinct from source Close: purge every saved
/// snapshot, including references whose project is not currently mounted.
pub async fn delete_sessions(
    app: &tauri::AppHandle,
    files: &HashSet<PathBuf>,
) -> Result<(), String> {
    if files.is_empty() {
        return Ok(());
    }
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    let mut saved: HashSet<_> = store.session_ids(files).into_iter().collect();
    saved.extend(
        state
            .registry
            .lock()
            .unwrap()
            .entries
            .iter()
            .filter_map(|(id, entry)| {
                entry
                    .saved
                    .as_ref()
                    .filter(|saved| matches!(&saved.session, NoteSession::Pi(pi) if files.contains(&pi.path)))
                    .map(|_| id.clone())
            }),
    );
    let mut removed = HashSet::new();
    let mut errors = Vec::new();
    for id in saved {
        match store.remove(&id) {
            Ok(warning) => {
                removed.insert(id);
                if let Some(warning) = warning {
                    errors.push(warning);
                }
            }
            Err(error) => errors.push(error),
        }
    }
    let ids: Vec<_> = {
        let registry = state.registry.lock().unwrap();
        registry
            .entries
            .iter()
            .filter_map(|(id, entry)| {
                let runtime_deleted = entry.saved.is_none()
                    && registry.bindings.get(&entry.owner).is_some_and(|bindings| {
                        bindings.iter().any(|binding| {
                            binding.runtime_id == entry.runtime_id
                                && binding
                                    .pi
                                    .as_ref()
                                    .is_some_and(|pi| files.contains(&pi.path))
                        })
                    });
                (removed.contains(id) || runtime_deleted).then(|| id.clone())
            })
            .collect()
    };
    for id in ids {
        state.registry.lock().unwrap().entries.remove(&id);
        if let Some(window) = app.get_webview_window(&label(&id)) {
            let _ = window.hide();
            window_state::forget(&window.as_ref().window());
            if let Err(error) = window.destroy() {
                errors.push(error.to_string());
            }
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

fn scoped_keys(keys: Vec<String>) -> Result<HashSet<String>, String> {
    if keys.len() > 10_000 || keys.iter().any(|key| key.is_empty() || key.len() > 32_768) {
        return Err("Invalid session note scope".into());
    }
    Ok(keys.into_iter().collect())
}

#[tauri::command]
pub async fn count_session_notes(
    app: tauri::AppHandle,
    window: tauri::Window,
    keys: Vec<String>,
) -> Result<usize, String> {
    let cwd = project(&app, window.label())?;
    let keys = scoped_keys(keys)?;
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    Ok(SnapshotStore(&app.state::<Preferences>())
        .ids_for_keys(&cwd, &keys)
        .len())
}

/// Shared deletion reconciliation supplies only confirmed cleanup keys. Pi also
/// purges at its native transaction boundary to include unmounted descendant projects.
#[tauri::command]
pub async fn purge_session_notes(
    app: tauri::AppHandle,
    window: tauri::Window,
    keys: Vec<String>,
) -> Result<(), String> {
    let owner = window.label();
    // Confirmed cleanup must still run while the project window is retiring.
    let cwd = app
        .state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(owner)
        .cloned()
        .ok_or("Session notes require a project window")?;
    let keys = scoped_keys(keys)?;
    if keys.is_empty() {
        return Ok(());
    }
    let state = app.state::<Popouts>();
    let _operations = state.operations.lock().await;
    let preferences = app.state::<Preferences>();
    let store = SnapshotStore(&preferences);
    let mut ids: HashMap<_, _> = store
        .ids_for_keys(&cwd, &keys)
        .into_iter()
        .map(|id| (id, true))
        .collect();
    {
        let mut registry = state.registry.lock().unwrap();
        let matches = |binding: &SessionBinding| {
            binding
                .session()
                .is_some_and(|session| keys.contains(&session.key()))
        };
        let runtime: HashSet<_> = registry
            .bindings
            .get(owner)
            .into_iter()
            .flatten()
            .filter(|binding| matches(binding))
            .map(|binding| binding.runtime_id.clone())
            .collect();
        for (id, entry) in &registry.entries {
            if entry.owner == owner
                && (entry
                    .saved
                    .as_ref()
                    .is_some_and(|note| keys.contains(&note.session.key()))
                    || entry.saved.is_none() && runtime.contains(&entry.runtime_id))
            {
                ids.insert(id.clone(), entry.saved.is_some());
            }
        }
        if let Some(bindings) = registry.bindings.get_mut(owner) {
            bindings.retain(|binding| !matches(binding));
        }
        registry.deleted_named.extend(
            keys.into_iter()
                .filter(|key| !std::path::Path::new(key).is_absolute())
                .map(|key| (cwd.clone(), key)),
        );
    }
    let mut errors = Vec::new();
    for (id, saved) in ids {
        if saved {
            match store.remove(&id) {
                Ok(warning) => errors.extend(warning),
                Err(error) => {
                    errors.push(error);
                    continue;
                }
            }
        }
        if let Err(error) = destroy_note_window(&app, &id) {
            errors.push(error);
        }
    }
    if errors.is_empty() {
        Ok(())
    } else {
        Err(errors.join("; "))
    }
}

/// Explicit Close changes the window's restore intent, not the note's lifetime.
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
    let entry = state.registry.lock().unwrap().entries.get(id).cloned();
    if let Some(mut entry) = entry {
        if !entry.open {
            return;
        }
        window_state::capture(&window);
        let geometry = window_state::cached(app, window.label());
        if let Some(mut saved) = entry.saved.take() {
            saved.open = false;
            saved.geometry = geometry.or(saved.geometry);
            saved.details = Some(entry.details);
            if let Err(error) = SnapshotStore(&app.state::<Preferences>()).update_reference(&saved)
            {
                notify_error(app, format!("Could not close note window: {error}"));
                return;
            }
            state.registry.lock().unwrap().entries.remove(id);
        } else {
            entry.open = false;
            entry.runtime_geometry = geometry;
            state
                .registry
                .lock()
                .unwrap()
                .entries
                .insert(id.into(), entry);
        }
    }
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
        if let Err(e) = destroy_note_window(app, &id) {
            notify_error(app, e);
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
        .ok_or("This pop-out is no longer available")?;
    crate::open_link_at(&href, &cwd).await
}
#[derive(Serialize)]
pub struct PopoutViewSnapshot {
    #[serde(flatten)]
    snapshot: CodeSnapshot,
    #[serde(skip_serializing_if = "Option::is_none")]
    trim: Option<ResponseTrim>,
}

#[tauri::command]
pub fn code_popout_snapshot(
    state: tauri::State<'_, Popouts>,
    window: tauri::Window,
) -> Result<PopoutViewSnapshot, String> {
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
        .map(|e| PopoutViewSnapshot {
            snapshot: e.snapshot.as_ref().clone(),
            trim: e.trim,
        })
        .ok_or_else(|| "This pop-out is no longer available".into())
}

#[tauri::command]
pub async fn set_response_popout_trim(
    app: tauri::AppHandle,
    window: tauri::Window,
    trim: Option<ResponseTrim>,
) -> Result<(), String> {
    let id = window
        .label()
        .strip_prefix("popout-")
        .ok_or("Not a pop-out window")?;
    let state = app.state::<Popouts>();
    // Serialize with geometry updates, first-save promotion and deletion.
    let _operations = state.operations.lock().await;
    let entry = state
        .registry
        .lock()
        .unwrap()
        .entries
        .get(id)
        .cloned()
        .ok_or("This pop-out is no longer available")?;
    if !entry.snapshot.response {
        return Err("This pop-out is not a response".into());
    }
    entry.snapshot.validate_trim(trim)?;
    if entry.trim == trim {
        return Ok(());
    }
    let mut saved = entry.saved;
    if let Some(reference) = saved.as_mut() {
        reference.trim = trim;
        SnapshotStore(&app.state::<Preferences>()).update_reference(reference)?;
    }
    if let Some(entry) = state.registry.lock().unwrap().entries.get_mut(id) {
        entry.trim = trim;
        entry.saved = saved;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::popout_store::fingerprint;
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
        state.on_focus("project-a", true);
        assert!(state.visible("project-a", "session-a"));
        assert!(!state.visible("project-a", "session-b"));
        assert!(!state.visible("project-b", "session-b"));
        assert!(!state.current("project-a", 0));
        assert!(state.current("project-a", 1));
        state.retire("project-a");
        assert!(!state.current("project-a", 1));
        assert!(!state.visible("project-a", "session-a"));
        state.on_focus("project-b", true);
        assert!(state.visible("project-b", "session-b"));
    }
    fn focus_fixture() -> Popouts {
        let state = Popouts::default();
        let mut registry = state.registry.lock().unwrap();
        for (owner, runtime, id) in [
            ("project-a", "session-a", "reference-a"),
            ("project-b", "session-b", "reference-b"),
        ] {
            registry
                .desired
                .insert(owner.into(), (1, Some(runtime.into())));
            registry.entries.insert(
                id.into(),
                PopoutEntry {
                    owner: owner.into(),
                    runtime_id: runtime.into(),
                    cwd: format!("/{owner}").into(),
                    snapshot: Arc::new(CodeSnapshot {
                        session: runtime.into(),
                        title: String::new(),
                        text: "reference".into(),
                        language: "text".into(),
                        response: false,
                    }),
                    fingerprint: fingerprint("text", "reference"),
                    details: NoteDetails {
                        title: "Reference".into(),
                        preview: String::new(),
                        created: 0,
                    },
                    saved: None,
                    trim: None,
                    open: true,
                    runtime_geometry: None,
                },
            );
        }
        drop(registry);
        state
    }
    #[test]
    fn project_window_switch_hides_previous_scope_and_retains_each_selected_session() {
        let state = focus_fixture();
        assert!(!state.visible("project-a", "session-a"));
        assert!(state.on_focus("project-a", true));
        assert!(state.visible("project-a", "session-a"));
        assert!(!state.visible("project-a", "other-session"));
        assert!(!state.visible("project-b", "session-b"));
        assert!(state.on_focus("project-b", true));
        assert!(!state.visible("project-a", "session-a"));
        assert!(state.visible("project-b", "session-b"));
        assert!(state.on_focus("project-a", true));
        assert!(state.visible("project-a", "session-a"));
        assert!(!state.visible("project-b", "session-b"));
        assert_eq!(state.registry.lock().unwrap().desired.len(), 2);
        assert_eq!(state.registry.lock().unwrap().entries.len(), 2);
    }
    #[test]
    fn focusing_own_popout_or_blurring_to_another_app_does_not_hide_references() {
        let state = focus_fixture();
        state.on_focus("project-a", true);
        assert!(!state.on_focus("project-a", false));
        assert!(state.visible("project-a", "session-a"));
        assert!(!state.on_focus("popout-reference-a", true));
        assert!(state.visible("project-a", "session-a"));
        assert!(!state.visible("project-b", "session-b"));
        assert!(!state.on_focus("popout-reference-a", false));
        assert!(!state.on_focus("project-a", true));
        assert!(state.visible("project-a", "session-a"));
    }
    #[test]
    fn welcome_window_hides_project_references_and_late_unknown_popout_focus_is_ignored() {
        let state = focus_fixture();
        state.on_focus("project-b", true);
        assert!(!state.on_focus("popout-destroyed", true));
        assert!(state.visible("project-b", "session-b"));
        assert!(state.on_focus("welcome", true));
        assert!(!state.visible("project-a", "session-a"));
        assert!(!state.visible("project-b", "session-b"));
        assert!(state.on_focus("project-a", true));
        state.retire("project-a");
        assert!(!state.on_focus("project-a", true));
        assert!(!state.visible("project-a", "session-a"));
    }
    #[tokio::test]
    async fn focus_updates_invalidate_pending_show_guards_while_native_operations_are_busy() {
        let state = focus_fixture();
        state.on_focus("project-a", true);
        let _operations = state.operations.lock().await;
        let pending_show = || state.visible("project-a", "session-a");
        assert!(pending_show());
        // The native focus event does not wait for restore/persistence serialization.
        assert!(state.on_focus("project-b", true));
        assert!(!pending_show());
        assert!(state.visible("project-b", "session-b"));
        state
            .registry
            .lock()
            .unwrap()
            .desired
            .insert("project-a".into(), (2, Some("new-session-a".into())));
        assert!(!state.visible("project-a", "new-session-a"));
        assert!(!state.on_focus("project-a", false));
        assert!(state.visible("project-b", "session-b"));
    }
    #[test]
    fn closing_focused_popout_then_returning_to_project_restores_the_scope() {
        let state = focus_fixture();
        state.on_focus("project-a", true);
        state.on_focus("popout-reference-a", true);
        state.forget_window("popout-reference-a");
        assert!(!state.visible("project-a", "session-a"));
        assert!(state.on_focus("project-a", true));
        assert!(state.visible("project-a", "session-a"));
        assert!(!state.visible("project-b", "session-b"));
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
            response: false,
        };
        let saved = SavedPopout {
            id: uuid::Uuid::new_v4().to_string(),
            cwd: "/project".into(),
            session: NoteSession::Pi(pi.clone()),
            fingerprint: fingerprint("ts", "same"),
            geometry: None,
            trim: None,
            open: true,
            details: None,
        };
        let binding = SessionBinding {
            runtime_id: "new-runtime".into(),
            pi: Some(pi),
            named: None,
        };
        let previous = SessionBinding {
            runtime_id: snapshot.session.clone(),
            ..binding.clone()
        };
        let entry = PopoutEntry::restored("window-a", &previous, saved, snapshot);
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
