import assert from 'node:assert/strict';
import test from 'node:test';
import { initialConversationState, messagesToDisplay, reduceRpcEvent } from '../src/pi/reducer';
import { conversationIndex } from '../src/pi/conversation-index';
import { TranscriptUpdates } from '../src/pi/transcript-updates';
import { immutableSnapshot } from '../src/pi/immutable-snapshot';
import { sectionOutputSource, sameOutputAppend } from '../src/pi/output-source';
import { projectToolTimeline } from '../src/pi/tool-progress';
import type { ConversationState, DisplayMessage, JsonRecord } from '../src/pi/types';

function running(history = 0): ConversationState {
  return { ...initialConversationState(), busy: true, messages: [
    ...Array.from({ length: history }, (_, index) => ({ key: `history:${index}`, role: 'assistant', content: [{ type: 'text', text: 'unchanged history' }] })),
    { key: 'assistant', role: 'assistant', content: ['a', 'b'].map(id => ({ type: 'toolCall', id, name: 'bash', arguments: immutableSnapshot({ command: id }), toolStatus: 'running' as const })) },
  ] };
}
const output = (state: ConversationState, id: string, text: string) => reduceRpcEvent(state, { type: 'tool_execution_update', toolCallId: id, toolName: 'bash', partialResult: { content: [{ type: 'text', text }] } });

for (const length of [0, 1000]) test(`indexed streaming and dirty rows do not inspect unrelated history (${length} rows)`, () => {
  let state = running(length);
  const updates = new TranscriptUpdates();
  const initial = updates.snapshot(state);
  const rows = initial.state.messages;
  const index = conversationIndex(state.messages);
  // A scan of unrelated message content would now fail, including projection.
  for (const message of state.messages.slice(0, length)) Object.defineProperty(message, 'content', { get() { throw new Error('historical content visited'); } });
  state = output(state, 'a', 'one');
  assert.equal(conversationIndex(state.messages), index, 'content updates reuse tool locations');
  const first = updates.snapshot(state);
  assert.deepEqual(first.transcript.rows?.map(row => row.key), ['tool:a']);
  state = output(state, 'b', 'two');
  const second = updates.snapshot(state);
  assert.deepEqual(second.transcript.rows?.map(row => row.key), ['tool:b']);
  assert.equal(second.transcript.base, first.transcript.revision);
  assert.equal(rows.at(-1)?.key, 'tool:b');
});

test('unchanged projected rows are reused; structural changes and progress transitions reconcile fully', () => {
  let state = running(2);
  const updates = new TranscriptUpdates();
  const initial = updates.snapshot(state).state.messages;
  state = output(state, 'a', 'live');
  const patch = updates.snapshot(state);
  assert.equal(patch.state.messages.at(-1), initial.at(-1), 'unrelated tool row identity');
  const same = updates.snapshot({ ...state, status: 'Still running' });
  assert.deepEqual(same.transcript.rows, []);
  state = reduceRpcEvent(state, { type: 'tool_execution_end', toolCallId: 'a', result: { content: [{ type: 'text', text: 'final replacement' }] } });
  assert.equal(updates.snapshot(state).transcript.rows, undefined, 'lifecycle progress may change overview/phase');
  state = { ...state, messages: [...state.messages] };
  assert.equal(updates.snapshot(state).transcript.rows, undefined, 'untracked replacement is authoritative');
});

test('index rebuilds for history replacement and adoption; late updates never rewind results', () => {
  let state = initialConversationState();
  state = output(state, 'orphan', 'early');
  assert.equal(state.messages[0].role, 'tool');
  state = reduceRpcEvent(state, { type: 'message_start', message: { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'orphan', name: 'bash', arguments: { command: 'complete' } }] } });
  assert.equal(state.messages.length, 1);
  assert.equal(state.messages[0].role, 'assistant');
  state = output(state, 'orphan', 'adopted');
  assert.equal((state.messages[0].content as import('../src/pi/types').ContentBlock[])[0].executionOutput, 'adopted');
  const messages = messagesToDisplay([
    { role: 'toolResult', toolCallId: 'restored', content: [{ type: 'text', text: 'saved result' }] },
    { role: 'assistant', timestamp: 2, content: [{ type: 'toolCall', id: 'restored', name: 'bash', arguments: { command: 'saved' } }] },
  ]);
  state = { ...state, messages };
  state = output(state, 'restored', 'stale');
  const block = (state.messages[0].content as import('../src/pi/types').ContentBlock[])[0];
  assert.equal(block.toolStatus, 'result'); assert.equal(block.resultOutput, 'saved result');
  assert.equal(block.executionOutput, undefined);
  state = output(state, 'orphan', 'new invocation envelope');
  assert.equal(state.messages.at(-1)?.role, 'tool', 'old index cannot address replaced history');
});

test('render-owned sources validate endpoints without reducer lineage and share raw-recovery tokens', () => {
  const source = (text: string) => {
    const card = Object.freeze({ executionOutput: text });
    const token = sectionOutputSource(card, 'result', text);
    assert.equal(sectionOutputSource(card, 'result', text), token, 'presentation and raw recovery share a token');
    assert.equal(sectionOutputSource(card, 'result', 'custom summary'), undefined);
    return token;
  };
  const first = source('first');
  assert.ok(sameOutputAppend(first, source('first second third')));
  const replacement = source('short');
  assert.equal(sameOutputAppend(first, replacement), false);
  const longer = source('short more');
  assert.ok(sameOutputAppend(replacement, longer));
  assert.equal(sameOutputAppend(longer, source('short')), false, 'truncation of displayed output replaces it');
  assert.ok(sameOutputAppend(replacement, source('short')), 'skipped intermediate changes do not need replay');
});

for (const placement of ['standalone', 'embedded'] as const) test(`dirty ${placement} tool rows match full projection through result processing and interruption`, () => {
  let state = initialConversationState();
  if (placement === 'embedded') state = reduceRpcEvent(state, { type: 'message_start', message: {
    role: 'assistant', timestamp: 1, content: ['a', 'b'].map(id => ({ type: 'toolCall', id, name: 'bash', arguments: { command: id } })),
  } });
  const updates = new TranscriptUpdates();
  let retained = updates.snapshot(state).state.messages;
  const step = (event: JsonRecord) => {
    state = reduceRpcEvent(state, event);
    const snapshot = updates.snapshot(state);
    if (snapshot.transcript.rows === undefined) retained = snapshot.state.messages;
    else {
      const dirty = new Map(snapshot.transcript.rows.map(row => [row.key, row]));
      assert.ok([...dirty.keys()].every(key => retained.some(row => row.key === key)), 'patches cannot add rows');
      retained = retained.map(row => dirty.get(row.key) ?? row);
    }
    assert.deepEqual(retained, projectToolTimeline(state.messages, state.toolProgress), String(event.type));
    return snapshot.transcript;
  };
  const phase = (row: DisplayMessage) => row.role === 'tool' ? row.uiPhase : Array.isArray(row.content) ? row.content[0].uiPhase : undefined;
  const result = (id: string) => ({ type: 'message_start', message: { role: 'toolResult', toolCallId: id, content: [{ type: 'text', text: `${id} result` }] } });
  step({ type: 'agent_start' });
  for (const id of ['a', 'b']) step({ type: 'tool_execution_start', toolCallId: id, toolName: 'bash', args: { command: id } });
  for (const id of ['a', 'b']) step({ type: 'tool_execution_end', toolCallId: id, result: { content: [{ type: 'text', text: `${id} final` }] } });
  step(result('a'));
  const processing = step(result('b'));
  assert.equal(phase(processing.rows![0]), 'thinking', 'result delivery does not end processing');
  step({ ...result('b'), type: 'message_end' });
  step({ type: 'message_start', message: { role: 'assistant', timestamp: 2, content: [] } });
  step({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Next answer' } });
  assert.equal(phase(retained.find(row => row.key === 'tool:b')!), undefined);
  step({ type: 'tool_execution_start', toolCallId: 'c', toolName: 'bash' });
  step({ type: 'agent_settled' });
  const interrupted = step({ type: 'tool_execution_update', toolCallId: 'c', partialResult: { content: [{ type: 'text', text: 'late output' }] } });
  assert.equal(phase(interrupted.rows![0]), 'stopped', 'late content does not remove interruption');
  step({ type: 'queue_update', steering: ['next'], followUp: [] });
});

test('presentation and raw recovery share one append comparison per rendered source pair', () => {
  let reads = 0;
  const before = { text: 'base' }, after = { get text() { reads++; return 'base appended'; } };
  assert.ok(sameOutputAppend(before, after)); assert.ok(sameOutputAppend(before, after));
  assert.equal(reads, 1);
});

test('card snapshots isolate caller data and share only owned deeply frozen subtrees', () => {
  const source = { nested: { value: 'initial' } };
  const inputs = immutableSnapshot(source);
  source.nested.value = 'caller changed';
  assert.equal(inputs.nested.value, 'initial');
  const first = immutableSnapshot({ arguments: inputs, executionOutput: 'one' });
  const second = immutableSnapshot({ arguments: inputs, executionOutput: 'one two' });
  assert.equal(first.arguments, second.arguments);
  assert.ok(Object.isFrozen(second)); assert.ok(Object.isFrozen(second.arguments.nested));
  assert.throws(() => { second.arguments.nested.value = 'plugin changed'; }, TypeError);
  assert.equal(immutableSnapshot({ arguments: source }).arguments.nested.value, 'caller changed');
  const shallow = Object.freeze({ nested: { value: 'not owned' } });
  const detached = immutableSnapshot(shallow);
  shallow.nested.value = 'external mutation';
  assert.equal(detached.nested.value, 'not owned', 'shallow-frozen caller data is not a shareable subtree');
});
