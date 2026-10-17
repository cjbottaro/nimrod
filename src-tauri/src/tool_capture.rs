//! Opt-in native tool payload capture; never touches harness-owned history.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};

static WRITER: Mutex<()> = Mutex::new(());
const MAX_BATCH: usize = 32 * 1024 * 1024;
const MAX_LINE: usize = 8 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Record {
    schema_version: u32,
    timestamp: String,
    capture_id: String,
    sequence: u64,
    source: Source,
    session_id: String,
    connection_id: Option<String>,
    tool_call_id: Option<String>,
    event: String,
    payload: serde_json::Value,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Source {
    backend: String,
    agent: String,
    version: Option<String>,
}

fn directory(snapshot: &crate::preferences::Snapshot) -> Result<PathBuf, String> {
    Ok(snapshot
        .state_path
        .parent()
        .ok_or("Missing Nimrod state directory")?
        .join("tool-captures"))
}
fn enabled(snapshot: &crate::preferences::Snapshot) -> bool {
    snapshot.error.is_none()
        && crate::preferences::jsonc(&snapshot.text)
            .ok()
            .and_then(|value| {
                value
                    .get("diagnostics.toolCapture")
                    .and_then(serde_json::Value::as_bool)
            })
            == Some(true)
}
// Preserve ordinary agent names; encode unsafe/long names without collisions or path traversal.
fn segment(name: &str) -> String {
    if !name.is_empty()
        && name.len() <= 80
        && name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        name.into()
    } else {
        format!("agent~{:x}", Sha256::digest(name.as_bytes()))
    }
}

fn groups(lines: Vec<String>) -> Result<BTreeMap<PathBuf, Vec<u8>>, String> {
    if lines.is_empty()
        || lines.len() > 512
        || lines.iter().map(String::len).sum::<usize>() > MAX_BATCH
    {
        return Err("Invalid or oversized tool capture batch".into());
    }
    let mut groups: BTreeMap<PathBuf, Vec<u8>> = BTreeMap::new();
    for line in lines {
        if line.len() > MAX_LINE || line.contains(['\r', '\n']) {
            return Err("Invalid or oversized tool capture record".into());
        }
        let record: Record = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        let time =
            chrono::DateTime::parse_from_rfc3339(&record.timestamp).map_err(|e| e.to_string())?;
        if record.schema_version != 1
            || record.sequence == 0
            || uuid::Uuid::parse_str(&record.capture_id).is_err()
            || record
                .connection_id
                .as_ref()
                .is_some_and(|v| uuid::Uuid::parse_str(v).is_err())
            || record.session_id.is_empty()
            || record.session_id.len() > 4096
            || record.event.is_empty()
            || record.event.len() > 256
            || record.source.backend.is_empty()
            || record.source.backend.len() > 256
            || record.source.agent.is_empty()
            || record.source.agent.len() > 4096
            || record
                .source
                .version
                .as_ref()
                .is_some_and(|v| v.len() > 1024)
            || record.tool_call_id.as_ref().is_some_and(|v| v.len() > 4096)
        {
            return Err("Invalid tool capture envelope".into());
        }
        // Arbitrary JSON is intentional: tool schemas belong to integrations/extensions.
        let _ = &record.payload;
        let mut relative = PathBuf::from(segment(&record.source.backend));
        if record.source.backend != "pi" {
            relative.push(segment(&record.source.agent));
        }
        relative.push(format!(
            "{}.jsonl",
            time.with_timezone(&chrono::Utc).format("%Y-%m-%d")
        ));
        let bytes = groups.entry(relative).or_default();
        bytes.extend_from_slice(line.as_bytes());
        bytes.push(b'\n');
    }
    Ok(groups)
}

fn ensure_directory(path: &Path) -> Result<(), String> {
    let mut builder = fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    match builder.create(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
            let meta = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            if meta.is_dir() && !meta.file_type().is_symlink() {
                Ok(())
            } else {
                Err(format!(
                    "Not a regular tool capture directory: {}",
                    path.display()
                ))
            }
        }
        Err(error) => Err(error.to_string()),
    }
}
fn append_file(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let mut options = OpenOptions::new();
    options.create(true).append(true).read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options
            .mode(0o600)
            .custom_flags(nix::libc::O_NOFOLLOW | nix::libc::O_NONBLOCK | nix::libc::O_CLOEXEC);
    }
    // Check existing symlinks on all platforms; Unix additionally uses O_NOFOLLOW at open.
    if fs::symlink_metadata(path).is_ok_and(|m| !m.is_file() || m.file_type().is_symlink()) {
        return Err("Tool capture destination is not a regular file".into());
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    let mut file = nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusive)
        .map_err(|(_, error)| error.to_string())?;
    #[cfg(not(unix))]
    let mut file = file;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Tool capture destination is not a regular file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.permissions().mode() & 0o077 != 0 || metadata.nlink() != 1 {
            return Err("Tool capture file must be private and have no hard links".into());
        }
    }
    // Never silently append behind a crash/partial-write fragment or truncate existing data.
    if metadata.len() > 0 {
        file.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        let mut tail = [0];
        file.read_exact(&mut tail).map_err(|e| e.to_string())?;
        if tail[0] != b'\n' {
            return Err("Tool capture file has an incomplete final record; preserve it and move it aside before re-enabling capture".into());
        }
    }
    file.write_all(bytes).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}
fn write_groups(root: &Path, groups: BTreeMap<PathBuf, Vec<u8>>) -> Result<(), String> {
    let _guard = WRITER
        .lock()
        .map_err(|_| "Tool capture writer unavailable")?;
    // State parent is resolved by Preferences, never supplied by the frontend.
    fs::create_dir_all(root.parent().ok_or("Missing state directory")?)
        .map_err(|e| e.to_string())?;
    ensure_directory(root)?;
    for (relative, bytes) in groups {
        let path = root.join(&relative);
        let mut directory = root.to_path_buf();
        for component in relative
            .parent()
            .ok_or("Missing capture subdirectory")?
            .components()
        {
            directory.push(component);
            ensure_directory(&directory)?;
        }
        append_file(&path, &bytes).map_err(|e| format!("{}: {e}", path.display()))?;
    }
    Ok(())
}

#[tauri::command]
pub fn tool_capture_directory(
    preferences: tauri::State<'_, crate::preferences::Preferences>,
) -> Result<String, String> {
    directory(&preferences.snapshot()).map(|p| p.to_string_lossy().into_owned())
}
#[tauri::command]
pub async fn append_tool_capture(
    preferences: tauri::State<'_, crate::preferences::Preferences>,
    lines: Vec<String>,
) -> Result<(), String> {
    let snapshot = preferences.snapshot();
    // A write already accepted may finish after disable; never retry ambiguous writes.
    if !enabled(&snapshot) {
        return Err("Tool capture is disabled or global settings are invalid".into());
    }
    let root = directory(&snapshot)?;
    tauri::async_runtime::spawn_blocking(move || write_groups(&root, groups(lines)?))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn line(backend: &str, agent: &str, sequence: u64) -> String {
        json!({"schemaVersion":1,"timestamp":"2026-10-16T19:42:31.482Z",
            "captureId":"11111111-1111-4111-8111-111111111111","sequence":sequence,
            "source":{"backend":backend,"agent":agent},"sessionId":"fixture","event":"tool_call",
            "payload":{"rawInput":{"code":"a\nb"}}})
        .to_string()
    }
    #[test]
    fn appends_and_separates_native_sources_without_rewriting() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("tool-captures");
        write_groups(
            &root,
            groups(vec![line("pi", "pi", 1), line("acp", "copilot", 2)]).unwrap(),
        )
        .unwrap();
        write_groups(&root, groups(vec![line("pi", "pi", 3)]).unwrap()).unwrap();
        let pi = fs::read_to_string(root.join("pi/2026-10-16.jsonl")).unwrap();
        assert_eq!(pi.lines().count(), 2);
        assert_eq!(
            pi,
            format!("{}\n{}\n", line("pi", "pi", 1), line("pi", "pi", 3))
        );
        assert!(root.join("acp/copilot/2026-10-16.jsonl").is_file());
        let sdk = line("copilot-sdk", "copilot", 4);
        write_groups(&root, groups(vec![sdk.clone()]).unwrap()).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("copilot-sdk/copilot/2026-10-16.jsonl")).unwrap(),
            format!("{sdk}\n")
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(root.join("pi/2026-10-16.jsonl"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o600
            );
        }
    }
    #[test]
    fn validates_envelopes_and_unsafe_agent_paths() {
        assert!(groups(vec!["{}".into()]).is_err());
        assert!(groups(vec![format!("{}\n", line("pi", "pi", 1))]).is_err());
        assert!(groups(vec![line("pi", "pi", 0)]).is_err());
        let grouped = groups(vec![line("acp", "../../escape", 1)]).unwrap();
        assert!(grouped.keys().all(|p| !p.to_string_lossy().contains("..")));
    }
    #[test]
    fn opt_in_and_incomplete_tail_are_not_silently_ignored() {
        let temp = tempfile::tempdir().unwrap();
        let prefs = crate::preferences::Preferences::isolated(temp.path());
        assert!(!enabled(&prefs.snapshot()));
        let root = temp.path().join("tool-captures");
        write_groups(&root, groups(vec![line("pi", "pi", 1)]).unwrap()).unwrap();
        let path = root.join("pi/2026-10-16.jsonl");
        OpenOptions::new()
            .append(true)
            .open(&path)
            .unwrap()
            .write_all(b"partial")
            .unwrap();
        let before = fs::read(&path).unwrap();
        assert!(write_groups(&root, groups(vec![line("pi", "pi", 2)]).unwrap()).is_err());
        assert_eq!(fs::read(path).unwrap(), before);
    }
    #[test]
    fn concurrent_appends_and_utc_rollover_preserve_complete_records() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("tool-captures");
        std::thread::scope(|scope| {
            for sequence in 1..=12 {
                let root = &root;
                scope.spawn(move || {
                    write_groups(root, groups(vec![line("pi", "pi", sequence)]).unwrap()).unwrap();
                });
            }
        });
        let contents = fs::read_to_string(root.join("pi/2026-10-16.jsonl")).unwrap();
        assert_eq!(contents.lines().count(), 12);
        for line in contents.lines() {
            serde_json::from_str::<Record>(line).unwrap();
        }
        let tomorrow = line("pi", "pi", 13).replace("2026-10-16", "2026-10-17");
        write_groups(&root, groups(vec![tomorrow.clone()]).unwrap()).unwrap();
        assert_eq!(
            fs::read_to_string(root.join("pi/2026-10-17.jsonl")).unwrap(),
            format!("{tomorrow}\n")
        );
        assert_eq!(
            fs::read_to_string(root.join("pi/2026-10-16.jsonl")).unwrap(),
            contents
        );
    }
    #[test]
    fn global_capture_setting_requires_explicit_boolean_opt_in() {
        let temp = tempfile::tempdir().unwrap();
        let prefs = crate::preferences::Preferences::isolated(temp.path());
        let mut snapshot = prefs.snapshot();
        snapshot.text = "{\"diagnostics.toolCapture\":true}".into();
        assert!(enabled(&snapshot));
        crate::preferences::validate(&snapshot.text).unwrap();
        snapshot.text = "{\"diagnostics.toolCapture\":\"true\"}".into();
        assert!(!enabled(&snapshot));
        assert!(crate::preferences::validate(&snapshot.text).is_err());
    }
    #[cfg(unix)]
    #[test]
    fn refuses_symlink_destinations() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("tool-captures");
        write_groups(&root, groups(vec![line("pi", "pi", 1)]).unwrap()).unwrap();
        let target = root.join("pi/2026-10-16.jsonl");
        fs::remove_file(&target).unwrap();
        let outside = temp.path().join("outside");
        fs::write(&outside, "keep").unwrap();
        std::os::unix::fs::symlink(&outside, target).unwrap();
        assert!(write_groups(&root, groups(vec![line("pi", "pi", 2)]).unwrap()).is_err());
        assert_eq!(fs::read_to_string(outside).unwrap(), "keep");
    }
}
