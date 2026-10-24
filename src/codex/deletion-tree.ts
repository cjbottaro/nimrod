import type { CodexThread } from './protocol';
import { nonempty } from './protocol';
import { codexScope } from './session-lifecycle';
import type { DeletionReviewNode } from '../deletion-review';
import type { SessionDeletionTarget } from '../session-deletion-operation';
export const MAX_CODEX_TREE = 10_000;
export const MAX_CODEX_INVENTORY = 100_000;
export interface CodexDeletionTree {
  readonly rootId: string;
  readonly ids: readonly string[];
  readonly review: DeletionReviewNode[];
  readonly targets: readonly SessionDeletionTarget[];
}
/** The deletion API follows spawned-parent lineage, never tree-wide sessionId or fork history. */
export function codexDeletionTree(cwd: string, rootId: string, inventory: readonly CodexThread[]): CodexDeletionTree {
  nonempty(rootId, 'deletion root');
  if (inventory.length > MAX_CODEX_INVENTORY) throw new Error('Codex deletion inventory exceeds 100,000 threads');
  const threads = new Map<string, CodexThread>(), children = new Map<string, CodexThread[]>();
  for (const thread of inventory) {
    for (const field of ['parentThreadId', 'forkedFromId'] as const) {
      if (thread[field] !== null) nonempty(thread[field], `deletion ${field}`);
    }
    const existing = threads.get(thread.id);
    if (existing) {
      if (existing.cwd !== thread.cwd || existing.parentThreadId !== thread.parentThreadId || existing.forkedFromId !== thread.forkedFromId || existing.ephemeral !== thread.ephemeral)
        throw new Error('Codex deletion inventory changed lineage during discovery. Refresh before deleting.');
      continue;
    }
    threads.set(thread.id, thread);
    if (typeof thread.parentThreadId === 'string') {
      const siblings = children.get(thread.parentThreadId);
      if (siblings) siblings.push(thread); else children.set(thread.parentThreadId, [thread]);
    }
  }
  for (const node of threads.values()) if (typeof node.parentThreadId === 'string' && !threads.has(node.parentThreadId))
    throw new Error('Codex inventory has incomplete spawned lineage. The deletion scope cannot be established.');
  const root = threads.get(rootId);
  if (!root || root.ephemeral || root.cwd !== cwd) throw new Error('Codex deletion requires an existing persisted thread in this exact project');
  const found: CodexThread[] = [], seen = new Set<string>(), queue = [root];
  for (let index = 0; index < queue.length; index++) {
    const node = queue[index];
    if (seen.has(node.id)) throw new Error('Codex deletion tree has cyclic spawned lineage');
    if (node.cwd !== cwd) throw new Error('Codex descendants span project directories. Cross-project tree deletion is not implemented; nothing was deleted.');
    if (node.ephemeral) throw new Error('Codex reported an ephemeral descendant in persisted deletion history');
    seen.add(node.id); found.push(node);
    if (found.length > MAX_CODEX_TREE) throw new Error('Codex deletion tree exceeds 10,000 threads');
    const descendants = children.get(node.id) || [];
    if (queue.length + descendants.length > MAX_CODEX_TREE) throw new Error('Codex deletion tree exceeds 10,000 threads');
    queue.push(...descendants);
  }
  for (const node of threads.values()) if (!seen.has(node.id) && typeof node.forkedFromId === 'string' && seen.has(node.forkedFromId))
    throw new Error('Codex history includes a fork whose deletion relationship is not verified. Tree deletion is unavailable rather than guessing its scope.');
  return { rootId, ids: found.map(node => node.id),
    review: found.map(node => ({ key: codexScope(node.id), parentKey: node.id === rootId ? null : codexScope(node.parentThreadId as string),
      title: typeof node.name === 'string' && node.name.trim() ? node.name : typeof node.preview === 'string' && node.preview.trim() ? node.preview.slice(0, 100) : node.id, cwd: node.cwd })),
    targets: found.map(node => ({ key: codexScope(node.id), draftScope: codexScope(node.id) })),
  };
}
