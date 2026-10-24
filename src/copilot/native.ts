import { Channel, invoke } from '@tauri-apps/api/core';
import type { BridgeRequest } from './connection';
export function copilotTransport(project: string, runtime: () => { node?: string; copilot?: string }, generation: () => string) {
  return {
    start(token: string, receive: (packet: unknown) => void, disconnected: (reason: string) => void): Promise<string> {
      const onEvent = new Channel<{ kind: 'rpc'; value: unknown } | { kind: 'disconnected'; message: string }>();
      onEvent.onmessage = packet => packet.kind === 'rpc' ? receive(packet.value) : disconnected(packet.message);
      return invoke('start_copilot', { token, config: { cwd: project, node: runtime().node, cli: runtime().copilot, generation: generation() }, onEvent });
    },
    send: (token: string, message: BridgeRequest) => invoke<void>('write_copilot', { token, message }),
    stop: (token: string) => invoke<void>('stop_copilot', { token }),
  };
}
