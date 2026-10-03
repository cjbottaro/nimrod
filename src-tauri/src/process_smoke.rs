use super::*;
use serde_json::json;

async fn next(rx: &mut mpsc::UnboundedReceiver<Packet>) -> Value {
    match timeout(Duration::from_secs(20), rx.recv())
        .await
        .unwrap()
        .unwrap()
    {
        Packet::Rpc { value } => value,
        packet => panic!("Unexpected {packet:?}"),
    }
}

#[tokio::test]
async fn demo_exercises_real_process_transport_streaming_steering_and_stop() {
    let host = ProcessHost::default();
    let (tx, mut rx) = mpsc::unbounded_channel();
    let mut command = Command::new(which::which("node").expect("Run tests through mise"));
    command.arg(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/demo.mjs"));
    let cwd = tempfile::tempdir().unwrap();
    host.start(
        command,
        cwd.path().to_owned(),
        "demo".into(),
        Arc::new(move |p| tx.send(p).map_err(|e| e.to_string())),
    )
    .await
    .unwrap();
    assert_eq!(next(&mut rx).await["statusKey"], "pi-gui:model-scope");
    host.write(
        "demo",
        json!({"id":"1","type":"prompt","message":"fixture"}),
    )
    .await
    .unwrap();
    assert_eq!(next(&mut rx).await["success"], true);
    let mut streamed = false;
    for _ in 0..30 {
        if next(&mut rx).await["type"] == "tool_execution_update" {
            streamed = true;
            break;
        }
    }
    assert!(streamed);
    host.write(
        "demo",
        json!({"id":"2","type":"prompt","message":"steer","streamingBehavior":"steer"}),
    )
    .await
    .unwrap();
    loop {
        let event = next(&mut rx).await;
        if event["type"] == "queue_update" {
            assert_eq!(event["steering"], json!(["steer"]));
            break;
        }
    }
    host.write("demo", json!({"id":"3","type":"clear_queue"}))
        .await
        .unwrap();
    loop {
        let event = next(&mut rx).await;
        if event["id"] == "3" {
            assert_eq!(event["data"]["steering"], json!(["steer"]));
            break;
        }
    }
    host.write("demo", json!({"id":"4","type":"abort"}))
        .await
        .unwrap();
    loop {
        if next(&mut rx).await["type"] == "agent_settled" {
            break;
        }
    }
    host.stop().await.unwrap();
}

#[tokio::test]
#[ignore = "Explicit local Pi metadata smoke only; NIMROD_TEST_PI must name the installed executable"]
async fn local_pi_metadata_only_no_models_or_user_resources() {
    let pi =
        std::env::var("NIMROD_TEST_PI").expect("Set NIMROD_TEST_PI to the installed Pi executable");
    let fixture = tempfile::tempdir().unwrap();
    let config = fixture.path().join("config");
    std::fs::create_dir(&config).unwrap();
    let bridge = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/pi-model-scope.ts");
    let mut command = Command::new(pi);
    command
        .args([
            "--mode",
            "rpc",
            "--offline",
            "--no-session",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
            "--no-context-files",
            "--extension",
        ])
        .arg(bridge)
        .env("PI_CODING_AGENT_DIR", config);
    let host = ProcessHost::default();
    let (tx, mut rx) = mpsc::unbounded_channel();
    host.start(
        command,
        fixture.path().to_owned(),
        "smoke".into(),
        Arc::new(move |p| tx.send(p).map_err(|e| e.to_string())),
    )
    .await
    .unwrap();
    // Absolutely no prompt/compact commands in this test.
    host.write("smoke", json!({"id":"state","type":"get_state"}))
        .await
        .unwrap();
    let mut saw_scope = false;
    loop {
        let event = next(&mut rx).await;
        if event["statusKey"] == "pi-gui:model-scope" {
            saw_scope = true;
        }
        if event["id"] == "state" {
            assert_eq!(event["success"], true);
            assert_eq!(event["data"]["isStreaming"], false);
            break;
        }
    }
    assert!(saw_scope, "bundled scope bridge must load");
    host.write("smoke", json!({"id":"history","type":"get_messages"}))
        .await
        .unwrap();
    loop {
        let event = next(&mut rx).await;
        if event["id"] == "history" {
            assert_eq!(event["data"]["messages"], json!([]));
            break;
        }
    }
    host.stop().await.unwrap();
}
