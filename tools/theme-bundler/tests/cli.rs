use sha2::{Digest, Sha256};
use std::{fs, process::Command};

#[test]
fn offline_cli_reproduces_and_collection_failure_preserves_existing_outputs() {
    let temp = tempfile::tempdir().unwrap();
    let cache = temp.path().join("cache");
    fs::create_dir(&cache).unwrap();
    let manifest = temp.path().join("sources.json");
    let output = temp.path().join("catalog.json");
    let notices = temp.path().join("NOTICES.md");
    let revision = "a".repeat(40);
    fs::write(&manifest, serde_json::json!({"version":1,"sources":[{"id":"fixture","repository":"owner/repo","revision":revision,"author":"Author","license":"MIT","licensePath":"LICENSE","themes":[{"id":"dark","name":"Dark","path":"dark.json","mode":"dark"}]}]}).to_string()).unwrap();
    for (path, text) in [
        ("LICENSE", "MIT fixture\n"),
        (
            "dark.json",
            "{\"colors\":{\"editor.background\":\"#123456\"},\"tokenColors\":[{\"scope\":\"string\",\"settings\":{\"foreground\":\"white\"}}]}",
        ),
    ] {
        let key = format!("owner/repo/{revision}/{path}");
        fs::write(
            cache.join(format!("{:x}", Sha256::digest(key.as_bytes()))),
            text,
        )
        .unwrap();
    }
    let run = || {
        Command::new(env!("CARGO_BIN_EXE_nimrod-theme-bundler"))
            .arg("--registry-lock")
            .arg(temp.path().join("unused-registry-lock.json"))
            .arg("--offline")
            .arg("--manifest")
            .arg(&manifest)
            .arg("--output")
            .arg(&output)
            .arg("--notices")
            .arg(&notices)
            .arg("--cache")
            .arg(&cache)
            .output()
            .unwrap()
    };
    let result = run();
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    let original = fs::read(&output).unwrap();
    let original_notices = fs::read(&notices).unwrap();
    let json: serde_json::Value = serde_json::from_slice(&original).unwrap();
    assert_eq!(
        json["themes"][0]["theme"]["tokenColors"][0]["settings"]["foreground"],
        "#ffffff"
    );
    assert!(run().status.success());
    assert_eq!(fs::read(&output).unwrap(), original);
    assert_eq!(fs::read(&notices).unwrap(), original_notices);
    fs::remove_file(cache.join(format!(
        "{:x}",
        Sha256::digest(format!("owner/repo/{revision}/dark.json").as_bytes())
    )))
    .unwrap();
    let failed = run();
    assert!(!failed.status.success());
    assert!(String::from_utf8_lossy(&failed.stderr).contains("Offline source cache miss"));
    assert_eq!(fs::read(&output).unwrap(), original);
    assert_eq!(fs::read(&notices).unwrap(), original_notices);
}
