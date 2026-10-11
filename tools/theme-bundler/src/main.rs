use nimrod_theme_bundler::{FILE_LIMIT, Manifest, build_bundle, notices};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::{Read, Write},
    path::PathBuf,
    time::Duration,
};

fn run() -> Result<(), String> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut manifest = root.join("tools/theme-bundler/sources.json");
    let mut output = root.join("src/themes/catalog.json");
    let mut notice_path = root.join("THEME_CATALOG_NOTICES.md");
    let mut cache = root.join(".theme-source-cache");
    let mut offline = false;
    let mut discover = false;
    let mut registry_lock = root.join("tools/theme-bundler/open-vsx.lock.json");
    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--offline" => offline = true,
            "--discover" => discover = true,
            "--registry-lock" => {
                registry_lock = PathBuf::from(args.next().ok_or("Expected registry lock path")?)
            }
            "--manifest" | "--output" | "--notices" | "--cache" => {
                let value = PathBuf::from(args.next().ok_or("Expected path after option")?);
                match arg.as_str() {
                    "--manifest" => manifest = value,
                    "--output" => output = value,
                    "--notices" => notice_path = value,
                    _ => cache = value,
                }
            }
            "--help" => {
                println!(
                    "nimrod-theme-bundler [--discover | --offline] [--registry-lock PATH] [--manifest PATH] [--output PATH] [--notices PATH] [--cache PATH]\nExplicit maintenance tool; never run by normal builds. Edit pinned sources.json to update revisions/add themes.\n--offline reads only previously cached pinned source files."
                );
                return Ok(());
            }
            _ => return Err(format!("Unknown option: {arg}")),
        }
    }
    if output == notice_path {
        return Err("Catalog and notices paths must differ".into());
    }
    if discover {
        if offline {
            return Err("Discovery requires network; omit --offline".into());
        }
        let lock = nimrod_theme_bundler::open_vsx::RegistryClient::new()?.discover(&cache)?;
        let text = serde_json::to_string_pretty(&lock).map_err(|e| e.to_string())? + "\n";
        let parent = registry_lock
            .parent()
            .ok_or("Lock needs parent directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.persist(&registry_lock).map_err(|e| e.to_string())?;
        println!(
            "Wrote Open VSX lock: {}. Run themes-update to bundle it.",
            registry_lock.display()
        );
        return Ok(());
    }
    let manifest: Manifest =
        serde_json::from_slice(&fs::read(&manifest).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::none())
        .user_agent("Nimrod theme bundle maintenance")
        .build()
        .map_err(|e| e.to_string())?;
    let mut fetched = BTreeMap::<String, String>::new();
    let mut bundle = build_bundle(&manifest, |source, path| {
        let key = format!("{}/{}/{path}", source.repository, source.revision);
        if let Some(text) = fetched.get(&key) {
            return Ok(text.clone());
        }
        let cache_file = cache.join(format!("{:x}", Sha256::digest(key.as_bytes())));
        let text = if cache_file.is_file() {
            if fs::metadata(&cache_file).map_err(|e| e.to_string())?.len() > FILE_LIMIT as u64 {
                return Err("Cached source exceeds 512 KiB".into());
            }
            fs::read_to_string(&cache_file).map_err(|e| e.to_string())?
        } else {
            if offline {
                return Err(format!("Offline source cache miss: {key}"));
            }
            eprintln!("Fetching {key}");
            let mut url = reqwest::Url::parse(&format!(
                "https://raw.githubusercontent.com/{}/{}/",
                source.repository, source.revision
            ))
            .map_err(|e| e.to_string())?;
            url.path_segments_mut()
                .map_err(|_| "Invalid raw URL")?
                .pop_if_empty()
                .extend(path.split('/'));
            let response = client
                .get(url)
                .send()
                .and_then(|r| r.error_for_status())
                .map_err(|e| format!("{key}: {e}"))?;
            let mut bytes = Vec::new();
            response
                .take(FILE_LIMIT as u64 + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if bytes.len() > FILE_LIMIT {
                return Err(format!("{key} exceeds 512 KiB"));
            }
            let text = String::from_utf8(bytes).map_err(|e| e.to_string())?;
            fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
            fs::write(&cache_file, &text).map_err(|e| e.to_string())?;
            text
        };
        fetched.insert(key, text.clone());
        Ok(text)
    })?;
    if registry_lock.is_file() {
        let lock: nimrod_theme_bundler::open_vsx::Lock =
            serde_json::from_slice(&fs::read(&registry_lock).map_err(|e| e.to_string())?)
                .map_err(|e| e.to_string())?;
        let registry = nimrod_theme_bundler::open_vsx::RegistryClient::new()?;
        nimrod_theme_bundler::open_vsx::append_locked(&mut bundle, &lock, |package| {
            registry.package_bytes(package, &cache, offline)
        })?;
    }
    let json = serde_json::to_string_pretty(&bundle).map_err(|e| e.to_string())? + "\n";
    let notices = notices(&bundle);
    // All collection/resolution/validation succeeds before either output is replaced.
    let prepare = |path: &PathBuf, text: &str| -> Result<tempfile::NamedTempFile, String> {
        let parent = path.parent().ok_or("Output needs a parent directory")?;
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let mut file = tempfile::NamedTempFile::new_in(parent).map_err(|e| e.to_string())?;
        file.write_all(text.as_bytes()).map_err(|e| e.to_string())?;
        file.as_file().sync_all().map_err(|e| e.to_string())?;
        Ok(file)
    };
    let json_file = prepare(&output, &json)?;
    let notice_file = prepare(&notice_path, &notices)?;
    notice_file
        .persist(&notice_path)
        .map_err(|e| e.to_string())?;
    json_file.persist(&output).map_err(|e| e.to_string())?;
    println!(
        "Bundled {} themes from {} pinned sources ({} bytes).\nCatalog: {}\nNotices: {}",
        bundle.themes.len(),
        bundle.sources.len(),
        json.len(),
        output.display(),
        notice_path.display()
    );
    Ok(())
}
fn main() {
    if let Err(error) = run() {
        eprintln!(
            "Theme bundling failed: {error}. Collection failures preserve existing outputs; review both output files if replacement failed."
        );
        std::process::exit(1);
    }
}
