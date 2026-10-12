//! Bounded local manifest/module reads. Frontend executes only explicitly trusted ESM.
use serde::Deserialize;
use serde_json::Value;
use std::{fs, io::Read, path::Path};
use tauri::Manager;

const MAX_MANIFEST: u64 = 256 * 1024;
const MAX_MODULE: u64 = 1024 * 1024;
fn safe_name(name: &str) -> bool {
    name.len() <= 128
        && name
            .as_bytes()
            .first()
            .is_some_and(u8::is_ascii_alphanumeric)
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
pub fn filename(name: &str) -> bool {
    safe_name(name) && name.ends_with(".json")
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
fn read_local(root: &Path, name: &str, limit: u64) -> Result<String, String> {
    if !safe_name(name) {
        return Err("Card plugin requires a filename, not a path".into());
    }
    let root = root.canonicalize().map_err(|e| e.to_string())?;
    let path = root.join(name);
    if !fs::symlink_metadata(&path)
        .map_err(|e| e.to_string())?
        .is_file()
    {
        return Err("Card plugin must be a regular non-symlink file".into());
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK | nix::libc::O_CLOEXEC);
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err("Card plugin must be a regular file".into());
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("Card plugin file exceeds {} KiB", limit / 1024));
    }
    String::from_utf8(bytes).map_err(|e| e.to_string())
}
pub fn read_package(root: &Path, name: &str) -> Result<String, String> {
    if !filename(name) {
        return Err("Card plugin must be a JSON filename, not a path".into());
    }
    read_local(root, name, MAX_MANIFEST)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutableManifest {
    api_version: u8,
    id: String,
    tools: Vec<String>,
    entry: String,
}
fn read_module(
    root: &Path,
    name: &str,
    expected: &str,
    settings: &Value,
) -> Result<String, String> {
    let listed = |key: &str| {
        settings
            .get(key)
            .and_then(Value::as_array)
            .is_some_and(|files| files.iter().any(|file| file.as_str() == Some(name)))
    };
    if !listed("cards.plugins") || !listed("cards.trustedPlugins") {
        return Err("Executable card plugin is not configured and explicitly trusted".into());
    }
    let text = read_package(root, name)?;
    if text != expected {
        return Err("Card manifest changed during loading; reload its configuration".into());
    }
    let manifest: ExecutableManifest = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let tools: std::collections::HashSet<_> = manifest.tools.iter().collect();
    if manifest.api_version != 2
        || !renderer_id(&manifest.id)
        || manifest.id.starts_with("nimrod.")
        || manifest.tools.is_empty()
        || manifest.tools.len() > 50
        || tools.len() != manifest.tools.len()
        || manifest.tools.iter().any(|tool| {
            tool.is_empty()
                || !tool
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b"_-".contains(&b))
        })
    {
        return Err("Invalid executable card manifest identity/version/matching".into());
    }
    if !safe_name(&manifest.entry)
        || !(manifest.entry.ends_with(".js") || manifest.entry.ends_with(".mjs"))
    {
        return Err("Card entry must be a local JavaScript filename".into());
    }
    read_local(root, &manifest.entry, MAX_MODULE)
}
fn authorized_snapshot(window: &tauri::Window) -> Result<crate::preferences::Snapshot, String> {
    if window.label() != "main"
        && !window
            .app_handle()
            .state::<crate::workspace_windows::WorkspaceWindows>()
            .directories
            .lock()
            .unwrap()
            .contains_key(window.label())
    {
        return Err("Card plugins require a welcome/project window".into());
    }
    Ok(window
        .app_handle()
        .state::<crate::preferences::Preferences>()
        .snapshot())
}
#[tauri::command]
pub async fn read_card_plugin(window: tauri::Window, name: String) -> Result<String, String> {
    let snapshot = authorized_snapshot(&window)?;
    let root = snapshot
        .settings_path
        .parent()
        .ok_or("Missing config directory")?
        .join("card-plugins");
    tauri::async_runtime::spawn_blocking(move || read_package(&root, &name))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn read_card_plugin_module(
    window: tauri::Window,
    name: String,
    expected_manifest: String,
) -> Result<String, String> {
    let snapshot = authorized_snapshot(&window)?;
    let root = snapshot
        .settings_path
        .parent()
        .ok_or("Missing config directory")?
        .join("card-plugins");
    let settings = crate::preferences::jsonc(&snapshot.text)?;
    tauri::async_runtime::spawn_blocking(move || {
        read_module(&root, &name, &expected_manifest, &settings)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn load_personal_card_plugins(
    window: tauri::Window,
    compiler: tauri::State<'_, crate::plugin_compiler::Compiler>,
) -> Result<crate::plugin_compiler::Bundles, String> {
    let snapshot = authorized_snapshot(&window)?;
    let settings = crate::preferences::jsonc(&snapshot.text)?;
    if settings.get("cards.autoLoad").and_then(Value::as_bool) == Some(false) {
        return Ok(crate::plugin_compiler::Bundles::default());
    }
    let root = snapshot
        .settings_path
        .parent()
        .ok_or("Missing config directory")?
        .join("card-plugins");
    let compiler = compiler.inner().clone();
    // Filesystem hashing runs off the IPC/agent event workers; only the owned helper is spawned.
    tauri::async_runtime::spawn_blocking(move || {
        tauri::async_runtime::block_on(compiler.load(&root))
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
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
        fs::write(
            dir.path().join("large.json"),
            vec![b' '; MAX_MANIFEST as usize + 1],
        )
        .unwrap();
        assert!(read_package(dir.path(), "large.json").is_err());
        fs::create_dir(dir.path().join("directory.json")).unwrap();
        assert!(read_package(dir.path(), "directory.json").is_err());
    }
    #[test]
    fn module_reads_require_explicit_trust_matching_manifest_and_bounded_js_entry() {
        let dir = tempfile::tempdir().unwrap();
        let manifest =
            json!({"apiVersion":2,"id":"example.test","tools":["read"],"entry":"plugin.js"})
                .to_string();
        fs::write(dir.path().join("plugin.json"), &manifest).unwrap();
        fs::write(dir.path().join("plugin.js"), "export default {};").unwrap();
        let settings =
            json!({"cards.plugins":["plugin.json"],"cards.trustedPlugins":["plugin.json"]});
        assert!(
            read_module(
                dir.path(),
                "plugin.json",
                &manifest,
                &json!({"cards.plugins":["plugin.json"]})
            )
            .is_err()
        );
        assert!(read_module(dir.path(), "plugin.json", "changed", &settings).is_err());
        assert_eq!(
            read_module(dir.path(), "plugin.json", &manifest, &settings).unwrap(),
            "export default {};"
        );
        fs::write(
            dir.path().join("plugin.js"),
            vec![b' '; MAX_MODULE as usize + 1],
        )
        .unwrap();
        assert!(read_module(dir.path(), "plugin.json", &manifest, &settings).is_err());
        for entry in [
            "../plugin.js",
            "https://example.com/a.js",
            "/tmp/a.js",
            "source.ts",
            "directory.js",
        ] {
            let bad = json!({"apiVersion":2,"id":"example.test","tools":["read"],"entry":entry})
                .to_string();
            fs::write(dir.path().join("plugin.json"), &bad).unwrap();
            assert!(read_module(dir.path(), "plugin.json", &bad, &settings).is_err());
        }
    }
    #[cfg(unix)]
    #[test]
    fn rejects_symlink_packages_and_module_entries() {
        let dir = tempfile::tempdir().unwrap();
        fs::write(dir.path().join("a.json"), "{}").unwrap();
        std::os::unix::fs::symlink(dir.path().join("a.json"), dir.path().join("link.json"))
            .unwrap();
        assert!(read_package(dir.path(), "link.json").is_err());
        fs::write(dir.path().join("source.js"), "export default {};").unwrap();
        std::os::unix::fs::symlink(dir.path().join("source.js"), dir.path().join("linked.js"))
            .unwrap();
        let manifest =
            json!({"apiVersion":2,"id":"example.test","tools":["read"],"entry":"linked.js"})
                .to_string();
        fs::write(dir.path().join("plugin.json"), &manifest).unwrap();
        assert!(
            read_module(
                dir.path(),
                "plugin.json",
                &manifest,
                &json!({"cards.plugins":["plugin.json"],"cards.trustedPlugins":["plugin.json"]})
            )
            .is_err()
        );
    }
}
