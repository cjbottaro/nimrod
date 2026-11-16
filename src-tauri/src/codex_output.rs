//! Codex-only IPC envelope. Verified runtime paths are host evidence, not daemon fields.
use serde::Serialize;
use serde_json::Value;
use std::sync::Arc;
use tauri::ipc::Channel;

#[derive(Clone, Serialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub(crate) enum Packet {
    Rpc {
        value: Value,
        #[serde(rename = "runtimeCwds")]
        runtime_cwds: Vec<String>,
    },
    Disconnected { message: String },
}

#[derive(Clone)]
pub(super) struct Output {
    notify: Arc<dyn Fn(Packet) -> Result<(), String> + Send + Sync>,
}
impl Output {
    #[cfg(test)]
    pub(super) fn new(notify: impl Fn(Packet) -> Result<(), String> + Send + Sync + 'static) -> Self {
        Self { notify: Arc::new(notify) }
    }
    pub(super) fn channel(channel: Channel<Packet>) -> Self {
        Self { notify: Arc::new(move |packet| channel.send(packet).map_err(|error| error.to_string())) }
    }
    pub(super) fn notify(&self, packet: Packet) -> Result<(), String> { (self.notify)(packet) }
    pub(super) async fn send(&self, packet: Packet) -> Result<(), String> { self.notify(packet) }
}
