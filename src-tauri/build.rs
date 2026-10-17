use std::{
    fs,
    path::{Path, PathBuf},
};

fn matches_target(path: &Path, os: &str, arch: &str) -> bool {
    let Ok(bytes) = fs::read(path) else {
        return false;
    };
    if bytes.len() < 64 {
        return false;
    }
    match os {
        "macos" if bytes[..4] == [0xcf, 0xfa, 0xed, 0xfe] => {
            let cpu = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
            cpu == if arch == "aarch64" {
                0x0100_000c
            } else {
                0x0100_0007
            }
        }
        "linux" if bytes[..4] == *b"\x7fELF" => {
            let cpu = u16::from_le_bytes(bytes[18..20].try_into().unwrap());
            cpu == if arch == "aarch64" { 183 } else { 62 }
        }
        "windows" if bytes[..2] == *b"MZ" => {
            let offset = u32::from_le_bytes(bytes[60..64].try_into().unwrap()) as usize;
            let Some(machine) = bytes.get(offset + 4..offset + 6) else {
                return false;
            };
            u16::from_le_bytes(machine.try_into().unwrap())
                == if arch == "aarch64" { 0xaa64 } else { 0x8664 }
        }
        _ => false,
    }
}

fn stage_compiler(manifest: &Path) {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    assert!(
        ["aarch64", "x86_64"].contains(&arch.as_str()),
        "Install a matching esbuild helper for this target architecture"
    );
    let platform = match os.as_str() {
        "macos" => "darwin",
        "windows" => "win32",
        "linux" => "linux",
        _ => panic!("Unsupported compiler target"),
    };
    let package_arch = if arch == "aarch64" { "arm64" } else { "x64" };
    let mut found: Option<(PathBuf, PathBuf)> = None;
    for root in manifest.ancestors().skip(1) {
        let modules = root.join("node_modules");
        let package = modules.join("esbuild");
        let optional = modules.join(format!("@esbuild/{platform}-{package_arch}"));
        for binary in [
            package.join("bin/esbuild"),
            optional.join(if os == "windows" {
                "esbuild.exe"
            } else {
                "bin/esbuild"
            }),
        ] {
            if matches_target(&binary, &os, &arch) && package.join("LICENSE.md").is_file() {
                found = Some((binary, package));
                break;
            }
        }
        if found.is_some() {
            break;
        }
    }
    let (source, package) = found.expect("Missing target-native esbuild dependency: run npm ci (cross builds need the matching @esbuild target installed locally)");
    println!("cargo:rerun-if-changed={}", source.display());
    println!(
        "cargo:rerun-if-changed={}",
        package.join("package.json").display()
    );
    let directory = manifest.join("resources/plugin-compiler");
    fs::create_dir_all(&directory).unwrap();
    let target = std::env::var("TARGET").unwrap();
    let destination = directory.join(format!(
        "esbuild-{target}{}",
        if os == "windows" { ".exe" } else { "" }
    ));
    fs::copy(&source, &destination).unwrap();
    fs::copy(
        package.join("LICENSE.md"),
        directory.join("LICENSE.esbuild.txt"),
    )
    .unwrap();
    println!(
        "cargo:rustc-env=NIMROD_PLUGIN_COMPILER={}",
        destination.display()
    );
}

fn source_identity(manifest: &Path) {
    let root = manifest.parent().unwrap_or(manifest);
    let git = |args: &[&str]| {
        std::process::Command::new("git")
            .args(args)
            .current_dir(root)
            .output()
            .ok()
            .filter(|output| output.status.success())
            .and_then(|output| String::from_utf8(output.stdout).ok())
    };
    let revision = git(&["rev-parse", "HEAD"])
        .map(|value| value.trim().to_owned())
        .filter(|value| {
            matches!(value.len(), 40 | 64) && value.bytes().all(|c| c.is_ascii_hexdigit())
        })
        .unwrap_or_else(|| "unknown".into());
    let dirty = git(&["status", "--porcelain"]).map(|value| !value.is_empty());
    println!("cargo:rustc-env=NIMROD_SOURCE_REVISION={revision}");
    println!(
        "cargo:rustc-env=NIMROD_SOURCE_DIRTY={}",
        dirty
            .map(|value| value.to_string())
            .unwrap_or_else(|| "unknown".into())
    );
    let built_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    println!("cargo:rustc-env=NIMROD_BUILT_AT_MS={built_at}");
    for path in [
        "src",
        "src-tauri/src",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
        "dist",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    // Worktree .git is a file; resolve the real per-worktree HEAD/index and shared refs.
    for name in ["HEAD", "index", "refs"] {
        if let Some(path) = git(&["rev-parse", "--git-path", name]) {
            println!(
                "cargo:rerun-if-changed={}",
                root.join(path.trim()).display()
            );
        }
    }
}

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    println!("cargo:rerun-if-env-changed=APPLE_SIGNING_IDENTITY");
    let root = PathBuf::from(std::env::var_os("CARGO_MANIFEST_DIR").unwrap())
        .parent()
        .unwrap()
        .to_path_buf();
    for path in [
        "copilot/bridge.mjs",
        "scripts/prepare-copilot.mjs",
        "package-lock.json",
    ] {
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let status = std::process::Command::new("node")
        .arg(root.join("scripts/prepare-copilot.mjs"))
        .env(
            "NIMROD_COPILOT_TARGET_OS",
            std::env::var("CARGO_CFG_TARGET_OS").unwrap(),
        )
        .env(
            "NIMROD_COPILOT_TARGET_ARCH",
            std::env::var("CARGO_CFG_TARGET_ARCH").unwrap(),
        )
        .current_dir(&root)
        .status()
        .expect("Node is required to stage the bundled Copilot SDK");
    assert!(
        status.success(),
        "Could not stage the pinned Copilot SDK (run npm ci)"
    );
    source_identity(&PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").unwrap(),
    ));
    stage_compiler(&PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").unwrap(),
    ));
    tauri_build::build();
}
