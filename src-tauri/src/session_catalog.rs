//! Read-only Pi session discovery. Pi owns JSONL history and writes; resume still
//! performs the stricter exact-file validation in sessions.rs.
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read},
    path::{Path, PathBuf},
    time::UNIX_EPOCH,
};

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub path: PathBuf,
    pub session_id: String,
    pub name: Option<String>,
    pub preview: String,
    pub modified: u64,
    pub parent_session: Option<String>,
    pub last_user_message_at: u64,
}

#[derive(Serialize, Debug, Default)]
pub struct Catalog {
    pub sessions: Vec<SessionSummary>,
    pub warnings: Vec<String>,
}

// Pi 0.86.x core/session-manager.js getDefaultSessionDirPath. Do not call
// getDefaultSessionDir: it creates directories even during listing.
pub fn project_dir(root: &Path, cwd: &Path) -> PathBuf {
    let cwd = cwd.to_string_lossy();
    let safe = cwd
        .strip_prefix('/')
        .or_else(|| cwd.strip_prefix('\\'))
        .unwrap_or(&cwd)
        .replace(['/', '\\', ':'], "-");
    root.join(format!("--{safe}--"))
}

pub fn list(dir: &Path, cwd: &Path) -> Result<Catalog, String> {
    let entries = match fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(Catalog::default()),
        Err(e) => return Err(format!("Cannot list Pi sessions in {}: {e}", dir.display())),
    };
    let mut catalog = Catalog::default();
    let mut seen = std::collections::HashSet::new();
    for entry in entries {
        let entry = match entry {
            Ok(e) => e,
            Err(e) => {
                catalog.warnings.push(e.to_string());
                continue;
            }
        };
        let path = entry.path();
        if path
            .extension()
            .is_none_or(|extension| extension != "jsonl")
        {
            continue;
        }
        match summary(&path, cwd) {
            Ok(Some(info)) if seen.insert(info.path.clone()) => catalog.sessions.push(info),
            Ok(_) => {}
            Err(e) => catalog.warnings.push(format!("{}: {e}", path.display())),
        }
    }
    catalog.sessions.sort_by(|a, b| {
        b.modified
            .cmp(&a.modified)
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(catalog)
}

fn summary(path: &Path, cwd: &Path) -> Result<Option<SessionSummary>, String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let metadata = path.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 256 * 1024 * 1024 {
        return Err("Not a nonempty Pi session file within the 256 MiB limit".into());
    }
    let mut reader = BufReader::new(File::open(&path).map_err(|e| e.to_string())?);
    let mut line = String::new();
    let mut info: Option<SessionSummary> = None;
    loop {
        line.clear();
        let bytes = reader
            .by_ref()
            .take(16 * 1024 * 1024 + 1)
            .read_line(&mut line)
            .map_err(|e| e.to_string())?;
        if bytes == 0 {
            break;
        }
        if bytes > 16 * 1024 * 1024 {
            return Err("JSONL record exceeds 16 MiB".into());
        }
        if line.trim().is_empty() {
            continue;
        }
        let entry: Value =
            serde_json::from_str(&line).map_err(|e| format!("Invalid JSONL: {e}"))?;
        if !entry.is_object() || !entry["type"].is_string() {
            return Err("Invalid Pi session entry".into());
        }
        if info.is_none() {
            if entry["type"] != "session" || !matches!(entry["version"].as_u64(), Some(1..=3)) {
                return Err("Invalid or unsupported session header".into());
            }
            let recorded = Path::new(entry["cwd"].as_str().ok_or("Missing project directory")?);
            if !recorded.is_absolute() {
                return Err("Project directory is not absolute".into());
            }
            if recorded.canonicalize().map_err(|e| e.to_string())? != cwd {
                return Ok(None);
            }
            let id = entry["id"]
                .as_str()
                .filter(|s| !s.is_empty())
                .ok_or("Missing session ID")?;
            info = Some(SessionSummary {
                path: path.clone(),
                session_id: id.into(),
                name: None,
                parent_session: crate::sessions::parent_session(&entry)?,
                preview: String::new(),
                last_user_message_at: 0,
                modified: metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |t| t.as_millis() as u64),
            });
            continue;
        }
        let info = info.as_mut().unwrap();
        if entry["type"] == "session" {
            return Err("Multiple session headers".into());
        }
        info.last_user_message_at = info
            .last_user_message_at
            .max(crate::sessions::user_message_timestamp(&entry));
        if entry["type"] == "session_info" {
            info.name = entry["name"]
                .as_str()
                .filter(|name| !name.trim().is_empty())
                .map(|name| name.chars().take(500).collect());
        }
        if info.preview.is_empty()
            && entry["type"] == "message"
            && entry["message"]["role"] == "user"
        {
            let content = &entry["message"]["content"];
            let text = content.as_str().map(str::to_owned).unwrap_or_else(|| {
                content
                    .as_array()
                    .map(|blocks| {
                        blocks
                            .iter()
                            .filter(|b| b["type"] == "text")
                            .filter_map(|b| b["text"].as_str())
                            .collect::<Vec<_>>()
                            .join(" ")
                    })
                    .unwrap_or_default()
            });
            info.preview = text
                .split_whitespace()
                .collect::<Vec<_>>()
                .join(" ")
                .chars()
                .take(240)
                .collect();
        }
    }
    info.map(Some)
        .ok_or_else(|| "Missing session header".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn catalog_filters_projects_reads_names_and_previews_and_reports_bad_files() {
        let temporary = tempfile::tempdir().unwrap();
        let base = temporary.path();
        fs::create_dir_all(base.join("project")).unwrap();
        fs::create_dir_all(base.join("other")).unwrap();
        fs::create_dir_all(base.join("sessions")).unwrap();
        let cwd = base.join("project").canonicalize().unwrap();
        let dir = base.join("sessions");
        let header = json!({"type":"session", "version":3, "id":"one", "cwd":cwd});
        fs::write(dir.join("one.jsonl"), format!("{header}\n{}\n{}\n{}\n", json!({"type":"message", "message":{"role":"user", "content":[{"type":"text", "text":"first\nquestion"}]}}), json!({"type":"session_info", "name":"Old name"}), json!({"type":"session_info", "name":"Latest name"}))).unwrap();
        fs::write(
            dir.join("other.jsonl"),
            json!({"type":"session", "version":3, "id":"other", "cwd":base.join("other")})
                .to_string(),
        )
        .unwrap();
        fs::write(dir.join("bad.jsonl"), "not json").unwrap();
        let catalog = list(&dir, &cwd).unwrap();
        assert_eq!(catalog.sessions.len(), 1);
        assert_eq!(catalog.sessions[0].name.as_deref(), Some("Latest name"));
        assert_eq!(catalog.sessions[0].preview, "first question");
        assert_eq!(
            catalog.sessions[0].path,
            dir.join("one.jsonl").canonicalize().unwrap()
        );
        assert_eq!(catalog.warnings.len(), 1);
        assert!(
            list(&base.join("absent"), &cwd)
                .unwrap()
                .sessions
                .is_empty()
        );
        assert!(!base.join("absent").exists());
    }
    #[test]
    fn lineage_distinguishes_roots_from_children_without_blocking_exact_file_resume() {
        let temporary = tempfile::tempdir().unwrap();
        let cwd = temporary.path().canonicalize().unwrap();
        let parent = cwd.join("root.jsonl").to_string_lossy().into_owned();
        for (id, lineage) in [
            ("root", None),
            ("null-root", Some(Value::Null)),
            ("subagent", Some(json!(parent))),
            ("branch", Some(json!(parent))),
            ("invalid", Some(json!(42))),
            ("empty", Some(json!(""))),
        ] {
            let mut header = json!({"type":"session", "version":3, "id":id, "cwd":cwd});
            if let Some(lineage) = lineage {
                header["parentSession"] = lineage;
            }
            fs::write(cwd.join(format!("{id}.jsonl")), header.to_string()).unwrap();
        }
        let catalog = list(&cwd, &cwd).unwrap();
        assert_eq!(catalog.sessions.len(), 4);
        assert_eq!(catalog.warnings.len(), 2);
        let mut roots: Vec<_> = catalog
            .sessions
            .iter()
            .filter(|s| s.parent_session.is_none())
            .map(|s| s.session_id.as_str())
            .collect();
        roots.sort_unstable();
        assert_eq!(roots, ["null-root", "root"]);
        for id in ["subagent", "branch"] {
            let summary = catalog
                .sessions
                .iter()
                .find(|s| s.session_id == id)
                .unwrap();
            assert_eq!(summary.parent_session.as_deref(), Some(parent.as_str()));
            let inspected = crate::sessions::inspect(&summary.path, &cwd).unwrap();
            assert_eq!(inspected.parent_session, summary.parent_session);
            assert_eq!(inspected.session_id, id);
            assert_eq!(
                serde_json::to_value(summary).unwrap()["parentSession"],
                parent
            );
        }
    }

    #[test]
    fn follows_pi_directory_encoding() {
        assert_eq!(
            project_dir(Path::new("sessions"), Path::new("/a/b-c")),
            PathBuf::from("sessions/--a-b-c--")
        );
    }
}
