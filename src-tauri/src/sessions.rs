//! Pi file identity only. Pi still owns history parsing, migration and persistence.
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    fs::File,
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
};
use tokio::process::Command;

#[derive(Clone, Copy, Deserialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum LaunchMode {
    Saved,
    Temporary,
    Resume,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionFile {
    pub path: PathBuf,
    pub session_id: String,
    pub exists: bool,
    pub parent_session: Option<String>,
    pub last_user_message_at: u64,
}

/// Pi uses this lineage for both persisted subagents and saved branches.
pub fn parent_session(header: &Value) -> Result<Option<String>, String> {
    match header.get("parentSession") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(parent)) if !parent.trim().is_empty() => Ok(Some(parent.clone())),
        Some(_) => Err("Invalid parentSession in session header".into()),
    }
}

/// Read-only historical recency, not a live prompt/composer acknowledgement.
/// All stored branches count; assistant/tool/control entries never do.
pub fn user_message_timestamp(entry: &Value) -> u64 {
    if entry["type"] != "message" || entry["message"]["role"] != "user" {
        return 0;
    }
    let valid = |timestamp: u64| timestamp > 0 && timestamp <= 8_640_000_000_000_000;
    if let Some(timestamp) = entry["message"]["timestamp"].as_u64().filter(|t| valid(*t)) {
        return timestamp;
    }
    entry["timestamp"]
        .as_str()
        .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
        .and_then(|date| u64::try_from(date.timestamp_millis()).ok())
        .filter(|t| valid(*t))
        .unwrap_or(0)
}

pub fn inspect(path: &Path, cwd: &Path) -> Result<SessionFile, String> {
    if !path.is_absolute() {
        return Err("Select an absolute session file path, not a session ID".into());
    }
    let path = path
        .canonicalize()
        .map_err(|e| format!("Session file unavailable: {e}"))?;
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 256 * 1024 * 1024 {
        return Err("Session must be a nonempty regular Pi JSONL file (at most 256 MiB)".into());
    }
    let file = File::open(&path).map_err(|e| format!("Cannot read session file: {e}"))?;
    let mut reader = BufReader::new(file);
    let mut line = String::new();
    let mut header: Option<Value> = None;
    let mut last_user_message_at = 0;
    loop {
        line.clear();
        let bytes = reader
            .by_ref()
            .take(16 * 1024 * 1024 + 1)
            .read_line(&mut line)
            .map_err(|e| format!("Cannot read session JSONL: {e}"))?;
        if bytes == 0 {
            break;
        }
        if bytes > 16 * 1024 * 1024 {
            return Err("Session JSONL record exceeds 16 MiB".into());
        }
        if line.trim().is_empty() {
            continue;
        }
        let entry: Value =
            serde_json::from_str(&line).map_err(|e| format!("Invalid session JSONL: {e}"))?;
        if !entry.is_object() || !entry["type"].is_string() {
            return Err("Invalid Pi session entry".into());
        }
        if header.is_none() {
            if entry["type"] != "session"
                || !matches!(entry["version"].as_u64(), Some(1..=3))
                || entry["id"].as_str().is_none_or(str::is_empty)
                || entry["cwd"].as_str().is_none_or(str::is_empty)
            {
                return Err("Invalid or unsupported Pi session header".into());
            }
            header = Some(entry);
        } else if entry["type"] == "session" {
            return Err("Session contains multiple headers".into());
        } else {
            last_user_message_at = last_user_message_at.max(user_message_timestamp(&entry));
        }
    }
    let header = header.ok_or("Session has no Pi header")?;
    let recorded_cwd = Path::new(header["cwd"].as_str().unwrap());
    if !recorded_cwd.is_absolute() {
        return Err("Session project directory must be absolute".into());
    }
    let project = recorded_cwd
        .canonicalize()
        .map_err(|e| format!("Session project directory unavailable: {e}"))?;
    if project != cwd {
        return Err(format!(
            "Session belongs to {}. Select that project folder before resuming.",
            project.display()
        ));
    }
    Ok(SessionFile {
        path,
        session_id: header["id"].as_str().unwrap().into(),
        exists: true,
        parent_session: parent_session(&header)?,
        last_user_message_at,
    })
}

/// A new Pi session can report its intended file before its first disk write.
pub fn reported_file(path: &Path, cwd: &Path, id: &str) -> Result<SessionFile, String> {
    if id.is_empty() || !path.is_absolute() {
        return Err("Pi returned invalid session identity".into());
    }
    match path.try_exists() {
        Ok(true) => {
            let info = inspect(path, cwd)?;
            if info.session_id != id {
                return Err("Pi session ID does not match its file".into());
            }
            Ok(info)
        }
        Ok(false) => {
            let parent = path
                .parent()
                .ok_or("Invalid Pi session path")?
                .canonicalize()
                .map_err(|e| format!("Pi session directory unavailable: {e}"))?;
            let name = path.file_name().ok_or("Invalid Pi session filename")?;
            Ok(SessionFile {
                path: parent.join(name),
                session_id: id.into(),
                exists: false,
                parent_session: None,
                last_user_message_at: 0,
            })
        }
        Err(e) => Err(format!("Cannot inspect Pi session file: {e}")),
    }
}

pub fn validate_launch_name(
    mode: LaunchMode,
    demo: bool,
    name: Option<&str>,
) -> Result<Option<&str>, String> {
    let Some(name) = name else { return Ok(None) };
    if mode != LaunchMode::Saved || demo {
        return Err("Only new persistent sessions accept a launch name".into());
    }
    if name.trim().is_empty() || name.contains(['\r', '\n', '\0']) {
        return Err("Session names must be non-empty and a single line".into());
    }
    Ok(Some(name.trim()))
}

pub fn launch_args(
    command: &mut Command,
    mode: LaunchMode,
    session: Option<&SessionFile>,
    name: Option<&str>,
) {
    match mode {
        LaunchMode::Saved => {}
        LaunchMode::Temporary => {
            command.arg("--no-session");
        }
        LaunchMode::Resume => {
            command
                .arg("--session")
                .arg(&session.expect("validated resume").path);
        }
    }
    if let Some(name) = name {
        command.arg("--name").arg(name);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn header(cwd: &Path) -> String {
        format!(
            "{}\n",
            json!({"type":"session","version":3,"id":"fixture","cwd":cwd})
        )
    }
    #[test]
    fn validates_exact_files_without_creating_or_replacing_them() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().canonicalize().unwrap();
        let path = cwd.join("fixture.jsonl");
        assert!(inspect(&path, &cwd).is_err());
        assert!(!path.exists());
        for content in [
            "".to_string(),
            "invalid".into(),
            "{}\n".into(),
            format!("{}broken\n", header(&cwd)),
            format!("{}{}", header(&cwd), header(&cwd)),
            format!(
                "{}\n",
                json!({"type":"session","version":99,"id":"x","cwd":cwd})
            ),
            format!(
                "{}\n",
                json!({"type":"session","version":3,"id":"x","cwd":"relative"})
            ),
            format!("{}\n[]\n", header(&cwd)),
        ] {
            std::fs::write(&path, &content).unwrap();
            assert!(inspect(&path, &cwd).is_err());
            assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        }
        std::fs::write(&path, header(&cwd)).unwrap();
        assert_eq!(inspect(&path, &cwd).unwrap().session_id, "fixture");
        assert!(reported_file(&path, &cwd, "different").is_err());
        let other = tempfile::tempdir().unwrap();
        assert!(inspect(&path, &other.path().canonicalize().unwrap()).is_err());
        assert!(inspect(Path::new("fixture"), &cwd).is_err());
        let pending = reported_file(&cwd.join("pending.jsonl"), &cwd, "pending").unwrap();
        assert!(!pending.exists);
        assert!(!pending.path.exists());
    }
    #[cfg(unix)]
    #[test]
    fn canonicalizes_file_and_project_aliases() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().canonicalize().unwrap();
        let project_alias = cwd.join("project-link");
        std::os::unix::fs::symlink(&cwd, &project_alias).unwrap();
        let file = cwd.join("real.jsonl");
        std::fs::write(&file, header(&project_alias)).unwrap();
        let alias = cwd.join("session-link.jsonl");
        std::os::unix::fs::symlink(&file, &alias).unwrap();
        assert_eq!(inspect(&alias, &cwd).unwrap().path, file);
        assert!(inspect(&cwd, &cwd).is_err());
    }
    #[test]
    fn named_launch_is_validated_and_passed_as_one_literal_argument() {
        for name in [
            "Planned work",
            "--no-session",
            "quotes \" ; $(echo nope)",
            "日本語",
        ] {
            let name = validate_launch_name(LaunchMode::Saved, false, Some(name)).unwrap();
            let mut command = Command::new("pi");
            launch_args(&mut command, LaunchMode::Saved, None, name);
            assert_eq!(
                command.as_std().get_args().collect::<Vec<_>>(),
                vec!["--name", name.unwrap()]
            );
        }
        assert_eq!(
            validate_launch_name(LaunchMode::Saved, false, Some("  Task  ")).unwrap(),
            Some("Task")
        );
        for name in ["", "   ", "two\nlines", "two\rlines", "null\0byte"] {
            assert!(validate_launch_name(LaunchMode::Saved, false, Some(name)).is_err());
        }
        for (mode, demo) in [
            (LaunchMode::Resume, false),
            (LaunchMode::Temporary, false),
            (LaunchMode::Saved, true),
        ] {
            assert!(validate_launch_name(mode, demo, Some("Task")).is_err());
            assert_eq!(validate_launch_name(mode, demo, None).unwrap(), None);
        }
    }

    #[test]
    fn reads_only_persisted_user_message_times_not_metadata_or_mtime() {
        let dir = tempfile::tempdir().unwrap();
        let cwd = dir.path().canonicalize().unwrap();
        let path = cwd.join("history.jsonl");
        let entries = [
            json!({"type":"message", "message":{"role":"user", "timestamp":1000}}),
            json!({"type":"message", "timestamp":"2025-06-01T14:30:00.123+02:00", "message":{"role":"user"}}),
            json!({"type":"message", "message":{"role":"assistant", "timestamp":1900000000000_u64}}),
            json!({"type":"message", "message":{"role":"toolResult", "timestamp":1900000000000_u64}}),
            json!({"type":"session_info", "timestamp":"2030-01-01T00:00:00Z", "name":"Renamed"}),
            json!({"type":"compaction", "timestamp":"2030-01-01T00:00:00Z"}),
            json!({"type":"message", "message":{"role":"user", "timestamp":0}, "timestamp":"invalid"}),
        ];
        let content = header(&cwd)
            + &entries
                .iter()
                .map(|entry| format!("{entry}\n"))
                .collect::<String>();
        std::fs::write(&path, &content).unwrap();
        let expected = 1748781000123;
        assert_eq!(inspect(&path, &cwd).unwrap().last_user_message_at, expected);
        assert_eq!(
            crate::session_catalog::list(&cwd, &cwd).unwrap().sessions[0].last_user_message_at,
            expected
        );
        File::open(&path)
            .unwrap()
            .set_times(
                std::fs::FileTimes::new()
                    .set_modified(std::time::UNIX_EPOCH + std::time::Duration::from_secs(1)),
            )
            .unwrap();
        assert_eq!(inspect(&path, &cwd).unwrap().last_user_message_at, expected);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), content);
        std::fs::write(&path, header(&cwd)).unwrap();
        assert_eq!(inspect(&path, &cwd).unwrap().last_user_message_at, 0);
    }
    #[test]
    fn validates_timestamp_formats_and_ignores_bad_values_without_rejecting_history() {
        for value in [
            json!(null),
            json!("42"),
            json!(-1),
            json!(1.5),
            json!(9007199254740991_u64),
        ] {
            let entry = json!({"type":"message", "message":{"role":"user", "timestamp":value}});
            assert_eq!(user_message_timestamp(&entry), 0);
        }
        let entry = json!({"type":"message", "timestamp":"2025-06-01T12:30:00.123Z", "message":{"role":"user", "timestamp":1234}});
        assert_eq!(user_message_timestamp(&entry), 1234);
        for invalid in ["invalid", "1960-01-01T00:00:00Z", "2025-02-30T00:00:00Z"] {
            assert_eq!(
                user_message_timestamp(
                    &json!({"type":"message", "timestamp":invalid, "message":{"role":"user"}})
                ),
                0
            );
        }
    }

    #[test]
    fn launch_modes_use_exact_paths_and_never_continue_recent() {
        let file = SessionFile {
            path: PathBuf::from("/sessions/a b.jsonl"),
            session_id: "id".into(),
            exists: true,
            parent_session: None,
            last_user_message_at: 0,
        };
        for (mode, expected) in [
            (LaunchMode::Saved, vec![]),
            (LaunchMode::Temporary, vec!["--no-session"]),
            (LaunchMode::Resume, vec!["--session", "/sessions/a b.jsonl"]),
        ] {
            let mut command = Command::new("pi");
            launch_args(&mut command, mode, Some(&file), None);
            assert_eq!(command.as_std().get_args().collect::<Vec<_>>(), expected);
        }
    }
}
