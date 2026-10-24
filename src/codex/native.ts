import { Channel, invoke } from '@tauri-apps/api/core';
import type { CodexPacket } from './protocol';
/** Session and catalog consumers need only this project-bound owned-process port. */
export interface CodexTransport {
  start(token: string, receive: (packet: unknown) => void, disconnected: (message: string) => void): Promise<string>;
  write(token: string, packet: CodexPacket): Promise<void>;
  stop(token: string): Promise<void>;
}
export function nativeCodexTransport(cwd: string, runtime: () => { cli?: string; generation: string }): CodexTransport {
  return {
    start(token, receive, disconnected) {
      const onEvent = new Channel<{ kind: 'rpc'; value: unknown } | { kind: 'disconnected'; message: string }>();
      onEvent.onmessage = packet => { if (packet.kind === 'rpc') receive(packet.value); else disconnected(packet.message); };
      return invoke('start_codex', { token, config: { cwd, ...runtime() }, onEvent });
    },
    write: (token, message) => invoke('write_codex', { token, message }),
    stop: async token => { await invoke('stop_codex', { token }); },
  };
}
