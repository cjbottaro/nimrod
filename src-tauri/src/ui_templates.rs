//! Fixed, user-owned presentation files; never discover templates in project directories.
use serde::Serialize;
use std::{fs, io::Read, path::Path};
use tauri::Manager;

const MAX_BYTES: u64 = 256 * 1024;

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiTemplates {
    layout: Option<String>,
    layout_css: Option<String>,
    project_bar: Option<String>,
    project_bar_css: Option<String>,
}

fn read(root: &Path, name: &str) -> Result<Option<String>, String> {
    let path = root.join(name);
    let canonical = match fs::canonicalize(&path) {
        Ok(path) => path,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // A dangling symlink is an error, not an absent optional file.
            if fs::symlink_metadata(&path).is_ok() {
                return Err(format!("Cannot read UI template {}", path.display()));
            }
            return Ok(None);
        }
        Err(error) => return Err(format!("{}: {error}", path.display())),
    };
    if !canonical.starts_with(root) {
        return Err(format!("UI template must stay inside {}", root.display()));
    }
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if !metadata.is_file() || metadata.len() > MAX_BYTES {
        return Err(format!(
            "{} must be a regular file of at most 256 KiB",
            path.display()
        ));
    }
    let file = fs::File::open(&canonical).map_err(|error| error.to_string())?;
    let mut text = String::new();
    file.take(MAX_BYTES + 1)
        .read_to_string(&mut text)
        .map_err(|error| error.to_string())?;
    if text.len() as u64 > MAX_BYTES {
        return Err(format!("{} exceeds 256 KiB", path.display()));
    }
    Ok(Some(text))
}

fn load(root: &Path) -> Result<UiTemplates, String> {
    let root = match fs::canonicalize(root) {
        Ok(root) => root,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(UiTemplates::default()),
        Err(error) => return Err(error.to_string()),
    };
    Ok(UiTemplates {
        layout: read(&root, "layout.html")?,
        layout_css: read(&root, "layout.css")?,
        project_bar: read(&root, "project-bar.html")?,
        project_bar_css: read(&root, "project-bar.css")?,
    })
}

#[tauri::command]
pub async fn read_ui_templates(window: tauri::Window) -> Result<UiTemplates, String> {
    if window.label() != "main"
        && !window
            .app_handle()
            .state::<crate::workspace_windows::WorkspaceWindows>()
            .directories
            .lock()
            .map_err(|_| "Project window lock poisoned")?
            .contains_key(window.label())
    {
        return Err("UI templates require a welcome/project window".into());
    }
    let snapshot = window
        .app_handle()
        .state::<crate::preferences::Preferences>()
        .snapshot();
    let root = snapshot
        .settings_path
        .parent()
        .ok_or("Missing config directory")?
        .join("ui");
    tauri::async_runtime::spawn_blocking(move || load(&root))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn optional_user_files_and_size_limit() {
        let directory = tempfile::tempdir().unwrap();
        assert!(load(&directory.path().join("absent")).unwrap().layout.is_none());
        fs::write(directory.path().join("layout.html"), "<main></main>").unwrap();
        let files = load(directory.path()).unwrap();
        assert_eq!(files.layout.as_deref(), Some("<main></main>"));
        assert!(files.project_bar.is_none());
        fs::write(directory.path().join("project-bar.css"), vec![b'x'; MAX_BYTES as usize + 1]).unwrap();
        assert!(load(directory.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn refuses_escaped_symlink_and_non_file() {
        let directory = tempfile::tempdir().unwrap();
        let outside = tempfile::NamedTempFile::new().unwrap();
        std::os::unix::fs::symlink(outside.path(), directory.path().join("layout.html")).unwrap();
        assert!(load(directory.path()).is_err());
        fs::remove_file(directory.path().join("layout.html")).unwrap();
        fs::create_dir(directory.path().join("layout.html")).unwrap();
        assert!(load(directory.path()).is_err());
    }
}
