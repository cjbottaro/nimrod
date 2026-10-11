//! Read-only declarative packages under Nimrod config; never execute external code.
use std::{fs, io::Read, path::Path};
use tauri::Manager;

pub fn filename(name: &str) -> bool {
    name.len() <= 128
        && name.ends_with(".json")
        && name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}

pub fn renderer_id(id: &str) -> bool {
    let parts: Vec<_> = id.split('.').collect();
    parts.len() >= 2
        && parts[0]
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_lowercase)
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))
        })
}

pub fn read_package(root: &Path, name: &str) -> Result<String, String> {
    if !filename(name) {
        return Err("Card plugin must be a JSON filename, not a path".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(name);
    if !fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("Card plugin must be a regular non-symlink file".into());
    }
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if path.parent() != Some(root.as_path()) {
        return Err("Card plugin escaped its directory".into());
    }
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Card plugin must be a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(256 * 1024 + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 256 * 1024 {
        return Err("Card plugin exceeds 256 KiB".into());
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn read_card_plugin(window: tauri::Window, name: String) -> Result<String, String> {
    if window.label() != "main"
        && !window
            .app_handle()
            .state::<crate::workspace_windows::WorkspaceWindows>()
            .directories
            .lock()
            .unwrap()
            .contains_key(window.label())
    {
        return Err("Card plugins require a project window".into());
    }
    let root = window
        .app_handle()
        .state::<crate::preferences::Preferences>()
        .snapshot()
        .settings_path
        .parent()
        .ok_or("Missing config directory")?
        .join("card-plugins");
    tauri::async_runtime::spawn_blocking(move || read_package(&root, &name))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn reads_only_bounded_local_json_packages() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("example.json"), "{}").unwrap();
        assert_eq!(read_package(dir.path(), "example.json").unwrap(), "{}");
        for name in [
            "../example.json",
            "/example.json",
            "a.js",
            "https://x.json",
            ".json",
        ] {
            assert!(read_package(dir.path(), name).is_err());
        }
        fs::write(dir.path().join("large.json"), vec![b' '; 256 * 1024 + 1]).unwrap();
        assert!(read_package(dir.path(), "large.json").is_err());
        fs::create_dir(dir.path().join("directory.json")).unwrap();
        assert!(read_package(dir.path(), "directory.json").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_packages() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.json"), "{}").unwrap();
        std::os::unix::fs::symlink(dir.path().join("a.json"), dir.path().join("link.json"))
            .unwrap();
        assert!(read_package(dir.path(), "link.json").is_err());
    }
}
