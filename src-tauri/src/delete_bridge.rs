//! The installed Pi extension owns tree discovery and removal. This worker is
//! extension-only, unpersisted and never attached to a conversation.
use crate::process::{Output, Packet, ProcessHost};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{
    process::Command,
    sync::{Mutex, mpsc},
    time::timeout,
};

pub const FLAGS: &[&str] = &[
    "--mode",
    "rpc",
    "--offline",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-tools",
];
const STATUS: &str = "pi-gui-delete-v1";
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct TreeSession {
    pub file: PathBuf,
    pub title: String,
    pub cwd: PathBuf,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Preview {
    pub token: String,
    pub root: PathBuf,
    pub sessions: Vec<TreeSession>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct DeleteResult {
    pub file: PathBuf,
    pub deleted: bool,
    pub error: Option<String>,
}

pub struct DeleteBridge {
    host: Arc<ProcessHost>,
    records: Mutex<mpsc::UnboundedReceiver<Packet>>,
    stopped: Mutex<Option<Result<(), String>>>,
    token: String,
}
impl DeleteBridge {
    pub async fn start(command: Command, cwd: PathBuf) -> Result<Arc<Self>, String> {
        let host = Arc::new(ProcessHost::default());
        let (sender, records) = mpsc::unbounded_channel();
        let output: Output = Arc::new(move |packet| sender.send(packet).map_err(|e| e.to_string()));
        let token = uuid::Uuid::new_v4().to_string();
        host.start(command, cwd, token.clone(), output).await?;
        Ok(Arc::new(Self {
            host,
            records: Mutex::new(records),
            stopped: Mutex::new(None),
            token,
        }))
    }
    pub async fn verify(&self, extension: &Path) -> Result<(), String> {
        let response = self
            .exchange(json!({"type":"get_commands"}), false, true)
            .await?;
        let verified = response["data"]["commands"]
            .as_array()
            .is_some_and(|commands| {
                commands.iter().any(|c| {
                    c["name"] == "pi-gui-delete"
                        && c["source"] == "extension"
                        && c["sourceInfo"]["path"]
                            .as_str()
                            .or_else(|| c["path"].as_str())
                            .is_some_and(|p| Path::new(p) == extension)
                })
            });
        if !verified {
            return Err("Installed delete extension does not expose the verified Pi GUI v1 bridge. Nothing was deleted.".into());
        }
        let state = self
            .exchange(json!({"type":"get_state"}), false, true)
            .await?;
        if state["data"]["sessionFile"]
            .as_str()
            .is_some_and(|s| !s.is_empty())
            || state["data"]["isStreaming"] == true
        {
            return Err("Deletion requires an unpersisted, idle extension-only worker".into());
        }
        Ok(())
    }
    pub async fn preview(&self, store: &Path, cwd: &Path, root: &Path) -> Result<Preview, String> {
        let result = self
            .exchange(
                json!({"action":"preview", "directory":store, "cwd":cwd, "root":root}),
                true,
                true,
            )
            .await?;
        let plan: Preview =
            serde_json::from_value(result).map_err(|e| format!("Invalid deletion preview: {e}"))?;
        validate_preview(&plan, store, root)?;
        Ok(plan)
    }
    pub async fn execute(&self, plan: &Preview) -> Result<Vec<DeleteResult>, String> {
        // No execute timeout and no replay. Only the correlated extension result
        // completes removal; prompt acknowledgements are not deletion results.
        let result = self
            .exchange(json!({"action":"execute", "token":plan.token}), true, false)
            .await?;
        let results: Vec<DeleteResult> = serde_json::from_value(result["results"].clone())
            .map_err(|e| format!("Unknown deletion outcome: {e}"))?;
        validate_results(&results, plan)?;
        Ok(results)
    }
    async fn exchange(
        &self,
        mut fields: Value,
        bridge: bool,
        deadline: bool,
    ) -> Result<Value, String> {
        let mut records = self.records.lock().await;
        let id = uuid::Uuid::new_v4().to_string();
        let command = if bridge {
            fields["id"] = json!(id);
            json!({"type":"prompt", "id":id, "message":format!("/pi-gui-delete {fields}")})
        } else {
            fields["id"] = json!(id);
            fields
        };
        self.host.write(&self.token, command).await?;
        let read = async {
            while let Some(packet) = records.recv().await {
                let value = match packet {
                    Packet::Disconnected { message } => {
                        return Err(format!(
                            "Deletion worker disconnected; outcome may be unknown: {message}. Do not retry automatically."
                        ));
                    }
                    Packet::Rpc { value } => value,
                };
                if matches!(
                    value["type"].as_str(),
                    Some("agent_start" | "message_start" | "tool_execution_start")
                ) {
                    return Err(
                        "Deletion worker unexpectedly started agent work; operation aborted".into(),
                    );
                }
                if value["type"] == "response" && value["id"] == id {
                    if value["success"] != true {
                        return Err(value["error"]
                            .as_str()
                            .unwrap_or("Pi rejected deletion bridge request")
                            .into());
                    }
                    if !bridge {
                        return Ok(value);
                    }
                }
                if bridge
                    && value["type"] == "extension_ui_request"
                    && value["method"] == "setStatus"
                    && value["statusKey"] == STATUS
                {
                    let response: Value = serde_json::from_str(
                        value["statusText"]
                            .as_str()
                            .ok_or("Invalid bridge status")?,
                    )
                    .map_err(|e| e.to_string())?;
                    if response["id"] != id {
                        continue;
                    }
                    if response["version"] != 1 || response["ok"] != true {
                        return Err(response["error"]
                            .as_str()
                            .unwrap_or("Invalid deletion bridge response")
                            .into());
                    }
                    return Ok(response);
                }
            }
            Err("Deletion worker closed; outcome may be unknown. Nothing will be retried.".into())
        };
        if deadline {
            timeout(Duration::from_secs(20), read)
                .await
                .map_err(|_| "Deletion bridge preview/verification timed out".to_string())?
        } else {
            read.await
        }
    }
    pub async fn stop(&self) -> Result<(), String> {
        let mut stopped = self.stopped.lock().await;
        if let Some(result) = stopped.as_ref() {
            return result.clone();
        }
        let result = self.host.stop().await;
        *stopped = Some(result.clone());
        result
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct ReviewSession {
    pub file: PathBuf,
    pub title: String,
    pub parent: Option<PathBuf>,
}

/// Enrich only the extension's authoritative membership with read-only header
/// lineage for presentation. Never discover descendants or remove Pi files here.
pub fn review_tree(plan: &Preview) -> Result<Vec<ReviewSession>, String> {
    use std::io::{BufRead, BufReader, Read};
    let files: std::collections::HashSet<_> =
        plan.sessions.iter().map(|s| s.file.clone()).collect();
    let mut tree = Vec::new();
    for session in &plan.sessions {
        let file = std::fs::File::open(&session.file)
            .map_err(|e| format!("Cannot review session tree: {e}"))?;
        let mut reader = BufReader::new(file).take(16 * 1024 * 1024 + 1);
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).map_err(|e| e.to_string())? == 0 {
                return Err("Session has no reviewable header".into());
            }
            if !line.trim().is_empty() {
                break;
            }
        }
        if line.len() > 16 * 1024 * 1024 {
            return Err("Session header exceeds review limit".into());
        }
        let header: Value = serde_json::from_str(&line)
            .map_err(|e| format!("Cannot review session header: {e}"))?;
        if header["type"] != "session" {
            return Err("Session tree changed; preview again".into());
        }
        let parent = header["parentSession"]
            .as_str()
            .map(PathBuf::from)
            .map(|path| path.canonicalize().unwrap_or(path));
        let parent = if session.file == plan.root {
            None
        } else {
            Some(
                parent
                    .filter(|path| files.contains(path))
                    .ok_or("Session lineage changed; preview again")?,
            )
        };
        tree.push(ReviewSession {
            file: session.file.clone(),
            title: session.title.clone(),
            parent,
        });
    }
    // Validate connected lineage iteratively; malformed cycles cannot hang a UI.
    let mut children: std::collections::HashMap<PathBuf, Vec<PathBuf>> =
        std::collections::HashMap::new();
    for entry in &tree {
        if let Some(parent) = &entry.parent {
            children
                .entry(parent.clone())
                .or_default()
                .push(entry.file.clone());
        }
    }
    let mut stack = vec![plan.root.clone()];
    let mut seen = std::collections::HashSet::new();
    while let Some(file) = stack.pop() {
        if !seen.insert(file.clone()) {
            return Err("Invalid session lineage".into());
        }
        stack.extend(children.remove(&file).unwrap_or_default());
    }
    if seen.len() != files.len() {
        return Err("Invalid session lineage".into());
    }
    Ok(tree)
}

pub fn validate_preview(plan: &Preview, store: &Path, root: &Path) -> Result<(), String> {
    let files: std::collections::HashSet<_> = plan.sessions.iter().map(|s| &s.file).collect();
    if plan.token.is_empty()
        || plan.root != root
        || plan.sessions.is_empty()
        || plan.sessions.len() > 10000
        || files.len() != plan.sessions.len()
        || !files.contains(&plan.root)
        || plan.sessions.iter().any(|s| {
            !s.file.is_absolute()
                || !s.file.starts_with(store)
                || s.file
                    .components()
                    .any(|c| matches!(c, std::path::Component::ParentDir))
                || !s.cwd.is_absolute()
        })
    {
        return Err("Invalid or out-of-store deletion preview; nothing deleted".into());
    }
    Ok(())
}
pub fn validate_results(results: &[DeleteResult], plan: &Preview) -> Result<(), String> {
    let files: std::collections::HashSet<_> = results.iter().map(|r| &r.file).collect();
    if files.len() != results.len()
        || results.len() != plan.sessions.len()
        || plan.sessions.iter().any(|s| !files.contains(&s.file))
    {
        return Err("Unknown deletion outcome: incomplete or mismatched per-file results. Do not retry automatically.".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    async fn fixture(mode: &str) -> (tempfile::TempDir, Arc<DeleteBridge>, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let store = dir.path().canonicalize().unwrap();
        let extension = store.join("fixture.ts");
        let root = store.join("root.jsonl");
        let child = store.join("child.jsonl");
        std::fs::write(&extension, "fixture only").unwrap();
        std::fs::write(&root, "fixture root").unwrap();
        std::fs::write(&child, "fixture child").unwrap();
        let node = which::which("node").expect("Node is required for offline transport fixtures");
        let script =
            Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/fixtures/delete-bridge.mjs");
        let mut command = Command::new(node);
        command
            .arg(script)
            .arg(&extension)
            .arg(&root)
            .arg(&child)
            .arg(mode)
            .arg(store.join("requests.log"));
        let bridge = DeleteBridge::start(command, store).await.unwrap();
        (dir, bridge, extension, root)
    }
    #[tokio::test]
    async fn verified_worker_uses_correlated_single_use_extension_results_without_removing_files() {
        let (dir, bridge, extension, root) = fixture("normal").await;
        bridge.verify(&extension).await.unwrap();
        let plan = bridge
            .preview(root.parent().unwrap(), Path::new("/fixture"), &root)
            .await
            .unwrap();
        assert!(plan.sessions[0].title.contains('\u{2028}'));
        let results = bridge.execute(&plan).await.unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().any(|r| !r.deleted));
        assert!(
            root.exists(),
            "The host must not implement a filesystem-deletion fallback"
        );
        assert!(bridge.execute(&plan).await.unwrap_err().contains("Expired"));
        bridge.stop().await.unwrap();
        bridge.stop().await.unwrap();
        let log = std::fs::read_to_string(dir.path().join("requests.log")).unwrap();
        assert!(log.contains("/pi-gui-delete"));
    }
    #[tokio::test]
    async fn command_provenance_and_unpersisted_identity_are_checked_before_any_prompt() {
        for mode in ["bad-source", "persisted"] {
            let (dir, bridge, extension, _) = fixture(mode).await;
            assert!(bridge.verify(&extension).await.is_err());
            bridge.stop().await.unwrap();
            assert!(
                !std::fs::read_to_string(dir.path().join("requests.log"))
                    .unwrap()
                    .contains("\"type\":\"prompt\"")
            );
        }
    }
    #[tokio::test]
    async fn changed_trees_disconnects_and_incomplete_results_are_never_success() {
        for mode in ["changed", "disconnect", "incomplete"] {
            let (_dir, bridge, extension, root) = fixture(mode).await;
            bridge.verify(&extension).await.unwrap();
            let plan = bridge
                .preview(root.parent().unwrap(), Path::new("/fixture"), &root)
                .await
                .unwrap();
            assert!(bridge.execute(&plan).await.is_err());
            bridge.stop().await.unwrap();
            assert!(root.exists());
        }
    }
    fn plan() -> Preview {
        Preview {
            token: "single-use".into(),
            root: "/store/root.jsonl".into(),
            sessions: vec![
                TreeSession {
                    file: "/store/root.jsonl".into(),
                    cwd: "/project".into(),
                    title: "Root".into(),
                },
                TreeSession {
                    file: "/store/child.jsonl".into(),
                    cwd: "/other".into(),
                    title: "Child".into(),
                },
            ],
        }
    }
    #[test]
    fn review_uses_header_lineage_only_within_verified_membership() {
        let temp = tempfile::tempdir().unwrap();
        let directory = temp.path().canonicalize().unwrap();
        let root = directory.join("root.jsonl");
        let child = directory.join("child.jsonl");
        let grandchild = directory.join("grandchild.jsonl");
        let mut p = Preview {
            token: "fixture".into(),
            root: root.clone(),
            sessions: vec![],
        };
        for (file, parent) in [
            (root.clone(), None),
            (child.clone(), Some(root.clone())),
            (grandchild.clone(), Some(child.clone())),
        ] {
            std::fs::write(
                &file,
                json!({"type":"session","parentSession":parent}).to_string(),
            )
            .unwrap();
            p.sessions.push(TreeSession {
                file,
                title: "Fixture".into(),
                cwd: temp.path().into(),
            });
        }
        let tree = review_tree(&p).unwrap();
        assert_eq!(tree[0].parent, None);
        assert_eq!(tree[2].parent.as_ref(), Some(&child));
        std::fs::write(
            &child,
            json!({"type":"session","parentSession":grandchild}).to_string(),
        )
        .unwrap();
        assert!(review_tree(&p).is_err());
        assert!(root.exists() && child.exists() && grandchild.exists());
    }
    #[test]
    fn previews_are_bounded_unique_and_store_confined() {
        let mut p = plan();
        assert!(validate_preview(&p, Path::new("/store"), &p.root).is_ok());
        p.sessions.push(p.sessions[0].clone());
        assert!(validate_preview(&p, Path::new("/store"), &p.root).is_err());
        let mut p = plan();
        p.sessions[1].file = "/store/../escape".into();
        assert!(validate_preview(&p, Path::new("/store"), &p.root).is_err());
    }
    #[test]
    fn partial_success_is_valid_but_incomplete_or_duplicate_reports_are_unknown() {
        let p = plan();
        let mut results = vec![
            DeleteResult {
                file: p.root.clone(),
                deleted: true,
                error: None,
            },
            DeleteResult {
                file: p.sessions[1].file.clone(),
                deleted: false,
                error: Some("fixture failure".into()),
            },
        ];
        assert!(validate_results(&results, &p).is_ok());
        results.pop();
        assert!(validate_results(&results, &p).is_err());
        results.push(results[0].clone());
        assert!(validate_results(&results, &p).is_err());
        assert!(
            FLAGS.contains(&"--no-session")
                && FLAGS.contains(&"--no-tools")
                && FLAGS.contains(&"--no-extensions")
        );
    }
}
