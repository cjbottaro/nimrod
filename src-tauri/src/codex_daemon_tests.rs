use super::*;

fn owner(catalog: bool) -> WireOwner {
    WireOwner {
        catalog, token: "fixture".into(), cwd: PathBuf::from("/fixture"),
        binding: Arc::new(Mutex::new(if catalog { None } else { Some("thread".into()) })),
        metadata: Arc::new(Mutex::new(HashMap::new())),
        delete_request: Arc::new(Mutex::new(None)), incoming: Arc::new(Mutex::new(HashSet::new())),
        gate: Arc::new(RwLock::new(deletion::Gate::default())),
    }
}
#[test]
fn lifecycle_response_requires_a_ready_absolute_socket_without_private_discovery() {
    for status in ["started", "alreadyRunning"] {
        assert_eq!(daemon_socket(serde_json::to_string(&serde_json::json!({
            "status":status,"socketPath":"/fixture/control.sock","appServerVersion":"0.169.0"
        })).unwrap().as_bytes()).unwrap(), PathBuf::from("/fixture/control.sock"));
    }
    for response in [
        serde_json::json!({"status":"stopped","socketPath":"/fixture/control.sock"}),
        serde_json::json!({"status":"started","socketPath":"relative.sock"}),
        serde_json::json!({"status":"started"}),
    ] { assert!(daemon_socket(serde_json::to_string(&response).unwrap().as_bytes()).is_err()); }
    assert!(daemon_socket(b"not JSON").is_err());
}
#[tokio::test]
async fn foreign_broadcasts_and_requests_do_not_reach_or_settle_this_client() {
    let catalog = owner(true);
    let owner = owner(false);
    for value in [
        serde_json::json!({"method":"turn/started","params":{"threadId":"foreign"}}),
        serde_json::json!({"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"foreign"}}),
        serde_json::json!({"id":8,"method":"account/login/completed","params":{}}),
    ] { assert!(!accepts(&owner, &value).await.unwrap()); }
    assert!(owner.incoming.lock().await.is_empty());
    assert!(accepts(&owner, &serde_json::json!({"id":1,"result":{}})).await.unwrap());
    assert!(accepts(&owner, &serde_json::json!({"method":"thread/started","params":{"thread":{"id":"thread"}}})).await.unwrap());
    assert!(accepts(&owner, &serde_json::json!({"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}})).await.unwrap());
    assert_eq!(owner.incoming.lock().await.len(), 1);
    assert!(accepts(&owner, &serde_json::json!({"method":"serverRequest/resolved","params":{"threadId":"thread","requestId":7}})).await.unwrap());
    assert!(owner.incoming.lock().await.is_empty());
    assert!(!accepts(&catalog, &serde_json::json!({"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}})).await.unwrap());
}
#[tokio::test]
async fn pending_native_requests_are_bounded() {
    let owner = owner(false);
    for id in 0..128 {
        assert!(accepts(&owner, &serde_json::json!({"id":id,"method":"item/tool/requestUserInput","params":{"threadId":"thread"}})).await.unwrap());
    }
    assert!(accepts(&owner, &serde_json::json!({"id":129,"method":"item/tool/requestUserInput","params":{"threadId":"thread"}})).await.is_err());
}

#[cfg(unix)]
#[tokio::test]
async fn fixture_daemon_detach_closes_only_the_client_and_never_interrupts_shared_work() {
    use std::os::unix::fs::PermissionsExt;
    use tokio::net::UnixListener;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("control.sock");
    let listener = UnixListener::bind(&path).unwrap();
    let cli = directory.path().join("codex-fixture");
    let response = serde_json::json!({"status":"alreadyRunning","socketPath":path});
    std::fs::write(&cli, format!("#!/bin/sh\n[ \"$*\" = 'app-server daemon start' ] || exit 9\nprintf '%s\\n' '{}'\n", response)).unwrap();
    std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o700)).unwrap();
    let mut owner = owner(false);
    owner.cwd = directory.path().to_path_buf();
    let (writer, writes) = mpsc::channel(32);
    let (stop, stopped) = oneshot::channel();
    let (ready, readiness) = oneshot::channel();
    let (events, mut received) = mpsc::unbounded_channel();
    let task = tokio::spawn(supervise(cli, writes, stopped, ready, Output::new(move |packet| events.send(packet).map_err(|error| error.to_string())), owner));
    let server = async {
        let (stream, _) = listener.accept().await.unwrap();
        tokio_tungstenite::accept_async(stream).await.unwrap()
    };
    let mut server = timeout(Duration::from_secs(5), server).await.unwrap();
    assert!(readiness.await.unwrap().is_ok());
    let (reply, result) = oneshot::channel();
    writer.send((serde_json::json!({"id":1,"method":"initialize","params":{}}), reply)).await.unwrap();
    assert!(matches!(server.next().await.unwrap().unwrap(), Message::Text(_)));
    assert_eq!(result.await.unwrap().unwrap(), None);
    server.send(Message::Text(serde_json::json!({"id":1,"result":{"userAgent":"fixture/0.169.0"}}).to_string().into())).await.unwrap();
    assert!(matches!(received.recv().await.unwrap(), Packet::Rpc { .. }));
    stop.send(()).unwrap();
    // The only shutdown operation on the wire is WebSocket Close, not a Codex RPC.
    assert!(matches!(timeout(Duration::from_secs(5), server.next()).await.unwrap().unwrap().unwrap(), Message::Close(_)));
    let _ = server.flush().await;
    timeout(Duration::from_secs(5), task).await.unwrap().unwrap();
    assert!(matches!(received.recv().await.unwrap(), Packet::Disconnected { .. }));
    let client = UnixStream::connect(&path).await.unwrap();
    let _second_client = listener.accept().await.unwrap();
    drop(client);
}

#[cfg(unix)]
#[tokio::test]
async fn replies_require_a_pending_request_on_the_exact_client_connection() {
    let (client, server) = UnixStream::pair().unwrap();
    let (client, server) = tokio::join!(
        client_async_with_config("ws://localhost/", client, None),
        tokio_tungstenite::accept_async(server)
    );
    let mut client = client.unwrap().0;
    let mut server = server.unwrap();
    let owner = owner(false);
    let reply = serde_json::json!({"id":7,"result":{"decision":"accept"}});
    assert!(write(&mut client, &owner, &reply).await.unwrap().is_some());
    assert!(accepts(&owner, &serde_json::json!({"id":7,"method":"item/commandExecution/requestApproval","params":{"threadId":"thread"}})).await.unwrap());
    assert_eq!(write(&mut client, &owner, &reply).await.unwrap(), None);
    assert!(matches!(server.next().await.unwrap().unwrap(), Message::Text(_)));
    assert!(write(&mut client, &owner, &reply).await.unwrap().is_some(), "replies are single-use");
}

#[cfg(unix)]
#[tokio::test]
async fn resume_cannot_cross_the_socket_before_exact_project_metadata() {
    let (client, server) = UnixStream::pair().unwrap();
    let (client, server) = tokio::join!(
        client_async_with_config("ws://localhost/", client, None),
        tokio_tungstenite::accept_async(server)
    );
    let mut client = client.unwrap().0;
    let mut server = server.unwrap();
    let owner = owner(false);
    let resume = serde_json::json!({"id":2,"method":"thread/resume","params":{"threadId":"thread","cwd":"/fixture"}});
    assert!(write(&mut client, &owner, &resume).await.unwrap().unwrap().contains("metadata read first"));
    observe_record(&owner, &serde_json::json!({"id":1,"result":{"thread":{"id":"thread","cwd":"/fixture","ephemeral":false}}})).await.unwrap();
    assert_eq!(write(&mut client, &owner, &resume).await.unwrap(), None);
    let Message::Text(text) = server.next().await.unwrap().unwrap() else { panic!("expected Resume") };
    assert_eq!(serde_json::from_str::<Value>(&text).unwrap(), resume);
}
