import assert from 'node:assert/strict';
import test from 'node:test';
import { codexDeletionTree } from '../src/codex/deletion-tree';
import { codexSessionDeletion, type CodexDeletionHistory } from '../src/codex/session-deletion';
import { codexScope } from '../src/codex/session-lifecycle';
import { CodexClient } from '../src/codex/client';
import type { CodexPacket, CodexThread } from '../src/codex/protocol';
import type { SessionDeletionContext } from '../src/session-deletion-operation';
import type { DeletionReviewData } from '../src/deletion-review';
const cwd = '/fixture/codex';
function thread(id: string, parentThreadId: string | null = null, directory = cwd): CodexThread {
  return { id, cwd: directory, ephemeral: false, turns: [], status: { type: 'notLoaded' }, parentThreadId, forkedFromId: null, name: id };
}
const base = [thread('root'), thread('child', 'root')];
function fixture(options: { confirm?: boolean; previews?: CodexThread[][]; removeError?: boolean; stopError?: boolean } = {}) {
  const events: string[] = [], removed: string[] = [], reviews: DeletionReviewData[] = [];
  const abort = new AbortController(); let preview = 0;
  const context: SessionDeletionContext = {
    signal: abort.signal, changed() {}, loadingReview: () => { events.push('loading'); },
    review: async data => { reviews.push(data); events.push('review'); return options.confirm !== false; },
    progress: phase => { events.push(phase); }, closeReview() {},
    lock: (targets, executing) => { events.push(`lock:${executing}:${targets.map(target => target.key).join(',')}`); },
    stop: async targets => { events.push(`stop:${targets.length}`); if (options.stopError) throw new Error('Owned stop failed'); },
    removed: targets => { removed.push(...targets.map(target => target.key)); }, recovered() {}, error: message => { events.push(`error:${message}`); },
  };
  const history: CodexDeletionHistory = {
    supportsDeletion: true,
    previewTree: async id => { events.push('preview'); const pages = options.previews ?? [base]; return codexDeletionTree(cwd, id, pages[Math.min(preview++, pages.length - 1)]); },
    reserveDeletion: async (_operation, _root, ids) => { events.push(`reserve:${ids.length}`); },
    stopDeletionOwners: async () => { events.push('native-stop'); },
    deleteTree: async (_id, confirmed) => { events.push('delete'); confirmed('child'); if (options.removeError) throw new Error('Lost acknowledgement'); },
    finishDeletion: async (_id, uncertain) => { events.push(`finish:${uncertain}`); },
  };
  const source = codexSessionDeletion(() => history, context);
  const operation = source.operation({ kind: 'codex', sessionId: 'root' }, 'Root')!;
  return { source, operation, history, context, events, removed, reviews, abort };
}

test('Codex planner uses spawned lineage, opaque review keys and iterative nested order', () => {
  const plan = codexDeletionTree(cwd, 'root', [...base, thread('grandchild', 'child'), thread('unrelated')]);
  assert.deepEqual(plan.ids, ['root', 'child', 'grandchild']);
  assert.deepEqual(plan.review.map(node => [node.key, node.parentKey]), [[codexScope('root'), null], [codexScope('child'), codexScope('root')], [codexScope('grandchild'), codexScope('child')]]);
  assert.equal('file' in plan.review[0], false); assert.equal('parent' in plan.review[1], false);
  assert.equal(plan.targets[1].draftScope, codexScope('child'));
  // Shared tree-wide session IDs are not a deletion relationship.
  assert.deepEqual(codexDeletionTree(cwd, 'root', base.map(node => ({ ...node, sessionId: 'same-session-tree' }))).ids, ['root', 'child']);
  const deep = Array.from({ length: 2000 }, (_, index) => thread(String(index), index ? String(index - 1) : null));
  assert.equal(codexDeletionTree(cwd, '0', deep).ids.length, 2000);
});

test('Codex planner refuses cross-project, incomplete, cyclic, ambiguous-fork and conflicting scope', () => {
  for (const inventory of [
    [thread('root'), thread('child', 'root', '/other')],
    [thread('root'), thread('orphan', 'missing')],
    [thread('root', 'child'), thread('child', 'root')],
    [thread('root'), { ...thread('fork'), forkedFromId: 'root' }],
    [thread('root'), thread('root', null, '/other')],
    [{ ...thread('root'), ephemeral: true }],
    [{ ...thread('root'), parentThreadId: undefined }],
    [{ ...thread('root'), forkedFromId: undefined }],
  ]) assert.throws(() => codexDeletionTree(cwd, 'root', inventory));
  assert.throws(() => codexDeletionTree(cwd, 'missing', base));
});

test('Codex deletion reuses review/locks/stop and reconciles only the authoritative current tree', async () => {
  const f = fixture(); await f.operation.run();
  assert.equal(f.reviews[0].title, 'Delete Codex thread tree'); assert.equal(f.reviews[0].sessions.length, 2);
  assert.ok(f.events.indexOf('reserve:2') < f.events.indexOf('review'));
  assert.ok(f.events.indexOf('review') < f.events.indexOf('stop:2'));
  assert.ok(f.events.indexOf('native-stop') < f.events.lastIndexOf('preview'));
  assert.ok(f.events.lastIndexOf('preview') < f.events.indexOf('delete'));
  assert.equal(f.events.at(-1), 'finish:false');
  assert.ok(f.removed.includes(codexScope('root'))); assert.ok(f.removed.includes(codexScope('child')));
});

test('Codex cancelled review releases reservations without stopping, deleting or changing drafts', async () => {
  const f = fixture({ confirm: false }); await f.operation.run();
  assert.equal(f.events.some(event => event.startsWith('stop:') || event === 'native-stop' || event === 'delete'), false);
  assert.deepEqual(f.removed, []); assert.equal(f.events.at(-1), 'finish:false');
});

test('Codex descendants created during review/shutdown expand locks and observed stop before one recursive delete', async () => {
  const expanded = [...base, thread('late', 'child')]; const f = fixture({ previews: [base, expanded, expanded] });
  await f.operation.run();
  assert.deepEqual(f.events.filter(event => event.startsWith('reserve:')), ['reserve:2', 'reserve:3']);
  assert.deepEqual(f.events.filter(event => event.startsWith('stop:')), ['stop:2', 'stop:3']);
  assert.equal(f.events.filter(event => event === 'delete').length, 1); assert.ok(f.removed.includes(codexScope('late')));
});

test('Codex failed stop and shrinking lineage never issue deletion', async () => {
  for (const options of [{ stopError: true }, { previews: [base, [thread('root')]] }]) {
    const f = fixture(options); await assert.rejects(f.operation.run());
    assert.equal(f.events.includes('delete'), false); assert.deepEqual(f.removed, []); assert.equal(f.events.at(-1), 'finish:false');
  }
});

test('Codex partial notifications survive an unknown result; the root and unconfirmed drafts remain', async () => {
  const f = fixture({ removeError: true }); await assert.rejects(f.operation.run(), /Nothing was retried/);
  assert.deepEqual(f.removed, [codexScope('child')]); assert.equal(f.events.at(-1), 'finish:true');
  assert.equal(f.events.filter(event => event === 'delete').length, 1);
});

test('Codex native cleanup failure is surfaced instead of claiming safe release', async () => {
  const f = fixture({ removeError: true }); f.history.finishDeletion = async () => { throw new Error('Native reservation retained'); };
  await assert.rejects(f.operation.run(), /reservation retained/);
  assert.equal(f.events.filter(event => event === 'delete').length, 1);
});

test('Codex source remains unavailable without the narrow deletion-history/native-guard port', () => {
  const f = fixture(); const source = codexSessionDeletion(() => undefined, f.context);
  assert.equal(source.operation({ kind: 'copilot-sdk', sessionId: 'root' }, 'Root'), undefined);
  assert.equal(source.operation({ kind: 'codex', sessionId: 'root' }, 'Root')!.supported, false);
});

test('Codex client uses exhaustive sources and both archive partitions without creating/resuming/prompts', async () => {
  const sent: CodexPacket[] = [], deleted: string[] = [];
  const client = new CodexClient({ write: packet => { sent.push(packet); } }, { deleted: id => deleted.push(id) });
  const last = () => sent.at(-1)!;
  const initializing = client.initialize(); client.receive({ id: last().id, result: { userAgent: 'fixture' } }); await initializing;
  for (const archived of [false, true]) {
    const pending = client.deletionInventory(archived); const request = last(); const params = request.params as Record<string, unknown>;
    assert.equal(params.cwd, undefined); assert.equal(params.archived, archived); assert.equal((params.sourceKinds as string[]).length, 10);
    client.receive({ id: request.id, result: { data: base, nextCursor: null } }); assert.equal((await pending).data.length, 2);
  }
  const deleting = client.deleteThread('root'); const request = last();
  client.receive({ method: 'thread/deleted', params: { threadId: 'child' } });
  client.receive({ id: request.id, result: {} }); await deleting;
  assert.deepEqual(deleted, ['child']);
  assert.equal(sent.some(packet => ['thread/start', 'thread/resume', 'turn/start'].includes(String(packet.method))), false);
  client.disconnect();
});
