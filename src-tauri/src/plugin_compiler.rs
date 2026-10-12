//! Personal source discovery and content/resolution-validated disk bundles. Never evaluate plugins here.
#[cfg(test)]
#[path = "plugin_compiler_tests.rs"]
mod tests;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::process::Stdio;
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Read, Write},
    path::{Component, Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
};
use tokio::{
    io::AsyncReadExt,
    process::Command,
    sync::Mutex,
    time::{Duration, timeout},
};

const MAX_BUNDLE: u64 = 1024 * 1024;
const MAX_INPUT: u64 = 8 * 1024 * 1024;
const MAX_CACHE: u64 = 4 * 1024 * 1024;
const MAX_TREE_ENTRIES: usize = 100_000;
const OPTIONS: &[&str] = &[
    "--bundle",
    "--format=esm",
    "--platform=browser",
    "--target=es2022",
    "--tsconfig-raw={}",
    "--log-level=error",
];
const SDK: &str = include_str!("../../src/card-plugin-api.ts");

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub entry: String,
    pub source: String,
    pub cache_hit: bool,
}
#[derive(Default, Debug, Serialize)]
pub struct Bundles {
    pub entries: Vec<String>,
    pub plugins: Vec<Bundle>,
    pub warnings: Vec<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Record {
    schema: u8,
    identity: String,
    entry: PathBuf,
    inputs: Vec<PathBuf>,
    snapshot: BTreeMap<String, String>,
    source: String,
    source_hash: String,
}
#[derive(Clone)]
pub struct Compiler {
    pub binary: PathBuf,
    pub cache: PathBuf,
    gate: Arc<Mutex<()>>,
    runs: Arc<AtomicUsize>,
    stopping: tokio_util::sync::CancellationToken,
}

fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, String> {
    if !fs::metadata(path)
        .map_err(|e| format!("{}: {e}", path.display()))?
        .is_file()
    {
        return Err(format!("{} is not a regular file", path.display()));
    }
    let mut options = fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(nix::libc::O_NONBLOCK);
    }
    let file = options
        .open(path)
        .map_err(|e| format!("{}: {e}", path.display()))?;
    if !file.metadata().map_err(|e| e.to_string())?.is_file() {
        return Err(format!("{} is not a regular file", path.display()));
    }
    let mut bytes = Vec::new();
    file.take(limit + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > limit {
        return Err(format!("{} exceeds {} KiB", path.display(), limit / 1024));
    }
    Ok(bytes)
}
fn file_digest(path: &Path) -> Result<String, String> {
    Ok(digest(&read_bounded(path, MAX_INPUT)?))
}
fn source_name(name: &str) -> bool {
    !name.starts_with('.')
        && !name.ends_with(".d.ts")
        && (name.ends_with(".ts") || name.ends_with(".tsx"))
}
fn valid_entry(entry: &str) -> bool {
    if entry.len() > 512 || entry.chars().any(char::is_control) || entry.contains('\\') {
        return false;
    }
    let parts: Vec<_> = Path::new(entry).components().collect();
    if parts
        .iter()
        .any(|part| !matches!(part, Component::Normal(_)))
    {
        return false;
    }
    match parts.as_slice() {
        [Component::Normal(name)] => source_name(&name.to_string_lossy()),
        [Component::Normal(folder), Component::Normal(name)] => {
            !folder.to_string_lossy().starts_with('.')
                && *folder != "node_modules"
                && ["index.ts", "index.tsx"].contains(&name.to_string_lossy().as_ref())
        }
        _ => false,
    }
}
fn resolve_entry(root: &Path, entry: &str) -> Result<PathBuf, String> {
    if !valid_entry(entry) {
        return Err(
            "Source entry must be a personal .ts/.tsx file or directory/index.ts(x)".into(),
        );
    }
    let mut path = root.to_path_buf();
    for part in Path::new(entry).components() {
        path.push(part);
        if fs::symlink_metadata(&path)
            .map_err(|e| e.to_string())?
            .file_type()
            .is_symlink()
        {
            return Err("Personal plugin entry symlinks are unsupported".into());
        }
    }
    let path = path.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(root) || !path.is_file() {
        return Err("Source entry escaped its personal directory".into());
    }
    Ok(path)
}
pub fn discover(root: &Path) -> Result<Vec<String>, String> {
    if !root.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for item in fs::read_dir(root).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let name = item.file_name().to_string_lossy().into_owned();
        let kind = item.file_type().map_err(|e| e.to_string())?;
        if kind.is_file() && source_name(&name) {
            entries.push(name);
        } else if kind.is_dir() && !name.starts_with('.') && name != "node_modules" {
            for file in ["index.ts", "index.tsx"] {
                let candidate = item.path().join(file);
                if fs::symlink_metadata(&candidate).is_ok_and(|m| m.is_file()) {
                    entries.push(format!("{name}/{file}"));
                    break;
                }
            }
        }
    }
    entries.sort();
    if entries.len() > 50 {
        return Err(format!(
            "Discovered {} personal plugins; maximum is 50 (nothing loaded)",
            entries.len()
        ));
    }
    Ok(entries)
}

fn directory_digest(path: &Path, recursive: bool) -> Result<String, String> {
    if !path.exists() {
        return Ok("missing".into());
    }
    let mut values = Vec::new();
    let mut count = 0;
    fn visit(
        root: &Path,
        path: &Path,
        recursive: bool,
        values: &mut Vec<String>,
        count: &mut usize,
    ) -> Result<(), String> {
        let mut children = fs::read_dir(path)
            .map_err(|e| format!("{}: {e}", path.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        children.sort_by_key(|entry| entry.file_name());
        for child in children {
            *count += 1;
            if *count > MAX_TREE_ENTRIES {
                return Err("Dependency resolution tree exceeds 100,000 entries".into());
            }
            let name = child.file_name().to_string_lossy().into_owned();
            let path = child.path();
            let kind = child.file_type().map_err(|e| e.to_string())?;
            let relative = path.strip_prefix(root).unwrap().to_string_lossy();
            let detail = if kind.is_symlink() {
                format!(
                    "link:{}",
                    fs::read_link(&path).map_err(|e| e.to_string())?.display()
                )
            } else if kind.is_dir() {
                "dir".into()
            } else if name == "package.json"
                || [
                    "package-lock.json",
                    "yarn.lock",
                    "pnpm-lock.yaml",
                    "bun.lock",
                    "bun.lockb",
                ]
                .contains(&name.as_str())
            {
                file_digest(&path)?
            } else {
                "file".into()
            };
            values.push(format!("{relative}:{detail}"));
            if recursive
                && kind.is_dir()
                && ![
                    ".git",
                    ".cache",
                    ".worktrees",
                    "target",
                    "dist",
                    "node_modules",
                ]
                .contains(&name.as_str())
            {
                visit(root, &path, true, values, count)?;
            }
        }
        Ok(())
    }
    visit(path, path, recursive, &mut values, &mut count)?;
    Ok(digest(values.join("\n").as_bytes()))
}
fn snapshot(root: &Path, inputs: &[PathBuf]) -> Result<BTreeMap<String, String>, String> {
    if inputs.len() > 4096 {
        return Err("Plugin has more than 4096 input files".into());
    }
    let mut result = BTreeMap::new();
    let mut trees = BTreeSet::from([root.to_path_buf()]);
    let mut dirs = BTreeSet::new();
    let mut contexts = BTreeSet::new();
    for input in inputs {
        result.insert(format!("input:{}", input.display()), file_digest(input)?);
        let parent = input.parent().ok_or("Invalid compiler input")?;
        if !input.starts_with(root) {
            dirs.insert(parent.to_path_buf());
            if input.file_stem().is_some_and(|stem| stem == "index") {
                if let Some(parent) = parent.parent() {
                    dirs.insert(parent.to_path_buf());
                }
            }
        }
        let mut package_root = None;
        for ancestor in parent.ancestors() {
            for name in [
                "package.json",
                "package-lock.json",
                "yarn.lock",
                "pnpm-lock.yaml",
                "bun.lock",
                "bun.lockb",
            ] {
                contexts.insert(ancestor.join(name));
            }
            let modules = ancestor.join("node_modules");
            trees.insert(modules);
            if package_root.is_none() && ancestor.join("package.json").is_file() {
                package_root = Some(ancestor);
            }
        }
        if let Some(package) = package_root.filter(|package| !package.starts_with(root)) {
            trees.insert(package.to_path_buf());
            if let Some(parent) = package.parent() {
                dirs.insert(parent.to_path_buf());
            }
        }
    }
    for dir in dirs {
        result.insert(
            format!("directory:{}", dir.display()),
            directory_digest(&dir, false)?,
        );
    }
    for tree in trees {
        result.insert(
            format!("tree:{}", tree.display()),
            directory_digest(&tree, true)?,
        );
    }
    for context in contexts {
        result.insert(
            format!("context:{}", context.display()),
            if context.is_file() {
                file_digest(&context)?
            } else {
                "missing".into()
            },
        );
    }
    Ok(result)
}

impl Compiler {
    pub fn new(binary: PathBuf, cache: PathBuf) -> Self {
        Self {
            binary,
            cache,
            gate: Arc::new(Mutex::new(())),
            runs: Arc::new(AtomicUsize::new(0)),
            stopping: tokio_util::sync::CancellationToken::new(),
        }
    }
    pub fn bundled(cache: PathBuf) -> Self {
        let sidecar = std::env::current_exe()
            .ok()
            .and_then(|path| {
                path.parent().map(|parent| {
                    parent.join(if cfg!(windows) {
                        "esbuild.exe"
                    } else {
                        "esbuild"
                    })
                })
            })
            .filter(|path| path.is_file());
        Self::new(
            sidecar.unwrap_or_else(|| PathBuf::from(env!("NIMROD_PLUGIN_COMPILER"))),
            cache,
        )
    }
    pub async fn shutdown(&self) {
        self.stopping.cancel();
        let _guard = self.gate.lock().await;
    }
    fn identity(&self) -> Result<String, String> {
        Ok(digest(
            format!(
                "cache-v1|{}|{}|{}",
                digest(&read_bounded(&self.binary, 64 * 1024 * 1024)?),
                OPTIONS.join("|"),
                digest(SDK.as_bytes())
            )
            .as_bytes(),
        ))
    }
    pub async fn load(&self, root: &Path) -> Bundles {
        let entries = match discover(root) {
            Ok(entries) => entries,
            Err(error) => {
                return Bundles {
                    entries: Vec::new(),
                    plugins: Vec::new(),
                    warnings: vec![error],
                };
            }
        };
        if entries.is_empty() {
            return Bundles::default();
        }
        let _guard = self.gate.lock().await;
        let identity = match self.identity() {
            Ok(value) => value,
            Err(error) => {
                return Bundles {
                    entries,
                    plugins: Vec::new(),
                    warnings: vec![error],
                };
            }
        };
        let mut result = Bundles {
            entries: entries.clone(),
            ..Bundles::default()
        };
        for entry in entries {
            match self.compile_inner(root, &entry, &identity).await {
                Ok(bundle) => result.plugins.push(bundle),
                Err(error) => result.warnings.push(format!("{entry}: {error}")),
            }
        }
        result
    }
    #[cfg(test)]
    pub async fn compile(&self, root: &Path, entry: &str) -> Result<Bundle, String> {
        let _guard = self.gate.lock().await;
        self.compile_inner(root, entry, &self.identity()?).await
    }
    async fn compile_inner(
        &self,
        root: &Path,
        entry: &str,
        identity: &str,
    ) -> Result<Bundle, String> {
        if self.stopping.is_cancelled() {
            return Err("Plugin compiler is shutting down".into());
        }
        let root = root.canonicalize().map_err(|e| e.to_string())?;
        let path = resolve_entry(&root, entry)?;
        fs::create_dir_all(&self.cache).map_err(|e| e.to_string())?;
        let record_path = self.cache.join(format!(
            "{}.json",
            digest(path.to_string_lossy().as_bytes())
        ));
        let previous = read_bounded(&record_path, MAX_CACHE)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Record>(&bytes).ok());
        if let Some(record) = &previous {
            if record.schema == 1
                && record.identity == identity
                && record.entry == path
                && record.inputs.contains(&path)
                && record.inputs.iter().all(|input| input.is_absolute())
                && record.source.len() as u64 <= MAX_BUNDLE
                && record.source_hash == digest(record.source.as_bytes())
                && snapshot(&root, &record.inputs).is_ok_and(|state| state == record.snapshot)
            {
                return Ok(Bundle {
                    entry: entry.into(),
                    source: record.source.clone(),
                    cache_hit: true,
                });
            }
        }
        let directory = tempfile::tempdir().map_err(|e| e.to_string())?;
        let output = directory.path().join("bundle.js");
        let meta = directory.path().join("meta.json");
        let mut known = previous
            .filter(|record| record.schema == 1 && record.entry == path)
            .map(|record| record.inputs)
            .unwrap_or_else(|| vec![path.clone()]);
        known.retain(|input| input.is_file());
        if !known.contains(&path) {
            known.push(path.clone());
        }
        for _ in 0..3 {
            let before = snapshot(&root, &known)?;
            self.runs.fetch_add(1, Ordering::Relaxed);
            if self.stopping.is_cancelled() {
                return Err("Plugin compiler is shutting down".into());
            }
            let mut child = Command::new(&self.binary)
                .current_dir(&root)
                .arg(&path)
                .args(OPTIONS)
                .arg(format!("--outfile={}", output.display()))
                .arg(format!("--metafile={}", meta.display()))
                .stdin(Stdio::null())
                .stdout(Stdio::null())
                .stderr(Stdio::piped())
                .kill_on_drop(true)
                .spawn()
                .map_err(|e| format!("Plugin compiler: {e}"))?;
            let mut stderr = child
                .stderr
                .take()
                .ok_or("Missing compiler error pipe")?
                .take(8192);
            let mut errors = Vec::new();
            let result = tokio::select! {
                result = timeout(Duration::from_secs(20), async { tokio::join!(child.wait(), stderr.read_to_end(&mut errors)) }) => result,
                _ = self.stopping.cancelled() => {
                    let _ = child.kill().await; let _ = child.wait().await;
                    return Err("Owned plugin compiler stopped for app shutdown".into());
                }
            };
            let (status, read) = match result {
                Ok(result) => result,
                Err(_) => {
                    let _ = child.kill().await;
                    let _ = child.wait().await;
                    return Err(
                        "Plugin compilation timed out (owned compiler exit observed)".into(),
                    );
                }
            };
            read.map_err(|e| e.to_string())?;
            if !status.map_err(|e| e.to_string())?.success() {
                return Err(String::from_utf8_lossy(&errors).into_owned());
            }
            let metadata: serde_json::Value =
                serde_json::from_slice(&read_bounded(&meta, MAX_CACHE)?)
                    .map_err(|e| e.to_string())?;
            let input_map = metadata["inputs"]
                .as_object()
                .ok_or("Missing compiler input metadata")?;
            let outputs = metadata["outputs"]
                .as_object()
                .ok_or("Missing compiler output metadata")?;
            if outputs.len() != 1
                || input_map.values().chain(outputs.values()).any(|record| {
                    record["imports"].as_array().is_some_and(|imports| {
                        imports.iter().any(|import| import["external"] == true)
                    })
                })
            {
                return Err("Plugin must bundle to one self-contained JS module; CSS/assets and external runtime imports are unsupported".into());
            }
            let inputs = input_map
                .keys()
                .map(|input| root.join(input).canonicalize().map_err(|e| e.to_string()))
                .collect::<Result<BTreeSet<_>, _>>()?
                .into_iter()
                .collect::<Vec<_>>();
            let after = snapshot(&root, &inputs)?;
            if before != after {
                known = inputs;
                continue;
            }
            let source =
                String::from_utf8(read_bounded(&output, MAX_BUNDLE)?).map_err(|e| e.to_string())?;
            let record = Record {
                schema: 1,
                identity: identity.into(),
                entry: path,
                inputs,
                snapshot: after,
                source_hash: digest(source.as_bytes()),
                source: source.clone(),
            };
            let bytes = serde_json::to_vec(&record).map_err(|e| e.to_string())?;
            if bytes.len() as u64 > MAX_CACHE {
                return Err("Plugin cache record exceeds 4 MiB".into());
            }
            let mut staged =
                tempfile::NamedTempFile::new_in(&self.cache).map_err(|e| e.to_string())?;
            staged.write_all(&bytes).map_err(|e| e.to_string())?;
            staged.as_file().sync_all().map_err(|e| e.to_string())?;
            staged
                .persist(&record_path)
                .map_err(|e| e.error.to_string())?;
            return Ok(Bundle {
                entry: entry.into(),
                source,
                cache_hit: false,
            });
        }
        Err("Plugin inputs/resolution changed during compilation; reload after edits settle".into())
    }
}
