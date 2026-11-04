use super::*;
#[test]
fn startup_discovery_uses_configured_paths_without_launching_a_harness() {
    let binary = std::env::current_exe().unwrap();
    let missing = binary.parent().unwrap().join(format!("missing-{}", uuid::Uuid::new_v4()));
    assert_eq!(codex_runtime_available(Some(binary.clone())), cfg!(unix));
    assert!(!codex_runtime_available(Some(missing.clone())));
    assert_eq!(resolve_cli(Some(binary.clone())).unwrap(), binary);
    assert!(resolve_cli(Some(missing)).is_err(), "a missing override must not fall back to an installed CLI");
}

#[tokio::test]
async fn catalog_read_records_a_hidden_saved_root_without_binding_a_conversation() {
    let owner = WireOwner {
        catalog: true, token: "catalog".into(), cwd: PathBuf::from("/fixture"),
        binding: Arc::new(Mutex::new(None)),
        metadata: Arc::new(Mutex::new(HashMap::new())),
        delete_request: Arc::new(Mutex::new(None)),
        gate: Arc::new(RwLock::new(deletion::Gate::default())),
    };
    observe_record(&owner, &serde_json::json!({"id":1,"result":{"thread":{
        "id":"hidden-root","cwd":"/fixture","ephemeral":false,"parentThreadId":null,"forkedFromId":null
    }}})).await.unwrap();
    assert!(owner.metadata.lock().await.contains_key("hidden-root"));
    assert!(owner.binding.lock().await.is_none());
}
#[test]
fn rename_requires_a_thread_and_valid_name() {
    assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/name/set","params":{"threadId":"thread","name":"Friendly name"}})).is_ok());
    for params in [serde_json::json!({"name":"Friendly name"}), serde_json::json!({"threadId":"thread","name":""}), serde_json::json!({"threadId":"thread","name":"two\nlines"})] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/name/set","params":params})).is_err());
    }
}
#[test]
fn only_codex_dialect_and_implemented_operations_cross_the_native_boundary() {
    for method in ["initialize", "thread/start", "thread/resume", "thread/list", "thread/turns/list", "thread/items/list", "turn/start", "turn/steer", "turn/interrupt", "model/list", "thread/delete"] {
        let params = if matches!(method, "turn/start" | "turn/steer") {
            serde_json::json!({"threadId":"thread","clientUserMessageId":"message","input":[{"type":"text","text":"fixture","text_elements":[]}]})
        } else { serde_json::json!({"threadId":"thread"}) };
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":params})).is_ok());
    }
    for method in ["thread/archive", "config/value/write", "command/exec", "thread/settings/update"] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":{}})).is_err());
    }
    assert!(validate_message(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})).is_err());
    assert!(validate_message(&serde_json::json!({"method":"initialized","params":{}})).is_ok());
    assert!(validate_message(&serde_json::json!({"id":"request","result":{"decision":"decline"}})).is_ok());
}
#[test]
fn command_operations_have_narrow_reviewed_parameters() {
    for (method, params) in [
        ("thread/compact/start", serde_json::json!({"threadId":"thread"})),
        ("thread/read", serde_json::json!({"threadId":"thread","includeTurns":false})),
        ("mcpServerStatus/list", serde_json::json!({"threadId":"thread","limit":100,"detail":"toolsAndAuthOnly"})),
        ("thread/backgroundTerminals/list", serde_json::json!({"threadId":"thread","limit":100})),
        ("skills/list", serde_json::json!({"cwds":["/fixture"]})),
        ("hooks/list", serde_json::json!({"cwds":["/fixture"]})),
    ] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":params})).is_ok());
        let mut extra = params.clone(); extra["arbitrary"] = serde_json::json!(true);
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":extra})).is_err());
    }
    for (method, params) in [
        ("thread/read", serde_json::json!({"threadId":"thread","includeTurns":true})),
        ("thread/compact/start", serde_json::json!({})),
        ("mcpServerStatus/list", serde_json::json!({"threadId":"thread","limit":100,"detail":"unknown"})),
        ("thread/backgroundTerminals/list", serde_json::json!({"threadId":"thread","limit":100,"cursor":""})),
        ("skills/list", serde_json::json!({"cwds":["/one","/two"]})),
    ] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":params})).is_err());
    }
}
#[test]
fn resume_allows_only_the_reviewed_effort_override_not_arbitrary_configuration() {
    assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/resume","params":{"threadId":"thread","config":{"model_reasoning_effort":"high"}}})).is_ok());
    for config in [serde_json::json!({"approval_policy":"never"}), serde_json::json!({"model_reasoning_effort":"high","arbitrary":true}), serde_json::json!({"model_reasoning_effort":{}})] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/resume","params":{"threadId":"thread","config":config}})).is_err());
    }
    assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/resume","params":{"threadId":"thread","history":[]}})).is_err());
}
