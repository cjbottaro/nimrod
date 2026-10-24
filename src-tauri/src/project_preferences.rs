//! Project overrides belong to the canonical directory, never to Pi configuration.
use crate::preferences::{Preferences, Snapshot};
use serde::Serialize;
use std::{
    collections::HashMap,
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{Emitter, Manager};

pub const KEYS: &[&str] = &[
    "appearance.theme",
    "runtime.piPath",
    "runtime.nodePath",
    "runtime.copilotPath",
    "runtime.codexPath",
    "interaction.autocompleteAccept",
];

#[derive(Clone, Default, PartialEq)]
struct Document {
    text: String,
    error: Option<String>,
    revision: u64,
}
#[derive(Default)]
pub struct ProjectPreferences(Mutex<HashMap<PathBuf, Document>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScopedSnapshot {
    #[serde(flatten)]
    global: Snapshot,
    project_text: Option<String>,
    project_path: Option<PathBuf>,
    project_error: Option<String>,
    project_revision: u64,
}

fn path(cwd: &Path) -> PathBuf {
    cwd.join(".nimrod/settings.json")
}

// Earlier Nimrod versions allowed these as overrides. Preserve their source
// bytes/comments, but never apply them or copy them into global preferences.
const LEGACY_KEYS: &[&str] = &["appearance.zoom", "appearance.autoFollowAfterSending"];

fn overrides(text: &str) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    let project = crate::preferences::jsonc(text)?;
    let object = project
        .as_object()
        .ok_or("Project settings must be a JSON/JSONC object")?;
    for key in object.keys() {
        if !KEYS.contains(&key.as_str()) && !LEGACY_KEYS.contains(&key.as_str()) {
            return Err(format!(
                "{key} is not a project setting; edit global Settings instead"
            ));
        }
    }
    Ok(object
        .iter()
        .filter(|(key, _)| KEYS.contains(&key.as_str()))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect())
}

fn validate(text: &str, global: &str) -> Result<(), String> {
    let project = overrides(text)?;
    if project.is_empty() {
        return Ok(());
    }
    let mut merged = crate::preferences::jsonc(global)?;
    merged
        .as_object_mut()
        .ok_or("Global settings must be an object")?
        .extend(project);
    crate::preferences::validate(&merged.to_string())
}

fn refresh(document: &mut Document, cwd: &Path, global: &str) -> bool {
    let previous = document.clone();
    match crate::preferences::read(&path(cwd)).and_then(|text| {
        let text = text.unwrap_or_else(|| "{}\n".into());
        validate(&text, global)?;
        Ok(text)
    }) {
        Ok(text) => {
            document.text = text;
            document.error = None;
        }
        Err(error) => {
            document.error = Some(format!(
                "{}: {error}. Keeping the last valid project settings.",
                path(cwd).display()
            ))
        }
    }
    if document.text != previous.text || document.error != previous.error {
        document.revision += 1;
        true
    } else {
        false
    }
}

impl ProjectPreferences {
    pub fn snapshot(&self, global: Snapshot, cwd: Option<&Path>) -> ScopedSnapshot {
        let mut projects = self.0.lock().unwrap();
        let document = cwd.map(|cwd| {
            let document = projects.entry(cwd.to_owned()).or_insert_with(|| Document {
                text: "{}\n".into(),
                ..Document::default()
            });
            refresh(document, cwd, &global.text);
            document.clone()
        });
        ScopedSnapshot {
            global,
            project_text: document.as_ref().map(|document| document.text.clone()),
            project_path: cwd.map(path),
            project_error: document
                .as_ref()
                .and_then(|document| document.error.clone()),
            project_revision: document.map_or(0, |document| document.revision),
        }
    }

    pub fn forget(&self, cwd: &Path) {
        self.0.lock().unwrap().remove(cwd);
    }

    pub fn refresh_all(&self, global: &str) -> String {
        let mut projects = self.0.lock().unwrap();
        for (cwd, document) in projects.iter_mut() {
            refresh(document, cwd, global);
        }
        // Watcher-owned fingerprints must detect revisions even when a scoped
        // read observed an external edit before the polling loop did.
        let mut revisions: Vec<_> = projects
            .iter()
            .map(|(cwd, document)| (cwd, document.revision))
            .collect();
        revisions.sort_by(|a, b| a.0.cmp(b.0));
        serde_json::to_string(&revisions).unwrap_or_default()
    }

    fn update(
        &self,
        cwd: &Path,
        global: &Snapshot,
        expected: &str,
        text: &str,
    ) -> Result<(), String> {
        if let Some(error) = &global.error {
            return Err(error.clone());
        }
        validate(text, &global.text)?;
        let mut projects = self.0.lock().unwrap();
        let document = projects.entry(cwd.to_owned()).or_insert_with(|| Document {
            text: "{}\n".into(),
            ..Document::default()
        });
        refresh(document, cwd, &global.text);
        if let Some(error) = &document.error {
            // Permit a valid reset after a global library removal invalidates an
            // unchanged project theme. Never replace malformed/changed disk bytes.
            if crate::preferences::read(&path(cwd))?.as_deref() != Some(expected)
                || crate::preferences::jsonc(expected)
                    .ok()
                    .is_none_or(|value| !value.is_object())
            {
                return Err(error.clone());
            }
        }
        if document.text != expected {
            return Err(
                "Project settings changed on disk. Review the updated values and try again.".into(),
            );
        }
        if text == expected {
            return Ok(());
        }
        crate::preferences::write_atomic(&path(cwd), text)?;
        document.text = text.into();
        document.error = None;
        document.revision += 1;
        Ok(())
    }
}

fn owned_project(app: &tauri::AppHandle, window: &tauri::Window) -> Option<PathBuf> {
    app.state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
}

#[tauri::command]
pub fn scoped_preferences_snapshot(app: tauri::AppHandle, window: tauri::Window) -> ScopedSnapshot {
    let cwd = owned_project(&app, &window).or_else(|| {
        app.state::<crate::popouts::Popouts>()
            .reference_project(window.label())
    });
    app.state::<ProjectPreferences>()
        .snapshot(app.state::<Preferences>().snapshot(), cwd.as_deref())
}

#[tauri::command]
pub fn project_preferences_settings(
    app: tauri::AppHandle,
    window: tauri::Window,
    expected: String,
    text: String,
) -> Result<ScopedSnapshot, String> {
    let cwd =
        owned_project(&app, &window).ok_or("Open a project before changing project settings")?;
    let global = app.state::<Preferences>().snapshot();
    let result = app
        .state::<ProjectPreferences>()
        .update(&cwd, &global, &expected, &text);
    let _ = app.emit("nimrod-preferences", app.state::<Preferences>().snapshot());
    result?;
    Ok(scoped_preferences_snapshot(app, window))
}

#[derive(Serialize)]
pub struct ProjectOverride {
    cwd: PathBuf,
    keys: Vec<String>,
}

#[tauri::command]
pub fn list_project_overrides(app: tauri::AppHandle) -> Vec<ProjectOverride> {
    let directories: Vec<_> = app
        .state::<crate::WorkspaceWindows>()
        .directories
        .lock()
        .unwrap()
        .values()
        .cloned()
        .collect();
    let global = app.state::<Preferences>().snapshot();
    let projects = app.state::<ProjectPreferences>();
    let mut result = Vec::new();
    for cwd in directories {
        let snapshot = projects.snapshot(global.clone(), Some(&cwd));
        let keys: Vec<_> = snapshot
            .project_text
            .as_deref()
            .and_then(|text| overrides(text).ok())
            .map(|object| object.keys().cloned().collect())
            .unwrap_or_default();
        if !keys.is_empty() {
            result.push(ProjectOverride { cwd, keys });
        }
    }
    result.sort_by(|a, b| a.cwd.cmp(&b.cwd));
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn autocomplete_acceptance_is_a_validated_project_override() {
        validate(r#"{"interaction.autocompleteAccept":"tabOrEnter"}"#, "{}").unwrap();
        validate(r#"{"interaction.autocompleteAccept":"tab"}"#, r#"{"interaction.autocompleteAccept":"tabOrEnter"}"#).unwrap();
        assert!(validate(r#"{"interaction.autocompleteAccept":"enter"}"#, "{}").is_err());
        assert_eq!(overrides(r#"{"interaction.autocompleteAccept":"tab"}"#).unwrap().len(), 1);
    }

    #[test]
    fn overrides_validate_against_global_library_and_reject_global_only_keys() {
        validate(
            r#"{"appearance.zoom":125,"runtime.piPath":"pi-custom"}"#,
            "{}",
        )
        .unwrap();
        assert!(validate(r#"{"keybindings":{}}"#, "{}").is_err());
        assert!(validate(r#"{"notifications.enabled":false}"#, "{}").is_err());
        assert!(validate(r#"{"appearance.zoom":126}"#, "{}").is_ok());
        assert!(validate(r#"{"runtime.piPath":""}"#, "{}").is_err());
        let obsolete = r#"{"appearance.zoom":null,"appearance.autoFollowAfterSending":"obsolete","appearance.theme":"dracula"}"#;
        validate(obsolete, "{}").unwrap();
        assert_eq!(
            overrides(obsolete).unwrap(),
            serde_json::from_str::<serde_json::Map<String, serde_json::Value>>(
                r#"{"appearance.theme":"dracula"}"#
            )
            .unwrap()
        );
        validate(
            r#"{"appearance.theme":"import-example"}"#,
            r#"{"appearance.importedThemes":[{"id":"import-example"}]}"#,
        )
        .unwrap();
    }
    #[test]
    fn project_files_are_independent_and_refresh_deletion_errors_and_conflicts() {
        let dir = tempfile::tempdir().unwrap();
        let home = tempfile::tempdir().unwrap();
        let global = Snapshot {
            text: "{}\n".into(),
            state: serde_json::Map::new(),
            settings_path: home.path().join("settings.json"),
            state_path: home.path().join("state.json"),
            error: None,
            revision: 0,
        };
        let projects = ProjectPreferences::default();
        let first = projects.snapshot(global.clone(), Some(dir.path()));
        assert!(!path(dir.path()).exists());
        projects
            .update(
                dir.path(),
                &global,
                first.project_text.as_deref().unwrap(),
                "{\"appearance.theme\":\"dracula\"}",
            )
            .unwrap();
        assert!(projects.update(dir.path(), &global, "{}\n", "{}").is_err());
        let before = projects.refresh_all(&global.text);
        std::fs::write(path(dir.path()), "{\"appearance.theme\":\"tokyo-night\"}").unwrap();
        projects.snapshot(global.clone(), Some(dir.path()));
        let observed = projects.refresh_all(&global.text);
        assert_ne!(
            observed, before,
            "a scoped read must not swallow watcher invalidation"
        );
        assert_eq!(projects.refresh_all(&global.text), observed);
        std::fs::write(path(dir.path()), "broken").unwrap();
        let invalid = projects.snapshot(global.clone(), Some(dir.path()));
        assert!(invalid.project_error.is_some());
        assert_eq!(
            invalid.project_text.as_deref(),
            Some("{\"appearance.theme\":\"tokyo-night\"}")
        );
        assert!(
            projects
                .update(
                    dir.path(),
                    &global,
                    invalid.project_text.as_deref().unwrap(),
                    "{}"
                )
                .is_err()
        );
        assert_eq!(std::fs::read_to_string(path(dir.path())).unwrap(), "broken");
        std::fs::remove_file(path(dir.path())).unwrap();
        let deleted = projects.snapshot(global, Some(dir.path()));
        assert_eq!(deleted.project_text.as_deref(), Some("{}\n"));
        assert!(deleted.project_error.is_none());
    }

    #[test]
    fn removed_global_import_can_be_reset_without_overwriting_changed_project_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let mut global = Snapshot {
            text: r#"{"appearance.importedThemes":[{"id":"import-example"}]}"#.into(),
            state: serde_json::Map::new(),
            settings_path: dir.path().join("global.json"),
            state_path: dir.path().join("state.json"),
            error: None,
            revision: 0,
        };
        let projects = ProjectPreferences::default();
        let selected = r#"{"appearance.theme":"import-example"}"#;
        projects
            .update(dir.path(), &global, "{}\n", selected)
            .unwrap();
        global.text = "{}".into();
        let invalid = projects.snapshot(global.clone(), Some(dir.path()));
        assert!(invalid.project_error.is_some());
        projects
            .update(dir.path(), &global, selected, "{}")
            .unwrap();
        assert!(
            projects
                .snapshot(global, Some(dir.path()))
                .project_error
                .is_none()
        );
    }
}
