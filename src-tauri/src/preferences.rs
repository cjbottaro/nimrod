//! Nimrod-owned configuration and disposable UI state; Pi files are never written here.
use serde::Serialize;
use serde_json::{Map, Value};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

const MAX_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub text: String,
    pub state: Map<String, Value>,
    pub settings_path: PathBuf,
    pub state_path: PathBuf,
    pub error: Option<String>,
    pub revision: u64,
}

pub struct Preferences {
    inner: Mutex<Snapshot>,
}

pub fn directory(home: &Path, override_path: Option<PathBuf>, fallback: &str) -> PathBuf {
    override_path
        .filter(|p| p.is_absolute())
        .unwrap_or_else(|| home.join(fallback))
        .join("nimrod")
}

fn read(path: &Path) -> Result<Option<String>, String> {
    match fs::metadata(path) {
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
        Ok(metadata) if metadata.len() > MAX_BYTES => return Err("File exceeds 8 MiB".into()),
        Ok(_) => {}
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|e| e.to_string())
}

/// Strip JSONC comments and trailing commas without touching string contents.
fn jsonc(text: &str) -> Result<Value, String> {
    let mut bytes = text.as_bytes().to_vec();
    let mut i = 0;
    let mut string = false;
    while i < bytes.len() {
        if string {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                string = false;
            }
        } else if bytes[i] == b'"' {
            string = true;
        } else if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                bytes[i] = b' ';
                i += 1;
            }
            continue;
        } else if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            bytes[i] = b' ';
            bytes[i + 1] = b' ';
            i += 2;
            let mut closed = false;
            while i + 1 < bytes.len() {
                if bytes[i] == b'*' && bytes[i + 1] == b'/' {
                    bytes[i] = b' ';
                    bytes[i + 1] = b' ';
                    i += 2;
                    closed = true;
                    break;
                }
                if bytes[i] != b'\n' && bytes[i] != b'\r' {
                    bytes[i] = b' ';
                }
                i += 1;
            }
            if !closed {
                return Err("Unclosed comment".into());
            }
            continue;
        }
        i += 1;
    }
    string = false;
    i = 0;
    while i < bytes.len() {
        if string {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                string = false;
            }
        } else if bytes[i] == b'"' {
            string = true;
        } else if bytes[i] == b',' {
            let next = bytes[i + 1..].iter().find(|b| !b.is_ascii_whitespace());
            if matches!(next, Some(b']' | b'}')) {
                bytes[i] = b' ';
            }
        }
        i += 1;
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

fn validate(text: &str) -> Result<(), String> {
    let value = jsonc(text)?;
    let object = value.as_object().ok_or("Settings must be a JSON object")?;
    if let Some(bindings) = object.get("keybindings") {
        crate::keybindings::validate(bindings)?;
    }
    if object
        .get("notifications.enabled")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err("notifications.enabled must be a boolean".into());
    }
    if let Some(zoom) = object.get("appearance.zoom") {
        if ![75, 90, 100, 110, 125, 150, 175, 200]
            .iter()
            .any(|n| zoom.as_u64() == Some(*n))
        {
            return Err(
                "appearance.zoom must be one of 75, 90, 100, 110, 125, 150, 175, 200".into(),
            );
        }
    }
    for key in ["runtime.piPath", "runtime.nodePath", "appearance.theme"] {
        if let Some(value) = object.get(key) {
            let text = value
                .as_str()
                .ok_or_else(|| format!("{key} must be a string"))?;
            if text.trim().is_empty() || text.len() > 4096 || text.chars().any(char::is_control) {
                return Err(format!("{key} must be non-empty and on one line"));
            }
        }
    }
    if object
        .get("appearance.importedThemes")
        .is_some_and(|v| !v.is_array())
    {
        return Err("appearance.importedThemes must be an array".into());
    }
    if let Some(theme) = object.get("appearance.theme").and_then(Value::as_str) {
        let imported = object
            .get("appearance.importedThemes")
            .and_then(Value::as_array)
            .is_some_and(|items| {
                items
                    .iter()
                    .any(|item| item.get("id").and_then(Value::as_str) == Some(theme))
            });
        if !["nimrod", "dracula"].contains(&theme) && !imported {
            return Err("appearance.theme must name a built-in or imported theme".into());
        }
    }
    Ok(())
}

// Same-directory replacement; never delete the last good file before replacement.
fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
    let target = if fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_symlink()) {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        path.to_path_buf()
    };
    let path = target.as_path();
    if text.len() as u64 > MAX_BYTES {
        return Err("File exceeds 8 MiB".into());
    }
    let parent = path.parent().ok_or("Missing parent directory")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    use std::io::Write;
    let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
    file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
    file.as_file().sync_all().map_err(|e| e.to_string())?;
    file.persist(path).map_err(|e| e.error.to_string())?;
    Ok(())
}

fn parse_state(text: &str) -> Result<Map<String, Value>, String> {
    let state: Map<String, Value> = serde_json::from_str(text).map_err(|e| e.to_string())?;
    if state
        .get("version")
        .is_some_and(|version| version.as_u64() != Some(1))
    {
        return Err("Unsupported Nimrod state version".into());
    }
    Ok(state)
}

impl Preferences {
    #[cfg(test)]
    pub fn isolated(root: &Path) -> Self {
        Self {
            inner: Mutex::new(Snapshot {
                text: "{}\n".into(),
                state: Map::new(),
                settings_path: root.join("config/settings.json"),
                state_path: root.join("state/state.json"),
                error: None,
                revision: 0,
            }),
        }
    }

    pub fn new(home: &Path) -> Self {
        let config = directory(
            home,
            std::env::var_os("XDG_CONFIG_HOME").map(Into::into),
            ".config",
        );
        let state = directory(
            home,
            std::env::var_os("XDG_STATE_HOME").map(Into::into),
            ".local/state",
        );
        Self {
            inner: Mutex::new(Snapshot {
                text: "{}\n".into(),
                state: Map::new(),
                settings_path: config.join("settings.json"),
                state_path: state.join("state.json"),
                error: None,
                revision: 0,
            }),
        }
    }

    fn refresh(snapshot: &mut Snapshot) {
        let previous = (
            snapshot.text.clone(),
            snapshot.state.clone(),
            snapshot.error.clone(),
        );
        snapshot.error = None;
        match read(&snapshot.settings_path).and_then(|text| {
            let text = text.unwrap_or_else(|| "{}\n".into());
            validate(&text)?;
            Ok(text)
        }) {
            Ok(text) => snapshot.text = text,
            Err(error) => {
                snapshot.error = Some(format!(
                    "{}: {error}. Keeping the last valid settings.",
                    snapshot.settings_path.display()
                ))
            }
        }
        match read(&snapshot.state_path).and_then(|text| match text {
            Some(text) => parse_state(&text),
            None => Ok(Map::new()),
        }) {
            Ok(state) => snapshot.state = state,
            Err(error) => {
                snapshot.error = Some(format!(
                    "{}: {error}. Keeping the last valid state.",
                    snapshot.state_path.display()
                ))
            }
        }
        if previous
            != (
                snapshot.text.clone(),
                snapshot.state.clone(),
                snapshot.error.clone(),
            )
        {
            snapshot.revision += 1;
        }
    }

    pub fn notifications_enabled(&self) -> bool {
        jsonc(&self.snapshot().text)
            .ok()
            .and_then(|value| value.get("notifications.enabled").and_then(Value::as_bool))
            .unwrap_or(true)
    }

    pub fn snapshot(&self) -> Snapshot {
        let mut snapshot = self.inner.lock().unwrap();
        Self::refresh(&mut snapshot);
        snapshot.clone()
    }

    fn update_settings(&self, expected: String, text: String) -> Result<Snapshot, String> {
        validate(&text)?;
        let mut snapshot = self.inner.lock().unwrap();
        Self::refresh(&mut snapshot);
        if let Some(error) = &snapshot.error {
            return Err(error.clone());
        }
        if snapshot.text != expected {
            return Err(
                "Settings changed on disk. Review the updated values and try again.".into(),
            );
        }
        write_atomic(&snapshot.settings_path, &text)?;
        snapshot.text = text;
        snapshot.revision += 1;
        Ok(snapshot.clone())
    }

    fn migrate(&self, text: String, entries: Map<String, Value>) -> Result<Snapshot, String> {
        validate(&text)?;
        let mut snapshot = self.inner.lock().unwrap();
        Self::refresh(&mut snapshot);
        if snapshot.state.get("legacyMigrated") == Some(&Value::Bool(true)) {
            return Ok(snapshot.clone());
        }
        if snapshot.error.is_some() {
            return Ok(snapshot.clone());
        }
        if !snapshot.settings_path.exists() {
            write_atomic(&snapshot.settings_path, &text)?;
            snapshot.text = text;
        }
        for (key, value) in entries {
            snapshot.state.entry(key).or_insert(value);
        }
        snapshot.state.insert("version".into(), Value::from(1));
        snapshot
            .state
            .insert("legacyMigrated".into(), Value::Bool(true));
        write_atomic(
            &snapshot.state_path,
            &serde_json::to_string_pretty(&snapshot.state).map_err(|e| e.to_string())?,
        )?;
        snapshot.revision += 1;
        Ok(snapshot.clone())
    }

    pub fn update_state(&self, entries: Map<String, Value>) -> Result<Snapshot, String> {
        self.change_state(|state| {
            state.extend(entries);
            Ok(())
        })
    }

    pub fn remove_state(&self, key: &str) -> Result<Snapshot, String> {
        self.change_state(|state| {
            state.remove(key);
            Ok(())
        })
    }

    pub fn update_existing_state(&self, key: String, value: Value) -> Result<Snapshot, String> {
        self.change_state(|state| {
            if !state.contains_key(&key) {
                return Err("Saved state entry no longer exists".into());
            }
            state.insert(key, value);
            Ok(())
        })
    }

    fn change_state(
        &self,
        change: impl FnOnce(&mut Map<String, Value>) -> Result<(), String>,
    ) -> Result<Snapshot, String> {
        let mut snapshot = self.inner.lock().unwrap();
        Self::refresh(&mut snapshot);
        if let Some(error) = &snapshot.error {
            return Err(error.clone());
        }
        let mut state = snapshot.state.clone();
        change(&mut state)?;
        state.insert("version".into(), Value::from(1));
        write_atomic(
            &snapshot.state_path,
            &serde_json::to_string_pretty(&state).map_err(|e| e.to_string())?,
        )?;
        snapshot.state = state;
        snapshot.revision += 1;
        Ok(snapshot.clone())
    }
}

#[tauri::command]
pub fn preferences_migrate(
    app: tauri::AppHandle,
    preferences: tauri::State<'_, Preferences>,
    text: String,
    entries: Map<String, Value>,
) -> Result<Snapshot, String> {
    let result = preferences.migrate(text, entries);
    let _ = app.emit("nimrod-preferences", preferences.snapshot());
    result
}

#[tauri::command]
pub fn preferences_snapshot(preferences: tauri::State<'_, Preferences>) -> Snapshot {
    preferences.snapshot()
}

#[tauri::command]
pub fn preferences_settings(
    app: tauri::AppHandle,
    preferences: tauri::State<'_, Preferences>,
    expected: String,
    text: String,
) -> Result<Snapshot, String> {
    let result = preferences.update_settings(expected, text);
    let _ = app.emit("nimrod-preferences", preferences.snapshot());
    result
}

#[tauri::command]
pub fn preferences_state(
    app: tauri::AppHandle,
    preferences: tauri::State<'_, Preferences>,
    entries: Map<String, Value>,
) -> Result<Snapshot, String> {
    let result = preferences.update_state(entries);
    let _ = app.emit("nimrod-preferences", preferences.snapshot());
    result
}

pub fn watch(app: &tauri::AppHandle) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let mut previous = String::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let snapshot = app.state::<Preferences>().snapshot();
            let fingerprint = serde_json::to_string(&snapshot).unwrap_or_default();
            if fingerprint != previous {
                previous = fingerprint;
                let _ = app.emit("nimrod-preferences", snapshot);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (tempfile::TempDir, Preferences) {
        let dir = tempfile::tempdir().unwrap();
        let preferences = Preferences {
            inner: Mutex::new(Snapshot {
                text: "{}\n".into(),
                state: Map::new(),
                settings_path: dir.path().join("config/settings.json"),
                state_path: dir.path().join("state/state.json"),
                error: None,
                revision: 0,
            }),
        };
        (dir, preferences)
    }
    #[test]
    fn xdg_paths_require_absolute_overrides() {
        assert_eq!(
            directory(Path::new("/home/test"), None, ".config"),
            Path::new("/home/test/.config/nimrod")
        );
        assert_eq!(
            directory(Path::new("/home/test"), Some("relative".into()), ".config"),
            Path::new("/home/test/.config/nimrod")
        );
        assert_eq!(
            directory(Path::new("/home/test"), Some("/custom".into()), ".config"),
            Path::new("/custom/nimrod")
        );
    }
    #[test]
    fn jsonc_strings_comments_and_trailing_commas() {
        validate("{ // comment\n \"runtime.piPath\": \"https://host/*text*/\", /* note */ \"appearance.zoom\":125, }").unwrap();
        assert!(validate("{/* unfinished").is_err());
        assert!(validate("{\"appearance.zoom\":126}").is_err());
        assert!(validate("[]").is_err());
        assert!(validate("{\"notifications.enabled\":\"yes\"}").is_err());
        validate("{\"notifications.enabled\":false}").unwrap();
        assert!(validate("{\"runtime.piPath\":\"\"}").is_err());
    }
    #[test]
    fn external_edits_conflicts_and_invalid_recovery() {
        let (_dir, p) = fixture();
        let old = p.snapshot();
        let new = "{\"appearance.zoom\":150}";
        p.update_settings(old.text.clone(), new.into()).unwrap();
        assert!(p.update_settings(old.text, "{}".into()).is_err());
        let path = p.snapshot().settings_path;
        fs::write(&path, "broken").unwrap();
        let snapshot = p.snapshot();
        assert_eq!(snapshot.text, new);
        assert!(snapshot.error.is_some());
        assert!(p.update_settings(new.into(), "{}".into()).is_err());
        fs::write(&path, "{}").unwrap();
        assert!(p.snapshot().error.is_none());
        fs::remove_file(path).unwrap();
        assert_eq!(p.snapshot().text, "{}\n");
    }
    #[test]
    fn migration_does_not_override_existing_configuration_or_repeat() {
        let (_dir, p) = fixture();
        let path = p.snapshot().settings_path;
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{} // User-authored file").unwrap();
        let first = p
            .migrate(
                "{\"appearance.zoom\":150}".into(),
                serde_json::from_str("{\"recent\":[\"/a\"]}").unwrap(),
            )
            .unwrap();
        assert_eq!(first.text, "{} // User-authored file");
        let second = p
            .migrate(
                "{\"appearance.zoom\":200}".into(),
                serde_json::from_str("{\"recent\":[\"/b\"]}").unwrap(),
            )
            .unwrap();
        assert_eq!(second.state["recent"], serde_json::json!(["/a"]));
        assert_eq!(second.revision, first.revision);
    }
    #[test]
    fn malformed_state_is_not_overwritten_by_a_ui_update() {
        let (_dir, p) = fixture();
        p.update_state(serde_json::from_str("{\"keep\":true}").unwrap())
            .unwrap();
        let path = p.snapshot().state_path;
        fs::write(&path, "broken").unwrap();
        assert!(p.update_state(Map::new()).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "broken");
    }
    #[cfg(unix)]
    #[test]
    fn atomic_write_preserves_dotfile_symlinks() {
        let (dir, p) = fixture();
        let path = p.snapshot().settings_path;
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        let target = dir.path().join("dotfile.json");
        fs::write(&target, "{}").unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        p.update_settings("{}".into(), "{\"appearance.zoom\":150}".into())
            .unwrap();
        assert!(fs::symlink_metadata(path).unwrap().file_type().is_symlink());
        assert_eq!(
            fs::read_to_string(target).unwrap(),
            "{\"appearance.zoom\":150}"
        );
    }
    #[test]
    fn state_updates_merge_instead_of_overwriting_other_windows() {
        let (_dir, p) = fixture();
        p.update_state(serde_json::from_str("{\"a\":1}").unwrap())
            .unwrap();
        p.update_state(serde_json::from_str("{\"b\":2}").unwrap())
            .unwrap();
        let snapshot = p.snapshot();
        assert_eq!(snapshot.state.len(), 3);
        assert_eq!(snapshot.state["version"], Value::from(1));
        assert_eq!(snapshot.text, "{}\n");
    }
}
