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

fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    stage_compiler(&PathBuf::from(
        std::env::var_os("CARGO_MANIFEST_DIR").unwrap(),
    ));
    tauri_build::build();
}
