//! Pi-specific file-tree preview and deletion. No Pi process or extension is used.
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, Metadata},
    io::{BufRead, BufReader, Read},
    path::{Component, Path, PathBuf},
    time::SystemTime,
};

const MAX_RECORD: u64 = 16 * 1024 * 1024;
const MAX_FILE: u64 = 256 * 1024 * 1024;
const MAX_STORE: usize = 100_000;
const MAX_TREE: usize = 10_000;

#[derive(Clone, Serialize, Debug)]
pub struct DeleteResult {
    pub file: PathBuf,
    pub deleted: bool,
    pub error: Option<String>,
}
#[derive(Clone, Serialize, Debug)]
pub struct ReviewSession {
    pub file: PathBuf,
    pub title: String,
    pub parent: Option<PathBuf>,
    pub cwd: PathBuf,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Identity {
    len: u64,
    modified: SystemTime,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
    #[cfg(unix)]
    changed: (i64, i64),
}
impl Identity {
    fn read(meta: &Metadata) -> Result<Self, String> {
        if !meta.is_file() || meta.len() == 0 || meta.len() > MAX_FILE {
            return Err("Session must be a nonempty regular JSONL file (at most 256 MiB)".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            if meta.nlink() != 1 {
                return Err("Hard-linked sessions cannot be deleted".into());
            }
        }
        Ok(Self {
            len: meta.len(),
            modified: meta.modified().map_err(|e| e.to_string())?,
            #[cfg(unix)]
            device: {
                use std::os::unix::fs::MetadataExt;
                meta.dev()
            },
            #[cfg(unix)]
            inode: {
                use std::os::unix::fs::MetadataExt;
                meta.ino()
            },
            #[cfg(unix)]
            changed: {
                use std::os::unix::fs::MetadataExt;
                (meta.ctime(), meta.ctime_nsec())
            },
        })
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Header {
    id: String,
    cwd: PathBuf,
    parent: Option<PathBuf>,
}
#[derive(Clone, Debug)]
struct PlannedFile {
    review: ReviewSession,
    header: Header,
    identity: Identity,
    digest: [u8; 32],
}
#[derive(Clone, Debug)]
pub struct Plan {
    store: PathBuf,
    root: PathBuf,
    // Children first, so a failed child prevents removing its ancestors.
    files: Vec<PlannedFile>,
}
impl Plan {
    pub fn tree(&self) -> Vec<ReviewSession> {
        self.files
            .iter()
            .rev()
            .map(|file| file.review.clone())
            .collect()
    }
    pub fn files(&self) -> Vec<PathBuf> {
        self.files
            .iter()
            .map(|file| file.review.file.clone())
            .collect()
    }
}
fn absolute(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() {
        return Err("Session header paths must be absolute".into());
    }
    let mut normalized = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                normalized.pop();
            }
            Component::CurDir => {}
            other => normalized.push(other.as_os_str()),
        }
    }
    Ok(normalized)
}
fn parse_header(value: &Value) -> Result<Header, String> {
    if value["type"] != "session" || !matches!(value["version"].as_u64(), Some(1..=3)) {
        return Err("Invalid or unsupported Pi session header".into());
    }
    let id = value["id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or("Missing session ID")?
        .to_owned();
    let cwd = absolute(Path::new(
        value["cwd"].as_str().ok_or("Missing session project")?,
    ))?;
    // Missing project/ancestor directories do not prevent deleting old history.
    let cwd = cwd.canonicalize().unwrap_or(cwd);
    let parent = match value.get("parentSession").filter(|v| !v.is_null()) {
        Some(parent) => {
            let parent = absolute(Path::new(parent.as_str().ok_or("Invalid parent session")?))?;
            Some(parent.canonicalize().unwrap_or(parent))
        }
        None => None,
    };
    Ok(Header { id, cwd, parent })
}
fn next_line(reader: &mut BufReader<File>, line: &mut String) -> Result<usize, String> {
    line.clear();
    let bytes = reader
        .by_ref()
        .take(MAX_RECORD + 1)
        .read_line(line)
        .map_err(|e| e.to_string())?;
    if bytes as u64 > MAX_RECORD {
        return Err("Session JSONL record exceeds 16 MiB".into());
    }
    Ok(bytes)
}
fn open_regular(path: &Path) -> Result<(BufReader<File>, Identity), String> {
    let identity = Identity::read(&fs::symlink_metadata(path).map_err(|e| e.to_string())?)?;
    let file = File::open(path).map_err(|e| e.to_string())?;
    if Identity::read(&file.metadata().map_err(|e| e.to_string())?)? != identity {
        return Err("Session changed while opening it".into());
    }
    Ok((BufReader::new(file), identity))
}
fn header(path: &Path) -> Result<Header, String> {
    let (mut reader, _) = open_regular(path)?;
    let mut line = String::new();
    let mut bytes_read = 0;
    while next_line(&mut reader, &mut line)? != 0 {
        bytes_read += line.len() as u64;
        if bytes_read > MAX_FILE {
            return Err("Session grew beyond the 256 MiB limit while reading its header".into());
        }
        if !line.trim().is_empty() {
            return parse_header(&serde_json::from_str::<Value>(&line).map_err(|e| e.to_string())?);
        }
    }
    Err("Missing session header".into())
}
fn fingerprint(path: &Path, root: &Path) -> Result<PlannedFile, String> {
    let (mut reader, identity) = open_regular(path)?;
    let mut digest = Sha256::new();
    let mut line = String::new();
    let mut parsed = None;
    let mut title = None;
    let mut bytes_read = 0;
    while next_line(&mut reader, &mut line)? != 0 {
        bytes_read += line.len() as u64;
        if bytes_read > MAX_FILE {
            return Err("Session grew beyond the 256 MiB limit while reading".into());
        }
        digest.update(line.as_bytes());
        if line.trim().is_empty() {
            continue;
        }
        let value: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
        if !value.is_object() || !value["type"].is_string() {
            return Err("Invalid Pi session entry".into());
        }
        if parsed.is_none() {
            parsed = Some(parse_header(&value)?);
        } else if value["type"] == "session" {
            return Err("Multiple session headers".into());
        } else if value["type"] == "session_info" {
            if let Some(name) = value["name"].as_str().filter(|s| !s.trim().is_empty()) {
                title = Some(name.chars().take(500).collect::<String>());
            }
        }
    }
    if Identity::read(&reader.get_ref().metadata().map_err(|e| e.to_string())?)? != identity
        || Identity::read(&fs::symlink_metadata(path).map_err(|e| e.to_string())?)? != identity
    {
        return Err("Session changed while reading it".into());
    }
    let header = parsed.ok_or("Missing session header")?;
    Ok(PlannedFile {
        review: ReviewSession {
            file: path.into(),
            title: title.unwrap_or_else(|| {
                format!("Session {}", header.id.chars().take(12).collect::<String>())
            }),
            parent: if path == root {
                None
            } else {
                header.parent.clone()
            },
            cwd: header.cwd.clone(),
        },
        header,
        identity,
        digest: digest.finalize().into(),
    })
}
fn scan(store: &Path) -> Result<HashMap<PathBuf, Header>, String> {
    let mut found = HashMap::new();
    let mut dirs = vec![store.to_path_buf()];
    let mut entries = 0;
    while let Some(dir) = dirs.pop() {
        for entry in
            fs::read_dir(&dir).map_err(|e| format!("Cannot scan {}: {e}", dir.display()))?
        {
            let entry = entry.map_err(|e| e.to_string())?;
            entries += 1;
            if entries > MAX_STORE {
                return Err("Session store exceeds the 100,000-entry scan limit".into());
            }
            let kind = entry.file_type().map_err(|e| e.to_string())?;
            let path = entry.path();
            if kind.is_symlink() {
                return Err(format!("Symlink in session store: {}", path.display()));
            }
            if kind.is_dir() {
                dirs.push(path);
            } else if path.extension().is_some_and(|e| e == "jsonl") {
                let info =
                    header(&path).map_err(|e| format!("Cannot inspect {}: {e}", path.display()))?;
                found.insert(path, info);
            }
        }
    }
    Ok(found)
}
pub fn preview(store: &Path, root: &Path, cwd: &Path, id: &str) -> Result<Plan, String> {
    let store = store
        .canonicalize()
        .map_err(|e| format!("Pi session store unavailable: {e}"))?;
    let root = absolute(root)?;
    if !root.starts_with(&store) {
        return Err("Selected session is outside the Pi session store".into());
    }
    let headers = scan(&store)?;
    let selected = headers
        .get(&root)
        .ok_or("Selected session is not a regular file in the session store")?;
    if selected.id != id || selected.cwd != cwd {
        return Err("Selected session identity/project changed; nothing deleted".into());
    }
    let mut children: HashMap<&Path, Vec<&Path>> = HashMap::new();
    for (path, header) in &headers {
        if let Some(parent) = &header.parent {
            children.entry(parent).or_default().push(path);
        }
    }
    for descendants in children.values_mut() {
        descendants.sort();
    }
    let mut stack = vec![root.as_path()];
    let mut order = Vec::new();
    let mut seen = HashSet::new();
    while let Some(path) = stack.pop() {
        if !seen.insert(path) {
            return Err("Cyclic session lineage; nothing deleted".into());
        }
        if seen.len() > MAX_TREE {
            return Err("Session subtree exceeds 10,000 files".into());
        }
        order.push(path);
        stack.extend(children.get(path).into_iter().flatten().copied());
    }
    let files = order
        .into_iter()
        .rev()
        .map(|path| {
            let file = fingerprint(path, &root)?;
            if Some(&file.header) != headers.get(path) {
                return Err("Session header changed during preview".into());
            }
            Ok(file)
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(Plan { store, root, files })
}
pub fn revalidate(plan: &Plan) -> Result<(), String> {
    let root = plan
        .files
        .iter()
        .find(|f| f.review.file == plan.root)
        .ok_or("Missing root")?;
    let current = preview(&plan.store, &plan.root, &root.header.cwd, &root.header.id)?;
    if current.files.len() != plan.files.len()
        || current.files.iter().zip(&plan.files).any(|(a, b)| {
            a.review.file != b.review.file
                || a.header != b.header
                || a.identity != b.identity
                || a.digest != b.digest
        })
    {
        return Err("Session tree changed after preview; nothing deleted. Review it again.".into());
    }
    Ok(())
}
pub fn execute(plan: &Plan, cancelled: impl Fn() -> bool) -> Result<Vec<DeleteResult>, String> {
    revalidate(plan)?;
    let mut results: Vec<DeleteResult> = Vec::new();
    let mut failed_ancestors = HashSet::new();
    for file in &plan.files {
        let removal = if cancelled() {
            Err("Deletion cancelled before this file was removed".into())
        } else if failed_ancestors.contains(&file.review.file) {
            Err("A descendant was not deleted; ancestor retained".into())
        } else {
            // Recheck each exact file immediately before unlink. External writers are
            // not locked: an unavoidable final pathname race remains outside Nimrod.
            fingerprint(&file.review.file, &plan.root).and_then(|current| {
                if current.header != file.header
                    || current.identity != file.identity
                    || current.digest != file.digest
                {
                    return Err("Session changed before removal".into());
                }
                fs::remove_file(&file.review.file).map_err(|e| e.to_string())
            })
        };
        if removal.is_err() {
            if let Some(parent) = &file.review.parent {
                failed_ancestors.insert(parent.clone());
            }
        }
        results.push(DeleteResult {
            file: file.review.file.clone(),
            deleted: removal.is_ok(),
            error: removal.err(),
        });
    }
    Ok(results)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (tempfile::TempDir, PathBuf, PathBuf, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let store = temp.path().join("sessions");
        fs::create_dir(&store).unwrap();
        let cwd = temp.path().join("project");
        fs::create_dir(&cwd).unwrap();
        let other = temp.path().join("other");
        fs::create_dir(&other).unwrap();
        (
            temp,
            store.canonicalize().unwrap(),
            cwd.canonicalize().unwrap(),
            other.canonicalize().unwrap(),
        )
    }
    fn session(path: &Path, cwd: &Path, id: &str, parent: Option<&Path>) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(
            path,
            format!(
                "{}\n{}\n",
                json!({"type":"session","version":3,"id":id,"cwd":cwd,"parentSession":parent}),
                json!({"type":"session_info","name":format!("Name {id}")})
            ),
        )
        .unwrap();
    }
    #[test]
    fn deletes_children_first_across_projects_without_pi_and_retains_unrelated_files() {
        let (_temp, store, cwd, other) = fixture();
        let root = store.join("one/root.jsonl");
        let child = store.join("two/child.jsonl");
        let unrelated = store.join("two/other.jsonl");
        session(&root, &cwd, "root", None);
        session(&child, &other, "child", Some(&root));
        session(&unrelated, &other, "other", None);
        let plan = preview(&store, &root, &cwd, "root").unwrap();
        assert_eq!(plan.tree()[0].title, "Name root");
        assert_eq!(plan.tree()[1].cwd, other);
        let results = execute(&plan, || false).unwrap();
        assert_eq!(results[0].file, child);
        assert!(results.iter().all(|r| r.deleted));
        assert!(!root.exists());
        assert!(unrelated.exists());
    }
    #[test]
    fn stale_membership_content_and_replaced_identity_are_rejected_before_any_removal() {
        for change in ["child", "content", "identity"] {
            let (_temp, store, cwd, _) = fixture();
            let root = store.join("root.jsonl");
            session(&root, &cwd, "root", None);
            let plan = preview(&store, &root, &cwd, "root").unwrap();
            match change {
                "child" => session(&store.join("new.jsonl"), &cwd, "child", Some(&root)),
                "content" => {
                    use std::io::Write;
                    writeln!(
                        fs::OpenOptions::new().append(true).open(&root).unwrap(),
                        "{{\"type\":\"session_info\",\"name\":\"changed\"}}"
                    )
                    .unwrap();
                }
                _ => {
                    let old = fs::read(&root).unwrap();
                    fs::rename(&root, store.join("original.old")).unwrap();
                    fs::write(&root, old).unwrap();
                }
            }
            assert!(execute(&plan, || false).is_err());
            assert!(root.exists());
        }
    }
    #[test]
    fn cancelled_preview_or_execute_removes_nothing_and_reports_each_file() {
        let (_temp, store, cwd, _) = fixture();
        let root = store.join("root.jsonl");
        let child = store.join("child.jsonl");
        session(&root, &cwd, "root", None);
        session(&child, &cwd, "child", Some(&root));
        let plan = preview(&store, &root, &cwd, "root").unwrap();
        assert!(root.exists());
        assert!(child.exists());
        let results = execute(&plan, || true).unwrap();
        assert_eq!(results.len(), 2);
        assert!(results.iter().all(|r| !r.deleted));
        assert!(root.exists());
        assert!(child.exists());
    }
    #[test]
    fn partial_failures_retain_ancestors_but_allow_independent_successes() {
        let (_temp, store, cwd, _) = fixture();
        let root = store.join("root.jsonl");
        let a = store.join("a.jsonl");
        let b = store.join("b.jsonl");
        session(&root, &cwd, "root", None);
        session(&a, &cwd, "a", Some(&root));
        session(&b, &cwd, "b", Some(&root));
        let plan = preview(&store, &root, &cwd, "root").unwrap();
        let calls = std::cell::Cell::new(0);
        let results = execute(&plan, || {
            let n = calls.get();
            calls.set(n + 1);
            n == 0
        })
        .unwrap();
        assert_eq!(results.iter().filter(|r| r.deleted).count(), 1);
        assert!(root.exists());
        assert!(
            results
                .last()
                .unwrap()
                .error
                .as_ref()
                .unwrap()
                .contains("descendant")
        );
    }
    #[test]
    fn wrong_project_id_outside_store_corrupt_headers_and_cycles_fail_closed() {
        let (_temp, store, cwd, other) = fixture();
        let root = store.join("root.jsonl");
        session(&root, &cwd, "root", None);
        assert!(preview(&store, &root, &other, "root").is_err());
        assert!(preview(&store, &root, &cwd, "wrong").is_err());
        let outside = cwd.join("outside.jsonl");
        session(&outside, &cwd, "outside", None);
        assert!(preview(&store, &outside, &cwd, "outside").is_err());
        fs::write(store.join("corrupt.jsonl"), "bad").unwrap();
        assert!(preview(&store, &root, &cwd, "root").is_err());
        fs::remove_file(store.join("corrupt.jsonl")).unwrap();
        let child = store.join("child.jsonl");
        session(&child, &cwd, "child", Some(&root));
        session(&root, &cwd, "root", Some(&child));
        assert!(preview(&store, &root, &cwd, "root").is_err());
    }
    #[cfg(unix)]
    #[test]
    fn symlinks_and_hard_links_are_never_removed() {
        let (_temp, store, cwd, _) = fixture();
        let root = store.join("root.jsonl");
        session(&root, &cwd, "root", None);
        let link = store.join("alias.jsonl");
        std::os::unix::fs::symlink(&root, &link).unwrap();
        assert!(preview(&store, &root, &cwd, "root").is_err());
        fs::remove_file(&link).unwrap();
        fs::hard_link(&root, &link).unwrap();
        assert!(preview(&store, &root, &cwd, "root").is_err());
        assert!(root.exists());
        assert!(link.exists());
    }
}
