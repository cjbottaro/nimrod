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
}
#[derive(Default)]
pub(super) struct Gate { current: Option<Reservation> }
impl Gate {
    pub(super) fn validate_deletion(&self, metadata: &HashMap<String, CatalogThread>, cwd: &PathBuf) -> Result<(), String> {
        let reserved = self.current.as_ref().ok_or("Codex deletion is not reserved")?;
        validate_scope(metadata, cwd, &reserved.root, &reserved.threads)
    }
    pub(super) fn blocks(&self, id: &str) -> bool { self.current.as_ref().is_some_and(|r| r.threads.contains(id)) }
    pub(super) fn check(&self, catalog: bool, bound: Option<&str>, token: &str, value: &Value) -> Result<(), String> {
        let method = value["method"].as_str();
        if catalog {
            if !matches!(method, Some("initialize" | "initialized" | "thread/list" | "thread/delete")) && method.is_some() {
                return Err("Codex catalog cannot create/resume or prompt a conversation".into());
            }
            if method == Some("thread/delete") {
                let r = self.current.as_ref().ok_or("Codex deletion requires a native reservation")?;
                if r.token != token || !r.stopped || value["params"]["threadId"].as_str() != Some(r.root.as_str()) {
                    return Err("Codex deletion requires the reserved root and observed affected-writer exit".into());
                }
            }
        } else {
            if method == Some("thread/delete") { return Err("Only an owned Codex catalog can delete a reviewed tree".into()); }
            let target_blocked = value["params"]["threadId"].as_str().is_some_and(|id| self.blocks(id));
            if (matches!(method, Some("thread/start" | "thread/resume" | "turn/start" | "turn/steer"))
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
    operation_id: String, root_id: String, thread_ids: Vec<String>,
) -> Result<(), String> {
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
    // Scope must have been observed through this exact project-owned catalog.
    let metadata = owner.metadata.lock().await;
    let ids: HashSet<_> = thread_ids.into_iter().collect();
    validate_scope(&metadata, &owner.cwd, &root_id, &ids)?;
    drop(metadata);
    for session in host.sessions.lock().await.values() {
        if session.binding.lock().await.as_ref().is_some_and(|id| ids.contains(id)) && (session.window != window.label() || session.cwd != owner.cwd) {
            return Err("Affected Codex writer belongs to another window/project; deletion was not started".into());
        }
    }
    if let Some(current) = &mut gate.current {
        let mut expanded = current.threads.clone(); expanded.extend(ids);
        if expanded.len() > 10_000 { return Err("Codex cumulative deletion scope exceeds 10,000 threads".into()); }
        if current.threads != expanded { current.stopped = false; current.threads = expanded; }
    } else {
        gate.current = Some(Reservation { window: window.label().into(), token, operation: operation_id, root: root_id, threads: ids, stopped: false });
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
    // No native transition lock is held while waiting for owned process exit.
    host.stop_matching(|id, _| tokens.contains(id)).await?;
    let mut gate = host.deletion.write().await;
    let current = matching(&mut gate, window.label(), &token, &operation_id)?;
    if current.threads != snapshot.threads { return Err("Codex deletion scope expanded during shutdown; stop the expanded scope explicitly".into()); }
    current.stopped = true;
    Ok(())
}
#[tauri::command]
pub async fn release_codex_deletion(
    host: tauri::State<'_, CodexHost>, window: tauri::Window, token: String, operation_id: String,
) -> Result<(), String> {
    let mut gate = host.deletion.write().await;
    if gate.current.as_ref().is_some_and(|r| r.window == window.label() && r.token == token && r.operation == operation_id) {
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
        if gate.current.as_ref().is_some_and(|r| r.window == window) { gate.current = None; }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn gate(stopped: bool) -> Gate { Gate { current: Some(Reservation { window: "window".into(), token: "catalog".into(), operation: "operation".into(), root: "root".into(), threads: ["root".into(), "child".into()].into_iter().collect(), stopped }) } }
    #[test]
    fn native_scope_blocks_affected_writes_but_not_other_threads_or_discovery() {
        let gate = gate(false);
        assert!(gate.check(false, Some("root"), "session", &serde_json::json!({"method":"turn/start","params":{"threadId":"root"}})).is_err());
        assert!(gate.check(false, None, "session", &serde_json::json!({"method":"thread/resume","params":{"threadId":"child"}})).is_err());
        assert!(gate.check(false, Some("other"), "other", &serde_json::json!({"method":"turn/start","params":{"threadId":"other"}})).is_ok());
        assert!(gate.check(true, None, "catalog", &serde_json::json!({"method":"thread/list","params":{}})).is_ok());
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
    fn deletion_requires_the_catalog_reserved_root_and_stopped_scope() {
        let message = serde_json::json!({"method":"thread/delete","params":{"threadId":"root"}});
        assert!(gate(false).check(true, None, "catalog", &message).is_err());
        assert!(gate(true).check(false, Some("root"), "session", &message).is_err());
        assert!(gate(true).check(true, None, "another-catalog", &message).is_err());
        assert!(gate(true).check(true, None, "catalog", &message).is_ok());
        assert!(gate(true).check(true, None, "catalog", &serde_json::json!({"method":"thread/delete","params":{"threadId":"child"}})).is_err());
    }
}
