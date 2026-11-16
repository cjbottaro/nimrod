import { RpcWriteRejected } from '../json-rpc-connection';
import { Channel, invoke } from '@tauri-apps/api/core';
import type { CodexPacket } from './protocol';
/** Session and catalog consumers need only this project-bound owned-client port.
 * start discovers/starts Codex's managed daemon and connects; stop detaches this token only.
 */
export interface CodexTransport {
  start(token: string, receive: (packet: unknown) => void, disconnected: (message: string) => void): Promise<string>;
  write(token: string, packet: CodexPacket): Promise<void>;
  runtimeCwdMatches?(token: string, actual: string, project: string): boolean;
  stop(token: string): Promise<void>;
}
export interface CodexDeletionControl {
  reserve(token: string, operationId: string, rootId: string, threadIds: readonly string[], localOnly?: boolean): Promise<void>;
  stop(token: string, operationId: string): Promise<void>;
  release(token: string, operationId: string): Promise<void>;
}
export function nativeCodexTransport(cwd: string, runtime: () => { cli?: string; generation: string }, catalog = false): CodexTransport & { deletion: CodexDeletionControl } {
  const runtimePaths = new Map<string, Set<string>>();
  return {
    runtimeCwdMatches: (token, actual, project) => project === cwd && runtimePaths.get(token)?.has(actual) === true,
    start(token, receive, disconnected) {
      const paths = new Set([cwd]); runtimePaths.set(token, paths);
      const onEvent = new Channel<{ kind: 'rpc'; value: unknown; runtimeCwds?: string[] } | { kind: 'disconnected'; message: string }>();
      onEvent.onmessage = packet => {
        if (packet.kind === 'rpc') {
          // Host-only envelope, never a field trusted from daemon JSON. Publish
          // verification synchronously before the matching ordered RPC record.
          paths.clear(); paths.add(cwd);
          for (const path of packet.runtimeCwds ?? []) paths.add(path);
          receive(packet.value);
        } else disconnected(packet.message);
      };
      return invoke('start_codex', { token, config: { cwd, catalog, ...runtime() }, onEvent });
    },
    deletion: {
      reserve: (token, operationId, rootId, threadIds, localOnly = false) => invoke('reserve_codex_deletion', { token, operationId, rootId, threadIds, localOnly }),
      stop: (token, operationId) => invoke('stop_codex_deletion', { token, operationId }),
      release: (token, operationId) => invoke('release_codex_deletion', { token, operationId }),
    },
    write: async (token, message) => {
      const rejected = await invoke<string | null>('write_codex', { token, message });
      if (typeof rejected === 'string') throw new RpcWriteRejected(rejected);
    },
    stop: async token => { await invoke('stop_codex', { token }); runtimePaths.delete(token); },
  };
}
