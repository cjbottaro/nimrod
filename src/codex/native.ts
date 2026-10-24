import { RpcWriteRejected } from '../json-rpc-connection';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { CodexPacket } from './protocol';
/** Session and catalog consumers need only this project-bound owned-process port. */
export interface CodexTransport {
  start(token: string, receive: (packet: unknown) => void, disconnected: (message: string) => void): Promise<string>;
  write(token: string, packet: CodexPacket): Promise<void>;
  stop(token: string): Promise<void>;
}
export interface CodexDeletionControl {
  reserve(token: string, operationId: string, rootId: string, threadIds: readonly string[]): Promise<void>;
  stop(token: string, operationId: string): Promise<void>;
  release(token: string, operationId: string): Promise<void>;
}
export function nativeCodexTransport(cwd: string, runtime: () => { cli?: string; generation: string }, catalog = false): CodexTransport & { deletion: CodexDeletionControl } {
  return {
    start(token, receive, disconnected) {
      const onEvent = new Channel<{ kind: 'rpc'; value: unknown } | { kind: 'disconnected'; message: string }>();
      onEvent.onmessage = packet => { if (packet.kind === 'rpc') receive(packet.value); else disconnected(packet.message); };
      return invoke('start_codex', { token, config: { cwd, catalog, ...runtime() }, onEvent });
    },
    deletion: {
      reserve: (token, operationId, rootId, threadIds) => invoke('reserve_codex_deletion', { token, operationId, rootId, threadIds }),
      stop: (token, operationId) => invoke('stop_codex_deletion', { token, operationId }),
      release: (token, operationId) => invoke('release_codex_deletion', { token, operationId }),
    },
    write: async (token, message) => {
      const rejected = await invoke<string | null>('write_codex', { token, message });
      if (typeof rejected === 'string') throw new RpcWriteRejected(rejected);
    },
    stop: async token => { await invoke('stop_codex', { token }); },
  };
}
