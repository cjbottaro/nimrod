use super::*;
#[test]
fn only_codex_dialect_and_implemented_operations_cross_the_native_boundary() {
    for method in ["initialize", "thread/start", "thread/resume", "thread/list", "thread/turns/list", "thread/items/list", "turn/start", "turn/steer", "turn/interrupt", "model/list"] {
        let params = if matches!(method, "turn/start" | "turn/steer") {
            serde_json::json!({"threadId":"thread","clientUserMessageId":"message","input":[{"type":"text","text":"fixture","text_elements":[]}]})
        } else { serde_json::json!({"threadId":"thread"}) };
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":params})).is_ok());
    }
    for method in ["thread/delete", "thread/archive", "config/value/write", "command/exec", "thread/settings/update"] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":method,"params":{}})).is_err());
    }
    assert!(validate_message(&serde_json::json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{}})).is_err());
    assert!(validate_message(&serde_json::json!({"method":"initialized","params":{}})).is_ok());
    assert!(validate_message(&serde_json::json!({"id":"request","result":{"decision":"decline"}})).is_ok());
}
#[test]
fn resume_allows_only_the_reviewed_effort_override_not_arbitrary_configuration() {
    assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/resume","params":{"threadId":"thread","config":{"model_reasoning_effort":"high"}}})).is_ok());
    for config in [serde_json::json!({"approval_policy":"never"}), serde_json::json!({"model_reasoning_effort":"high","arbitrary":true}), serde_json::json!({"model_reasoning_effort":{}})] {
        assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/resume","params":{"threadId":"thread","config":config}})).is_err());
    }
    assert!(validate_message(&serde_json::json!({"id":1,"method":"thread/resume","params":{"threadId":"thread","history":[]}})).is_err());
}
