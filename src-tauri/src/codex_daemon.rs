//! Native Codex control-socket transport. Lifecycle CLI owns daemon discovery/start;
//! Nimrod owns only each client socket, never the server's PID or process group.
use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct DaemonStart {
    status: String,
    socket_path: PathBuf,
}
fn daemon_socket(bytes: &[u8]) -> Result<PathBuf, String> {
    let result: DaemonStart = serde_json::from_slice(bytes)
        .map_err(|error| format!("Invalid Codex daemon start response: {error}"))?;
    if !matches!(result.status.as_str(), "started" | "alreadyRunning")
        || !result.socket_path.is_absolute()
    {
        return Err("Codex daemon did not return a ready local socket".into());
    }
    Ok(result.socket_path)
}

#[cfg(unix)]
use {
    futures_util::{SinkExt, StreamExt},
    std::process::Stdio,
    tokio::{io::AsyncReadExt, net::UnixStream, process::Command, time::timeout},
    tokio_tungstenite::{WebSocketStream, client_async_with_config, tungstenite::{Message, protocol::WebSocketConfig}},
};
#[cfg(unix)]
type Socket = WebSocketStream<UnixStream>;

#[cfg(unix)]
async fn read_setup(pipe: impl tokio::io::AsyncRead + Unpin) -> Result<Vec<u8>, String> {
    let mut bytes = Vec::new();
    pipe.take(64 * 1024 + 1).read_to_end(&mut bytes).await.map_err(|error| error.to_string())?;
    if bytes.len() > 64 * 1024 { return Err("Codex daemon setup output exceeds 64 KiB".into()); }
    Ok(bytes)
}
#[cfg(unix)]
async fn connect(cli: &PathBuf, cwd: &PathBuf, stop: &mut oneshot::Receiver<()>) -> Result<Socket, String> {
    if !matches!(stop.try_recv(), Err(oneshot::error::TryRecvError::Empty)) {
        return Err("Codex connection detached before setup".into());
    }
    let mut command = Command::new(cli);
    command.args(["app-server", "daemon", "start"]).current_dir(cwd)
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    let mut paths = Vec::new();
    if let Some(path) = cli.parent() { paths.push(path.to_path_buf()); }
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    command.env("PATH", std::env::join_paths(paths).map_err(|error| error.to_string())?);
    let mut child = command.spawn().map_err(|error| format!("Could not start Codex daemon client: {error}"))?;
    let stdout = child.stdout.take().ok_or("Missing Codex daemon setup stdout")?;
    let stderr = child.stderr.take().ok_or("Missing Codex daemon setup stderr")?;
    let result = tokio::select! {
        biased;
        _ = &mut *stop => Err("Codex connection detached during setup".to_owned()),
        result = timeout(Duration::from_secs(30), async {
            tokio::try_join!(
                async { child.wait().await.map_err(|error| error.to_string()) },
                read_setup(stdout), read_setup(stderr)
            )
        }) => result.unwrap_or_else(|_| Err("Codex daemon setup timed out; the shared daemon was not stopped".into())),
    };
    let (status, stdout, stderr) = match result {
        Ok(result) => result,
        Err(error) => {
            // kill() observes exit of only our short-lived CLI command. Never signal a group.
            if let Err(cleanup) = child.kill().await { return Err(format!("{error}; Codex setup client cleanup failed: {cleanup}")); }
            return Err(error);
        }
    };
    if !status.success() {
        return Err(format!("Codex shared daemon is unavailable: {}", String::from_utf8_lossy(&stderr).trim()));
    }
    let path = daemon_socket(&stdout)?;
    let handshake = timeout(Duration::from_secs(5), async {
        let stream = UnixStream::connect(&path).await.map_err(|error| format!("Could not connect to Codex daemon {}: {error}", path.display()))?;
        let config = WebSocketConfig::default().max_message_size(Some(MAX_RECORD)).max_frame_size(Some(MAX_RECORD));
        // Plain native JSON text frames. No TLS, compression negotiation, private state lookup,
        // remote listener, or fallback to an independent writer on connection failure.
        let (socket, _) = client_async_with_config("ws://localhost/", stream, Some(config)).await
            .map_err(|error| format!("Could not open Codex daemon control socket: {error}"))?;
        Ok(socket)
    });
    tokio::select! {
        biased;
        _ = &mut *stop => Err("Codex connection detached during handshake".into()),
        result = handshake => result.map_err(|_| "Codex daemon control-socket handshake timed out".to_owned())?,
    }
}

/// Filter broadcasts before they consume the frontend's pre-identity buffer.
/// Foreign/global requests must not be rejected: another client may own their callback.
async fn accepts(owner: &WireOwner, value: &Value) -> Result<bool, String> {
    if !value.is_object() || value.get("jsonrpc").is_some() {
        return Err("Invalid Codex daemon record".into());
    }
    if value.get("method").is_none() { return Ok(true); }
    let params = &value["params"];
    let thread = params["threadId"].as_str().or_else(|| params["thread"]["id"].as_str());
    let is_request = value.get("id").is_some();
    if is_request {
        if owner.catalog || thread.is_none() || thread != owner.binding.lock().await.as_deref() { return Ok(false); }
        let id = serde_json::to_string(&value["id"]).map_err(|error| error.to_string())?;
        let mut incoming = owner.incoming.lock().await;
        if incoming.len() >= 128 && !incoming.contains(&id) { return Err("Codex pending request limit exceeded".into()); }
        incoming.insert(id);
    } else if !owner.catalog {
        if thread.is_none() || thread != owner.binding.lock().await.as_deref() { return Ok(false); }
        if value["method"] == "serverRequest/resolved" {
            owner.incoming.lock().await.remove(&serde_json::to_string(&params["requestId"]).map_err(|error| error.to_string())?);
        }
    }
    Ok(true)
}

#[cfg(unix)]
async fn write(socket: &mut Socket, owner: &WireOwner, value: &Value) -> Result<Option<String>, String> {
    // Keep the native read lease through the bounded write, as with the old pipe transport.
    let gate = owner.gate.read().await;
    let mut binding = owner.binding.lock().await;
    if let Err(error) = gate.check(owner.catalog, binding.as_deref(), &owner.token, value) { return Ok(Some(error)); }
    if value.get("method").is_none() {
        let id = serde_json::to_string(&value["id"]).map_err(|error| error.to_string())?;
        if !owner.incoming.lock().await.remove(&id) { return Ok(Some("Codex reply has no pending request on this connection".into())); }
    }
    if value["method"] == "thread/delete" {
        let metadata = owner.metadata.lock().await;
        if let Err(error) = gate.validate_deletion(&metadata, &owner.cwd) { return Ok(Some(error)); }
    }
    if !owner.catalog {
        if let Some(id) = value["params"]["threadId"].as_str() {
            if binding.as_ref().is_some_and(|current| current != id) { return Err("Codex connection changed its bound thread".into()); }
            *binding = Some(id.into());
        }
    }
    drop(binding);
    if owner.catalog && value["method"] == "thread/list" && value["params"]["archived"] == false
        && value["params"]["sourceKinds"].as_array().is_some_and(|kinds| kinds.len() == 10)
        && value["params"].get("cwd").is_none() && value["params"].get("cursor").is_none() {
        owner.metadata.lock().await.clear();
    }
    if value["method"] == "thread/delete" {
        let mut pending = owner.delete_request.lock().await;
        if pending.is_some() { return Ok(Some("A Codex deletion is already in flight".into())); }
        *pending = Some(value["id"].clone());
    }
    let text = serde_json::to_string(value).map_err(|error| error.to_string())?;
    match timeout(Duration::from_secs(5), socket.send(Message::Text(text.into()))).await {
        Ok(Ok(())) => Ok(None),
        Ok(Err(error)) => Err(format!("Codex daemon write failed; delivery is unknown: {error}")),
        Err(_) => Err("Codex daemon write timed out; delivery is unknown".into()),
    }
}

#[cfg(unix)]
async fn run(socket: &mut Socket, writes: &mut mpsc::Receiver<Write>, stop: &mut oneshot::Receiver<()>, output: &Output, owner: &WireOwner) -> String {
    loop {
        tokio::select! {
            _ = &mut *stop => return "Codex connection detached by Nimrod".into(),
            packet = socket.next() => {
                let value = match packet {
                    Some(Ok(Message::Text(text))) => match serde_json::from_str::<Value>(&text) {
                        Ok(value) => value,
                        Err(error) => return format!("Invalid Codex daemon JSON: {error}"),
                    },
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
                    Some(Ok(Message::Close(_))) | None => return "Codex shared daemon disconnected. Resume explicitly to reconnect; nothing was replayed.".into(),
                    Some(Ok(_)) => return "Unsupported Codex daemon frame".into(),
                    Some(Err(error)) => return format!("Codex daemon transport failed: {error}"),
                };
                let accepted = tokio::select! {
                    _ = &mut *stop => return "Codex connection detached by Nimrod".into(),
                    result = async {
                        if !accepts(owner, &value).await? { return Ok(false); }
                        observe_record(owner, &value).await?;
                        Ok::<_, String>(true)
                    } => result,
                };
                match accepted { Ok(false) => continue, Err(error) => return error, Ok(true) => {} }
                tokio::select! {
                    _ = &mut *stop => return "Codex connection detached by Nimrod".into(),
                    result = output.send(Packet::Rpc { value }) => if result.is_err() { return "Codex frontend disconnected".into(); },
                }
            },
            packet = writes.recv() => {
                let Some((value, reply)) = packet else { return "Codex connection writer closed".into(); };
                let result = tokio::select! {
                    _ = &mut *stop => { let _ = reply.send(Err("Codex connection detached; delivery is unknown".into())); return "Codex connection detached by Nimrod".into(); },
                    result = write(socket, owner, &value) => result,
                };
                let error = result.as_ref().err().cloned();
                let _ = reply.send(result);
                if let Some(error) = error { return error; }
            },
        }
    }
}

pub(super) async fn supervise(cli: PathBuf, mut writes: mpsc::Receiver<Write>, mut stop: oneshot::Receiver<()>, ready: oneshot::Sender<Result<(), String>>, output: Output, owner: WireOwner) {
    #[cfg(unix)]
    let message = {
        let connected = connect(&cli, &owner.cwd, &mut stop).await;
        match connected {
            Err(error) => { let _ = ready.send(Err(error.clone())); error },
            Ok(mut socket) => {
                let _ = ready.send(Ok(()));
                let reason = run(&mut socket, &mut writes, &mut stop, &output, &owner).await;
                // A bounded close handshake then dropping the socket releases only this client.
                // Do not interrupt turns, answer pending approvals, or invoke daemon stop/restart.
                let _ = timeout(Duration::from_secs(2), async {
                    socket.close(None).await?;
                    while let Some(packet) = socket.next().await {
                        if matches!(packet?, Message::Close(_)) { break; }
                    }
                    Ok::<_, tokio_tungstenite::tungstenite::Error>(())
                }).await;
                drop(socket);
                reason
            }
        }
    };
    #[cfg(not(unix))]
    let message = {
        let _ = (cli, &mut writes, &mut stop, owner);
        let error = "Codex daemon connections currently support macOS and Linux only".to_owned();
        let _ = ready.send(Err(error.clone())); error
    };
    drop(writes);
    let _ = output.notify(Packet::Disconnected { message });
}

#[cfg(test)]
#[path = "codex_daemon_tests.rs"]
mod tests;
