use super::*;

fn owner(cwd: PathBuf, catalog: bool) -> WireOwner {
    WireOwner {
        cwd, catalog, token: "fixture".into(),
        binding: Arc::new(Mutex::new(None)),
        metadata: Arc::new(Mutex::new(HashMap::new())),
        delete_request: Arc::new(Mutex::new(None)),
        incoming: Arc::new(Mutex::new(HashSet::new())),
        gate: Arc::new(RwLock::new(deletion::Gate::default())),
    }
}

#[test]
fn unfiltered_catalog_accepts_only_reviewed_history_or_complete_inventory_filters() {
    assert!(valid_unfiltered_list(&serde_json::json!({"sourceKinds":["cli","vscode","appServer"],"archived":false})));
    assert!(!valid_unfiltered_list(&serde_json::json!({"sourceKinds":["cli","vscode","appServer"],"archived":true})));
    assert!(!valid_unfiltered_list(&serde_json::json!({"sourceKinds":["cli","cli","appServer"],"archived":false})));
    assert!(!valid_unfiltered_list(&serde_json::json!({"sourceKinds":[],"archived":false})));
    assert!(!valid_unfiltered_list(&serde_json::json!({"cwd":"/project","sourceKinds":["cli","vscode","appServer"],"archived":false})));
}

#[tokio::test]
async fn metadata_preflight_requires_literal_project_membership_and_exact_bound_id() {
    let owner = owner(PathBuf::from("/project"), false);
    let result = |id: &str, cwd: &str| serde_json::json!({"id":1,"result":{"thread":{"id":id,"cwd":cwd,"ephemeral":false}}});
    let error = observe_record(&owner, &result("saved", "/alias")).await.unwrap_err();
    assert!(error.contains("expected /project, received /alias"));
    assert!(owner.metadata.lock().await.is_empty());
    assert!(owner.binding.lock().await.is_none());
    observe_record(&owner, &result("saved", "/project")).await.unwrap();
    assert_eq!(owner.binding.lock().await.as_deref(), Some("saved"));
    assert!(observe_record(&owner, &result("other", "/project")).await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn runtime_alias_verification_does_not_grant_saved_membership() {
    let directory = tempfile::tempdir().unwrap();
    let project = directory.path().join("project");
    std::fs::create_dir(&project).unwrap();
    let project = std::fs::canonicalize(project).unwrap();
    let alias = directory.path().join("alias");
    std::os::unix::fs::symlink(&project, &alias).unwrap();
    let owner = owner(project.clone(), false);
    let alias_reply = serde_json::json!({"id":2,"result":{"cwd":alias,"thread":{"id":"saved","cwd":alias,"ephemeral":false}}});
    assert_eq!(runtime_cwds(&owner, &alias_reply).await.unwrap(), vec![alias.to_string_lossy().to_string(); 2]);
    // Filesystem equivalence is insufficient until exact saved metadata was observed.
    assert!(observe_record(&owner, &alias_reply).await.is_err());
    observe_record(&owner, &serde_json::json!({"id":1,"result":{"thread":{"id":"saved","cwd":project,"ephemeral":false}}})).await.unwrap();
    observe_record(&owner, &alias_reply).await.unwrap();
    assert_eq!(owner.metadata.lock().await["saved"].cwd, project);
    assert!(runtime_cwds(&owner, &serde_json::json!({"result":{"cwd":"/unrelated/project"}})).await.is_err());
    assert!(runtime_cwds(&owner, &serde_json::json!({"result":{"cwd":"relative"}})).await.is_err());
}

#[test]
fn metadata_only_preflight_is_allowed_without_a_bound_conversation() {
    let gate = deletion::Gate::default();
    assert!(gate.check(false, None, "fixture", &serde_json::json!({"method":"thread/read","params":{"threadId":"saved","includeTurns":false}})).is_ok());
    assert!(gate.check(false, Some("other"), "fixture", &serde_json::json!({"method":"thread/read","params":{"threadId":"saved","includeTurns":false}})).is_err());
}
