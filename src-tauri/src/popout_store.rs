//! Nimrod-owned snapshots. Pi is only session provenance; its files are never modified.
use crate::{preferences::Preferences, window_state::Geometry};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs,
    io::{Read, Write},
    path::{Path, PathBuf},
};

pub const MAX_TEXT_BYTES: usize = 16 * 1024 * 1024;
const MAX_FILE_BYTES: u64 = 100 * 1024 * 1024; // JSON escaping can expand the source sixfold.
const PREFIX: &str = "nimrod.popout.v1:";

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PiSessionRef {
    pub path: PathBuf,
    pub session_id: String,
}

#[derive(Clone, Deserialize, Serialize)]
// Ignore legacy snapshot fields (including the removed transcript key) on read.
#[serde(rename_all = "camelCase")]
pub struct CodeSnapshot {
    pub session: String, // Mounted session identity; not the persistent pop-out identity.
    pub title: String,
    pub text: String,
    pub language: String,
}
impl CodeSnapshot {
    pub fn validate(&self) -> Result<(), String> {
        if self.text.len() > MAX_TEXT_BYTES
            || self.session.len() > 256
            || self.title.len() > 512
            || self.language.len() > 128
        {
            return Err("Code pop-out is too large".into());
        }
        Ok(())
    }
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SavedPopout {
    pub id: String,
    pub cwd: PathBuf,
    pub pi: PiSessionRef,
    pub fingerprint: String,
    pub geometry: Option<Geometry>,
}
impl SavedPopout {
    fn validate(&self) -> Result<(), String> {
        let id = uuid::Uuid::parse_str(&self.id).map_err(|_| "Invalid pop-out ID")?;
        if id.to_string() != self.id
            || !self.cwd.is_absolute()
            || !self.pi.path.is_absolute()
            || self.pi.session_id.is_empty()
            || self.pi.session_id.len() > 256
            || self.fingerprint.len() != 64
            || !self.fingerprint.bytes().all(|b| b.is_ascii_hexdigit())
        {
            return Err("Invalid saved pop-out reference".into());
        }
        if self
            .geometry
            .as_ref()
            .is_some_and(|g| !crate::window_state::valid_for(g, (320.0, 220.0)))
        {
            return Err("Invalid saved pop-out geometry".into());
        }
        Ok(())
    }
    fn same_source(&self, other: &Self) -> bool {
        self.id == other.id
            && self.cwd == other.cwd
            && self.pi == other.pi
            && self.fingerprint == other.fingerprint
    }
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FileRecord {
    version: u32,
    reference: SavedPopout,
    snapshot: CodeSnapshot,
}

pub fn fingerprint(language: &str, text: &str) -> String {
    let language = language.trim().to_lowercase();
    let language = match language.as_str() {
        "md" | "mkd" | "mkdown" => "markdown",
        other => other,
    };
    let mut digest = Sha256::new();
    digest.update(b"nimrod.code-popout.v1\0");
    digest.update((language.len() as u64).to_be_bytes());
    digest.update(language.as_bytes());
    digest.update(text.as_bytes());
    format!("{:x}", digest.finalize())
}

pub struct SnapshotStore<'a>(pub &'a Preferences);
impl SnapshotStore<'_> {
    fn root(&self) -> Result<PathBuf, String> {
        self.0
            .snapshot()
            .state_path
            .parent()
            .map(|p| p.join("popouts"))
            .ok_or_else(|| "Missing Nimrod state directory".into())
    }
    fn path(&self, id: &str) -> Result<PathBuf, String> {
        if uuid::Uuid::parse_str(id)
            .map(|v| v.to_string())
            .ok()
            .as_deref()
            != Some(id)
        {
            return Err("Invalid pop-out ID".into());
        }
        Ok(self.root()?.join(format!("{id}.json")))
    }
    pub fn references(&self, cwd: &Path, pi: &PiSessionRef) -> (Vec<SavedPopout>, Vec<String>) {
        let state = self.0.snapshot();
        let mut found = Vec::new();
        let mut warnings = Vec::new();
        for (key, value) in &state.state {
            let Some(id) = key.strip_prefix(PREFIX) else {
                continue;
            };
            match serde_json::from_value::<SavedPopout>(value.clone()).and_then(|reference| {
                reference.validate().map_err(serde::de::Error::custom)?;
                if reference.id != id {
                    return Err(serde::de::Error::custom("Pop-out reference ID mismatch"));
                }
                Ok(reference)
            }) {
                Ok(reference) if reference.cwd == cwd && &reference.pi == pi => {
                    found.push(reference)
                }
                Ok(_) => {}
                Err(e) => warnings.push(format!("Saved pop-out {id}: {e}")),
            }
        }
        found.sort_by(|a, b| a.id.cmp(&b.id));
        (found, warnings)
    }
    pub fn load(&self, reference: &SavedPopout) -> Result<CodeSnapshot, String> {
        reference.validate()?;
        let path = self.path(&reference.id)?;
        let file = fs::File::open(&path).map_err(|e| format!("{}: {e}", path.display()))?;
        if !file.metadata().map_err(|e| e.to_string())?.is_file() {
            return Err("Snapshot must be a regular file".into());
        }
        let mut text = String::new();
        file.take(MAX_FILE_BYTES + 1)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() as u64 > MAX_FILE_BYTES {
            return Err("Snapshot file exceeds 100 MiB".into());
        }
        let record: FileRecord = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        record.snapshot.validate()?;
        if record.version != 1
            || !record.reference.same_source(reference)
            || fingerprint(&record.snapshot.language, &record.snapshot.text)
                != reference.fingerprint
        {
            return Err("Snapshot identity/content does not match its state reference".into());
        }
        Ok(record.snapshot)
    }
    pub fn save_new(&self, reference: &SavedPopout, snapshot: &CodeSnapshot) -> Result<(), String> {
        reference.validate()?;
        snapshot.validate()?;
        if fingerprint(&snapshot.language, &snapshot.text) != reference.fingerprint {
            return Err("Invalid snapshot fingerprint".into());
        }
        let path = self.path(&reference.id)?;
        let root = path.parent().unwrap();
        fs::create_dir_all(root).map_err(|e| e.to_string())?;
        let record = serde_json::to_vec(&FileRecord {
            version: 1,
            reference: reference.clone(),
            snapshot: snapshot.clone(),
        })
        .map_err(|e| e.to_string())?;
        if record.len() as u64 > MAX_FILE_BYTES {
            return Err("Snapshot file exceeds 100 MiB".into());
        }
        let mut file = tempfile::NamedTempFile::new_in(root).map_err(|e| e.to_string())?;
        file.write_all(&record).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        file.persist_noclobber(&path)
            .map_err(|e| e.error.to_string())?;
        if let Err(error) = self.save_reference(reference) {
            let _ = fs::remove_file(path); // Only the new file, never an existing snapshot.
            return Err(error);
        }
        Ok(())
    }
    pub fn save_reference(&self, reference: &SavedPopout) -> Result<(), String> {
        reference.validate()?;
        let mut entries = serde_json::Map::new();
        entries.insert(
            format!("{PREFIX}{}", reference.id),
            serde_json::to_value(reference).map_err(|e| e.to_string())?,
        );
        self.0.update_state(entries)?;
        Ok(())
    }
    pub fn save_geometry(&self, reference: &SavedPopout) -> Result<(), String> {
        reference.validate()?;
        self.0.update_existing_state(
            format!("{PREFIX}{}", reference.id),
            serde_json::to_value(reference).map_err(|e| e.to_string())?,
        )?;
        Ok(())
    }
    pub fn remove(&self, id: &str) -> Result<Option<String>, String> {
        let path = self.path(id)?;
        // Remove the reference first: an interrupted deletion leaves an unreferenced
        // file, not a dangling reference or a snapshot that reappears after Close.
        self.0.remove_state(&format!("{PREFIX}{id}"))?;
        match fs::remove_file(path) {
            Ok(()) => Ok(None),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Ok(Some(format!(
                "Pop-out closed, but its unreferenced snapshot file could not be removed: {e}"
            ))),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn reference(cwd: &Path, snapshot: &CodeSnapshot) -> SavedPopout {
        SavedPopout {
            id: uuid::Uuid::new_v4().to_string(),
            cwd: cwd.into(),
            pi: PiSessionRef {
                path: cwd.join("pi.jsonl"),
                session_id: "session-a".into(),
            },
            fingerprint: fingerprint(&snapshot.language, &snapshot.text),
            geometry: None,
        }
    }
    fn snapshot() -> CodeSnapshot {
        CodeSnapshot {
            session: "runtime".into(),
            title: "A".into(),
            text: "# Reference\n".into(),
            language: "markdown".into(),
        }
    }
    #[test]
    fn hashes_exact_content_and_language_not_renderer_keys() {
        assert_eq!(fingerprint("MD", "same"), fingerprint("markdown", "same"));
        assert_ne!(fingerprint("ts", "same"), fingerprint("text", "same"));
        assert_ne!(fingerprint("ts", "same"), fingerprint("ts", "same\n"));
        assert_ne!(fingerprint("a", "bc"), fingerprint("ab", "c"));
    }
    #[test]
    fn snapshots_restore_without_pi_or_transcript_and_close_removes_only_their_state() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = snapshot();
        let reference = reference(dir.path(), &snapshot);
        preferences
            .update_state(
                serde_json::from_value(serde_json::json!({"other-window": true})).unwrap(),
            )
            .unwrap();
        store.save_new(&reference, &snapshot).unwrap();
        assert!(!reference.pi.path.exists()); // Restoration reads only Nimrod's snapshot.
        let reopened = Preferences::isolated(dir.path());
        let reopened = SnapshotStore(&reopened);
        let (references, warnings) = reopened.references(dir.path(), &reference.pi);
        assert!(warnings.is_empty());
        assert_eq!(references.len(), 1);
        assert_eq!(reopened.load(&references[0]).unwrap().text, snapshot.text);
        let other = PiSessionRef {
            session_id: "replaced".into(),
            ..reference.pi.clone()
        };
        assert!(reopened.references(dir.path(), &other).0.is_empty());
        assert!(
            reopened
                .references(&dir.path().join("other"), &reference.pi)
                .0
                .is_empty()
        );
        reopened.remove(&reference.id).unwrap();
        assert!(!store.path(&reference.id).unwrap().exists());
        assert!(store.references(dir.path(), &reference.pi).0.is_empty());
        assert_eq!(preferences.snapshot().state["other-window"], true);
    }
    #[test]
    fn missing_corrupt_and_mismatched_snapshots_remain_referenced_and_report_errors() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = snapshot();
        let reference = reference(dir.path(), &snapshot);
        store.save_new(&reference, &snapshot).unwrap();
        let path = store.path(&reference.id).unwrap();
        fs::write(&path, "broken").unwrap();
        assert!(store.load(&reference).is_err());
        fs::remove_file(&path).unwrap();
        assert!(store.load(&reference).is_err());
        assert_eq!(store.references(dir.path(), &reference.pi).0.len(), 1);
        let mut bad = reference.clone();
        bad.id = "../../outside".into();
        assert!(store.load(&bad).is_err());
        assert!(store.remove(&bad.id).is_err());
    }
    #[test]
    fn failed_state_write_rolls_back_only_new_snapshot_and_does_not_overwrite_existing_files() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = snapshot();
        let reference = reference(dir.path(), &snapshot);
        store.save_new(&reference, &snapshot).unwrap();
        assert!(store.save_new(&reference, &snapshot).is_err());
        assert_eq!(store.load(&reference).unwrap().text, snapshot.text);
        let state = preferences.snapshot().state_path;
        fs::write(&state, "broken").unwrap();
        let next = SavedPopout {
            id: uuid::Uuid::new_v4().to_string(),
            ..reference.clone()
        };
        assert!(store.save_new(&next, &snapshot).is_err());
        assert!(!store.path(&next.id).unwrap().exists());
        assert!(store.remove(&reference.id).is_err());
        assert!(store.path(&reference.id).unwrap().exists());
    }
    #[test]
    fn geometry_survives_restart_without_rewriting_source_and_cannot_resurrect_closed_popouts() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = snapshot();
        let mut saved = reference(dir.path(), &snapshot);
        store.save_new(&saved, &snapshot).unwrap();
        let original = fs::read(store.path(&saved.id).unwrap()).unwrap();
        saved.geometry = Some(
            serde_json::from_value(
                serde_json::json!({"width":400.0,"height":300.0,"x":-1000,"y":80,"maximized":true}),
            )
            .unwrap(),
        );
        store.save_geometry(&saved).unwrap();
        let reopened = Preferences::isolated(dir.path());
        let reopened = SnapshotStore(&reopened);
        let restored = reopened.references(dir.path(), &saved.pi).0.remove(0);
        assert_eq!(restored.geometry, saved.geometry);
        assert_eq!(reopened.load(&restored).unwrap().text, snapshot.text);
        assert_eq!(fs::read(store.path(&saved.id).unwrap()).unwrap(), original);
        store.remove(&saved.id).unwrap();
        assert!(store.save_geometry(&saved).is_err());
        assert!(store.references(dir.path(), &saved.pi).0.is_empty());
    }
    #[test]
    fn changed_content_and_invalid_references_are_rejected_without_removing_recovery_files() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = snapshot();
        let saved = reference(dir.path(), &snapshot);
        store.save_new(&saved, &snapshot).unwrap();
        let path = store.path(&saved.id).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        value["snapshot"]["text"] = serde_json::json!("changed");
        fs::write(&path, serde_json::to_vec(&value).unwrap()).unwrap();
        assert!(store.load(&saved).is_err());
        let mut entries = serde_json::Map::new();
        entries.insert(
            format!("{PREFIX}../../outside"),
            serde_json::json!({"id":"../../outside"}),
        );
        preferences.update_state(entries).unwrap();
        let (references, warnings) = store.references(dir.path(), &saved.pi);
        assert_eq!(references.len(), 1);
        assert_eq!(warnings.len(), 1);
        assert!(path.exists());
    }
    #[test]
    fn legacy_transcript_keys_are_ignored_and_not_written_back() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = snapshot();
        let saved = reference(dir.path(), &snapshot);
        store.save_new(&saved, &snapshot).unwrap();
        let path = store.path(&saved.id).unwrap();
        let mut record: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        assert!(record["snapshot"].get("key").is_none());
        record["snapshot"]["key"] = serde_json::json!("obsolete-turn:2");
        fs::write(path, serde_json::to_vec(&record).unwrap()).unwrap();
        let restored = store.load(&saved).unwrap();
        assert_eq!(restored.text, snapshot.text);
        assert!(serde_json::to_value(restored).unwrap().get("key").is_none());
    }
    #[test]
    fn large_content_is_not_embedded_in_global_state() {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences::isolated(dir.path());
        let store = SnapshotStore(&preferences);
        let snapshot = CodeSnapshot {
            text: "x".repeat(9 * 1024 * 1024),
            ..snapshot()
        };
        let reference = reference(dir.path(), &snapshot);
        store.save_new(&reference, &snapshot).unwrap();
        assert!(
            fs::metadata(preferences.snapshot().state_path)
                .unwrap()
                .len()
                < 2048
        );
        assert_eq!(store.load(&reference).unwrap().text, snapshot.text);
    }
}
