import assert from 'node:assert/strict';
import test from 'node:test';
import capturedPermissionCommand from './fixtures/copilot-permission-command.json' with { type: 'json' };
import { CopilotSession, type CopilotSessionUi, type CopilotDecision } from '../src/copilot/session';
import { CopilotConnection, type BridgeRequest } from '../src/copilot/connection';
import { copilotSdkScope } from '../src/copilot/session-lifecycle';
import { SessionDrafts } from '../src/pi/session-drafts';
import { copilotSessionDeletion } from '../src/copilot/session-deletion';
import type { SessionDeletionContext } from '../src/session-deletion-operation';
import type { CopilotSessionHistory } from '../src/copilot/session-history';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import type { TranscriptLogRecord } from '../src/transcript-logs';

const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const models = [
  { id: 'small', name: 'Small', supportedReasoningEfforts: ['low', 'high'] },
  { id: 'large', name: 'Large' },
];
async function fixture(events: unknown[] = [], decision: CopilotSessionUi['decision'] = async () => undefined, autoUsage = true, fresh = false, catalog: unknown[] = models) {
  const sent: BridgeRequest[] = [], published: ConversationViewMessage[] = [], completed: boolean[] = [], captured: TranscriptLogRecord[] = [];
  const session: CopilotSession = new CopilotSession(async request => {
    sent.push(request);
    if (autoUsage && ['usage', 'context'].includes(request.method)) queueMicrotask(() => session.receive({ kind: 'result', id: request.id, result: request.method === 'usage' ? {} : null }));
  }, {
    publish: message => published.push(message), changed() {}, identified() {}, disconnected() {}, notice() {},
    completed: failed => completed.push(failed), decision,
    transcriptLog: { enabled: true, append: record => captured.push(structuredClone(record)) },
  });
  const last = (method: string) => { const request = [...sent].reverse().find(request => request.method === method); assert.ok(request); return request; };
  const reply = (method: string, result: unknown = null) => session.receive({ kind: 'result', id: last(method).id, result });
  const initializing = session.initialize(fresh ? undefined : 'saved-id');
  reply('initialize'); await flush();
  session.receive({ kind: 'connected', sessionId: 'saved-id', events, models: catalog, model: { modelId: 'small', reasoningEffort: 'low' } });
  reply('connect'); await initializing; await flush();
  let sequence = 0;
  const event = (type: string, data: Record<string, unknown>, id = `event-${sequence++}`) => session.receive({ kind: 'event', event: { id, type, data } });
  return { session, sent, published, completed, captured, last, reply, event };
}

for (const caption of ['', 'Image caption']) test(`image input sends bytes and reconciles the SDK echo (${caption || 'image only'})`, async () => {
  const f = await fixture();
  try {
    const images = [{ type: 'image' as const, mimeType: 'image/png', data: 'YWJj' }];
    const sending = f.session.messageInput.submit({ id: 'image-send', text: caption, images, mode: 'normal' });
    assert.deepEqual(f.last('prompt').images, images);
    const preview = f.session.state.messages.find(message => message.role === 'user')!;
    assert.ok(Array.isArray(preview.content) && preview.content.some(block => block.type === 'image'));
    f.event('user.message', { content: `${caption} normalized`, attachments: [{ type: 'blob', mimeType: 'image/jpeg', data: 'ZGVm' }] });
    assert.equal(f.session.state.messages.filter(message => message.role === 'user').length, 1);
    const actual = f.session.state.messages.find(message => message.role === 'user')!;
    assert.equal(actual.key, preview.key);
    assert.deepEqual(actual.content, [{ type: 'text', text: `${caption} normalized` }, { type: 'image', mimeType: 'image/jpeg', data: 'ZGVm' }]);
    f.reply('prompt', { messageId: 'native-id' }); await sending;
    assert.equal(f.published.find(message => message.type === 'submissionReceipt' && message.id === 'image-send')?.outcome, 'accepted');
    assert.equal(f.session.state.busy, true, 'acceptance is not turn completion');
    f.event('session.idle', {});
    assert.equal(f.session.state.busy, false);
  } finally { f.session.disconnect('fixture complete'); }
});

test('image history uses the same SDK attachment projection without sending a prompt', async () => {
  const f = await fixture([{ id: 'image-history', type: 'user.message', data: { content: '', attachments: [{ type: 'blob', mimeType: 'image/png', data: 'YWJj' }] } }]);
  try {
    assert.deepEqual(f.session.state.messages[0].content, [{ type: 'text', text: '' }, { type: 'image', mimeType: 'image/png', data: 'YWJj' }]);
    assert.equal(f.sent.filter(request => request.method === 'prompt').length, 0);
  } finally { f.session.disconnect('fixture complete'); }
});

for (const condition of ['busy', 'slash', 'malformed', 'unsupported-model', 'over-limit'] as const) test(`Copilot rejects ${condition} image input before dispatch`, async () => {
  const catalog = [{ id: 'small', name: 'Small', capabilities: { supports: { vision: condition !== 'unsupported-model' }, limits: { vision: { max_prompt_images: 1 } } } }];
  const f = await fixture([], undefined, true, false, catalog);
  try {
    if (condition === 'busy') f.event('assistant.turn_start', {});
    const image = { type: 'image' as const, mimeType: 'image/png', data: condition === 'malformed' ? 'invalid' : 'YWJj' };
    await f.session.messageInput.submit({ id: 'invalid', text: condition === 'slash' ? '/permissions show' : '', images: condition === 'over-limit' ? [image, image] : [image], mode: 'normal' });
    assert.equal(f.sent.filter(request => request.method === 'prompt' || request.method === 'command').length, 0);
    assert.equal(f.published.find(message => message.type === 'submissionReceipt' && message.id === 'invalid')?.outcome, 'rejected');
  } finally { f.session.disconnect('fixture complete'); }
});

test('image input delivery uncertainty never replays or restores a submitted payload', async () => {
  const f = await fixture();
  try {
    const sending = f.session.messageInput.submit({ id: 'unknown-image', text: '', images: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }], mode: 'normal' });
    f.session.disconnect('Fixture connection lost after write'); await sending;
    assert.equal(f.sent.filter(request => request.method === 'prompt').length, 1);
    assert.equal(f.published.find(message => message.type === 'submissionReceipt' && message.id === 'unknown-image')?.outcome, 'unknown');
    assert.equal(f.session.state.sessionUnavailable, true);
  } finally { f.session.disconnect('fixture complete'); }
});

for (const rejected of [false, true]) test(`configuration ${rejected ? 'error response is failed' : 'connection loss is unknown'} after dispatch`, async () => {
  const f = await fixture();
  try {
    const choices = await f.session.configuration.choices('model');
    f.session.configuration.set('model', choices.find(choice => choice.value === 'large')!);
    await flush();
    const request = f.last('configure');
    assert.equal(f.session.configuration.operations[0].cancellable, false);
    if (rejected) f.session.receive({ kind: 'result', id: request.id, error: 'Fixture configuration rejected' });
    else f.session.disconnect('Fixture transport lost');
    await flush();
    const operation = f.session.configuration.operations[0];
    assert.equal(operation.phase, rejected ? 'failed' : 'unknown');
    assert.equal(operation.title, 'Configuration change');
    assert.equal(operation.cause, 'connection');
    assert.match(operation.details!, rejected ? /Fixture configuration rejected/ : /Fixture transport lost/);
    assert.equal(f.sent.filter(request => request.method === 'configure').length, 1);
  } finally { f.session.disconnect('fixture complete'); }
});

const permissionCatalog = (allowDuringAgentExecution = true) => [{ ...capturedPermissionCommand, allowDuringAgentExecution }];

for (const commandText of ['/permissions allow-all', '/perms allow-all'])
test(`live ${commandText} uses the generic command path without answering old approvals`, async () => {
  let answer!: (value: CopilotDecision) => void;
  const f = await fixture([], () => new Promise(resolve => { answer = resolve; }));
  try {
    const commands = permissionCatalog();
    // The capture uses /permissions; add an alias only for explicit alias coverage.
    f.session.receive({ kind: 'commands', commands: commandText.startsWith('/perms ') ? commands.map(command => ({ ...command, aliases: ['perms'] })) : commands });
    f.event('assistant.turn_start', {});
    f.session.receive({ kind: 'permission', id: 'old-permission', request: { kind: 'read', path: '/fixture' } });
    const model = (await f.session.configuration.choices('model')).find(choice => choice.value === 'large')!;
    f.session.configuration.set('model', model); await flush();
    assert.equal(f.session.validatePrompt(commandText), undefined);
    assert.match(f.session.validatePrompt('ordinary new prompt')!, /not idle/);
    const handling = f.session.handle({ type: 'command', id: 'live-policy', text: commandText }); await flush();
    const request = f.last('command');
    assert.equal(request.name, commandText.startsWith('/perms ') ? 'perms' : 'permissions');
    assert.equal(request.input, 'allow-all');
    assert.equal(f.sent.some(request => ['configure', 'prompt', 'decision', 'cancel'].includes(request.method)), false);
    f.event('session.permissions_changed', { mode: 'allow-all' });
    f.reply('command', { kind: 'text', text: 'Permission policy: Allow All for this session.' });
    await handling; await flush();
    assert.equal(f.session.configuration.operations[0].phase, 'queued');
    assert.equal(f.session.state.configurationOperations?.at(-1)?.title, 'Copilot command');
    assert.equal(f.session.state.configurationOperations?.at(-1)?.phase, 'completed');
    assert.equal(f.session.state.busy, true);
    assert.equal(f.published.at(-1)?.state?.status, 'Waiting for permission…');
    assert.deepEqual(f.completed, []);
    assert.equal(f.sent.some(request => request.method === 'decision'), false);
    answer({ kind: 'approve-once', approvedInteractively: true }); await flush(); f.reply('decision'); await flush();
    assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
  } finally { f.session.disconnect('fixture complete'); }
});

test('generic command queue respects a permission command that only allows terminal-idle execution', async () => {
  const f = await fixture();
  try {
    f.session.receive({ kind: 'commands', commands: permissionCatalog(false) });
    f.event('assistant.turn_start', {});
    const handling = f.session.handle({ type: 'command', id: 'queued-policy', text: '/permissions allow-all' }); await flush();
    assert.equal(f.session.state.configurationOperations?.[0].phase, 'queued');
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    f.event('session.idle', { mode: 'autopilot' }); await flush();
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    f.event('session.idle', {}); await flush();
    f.event('session.permissions_changed', { mode: 'allow-all' });
    f.reply('command', { kind: 'completed' }); await handling; await flush();
    assert.equal(f.session.state.configurationOperations?.[0].phase, 'completed');
  } finally { f.session.disconnect('fixture complete'); }
});

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
  assert.deepEqual(f.completed, []);
  assert.ok(f.captured.some(record => record.event === 'history.assistant.message'));
  assert.ok(f.captured.some(record => record.event === 'history.assistant.reasoning'));
  f.event('assistant.message_delta', { messageId: 'answer', deltaContent: 'Saved answer' });
  const answer = f.session.state.messages[1].content;
  assert.ok(Array.isArray(answer)); assert.equal(answer[0].text, 'Saved answer');
  assert.deepEqual(f.sent.map(request => request.method), ['initialize', 'connect', 'usage', 'context']);
  f.session.disconnect('fixture complete');
});

test('Autopilot intermediate idle retains work, decisions and cards until the SDK terminal boundary', async () => {
  let answer!: (value: CopilotDecision) => void;
  let signal!: AbortSignal;
  const f = await fixture([], async (_kind, _request, owned) => {
    signal = owned;
    return new Promise(resolve => { answer = resolve; });
  });
  try {
    f.event('session.mode_changed', { newMode: 'autopilot' });
    const sending = f.session.handle({ type: 'prompt', id: 'autonomous', text: 'One task' });
    f.reply('prompt'); await sending;
    f.event('tool.execution_start', { toolCallId: 'active', toolName: 'bash', arguments: {} });
    f.session.receive({ kind: 'input', id: 'question', request: { question: 'Choose' } });
    await f.session.selectPreference('mode', async () => 'Plan');
    const before = f.session.state.messages;
    for (let i = 0; i < 3; i++) {
      f.event('session.idle', { mode: 'autopilot' });
      f.event('session.task_complete', { success: false, reason: 'Completion review rejected' });
      f.event('session.autopilot_objective_changed', { operation: 'update', status: 'active' });
    }
    assert.equal(f.session.state.busy, true);
    assert.equal(f.session.canSubmit, false);
    assert.equal(f.session.state.messages, before);
    assert.equal(signal.aborted, false);
    assert.deepEqual(f.completed, []);
    assert.equal(f.sent.some(request => request.method === 'configure'), false);
    answer({ answer: 'Continue', wasFreeform: true }); await flush();
    f.reply('decision'); await flush();
    f.event('assistant.turn_start', {});
    f.event('session.task_complete', { success: true });
    assert.deepEqual(f.completed, [], 'task completion metadata is not physical quiescence');
    f.event('session.idle', { mode: 'interactive' }); await flush();
    assert.deepEqual(f.completed, [false]);
    assert.equal(f.last('configure').value, 'plan');
    f.reply('configure', { model: { modelId: 'small', reasoningEffort: 'low' }, mode: 'plan' }); await flush();
    const reads = f.sent.filter(request => request.method === 'usage').length;
    f.event('session.idle', { mode: 'interactive' }); await flush();
    assert.deepEqual(f.completed, [false]);
    assert.equal(f.sent.filter(request => request.method === 'usage').length, reads);
    assert.equal(f.sent.filter(request => request.method === 'prompt').length, 1);
  } finally { f.session.disconnect('fixture complete'); }
});

test('Autopilot abort is terminal even while the selected mode stays sticky', async () => {
  const f = await fixture();
  try {
    f.event('session.mode_changed', { newMode: 'autopilot' });
    const sending = f.session.handle({ type: 'prompt', id: 'stop-task', text: 'Stop this task' });
    f.reply('prompt'); await sending;
    const stopping = f.session.handle({ type: 'stop' });
    f.event('session.idle', { mode: 'autopilot' });
    assert.equal(f.session.state.busy, true, 'wait for abort rather than an unrelated intermediate idle');
    f.event('session.idle', { mode: 'autopilot', aborted: true });
    f.reply('cancel'); await stopping;
    f.event('session.task_complete', { success: true });
    f.event('assistant.turn_start', {});
    f.event('session.idle', { mode: 'interactive' });
    assert.equal(f.session.state.busy, false);
    assert.equal(f.session.state.status, 'Stopped');
    assert.equal(f.session.configuration.get('mode'), 'autopilot');
    assert.deepEqual(f.completed, []);
    const next = f.session.handle({ type: 'prompt', id: 'next-task', text: 'New task' });
    f.reply('prompt'); await next;
    f.event('session.idle', {});
    assert.deepEqual(f.completed, [false]);
  } finally { f.session.disconnect('fixture complete'); }
});

test('Autopilot root errors terminate once; child and replay events never terminate root work', async () => {
  const f = await fixture([
    { id: 'old-task', type: 'session.task_complete', data: { success: true } },
    { id: 'old-idle', type: 'session.idle', data: { mode: 'autopilot' } },
  ]);
  try {
    assert.deepEqual(f.completed, []);
    const sending = f.session.handle({ type: 'prompt', id: 'error-task', text: 'Task' });
    f.reply('prompt'); await sending;
    for (const type of ['session.idle', 'session.task_complete', 'session.error']) {
      f.session.receive({ kind: 'event', event: { id: `child-${type}`, agentId: 'child', type, data: { message: 'Child failed', success: true } } });
    }
    assert.equal(f.session.state.busy, true);
    f.event('session.error', { message: 'Root failed' });
    f.event('session.idle', { mode: 'autopilot' });
    f.event('session.idle', {});
    assert.deepEqual(f.completed, [true]);
  } finally { f.session.disconnect('fixture complete'); }
});

test('unknown Copilot snapshot and idle modes fail rather than looking interactive', async () => {
  for (const source of ['snapshot', 'idle']) {
    const f = await fixture();
    try {
      if (source === 'snapshot') {
        await f.session.selectPreference('mode', async () => 'Plan');
        f.reply('configure', { mode: 'unknown-mode' }); await flush();
      } else f.event('session.idle', { mode: 'unknown-mode' });
      assert.equal(f.session.state.sessionUnavailable, true);
      assert.deepEqual(f.completed, []);
    } finally { f.session.disconnect('fixture complete'); }
  }
});

test('SDK optimistic echo, native tools, content-only controls and one completion retain identity', async () => {
  const f = await fixture();
  const sending = f.session.handle({ type: 'prompt', id: 'local', text: 'Hello' });
  f.event('user.message', { content: 'Hello (native hook)' });
  assert.equal(f.session.state.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(f.session.state.messages[0].content, 'Hello (native hook)');
  f.reply('prompt', { messageId: 'accepted' }); await sending;
  const controls = f.session.state.statusArea?.controls;
  f.event('assistant.message_delta', { messageId: 'answer', deltaContent: 'First ' });
  f.event('assistant.message_delta', { messageId: 'answer', deltaContent: 'second' });
  assert.equal(f.session.state.statusArea?.controls, controls);
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
  assert.ok(f.captured.some(record => record.event === 'tool.execution_complete'));
  assert.ok(f.captured.some(record => record.event === 'assistant.message'));
  assert.ok(f.captured.some(record => record.event === 'request.prompt'));
  assert.ok(f.sent.every(request => !('jsonrpc' in request)));
  f.session.disconnect('fixture complete');
});

test('SDK busy drafts do not dispatch; Stop cancels session-bound decisions without approving them', async () => {
  let resolve!: (value: CopilotDecision) => void;
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
  resolve({ kind: 'approve-once', approvedInteractively: true }); await flush();
  assert.equal(f.sent.some(request => request.method === 'decision'), false);
  f.reply('cancel'); await stopping;
  f.event('session.idle', {});
  assert.equal(f.session.canSubmit, true); assert.deepEqual(f.completed, []);
  f.session.disconnect('fixture complete');
});

test('SDK status waits for all decisions, survives streaming, and restores underlying activity after choices or cancellation', async () => {
  const choices: ((value: CopilotDecision) => void)[] = [];
  const f = await fixture([], async () => new Promise(resolve => choices.push(resolve)));
  const status = () => {
    const message = f.published.filter(message => message.type === 'snapshot').at(-1);
    assert.ok(message?.type === 'snapshot' && message.state); return message.state.status;
  };
  try {
    f.event('assistant.turn_start', {});
    f.session.receive({ kind: 'permission', id: 'one', request: { kind: 'read', path: '/one' } });
    f.session.receive({ kind: 'permission', id: 'two', request: { kind: 'read', path: '/two' } });
    assert.equal(status(), 'Waiting for permission…');
    f.event('assistant.message_delta', { messageId: 'parallel', deltaContent: 'Still streaming' });
    assert.equal(status(), 'Waiting for permission…');
    choices[0]({ kind: 'approve-for-session', approval: { kind: 'read' } }); await flush();
    assert.equal(status(), 'Waiting for permission…');
    f.reply('decision'); await flush();
    choices[1]({ kind: 'reject', feedback: 'Different approach' }); await flush();
    assert.equal(status(), 'Working…');
    assert.deepEqual(f.last('decision').value, { kind: 'reject', feedback: 'Different approach' });
    f.reply('decision'); await flush();
    f.session.receive({ kind: 'input', id: 'three', request: { question: 'Continue?' } });
    assert.equal(status(), 'Waiting for input…');
    f.event('session.idle', {});
    assert.equal(status(), 'Idle');
    choices[2]({ answer: 'late answer', wasFreeform: true }); await flush();
    assert.equal(f.sent.filter(request => request.method === 'decision').length, 2, 'cancelled choices never replay');
  } finally { f.session.disconnect('fixture complete'); }
});

test('SDK model events outrank older configuration responses and thinking remains model-specific', async () => {
  const f = await fixture();
  assert.equal(f.session.supports('thinking'), true);
  assert.deepEqual((await f.session.configuration.choices('model')).map(({ value, label, detail }) => ({ value, label, detail })), [
    { value: 'small', label: 'Small', detail: 'small' },
    { value: 'large', label: 'Large', detail: 'large' },
  ]);
  const selecting = f.session.selectPreference('model', async values => values[1]);
  await flush();
  f.event('session.model_change', { newModel: 'small', reasoningEffort: 'high' });
  f.reply('configure', { modelId: 'large' }); await selecting; await flush();
  assert.equal(f.session.state.statusArea?.controls.find(control => control.id === 'model')?.label, 'small');
  assert.equal(f.session.state.statusArea?.controls.find(control => control.id === 'thinking')?.label, 'high');
  f.event('session.model_change', { newModel: 'large' });
  assert.equal(f.session.supports('thinking'), false);
  assert.match(f.session.validatePrompt('/context')!, /not advertised/);
  f.session.disconnect('fixture complete');
});

test('SDK status publishes root usage and reconciles selector capabilities without inventing Pi surfaces', async () => {
  const f = await fixture();
  const initial = f.session.state.statusArea!;
  assert.ok(initial.capabilities.metrics);
  assert.equal(initial.metrics, '— · — / —');
  assert.equal(initial.capabilities.queue, undefined);
  f.event('session.usage_info', { currentTokens: 31875, tokenLimit: 125000 });
  const reported = f.session.state.statusArea!;
  assert.equal(reported.metrics, '— · 25.5% / 125k');
  assert.equal(reported.controls, initial.controls, 'usage changes do not rebuild configuration controls');
  f.session.receive({ kind: 'event', event: { id: 'child-usage', agentId: 'child', type: 'session.usage_info', data: { currentTokens: 999, tokenLimit: 999 } } });
  assert.equal(f.session.state.statusArea, reported, 'child usage cannot overwrite root usage');
  f.event('assistant.turn_start', {});
  assert.ok(f.session.state.statusArea!.controls.every(control => !control.disabled), 'busy controls accept deferred configuration intent');
  f.event('session.idle', {});
  assert.ok(f.session.state.statusArea!.controls.every(control => !control.disabled));
  f.event('session.model_change', { newModel: 'large' });
  assert.deepEqual(f.session.state.statusArea!.controls.map(control => control.id), ['model']);
  f.event('session.model_deselected', {});
  assert.equal(f.session.state.statusArea!.controls[0].label, 'default model');
  assert.equal(f.session.state.statusArea!.controls[1].label, 'default effort');
  assert.equal(f.session.state.statusArea!.controls[1].disabled, false, 'connected unavailable settings remain actionable so their reason can be reported');
  assert.equal(f.session.configuration.get('model'), undefined);
  assert.equal(f.session.configuration.get('effort'), undefined);
  assert.equal(f.session.state.statusArea!.metrics, '— · — / —', 'model changes retire the old context denominator');
  f.event('session.usage_info', { currentTokens: 31875, tokenLimit: 125000 });
  f.session.disconnect('fixture complete');
  assert.equal(f.session.state.statusArea!.metrics, reported.metrics);
  assert.ok(f.session.state.statusArea!.controls.every(control => control.disabled));
});

test('new and resumed sessions use distinct display seeds but identical usage reads and reconciliation', async () => {
  for (const fresh of [true, false]) {
    const f = await fixture([], undefined, false, fresh);
    try {
      assert.equal(f.session.state.statusArea!.metrics, fresh ? '~$0.000 · 0% / —' : '— · — / —');
      assert.equal(f.sent.filter(request => ['usage', 'context'].includes(request.method)).map(request => request.method).join(','), 'usage,context');
      assert.match(f.session.state.statusArea!.metricsTitle!, fresh ? /Provisional new-session/ : /not been reported/);
      f.reply('context', null); await flush();
      assert.equal(f.session.state.statusArea!.metrics, fresh ? '~$0.000 · 0% / —' : '— · — / —', 'an uninitialized read preserves only a fresh zero seed');
      f.reply('usage', {}); await flush();
      assert.equal(f.session.state.statusArea!.metrics, fresh ? '~$0.000 · 0% / —' : '— · — / —');
      f.event('session.idle', {}); f.reply('usage', {}); f.reply('context', null); await flush();
      assert.equal(f.session.state.statusArea!.metrics, fresh ? '~$0.000 · 0% / —' : '— · — / —', 'a startup idle boundary is not work');
      f.event('assistant.turn_start', {});
      assert.equal(f.session.state.statusArea!.metrics, '— · — / —', 'both modes converge when live work starts');
      f.event('session.usage_info', { currentTokens: 31875, tokenLimit: 125000 });
      assert.equal(f.session.state.statusArea!.metrics, '— · 25.5% / 125k');
      assert.equal(f.sent.some(request => ['prompt', 'command', 'configure'].includes(request.method)), false);
    } finally { f.session.disconnect('fixture complete'); }
  }
});

test('accepted local Send retires untouched seeds before its result, while rejected drafts do not', async () => {
  const f = await fixture([], undefined, false, true);
  try {
    f.reply('usage', {}); f.reply('context', null); await flush();
    assert.equal(f.session.state.statusArea!.metrics, '~$0.000 · 0% / —');
    await f.session.handle({ type: 'prompt', id: 'empty', text: '' });
    assert.equal(f.session.state.statusArea!.metrics, '~$0.000 · 0% / —');
    assert.equal(f.sent.some(request => request.method === 'prompt'), false);
    const sending = f.session.handle({ type: 'prompt', id: 'local', text: 'Fixture only' });
    assert.equal(f.session.state.statusArea!.metrics, '— · — / —', 'do not await RPC acceptance to retire zeros');
    assert.equal(f.session.state.busy, true);
    assert.equal(f.sent.filter(request => request.method === 'prompt').length, 1);
    f.reply('prompt', { messageId: 'accepted' }); await sending;
    assert.equal(f.session.state.statusArea!.metrics, '— · — / —');
    f.event('session.idle', {});
    f.reply('usage', {}); f.reply('context', null); await flush();
    assert.equal(f.session.state.statusArea!.metrics, '— · — / —');
    assert.equal(f.sent.filter(request => request.method === 'prompt').length, 1, 'no prompt replay or hidden initialization work');
  } finally { f.session.disconnect('fixture complete'); }
});

test('a valid command Send also consumes the untouched seed without inventing model work', async () => {
  const f = await fixture([], undefined, false, true);
  try {
    f.reply('usage', {}); f.reply('context', null); await flush();
    f.session.receive({ kind: 'commands', commands: [{ name: 'status', kind: 'builtin' }] });
    const handling = f.session.handle({ type: 'command', id: 'status', text: '/status' });
    assert.equal(f.session.state.statusArea!.metrics, '— · — / —');
    f.reply('command', { kind: 'text', text: 'Fixture status' }); await handling;
    assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
    assert.equal(f.sent.some(request => request.method === 'prompt'), false);
  } finally { f.session.disconnect('fixture complete'); }
});

for (const [type, data, agentId] of [
  ['assistant.turn_start', {}, undefined],
  ['assistant.message_delta', { messageId: 'answer', deltaContent: 'Working' }, undefined],
  ['tool.execution_start', { toolCallId: 'child-tool', toolName: 'bash', arguments: {} }, 'child'],
] as const) {
  test(`live SDK activity retires untouched usage seeds (${type})`, async () => {
    const f = await fixture([], undefined, false, true);
    try {
      f.reply('usage', {}); f.reply('context', null); await flush();
      assert.equal(f.session.state.statusArea!.metrics, '~$0.000 · 0% / —');
      f.session.receive({ kind: 'event', event: { id: 'work', type, data, ...(agentId ? { agentId } : {}) } });
      assert.equal(f.session.state.statusArea!.metrics, '— · — / —');
      assert.equal(f.sent.some(request => request.method === 'prompt'), false);
    } finally { f.session.disconnect('fixture complete'); }
  });
}

test('SDK reconnect seeds context and credit snapshots independently without sending a new turn', async () => {
  const f = await fixture([], undefined, false);
  try {
    assert.equal(f.sent.some(request => request.method === 'context'), true);
    f.reply('usage', { totalNanoAiu: 69_100_000_000, aiCreditsStatus: 'complete' }); await flush();
    assert.equal(f.session.state.statusArea!.metrics, '~$0.691 · — / —');
    f.reply('context', { currentTokens: 31875, tokenLimit: 125000 }); await flush();
    assert.equal(f.session.state.statusArea!.metrics, '~$0.691 · 25.5% / 125k');
    assert.equal(f.sent.some(request => ['prompt', 'command', 'configure'].includes(request.method)), false);
    assert.deepEqual(f.completed, []);
  } finally { f.session.disconnect('fixture complete'); }
});

test('SDK usage consumes aggregate totals including child activity and never treats a request multiplier as USD', async () => {
  const f = await fixture([], undefined, false);
  try {
    assert.equal(f.last('usage').method, 'usage', 'connection reads totals for new/resumed sessions');
    f.reply('usage', { totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' }); await flush();
    f.event('session.usage_info', { currentTokens: 31875, tokenLimit: 125000 });
    assert.equal(f.session.state.statusArea!.metrics, '~$0.123 · 25.5% / 125k');
    assert.match(f.session.state.statusArea!.metricsTitle!, /12\.3 AIC/);
    const status = f.session.state.statusArea!;
    f.session.receive({ kind: 'event', event: { id: 'child-context', agentId: 'child', type: 'session.usage_info', data: { currentTokens: 999, tokenLimit: 999 } } });
    assert.equal(f.session.state.statusArea, status);
    const child = { id: 'child-accounting', agentId: 'child', type: 'assistant.usage', data: { model: 'child', cost: 999, inputTokens: 900000 } };
    f.session.receive({ kind: 'event', event: child });
    f.session.receive({ kind: 'event', event: child });
    f.event('assistant.usage', { model: 'small', cost: 999, inputTokens: 800000 });
    assert.equal(f.sent.filter(request => request.method === 'usage').length, 2, 'coalesce reads, including duplicate IDs');
    f.reply('usage', { totalNanoAiu: 999_000_000_000, aiCreditsStatus: 'complete' }); await flush();
    assert.equal(f.session.state.statusArea!.metrics, status.metrics, 'stale totals cannot flash while a newer read is owed');
    f.reply('usage', { totalNanoAiu: 24_600_000_000, aiCreditsStatus: 'partial' }); await flush();
    assert.equal(f.session.state.statusArea!.metrics, '≥$0.246 · 25.5% / 125k');
    assert.equal(f.session.state.statusArea!.controls, status.controls);
    assert.match(f.session.state.statusArea!.metricsTitle!, /24\.6 AIC reported subtotal/);
    f.event('session.idle', {});
    assert.equal(f.sent.filter(request => request.method === 'usage').length, 4, 'idle reconciles final accounting');
    assert.equal(f.sent.some(request => ['prompt', 'configure'].includes(request.method)), false);
    assert.deepEqual(f.completed, []);
  } finally { f.session.disconnect('fixture complete'); }
});

test('SDK busy configuration replaces one transcript operation and applies only the latest model at idle', async () => {
  const f = await fixture();
  f.event('assistant.turn_start', {});
  await f.session.selectPreference('model', async values => values[1]);
  const first = f.session.configuration.operations[0];
  assert.equal(first.phase, 'queued');
  assert.equal(f.sent.some(request => request.method === 'configure'), false);
  await f.session.selectPreference('model', async values => values[0]);
  await f.session.selectPreference('model', async values => values[1]);
  assert.equal(f.session.configuration.operations.length, 1);
  assert.equal(f.session.configuration.operations[0].key, first.key);
  assert.equal(f.session.state.statusArea!.controls[0].label, 'small');
  assert.ok(f.session.state.statusArea!.controls.every(control => !control.disabled));
  f.event('session.idle', {}); await flush();
  assert.equal(f.sent.filter(request => request.method === 'configure').length, 1);
  assert.equal(f.last('configure').setting, 'model');
  assert.equal(f.last('configure').value, 'large');
  assert.equal(f.session.state.statusArea!.controls[0].label, 'small', 'do not show requested model before confirmation');
  f.reply('configure', { modelId: 'large' }); await flush();
  assert.equal(f.session.state.statusArea!.controls[0].label, 'large');
  assert.equal(f.session.configuration.operations[0].phase, 'completed');
  assert.equal(f.session.state.configurationOperations, f.session.configuration.operations);
  assert.equal(f.sent.some(request => request.method === 'prompt'), false);
  f.session.disconnect('fixture complete');
});

test('SDK context changes fence old reads and refresh only after native configuration settles', async () => {
  const catalog = [{ ...models[0], capabilities: { limits: { max_context_window_tokens: 1_000_000 } } }];
  const f = await fixture([], undefined, false, false, catalog);
  try {
    f.reply('usage', {}); f.reply('context', { currentTokens: 100_000, tokenLimit: 128_000 }); await flush();
    assert.match(f.session.state.statusArea!.metrics!, /128k/);
    f.event('session.compaction_complete', {});
    const oldRead = f.last('context');
    await f.session.selectPreference('context-window', async values => values[1]); await flush();
    assert.equal(f.last('configure').value, 'long_context');
    f.event('session.model_change', { newModel: 'small', contextTier: 'long_context' });
    f.event('session.usage_info', { currentTokens: 100_000, tokenLimit: 128_000 });
    f.reply('context', { currentTokens: 100_000, tokenLimit: 128_000 }); await flush();
    assert.equal(f.last('context'), oldRead, 'no context RPC inside the configuration mutation');
    assert.doesNotMatch(f.session.state.statusArea!.metrics!, /128k/);
    assert.equal((await f.session.configuration.choices('context-tier'))[1].detail, '1M');
    f.reply('configure', { model: { modelId: 'small', contextTier: 'long_context' } }); await flush();
    assert.notEqual(f.last('context'), oldRead, 'settlement must refresh even when a native event outranked the result');
    f.reply('context', { currentTokens: 100_000, tokenLimit: 1_000_000 }); await flush();
    assert.match(f.session.state.statusArea!.metrics!, /10% \/ 1M/);
    assert.equal(f.session.configuration.operations[0].phase, 'completed');
    assert.equal((await f.session.configuration.choices('context-tier'))[1].detail, '1M');

    await f.session.selectPreference('context-window', async values => values[0]); await flush();
    f.event('session.model_change', { newModel: 'small', contextTier: 'default' });
    f.reply('configure', { model: { modelId: 'small', contextTier: 'default' } }); await flush();
    f.reply('context', { currentTokens: 100_000, tokenLimit: 128_000 }); await flush();
    assert.match(f.session.state.statusArea!.metrics!, /128k/);
    assert.equal((await f.session.configuration.choices('context-tier'))[1].detail, '1M');
    assert.equal(f.sent.some(request => request.method === 'prompt'), false);
  } finally { f.session.disconnect('fixture complete'); }
});

test('SDK dependent effort uses the pending target model and waits for its authoritative selection', async () => {
  const f = await fixture();
  f.event('session.model_change', { newModel: 'large' }); f.event('assistant.turn_start', {});
  await f.session.selectPreference('model', async values => values[0]);
  await f.session.selectPreference('thinking', async values => values[1]);
  assert.equal(f.session.state.statusArea!.controls[0].label, 'large');
  assert.equal(f.session.state.statusArea!.controls.length, 1);
  f.event('session.idle', {}); await flush();
  assert.equal(f.last('configure').setting, 'model');
  assert.equal(f.last('configure').value, 'small');
  f.reply('configure', { modelId: 'small', reasoningEffort: 'low' }); await flush();
  assert.equal(f.last('configure').setting, 'effort');
  assert.equal(f.last('configure').value, 'high');
  assert.equal(f.session.state.statusArea!.controls.find(control => control.id === 'thinking')!.label, 'low');
  f.reply('configure', { modelId: 'small', reasoningEffort: 'high' }); await flush();
  assert.equal(f.session.state.statusArea!.controls.find(control => control.id === 'thinking')!.label, 'high');
  assert.equal(f.session.configuration.operations.length, 1);
  assert.equal(f.session.configuration.operations[0].phase, 'completed');
  f.session.disconnect('fixture complete');
});

test('SDK disconnect cancels queued configuration and never replays it on a new owner', async () => {
  const f = await fixture(); f.event('assistant.turn_start', {});
  await f.session.selectPreference('model', async values => values[1]);
  f.session.disconnect('fixture disconnected');
  assert.equal(f.session.configuration.operations[0].phase, 'not-applied');
  assert.equal(f.sent.some(request => request.method === 'configure'), false);
  const replacement = await fixture();
  assert.deepEqual(replacement.session.configuration.operations, []);
  replacement.session.disconnect('fixture complete');
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
  assert.equal(f.session.state.statusArea?.controls.find(control => control.id === 'model')?.label, 'small');
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
