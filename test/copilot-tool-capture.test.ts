import assert from 'node:assert/strict';
import test from 'node:test';
import { CopilotSession } from '../src/copilot/session';
import type { BridgeRequest } from '../src/copilot/connection';
import { createToolCapture } from '../src/tool-capture';

const tick = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };
function fixture(enabled = true) {
  const sent: BridgeRequest[] = [], lines: string[] = [], errors: string[] = [];
  const capture = createToolCapture({
    write: async batch => {
      for (const line of batch) {
        const record = JSON.parse(line);
        assert.ok(record.sessionId, 'native storage rejects empty session identities');
        assert.equal(record.source.backend, 'copilot-sdk');
        assert.equal(record.source.agent, 'copilot');
      }
      lines.push(...batch);
    }, failure: message => errors.push(message), recovered() {},
  });
  capture.setEnabled(enabled);
  const session: CopilotSession = new CopilotSession(async request => {
    sent.push(request);
    if (request.method === 'decision') queueMicrotask(() => session.receive({ kind: 'result', id: request.id, result: null }));
  }, {
    publish() {}, changed() {}, identified() {}, disconnected() {}, completed() {}, notice: message => errors.push(message),
    decision: async kind => kind === 'permission' ? { kind: 'denied-interactively-by-user' } : { answer: 'private input', wasFreeform: true },
    toolCapture: capture,
  });
  const initializing = session.initialize('sdk-fixture');
  const reply = (method: string, result: unknown) => {
    const request = sent.find(request => request.method === method); assert.ok(request);
    session.receive({ kind: 'result', id: request.id, result });
  };
  return { session, capture, sent, lines, errors,
    async connect(events: unknown[] = []) {
      reply('initialize', { version: '1.0.98', protocolVersion: 3 }); await tick();
      session.receive({ kind: 'identified', sessionId: 'sdk-fixture' });
      session.receive({ kind: 'connected', sessionId: 'sdk-fixture', events, models: [], model: {} });
      reply('connect', null); await initializing;
    },
    close() { session.disconnect('offline capture fixture complete'); capture.dispose(); },
  };
}
const event = (id: string, type: string, data: Record<string, unknown>, agentId?: string) => ({
  id, type, data, timestamp: '2026-10-17T12:00:00.000Z', parentId: null, ...(agentId ? { agentId } : {}),
});

test('SDK native tool/input/permission lifecycle reaches the real JSONL sink without Pi/ACP translation', async () => {
  const f = fixture();
  try {
    await f.connect();
    const permission = { kind: 'url', toolCallId: 'web', url: 'https://example.test/docs', managedApprovalRequired: true };
    const result = { content: 'fixture result', detailedContent: 'additional detail', structuredContent: { arbitrary: [1, 2] } };
    const native = [
      event('delta', 'assistant.tool_call_delta', { toolCallId: 'web', toolName: 'web_fetch', inputDelta: '{"url":' }),
      event('start', 'tool.execution_start', { toolCallId: 'web', toolName: 'web_fetch', arguments: { url: permission.url } }),
      event('partial', 'tool.execution_partial_result', { toolCallId: 'web', partialOutput: 'first output' }),
      event('progress', 'tool.execution_progress', { toolCallId: 'web', progressMessage: 'Still working' }),
      event('shell', 'tool.shell_output', { toolCallId: 'web', sequence: 0, text: 'native output' }),
      event('requested', 'permission.requested', { requestId: 'permission-id', permissionRequest: permission, riskAssessment: { level: 'fixture' } }),
      event('completed', 'permission.completed', { requestId: 'permission-id', toolCallId: 'web', result: { kind: 'denied-interactively-by-user' }, decisionSource: 'human_response' }),
      event('result', 'tool.execution_complete', { toolCallId: 'web', success: true, result }),
      event('extension', 'tool.extension_specific', { toolCallId: 'custom', arbitrary: true }, 'child-agent'),
    ];
    for (const value of native) f.session.receive({ kind: 'event', event: value });
    f.session.receive({ kind: 'permission', id: 'callback', request: permission });
    f.session.receive({ kind: 'event', event: native[1] }); // Duplicate event ID, not another tool operation.
    await tick(); await f.capture.flush();
    const captured = f.lines.map(line => JSON.parse(line));
    assert.deepEqual(captured.map(record => record.event), [...native.map(value => value.type), 'permission.request']);
    assert.deepEqual(captured.slice(0, native.length).map(record => record.payload), native);
    assert.deepEqual(captured.at(-1).payload, permission);
    assert.equal(captured.find(record => record.event === 'permission.requested').toolCallId, 'web');
    assert.deepEqual(captured.find(record => record.event === 'tool.execution_complete').payload.data.result, result);
    assert.equal(captured.find(record => record.event === 'tool.extension_specific').payload.agentId, 'child-agent');
    assert.ok(captured.every(record => record.sessionId === 'sdk-fixture' && record.source.version === '1.0.98'));
    assert.equal(new Set(captured.map(record => record.connectionId)).size, 1);
    assert.deepEqual(captured.map(record => record.sequence), captured.map((_record, index) => index + 1));
    assert.ok(captured.every(record => record.schemaVersion === 1 && /Z$/.test(record.timestamp)));
    assert.deepEqual(f.errors, []);
    assert.ok(f.sent.every(request => !['prompt', 'cancel', 'configure'].includes(request.method)), 'logging never starts agent work');
  } finally { f.close(); }
});

test('SDK capture excludes replay, conversation text, reasoning and freeform input callbacks', async () => {
  const f = fixture();
  try {
    const saved = [
      event('saved-start', 'tool.execution_start', { toolCallId: 'old', toolName: 'view', arguments: { path: '/fixture' } }),
      event('saved-permission', 'permission.requested', { requestId: 'old-request', permissionRequest: { kind: 'read', toolCallId: 'old', path: '/fixture' } }),
      event('saved-completed', 'permission.completed', { requestId: 'old-request', result: { kind: 'approved' } }),
      event('saved-delta', 'assistant.tool_call_delta', { toolCallId: 'old', inputDelta: '{}' }),
    ];
    await f.connect(saved);
    for (const value of saved) f.session.receive({ kind: 'event', event: value });
    for (const value of [
      event('user', 'user.message', { content: 'private user message' }),
      event('answer', 'assistant.message', { messageId: 'answer', content: 'private answer' }),
      event('thinking', 'assistant.reasoning', { reasoningId: 'thinking', content: 'private reasoning' }),
    ]) f.session.receive({ kind: 'event', event: value });
    f.session.receive({ kind: 'input', id: 'input', request: { question: 'private question', allowFreeform: true } });
    await tick(); await f.capture.flush();
    assert.deepEqual(f.lines, []);
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('SDK capture is opt-in and snapshots payloads before subsequent caller mutations', async () => {
  const f = fixture(false);
  try {
    await f.connect();
    f.session.receive({ kind: 'event', event: event('off', 'tool.custom', { toolCallId: 'off' }) });
    f.session.receive({ kind: 'permission', id: 'off-permission', request: { kind: 'shell', toolCallId: 'off' } });
    await tick(); await f.capture.flush(); assert.deepEqual(f.lines, []);
    f.capture.setEnabled(true);
    const value = event('on', 'tool.custom', { toolCallId: 'on', arguments: { path: 'original' } });
    f.session.receive({ kind: 'event', event: value });
    (value.data.arguments as { path: string }).path = 'later';
    await f.capture.flush();
    assert.equal(JSON.parse(f.lines[0]).payload.data.arguments.path, 'original');
    assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});

test('early SDK permission callbacks get valid capture identity until the authoritative session is known', async () => {
  const f = fixture();
  try {
    f.session.receive({ kind: 'permission', id: 'early', request: { kind: 'shell', toolCallId: 'early-call', data: { toolCallId: 'not-the-callback-id' }, fullCommandText: 'fixture only' } });
    await tick(); await f.capture.flush();
    const early = JSON.parse(f.lines[0]);
    assert.match(early.sessionId, /^connecting:/); assert.equal(early.toolCallId, 'early-call');
    assert.equal(early.source.version, undefined);
    await f.connect();
    f.session.receive({ kind: 'event', event: event('live', 'tool.custom', { toolCallId: 'live' }) });
    await f.capture.flush();
    const live = JSON.parse(f.lines[1]);
    assert.equal(live.sessionId, 'sdk-fixture'); assert.equal(live.connectionId, early.connectionId);
    assert.equal(live.source.version, '1.0.98'); assert.deepEqual(f.errors, []);
  } finally { f.close(); }
});
