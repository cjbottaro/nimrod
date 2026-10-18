use super::*;
use serde_json::json;

#[test]
fn bridge_records_are_not_acp_or_pi_packets() {
    assert!(validate_message(&json!({"id":"one","method":"prompt","text":"fixture"})).is_ok());
    assert!(validate_message(&json!({"id":"one","method":"connect","sessionId":"exact"})).is_ok());
    assert!(validate_message(&json!({"id":"one","method":"commands"})).is_ok());
    assert!(
        validate_message(&json!({"id":"one","method":"permission-change","value":"allow-any"}))
            .is_ok()
    );
    assert!(
        validate_message(&json!({"id":"one","method":"permission-change","value":"invented-policy"}))
            .is_err()
    );
    assert!(validate_message(&json!({"id":"one","method":"usage"})).is_ok());
    assert!(validate_message(&json!({"id":"one","method":"context"})).is_ok());
    assert!(
        validate_message(
            &json!({"id":"one","method":"command","name":"permissions","input":"show"})
        )
        .is_ok()
    );
    assert!(
        validate_message(&json!({"id":"one","method":"command","name":"/permissions"})).is_err()
    );
    assert!(
        validate_message(&json!({"id":"one","method":"command","name":"permissions show"})).is_err()
    );
    assert!(
        validate_message(
            &json!({"id":"one","method":"command","name":"permissions","input":true})
        )
        .is_err()
    );
    assert!(validate_message(&json!({"id":"one","method":"session/prompt"})).is_err());
    assert!(validate_message(&json!({"type":"prompt","message":"fixture"})).is_err());
    assert!(validate_message(&json!({"id":"one","method":"connect","sessionId":"  "})).is_err());
    assert!(
        validate_message(
            &json!({"id":"one","method":"decision","decisionId":"choice","value":true})
        )
        .is_err()
    );
}

#[test]
fn configuration_records_accept_current_setting_value_contract() {
    for (setting, value) in [
        ("model", "large"),
        ("effort", "high"),
        ("mode", "plan"),
        ("context-tier", "long_context"),
    ] {
        let message = json!({
            "id": "configuration",
            "method": "configure",
            "setting": setting,
            "value": value,
        });
        assert!(validate_message(&message).is_ok(), "{message}");
    }
}

#[test]
fn configuration_records_reject_legacy_and_malformed_payloads() {
    for payload in [
        json!({"model":"large"}),
        json!({"setting":"model","model":"large"}),
        json!({"value":"large"}),
        json!({"setting":"model"}),
        json!({"setting":null,"value":"large"}),
        json!({"setting":true,"value":"large"}),
        json!({"setting":"unsupported","value":"large"}),
        json!({"setting":"model","value":null}),
        json!({"setting":"effort","value":true}),
        json!({"setting":"mode","value":1}),
        json!({"setting":"context-tier","value":{}}),
    ] {
        let mut message = payload;
        message["id"] = json!("configuration");
        message["method"] = json!("configure");
        assert!(validate_message(&message).is_err(), "{message}");
    }
}

#[tokio::test]
async fn reload_generations_rotate_without_affecting_other_windows() {
    let host = CopilotHost::default();
    let a = host.reset_window("a").await.unwrap();
    let b = host.reset_window("b").await.unwrap();
    let newer = host.reset_window("a").await.unwrap();
    assert_ne!(a, newer);
    let state = host.windows.lock().await;
    assert_eq!(state.generations.get("a"), Some(&newer));
    assert_eq!(state.generations.get("b"), Some(&b));
}

#[tokio::test]
async fn stopping_before_spawn_retires_only_that_window_token() {
    let host = CopilotHost::default();
    host.stop_window("a", Some("late"), false).await.unwrap();
    {
        let state = host.windows.lock().await;
        assert!(state.retired.contains(&("a".into(), "late".into())));
        assert!(!state.retired.contains(&("b".into(), "late".into())));
    }
    host.reset_window("a").await.unwrap();
    assert!(host.windows.lock().await.retired.is_empty());
}

#[cfg(unix)]
#[tokio::test]
async fn owned_offline_sdk_bridge_drains_and_exits_without_a_real_cli() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let mut child = Command::new(crate::find_program("node").expect("fixture Node"))
        .args([
            "--import",
            "./test/fixtures/copilot-sdk-register.mjs",
            "copilot/bridge.mjs",
            "/fixture/copilot",
            "/fixture/project",
        ])
        .current_dir(root)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .process_group(0)
        .spawn()
        .unwrap();
    let stdin = child.stdin.take().unwrap();
    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();
    let (writer, writes) = mpsc::channel(4);
    let (stop, stopped) = oneshot::channel();
    let (output, mut packets) = mpsc::unbounded_channel();
    let task = tokio::spawn(supervise(
        child,
        stdin,
        stdout,
        stderr,
        writes,
        stopped,
        Arc::new(move |packet| output.send(packet).map_err(|error| error.to_string())),
    ));
    for (id, method) in [("init", "initialize"), ("connect", "connect")] {
        let (reply, delivered) = oneshot::channel();
        writer
            .send((json!({"id":id,"method":method}), reply))
            .await
            .unwrap();
        assert!(delivered.await.unwrap().is_ok());
        timeout(Duration::from_secs(5), async {
            loop {
                if let Some(Packet::Rpc { value }) = packets.recv().await {
                    if value["kind"] == "result" && value["id"] == id {
                        assert!(value.get("error").is_none(), "{value}");
                        break;
                    }
                } else {
                    panic!("offline SDK fixture disconnected before reply");
                }
            }
        })
        .await
        .unwrap();
    }
    stop.send(()).unwrap();
    let result = timeout(Duration::from_secs(12), task)
        .await
        .unwrap()
        .unwrap();
    if let Err(failed) = result {
        panic!("owned offline bridge did not stop: {}", failed.error);
    }
}
