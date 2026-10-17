import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolCapture, type ToolCaptureRecord } from '../src/tool-capture';
import { PiToolCapture } from '../src/pi/tool-capture';
import { PiTransport } from '../src/pi/transport';

const event = (payload: unknown = { args: { path: 'fixture' } }): ToolCaptureRecord => ({
  source: { backend: 'pi', agent: 'pi' }, sessionId: 'fixture-session', toolCallId: 'extension-call',
  event: 'tool_execution_start', payload,
});
function fixture(write?: (lines: string[]) => Promise<unknown>) {
  const batches: string[][] = [], errors: string[] = [];
  const capture = createToolCapture({ write: write ?? (async lines => { batches.push(lines); }), failure: error => errors.push(error), recovered() {} });
  return { capture, batches, errors };
}
test('disabled capture never reads payloads; enabled capture snapshots native data and stamps ordered records', async () => {
  const f = fixture();
  try {
    f.capture.append(event({ toJSON() { throw new Error('must not inspect disabled data'); } }));
    await f.capture.flush(); assert.equal(f.batches.length, 0);
    f.capture.setEnabled(true);
    const payload = { args: { path: 'original' } };
    f.capture.append(event(payload)); payload.args.path = 'later mutation';
    f.capture.append({ ...event(), source: { backend: 'acp', agent: 'fixture-agent', version: 'fixture' } });
    await f.capture.flush();
    const records = f.batches.flat().map(line => JSON.parse(line));
    assert.equal(records.length, 2);
    assert.equal(records[0].payload.args.path, 'original');
    assert.equal(records[0].schemaVersion, 1);
    assert.match(records[0].timestamp, /^\d{4}-\d{2}-\d{2}T.*Z$/);
    assert.deepEqual(records.map(r => r.sequence), [1, 2]);
    assert.equal(records[0].captureId, records[1].captureId);
    assert.deepEqual(records[1].source, { backend: 'acp', agent: 'fixture-agent', version: 'fixture' });
  } finally { f.capture.dispose(); }
});
test('synchronous replay bursts span bounded native batches instead of stopping at 512 events', async () => {
  const f = fixture();
  try {
    f.capture.setEnabled(true);
    for (let index = 0; index < 600; index++) f.capture.append(event({ index }));
    await f.capture.flush(); await f.capture.flush();
    assert.equal(f.capture.enabled, true);
    assert.deepEqual(f.batches.map(batch => batch.length), [512, 88]);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.batches.flat().map(line => JSON.parse(line).payload.index), Array.from({ length: 600 }, (_, index) => index));
  } finally { f.capture.dispose(); }
});
test('large bursts dispatch early and drain subsequent batches without another debounce', async () => {
  const batches: string[][] = [];
  let finish!: () => void;
  const f = fixture(lines => {
    batches.push(lines);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  try {
    f.capture.setEnabled(true);
    for (let index = 0; index < 1100; index++) f.capture.append(event({ index }));
    assert.deepEqual(batches.map(batch => batch.length), [512], 'first batch dispatches during synchronous replay');
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(batches.map(batch => batch.length), [512, 512]);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(batches.map(batch => batch.length), [512, 512, 76]);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(batches.flat().map(line => JSON.parse(line).payload.index), Array.from({ length: 1100 }, (_, index) => index));
    assert.deepEqual(f.errors, []);
  } finally { f.capture.dispose(); }
});
test('byte pressure starts a write before the pending buffer fills and real overflow stays explicit', async () => {
  let finish!: () => void;
  const batches: string[][] = [];
  const f = fixture(lines => {
    batches.push(lines);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  try {
    f.capture.setEnabled(true);
    f.capture.append(event('x'.repeat(1024 * 1024)));
    assert.equal(batches.length, 1);
    assert.equal(f.capture.enabled, true);
    for (let index = 0; index < 9; index++) f.capture.append(event('x'.repeat(1024 * 1024)));
    assert.equal(f.capture.enabled, false);
    assert.equal(f.errors.length, 1);
    assert.match(f.errors[0], /Conversation unaffected.*pending buffer/);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.equal(batches.length, 1, 'overflow never retries the ambiguous in-flight batch');
  } finally { f.capture.dispose(); }
});

test('write failures stop capture without retry; re-enabling creates a new segment', async () => {
  let writes = 0;
  const f = fixture(async () => { writes++; throw new Error('fixture disk full'); });
  f.capture.setEnabled(true); f.capture.append(event()); await f.capture.flush();
  assert.equal(f.capture.enabled, false); assert.equal(f.errors.length, 1);
  assert.match(f.errors[0], /Nothing was retried/);
  f.capture.append(event()); await f.capture.flush(); assert.equal(writes, 1);
  f.capture.setEnabled(false); f.capture.setEnabled(true); assert.equal(f.capture.enabled, true);
  f.capture.dispose();
});
test('disable drops undispatched buffers; a previous generation cannot fail a newly enabled capture', async () => {
  let reject!: (error: Error) => void;
  const f = fixture(() => new Promise((_resolve, fail) => { reject = fail; }));
  f.capture.setEnabled(true); f.capture.append(event());
  const writing = f.capture.flush();
  f.capture.setEnabled(false); f.capture.setEnabled(true);
  reject(new Error('old failure')); await writing;
  assert.equal(f.capture.enabled, true); assert.deepEqual(f.errors, []);
  f.capture.append(event()); f.capture.setEnabled(false); await f.capture.flush();
  f.capture.dispose();
});
test('oversized records are losslessly chunked; unserializable records still fail visibly', async () => {
  const f = fixture();
  const payload = { text: 'x"\\\n\u{1f600}'.repeat(350_000) };
  f.capture.setEnabled(true); f.capture.append(event(payload));
  await f.capture.flush();
  const chunks = f.batches.flat().map(line => JSON.parse(line));
  assert.ok(chunks.length > 1);
  assert.ok(chunks.every(chunk => chunk.event === 'capture.record_chunk'));
  assert.deepEqual(chunks.map(chunk => chunk.payload.index), Array.from({ length: chunks.length }, (_, index) => index));
  assert.ok(chunks.every(chunk => chunk.payload.count === chunks.length && chunk.payload.recordId === chunks[0].payload.recordId));
  assert.deepEqual(chunks.map(chunk => chunk.sequence), Array.from({ length: chunks.length }, (_, index) => index + 1));
  const restored = JSON.parse(chunks.map(chunk => chunk.payload.data).join(''));
  assert.deepEqual(restored.payload, payload);
  assert.equal(restored.event, event().event);
  assert.equal(f.errors.length, 0); assert.equal(f.capture.enabled, true);
  f.capture.append(event({ afterChunks: true })); await f.capture.flush();
  assert.equal(JSON.parse(f.batches.flat().at(-1)!).sequence, chunks.length + 1);
  f.capture.append(event({ toJSON() { throw new Error('fixture serialization'); } }));
  assert.equal(f.errors.length, 1); assert.equal(f.capture.enabled, false); f.capture.dispose();
});
test('a synchronous storage failure stops oversized-event chunking immediately', async () => {
  let writes = 0;
  const f = fixture(() => { writes++; throw new Error('fixture synchronous failure'); });
  try {
    f.capture.setEnabled(true);
    f.capture.append(event('x'.repeat(3 * 1024 * 1024)));
    await f.capture.flush();
    assert.equal(f.capture.enabled, false);
    assert.equal(writes, 1);
    assert.equal(f.errors.length, 1);
  } finally { f.capture.dispose(); }
});
test('Pi transcript logs preserve native prose, reasoning, partial inputs and authoritative results', () => {
  const records: ToolCaptureRecord[] = [];
  const capture = new PiToolCapture({ enabled: true, append: record => { records.push(record); } });
  const observe = (value: Record<string, unknown>) => capture.observe(value, 'pi-session');
  observe({ type: 'message_start', message: { role: 'assistant', content: [] } });
  observe({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: 'private reasoning' } });
  observe({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: 'custom', toolName: 'my_extension', partial: { content: ['private prose'] } } });
  observe({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_delta', contentIndex: 1, delta: '{"value":', partial: { content: ['private reasoning'] } } });
  observe({ type: 'tool_execution_start', toolCallId: 'custom', toolName: 'my_extension', args: { value: 1 } });
  observe({ type: 'tool_execution_update', toolCallId: 'custom', partialResult: { data: [1] } });
  observe({ type: 'tool_execution_end', toolCallId: 'custom', result: { customMetadata: { arbitrary: true } } });
  observe({ type: 'message_end', message: { role: 'toolResult', toolCallId: 'custom', content: [{ type: 'text', text: 'result' }] } });
  assert.equal(records.length, 8);
  assert.ok(records.every(r => r.sessionId === 'pi-session'));
  assert.equal(records[2].toolCallId, 'custom');
  assert.equal(records[3].toolCallId, 'custom');
  assert.equal(JSON.stringify(records).includes('private reasoning'), true);
  assert.equal(JSON.stringify(records).includes('private prose'), true);
  assert.deepEqual((records[6].payload as Record<string, unknown>).result, { customMetadata: { arbitrary: true } });
});

test('Pi transport traces requests, history responses and extension choices without issuing work', async () => {
  const f = fixture();
  const sent: Record<string, unknown>[] = [];
  const rpc = new PiTransport(async message => { sent.push(message); });
  const capture = new PiToolCapture(f.capture);
  rpc.onTrace = (event, payload) => capture.capture(event, payload, 'pi-session');
  rpc.onEvent = event => capture.observe(event, 'pi-session');
  try {
    f.capture.setEnabled(true);
    const history = rpc.request('get_messages');
    const response = { type: 'response', id: sent[0].id, command: 'get_messages', success: true,
      data: { messages: [{ role: 'assistant', content: [{ type: 'text', text: '' }] }] } };
    rpc.receive({ kind: 'rpc', value: response });
    await history;
    await rpc.respond({ id: 'choice', value: 'typed answer' });
    rpc.disconnect('fixture disconnect');
    await f.capture.flush();
    const records = f.batches.flat().map(line => JSON.parse(line));
    assert.deepEqual(records.map(record => record.event), ['request.get_messages', 'response.get_messages', 'request.extension_ui_response', 'process_error']);
    assert.deepEqual(records[1].payload, response);
    assert.equal(records[2].payload.value, 'typed answer');
    assert.equal(sent.length, 2, 'capture does not request snapshots or send prompts');
  } finally { f.capture.dispose(); }
});
