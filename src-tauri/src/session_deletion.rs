//! App-wide, Pi-specific deletion transaction. All filesystem removals remain
//! inside the user's installed delete-session-tree extension.
use crate::{
    delete_bridge::{DeleteBridge, DeleteResult, ReviewSession, review_tree},
    preferences::Preferences,
    workspace_windows::WorkspaceWindows,
    workspaces::WorkspaceHost,
};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};
use tauri::{Emitter, Manager};
use tokio::sync::{Mutex as AsyncMutex, Notify};

const EVENT: &str = "nimrod-session-deletion";
const QUARANTINE: &str = "nimrod.deletion.quarantine.v1";
const DELETED: &str = "nimrod.deletion.deleted.v1";
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeletionEvent {
    pub id: String,
    pub phase: String,
    pub files: Vec<PathBuf>,
    pub results: Vec<DeleteResult>,
    pub message: Option<String>,
    pub pending: bool,
    pub tree: Option<Vec<ReviewSession>>,
}
#[derive(Clone, Deserialize, Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SessionReport {
    pub file: PathBuf,
    pub token: Option<String>,
    pub title: String,
    pub busy: bool,
    pub has_draft: bool,
}
#[derive(Default)]
struct Round {
    id: String,
    participants: HashSet<String>,
    reports: HashMap<String, Vec<SessionReport>>,
}
struct ReviewRound {
    id: String,
    owner: String,
    answer: Option<bool>,
}
#[derive(Default)]
pub struct SessionDeletion {
    running: AtomicBool,
    transition: Mutex<()>,
    closing: AtomicBool,
    cancelled: AtomicBool,
    owner: Mutex<String>,
    worker_failed: AtomicBool,
    worker: Mutex<Option<Arc<DeleteBridge>>>,
    files: Mutex<Vec<PathBuf>>,
    quarantine: Mutex<HashSet<PathBuf>>,
    round: AsyncMutex<Round>,
    review: Mutex<Option<ReviewRound>>,
    deleted: Mutex<HashSet<PathBuf>>,
    notified: Notify,
}
#[derive(Serialize)]
pub struct DeletionSnapshot {
    pub pending: bool,
    pub quarantine: Vec<PathBuf>,
    pub files: Vec<PathBuf>,
    pub error: Option<String>,
    pub deleted: Vec<PathBuf>,
}
impl SessionDeletion {
    pub fn new(preferences: &Preferences) -> Self {
        let snapshot = preferences.snapshot();
        let parsed: Result<Vec<PathBuf>, _> =
            serde_json::from_value(snapshot.state.get(QUARANTINE).cloned().unwrap_or(json!([])));
        let invalid =
            snapshot.error.as_ref().is_some_and(|error| {
                error.starts_with(&format!("{}:", snapshot.state_path.display()))
            }) || !parsed
                .as_ref()
                .is_ok_and(|files| files.iter().all(|file| file.is_absolute()));
        let deleted: Result<Vec<PathBuf>, _> =
            serde_json::from_value(snapshot.state.get(DELETED).cloned().unwrap_or(json!([])));
        let invalid = invalid
            || !deleted
                .as_ref()
                .is_ok_and(|files| files.iter().all(|file| file.is_absolute()));
        Self {
            deleted: Mutex::new(deleted.unwrap_or_default().into_iter().collect()),
            quarantine: Mutex::new(parsed.unwrap_or_default().into_iter().collect()),
            running: AtomicBool::new(invalid),
            worker_failed: AtomicBool::new(invalid),
            ..Default::default()
        }
    }
    fn begin(&self) -> Result<(), String> {
        let _transition = self.transition.lock().unwrap();
        if self.running.swap(true, Ordering::SeqCst) {
            Err("Another deletion is pending".into())
        } else {
            Ok(())
        }
    }
    fn publish_completion(&self, publish: impl FnOnce()) {
        let _transition = self.transition.lock().unwrap();
        self.running.store(false, Ordering::SeqCst);
        publish();
    }
    pub fn blocked(&self, file: &Path) -> bool {
        self.quarantine.lock().unwrap().contains(file)
    }
    pub fn snapshot(&self) -> DeletionSnapshot {
        DeletionSnapshot {
            pending: self.running.load(Ordering::SeqCst),
            quarantine: self.quarantine.lock().unwrap().iter().cloned().collect(),
            files: self.files.lock().unwrap().clone(),
            deleted: self.deleted.lock().unwrap().iter().cloned().collect(),
            error: self.worker_failed.load(Ordering::SeqCst).then(|| "Deletion worker/state cannot be verified. Session launches remain blocked; resolve the error and restart Nimrod.".into()),
        }
    }
    fn remember(&self, app: &tauri::AppHandle, files: &[PathBuf]) -> Result<(), String> {
        let mut quarantine = self.quarantine.lock().unwrap();
        let mut updated = quarantine.clone();
        updated.extend(files.iter().cloned());
        app.state::<Preferences>()
            .update_state([(QUARANTINE.into(), json!(updated))].into_iter().collect())?;
        *quarantine = updated;
        Ok(())
    }
    pub async fn shutdown(&self) {
        self.closing.store(true, Ordering::SeqCst);
        self.notified.notify_one();
        let worker = self.worker.lock().unwrap().clone();
        if let Some(worker) = worker {
            let _ = worker.stop().await;
        }
    }
    pub fn cancel_owner(&self, window: &str) {
        if *self.owner.lock().unwrap() == window {
            self.cancelled.store(true, Ordering::SeqCst);
            self.notified.notify_one();
        }
    }
    async fn reports(
        &self,
        app: &tauri::AppHandle,
        phase: &str,
        files: &[PathBuf],
    ) -> Result<HashMap<String, Vec<SessionReport>>, String> {
        let participants: HashSet<_> = app
            .state::<WorkspaceWindows>()
            .directories
            .lock()
            .unwrap()
            .keys()
            .cloned()
            .collect();
        let id = uuid::Uuid::new_v4().to_string();
        *self.round.lock().await = Round {
            id: id.clone(),
            participants: participants.clone(),
            reports: HashMap::new(),
        };
        let event = DeletionEvent {
            id,
            phase: phase.into(),
            files: files.to_vec(),
            results: vec![],
            message: None,
            pending: true,
            tree: None,
        };
        for window in &participants {
            app.emit_to(window, EVENT, &event)
                .map_err(|e| e.to_string())?;
        }
        tokio::time::timeout(Duration::from_secs(25), async {
            loop {
                let notified = self.notified.notified();
                let round = self.round.lock().await;
                if self.closing.load(Ordering::SeqCst) || self.cancelled.load(Ordering::SeqCst) {
                    return Err("Nimrod is shutting down; deletion cancelled".into());
                }
                if round.reports.len() == round.participants.len() {
                    return Ok(round.reports.clone());
                }
                drop(round);
                notified.await;
            }
        })
        .await
        .map_err(|_| {
            "A project window did not acknowledge its deletion lock; nothing deleted".to_string()
        })?
    }
}
#[tauri::command]
pub fn deletion_snapshot(state: tauri::State<'_, SessionDeletion>) -> DeletionSnapshot {
    state.snapshot()
}
#[tauri::command]
pub async fn acknowledge_deletion(
    window: tauri::Window,
    state: tauri::State<'_, SessionDeletion>,
    id: String,
    sessions: Vec<SessionReport>,
) -> Result<(), String> {
    if sessions.len() > 10000 {
        return Err("Invalid deletion report".into());
    }
    let mut round = state.round.lock().await;
    if round.id != id || !round.participants.contains(window.label()) {
        return Err("Stale deletion acknowledgement".into());
    }
    if sessions
        .iter()
        .any(|s| !s.file.is_absolute() || s.title.len() > 10000)
    {
        return Err("Invalid deletion report".into());
    }
    round.reports.insert(window.label().into(), sessions);
    drop(round);
    state.notified.notify_one();
    Ok(())
}
#[tauri::command]
pub async fn recover_deletion_session(
    app: tauri::AppHandle,
    window: tauri::Window,
    path: PathBuf,
    session_id: String,
) -> Result<(), String> {
    let state = app.state::<SessionDeletion>();
    if state.running.load(Ordering::SeqCst) || state.worker_failed.load(Ordering::SeqCst) {
        return Err("Deletion worker has not finished; recovery is blocked".into());
    }
    let cwd = project(&app, window.label())?;
    let file = crate::sessions::inspect(&path, &cwd)?;
    if file.session_id != session_id {
        return Err("Saved session identity changed".into());
    }
    let mut quarantine = state.quarantine.lock().unwrap();
    let mut updated = quarantine.clone();
    updated.remove(&file.path);
    let mut deleted = state.deleted.lock().unwrap();
    let mut restored = deleted.clone();
    restored.remove(&file.path);
    app.state::<Preferences>().update_state(
        [
            (QUARANTINE.into(), json!(updated)),
            (DELETED.into(), json!(restored)),
        ]
        .into_iter()
        .collect(),
    )?;
    *quarantine = updated;
    *deleted = restored;
    Ok(())
}
fn project(app: &tauri::AppHandle, window: &str) -> Result<PathBuf, String> {
    app.state::<WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window)
        .cloned()
        .ok_or("Open a project first".into())
}
fn expand(value: &str, home: &Path, cwd: &Path) -> PathBuf {
    if value == "~" {
        home.into()
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
}
fn locations(home: &Path, cwd: &Path) -> Result<(PathBuf, PathBuf), String> {
    let agent = std::env::var("PI_CODING_AGENT_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| expand(&s, home, cwd))
        .unwrap_or_else(|| home.join(".pi/agent"));
    let extension = agent
        .join("extensions/delete-session-tree.ts")
        .canonicalize()
        .map_err(|e| format!("Installed delete-session-tree extension unavailable: {e}"))?;
    let store = std::env::var("PI_CODING_AGENT_SESSION_DIR")
        .ok()
        .filter(|s| !s.is_empty())
        .map(|s| expand(&s, home, cwd))
        .unwrap_or_else(|| agent.join("sessions"))
        .canonicalize()
        .map_err(|e| format!("Pi session store unavailable: {e}"))?;
    Ok((extension, store))
}
fn validate_idle(
    reports: &HashMap<String, Vec<SessionReport>>,
    owners: &[(String, String, PathBuf)],
    files: &HashSet<PathBuf>,
) -> Result<(), String> {
    if reports
        .values()
        .flatten()
        .any(|s| files.contains(&s.file) && s.busy)
    {
        return Err("Wait for every affected session's queued, model and background work to finish before deleting its tree".into());
    }
    for (window, token, file) in owners {
        if !reports.get(window).is_some_and(|sessions| {
            sessions
                .iter()
                .any(|s| &s.file == file && s.token.as_ref() == Some(token))
        }) {
            return Err(
                "Open session ownership changed or a writer was not acknowledged; nothing deleted"
                    .into(),
            );
        }
    }
    Ok(())
}
fn accept_review(
    review: &mut Option<ReviewRound>,
    owner: &str,
    id: &str,
    confirmed: bool,
) -> Result<(), String> {
    let round = review
        .as_mut()
        .filter(|round| round.id == id && round.owner == owner && round.answer.is_none())
        .ok_or("Stale deletion confirmation")?;
    round.answer = Some(confirmed);
    Ok(())
}
#[tauri::command]
pub fn confirm_session_deletion(
    window: tauri::Window,
    state: tauri::State<'_, SessionDeletion>,
    id: String,
    confirmed: bool,
) -> Result<(), String> {
    accept_review(
        &mut state.review.lock().unwrap(),
        window.label(),
        &id,
        confirmed,
    )?;
    state.notified.notify_one();
    Ok(())
}

#[tauri::command]
pub async fn delete_session_tree(
    app: tauri::AppHandle,
    window: tauri::Window,
    root: PathBuf,
    session_id: String,
    pi: PathBuf,
    node: PathBuf,
) -> Result<Vec<DeleteResult>, String> {
    let state = app.state::<SessionDeletion>();
    if state.closing.load(Ordering::SeqCst)
        || app
            .state::<crate::ExitState>()
            .closing
            .load(Ordering::SeqCst)
    {
        return Err("Nimrod is shutting down".into());
    }
    state.begin()?;
    let host = app.state::<WorkspaceHost>();
    if let Err(error) = host.begin_deletion().await {
        state.running.store(false, Ordering::SeqCst);
        return Err(error);
    }
    state.cancelled.store(false, Ordering::SeqCst);
    *state.owner.lock().unwrap() = window.label().into();
    let mut stopping = false;
    let mut results = Vec::new();
    let operation: Result<(), String> = async {
        app.emit(EVENT, DeletionEvent { id:String::new(), phase:"begin".into(), files:vec![], results:vec![], message:None, pending:true, tree:None }).map_err(|e| e.to_string())?;
        let cwd = project(&app, window.label())?;
        let selected = crate::sessions::inspect(&root, &cwd)?;
        if selected.session_id != session_id {
            return Err("Selected session file changed; nothing deleted".into());
        }
        if state.blocked(&selected.path) {
            return Err(
                "Recover this quarantined session explicitly before reviewing another deletion"
                    .into(),
            );
        }
        let (extension, store) =
            locations(&app.path().home_dir().map_err(|e| e.to_string())?, &cwd)?;
        let node = crate::executable(&node)?;
        let pi = crate::executable(&pi)?;
        let mut command = if pi
            .extension()
            .is_some_and(|e| e == "js" || e == "mjs" || e == "cjs")
        {
            let mut cmd = tokio::process::Command::new(&node);
            cmd.arg(pi);
            cmd
        } else {
            if pi.extension().is_some_and(|e| e == "cmd" || e == "bat") {
                return Err("Select Pi's CLI JavaScript file, not a shell wrapper".into());
            }
            tokio::process::Command::new(pi)
        };
        command
            .args(crate::delete_bridge::FLAGS)
            .arg("--extension")
            .arg(&extension)
            .arg("--pi-gui-delete-bridge");
        let mut paths = vec![node.parent().ok_or("Invalid Node path")?.to_path_buf()];
        paths.extend(std::env::split_paths(
            &std::env::var_os("PATH").unwrap_or_default(),
        ));
        command.env(
            "PATH",
            std::env::join_paths(paths).map_err(|e| e.to_string())?,
        );
        let worker = DeleteBridge::start(command, cwd.clone()).await?;
        *state.worker.lock().unwrap() = Some(worker.clone());
        worker.verify(&extension).await?;
        let plan = worker.preview(&store, &cwd, &selected.path).await?;
        if crate::sessions::inspect(&plan.root, &cwd)?.session_id != session_id { return Err("Selected session identity changed during preview; nothing deleted".into()); }
        let files: Vec<_> = plan.sessions.iter().map(|s| s.file.clone()).collect();
        *state.files.lock().unwrap() = files.clone();
        let membership: HashSet<_> = files.iter().cloned().collect();
        host.freeze_deletion(membership.clone()).await;
        let reports = state.reports(&app, "lock", &files).await?;
        validate_idle(
            &reports,
            &host.deletion_owners(&membership).await,
            &membership,
        )?;
        if state.closing.load(Ordering::SeqCst) || state.cancelled.load(Ordering::SeqCst) || app.get_webview_window(window.label()).is_none() { return Err("Deletion cancelled before confirmation".into()); }
        let review_id = uuid::Uuid::new_v4().to_string();
        let tree_plan = plan.clone();
        let tree = tauri::async_runtime::spawn_blocking(move || review_tree(&tree_plan)).await.map_err(|e| e.to_string())??;
        *state.review.lock().unwrap() = Some(ReviewRound { id: review_id.clone(), owner: window.label().into(), answer: None });
        app.emit_to(window.label(), EVENT, DeletionEvent { id: review_id, phase: "review".into(), files: files.clone(), results: vec![], message: None, pending: true, tree: Some(tree) }).map_err(|e| e.to_string())?;
        let answer = loop {
            let notified = state.notified.notified();
            if state.closing.load(Ordering::SeqCst) || state.cancelled.load(Ordering::SeqCst) { return Err("Deletion cancelled".into()); }
            if let Some(answer) = state.review.lock().unwrap().as_ref().and_then(|round| round.answer) { break answer; }
            notified.await;
        };
        *state.review.lock().unwrap() = None;
        if !answer { return Ok(()); }
        if state.closing.load(Ordering::SeqCst) || state.cancelled.load(Ordering::SeqCst) || app.get_webview_window(window.label()).is_none()
        {
            return Err("Deletion cancelled before shutdown".into());
        }
        let final_reports = state.reports(&app, "check", &files).await?;
        let owners = host.deletion_owners(&membership).await;
        validate_idle(&final_reports, &owners, &membership)?;
        let relevant = |reports: &HashMap<String, Vec<SessionReport>>| -> HashMap<String, Vec<SessionReport>> {
            reports.iter().filter_map(|(window, sessions)| { let relevant: Vec<_> = sessions.iter().filter(|s| membership.contains(&s.file)).cloned().collect(); (!relevant.is_empty()).then(|| (window.clone(), relevant)) }).collect()
        };
        if relevant(&reports) != relevant(&final_reports) { return Err("Affected open sessions or drafts changed during confirmation; preview again, nothing deleted".into()); }
        // Persist quarantine BEFORE stopping writers or consuming the plugin token.
        state.remember(&app, &files)?;
        stopping = true;
        app.emit(
            EVENT,
            DeletionEvent {
                id: String::new(),
                phase: "quarantine".into(),
                files: files.clone(),
                results: vec![],
                message: None,
                pending: true,
                tree: None,
            },
        )
        .map_err(|e| e.to_string())?;
        for (owner, token, _) in owners {
            host.stop_window(&owner, Some(&token)).await?;
        }
        if !host.deletion_owners(&membership).await.is_empty() {
            return Err("An affected writer did not exit; nothing deleted".into());
        }
        if state.closing.load(Ordering::SeqCst) || state.cancelled.load(Ordering::SeqCst) || app.get_webview_window(window.label()).is_none()
        {
            return Err("Deletion cancelled before removal".into());
        }
        results = worker.execute(&plan).await?;
        Ok(())
    }
    .await;
    let worker = state.worker.lock().unwrap().clone();
    let stopped = if let Some(worker) = worker {
        worker.stop().await
    } else {
        Ok(())
    };
    let worker_pending = stopped.is_err();
    if worker_pending {
        state.worker_failed.store(true, Ordering::SeqCst);
        // Keep the global launch barrier: an unobserved worker could still remove files.
    } else {
        *state.worker.lock().unwrap() = None;
    }
    let mut error = match (operation.err(), stopped.err()) {
        (Some(operation), Some(stop)) => Some(format!(
            "{operation}; deletion-worker exit not observed: {stop}"
        )),
        (operation, stop) => operation.or(stop),
    };
    if error.is_none() && results.iter().any(|result| !result.deleted) {
        error = Some(format!(
            "Deleted {} of {} sessions. Some sessions could not be deleted.",
            results.iter().filter(|result| result.deleted).count(),
            results.len()
        ));
    }
    state.review.lock().unwrap().take();
    let successful: HashSet<_> = results
        .iter()
        .filter(|result| result.deleted)
        .map(|result| result.file.clone())
        .collect();
    state
        .deleted
        .lock()
        .unwrap()
        .extend(successful.iter().cloned());
    if let Err(e) = crate::popouts::delete_sessions(&app, &successful).await {
        error = Some(format!(
            "{}Reference cleanup failed: {e}",
            error.map(|e| format!("{e}; ")).unwrap_or_default()
        ));
    }
    let updates = deleted_state_updates(&app.state::<Preferences>().snapshot().state, &results);
    if !updates.is_empty() {
        if let Err(e) = app.state::<Preferences>().update_state(updates) {
            error = Some(format!(
                "{}Bookkeeping cleanup failed: {e}",
                error.map(|e| format!("{e}; ")).unwrap_or_default()
            ));
        }
    }
    let files = state.files.lock().unwrap().clone();
    let event = DeletionEvent {
        id: String::new(),
        phase: if stopping { "complete" } else { "release" }.into(),
        files,
        results: results.clone(),
        message: error.clone(),
        pending: worker_pending,
        tree: None,
    };
    if !worker_pending {
        host.end_deletion().await;
        state.files.lock().unwrap().clear();
        *state.round.lock().await = Round::default();
        state.owner.lock().unwrap().clear();
        // Make shutdown state and completion publication one synchronous transition.
        // A new transaction cannot publish begin before this operation's completion,
        // and snapshots taken after completion must not retain a stale launch lock.
        state.publish_completion(|| {
            let _ = app.emit(EVENT, event);
        });
    } else {
        let _ = app.emit(EVENT, event);
    }
    if let Some(error) = error {
        Err(error)
    } else {
        Ok(results)
    }
}

fn deleted_state_updates(
    state: &serde_json::Map<String, serde_json::Value>,
    results: &[DeleteResult],
) -> serde_json::Map<String, serde_json::Value> {
    let files: HashSet<_> = results
        .iter()
        .filter(|r| r.deleted)
        .filter_map(|r| r.file.to_str())
        .collect();
    let mut updates = serde_json::Map::new();
    if !files.is_empty() {
        let mut deleted: HashSet<String> =
            serde_json::from_value(state.get(DELETED).cloned().unwrap_or(json!([])))
                .unwrap_or_default();
        deleted.extend(files.iter().map(|file| (*file).to_owned()));
        updates.insert(DELETED.into(), json!(deleted));
    }
    for (key, value) in state {
        if key.starts_with("nimrod.tabs.v1:") {
            let mut updated = value.clone();
            if let Some(layout) = updated.as_object_mut() {
                if let Some(tabs) = layout
                    .get_mut("tabs")
                    .and_then(serde_json::Value::as_array_mut)
                {
                    tabs.retain(|tab| {
                        !tab["path"]
                            .as_str()
                            .is_some_and(|path| files.contains(path))
                    });
                }
                if layout
                    .get("active")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|path| files.contains(path))
                {
                    layout.insert("active".into(), serde_json::Value::Null);
                }
            }
            if &updated != value {
                updates.insert(key.clone(), updated);
            }
        } else if key == "nimrod.last-session.v1"
            && value["path"]
                .as_str()
                .is_some_and(|path| files.contains(path))
        {
            updates.insert(key.clone(), serde_json::Value::Null);
        }
    }
    updates
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn completion_publication_is_serialized_with_next_transaction_start() {
        let state = SessionDeletion::default();
        state.begin().unwrap();
        assert!(state.begin().is_err());
        state.publish_completion(|| {
            assert!(!state.snapshot().pending);
            assert!(state.transition.try_lock().is_err());
        });
        state.begin().unwrap();
        assert!(state.snapshot().pending);
    }
    #[test]
    fn busy_descendants_or_unreported_owned_writers_block_deletion() {
        let file = PathBuf::from("/store/child.jsonl");
        let files = [file.clone()].into_iter().collect();
        let owners = vec![("other-window".into(), "owned".into(), file.clone())];
        let mut reports = HashMap::new();
        assert!(validate_idle(&reports, &owners, &files).is_err());
        reports.insert(
            "other-window".into(),
            vec![SessionReport {
                file,
                token: Some("owned".into()),
                title: "Child".into(),
                busy: true,
                has_draft: true,
            }],
        );
        assert!(validate_idle(&reports, &owners, &files).is_err());
        reports.get_mut("other-window").unwrap()[0].busy = false;
        assert!(validate_idle(&reports, &owners, &files).is_ok());
    }
    #[test]
    fn review_answers_are_owner_scoped_correlated_and_single_use() {
        let mut review = Some(ReviewRound {
            id: "current".into(),
            owner: "project-a".into(),
            answer: None,
        });
        assert!(accept_review(&mut review, "project-b", "current", true).is_err());
        assert!(accept_review(&mut review, "project-a", "old", true).is_err());
        accept_review(&mut review, "project-a", "current", false).unwrap();
        assert_eq!(review.as_ref().unwrap().answer, Some(false));
        assert!(accept_review(&mut review, "project-a", "current", true).is_err());
    }
    #[test]
    fn only_successful_files_are_removed_from_remembered_layouts_and_last_session() {
        let state = serde_json::from_value(json!({"nimrod.tabs.v1:/one":{"tabs":[{"path":"/store/a"},{"path":"/store/b"}],"active":"/store/a"}, "nimrod.last-session.v1":{"path":"/store/a"},"nimrod.tabs.v1:/malformed":42,"unrelated":true})).unwrap();
        let results = vec![
            DeleteResult {
                file: "/store/a".into(),
                deleted: true,
                error: None,
            },
            DeleteResult {
                file: "/store/b".into(),
                deleted: false,
                error: Some("failure".into()),
            },
        ];
        let updated = deleted_state_updates(&state, &results);
        assert_eq!(
            updated["nimrod.tabs.v1:/one"]["tabs"],
            json!([{"path":"/store/b"}])
        );
        assert_eq!(updated["nimrod.last-session.v1"], serde_json::Value::Null);
        assert!(!updated.contains_key("unrelated"));
    }
    #[test]
    fn quarantine_survives_host_recreation_and_corrupt_guards_fail_closed() {
        let temp = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(temp.path());
        preferences
            .update_state(
                [(QUARANTINE.into(), json!(["/store/failed.jsonl"]))]
                    .into_iter()
                    .collect(),
            )
            .unwrap();
        assert!(SessionDeletion::new(&preferences).blocked(Path::new("/store/failed.jsonl")));
        preferences
            .update_state(
                [(QUARANTINE.into(), json!("corrupt"))]
                    .into_iter()
                    .collect(),
            )
            .unwrap();
        let restored = SessionDeletion::new(&preferences);
        assert!(restored.snapshot().pending);
        assert!(restored.snapshot().error.is_some());
    }
    #[test]
    fn path_expansion_is_portable_and_project_relative() {
        assert_eq!(
            expand("~/config", Path::new("/home/dev"), Path::new("/project")),
            PathBuf::from("/home/dev/config")
        );
        assert_eq!(
            expand("store", Path::new("/home/dev"), Path::new("/project")),
            PathBuf::from("/project/store")
        );
    }
}
