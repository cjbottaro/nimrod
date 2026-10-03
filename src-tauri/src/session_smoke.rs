//! Opt-in installed-Pi checks. All files/resources are isolated; no model commands.
use crate::{
    process::{Packet, ProcessHost},
    sessions,
};
use serde_json::{Value, json};
use std::{
    path::{Path, PathBuf},
    sync::Arc,
    time::Duration,
};
use tokio::{process::Command, sync::mpsc, time::timeout};

fn command(pi: &str, root: &Path) -> Command {
    let mut command = Command::new(pi);
    command
        .args([
            "--mode",
            "rpc",
            "--offline",
            "--no-extensions",
            "--no-skills",
            "--no-prompt-templates",
            "--no-themes",
            "--no-context-files",
            "--session-dir",
        ])
        .arg(root.join("sessions"))
        .env("PI_CODING_AGENT_DIR", root.join("config"));
    command
}

async fn request(
    host: &ProcessHost,
    rx: &mut mpsc::UnboundedReceiver<Packet>,
    message: Value,
) -> Value {
    let id = message["id"].clone();
    host.write("smoke", message).await.unwrap();
    loop {
        match timeout(Duration::from_secs(20), rx.recv())
            .await
            .unwrap()
            .unwrap()
        {
            Packet::Rpc { value } if value["id"] == id => {
                assert_eq!(value["success"], true, "{value}");
                return value["data"].clone();
            }
            Packet::Rpc { .. } => {}
            other => panic!("Unexpected {other:?}"),
        }
    }
}

async fn start(
    host: &ProcessHost,
    command: Command,
    cwd: &Path,
) -> mpsc::UnboundedReceiver<Packet> {
    let (tx, rx) = mpsc::unbounded_channel();
    host.start(
        command,
        cwd.to_owned(),
        "smoke".into(),
        Arc::new(move |packet| tx.send(packet).map_err(|e| e.to_string())),
    )
    .await
    .unwrap();
    rx
}

#[tokio::test]
#[ignore = "Explicit isolated Pi persistence smoke; NIMROD_TEST_PI names installed executable"]
async fn local_pi_saved_and_exact_resume_without_models() {
    let pi = std::env::var("NIMROD_TEST_PI").expect("Set NIMROD_TEST_PI");
    let fixture = tempfile::tempdir().unwrap();
    let root = fixture.path().canonicalize().unwrap();
    std::fs::create_dir(root.join("config")).unwrap();
    let host = ProcessHost::default();
    let mut rx = start(&host, command(&pi, &root), &root).await;
    let state = request(&host, &mut rx, json!({"id":"state", "type":"get_state"})).await;
    let path = PathBuf::from(
        state["sessionFile"]
            .as_str()
            .expect("saved launch has a Pi file identity"),
    );
    let id = state["sessionId"].as_str().unwrap();
    assert!(path.starts_with(root.join("sessions")));
    assert!(
        !path.exists(),
        "Empty new Pi sessions have not been flushed yet"
    );
    assert!(!sessions::reported_file(&path, &root, id).unwrap().exists);
    let history = request(
        &host,
        &mut rx,
        json!({"id":"history", "type":"get_messages"}),
    )
    .await;
    assert_eq!(history["messages"], json!([]));
    host.stop().await.unwrap();

    // Seed only this test's file. No prompt or provider request is used to generate history.
    let entries = [
        json!({"type":"session", "version":3, "id":id, "timestamp":"2026-01-01T00:00:00.000Z", "cwd":root}),
        json!({"type":"message", "id":"user0001", "parentId":null, "timestamp":"2026-01-01T00:00:01.000Z", "message":{"role":"user", "content":"fixture history", "timestamp":1}}),
        json!({"type":"message", "id":"asst0001", "parentId":"user0001", "timestamp":"2026-01-01T00:00:02.000Z", "message":{"role":"assistant", "content":[{"type":"text", "text":"offline fixture answer"}], "api":"openai-responses", "provider":"openai", "model":"fixture", "usage":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"totalTokens":0,"cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}}, "stopReason":"stop", "timestamp":2}}),
    ];
    let contents = entries.iter().map(|e| format!("{e}\n")).collect::<String>();
    std::fs::write(&path, contents).unwrap();
    let selected = sessions::inspect(&path, &root).unwrap();
    for round in 0..2 {
        let mut cmd = command(&pi, &root);
        sessions::launch_args(
            &mut cmd,
            sessions::LaunchMode::Resume,
            Some(&selected),
            None,
        );
        let mut rx = start(&host, cmd, &root).await;
        let state = request(&host, &mut rx, json!({"id":"state", "type":"get_state"})).await;
        assert_eq!(state["sessionFile"], path.to_str().unwrap());
        assert_eq!(state["sessionId"], id);
        if round == 1 {
            assert_eq!(state["sessionName"], "fixture persisted name");
        }
        let history = request(
            &host,
            &mut rx,
            json!({"id":"history", "type":"get_messages"}),
        )
        .await;
        assert_eq!(history["messages"][0]["content"], "fixture history");
        assert_eq!(
            history["messages"][1]["content"][0]["text"],
            "offline fixture answer"
        );
        if round == 0 {
            request(
                &host,
                &mut rx,
                json!({"id":"name", "type":"set_session_name", "name":"fixture persisted name"}),
            )
            .await;
        }
        host.stop().await.unwrap();
    }
    assert!(
        std::fs::read_to_string(&path)
            .unwrap()
            .contains("fixture persisted name")
    );
}
