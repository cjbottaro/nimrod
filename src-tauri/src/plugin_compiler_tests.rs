use super::*;

fn fixture() -> (tempfile::TempDir, PathBuf, Compiler) {
    let directory = tempfile::tempdir().unwrap();
    let root = directory.path().join("plugins");
    fs::create_dir(&root).unwrap();
    let compiler = Compiler::new(
        PathBuf::from(env!("NIMROD_PLUGIN_COMPILER")),
        directory.path().join("cache"),
    );
    (directory, root, compiler)
}
fn write(path: &Path, text: &str) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, text).unwrap();
}

#[test]
fn discovery_is_sorted_shallow_and_excludes_declarations_dependencies_hidden_and_symlinks() {
    let (_dir, root, _compiler) = fixture();
    for file in [
        "z.ts",
        "a.tsx",
        "types.d.ts",
        "old.js",
        ".hidden.ts",
        "package/index.ts",
        "shared/helper.ts",
        "node_modules/index.ts",
        ".hidden/index.ts",
    ] {
        write(&root.join(file), "export default {};");
    }
    assert_eq!(
        discover(&root).unwrap(),
        ["a.tsx", "package/index.ts", "z.ts"]
    );
    assert_eq!(
        discover(&root.join("missing")).unwrap(),
        Vec::<String>::new()
    );
    for entry in [
        "../outside.ts",
        "node_modules/index.ts",
        "nested/deep/index.ts",
        ".hidden.ts",
        "old.js",
        "types.d.ts",
    ] {
        assert!(resolve_entry(&root, entry).is_err());
    }
    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(root.join("z.ts"), root.join("link.ts")).unwrap();
        assert!(!discover(&root).unwrap().contains(&"link.ts".into()));
    }
}

#[tokio::test]
async fn cold_transpile_and_import_bundle_are_cached_across_managers_with_no_warm_compiler_run() {
    let (_dir, root, compiler) = fixture();
    write(
        &root.join(".helpers/value.ts"),
        "export const value: string = 'first-value';",
    );
    write(
        &root.join("plugin/index.ts"),
        "import { value } from '../.helpers/value'; const result: string = value; export default { result };",
    );
    let first = compiler.compile(&root, "plugin/index.ts").await.unwrap();
    assert!(!first.cache_hit);
    assert!(first.source.contains("first-value"));
    assert!(!first.source.contains(": string"));
    let restarted = Compiler::new(compiler.binary.clone(), compiler.cache.clone());
    let warm = restarted.compile(&root, "plugin/index.ts").await.unwrap();
    assert!(warm.cache_hit);
    assert_eq!(warm.source, first.source);
    assert_eq!(restarted.runs.load(Ordering::Relaxed), 0);
    write(
        &root.join(".helpers/value.ts"),
        "export const value: string = 'other-value';",
    );
    let edited = restarted.compile(&root, "plugin/index.ts").await.unwrap();
    assert!(!edited.cache_hit);
    assert!(edited.source.contains("other-value"));
}

#[tokio::test]
async fn new_and_removed_resolution_candidates_invalidate_cached_graph() {
    let (_dir, root, compiler) = fixture();
    write(
        &root.join("helper/index.ts"),
        "export const value = 'directory-value';",
    );
    write(
        &root.join("entry.ts"),
        "import {value} from './helper'; export default value;",
    );
    assert!(
        compiler
            .compile(&root, "entry.ts")
            .await
            .unwrap()
            .source
            .contains("directory-value")
    );
    assert!(compiler.compile(&root, "entry.ts").await.unwrap().cache_hit);
    write(
        &root.join("helper.ts"),
        "export const value = 'file-value';",
    );
    let next = compiler.compile(&root, "entry.ts").await.unwrap();
    assert!(!next.cache_hit);
    assert!(next.source.contains("file-value"));
    fs::remove_file(root.join("helper.ts")).unwrap();
    let removed = compiler.compile(&root, "entry.ts").await.unwrap();
    assert!(!removed.cache_hit);
    assert!(removed.source.contains("directory-value"));
}

#[tokio::test]
async fn installed_browser_dependency_and_package_resolution_metadata_are_fingerprinted() {
    let (_dir, root, compiler) = fixture();
    let package = root.join("node_modules/library");
    write(&package.join("package.json"), r#"{"main":"one.js"}"#);
    write(&package.join("one.js"), "export default 'module-first';");
    write(&package.join("two.js"), "export default 'module-other';");
    write(
        &root.join("entry.ts"),
        "import value from 'library'; export default value;",
    );
    assert!(
        compiler
            .compile(&root, "entry.ts")
            .await
            .unwrap()
            .source
            .contains("module-first")
    );
    assert!(compiler.compile(&root, "entry.ts").await.unwrap().cache_hit);
    write(&package.join("package.json"), r#"{"main":"two.js"}"#);
    let changed = compiler.compile(&root, "entry.ts").await.unwrap();
    assert!(!changed.cache_hit);
    assert!(changed.source.contains("module-other"));
    write(&root.join("package-lock.json"), r#"{"lockfileVersion":3}"#);
    assert!(!compiler.compile(&root, "entry.ts").await.unwrap().cache_hit);
}

#[tokio::test]
async fn corrupt_cache_identity_or_output_rebuild_and_failed_edits_never_run_stale_bundle() {
    let (_dir, root, compiler) = fixture();
    write(&root.join("entry.ts"), "export default 'valid-source';");
    compiler.compile(&root, "entry.ts").await.unwrap();
    let file = fs::read_dir(&compiler.cache)
        .unwrap()
        .next()
        .unwrap()
        .unwrap()
        .path();
    let mut record: Record = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    record.source = "tampered".into();
    fs::write(&file, serde_json::to_vec(&record).unwrap()).unwrap();
    let fresh = compiler.compile(&root, "entry.ts").await.unwrap();
    assert!(!fresh.cache_hit);
    assert!(fresh.source.contains("valid-source"));
    let mut record: Record = serde_json::from_slice(&fs::read(&file).unwrap()).unwrap();
    record.identity = "old-compiler-or-sdk".into();
    fs::write(&file, serde_json::to_vec(&record).unwrap()).unwrap();
    assert!(!compiler.compile(&root, "entry.ts").await.unwrap().cache_hit);
    fs::write(&file, "{").unwrap();
    assert!(!compiler.compile(&root, "entry.ts").await.unwrap().cache_hit);
    write(&root.join("entry.ts"), "not valid TypeScript @@@");
    assert!(compiler.compile(&root, "entry.ts").await.is_err());
}

#[tokio::test]
async fn compiler_never_evaluates_source_and_rejects_node_remote_and_additional_asset_outputs() {
    let (_dir, root, compiler) = fixture();
    write(
        &root.join("entry.ts"),
        "throw new Error('would fail if evaluated'); export default {}; ",
    );
    assert!(compiler.compile(&root, "entry.ts").await.is_ok());
    write(
        &root.join("entry.ts"),
        "import fs from 'node:fs'; export default fs;",
    );
    assert!(compiler.compile(&root, "entry.ts").await.is_err());
    write(
        &root.join("entry.ts"),
        "import value from 'https://example.test/module.js'; export default value;",
    );
    assert!(compiler.compile(&root, "entry.ts").await.is_err());
    write(&root.join("style.css"), "body { color: red; }");
    write(
        &root.join("entry.ts"),
        "import './style.css'; export default {};",
    );
    assert!(compiler.compile(&root, "entry.ts").await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn app_shutdown_stops_only_its_owned_compiler_and_observes_exit() {
    use std::os::unix::fs::PermissionsExt;
    let (directory, root, _compiler) = fixture();
    write(&root.join("entry.ts"), "export default {};");
    let helper = directory.path().join("helper.sh");
    write(
        &helper,
        "#!/bin/sh\necho $$ > started.pid\nexec /bin/sleep 30\n",
    );
    fs::set_permissions(&helper, fs::Permissions::from_mode(0o755)).unwrap();
    let compiler = Compiler::new(helper, directory.path().join("cache"));
    let task_compiler = compiler.clone();
    let task_root = root.clone();
    let task = tokio::spawn(async move { task_compiler.compile(&task_root, "entry.ts").await });
    let marker = root.join("started.pid");
    let mut published_pid = None;
    for _ in 0..200 {
        // File creation precedes echo's write; wait for the published PID,
        // not merely the transient empty marker file.
        published_pid = fs::read_to_string(&marker)
            .ok()
            .and_then(|value| value.trim().parse::<i32>().ok());
        if published_pid.is_some() {
            break;
        }
        tokio::time::sleep(Duration::from_millis(10)).await;
    }
    let pid = published_pid.expect("compiler helper did not publish its PID");
    compiler.shutdown().await;
    assert!(task.await.unwrap().unwrap_err().contains("shutdown"));
    assert!(nix::sys::signal::kill(nix::unistd::Pid::from_raw(pid), None).is_err());
}

#[tokio::test]
async fn same_entry_requests_share_atomic_cache_publication_and_missing_root_needs_no_helper() {
    let (_dir, root, compiler) = fixture();
    write(&root.join("entry.ts"), "export default 'shared';");
    let (a, b) = tokio::join!(
        compiler.compile(&root, "entry.ts"),
        compiler.compile(&root, "entry.ts")
    );
    let a = a.unwrap();
    let b = b.unwrap();
    assert_ne!(a.cache_hit, b.cache_hit);
    assert_eq!(a.source, b.source);
    let absent = Compiler::new(root.join("missing-compiler"), compiler.cache.clone())
        .load(&root.join("not-installed"))
        .await;
    assert!(absent.plugins.is_empty());
    assert!(absent.warnings.is_empty());
}
