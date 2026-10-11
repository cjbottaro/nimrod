//! Explicit Open VSX discovery and pinned-package collection. Never used by the app.
use crate::{
    Bundle, Entry, FILE_LIMIT, Manifest, Source, ThemeSpec, build_bundle, jsonc, normalize,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    fs,
    io::{Cursor, Read},
    path::Path,
    time::Duration,
};

const PACKAGE_LIMIT: usize = 32 * 1024 * 1024;
const UNPACKED_LIMIT: u64 = 128 * 1024 * 1024;
const ENTRY_LIMIT: usize = 20000;
const SEARCH_SIZE: usize = 100;
// An explicit starter policy, not a claim of exhaustive registry coverage.
const SEARCH_PAGES: usize = 2;
const PACKAGE_TARGET: usize = 50;
const LICENSES: &[&str] = &[
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "MPL-2.0",
];

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegistryProvenance {
    pub namespace: String,
    pub name: String,
    pub version: String,
    pub sha256: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Package {
    pub namespace: String,
    pub name: String,
    pub version: String,
    pub download: String,
    pub sha256: String,
    pub license: String,
    pub license_path: String,
    pub author: String,
    pub themes: Vec<LockedTheme>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LockedTheme {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mode: String,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Lock {
    pub version: u32,
    pub packages: Vec<Package>,
    pub report: Report,
}
#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Report {
    pub registry_total: usize,
    pub inspected: usize,
    pub search_window: usize,
    pub package_target: usize,
    pub omissions: Vec<Omission>,
}
#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Omission {
    pub extension: String,
    pub reason: String,
}
fn part(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 100
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        && s != "."
        && s != ".."
}
fn hex_digest(s: &str) -> bool {
    s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit())
}
fn slug(s: &str) -> String {
    let mut output = String::new();
    for c in s.to_ascii_lowercase().chars() {
        if c.is_ascii_alphanumeric() {
            output.push(c);
        } else if !output.ends_with('-') {
            output.push('-');
        }
    }
    output.trim_matches('-').chars().take(38).collect()
}
fn clean(s: &str) -> String {
    s.chars()
        .filter(|c| !c.is_control())
        .take(80)
        .collect::<String>()
        .trim()
        .to_string()
}
fn source_id(namespace: &str, name: &str) -> String {
    let key = format!(
        "{}.{}",
        namespace.to_ascii_lowercase(),
        name.to_ascii_lowercase()
    );
    format!(
        "ovsx-{}-{}",
        slug(&key),
        &format!("{:x}", Sha256::digest(key.as_bytes()))[..8]
    )
}

/// Read ZIP entries in memory only. No archive-controlled paths are written to disk.
pub fn archive_files(bytes: &[u8]) -> Result<BTreeMap<String, String>, String> {
    if bytes.len() > PACKAGE_LIMIT {
        return Err("VSIX exceeds 32 MiB".into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    if zip.len() > ENTRY_LIMIT {
        return Err("VSIX has too many entries".into());
    }
    let mut files = BTreeMap::new();
    let mut expanded = 0u64;
    for index in 0..zip.len() {
        let mut file = zip.by_index(index).map_err(|e| e.to_string())?;
        expanded = expanded
            .checked_add(file.size())
            .ok_or("VSIX expansion overflow")?;
        if expanded > UNPACKED_LIMIT {
            return Err("VSIX exceeds 128 MiB expanded".into());
        }
        if file.is_dir() {
            continue;
        }
        if file
            .unix_mode()
            .is_some_and(|mode| mode & 0o170000 == 0o120000)
        {
            return Err("VSIX symlinks are unsupported".into());
        }
        let Some(name) = file.name().strip_prefix("extension/") else {
            continue;
        };
        let path = normalize("", name)?;
        let lower = path.to_ascii_lowercase();
        if !(lower.ends_with(".json")
            || lower.ends_with(".jsonc")
            || lower.ends_with(".tmtheme")
            || lower.contains("license")
            || lower.contains("notice")
            || lower.contains("copying"))
        {
            continue;
        }
        if file.size() > FILE_LIMIT as u64 {
            return Err(format!("VSIX file {path} exceeds 512 KiB"));
        }
        let mut text = String::new();
        (&mut file)
            .take(FILE_LIMIT as u64 + 1)
            .read_to_string(&mut text)
            .map_err(|e| e.to_string())?;
        if text.len() > FILE_LIMIT {
            return Err("Oversized VSIX text".into());
        }
        if files.insert(path.clone(), text).is_some() {
            return Err(format!("Duplicate VSIX path {path}"));
        }
    }
    Ok(files)
}

fn validate_package(package: &Package) -> Result<(), String> {
    if !part(&package.namespace)
        || !part(&package.name)
        || !part(&package.version)
        || !hex_digest(&package.sha256)
        || !LICENSES.contains(&package.license.as_str())
        || package.themes.is_empty()
        || package.themes.len() > 500
        || package.author.is_empty()
        || package.author.len() > 160
        || package.author.chars().any(char::is_control)
    {
        return Err("Invalid locked Open VSX package".into());
    }
    let url = reqwest::Url::parse(&package.download).map_err(|e| e.to_string())?;
    let prefix = format!(
        "/api/{}/{}/{}/file/",
        package.namespace, package.name, package.version
    );
    if url.scheme() != "https"
        || url.host_str() != Some("open-vsx.org")
        || !url.path().starts_with(&prefix)
        || !url.path().ends_with(".vsix")
        || url.query().is_some()
        || url.fragment().is_some()
        || !url.username().is_empty()
        || url.port().is_some()
    {
        return Err("Expected a pinned Open VSX VSIX download URL".into());
    }
    normalize("", &package.license_path)?;
    Ok(())
}

fn package_bundle(package: &Package, bytes: &[u8]) -> Result<Bundle, String> {
    validate_package(package)?;
    if format!("{:x}", Sha256::digest(bytes)) != package.sha256.to_ascii_lowercase() {
        return Err("VSIX SHA-256 mismatch".into());
    }
    let files = archive_files(bytes)?;
    let source = Source {
        id: source_id(&package.namespace, &package.name),
        repository: format!("{}/{}", package.namespace, package.name),
        revision: "0".repeat(40),
        author: package.author.clone(),
        license: package.license.clone(),
        license_path: package.license_path.clone(),
        themes: package
            .themes
            .iter()
            .map(|theme| ThemeSpec {
                id: theme.id.clone(),
                name: theme.name.clone(),
                path: theme.path.clone(),
                mode: theme.mode.clone(),
            })
            .collect(),
    };
    let mut bundle = build_bundle(
        &Manifest {
            version: 1,
            sources: vec![source],
        },
        |_, path| {
            files
                .get(path)
                .cloned()
                .ok_or(format!("Missing VSIX file {path}"))
        },
    )?;
    let provenance = bundle
        .sources
        .values_mut()
        .next()
        .ok_or("Missing provenance")?;
    provenance.revision = package.version.clone();
    provenance.registry = Some(RegistryProvenance {
        namespace: package.namespace.clone(),
        name: package.name.clone(),
        version: package.version.clone(),
        sha256: package.sha256.clone(),
    });
    // Full package hash pins all assets; retain package manifest digest too.
    if let Some(manifest) = files.get("package.json") {
        provenance.files.insert(
            "package.json".into(),
            format!("{:x}", Sha256::digest(manifest)),
        );
    }
    // Include NOTICE files as well as LICENSE to preserve Apache attribution.
    for (path, text) in &files {
        if path.split('/').count() == 1 && path.to_ascii_lowercase().starts_with("notice") {
            provenance
                .license_text
                .push_str(&format!("\n\n{path}\n{text}"));
            provenance
                .files
                .insert(path.clone(), format!("{:x}", Sha256::digest(text)));
        }
    }
    Ok(bundle)
}

pub struct RegistryClient {
    client: reqwest::blocking::Client,
}
impl RegistryClient {
    pub fn new() -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(40))
            .user_agent("Nimrod theme catalog maintenance")
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                let url = attempt.url();
                if attempt.previous().len() >= 3 {
                    return attempt.error("Too many registry redirects");
                }
                if url.scheme() == "https"
                    && matches!(
                        url.host_str(),
                        Some("open-vsx.org" | "openvsx.eclipsecontent.org")
                    )
                    && url.username().is_empty()
                    && url.port().is_none()
                {
                    attempt.follow()
                } else {
                    attempt.error("Registry redirect outside approved hosts")
                }
            }))
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self { client })
    }
    fn bytes(&self, url: &str, limit: usize) -> Result<Vec<u8>, String> {
        let response = self
            .client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        response
            .take(limit as u64 + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() > limit {
            return Err("Registry response exceeds limit".into());
        }
        Ok(bytes)
    }
    fn json(&self, url: &str) -> Result<Value, String> {
        serde_json::from_slice(&self.bytes(url, 4 * 1024 * 1024)?).map_err(|e| e.to_string())
    }
    pub fn package_bytes(
        &self,
        package: &Package,
        cache: &Path,
        offline: bool,
    ) -> Result<Vec<u8>, String> {
        validate_package(package)?;
        let path = cache.join(format!("ovsx-{}.vsix", package.sha256));
        let bytes = if path.is_file() {
            if fs::metadata(&path).map_err(|e| e.to_string())?.len() > PACKAGE_LIMIT as u64 {
                return Err("Oversized cached VSIX".into());
            }
            fs::read(&path).map_err(|e| e.to_string())?
        } else {
            if offline {
                return Err(format!(
                    "Offline VSIX cache miss: {}.{}",
                    package.namespace, package.name
                ));
            }
            eprintln!(
                "Downloading {}.{} {}",
                package.namespace, package.name, package.version
            );
            let bytes = self.bytes(&package.download, PACKAGE_LIMIT)?;
            if format!("{:x}", Sha256::digest(&bytes)) != package.sha256 {
                return Err("VSIX SHA-256 mismatch".into());
            }
            fs::create_dir_all(cache).map_err(|e| e.to_string())?;
            fs::write(&path, &bytes).map_err(|e| e.to_string())?;
            bytes
        };
        if format!("{:x}", Sha256::digest(&bytes)) != package.sha256 {
            return Err("Cached VSIX SHA-256 mismatch".into());
        }
        Ok(bytes)
    }
    pub fn discover(&self, cache: &Path) -> Result<Lock, String> {
        let mut lock = Lock {
            version: 1,
            packages: Vec::new(),
            report: Report {
                search_window: SEARCH_PAGES * SEARCH_SIZE,
                package_target: PACKAGE_TARGET,
                ..Report::default()
            },
        };
        let mut seen = BTreeSet::new();
        for page in 0..SEARCH_PAGES {
            let results = self.json(&format!("https://open-vsx.org/api/-/search?category=Themes&sortBy=downloadCount&sortOrder=desc&size={SEARCH_SIZE}&offset={}", page * SEARCH_SIZE))?;
            lock.report.registry_total = results["totalSize"]
                .as_u64()
                .ok_or("Registry search missing total")?
                as usize;
            for entry in results["extensions"]
                .as_array()
                .ok_or("Registry search missing extensions")?
            {
                if lock.packages.len() >= PACKAGE_TARGET {
                    break;
                }
                let namespace = entry["namespace"].as_str().ok_or("Missing namespace")?;
                let name = entry["name"].as_str().ok_or("Missing name")?;
                let extension = format!("{namespace}.{name}");
                if !seen.insert(extension.to_ascii_lowercase()) {
                    continue;
                }
                lock.report.inspected += 1;
                let result = (|| {
                    if entry["deprecated"] == true {
                        return Err("Deprecated extension".into());
                    }
                    let version = entry["version"].as_str().ok_or("Missing version")?;
                    if !part(namespace) || !part(name) || !part(version) {
                        return Err("Invalid extension identity".into());
                    }
                    let metadata = self.json(&format!(
                        "https://open-vsx.org/api/{namespace}/{name}/{version}"
                    ))?;
                    let license = metadata["license"].as_str().unwrap_or("");
                    if !LICENSES.contains(&license) {
                        return Err(format!("License requires review: {license}"));
                    }
                    let manifest_url = format!(
                        "https://open-vsx.org/api/{namespace}/{name}/{version}/file/package.json"
                    );
                    let manifest = jsonc(
                        &String::from_utf8(self.bytes(&manifest_url, FILE_LIMIT)?)
                            .map_err(|e| e.to_string())?,
                    )?;
                    let contributed = manifest
                        .pointer("/contributes/themes")
                        .and_then(Value::as_array)
                        .ok_or("No color-theme contributions (icon/non-theme extension)")?;
                    if contributed.is_empty() {
                        return Err("No color themes".into());
                    }
                    let download = metadata["files"]["download"]
                        .as_str()
                        .ok_or("Missing package download")?
                        .to_string();
                    let checksum_url = metadata["files"]["sha256"]
                        .as_str()
                        .ok_or("Missing registry checksum")?;
                    let prefix =
                        format!("https://open-vsx.org/api/{namespace}/{name}/{version}/file/");
                    if !checksum_url.starts_with(&prefix) {
                        return Err("Untrusted checksum URL".into());
                    }
                    let checksum = String::from_utf8(self.bytes(checksum_url, 1024)?)
                        .map_err(|e| e.to_string())?;
                    let sha256 = checksum
                        .split_whitespace()
                        .next()
                        .ok_or("Empty registry checksum")?
                        .to_ascii_lowercase();
                    let license_url = metadata["files"]["license"]
                        .as_str()
                        .ok_or("Missing full license notice")?;
                    let license_path = license_url
                        .strip_prefix(&prefix)
                        .ok_or("Unexpected license path")?
                        .to_string();
                    let mut themes = Vec::new();
                    for contribution in contributed {
                        let path = normalize(
                            "",
                            contribution["path"].as_str().ok_or("Theme missing path")?,
                        )?;
                        if !path.to_ascii_lowercase().ends_with(".json")
                            && !path.to_ascii_lowercase().ends_with(".jsonc")
                        {
                            return Err("Non-JSON theme contribution requires adapter".into());
                        }
                        let name = clean(
                            contribution["label"]
                                .as_str()
                                .ok_or("Theme missing label")?,
                        );
                        if name.is_empty() {
                            return Err("Empty theme label".into());
                        }
                        // Path-based identity survives label edits, version upgrades and reorderings.
                        let id = format!(
                            "{}-{}",
                            slug(&path),
                            &format!("{:x}", Sha256::digest(path.as_bytes()))[..8]
                        );
                        let mode = match contribution["uiTheme"].as_str() {
                            Some("vs") => "light",
                            Some("vs-dark") => "dark",
                            Some("hc-black") => "hc",
                            Some("hc-light") => "hcLight",
                            _ => return Err("Unknown uiTheme".into()),
                        };
                        themes.push(LockedTheme {
                            id,
                            name,
                            path,
                            mode: mode.into(),
                        });
                    }
                    let package = Package {
                        namespace: namespace.into(),
                        name: name.into(),
                        version: version.into(),
                        download,
                        sha256,
                        license: license.into(),
                        license_path,
                        author: clean(
                            metadata["namespaceDisplayName"]
                                .as_str()
                                .unwrap_or(namespace),
                        ),
                        themes,
                    };
                    let bytes = self.package_bytes(&package, cache, false)?;
                    let bundle = package_bundle(&package, &bytes)?;
                    eprintln!("Accepted {extension}: {} variants", bundle.themes.len());
                    Ok(package)
                })();
                match result {
                    Ok(package) => lock.packages.push(package),
                    Err(reason) => {
                        eprintln!("Skipped {extension}: {reason}");
                        lock.report.omissions.push(Omission { extension, reason });
                    }
                }
            }
            if lock.packages.len() >= PACKAGE_TARGET {
                break;
            }
        }
        if lock.packages.is_empty() {
            return Err("No compatible packages discovered; lock unchanged".into());
        }
        lock.packages
            .sort_by(|a, b| (&a.namespace, &a.name).cmp(&(&b.namespace, &b.name)));
        eprintln!(
            "Discovery coverage: {} inspected / {} registry results; {} accepted packages; {} omissions. Search window {}, target {} (not exhaustive).",
            lock.report.inspected,
            lock.report.registry_total,
            lock.packages.len(),
            lock.report.omissions.len(),
            lock.report.search_window,
            lock.report.package_target
        );
        Ok(lock)
    }
}

pub fn append_locked(
    bundle: &mut Bundle,
    lock: &Lock,
    mut read: impl FnMut(&Package) -> Result<Vec<u8>, String>,
) -> Result<(), String> {
    if lock.version != 1 || lock.packages.is_empty() || lock.packages.len() > 100 {
        return Err("Invalid registry lock".into());
    }
    let mut ids: BTreeSet<String> = bundle.themes.iter().map(|entry| entry.id.clone()).collect();
    for package in &lock.packages {
        let addition = package_bundle(package, &read(package)?)?;
        for Entry {
            id,
            name,
            source,
            path,
            theme,
        } in addition.themes
        {
            if !ids.insert(id.clone()) {
                return Err(format!("Duplicate catalog ID {id}"));
            }
            bundle.themes.push(Entry {
                id,
                name,
                source,
                path,
                theme,
            });
        }
        for (id, provenance) in addition.sources {
            if bundle.sources.insert(id, provenance).is_some() {
                return Err("Duplicate catalog source".into());
            }
        }
    }
    bundle
        .themes
        .sort_by(|a, b| a.name.cmp(&b.name).then(a.id.cmp(&b.id)));
    if serde_json::to_vec(bundle).map_err(|e| e.to_string())?.len() > crate::BUNDLE_LIMIT {
        return Err("Expanded catalog exceeds 16 MiB; adjust explicit collection policy".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(entries: &[(&str, &str)]) -> Vec<u8> {
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, text) in entries {
            zip.start_file(*path, zip::write::SimpleFileOptions::default())
                .unwrap();
            zip.write_all(text.as_bytes()).unwrap();
        }
        zip.finish().unwrap().into_inner()
    }
    #[test]
    fn zip_paths_and_duplicates_fail_without_extraction() {
        assert!(archive_files(&archive(&[("extension/../../escape.json", "{}")])).is_err());
        assert!(
            archive_files(&archive(&[
                ("extension/a.json", "{}"),
                ("extension/./a.json", "{}")
            ]))
            .is_err()
        );
        let files = archive_files(&archive(&[
            ("extension/package.json", "{}"),
            ("extension/script.js", "throw 'never execute'"),
            ("extension/LICENSE.txt", "MIT"),
        ]))
        .unwrap();
        assert_eq!(files.len(), 2);
        assert!(!files.contains_key("script.js"));
    }
    #[test]
    fn pinned_package_resolves_include_and_records_notice_and_checksum() {
        let bytes = archive(&[
            ("extension/package.json", "{}"),
            ("extension/LICENSE.txt", "MIT"),
            ("extension/NOTICE", "Attribution"),
            (
                "extension/themes/main.json",
                "{\"include\":\"base.json\",\"tokenColors\":[{\"scope\":\"string\",\"settings\":{\"foreground\":\"#abc\"}}]}",
            ),
            (
                "extension/themes/base.json",
                "{\"colors\":{\"editor.background\":\"#123\"}}",
            ),
        ]);
        let mut package = Package {
            namespace: "Author".into(),
            name: "theme".into(),
            version: "1.0.0".into(),
            download: "https://open-vsx.org/api/Author/theme/1.0.0/file/theme.vsix".into(),
            sha256: format!("{:x}", Sha256::digest(&bytes)),
            license: "MIT".into(),
            license_path: "LICENSE.txt".into(),
            author: "Author".into(),
            themes: vec![LockedTheme {
                id: "main".into(),
                name: "Main".into(),
                path: "themes/main.json".into(),
                mode: "dark".into(),
            }],
        };
        let bundle = package_bundle(&package, &bytes).unwrap();
        assert_eq!(
            bundle.themes[0].theme["colors"]["editor.background"],
            "#123"
        );
        assert!(
            bundle
                .sources
                .values()
                .next()
                .unwrap()
                .license_text
                .contains("Attribution")
        );
        assert!(bundle.sources.values().next().unwrap().registry.is_some());
        package.sha256 = "0".repeat(64);
        assert!(package_bundle(&package, &bytes).is_err());
        package.download = "https://evil.test/a.vsix".into();
        assert!(validate_package(&package).is_err());
    }
}
