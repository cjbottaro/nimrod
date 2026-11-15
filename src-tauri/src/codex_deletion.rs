//! Codex-specific deletion reservations; shared UI remains in the frontend coordinator.
use super::*;
#[derive(Clone)]
struct Reservation {
    window: String,
    token: String,
    operation: String,
    root: String,
    threads: HashSet<String>,
    stopped: bool,
    // A detached catalog cannot prove an already-sent daemon mutation finished.
    uncertain: bool,
    // A local-removal fence may stop owned writers, but never authorizes native history deletion.
    local_only: bool,
}
impl Reservation {
    fn extend_scope(&mut self, ids: HashSet<String>, local_only: bool) -> Result<(), String> {
        if !self.local_only && local_only { return Err("Codex native deletion cannot downgrade to local removal".into()); }
        let mut expanded = self.threads.clone(); expanded.extend(ids);
        if expanded.len() > 10_000 { return Err("Codex cumulative deletion scope exceeds 10,000 threads".into()); }
        if self.threads != expanded || self.local_only != local_only { self.stopped = false; self.threads = expanded; }
        self.local_only = local_only;
        Ok(())
    }
}
#[derive(Default)]
pub(super) struct Gate { current: Option<Reservation> }
impl Gate {
    pub(super) fn mark_uncertain(&mut self, token: &str) {
        if let Some(reserved) = self.current.as_mut().filter(|r| r.token == token) { reserved.uncertain = true; }
    }
    pub(super) fn validate_deletion(&self, metadata: &HashMap<String, CatalogThread>, cwd: &PathBuf) -> Result<(), String> {
        let reserved = self.current.as_ref().ok_or("Codex deletion is not reserved")?;
        if reserved.uncertain { return Err("A previous Codex deletion outcome is unconfirmed; its native fence is retained".into()); }
        if reserved.local_only { return Err("Local Codex removal cannot delete native history".into()); }
        validate_scope(metadata, cwd, &reserved.root, &reserved.threads)
    }
    pub(super) fn blocks(&self, id: &str) -> bool { self.current.as_ref().is_some_and(|r| r.threads.contains(id)) }
    pub(super) fn check(&self, catalog: bool, bound: Option<&str>, token: &str, value: &Value) -> Result<(), String> {
        let method = value["method"].as_str();
        if catalog {
            if !matches!(method, Some("initialize" | "initialized" | "thread/list" | "thread/read" | "thread/delete")) && method.is_some() {
                return Err("Codex catalog cannot create/resume or prompt a conversation".into());
            }
            if method == Some("thread/read") && value["params"]["includeTurns"] != false {
                return Err("Codex catalog reads must be metadata-only".into());
            }
            if method == Some("thread/delete") {
                let r = self.current.as_ref().ok_or("Codex deletion requires a native reservation")?;
                if r.local_only || r.uncertain || r.token != token || !r.stopped || value["params"]["threadId"].as_str() != Some(r.root.as_str()) {
                    return Err("Codex deletion requires the reserved root and completed affected-client teardown".into());
                }
            }
        } else {
            if method == Some("thread/delete") { return Err("Only an owned Codex catalog can delete a reviewed tree".into()); }
            if matches!(method, Some("thread/name/set" | "thread/compact/start" | "thread/read" | "mcpServerStatus/list" | "thread/backgroundTerminals/list")) && (bound.is_none() || value["params"]["threadId"].as_str() != bound) {
                return Err("Command requires this writer's bound Codex thread".into());
            }
            if matches!(method, Some("skills/list" | "hooks/list")) && (bound.is_none() || bound.is_some_and(|id| self.blocks(id))) {
                return Err("Command catalog requires an available bound Codex thread".into());
            }
            let target_blocked = value["params"]["threadId"].as_str().is_some_and(|id| self.blocks(id));
            if (matches!(method, Some("thread/start" | "thread/resume" | "turn/start" | "turn/steer" | "thread/name/set" | "thread/compact/start" | "thread/read" | "mcpServerStatus/list" | "thread/backgroundTerminals/list"))
                && (bound.is_some_and(|id| self.blocks(id)) || target_blocked)) || bound.is_none() && target_blocked {
                return Err("This Codex thread is reserved for deletion".into());
            }
        }
        Ok(())
    }
}
fn validate_scope(metadata: &HashMap<String, CatalogThread>, cwd: &PathBuf, root: &str, ids: &HashSet<String>) -> Result<(), String> {
    if !metadata.contains_key(root) { return Err("Codex deletion root was not observed in its catalog".into()); }
    let mut children: HashMap<&str, Vec<&str>> = HashMap::new();
    for (id, node) in metadata {
        if let Some(parent) = node.parent.as_deref() {
            if !metadata.contains_key(parent) { return Err("Codex native inventory has incomplete spawned lineage".into()); }
            children.entry(parent).or_default().push(id.as_str());
        }
    }
    let mut queue = vec![root]; let mut seen = HashSet::new(); let mut index = 0;
    while index < queue.len() {
        let id = queue[index]; index += 1;
        if !seen.insert(id) { return Err("Codex native deletion lineage is cyclic".into()); }
        let node = &metadata[id];
        if &node.cwd != cwd || node.ephemeral { return Err("Codex native deletion scope contains a cross-project/ephemeral thread".into()); }
        if let Some(descendants) = children.get(id) { queue.extend(descendants.iter().copied()); }
        if queue.len() > 10_000 { return Err("Codex native deletion tree exceeds 10,000 threads".into()); }
    }
    if seen.len() != ids.len() || ids.iter().any(|id| !seen.contains(id.as_str())) { return Err("Codex reserved scope omits or adds threads beyond the observed spawned tree".into()); }
    for (id, node) in metadata {
        if node.fork.as_deref().is_some_and(|fork| seen.contains(fork)) && !seen.contains(id.as_str()) { return Err("Codex fork deletion scope is not verified".into()); }
    }
    Ok(())
}
async fn catalog(host: &CodexHost, window: &str, token: &str) -> Result<Arc<Owned>, String> {
    let windows = host.windows.lock().await;
    if windows.closing.contains(window) || windows.closing.contains("*") || windows.retired.contains(&(window.into(), token.into())) {
        return Err("Codex catalog was retired".into());
    }
    host.sessions.lock().await.get(token).filter(|owner| owner.window == window && owner.catalog).cloned().ok_or("Unknown Codex catalog or wrong project window".into())
}
fn matching<'a>(gate: &'a mut Gate, window: &str, token: &str, operation: &str) -> Result<&'a mut Reservation, String> {
    gate.current.as_mut().filter(|r| r.window == window && r.token == token && r.operation == operation).ok_or("Codex deletion reservation is no longer owned".into())
}
#[tauri::command]
pub async fn reserve_codex_deletion(
    host: tauri::State<'_, CodexHost>, window: tauri::Window, token: String,
    operation_id: String, root_id: String, thread_ids: Vec<String>, local_only: Option<bool>,
) -> Result<(), String> {
    let local_only = local_only.unwrap_or(false);
    if operation_id.is_empty() || operation_id.len() > 128 || thread_ids.is_empty() || thread_ids.len() > 10_000
        || !thread_ids.contains(&root_id) || thread_ids.iter().any(|id| id.is_empty() || id.len() > 128) {
        return Err("Invalid Codex deletion scope".into());
    }
    let owner = catalog(&host, window.label(), &token).await?;
    // Wait for bounded writes before taking the window transition lock. No
    // unrelated Stop waits behind a pipe write while we publish a reservation.
    let mut gate = host.deletion.write().await;
    let windows = host.windows.lock().await;
    if windows.closing.contains(window.label()) || windows.closing.contains("*") || windows.retired.contains(&(window.label().into(), token.clone())) {
        return Err("Codex deletion catalog was retired".into());
    }
    if gate.current.as_ref().is_some_and(|r| r.window != window.label() || r.token != token || r.operation != operation_id || r.root != root_id) {
        return Err("Another Codex deletion owns the native reservation".into());
    }
    let ids: HashSet<_> = thread_ids.into_iter().collect();
    if local_only {
        // Same authority as scoped Close: fence/stop only this exact owned ID.
        // No catalog-absence flag from the frontend can authorize thread/delete.
        if ids.len() != 1 { return Err("Local Codex removal requires exactly its root ID".into()); }
    } else {
        // Native history deletion still requires the exact observed tree.
        let metadata = owner.metadata.lock().await;
        validate_scope(&metadata, &owner.cwd, &root_id, &ids)?;
    }
    for session in host.sessions.lock().await.values() {
        if session.binding.lock().await.as_ref().is_some_and(|id| ids.contains(id)) && (session.window != window.label() || session.cwd != owner.cwd) {
            return Err("Affected Codex writer belongs to another window/project; deletion was not started".into());
        }
    }
    if let Some(current) = &mut gate.current {
        current.extend_scope(ids, local_only)?;
    } else {
        gate.current = Some(Reservation { window: window.label().into(), token, operation: operation_id, root: root_id, threads: ids, stopped: false, uncertain: false, local_only });
    }
    Ok(())
}
#[tauri::command]
pub async fn stop_codex_deletion(
    host: tauri::State<'_, CodexHost>, window: tauri::Window, token: String, operation_id: String,
) -> Result<(), String> {
    catalog(&host, window.label(), &token).await?;
    let snapshot = {
        let mut gate = host.deletion.write().await;
        matching(&mut gate, window.label(), &token, &operation_id)?.clone()
    };
    let mut tokens = HashSet::new();
    for (id, owner) in host.sessions.lock().await.iter() {
        if owner.binding.lock().await.as_ref().is_some_and(|thread| snapshot.threads.contains(thread)) {
            if owner.window != window.label() { return Err("Affected Codex writer belongs to another window".into()); }
            tokens.insert(id.clone());
        }
    }
    {
        let mut windows = host.windows.lock().await;
        for id in &tokens { windows.retired.insert((window.label().into(), id.clone())); }
    }
    // Detach only affected Nimrod clients. The reviewed native delete owns thread shutdown,
    // including shared activity; this is never authority to stop the daemon.
    host.stop_matching(|id, _| tokens.contains(id)).await?;
    let mut gate = host.deletion.write().await;
    let current = matching(&mut gate, window.label(), &token, &operation_id)?;
    if current.threads != snapshot.threads || current.local_only != snapshot.local_only { return Err("Codex deletion scope changed during shutdown; stop the current scope explicitly".into()); }
    current.stopped = true;
    Ok(())
}
#[tauri::command]
pub async fn release_codex_deletion(
    host: tauri::State<'_, CodexHost>, window: tauri::Window, token: String, operation_id: String,
) -> Result<(), String> {
    let mut gate = host.deletion.write().await;
    if gate.current.as_ref().is_some_and(|r| r.window == window.label() && r.token == token && r.operation == operation_id) {
        if gate.current.as_ref().is_some_and(|r| r.uncertain) {
            return Err("Codex deletion outcome is unconfirmed; disconnecting its catalog cannot cancel shared-server work. The native fence is retained.".into());
        }
        if let Some(owner) = host.sessions.lock().await.get(&token) {
            if owner.delete_request.lock().await.is_some() { return Err("Codex delete is still in flight; stop its catalog before releasing guards".into()); }
        }
        gate.current = None;
    }
    Ok(())
}
impl CodexHost {
    pub(super) async fn release_window_deletion(&self, window: &str) {
        let mut gate = self.deletion.write().await;
        if gate.current.as_ref().is_some_and(|r| r.window == window && !r.uncertain) { gate.current = None; }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn gate(stopped: bool) -> Gate { Gate { current: Some(Reservation { window: "window".into(), token: "catalog".into(), operation: "operation".into(), root: "root".into(), threads: ["root".into(), "child".into()].into_iter().collect(), stopped, uncertain: false, local_only: false }) } }
    #[test]
    fn native_scope_blocks_affected_writes_but_not_other_threads_or_discovery() {
        let gate = gate(false);
        assert!(gate.check(false, Some("root"), "session", &serde_json::json!({"method":"turn/start","params":{"threadId":"root"}})).is_err());
        assert!(gate.check(false, None, "session", &serde_json::json!({"method":"thread/resume","params":{"threadId":"child"}})).is_err());
        assert!(gate.check(false, Some("other"), "other", &serde_json::json!({"method":"turn/start","params":{"threadId":"other"}})).is_ok());
        assert!(gate.check(true, None, "catalog", &serde_json::json!({"method":"thread/list","params":{}})).is_ok());
    }
    #[test]
    fn local_removal_fences_writers_but_never_authorizes_native_history_delete() {
        let mut local = gate(true);
        let reservation = local.current.as_mut().unwrap();
        reservation.local_only = true;
        reservation.threads = HashSet::from(["root".into()]);
        assert!(local.blocks("root"));
        assert!(!local.blocks("other"));
        assert!(local.check(false, None, "writer", &serde_json::json!({"method":"thread/resume","params":{"threadId":"root"}})).is_err());
        assert!(local.check(true, None, "catalog", &serde_json::json!({"method":"thread/read","params":{"threadId":"root","includeTurns":false}})).is_ok());
        assert!(local.check(true, None, "catalog", &serde_json::json!({"method":"thread/read","params":{"threadId":"root","includeTurns":true}})).is_err());
        assert!(local.check(true, None, "catalog", &serde_json::json!({"method":"thread/delete","params":{"threadId":"root"}})).is_err());
        assert!(local.validate_deletion(&HashMap::new(), &PathBuf::from("/fixture")).is_err());
    }
    #[test]
    fn a_local_fence_can_upgrade_but_native_deletion_can_never_downgrade() {
        let mut local = gate(true);
        let reservation = local.current.as_mut().unwrap();
        reservation.local_only = true;
        reservation.threads = HashSet::from(["root".into()]);
        reservation.extend_scope(HashSet::from(["root".into(), "child".into()]), false).unwrap();
        assert!(!reservation.local_only);
        assert!(!reservation.stopped, "new native scope requires observed stop again");
        assert!(reservation.extend_scope(HashSet::from(["root".into()]), true).is_err());
        assert!(!reservation.local_only);
    }
    #[test]
    fn rename_is_bound_to_the_owned_thread_and_respects_deletion() {
        let message = serde_json::json!({"method":"thread/name/set","params":{"threadId":"other","name":"Name"}});
        assert!(Gate::default().check(false, Some("other"), "writer", &message).is_ok());
        assert!(Gate::default().check(false, Some("different"), "writer", &message).is_err());
        assert!(Gate::default().check(false, None, "writer", &message).is_err());
        assert!(Gate::default().check(true, None, "catalog", &message).is_err());
        let blocked = serde_json::json!({"method":"thread/name/set","params":{"threadId":"root","name":"Name"}});
        assert!(gate(false).check(false, Some("root"), "writer", &blocked).is_err());
    }
    #[test]
    fn command_adapters_require_the_owned_thread_and_respect_reservations() {
        for method in ["thread/compact/start", "thread/read", "mcpServerStatus/list", "thread/backgroundTerminals/list"] {
            let message = serde_json::json!({"method":method,"params":{"threadId":"root"}});
            assert!(Gate::default().check(false, Some("root"), "writer", &message).is_ok());
            assert!(Gate::default().check(false, Some("other"), "writer", &message).is_err());
            assert!(Gate::default().check(false, None, "writer", &message).is_err());
            let mut catalog_read = message.clone(); catalog_read["params"]["includeTurns"] = Value::Bool(false);
            assert_eq!(Gate::default().check(true, None, "catalog", &catalog_read).is_ok(), method == "thread/read");
            assert!(gate(false).check(false, Some("root"), "writer", &message).is_err());
        }
        for method in ["skills/list", "hooks/list"] {
            let message = serde_json::json!({"method":method,"params":{"cwds":["/fixture"]}});
            assert!(Gate::default().check(false, Some("other"), "writer", &message).is_ok());
            assert!(Gate::default().check(false, None, "writer", &message).is_err());
            assert!(Gate::default().check(true, None, "catalog", &message).is_err());
            assert!(gate(false).check(false, Some("root"), "writer", &message).is_err());
        }
    }
    #[test]
    fn native_scope_requires_exact_observed_lineage_and_same_project() {
        let cwd = PathBuf::from("/fixture");
        let mut metadata = HashMap::from([
            ("root".into(), CatalogThread { cwd: cwd.clone(), parent: None, fork: None, ephemeral: false }),
            ("child".into(), CatalogThread { cwd: cwd.clone(), parent: Some("root".into()), fork: None, ephemeral: false }),
        ]);
        let ids = HashSet::from(["root".into(), "child".into()]);
        assert!(validate_scope(&metadata, &cwd, "root", &ids).is_ok());
        assert!(validate_scope(&metadata, &cwd, "root", &HashSet::from(["root".into()])).is_err());
        metadata.get_mut("child").unwrap().cwd = PathBuf::from("/other");
        assert!(validate_scope(&metadata, &cwd, "root", &ids).is_err());
        metadata.get_mut("child").unwrap().cwd = cwd.clone();
        metadata.insert("fork".into(), CatalogThread { cwd: cwd.clone(), parent: None, fork: Some("root".into()), ephemeral: false });
        assert!(validate_scope(&metadata, &cwd, "root", &ids).is_err());
    }
    #[test]
    fn detached_catalog_with_unconfirmed_delete_cannot_authorize_another_mutation() {
        let mut gate = gate(true);
        gate.mark_uncertain("unrelated-client");
        assert!(!gate.current.as_ref().unwrap().uncertain);
        gate.mark_uncertain("catalog");
        assert!(gate.current.as_ref().unwrap().uncertain);
        assert!(gate.blocks("root"));
        assert!(gate.check(true, None, "catalog", &serde_json::json!({"method":"thread/delete","params":{"threadId":"root"}})).is_err());
        assert!(gate.check(true, None, "catalog", &serde_json::json!({"method":"thread/read","params":{"threadId":"root","includeTurns":false}})).is_ok());
    }
    #[test]
    fn deletion_requires_the_catalog_reserved_root_and_stopped_scope() {
        let message = serde_json::json!({"method":"thread/delete","params":{"threadId":"root"}});
        assert!(gate(false).check(true, None, "catalog", &message).is_err());
        assert!(gate(true).check(false, Some("root"), "session", &message).is_err());
        assert!(gate(true).check(true, None, "another-catalog", &message).is_err());
        assert!(gate(true).check(true, None, "catalog", &message).is_ok());
        assert!(gate(true).check(true, None, "catalog", &serde_json::json!({"method":"thread/delete","params":{"threadId":"child"}})).is_err());
    }
}
