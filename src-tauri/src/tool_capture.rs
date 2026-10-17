//! Opt-in transcript debug logs; never mutates harness-owned history.
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{Duration, SystemTime},
};

static WRITER: Mutex<()> = Mutex::new(());
const MAX_BATCH: usize = 32 * 1024 * 1024;
const MAX_LINE: usize = 8 * 1024 * 1024;
#[derive(Clone, Copy)]
struct Limits {
    file_bytes: u64,
    total_bytes: u64,
    max_age: Duration,
}
const LIMITS: Limits = Limits {
    file_bytes: 25 * 1024 * 1024,
    total_bytes: 250 * 1024 * 1024,
    max_age: Duration::from_secs(7 * 24 * 60 * 60),
};

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
        .join("transcript-logs"))
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
        return Err("Invalid or oversized transcript debug batch".into());
    }
    let mut groups: BTreeMap<PathBuf, Vec<u8>> = BTreeMap::new();
    for line in lines {
        if line.len() > MAX_LINE || line.contains(['\r', '\n']) {
            return Err("Invalid or oversized transcript debug record".into());
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
            return Err("Invalid transcript debug envelope".into());
        }
        // Arbitrary native JSON is intentional: transcript semantics belong to integrations/extensions.
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
                    "Not a regular transcript debug directory: {}",
                    path.display()
                ))
            }
        }
        Err(error) => Err(error.to_string()),
    }
}
fn open_private_file(path: &Path) -> Result<File, String> {
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
        return Err("Transcript debug destination is not a regular file".into());
    }
    let file = options.open(path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Err("Transcript debug destination is not a regular file".into());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, PermissionsExt};
        if metadata.permissions().mode() & 0o077 != 0 || metadata.nlink() != 1 {
            return Err("Transcript debug file must be private and have no hard links".into());
        }
    }
    Ok(file)
}
fn append_file(path: &Path, bytes: &[u8], limit: u64) -> Result<usize, String> {
    let file = open_private_file(path)?;
    #[cfg(unix)]
    let mut file = nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusive)
        .map_err(|(_, error)| error.to_string())?;
    #[cfg(not(unix))]
    let mut file = file;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    // Never silently append behind a crash/partial-write fragment or truncate existing data.
    if metadata.len() > 0 {
        file.seek(SeekFrom::End(-1)).map_err(|e| e.to_string())?;
        let mut tail = [0];
        file.read_exact(&mut tail).map_err(|e| e.to_string())?;
        if tail[0] != b'\n' {
            return Err("Transcript debug file has an incomplete final record; preserve it and move it aside before re-enabling logging".into());
        }
    }
    let available = limit.saturating_sub(metadata.len()).min(bytes.len() as u64) as usize;
    let length = bytes[..available]
        .iter()
        .rposition(|byte| *byte == b'\n')
        .map_or(0, |index| index + 1);
    file.write_all(&bytes[..length])
        .map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())?;
    Ok(length)
}

fn log_name(name: &str) -> Option<(&str, u32)> {
    let stem = name.strip_suffix(".jsonl")?;
    let (day, index) = match stem.split_once('.') {
        Some((day, suffix)) => {
            let index = suffix.parse::<u32>().ok()?;
            if index == 0 || suffix != format!("{index:06}") {
                return None;
            }
            (day, index)
        }
        None => (stem, 0),
    };
    let date = chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    (date.format("%Y-%m-%d").to_string() == day).then_some((day, index))
}

fn append_rotating(path: &Path, bytes: &[u8], limit: u64) -> Result<(), String> {
    let parent = path.parent().ok_or("Missing capture subdirectory")?;
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid log name")?;
    let (day, _) = log_name(name).ok_or("Invalid log date")?;
    let mut index = 0;
    for entry in fs::read_dir(parent).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        if let Some((entry_day, entry_index)) = name.to_str().and_then(log_name) {
            if entry_day == day {
                index = index.max(entry_index);
            }
        }
    }
    let mut remaining = bytes;
    while !remaining.is_empty() {
        let name = if index == 0 {
            format!("{day}.jsonl")
        } else {
            format!("{day}.{index:06}.jsonl")
        };
        let written = append_file(&parent.join(name), remaining, limit)?;
        remaining = &remaining[written..];
        if !remaining.is_empty() {
            if !remaining
                .iter()
                .take(limit as usize)
                .any(|byte| *byte == b'\n')
            {
                return Err("Transcript debug record exceeds the file size limit".into());
            }
            index = index
                .checked_add(1)
                .ok_or("Too many transcript debug segments")?;
        }
    }
    Ok(())
}

struct LogFile {
    path: PathBuf,
    bytes: u64,
    modified: SystemTime,
}

fn collect_logs(directory: &Path, depth: usize, logs: &mut Vec<LogFile>) -> Result<(), String> {
    for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        // Never follow links or descend beyond backend/agent directories.
        if kind.is_dir() && depth < 2 {
            collect_logs(&entry.path(), depth + 1, logs)?;
        } else if kind.is_file()
            && depth > 0
            && entry.file_name().to_str().and_then(log_name).is_some()
        {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::{MetadataExt, PermissionsExt};
                if metadata.nlink() != 1 || metadata.permissions().mode() & 0o077 != 0 {
                    return Err(
                        "Transcript debug retention requires private files without hard links"
                            .into(),
                    );
                }
            }
            logs.push(LogFile {
                path: entry.path(),
                bytes: metadata.len(),
                modified: metadata.modified().map_err(|e| e.to_string())?,
            });
        }
    }
    Ok(())
}

fn prune_logs(root: &Path, limits: Limits, now: SystemTime) -> Result<(), String> {
    let mut logs = Vec::new();
    collect_logs(root, 0, &mut logs)?;
    logs.sort_by(|a, b| {
        a.modified
            .cmp(&b.modified)
            .then_with(|| a.path.cmp(&b.path))
    });
    let mut total: u64 = logs.iter().map(|log| log.bytes).sum();
    for log in logs {
        let expired = now
            .duration_since(log.modified)
            .is_ok_and(|age| age >= limits.max_age);
        if expired || total > limits.total_bytes {
            fs::remove_file(&log.path).map_err(|e| {
                format!(
                    "Could not prune transcript debug log {}: {e}",
                    log.path.display()
                )
            })?;
            total -= log.bytes;
        }
    }
    Ok(())
}
fn write_groups(root: &Path, groups: BTreeMap<PathBuf, Vec<u8>>) -> Result<(), String> {
    write_groups_with_limits(root, groups, LIMITS)
}
fn write_groups_with_limits(
    root: &Path,
    groups: BTreeMap<PathBuf, Vec<u8>>,
    limits: Limits,
) -> Result<(), String> {
    let _guard = WRITER
        .lock()
        .map_err(|_| "Transcript debug writer unavailable")?;
    // State parent is resolved by Preferences, never supplied by the frontend.
    fs::create_dir_all(root.parent().ok_or("Missing state directory")?)
        .map_err(|e| e.to_string())?;
    ensure_directory(root)?;
    // Serialize rotation and retention across Nimrod processes as well as app windows.
    let lock = open_private_file(&root.join(".writer.lock"))?;
    #[cfg(unix)]
    let _lock = nix::fcntl::Flock::lock(lock, nix::fcntl::FlockArg::LockExclusive)
        .map_err(|(_, error)| error.to_string())?;
    #[cfg(not(unix))]
    let _lock = lock;
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
        append_rotating(&path, &bytes, limits.file_bytes)
            .map_err(|e| format!("{}: {e}", path.display()))?;
    }
    prune_logs(root, limits, SystemTime::now())
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
        return Err("Transcript debug logging is disabled or global settings are invalid".into());
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
            groups(vec![line("pi", "pi", 1), line("acp", "fixture-agent", 2)]).unwrap(),
        )
        .unwrap();
        write_groups(&root, groups(vec![line("pi", "pi", 3)]).unwrap()).unwrap();
        let pi = fs::read_to_string(root.join("pi/2026-10-16.jsonl")).unwrap();
        assert_eq!(pi.lines().count(), 2);
        assert_eq!(
            pi,
            format!("{}\n{}\n", line("pi", "pi", 1), line("pi", "pi", 3))
        );
        assert!(root.join("acp/fixture-agent/2026-10-16.jsonl").is_file());
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
    fn size_rotation_keeps_exact_records_and_resumes_the_last_segment() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("transcript-logs");
        let first = line("pi", "pi", 1);
        let limits = Limits {
            file_bytes: (first.len() + 1) as u64,
            ..LIMITS
        };
        write_groups_with_limits(
            &root,
            groups(vec![first.clone(), line("pi", "pi", 2)]).unwrap(),
            limits,
        )
        .unwrap();
        write_groups_with_limits(&root, groups(vec![line("pi", "pi", 3)]).unwrap(), limits)
            .unwrap();
        for (sequence, name) in [
            (1, "2026-10-16.jsonl"),
            (2, "2026-10-16.000001.jsonl"),
            (3, "2026-10-16.000002.jsonl"),
        ] {
            let contents = fs::read(root.join("pi").join(name)).unwrap();
            assert_eq!(
                contents,
                format!("{}\n", line("pi", "pi", sequence)).as_bytes()
            );
            assert!(contents.len() as u64 <= limits.file_bytes);
        }
        assert_eq!(LIMITS.file_bytes, 25 * 1024 * 1024);
        assert_eq!(LIMITS.total_bytes, 250 * 1024 * 1024);
    }
    #[test]
    fn retention_bounds_all_sources_and_expires_by_modification_time() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("transcript-logs");
        write_groups(&root, groups(vec![line("pi", "pi", 1)]).unwrap()).unwrap();
        let pi = root.join("pi/2026-10-16.jsonl");
        let old = SystemTime::now() - Duration::from_secs(60);
        OpenOptions::new()
            .write(true)
            .open(&pi)
            .unwrap()
            .set_modified(old)
            .unwrap();
        let sdk_line = line("copilot-sdk", "copilot", 2);
        let limits = Limits {
            total_bytes: (sdk_line.len() + 1) as u64,
            ..LIMITS
        };
        write_groups_with_limits(&root, groups(vec![sdk_line]).unwrap(), limits).unwrap();
        assert!(!pi.exists(), "quota evicts the oldest file across backends");
        let sdk = root.join("copilot-sdk/copilot/2026-10-16.jsonl");
        assert!(sdk.exists());
        let modified = fs::metadata(&sdk).unwrap().modified().unwrap();
        let mut logs = Vec::new();
        collect_logs(&root, 0, &mut logs).unwrap();
        assert!(logs.iter().map(|log| log.bytes).sum::<u64>() <= limits.total_bytes);
        prune_logs(
            &root,
            LIMITS,
            modified + LIMITS.max_age - Duration::from_secs(1),
        )
        .unwrap();
        assert!(sdk.exists());
        prune_logs(&root, LIMITS, modified + LIMITS.max_age).unwrap();
        assert!(!sdk.exists());
        assert!(root.join(".writer.lock").exists());
    }
    #[test]
    fn concurrent_rotation_preserves_every_complete_record() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("transcript-logs");
        let limits = Limits {
            file_bytes: 2 * (line("pi", "pi", 12).len() + 1) as u64,
            ..LIMITS
        };
        std::thread::scope(|scope| {
            for sequence in 1..=12 {
                let root = &root;
                scope.spawn(move || {
                    write_groups_with_limits(
                        root,
                        groups(vec![line("pi", "pi", sequence)]).unwrap(),
                        limits,
                    )
                    .unwrap();
                });
            }
        });
        let mut logs = Vec::new();
        collect_logs(&root, 0, &mut logs).unwrap();
        assert!(logs.len() > 1);
        let mut sequences = Vec::new();
        for log in logs {
            assert!(log.bytes <= limits.file_bytes);
            let contents = fs::read_to_string(log.path).unwrap();
            assert!(contents.ends_with('\n'));
            for line in contents.lines() {
                sequences.push(serde_json::from_str::<Record>(line).unwrap().sequence);
            }
        }
        sequences.sort();
        assert_eq!(sequences, (1..=12).collect::<Vec<_>>());
    }
    #[test]
    fn retention_leaves_legacy_files_unknown_names_and_deeper_directories_untouched() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("transcript-logs");
        write_groups(&root, groups(vec![line("pi", "pi", 1)]).unwrap()).unwrap();
        let legacy = temp.path().join("tool-captures");
        fs::create_dir(&legacy).unwrap();
        let legacy_file = legacy.join("2026-10-16.jsonl");
        fs::write(&legacy_file, "legacy").unwrap();
        let unknown = root.join("pi/2026-10-16.backup.jsonl");
        fs::write(&unknown, "preserve").unwrap();
        let deep = root.join("acp/fixture/nested");
        fs::create_dir_all(&deep).unwrap();
        let deep_file = deep.join("2026-10-16.jsonl");
        fs::write(&deep_file, "preserve").unwrap();
        prune_logs(
            &root,
            Limits {
                total_bytes: 0,
                ..LIMITS
            },
            SystemTime::now(),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(legacy_file).unwrap(), "legacy");
        assert_eq!(fs::read_to_string(unknown).unwrap(), "preserve");
        assert_eq!(fs::read_to_string(deep_file).unwrap(), "preserve");
        assert!(log_name("2026-99-99.jsonl").is_none());
        assert!(log_name("2026-10-16.0.jsonl").is_none());
    }
    #[test]
    fn opt_in_and_incomplete_tail_are_not_silently_ignored() {
        let temp = tempfile::tempdir().unwrap();
        let prefs = crate::preferences::Preferences::isolated(temp.path());
        assert!(!enabled(&prefs.snapshot()));
        assert!(directory(&prefs.snapshot())
            .unwrap()
            .ends_with("transcript-logs"));
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
    #[cfg(unix)]
    #[test]
    fn retention_never_follows_symlink_files_or_directories() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("transcript-logs");
        write_groups(&root, groups(vec![line("pi", "pi", 1)]).unwrap()).unwrap();
        let outside = temp.path().join("outside");
        fs::create_dir(&outside).unwrap();
        let outside_file = outside.join("2026-10-15.jsonl");
        fs::write(&outside_file, "keep").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked-backend")).unwrap();
        std::os::unix::fs::symlink(&outside_file, root.join("pi/2026-10-15.jsonl")).unwrap();
        prune_logs(
            &root,
            Limits {
                total_bytes: 0,
                ..LIMITS
            },
            SystemTime::now(),
        )
        .unwrap();
        assert_eq!(fs::read_to_string(outside_file).unwrap(), "keep");
        assert!(root.join("pi/2026-10-15.jsonl").is_symlink());
    }
}
