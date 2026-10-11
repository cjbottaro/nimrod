//! Read-only Pi session discovery. Pi owns JSONL history and writes; resume still
//! performs the stricter exact-file validation in sessions.rs.
use serde::Serialize;
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Read, Seek, SeekFrom},
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

const MAX_RECORD: usize = 16 * 1024 * 1024;
const REVERSE_CHUNK: usize = 64 * 1024;

fn summary(path: &Path, cwd: &Path) -> Result<Option<SessionSummary>, String> {
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    let file = File::open(&path).map_err(|e| e.to_string())?;
    let metadata = file.metadata().map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 256 * 1024 * 1024 {
        return Err("Not a nonempty Pi session file within the 256 MiB limit".into());
    }
    let mut reader = BufReader::new(file);
    let mut line = Vec::new();
    let header = loop {
        if !forward_line(&mut reader, &mut line)? {
            return Err("Missing session header".into());
        }
        if !line.iter().all(u8::is_ascii_whitespace) {
            break parse_entry(&line)?;
        }
    };
    if header["type"] != "session" || !matches!(header["version"].as_u64(), Some(1..=3)) {
        return Err("Invalid or unsupported session header".into());
    }
    let recorded = Path::new(header["cwd"].as_str().ok_or("Missing project directory")?);
    if !recorded.is_absolute() {
        return Err("Project directory is not absolute".into());
    }
    if recorded.canonicalize().map_err(|e| e.to_string())? != cwd {
        return Ok(None);
    }
    let id = header["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Missing session ID")?;
    let mut info = SessionSummary {
        path,
        session_id: id.into(),
        name: None,
        parent_session: crate::sessions::parent_session(&header)?,
        preview: String::new(),
        last_user_message_at: 0,
        modified: metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
            .map_or(0, |t| t.as_millis() as u64),
    };
    let body_start = reader.stream_position().map_err(|e| e.to_string())?;
    // Preview remains the first nonempty user text, for existing picker search.
    // Unrelated tool/assistant payloads are scanned as bytes, not deserialized.
    while forward_line(&mut reader, &mut line)? {
        if candidate(&line, b"\"user\"") {
            let entry = parse_entry(&line)?;
            if is_user_message(&entry) {
                info.preview = preview(&entry);
                if !info.preview.is_empty() {
                    break;
                }
            }
        }
    }
    latest_metadata(
        &mut reader.into_inner(),
        body_start,
        metadata.len(),
        &mut info,
    )?;
    Ok(Some(info))
}

fn forward_line(reader: &mut impl BufRead, line: &mut Vec<u8>) -> Result<bool, String> {
    line.clear();
    let bytes = reader
        .take(MAX_RECORD as u64 + 1)
        .read_until(b'\n', line)
        .map_err(|e| e.to_string())?;
    if bytes > MAX_RECORD {
        return Err("JSONL record exceeds 16 MiB".into());
    }
    Ok(bytes != 0)
}

fn parse_entry(line: &[u8]) -> Result<Value, String> {
    let entry: Value = serde_json::from_slice(line).map_err(|e| format!("Invalid JSONL: {e}"))?;
    if !entry.is_object() || !entry["type"].is_string() {
        return Err("Invalid Pi session entry".into());
    }
    Ok(entry)
}

fn candidate(line: &[u8], marker: &[u8]) -> bool {
    // Pi writes literal enum values using JSON.stringify. Escaped JSON from
    // other writers takes the parsing fallback so valid escaped enums still work.
    line.windows(marker.len()).any(|part| part == marker)
        || line.windows(2).any(|part| part == b"\\u")
}

fn is_user_message(entry: &Value) -> bool {
    entry["type"] == "message" && entry["message"]["role"] == "user"
}

fn preview(entry: &Value) -> String {
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
    text.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .chars()
        .take(240)
        .collect()
}

fn latest_metadata(
    reader: &mut (impl Read + Seek),
    start: u64,
    end: u64,
    info: &mut SessionSummary,
) -> Result<(), String> {
    let mut lines = ReverseLines::new(reader, start, end);
    let mut line = Vec::new();
    let (mut found_name, mut found_user) = (false, false);
    while lines.next(&mut line)? {
        if (!found_name && candidate(&line, b"\"session_info\""))
            || (!found_user && candidate(&line, b"\"user\""))
        {
            let entry = parse_entry(&line)?;
            if !found_name && entry["type"] == "session_info" {
                info.name = entry["name"]
                    .as_str()
                    .filter(|name| !name.trim().is_empty())
                    .map(|name| name.chars().take(500).collect());
                found_name = true;
            }
            if !found_user && is_user_message(&entry) {
                info.last_user_message_at = crate::sessions::user_message_timestamp(&entry);
                // Missing/invalid timestamps do not hide an earlier usable time.
                found_user = info.last_user_message_at != 0;
            }
            if found_name && found_user {
                break;
            }
        }
    }
    Ok(())
}

/// Chunked reverse JSONL traversal: bounded to one record plus a 64 KiB buffer.
/// Stops at the already-read header and accepts CRLF/no trailing newline.
struct ReverseLines<'a, R> {
    reader: &'a mut R,
    start: u64,
    offset: u64,
    chunk: Vec<u8>,
    remaining: usize,
}

impl<'a, R: Read + Seek> ReverseLines<'a, R> {
    fn new(reader: &'a mut R, start: u64, end: u64) -> Self {
        Self {
            reader,
            start,
            offset: end,
            chunk: vec![0; REVERSE_CHUNK],
            remaining: 0,
        }
    }

    fn next(&mut self, line: &mut Vec<u8>) -> Result<bool, String> {
        line.clear();
        loop {
            if self.remaining == 0 {
                let size =
                    (self.offset.saturating_sub(self.start)).min(REVERSE_CHUNK as u64) as usize;
                if size == 0 {
                    line.reverse();
                    return Ok(!line.is_empty());
                }
                self.offset -= size as u64;
                self.reader
                    .seek(SeekFrom::Start(self.offset))
                    .map_err(|e| e.to_string())?;
                self.reader
                    .read_exact(&mut self.chunk[..size])
                    .map_err(|e| e.to_string())?;
                self.remaining = size;
            }
            self.remaining -= 1;
            let byte = self.chunk[self.remaining];
            if byte == b'\n' {
                if line.len() + 1 > MAX_RECORD {
                    return Err("JSONL record exceeds 16 MiB".into());
                }
                if line.iter().all(u8::is_ascii_whitespace) {
                    line.clear();
                    continue;
                }
                line.reverse();
                return Ok(true);
            }
            line.push(byte);
            if line.len() > MAX_RECORD {
                return Err("JSONL record exceeds 16 MiB".into());
            }
        }
    }
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

    fn fixture_summary(body: &str) -> (tempfile::TempDir, SessionSummary) {
        let temporary = tempfile::tempdir().unwrap();
        let cwd = temporary.path().canonicalize().unwrap();
        let path = cwd.join("history.jsonl");
        let header = json!({"type":"session", "version":3, "id":"test", "cwd":cwd});
        fs::write(&path, format!("{header}\n{body}")).unwrap();
        let info = summary(&path, &cwd).unwrap().unwrap();
        (temporary, info)
    }

    #[test]
    fn reads_preview_from_front_and_latest_metadata_from_tail_without_parsing_middle() {
        let body = format!(
            "{}\n{}\nnot JSON: omitted from catalog validation\n{}\n{}\n{}\n",
            json!({"type":"message", "message":{"role":"user", "content":"first preview", "timestamp":1000}}),
            json!({"type":"session_info", "name":"Old"}),
            json!({"type":"session_info", "name":"Latest 🌿"}),
            json!({"type":"message", "message":{"role":"user", "content":"recent", "timestamp":2000}}),
            json!({"type":"message", "message":{"role":"assistant", "content":"trailing response", "timestamp":3000}})
        );
        let (temporary, info) = fixture_summary(&body);
        assert_eq!(info.preview, "first preview");
        assert_eq!(info.name.as_deref(), Some("Latest 🌿"));
        assert_eq!(info.last_user_message_at, 2000);
        assert!(
            crate::sessions::inspect(&info.path, &temporary.path().canonicalize().unwrap())
                .is_err(),
            "Full exact-file validation must still reject malformed history"
        );
    }

    #[test]
    fn unnamed_sessions_skip_unrelated_payloads_and_keep_latest_valid_user_time() {
        let body = format!(
            "{}\n{}\n{}\n{}\n",
            json!({"type":"message", "message":{"role":"user", "content":[{"type":"image"}], "timestamp":1000}}),
            json!({"type":"message", "timestamp":"2025-06-01T14:30:00.123+02:00", "message":{"role":"user", "content":"text preview"}}),
            json!({"type":"message", "message":{"role":"toolResult", "content":"session_info user", "timestamp":1900000000000_u64}}),
            json!({"type":"message", "timestamp":"invalid", "message":{"role":"user", "timestamp":0}})
        );
        let (_, info) = fixture_summary(&body);
        assert_eq!(info.name, None);
        assert_eq!(info.preview, "text preview");
        assert_eq!(info.last_user_message_at, 1748781000123);
    }

    #[test]
    fn latest_user_record_wins_even_when_its_clock_moves_backwards() {
        let (_, info) = fixture_summary(&format!(
            "{}\n{}\n{}",
            json!({"type":"message", "message":{"role":"user", "content":"preview", "timestamp":2000}}),
            json!({"type":"message", "message":{"role":"user", "timestamp":1000}}),
            json!({"type":"session_info", "name":"Named"})
        ));
        assert_eq!(info.last_user_message_at, 1000);
    }

    #[test]
    fn malformed_metadata_candidates_still_report_a_catalog_warning() {
        let temporary = tempfile::tempdir().unwrap();
        let cwd = temporary.path().canonicalize().unwrap();
        fs::write(
            cwd.join("bad.jsonl"),
            format!(
                "{}\n{{\"type\":\"session_info\",bad}}",
                json!({"type":"session", "version":3, "id":"bad", "cwd":cwd})
            ),
        )
        .unwrap();
        let catalog = list(&cwd, &cwd).unwrap();
        assert!(catalog.sessions.is_empty());
        assert_eq!(catalog.warnings.len(), 1);
    }

    #[test]
    fn latest_blank_name_is_not_replaced_by_an_older_name() {
        let (_, info) = fixture_summary(&format!(
            "{}\n{}",
            json!({"type":"session_info", "name":"Old"}),
            json!({"type":"session_info", "name":" "})
        ));
        assert_eq!(info.name, None);
        assert_eq!(info.last_user_message_at, 0);
        assert_eq!(info.preview, "");
    }

    #[test]
    fn accepts_escaped_enum_values_and_ignores_markers_in_payloads() {
        let (_, info) = fixture_summary(concat!(
            "{\"type\":\"message\",\"message\":{\"role\":\"us\\u0065r\",\"timestamp\":1000,\"content\":\"preview\"}}\n",
            "{\"type\":\"session_\\u0069nfo\",\"name\":\"Escaped\"}\n",
            "{\"type\":\"custom\",\"data\":{\"type\":\"session_info\",\"role\":\"user\",\"name\":\"Wrong\"}}\n"
        ));
        assert_eq!(info.name.as_deref(), Some("Escaped"));
        assert_eq!(info.preview, "preview");
        assert_eq!(info.last_user_message_at, 1000);
    }

    #[test]
    fn reverse_lines_handle_chunk_boundaries_utf8_blank_lines_crlf_and_final_line() {
        use std::io::Cursor;
        let large = format!("{}🌿", "x".repeat(REVERSE_CHUNK * 2 + 7));
        for suffix in ["", "\n", "\r\n\r\n"] {
            let bytes = format!("header\nfirst\r\n{large}\nlast{suffix}").into_bytes();
            let mut cursor = Cursor::new(bytes.clone());
            let mut lines = ReverseLines::new(&mut cursor, 7, bytes.len() as u64);
            let mut line = Vec::new();
            for expected in ["last", large.as_str(), "first"] {
                assert!(lines.next(&mut line).unwrap());
                assert_eq!(
                    std::str::from_utf8(&line).unwrap().trim_end_matches('\r'),
                    expected
                );
            }
            assert!(!lines.next(&mut line).unwrap());
        }
    }

    #[test]
    fn reverse_metadata_stops_after_one_tail_chunk() {
        use std::io::Cursor;
        struct Counted {
            inner: Cursor<Vec<u8>>,
            bytes: usize,
        }
        impl Read for Counted {
            fn read(&mut self, out: &mut [u8]) -> std::io::Result<usize> {
                let count = self.inner.read(out)?;
                self.bytes += count;
                Ok(count)
            }
        }
        impl Seek for Counted {
            fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
                self.inner.seek(position)
            }
        }
        let (_, mut info) = fixture_summary("");
        let history = format!(
            "{}\n{}\n{}\n",
            "x".repeat(REVERSE_CHUNK * 20),
            json!({"type":"message", "message":{"role":"user", "timestamp":2000}}),
            json!({"type":"session_info", "name":"Tail"})
        )
        .into_bytes();
        let end = history.len() as u64;
        let mut reader = Counted {
            inner: Cursor::new(history),
            bytes: 0,
        };
        latest_metadata(&mut reader, 0, end, &mut info).unwrap();
        assert_eq!(reader.bytes, REVERSE_CHUNK);
        assert_eq!(info.name.as_deref(), Some("Tail"));
        assert_eq!(info.last_user_message_at, 2000);
    }

    #[test]
    fn reverse_lines_enforce_record_bound() {
        use std::io::Cursor;
        let mut cursor = Cursor::new(vec![b'x'; MAX_RECORD + 1]);
        let mut lines = ReverseLines::new(&mut cursor, 0, (MAX_RECORD + 1) as u64);
        assert!(lines.next(&mut Vec::new()).unwrap_err().contains("16 MiB"));
    }

    #[test]
    fn follows_pi_directory_encoding() {
        assert_eq!(
            project_dir(Path::new("sessions"), Path::new("/a/b-c")),
            PathBuf::from("sessions/--a-b-c--")
        );
    }
}
