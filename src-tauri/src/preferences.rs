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

pub(crate) fn read(path: &Path) -> Result<Option<String>, String> {
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
pub(crate) fn jsonc(text: &str) -> Result<Value, String> {
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

pub(crate) fn validate(text: &str) -> Result<(), String> {
    let value = jsonc(text)?;
    let object = value.as_object().ok_or("Settings must be a JSON object")?;
    if object
        .get("cards.autoLoad")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("cards.autoLoad must be a boolean".into());
    }
    for key in ["cards.plugins", "cards.trustedPlugins"] {
        if let Some(files) = object.get(key) {
            let files = files
                .as_array()
                .ok_or_else(|| format!("{key} must be an array"))?;
            let mut seen = std::collections::HashSet::new();
            if files.len() > 50
                || files.iter().any(|file| {
                    file.as_str().is_none_or(|name| {
                        !crate::card_plugins::filename(name) || !seen.insert(name)
                    })
                })
            {
                return Err(format!(
                    "{key} must contain at most 50 unique JSON filenames"
                ));
            }
        }
    }
    if let Some(overrides) = object.get("cards.renderers") {
        let overrides = overrides
            .as_object()
            .ok_or("cards.renderers must be an object")?;
        if overrides.len() > 100
            || overrides.iter().any(|(name, id)| {
                name.is_empty()
                    || !name
                        .bytes()
                        .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))
                    || id
                        .as_str()
                        .is_none_or(|id| !crate::card_plugins::renderer_id(id))
            })
        {
            return Err("cards.renderers must map normalized tool names to renderer IDs".into());
        }
    }
    if let Some(bindings) = object.get("keybindings") {
        crate::keybindings::validate(bindings)?;
    }
    if object
        .get("notifications.enabled")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err("notifications.enabled must be a boolean".into());
    }
    if object
        .get("diagnostics.performance")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err("diagnostics.performance must be a boolean".into());
    }
    if object
        .get("diagnostics.toolCapture")
        .is_some_and(|v| !v.is_boolean())
    {
        return Err("diagnostics.toolCapture must be a boolean".into());
    }
    if let Some(opacity) = object.get("appearance.backgroundOpacity") {
        if !opacity
            .as_f64()
            .is_some_and(|value| value.fract() == 0.0 && (0.0..=100.0).contains(&value))
        {
            return Err("appearance.backgroundOpacity must be an integer from 0 to 100".into());
        }
    }
    if let Some(blur) = object.get("appearance.backgroundBlur") {
        if !blur
            .as_f64()
            .is_some_and(|value| value.fract() == 0.0 && (0.0..=40.0).contains(&value))
        {
            return Err("appearance.backgroundBlur must be an integer from 0 to 40".into());
        }
    }
    if object
        .get("appearance.frostedBackground")
        .is_some_and(|value| !value.is_boolean())
    {
        return Err("appearance.frostedBackground must be a boolean".into());
    }
    if let Some(area) = object.get("appearance.translucencyArea") {
        if !matches!(area.as_str(), Some("chrome" | "window")) {
            return Err("appearance.translucencyArea must be chrome or window".into());
        }
    }
    if let Some(style) = object.get("appearance.modalAnimation") {
        if !matches!(style.as_str(), Some("none" | "subtle" | "crt" | "hologram")) {
            return Err("appearance.modalAnimation must be none, subtle, crt or hologram".into());
        }
    }
    if let Some(duration) = object.get("appearance.modalAnimationDuration") {
        if !duration
            .as_f64()
            .is_some_and(|value| value.fract() == 0.0 && (0.0..=2000.0).contains(&value))
        {
            return Err(
                "appearance.modalAnimationDuration must be an integer from 0 to 2000 milliseconds"
                    .into(),
            );
        }
    }
    if let Some(mode) = object.get("appearance.autoFollowAfterSending") {
        if !matches!(mode.as_str(), Some("always" | "whenIdle" | "never")) {
            return Err(
                "appearance.autoFollowAfterSending must be always, whenIdle or never".into(),
            );
        }
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
    for key in [
        "runtime.piPath",
        "runtime.nodePath",
        "runtime.copilotPath",
        "appearance.theme",
    ] {
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
        static CATALOG_IDS: std::sync::OnceLock<std::collections::HashSet<String>> =
            std::sync::OnceLock::new();
        let bundled = CATALOG_IDS
            .get_or_init(|| {
                let catalog: Value =
                    serde_json::from_str(include_str!("../../src/themes/catalog.json"))
                        .expect("validated bundled theme catalog");
                catalog["themes"]
                    .as_array()
                    .expect("catalog themes")
                    .iter()
                    .filter_map(|entry| entry["id"].as_str().map(String::from))
                    .collect()
            })
            .contains(theme);
        if !["nimrod", "dracula", "tokyo-night", "osaka-jade"].contains(&theme)
            && !imported
            && !bundled
        {
            return Err("appearance.theme must name a built-in or imported theme".into());
        }
    }
    Ok(())
}

// Same-directory replacement; never delete the last good file before replacement.
pub(crate) fn write_atomic(path: &Path, text: &str) -> Result<(), String> {
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

    pub fn record_command_usage(&self, id: &str) -> Result<Snapshot, String> {
        self.change_state(|state| {
            let now = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map_err(|error| error.to_string())?
                .as_millis() as u64;
            crate::command_usage::record(state, id, now)
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
        // Refresh/validate first: identical patches must still respect external
        // edits and malformed-file guards. Do not rewrite unchanged bookkeeping.
        if state == snapshot.state {
            return Ok(snapshot.clone());
        }
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
pub fn record_command_usage(
    app: tauri::AppHandle,
    preferences: tauri::State<'_, Preferences>,
    id: String,
) -> Result<Snapshot, String> {
    let result = preferences.record_command_usage(&id);
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
        let mut previous_projects = String::new();
        loop {
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            let snapshot = app.state::<Preferences>().snapshot();
            let fingerprint = serde_json::to_string(&snapshot).unwrap_or_default();
            let projects = app
                .state::<crate::project_preferences::ProjectPreferences>()
                .refresh_all(&snapshot.text);
            if fingerprint != previous || projects != previous_projects {
                previous = fingerprint;
                previous_projects = projects;
                let _ = app.emit("nimrod-preferences", snapshot);
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validates_card_plugin_filenames_and_renderer_overrides() {
        assert!(validate(r#"{"cards.plugins":["example.json"],"cards.renderers":{"read":"example.read","edit":"nimrod.raw"}}"#).is_ok());
        for text in [
            r#"{"cards.plugins":["../example.json"]}"#,
            r#"{"cards.trustedPlugins":["../example.json"]}"#,
            r#"{"cards.trustedPlugins":["example.json","example.json"]}"#,
            r#"{"cards.trustedPlugins":true}"#,
            r#"{"cards.plugins":["example.json","example.json"]}"#,
            r#"{"cards.plugins":["https://example.json"]}"#,
            r#"{"cards.renderers":{"functions.read":"example.read"}}"#,
            r#"{"cards.renderers":{"read":"example..read"}}"#,
            r#"{"cards.renderers":{"read":"1example.read"}}"#,
        ] {
            assert!(validate(text).is_err(), "{text}");
        }
    }
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
    fn window_appearance_settings_are_bounded_and_typed() {
        for opacity in ["0", "65", "100", "50.0"] {
            validate(&format!(r#"{{"appearance.backgroundOpacity":{opacity}}}"#)).unwrap();
        }
        for opacity in ["-1", "101", "50.5", "null", "true", r#""50""#] {
            assert!(validate(&format!(r#"{{"appearance.backgroundOpacity":{opacity}}}"#)).is_err());
        }
        validate(
            r#"{"appearance.frostedBackground":false,"appearance.translucencyArea":"chrome"}"#,
        )
        .unwrap();
        validate(r#"{"appearance.translucencyArea":"window"}"#).unwrap();
        assert!(validate(r#"{"appearance.frostedBackground":null}"#).is_err());
        for blur in ["0", "20", "40"] {
            validate(&format!(r#"{{"appearance.backgroundBlur":{blur}}}"#)).unwrap();
        }
        for blur in ["-1", "41", "1.5", "true", "null", r#""20""#] {
            assert!(validate(&format!(r#"{{"appearance.backgroundBlur":{blur}}}"#)).is_err());
        }
        assert!(validate(r#"{"appearance.translucencyArea":"sidebar"}"#).is_err());
    }
    #[test]
    fn modal_animation_settings_are_bounded_and_typed() {
        for style in ["none", "subtle", "crt", "hologram"] {
            validate(&format!(r#"{{"appearance.modalAnimation":"{style}"}}"#)).unwrap();
        }
        for style in ["null", "true", "1", r#""unknown""#] {
            assert!(validate(&format!(r#"{{"appearance.modalAnimation":{style}}}"#)).is_err());
        }
        for duration in ["0", "160", "2000", "160.0"] {
            validate(&format!(
                r#"{{"appearance.modalAnimationDuration":{duration}}}"#
            ))
            .unwrap();
        }
        for duration in ["-1", "2001", "0.5", "null", "true", r#""160""#] {
            assert!(
                validate(&format!(
                    r#"{{"appearance.modalAnimationDuration":{duration}}}"#
                ))
                .is_err()
            );
        }
    }

    #[test]
    fn jsonc_strings_comments_and_trailing_commas() {
        validate("{ // comment\n \"runtime.piPath\": \"https://host/*text*/\", /* note */ \"appearance.zoom\":125, }").unwrap();
        assert!(validate("{/* unfinished").is_err());
        assert!(validate("{\"appearance.zoom\":126}").is_err());
        assert!(validate("[]").is_err());
        assert!(validate("{\"notifications.enabled\":\"yes\"}").is_err());
        validate("{\"notifications.enabled\":false}").unwrap();
        for mode in ["always", "whenIdle", "never"] {
            validate(&format!(
                r#"{{"appearance.autoFollowAfterSending":"{mode}"}}"#
            ))
            .unwrap();
        }
        for mode in ["null", "true", "1", r#""idle""#, "{}", r#"["always"]"#] {
            assert!(
                validate(&format!(
                    r#"{{"appearance.autoFollowAfterSending":{mode}}}"#
                ))
                .is_err()
            );
        }
        validate("{\"diagnostics.performance\":true}").unwrap();
        assert!(validate("{\"diagnostics.performance\":\"true\"}").is_err());
        assert!(validate("{\"diagnostics.performance\":null}").is_err());
        assert!(validate("{\"runtime.piPath\":\"\"}").is_err());
    }
    #[test]
    fn catalog_selections_match_checked_in_ids() {
        let catalog: Value =
            serde_json::from_str(include_str!("../../src/themes/catalog.json")).unwrap();
        for entry in catalog["themes"].as_array().unwrap() {
            assert!(
                validate(&serde_json::json!({"appearance.theme": entry["id"]}).to_string()).is_ok()
            );
        }
        assert!(validate(r#"{"appearance.theme":"catalog-unknown"}"#).is_err());
    }

    #[test]
    fn built_in_theme_selections() {
        for theme in ["nimrod", "dracula", "tokyo-night", "osaka-jade"] {
            validate(&format!(r#"{{"appearance.theme":"{theme}"}}"#)).unwrap();
        }
        assert!(validate(r#"{"appearance.theme":"unknown"}"#).is_err());
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
        assert!(
            p.update_state(serde_json::from_str("{\"keep\":true}").unwrap())
                .is_err(),
            "even a semantically unchanged patch must respect malformed-file guards"
        );
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
    fn command_usage_is_atomic_across_windows_and_restores_from_disk() {
        let (_dir, p) = fixture();
        std::thread::scope(|scope| {
            for _ in 0..8 {
                scope.spawn(|| {
                    p.record_command_usage("resume").unwrap();
                });
            }
        });
        p.record_command_usage("new").unwrap();
        let saved = p.snapshot();
        let history = &saved.state[crate::command_usage::KEY]["entries"];
        assert_eq!(history[0]["id"], "new");
        assert_eq!(history[1]["useCount"], 8);
        let restored = Preferences {
            inner: Mutex::new(Snapshot {
                state: Map::new(),
                ..saved
            }),
        };
        assert_eq!(
            restored.snapshot().state[crate::command_usage::KEY]["entries"][1]["useCount"],
            8
        );
        fs::write(restored.snapshot().state_path, "broken").unwrap();
        assert!(restored.record_command_usage("new").is_err());
    }

    #[test]
    fn identical_state_changes_keep_revision_and_do_not_replace_the_file() {
        let (_dir, p) = fixture();
        let first = p
            .update_state(serde_json::from_str("{\"a\":1}").unwrap())
            .unwrap();
        let compact = "{\"version\":1,\"a\":1}";
        fs::write(&first.state_path, compact).unwrap();
        let before = p.snapshot();
        let same = p
            .update_state(serde_json::from_str("{\"a\":1}").unwrap())
            .unwrap();
        assert_eq!(same.revision, before.revision);
        assert_eq!(fs::read_to_string(&same.state_path).unwrap(), compact);
        assert_eq!(p.remove_state("missing").unwrap().revision, same.revision);
        assert_eq!(
            p.update_existing_state("a".into(), Value::from(1))
                .unwrap()
                .revision,
            same.revision
        );
        assert!(
            p.update_existing_state("missing".into(), Value::from(1))
                .is_err()
        );
    }

    #[test]
    fn no_op_comparison_refreshes_external_edits_and_preserves_their_bytes() {
        let (_dir, p) = fixture();
        let first = p
            .update_state(serde_json::from_str("{\"a\":1}").unwrap())
            .unwrap();
        let external = "{\"version\":1,\"a\":1,\"b\":2}";
        fs::write(&first.state_path, external).unwrap();
        let same = p
            .update_state(serde_json::from_str("{\"a\":1}").unwrap())
            .unwrap();
        assert_eq!(same.state["b"], Value::from(2));
        assert_eq!(
            same.revision,
            first.revision + 1,
            "external edit alone advances revision"
        );
        assert_eq!(fs::read_to_string(&same.state_path).unwrap(), external);
        fs::remove_file(&same.state_path).unwrap();
        let recreated = p
            .update_state(serde_json::from_str("{\"a\":1}").unwrap())
            .unwrap();
        assert!(recreated.state_path.exists());
        assert_eq!(recreated.state["a"], Value::from(1));
        assert!(!recreated.state.contains_key("b"));
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
