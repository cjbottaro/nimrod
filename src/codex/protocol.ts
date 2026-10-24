/** Reviewed consumer subset of codex-cli 0.162.0's generated app-server schema.
 * Not generated, not a complete Codex API. Unknown item variants retain native data.
 */
import { isRecord, type RpcRecord } from '../json-rpc-connection';
export type { RpcPacket as CodexPacket } from '../json-rpc-connection';
export type CodexPhase = 'new' | 'initializing' | 'ready' | 'opening' | 'idle' | 'working' | 'disconnected';
export interface CodexItem extends RpcRecord { id: string; type: string; }
export interface CodexTurn extends RpcRecord {
  id: string; status: 'inProgress' | 'completed' | 'interrupted' | 'failed'; items: CodexItem[];
  itemsView: 'notLoaded' | 'summary' | 'full';
}
export interface CodexThread extends RpcRecord {
  id: string; cwd: string; ephemeral: boolean; turns: CodexTurn[];
  status: RpcRecord & { type: 'notLoaded' | 'idle' | 'systemError' | 'active' };
}
export interface CodexPage<T> { data: T[]; nextCursor: string | null; }
export interface CodexItemEntry extends RpcRecord { turnId: string; item: CodexItem; }
export interface CodexEvent { method: string; params: RpcRecord; }
export type CodexApprovalDecision = 'accept' | 'acceptForSession' | 'decline' | 'cancel';
/** Basic approval responses; policy amendment objects are not synthesized. */
export interface CodexApproval {
  kind: 'command' | 'fileChange';
  threadId: string;
  turnId: string;
  itemId: string;
  native: Readonly<RpcRecord>;
}
export const record = (value: unknown, context: string): RpcRecord => {
  if (!isRecord(value)) throw new Error(`Invalid Codex ${context}`);
  return value;
};
export const nonempty = (value: unknown, context: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid Codex ${context}`);
  return value;
};
export function item(value: unknown): CodexItem {
  const result = record(value, 'item');
  nonempty(result.id, 'item ID'); nonempty(result.type, 'item type');
  return result as CodexItem;
}
export function turn(value: unknown): CodexTurn {
  const result = record(value, 'turn'); nonempty(result.id, 'turn ID');
  if (!['inProgress', 'completed', 'interrupted', 'failed'].includes(String(result.status)) || !Array.isArray(result.items)
    || !['notLoaded', 'summary', 'full'].includes(String(result.itemsView))) throw new Error('Invalid Codex turn');
  result.items.forEach(item);
  return result as CodexTurn;
}
export function thread(value: unknown): CodexThread {
  const result = record(value, 'thread');
  nonempty(result.id, 'thread ID'); nonempty(result.cwd, 'thread cwd');
  if (typeof result.ephemeral !== 'boolean' || !Array.isArray(result.turns)
    || !isRecord(result.status) || !['notLoaded', 'idle', 'systemError', 'active'].includes(String(result.status.type))) throw new Error('Invalid Codex thread');
  result.turns.forEach(turn);
  return result as CodexThread;
}
export function page<T>(value: unknown, decode: (value: unknown) => T): CodexPage<T> {
  const result = record(value, 'page');
  if (!Array.isArray(result.data) || result.nextCursor !== null && (typeof result.nextCursor !== 'string' || !result.nextCursor)) throw new Error('Invalid Codex page');
  return { data: result.data.map(decode), nextCursor: result.nextCursor as string | null };
}
