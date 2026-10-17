import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotSession, type CopilotSessionUi } from '../src/copilot/session';
import { CopilotConnection, type BridgeRequest } from '../src/copilot/connection';
import { copilotSdkScope } from '../src/copilot/session-lifecycle';
import { SessionDrafts } from '../src/pi/session-drafts';
import { copilotSessionDeletion } from '../src/copilot/session-deletion';
import type { SessionDeletionContext } from '../src/session-deletion-operation';
import type { CopilotSessionHistory } from '../src/copilot/session-history';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import type { ToolCaptureRecord } from '../src/tool-capture';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const models = [
  { id: 'small', name: 'Small', supportedReasoningEfforts: ['low', 'high'] },
  { id: 'large', name: 'Large' },
];
async function fixture(events: unknown[] = [], decision: CopilotSessionUi['decision'] = async () => undefined) {
  const sent: BridgeRequest[] = [], published: ConversationViewMessage[] = [], completed: boolean[] = [], captured: ToolCaptureRecord[] = [];
  const session = new CopilotSession(async request => { sent.push(request); }, {
    publish: message => published.push(message), changed() {}, identified() {}, disconnected() {}, notice() {},
    completed: failed => completed.push(failed), decision,
    toolCapture: { enabled: true, append: record => captured.push(structuredClone(record)) },
  });
  const last = (method: string) => { const request = [...sent].reverse().find(request => request.method === method); assert.ok(request); return request; };
  const reply = (method: string, result: unknown = null) => session.receive({ kind: 'result', id: last(method).id, result });
  const initializing = session.initialize('saved-id');
  reply('initialize'); await flush();
  session.receive({ kind: 'connected', sessionId: 'saved-id', events, models, model: { modelId: 'small', reasoningEffort: 'low' } });
  reply('connect'); await initializing;
  let sequence = 0;
  const event = (type: string, data: Record<string, unknown>, id = `event-${sequence++}`) => session.receive({ kind: 'event', event: { id, type, data } });
  return { session, sent, published, completed, captured, last, reply, event };
}

test('SDK replay is read-only and final content wins over buffered deltas', async () => {
  const f = await fixture([
    { id: 'u', type: 'user.message', data: { content: 'Saved question' } },
    { id: 'a', type: 'assistant.message', data: { messageId: 'answer', content: 'Saved answer' } },
    { id: 'r', type: 'assistant.reasoning', data: { reasoningId: 'reason', content: 'Saved thought' } },
    { id: 't', type: 'tool.execution_start', data: { toolCallId: 'tool', toolName: 'bash', arguments: { command: 'fixture' } } },
    { id: 'idle', type: 'session.idle', data: {} },
  ]);
  assert.equal(f.session.state.messages.length, 4);
  assert.equal(f.session.state.messages[3].uiPhase, 'stopped');
  assert.deepEqual(f.completed, []); assert.deepEqual(f.captured, []);
  f.event('assistant.message_delta', { messageId: 'answer', deltaContent: 'Saved answer' });
  const answer = f.session.state.messages[1].content;
  assert.ok(Array.isArray(answer)); assert.equal(answer[0].text, 'Saved answer');
  assert.deepEqual(f.sent.map(request => request.method), ['initialize', 'connect']);
  f.session.disconnect('fixture complete');
});

test('SDK optimistic echo, native tools, content-only controls and one completion retain identity', async () => {
  const f = await fixture();
  const sending = f.session.handle({ type: 'prompt', id: 'local', text: 'Hello' });
  f.event('user.message', { content: 'Hello (native hook)' });
  assert.equal(f.session.state.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(f.session.state.messages[0].content, 'Hello (native hook)');
  f.reply('prompt', { messageId: 'accepted' }); await sending;
  const controls = f.session.state.controls;
  f.event('assistant.message_delta', { messageId: 'answer', deltaContent: 'First ' });
  f.event('assistant.message_delta', { messageId: 'answer', deltaContent: 'second' });
  assert.equal(f.session.state.controls, controls);
  const key = f.session.state.messages.find(message => message.role === 'assistant')!.key;
  f.event('tool.execution_start', { toolCallId: 'one', toolName: 'bash', arguments: { command: 'printf fixture' } });
  const tool = f.session.state.messages.find(message => message.role === 'tool')!, argumentsIdentity = tool.toolArguments;
  f.event('tool.execution_partial_result', { toolCallId: 'one', partialOutput: 'replacement one' });
  f.event('tool.execution_partial_result', { toolCallId: 'one', partialOutput: 'replacement two' }, 'same-event');
  f.event('tool.execution_partial_result', { toolCallId: 'one', partialOutput: 'duplicate' }, 'same-event');
  let current = f.session.state.messages.find(message => message.role === 'tool')!;
  assert.equal(current.key, tool.key); assert.equal(current.toolArguments, argumentsIdentity);
  assert.equal(current.output, 'replacement two');
  f.event('tool.shell_output', { toolCallId: 'one', sequence: 0, text: '\nshell output' });
  f.event('tool.shell_output', { toolCallId: 'one', sequence: 0, text: '\nduplicate shell output' });
  assert.equal(f.session.state.messages.find(message => message.role === 'tool')!.output, 'replacement two\nshell output');
  f.event('tool.execution_complete', { toolCallId: 'one', success: true, result: { content: 'Done', structuredContent: { exitCode: 0 } } });
  f.event('tool.execution_progress', { toolCallId: 'one', progressMessage: 'late progress' });
  current = f.session.state.messages.find(message => message.role === 'tool')!;
  assert.equal(current.toolStatus, 'result'); assert.match(current.resultOutput!, /exitCode/);
  assert.deepEqual(current.toolSource, { backend: 'copilot-sdk', agent: 'copilot' });
  f.event('assistant.message', { messageId: 'answer', content: 'First second' });
  assert.equal(f.session.state.messages.find(message => message.role === 'assistant')!.key, key);
  f.event('session.idle', {}); f.event('session.idle', {});
  assert.deepEqual(f.completed, [false]);
  assert.ok(f.captured.every(record => record.event.startsWith('tool.')));
  assert.ok(f.sent.every(request => !('jsonrpc' in request)));
  f.session.disconnect('fixture complete');
});

test('SDK busy drafts do not dispatch; Stop cancels session-bound decisions without approving them', async () => {
  let resolve!: (value: Record<string, unknown>) => void;
  let signal!: AbortSignal;
  const f = await fixture([], async (_kind, _request, owned) => { signal = owned; return new Promise(done => { resolve = done; }); });
  const first = f.session.handle({ type: 'prompt', id: 'first', text: 'One' });
  f.reply('prompt'); await first;
  await f.session.handle({ type: 'prompt', id: 'newer', text: 'Kept draft' });
  assert.equal(f.sent.filter(request => request.method === 'prompt').length, 1);
  assert.equal(f.published.find(message => message.type === 'submissionReceipt' && message.id === 'newer')?.outcome, 'rejected');
  f.session.receive({ kind: 'permission', id: 'permission', request: { kind: 'shell', fullCommandText: 'fixture' } });
  const stopping = f.session.handle({ type: 'stop' });
  assert.equal(signal.aborted, true);
  resolve({ kind: 'approved' }); await flush();
  assert.equal(f.sent.some(request => request.method === 'decision'), false);
  f.reply('cancel'); await stopping;
  f.event('session.idle', {});
  assert.equal(f.session.canSubmit, true); assert.deepEqual(f.completed, []);
  f.session.disconnect('fixture complete');
});

test('SDK model events outrank older configuration responses and thinking remains model-specific', async () => {
  const f = await fixture();
  assert.equal(f.session.supports('thinking'), true);
  const selecting = f.session.selectPreference('model', async values => values[1]);
  await flush();
  f.event('session.model_change', { newModel: 'small', reasoningEffort: 'high' });
  f.reply('configure', { modelId: 'large' }); await selecting;
  assert.equal(f.session.state.controls?.find(control => control.id === 'model')?.label, 'small');
  assert.equal(f.session.state.controls?.find(control => control.id === 'thinking')?.label, 'high');
  f.event('session.model_change', { newModel: 'large' });
  assert.equal(f.session.supports('thinking'), false);
  assert.match(f.session.validatePrompt('/context')!, /not exposed/);
  f.session.disconnect('fixture complete');
});

test('SDK transport write uncertainty fails pending requests once and never replays them', async () => {
  const sent: BridgeRequest[] = [], ended: string[] = [];
  const connection = new CopilotConnection(async message => { sent.push(message); throw new Error('unknown delivery'); }, () => {}, reason => ended.push(reason));
  await assert.rejects(connection.request('prompt', { text: 'Do not resend' }), /delivery is unknown/);
  await assert.rejects(connection.request('prompt', { text: 'Do not resend' }), /disconnected/);
  assert.equal(sent.length, 1); assert.equal(ended.length, 1);
});

test('SDK child activity never changes root configuration or completes the root turn; errors settle once', async () => {
  const f = await fixture();
  const sending = f.session.handle({ type: 'prompt', id: 'root', text: 'Root question' });
  f.reply('prompt'); await sending;
  const child = (type: string, data: Record<string, unknown>) => f.session.receive({ kind: 'event', event: { id: `child-${type}`, agentId: 'child-id', type, data } });
  child('assistant.message_delta', { messageId: 'child-message', deltaContent: 'Child answer' });
  child('session.model_change', { newModel: 'large' });
  child('session.error', { message: 'Child failure' });
  child('session.idle', {});
  assert.equal(f.session.state.busy, true);
  assert.equal(f.session.state.messages.find(message => message.key.includes('child-message'))?.originLabel, 'Copilot agent child-id');
  assert.equal(f.session.state.controls?.find(control => control.id === 'model')?.label, 'small');
  assert.deepEqual(f.completed, []);
  f.event('session.error', { message: 'Root failure' }); f.event('session.idle', {});
  assert.equal(f.session.state.busy, false); assert.deepEqual(f.completed, [true]);
  f.session.disconnect('fixture complete');
});

test('SDK and legacy identity scopes never copy or delete one another’s draft', () => {
  const id = 'same/raw:id', sdk = copilotSdkScope(id), legacy = `acp:copilot:${JSON.stringify(id)}`;
  let saved: { drafts: Record<string, unknown> } | undefined;
  const drafts = new SessionDrafts({ drafts: { [legacy]: { draft: 'Legacy draft' }, [sdk]: { draft: 'SDK draft' } } }, null, value => { saved = value as typeof saved; });
  assert.notEqual(sdk, legacy);
  assert.deepEqual(drafts.select(sdk), { draft: 'SDK draft' });
  drafts.deleteScope(sdk);
  assert.deepEqual(saved?.drafts[legacy], { draft: 'Legacy draft' });
  assert.equal(saved?.drafts[sdk], undefined);
});

test('SDK deletion requires review, fresh membership and owned stop; unknown deletion retains local state', async () => {
  const order: string[] = [], abort = new AbortController();
  let unknown = false;
  const history = {
    supportsDeletion: true,
    async validateDeletion() { order.push('membership'); },
    async deleteSession() { order.push('delete'); if (unknown) throw new Error('outcome unknown'); },
  } as unknown as CopilotSessionHistory;
  const context: SessionDeletionContext = {
    signal: abort.signal, changed() {}, loadingReview() {}, closeReview() {}, recovered() {}, error() {},
    async review() { order.push('review'); return true; }, lock(_targets, executing) { if (executing) order.push('lock'); },
    async stop() { order.push('stop'); }, progress() {}, removed() { order.push('removed'); },
  };
  const source = copilotSessionDeletion(() => history, context);
  const operation = source.operation({ kind: 'copilot-sdk', sessionId: 'saved-id' }, 'Saved')!;
  await operation.run();
  assert.deepEqual(order, ['review', 'membership', 'lock', 'stop', 'delete', 'removed']);
  order.length = 0; unknown = true;
  await assert.rejects(operation.run(), /outcome unknown/);
  assert.equal(order.includes('removed'), false);
  Object.assign(history, { supportsDeletion: false });
  assert.equal(operation.available(), false);
});
