use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};

pub mod open_vsx;

pub const FILE_LIMIT: usize = 512 * 1024;
pub const BUNDLE_LIMIT: usize = 16 * 1024 * 1024;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Manifest {
    pub version: u32,
    pub sources: Vec<Source>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Source {
    pub id: String,
    pub repository: String,
    pub revision: String,
    pub author: String,
    pub license: String,
    pub license_path: String,
    pub themes: Vec<ThemeSpec>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ThemeSpec {
    pub id: String,
    pub name: String,
    pub path: String,
    pub mode: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bundle {
    pub version: u32,
    pub themes: Vec<Entry>,
    pub sources: BTreeMap<String, Provenance>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    pub source: String,
    pub path: String,
    pub theme: Value,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub repository: String,
    pub revision: String,
    pub author: String,
    pub license: String,
    pub license_text: String,
    pub files: BTreeMap<String, String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub registry: Option<open_vsx::RegistryProvenance>,
}

fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 60
        && value
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn metadata(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 160 && !value.chars().any(char::is_control)
}
pub fn validate_manifest(manifest: &Manifest) -> Result<(), String> {
    if manifest.version != 1 || manifest.sources.is_empty() || manifest.sources.len() > 100 {
        return Err("Expected manifest v1 with 1–100 sources".into());
    }
    let mut source_ids = BTreeSet::new();
    let mut ids = BTreeSet::new();
    for source in &manifest.sources {
        let repo: Vec<_> = source.repository.split('/').collect();
        if !identifier(&source.id)
            || !source_ids.insert(&source.id)
            || repo.len() != 2
            || repo.iter().any(|s| {
                s.is_empty()
                    || *s == "."
                    || *s == ".."
                    || !s
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
            })
            || source.revision.len() != 40
            || !source.revision.bytes().all(|b| b.is_ascii_hexdigit())
            || !metadata(&source.author)
            || !metadata(&source.license)
            || source.themes.is_empty()
            || source.themes.len() > 100
        {
            return Err(format!(
                "Invalid source {}: use a GitHub owner/repo and pinned 40-digit revision",
                source.id
            ));
        }
        normalize("", &source.license_path)?;
        for theme in &source.themes {
            if !identifier(&theme.id)
                || !ids.insert(format!("catalog-{}-{}", source.id, theme.id))
                || source.id.len() + theme.id.len() > 100
                || !metadata(&theme.name)
                || !["dark", "light", "hc", "hcLight"].contains(&theme.mode.as_str())
            {
                return Err(format!("Invalid/duplicate theme {}", theme.id));
            }
            normalize("", &theme.path)?;
        }
    }
    Ok(())
}

/// Resolve relative files inside the pinned repository; never escape or fetch URLs.
pub fn normalize(parent: &str, reference: &str) -> Result<String, String> {
    if reference.is_empty()
        || reference.starts_with('/')
        || reference.contains(['\\', ':', '?', '#'])
        || reference.chars().any(char::is_control)
    {
        return Err(format!("Invalid repository path: {reference}"));
    }
    let mut parts: Vec<&str> = parent.split('/').filter(|s| !s.is_empty()).collect();
    parts.pop();
    for part in reference.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                if parts.pop().is_none() {
                    return Err("Reference escapes repository".into());
                }
            }
            _ => parts.push(part),
        }
    }
    if parts.is_empty() {
        return Err("Expected file path".into());
    }
    Ok(parts.join("/"))
}

/// Preserve strings while removing JSONC comments and trailing commas.
pub fn jsonc(text: &str) -> Result<Value, String> {
    let mut bytes = text.trim_start_matches('\u{feff}').as_bytes().to_vec();
    let mut i = 0;
    let mut string = false;
    while i < bytes.len() {
        if string {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                string = false;
            }
        } else if bytes[i] == b'"' {
            string = true;
        } else if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'/') {
            while i < bytes.len() && bytes[i] != b'\n' {
                bytes[i] = b' ';
                i += 1;
            }
            continue;
        } else if bytes[i] == b'/' && bytes.get(i + 1) == Some(&b'*') {
            bytes[i] = b' ';
            bytes[i + 1] = b' ';
            i += 2;
            let mut closed = false;
            while i + 1 < bytes.len() {
                if bytes[i] == b'*' && bytes[i + 1] == b'/' {
                    bytes[i] = b' ';
                    bytes[i + 1] = b' ';
                    i += 2;
                    closed = true;
                    break;
                }
                if !b"\n\r".contains(&bytes[i]) {
                    bytes[i] = b' ';
                }
                i += 1;
            }
            if !closed {
                return Err("Unclosed JSONC comment".into());
            }
            continue;
        }
        i += 1;
    }
    i = 0;
    string = false;
    while i < bytes.len() {
        if string {
            if bytes[i] == b'\\' {
                i += 2;
                continue;
            }
            if bytes[i] == b'"' {
                string = false;
            }
        } else if bytes[i] == b'"' {
            string = true;
        } else if bytes[i] == b','
            && bytes[i + 1..]
                .iter()
                .find(|b| !b.is_ascii_whitespace())
                .is_some_and(|b| b"]}".contains(b))
        {
            bytes[i] = b' ';
        }
        i += 1;
    }
    serde_json::from_slice(&bytes).map_err(|e| e.to_string())
}

pub fn hex(value: &str) -> bool {
    value.starts_with('#')
        && [4, 5, 7, 9].contains(&value.len())
        && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}
fn validate_theme(theme: &Value) -> Result<(), String> {
    let colors = theme
        .get("colors")
        .and_then(Value::as_object)
        .ok_or("Missing colors")?;
    let bg = colors
        .get("editor.background")
        .and_then(Value::as_str)
        .ok_or("Missing editor.background")?;
    if !hex(bg)
        || !(bg.len() == 4
            || bg.len() == 7
            || bg.len() == 5 && bg.ends_with(['f', 'F'])
            || bg.len() == 9 && bg[7..].eq_ignore_ascii_case("ff"))
    {
        return Err("Expected opaque editor.background".into());
    }
    for (key, value) in colors {
        if !value.is_null() && !value.as_str().is_some_and(hex) {
            return Err(format!("Non-hex color: {key}"));
        }
    }
    for rule in theme
        .get("tokenColors")
        .and_then(Value::as_array)
        .ok_or("Missing tokenColors")?
    {
        if let Some(value) = rule.pointer("/settings/foreground")
            && !value.is_null()
            && !value.as_str().is_some_and(hex)
        {
            return Err("Non-hex token foreground".into());
        }
    }
    Ok(())
}

struct Resolver<'a, F> {
    read: &'a mut F,
    files: BTreeMap<String, String>,
    stack: BTreeSet<String>,
}
impl<F: FnMut(&str) -> Result<String, String>> Resolver<'_, F> {
    fn file(&mut self, path: &str) -> Result<String, String> {
        let text = (self.read)(path)?;
        if text.len() > FILE_LIMIT {
            return Err(format!("{path} exceeds 512 KiB"));
        }
        self.files.insert(
            path.into(),
            format!("{:x}", Sha256::digest(text.as_bytes())),
        );
        Ok(text)
    }
    fn resolve(&mut self, path: &str) -> Result<Value, String> {
        if self.stack.len() >= 32 || !self.stack.insert(path.into()) {
            return Err(format!("Theme include cycle/depth at {path}"));
        }
        let raw = jsonc(&self.file(path)?)?;
        let object = raw.as_object().ok_or("Theme must be an object")?;
        let mut result = if let Some(include) = object.get("include") {
            let include = include.as_str().ok_or("include must be a string")?;
            self.resolve(&normalize(path, include)?)?
        } else {
            serde_json::json!({"colors": {}, "tokenColors": []})
        };
        if let Some(colors) = object.get("colors") {
            result["colors"]
                .as_object_mut()
                .ok_or("Parent colors must be an object")?
                .extend(
                    colors
                        .as_object()
                        .ok_or("colors must be an object")?
                        .clone(),
                );
        }
        if let Some(tokens) = object.get("tokenColors") {
            let tokens = if let Some(reference) = tokens.as_str() {
                let token_path = normalize(path, reference)?;
                let source = self.file(&token_path)?;
                if token_path.to_lowercase().ends_with(".tmtheme") {
                    let plist = plist::Value::from_reader_xml(source.as_bytes())
                        .map_err(|e| e.to_string())?;
                    let json = serde_json::to_value(plist).map_err(|e| e.to_string())?;
                    json.get("settings")
                        .cloned()
                        .ok_or("TextMate file needs settings")?
                } else {
                    jsonc(&source)?
                }
            } else {
                tokens.clone()
            };
            result["tokenColors"]
                .as_array_mut()
                .ok_or("Invalid parent tokens")?
                .extend(
                    tokens
                        .as_array()
                        .ok_or("External tokens must be an array")?
                        .clone(),
                );
        }
        // Keep future rendering data as data only; no scripts/fonts/CSS are imported.
        if let Some(semantic) = object.get("semanticTokenColors") {
            result["semanticTokenColors"] = semantic.clone();
        }
        self.stack.remove(path);
        Ok(result)
    }
}

pub fn build_bundle(
    manifest: &Manifest,
    mut read: impl FnMut(&Source, &str) -> Result<String, String>,
) -> Result<Bundle, String> {
    validate_manifest(manifest)?;
    let mut bundle = Bundle {
        version: 1,
        themes: Vec::new(),
        sources: BTreeMap::new(),
    };
    for source in &manifest.sources {
        let mut reader = |path: &str| read(source, path);
        let mut resolver = Resolver {
            read: &mut reader,
            files: BTreeMap::new(),
            stack: BTreeSet::new(),
        };
        let license_text = resolver.file(&normalize("", &source.license_path)?)?;
        if license_text.trim().is_empty() {
            return Err("Empty license notice".into());
        }
        for spec in &source.themes {
            let path = normalize("", &spec.path)?;
            let mut theme = resolver
                .resolve(&path)
                .map_err(|e| format!("{} / {}: {e}", source.id, spec.id))?;
            // VS Code sources occasionally use legacy white/black or inherit token values.
            // Normalize those explicitly; do not accept arbitrary CSS expressions.
            for rule in theme["tokenColors"]
                .as_array_mut()
                .ok_or("Invalid tokens")?
            {
                if let Some(settings) = rule.get_mut("settings").and_then(Value::as_object_mut) {
                    match settings.get("foreground").and_then(Value::as_str) {
                        Some("white") => {
                            settings.insert("foreground".into(), Value::String("#ffffff".into()));
                        }
                        Some("black") => {
                            settings.insert("foreground".into(), Value::String("#000000".into()));
                        }
                        Some("inherit") => {
                            settings.remove("foreground");
                        }
                        _ => {}
                    }
                }
            }
            theme["name"] = Value::String(spec.name.clone());
            theme["type"] = Value::String(spec.mode.clone());
            validate_theme(&theme).map_err(|e| format!("{}: {e}", spec.name))?;
            if serde_json::to_vec(&theme).map_err(|e| e.to_string())?.len() > FILE_LIMIT {
                return Err("Resolved theme exceeds 512 KiB".into());
            }
            bundle.themes.push(Entry {
                id: format!("catalog-{}-{}", source.id, spec.id),
                name: spec.name.clone(),
                source: source.id.clone(),
                path,
                theme,
            });
        }
        bundle.sources.insert(
            source.id.clone(),
            Provenance {
                repository: source.repository.clone(),
                revision: source.revision.clone(),
                author: source.author.clone(),
                license: source.license.clone(),
                license_text,
                files: resolver.files,
                registry: None,
            },
        );
    }
    bundle.themes.sort_by(|a, b| a.id.cmp(&b.id));
    if serde_json::to_vec(&bundle)
        .map_err(|e| e.to_string())?
        .len()
        > BUNDLE_LIMIT
    {
        return Err("Catalog exceeds 16 MiB".into());
    }
    Ok(bundle)
}

pub fn notices(bundle: &Bundle) -> String {
    let mut text = String::from(
        "# Bundled VS Code theme notices\n\nGenerated by nimrod-theme-bundler. Themes are resolved source snapshots; Nimrod adapts their UI and broad syntax colors.\n",
    );
    for (id, source) in &bundle.sources {
        let url = source
            .registry
            .as_ref()
            .map(|registry| {
                format!(
                    "https://open-vsx.org/extension/{}/{}",
                    registry.namespace, registry.name
                )
            })
            .unwrap_or_else(|| {
                format!(
                    "https://github.com/{}/tree/{}",
                    source.repository, source.revision
                )
            });
        let pin = source
            .registry
            .as_ref()
            .map(|registry| {
                format!(
                    "\nVersion: {}\n\nVSIX SHA-256: {}\n",
                    registry.version, registry.sha256
                )
            })
            .unwrap_or_default();
        text.push_str(&format!(
            "\n## {id}\n\nAuthor: {}\n\nSource: {url}\n{pin}\nLicense: {}\n\n```text\n{}```\n",
            source.author, source.license, source.license_text
        ));
    }
    // Normalize notice formatting while retaining the source license text in the catalog.
    text.lines()
        .map(str::trim_end)
        .collect::<Vec<_>>()
        .join("\n")
        + "\n"
}

#[cfg(test)]
mod tests {
    use super::*;
    fn manifest() -> Manifest {
        serde_json::from_value(serde_json::json!({"version":1,"sources":[{"id":"fixture","repository":"owner/repo","revision":"a".repeat(40),"author":"Author","license":"MIT","licensePath":"LICENSE","themes":[{"id":"dark","name":"Fixture Dark","path":"themes/dark.json","mode":"dark"}]}]})).unwrap()
    }
    fn build(files: &[(&str, &str)]) -> Result<Bundle, String> {
        build_bundle(&manifest(), |_, path| {
            files
                .iter()
                .find(|(p, _)| *p == path)
                .map(|(_, text)| text.to_string())
                .ok_or(format!("Missing {path}"))
        })
    }
    #[test]
    fn resolves_jsonc_parent_and_external_tokens_deterministically() {
        let files = [
            ("LICENSE", "MIT fixture\n"),
            (
                "themes/dark.json",
                "{\"include\":\"../base.json\",\"colors\":{\"editor.foreground\":\"#abc\",},\"tokenColors\":\"../tokens.json\"}",
            ),
            (
                "base.json",
                "{// comment\n\"colors\":{\"editor.background\":\"#123\"},\"tokenColors\":[{\"scope\":\"string\",\"settings\":{\"foreground\":\"#aaa\"}}]}",
            ),
            (
                "tokens.json",
                "[{\"scope\":\"string\",\"settings\":{\"foreground\":\"#bbb\"}}]",
            ),
        ];
        let bundle = build(&files).unwrap();
        assert_eq!(
            bundle.themes[0].theme["tokenColors"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(bundle.themes[0].theme.get("include").is_none());
        assert_eq!(bundle.sources["fixture"].files.len(), 4);
        assert_eq!(
            serde_json::to_string(&bundle).unwrap(),
            serde_json::to_string(&build(&files).unwrap()).unwrap()
        );
        assert!(notices(&bundle).contains("MIT fixture"));
    }
    #[test]
    fn rejects_paths_cycles_missing_files_bad_colors_and_unpinned_revisions() {
        for reference in ["../../bad", "/etc/passwd", "https://evil/theme", "C:\\bad"] {
            assert!(normalize("themes/a.json", reference).is_err());
        }
        assert_eq!(
            normalize("themes/a.json", "../base.json").unwrap(),
            "base.json"
        );
        assert!(
            build(&[
                ("LICENSE", "MIT"),
                ("themes/dark.json", "{\"include\":\"dark.json\"}")
            ])
            .is_err()
        );
        assert!(build(&[("LICENSE", "MIT")]).is_err());
        assert!(
            build(&[
                ("LICENSE", "MIT"),
                (
                    "themes/dark.json",
                    "{\"colors\":{\"editor.background\":\"url(evil)\"}}"
                )
            ])
            .is_err()
        );
        let mut m = manifest();
        m.sources[0].revision = "main".into();
        assert!(validate_manifest(&m).is_err());
        m = manifest();
        m.sources[0].themes[0].name = "bad\nname".into();
        assert!(validate_manifest(&m).is_err());
        assert!(jsonc("{/* unclosed").is_err());
        assert_eq!(
            jsonc("{\"url\":\"https://example/*x*/\",}").unwrap()["url"],
            "https://example/*x*/"
        );
    }
    #[test]
    fn resolves_textmate_xml_without_external_resource_loading() {
        let bundle = build(&[("LICENSE", "MIT"), ("themes/dark.json", "{\"colors\":{\"editor.background\":\"#123\"},\"tokenColors\":\"tokens.tmTheme\"}"), ("themes/tokens.tmTheme", "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict><key>settings</key><array><dict><key>scope</key><string>comment</string><key>settings</key><dict><key>foreground</key><string>#abc</string></dict></dict></array></dict></plist>")]).unwrap();
        assert_eq!(
            bundle.themes[0].theme["tokenColors"][0]["settings"]["foreground"],
            "#abc"
        );
    }
    #[test]
    fn rejects_file_size_and_empty_license() {
        assert!(build_bundle(&manifest(), |_, _| Ok("x".repeat(FILE_LIMIT + 1))).is_err());
        assert!(build(&[("LICENSE", "")]).is_err());
    }
}
