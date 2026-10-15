import assert from 'node:assert/strict';
import test from 'node:test';
import { initialConversationState, messagesToDisplay, reduceRpcEvent } from '../src/pi/reducer';
import { conversationIndex } from '../src/pi/conversation-index';
import { TranscriptUpdates } from '../src/pi/transcript-updates';
import { immutableSnapshot } from '../src/pi/immutable-snapshot';
import { outputSources, sameOutputAppend } from '../src/pi/output-source';
import type { ConversationState } from '../src/pi/types';

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

test('verified output lineage survives coalesced appends but not truncation or replacement', () => {
  let state = running();
  const block = () => (state.messages[0].content as import('../src/pi/types').ContentBlock[])[0];
  state = output(state, 'a', 'first'); const first = outputSources(block()).executionOutput;
  state = output(state, 'a', 'first second');
  state = output(state, 'a', 'first second third');
  assert.ok(sameOutputAppend(first, outputSources(block()).executionOutput));
  state = output(state, 'a', 'short'); const replacement = outputSources(block()).executionOutput;
  assert.equal(sameOutputAppend(first, replacement), false);
  state = output(state, 'a', 'short more');
  assert.ok(sameOutputAppend(replacement, outputSources(block()).executionOutput));
  state = output(state, 'a', 'short');
  assert.equal(sameOutputAppend(replacement, outputSources(block()).executionOutput), false, 'a truncated/reextended stream cannot reuse the old lineage');
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
});
