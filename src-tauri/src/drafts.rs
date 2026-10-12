//! App-owned per-scope drafts. Stage in memory, debounce atomic disk writes.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

#[derive(Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Record {
    pub key: String,
    pub revision: u64,
    pub value: Value,
}
#[derive(Deserialize, Serialize)]
struct Stored {
    version: u8,
    project: String,
    record: Record,
}
struct Pending {
    record: Record,
    first: Instant,
    last: Instant,
}
#[derive(Clone)]
pub struct Drafts {
    root: PathBuf,
    pending: Arc<Mutex<HashMap<(String, String), Pending>>>,
}
impl Drafts {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            pending: Arc::new(Mutex::new(HashMap::new())),
        }
    }
    fn path(&self, project: &str, key: &str) -> PathBuf {
        let hash = |text: &str| format!("{:x}", Sha256::digest(text.as_bytes()));
        self.root
            .join(hash(project))
            .join(format!("{}.json", hash(key)))
    }
    fn read(path: &Path) -> Result<Stored, String> {
        if fs::metadata(path).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
            return Err("Draft exceeds 16 MiB".into());
        }
        let stored: Stored = serde_json::from_slice(&fs::read(path).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        if stored.version != 1 {
            return Err("Unsupported draft version".into());
        }
        Ok(stored)
    }
    pub fn load(&self, project: &str) -> Result<Vec<Record>, String> {
        let pending = self.pending.lock().unwrap();
        let dir = self.path(project, "").parent().unwrap().to_owned();
        let mut records = HashMap::new();
        if dir.exists() {
            for entry in fs::read_dir(dir).map_err(|e| e.to_string())? {
                let path = entry.map_err(|e| e.to_string())?.path();
                if path.extension().is_none_or(|extension| extension != "json") {
                    continue;
                }
                let stored = Self::read(&path)?;
                if stored.project != project || self.path(project, &stored.record.key) != path {
                    return Err("Draft identity mismatch".into());
                }
                records.insert(stored.record.key.clone(), stored.record);
            }
        }
        for ((owner, key), item) in pending.iter() {
            if owner == project {
                records.insert(key.clone(), item.record.clone());
            }
        }
        Ok(records.into_values().collect())
    }
    pub fn stage(&self, project: &str, record: Record) -> Result<(), String> {
        if !(record.key.starts_with("file:") || record.key.starts_with("unassigned:"))
            || record.key.len() > 32768
            || record.revision == 0
        {
            return Err("Invalid draft scope/revision".into());
        }
        if !record.value.is_null() && !record.value.is_object() {
            return Err("Invalid draft state".into());
        }
        if serde_json::to_vec(&record)
            .map_err(|e| e.to_string())?
            .len()
            > 16 * 1024 * 1024
        {
            return Err("Draft exceeds 16 MiB".into());
        }
        let mut pending = self.pending.lock().unwrap();
        let id = (project.to_owned(), record.key.clone());
        let path = self.path(project, &record.key);
        let current = if let Some(item) = pending.get(&id) {
            Some(item.record.clone())
        } else if path.exists() {
            Some(Self::read(&path)?.record)
        } else {
            None
        };
        if let Some(current) = current {
            if record.revision < current.revision {
                return Err("Stale draft revision".into());
            }
            if record.revision == current.revision {
                return if record.value == current.value {
                    Ok(())
                } else {
                    Err("Conflicting draft revision".into())
                };
            }
        }
        let now = Instant::now();
        let first = pending.get(&id).map_or(now, |item| item.first);
        pending.insert(
            id,
            Pending {
                record,
                first,
                last: now,
            },
        );
        Ok(())
    }
    pub fn flush(&self, project: Option<&str>, due_only: bool) -> Result<(), String> {
        let mut pending = self.pending.lock().unwrap();
        let mut saved = Vec::new();
        for ((owner, key), item) in pending.iter() {
            if project.is_some_and(|project| project != owner) {
                continue;
            }
            if due_only
                && item.last.elapsed() < Duration::from_millis(300)
                && item.first.elapsed() < Duration::from_secs(2)
            {
                continue;
            }
            let path = self.path(owner, key);
            fs::create_dir_all(path.parent().unwrap()).map_err(|e| e.to_string())?;
            let mut file = tempfile::NamedTempFile::new_in(path.parent().unwrap())
                .map_err(|e| e.to_string())?;
            serde_json::to_writer(
                &mut file,
                &Stored {
                    version: 1,
                    project: owner.clone(),
                    record: item.record.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
            file.flush().map_err(|e| e.to_string())?;
            file.as_file().sync_all().map_err(|e| e.to_string())?;
            file.persist(path).map_err(|e| e.error.to_string())?;
            saved.push((owner.clone(), key.clone()));
        }
        for key in saved {
            pending.remove(&key);
        }
        Ok(())
    }
    pub fn delete_files(&self, files: &std::collections::HashSet<PathBuf>) -> Result<(), String> {
        let keys: std::collections::HashSet<_> = files
            .iter()
            .map(|file| format!("file:{}", file.to_string_lossy()))
            .collect();
        let mut pending = self.pending.lock().unwrap();
        for ((_, key), item) in pending.iter_mut() {
            if keys.contains(key) {
                item.record.value = Value::Null;
            }
        }
        if self.root.exists() {
            for dir in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
                let directory = dir.map_err(|e| e.to_string())?.path();
                for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
                    let path = entry.map_err(|e| e.to_string())?.path();
                    if path.extension().is_none_or(|extension| extension != "json") {
                        continue;
                    }
                    let stored = Self::read(&path)?;
                    if keys.contains(&stored.record.key) {
                        pending
                            .entry((stored.project, stored.record.key.clone()))
                            .or_insert_with(|| Pending {
                                record: Record {
                                    value: Value::Null,
                                    ..stored.record
                                },
                                first: Instant::now(),
                                last: Instant::now(),
                            })
                            .record
                            .value = Value::Null;
                    }
                }
            }
        }
        drop(pending);
        self.flush(None, false)
    }
    pub fn references(&self) -> Result<Vec<String>, String> {
        let mut values = Vec::new();
        let pending = self.pending.lock().unwrap();
        if self.root.exists() {
            for dir in fs::read_dir(&self.root).map_err(|e| e.to_string())? {
                for entry in fs::read_dir(dir.map_err(|e| e.to_string())?.path())
                    .map_err(|e| e.to_string())?
                {
                    let path = entry.map_err(|e| e.to_string())?.path();
                    if path
                        .extension()
                        .is_some_and(|extension| extension == "json")
                    {
                        let stored = Self::read(&path)?;
                        // Staged tombstones replace old on-disk image references.
                        if !pending.contains_key(&(stored.project, stored.record.key)) {
                            values.push(stored.record.value);
                        }
                    }
                }
            }
        }
        values.extend(pending.values().map(|item| item.record.value.clone()));
        fn visit(value: &Value, ids: &mut Vec<String>) {
            match value {
                Value::Array(items) => {
                    for item in items {
                        visit(item, ids);
                    }
                }
                Value::Object(items) => {
                    if items.contains_key("mimeType") && items.contains_key("size") {
                        if let Some(Value::String(id)) = items.get("id") {
                            ids.push(id.clone());
                        }
                    }
                    for item in items.values() {
                        visit(item, ids);
                    }
                }
                _ => {}
            }
        }
        let mut ids = Vec::new();
        for value in values {
            // Only editable drafts own persisted image references. Retired
            // submissions and backup copies do not protect old blobs.
            if let Some(attachments) = value.get("attachments") {
                visit(attachments, &mut ids);
            }
        }
        Ok(ids)
    }
}
fn project(window: &tauri::Window, project: &str) -> Result<(), String> {
    if window
        .app_handle()
        .state::<crate::workspace_windows::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        != Some(&PathBuf::from(project))
    {
        return Err("Draft project does not belong to this window".into());
    }
    Ok(())
}
#[tauri::command]
pub async fn drafts_load(
    window: tauri::Window,
    drafts: tauri::State<'_, Drafts>,
    project: String,
) -> Result<Vec<Record>, String> {
    self::project(&window, &project)?;
    let store = drafts.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.load(&project))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drafts_stage(
    window: tauri::Window,
    drafts: tauri::State<'_, Drafts>,
    project: String,
    record: Record,
) -> Result<(), String> {
    self::project(&window, &project)?;
    let store = drafts.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.stage(&project, record))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drafts_flush(
    window: tauri::Window,
    drafts: tauri::State<'_, Drafts>,
    project: String,
) -> Result<(), String> {
    self::project(&window, &project)?;
    let store = drafts.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.flush(Some(&project), false))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn drafts_references(drafts: tauri::State<'_, Drafts>) -> Result<Vec<String>, String> {
    let store = drafts.inner().clone();
    tauri::async_runtime::spawn_blocking(move || store.references())
        .await
        .map_err(|e| e.to_string())?
}
pub fn watch(app: &tauri::AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            std::thread::sleep(Duration::from_millis(100));
            if let Err(error) = app.state::<Drafts>().flush(None, true) {
                let _ = app.emit("nimrod-draft-error", error);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn debounced_scoped_atomic_records_restore_and_reject_stale_updates() {
        let dir = tempfile::tempdir().unwrap();
        let store = Drafts::new(dir.path().join("drafts"));
        let record = |revision, text| Record {
            key: "file:/fixture".into(),
            revision,
            value: json!({"draft":text}),
        };
        store.stage("/a", record(1, "one")).unwrap();
        store.stage("/a", record(2, "two")).unwrap();
        assert!(!store.root.exists());
        store.flush(None, true).unwrap();
        assert!(!store.root.exists());
        assert_eq!(store.load("/a").unwrap()[0].value["draft"], "two");
        assert!(store.stage("/a", record(1, "old")).is_err());
        store.stage("/b", record(1, "other")).unwrap();
        store.flush(None, false).unwrap();
        let restored = Drafts::new(store.root.clone());
        assert_eq!(restored.load("/a").unwrap()[0].value["draft"], "two");
        assert_eq!(restored.load("/b").unwrap()[0].value["draft"], "other");
        assert!(restored.stage("/a", record(2, "conflict")).is_err());
    }
    #[test]
    fn maximum_wait_flushes_continuous_edits_and_deletion_covers_closed_projects() {
        let dir = tempfile::tempdir().unwrap();
        let store = Drafts::new(dir.path().join("drafts"));
        for project in ["/a", "/b"] {
            store
                .stage(
                    project,
                    Record {
                        key: "file:/fixture".into(),
                        revision: 1,
                        value: serde_json::json!({"draft":"keep"}),
                    },
                )
                .unwrap();
        }
        for item in store.pending.lock().unwrap().values_mut() {
            item.first = Instant::now() - Duration::from_secs(3);
        }
        store.flush(None, true).unwrap();
        assert!(store.pending.lock().unwrap().is_empty());
        store
            .delete_files(&[PathBuf::from("/fixture")].into_iter().collect())
            .unwrap();
        for project in ["/a", "/b"] {
            assert!(
                Drafts::new(store.root.clone()).load(project).unwrap()[0]
                    .value
                    .is_null()
            );
        }
    }
    #[test]
    fn only_editable_drafts_protect_persisted_images() {
        let dir = tempfile::tempdir().unwrap();
        let store = Drafts::new(dir.path().join("drafts"));
        let image = |id| json!({"id":id,"mimeType":"image/png","size":1});
        store.stage("/a", Record {
            key: "file:/fixture".into(), revision: 1,
            value: json!({"attachments":[image("draft")], "submission":{"status":"pending","attachments":[image("pending")]},
                "imageRecovery":[{"attachments":[image("accepted-backup")]}], "recovered":[{"kind":"unsent","attachments":[image("failed-backup")]}]}),
        }).unwrap();
        store.flush(None, false).unwrap();
        let mut ids = store.references().unwrap();
        ids.sort();
        assert_eq!(ids, vec!["draft"]);
        store.stage("/a", Record {
            key: "file:/fixture".into(), revision: 2,
            value: json!({"submission":{"status":"unknown","attachments":[image("unknown")]}}),
        }).unwrap();
        assert!(store.references().unwrap().is_empty());
        store.stage("/a", Record {
            key: "file:/fixture".into(), revision: 3,
            value: json!({"submission":{"status":"accepted","attachments":[image("resolved")]}}),
        }).unwrap();
        assert!(store.references().unwrap().is_empty());
    }

    #[test]
    fn failure_retains_pending_state_and_tombstones_remove_references() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("blocked");
        fs::write(&root, "blocked").unwrap();
        let store = Drafts::new(root.clone());
        let mut record = Record {
            key: "file:/fixture".into(),
            revision: 1,
            value: json!({"attachments":[{"id":"image","size":1,"mimeType":"image/png"}]}),
        };
        store.stage("/a", record.clone()).unwrap();
        assert!(store.flush(None, false).is_err());
        assert_eq!(store.load("/a").unwrap()[0].revision, 1);
        fs::remove_file(root).unwrap();
        store.flush(None, false).unwrap();
        assert_eq!(store.references().unwrap(), vec!["image"]);
        record.revision = 2;
        record.value = Value::Null;
        store.stage("/a", record).unwrap();
        assert!(store.references().unwrap().is_empty());
        store.flush(None, false).unwrap();
        assert!(
            Drafts::new(store.root.clone()).load("/a").unwrap()[0]
                .value
                .is_null()
        );
    }
}
