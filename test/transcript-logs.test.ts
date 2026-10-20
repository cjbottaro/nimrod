import assert from 'node:assert/strict';
import test from 'node:test';
import { createTranscriptLog, type TranscriptLogRecord } from '../src/transcript-logs';
import { PiTranscriptLog } from '../src/pi/transcript-logs';
import { PiTransport } from '../src/pi/transport';

const event = (payload: unknown = { args: { path: 'fixture' } }): TranscriptLogRecord => ({
  source: { backend: 'pi', agent: 'pi' }, sessionId: 'fixture-session', toolCallId: 'extension-call',
  event: 'tool_execution_start', payload,
});
function fixture(write?: (lines: string[]) => Promise<unknown>) {
  const batches: string[][] = [], errors: string[] = [];
  const capture = createTranscriptLog({ write: write ?? (async lines => { batches.push(lines); }), failure: error => errors.push(error), recovered() {} });
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
test('the independent diagnostic drain preserves accepted order through slow queue admission', async () => {
  const batches: string[][] = [];
  let finish!: () => void;
  const f = fixture(lines => {
    batches.push(lines);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  try {
    f.capture.setEnabled(true);
    for (let index = 0; index < 1100; index++) f.capture.append(event({ index }));
    const flushing = f.capture.flush();
    let done = false; void flushing.then(() => { done = true; });
    assert.deepEqual(batches.map(batch => batch.length), [512]);
    assert.equal(done, false);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(batches.map(batch => batch.length), [512, 512]);
    finish(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(batches.map(batch => batch.length), [512, 512, 76]);
    finish(); await Promise.resolve(); await Promise.resolve();
    await flushing;
    assert.equal(done, true);
    assert.deepEqual(batches.flat().map(line => JSON.parse(line).payload.index), Array.from({ length: 1100 }, (_, index) => index));
    assert.deepEqual(f.errors, []);
  } finally { f.capture.dispose(); }
});
test('a history burst within the bounded snapshot budget retains whole records', async () => {
  let finish!: () => void;
  const batches: string[][] = [];
  const f = fixture(lines => {
    batches.push(lines);
    return new Promise<void>(resolve => { finish = resolve; });
  });
  try {
    f.capture.setEnabled(true);
    for (let index = 0; index < 10; index++) f.capture.append(event({ index, text: 'x'.repeat(1024 * 1024) }));
    const flushing = f.capture.flush();
    assert.equal(batches.length, 1);
    for (let index = 0; index < 10; index++) {
      assert.equal(f.capture.enabled, true);
      finish(); await Promise.resolve(); await Promise.resolve();
    }
    await flushing;
    assert.deepEqual(f.errors, []);
    assert.equal(batches.length, 10);
    assert.deepEqual(batches.flat().map(line => JSON.parse(line).payload.index), Array.from({ length: 10 }, (_, index) => index));
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
test('large native events remain one exact record; unserializable records still fail visibly', async () => {
  const f = fixture();
  const payload = { text: 'x"\\\n\u{1f600}'.repeat(350_000) };
  f.capture.setEnabled(true); f.capture.append(event(payload));
  await f.capture.flush();
  const records = f.batches.flat().map(line => JSON.parse(line));
  assert.equal(records.length, 1);
  const restored = records[0];
  assert.deepEqual(restored.payload, payload);
  assert.equal(restored.event, event().event);
  assert.equal(f.errors.length, 0); assert.equal(f.capture.enabled, true);
  f.capture.append(event({ afterLargeEvent: true })); await f.capture.flush();
  assert.equal(JSON.parse(f.batches.flat().at(-1)!).sequence, 2);
  f.capture.append(event({ toJSON() { throw new Error('fixture serialization'); } }));
  assert.equal(f.errors.length, 1); assert.equal(f.capture.enabled, false); f.capture.dispose();
});
test('a synchronous storage failure stops logging without retry', async () => {
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
test('Pi packets and outgoing requests continue while diagnostic admission is blocked', async () => {
  let finish!: () => void;
  const f = fixture(() => new Promise<void>(resolve => { finish = resolve; }));
  const received: unknown[] = [], sent: unknown[] = [];
  f.capture.setEnabled(true);
  const rpc = new PiTransport(async message => { sent.push(message); });
  rpc.onEvent = packet => { received.push(packet); f.capture.append(event(packet)); };
  rpc.onTrace = (_name, packet) => f.capture.append(event(packet));
  rpc.receive({ kind: 'rpc', value: { type: 'first' } });
  const diagnostic = f.capture.flush();
  rpc.receive({ kind: 'rpc', value: { type: 'second' } });
  const request = rpc.request('get_state');
  assert.equal(received.length, 2, 'ordered semantic application never waits for logging');
  assert.equal(sent.length, 1, 'outgoing dispatch never waits for logging');
  rpc.receive({ kind: 'rpc', value: { type: 'response', id: 'nimrod-1', command: 'get_state', success: true } });
  await request;
  // Retire pending diagnostics before releasing the old admission promise.
  f.capture.setEnabled(false); finish(); await diagnostic; f.capture.dispose();
});

test('frontend queue overflow drops whole records, reports loss and leaves sequence gaps', async () => {
  const batches: string[][] = [], losses: number[] = [];
  const capture = createTranscriptLog({ write: async lines => { batches.push(lines); }, failure: message => assert.fail(message),
    recovered() {}, dropped: count => losses.push(count) });
  try {
    capture.setEnabled(true);
    for (let i = 0; i < 4200; i++) capture.append(event({ i }));
    // The full queue can reject without inspecting another potentially expensive payload.
    capture.append(event({ toJSON() { throw new Error('must not serialize dropped data'); } }));
    await capture.flush();
    assert.equal(capture.enabled, true); assert.equal(capture.droppedRecords, 105);
    assert.equal(batches.flat().length, 4096); assert.deepEqual(losses, [105]);
    capture.append(event({ afterGap: true })); await capture.flush();
    assert.equal(JSON.parse(batches.flat().at(-1)!).sequence, 4202);
    capture.append(event({ text: 'x'.repeat(17 * 1024 * 1024) })); await capture.flush();
    assert.equal(capture.droppedRecords, 106, 'oversized diagnostics are dropped whole, not truncated');
  } finally { capture.dispose(); }
});

test('loss notification does not wait for an already blocked diagnostic IPC', async () => {
  let release!: () => void;
  const losses: number[] = [];
  const capture = createTranscriptLog({ write: () => new Promise<void>(resolve => { release = resolve; }),
    failure: message => assert.fail(message), recovered() {}, dropped: count => losses.push(count) });
  let diagnostic: Promise<void> | undefined;
  try {
    capture.setEnabled(true); capture.append(event()); diagnostic = capture.flush();
    for (let i = 0; i < 4097; i++) capture.append(event({ i }));
    await new Promise(resolve => setTimeout(resolve, 75));
    assert.deepEqual(losses, [1]);
    assert.equal(capture.enabled, true);
  } finally { capture.setEnabled(false); release(); await diagnostic; capture.dispose(); }
});

test('native queue rejection is diagnostic loss, not a session failure or retry', async () => {
  const batches: string[][] = [], losses: number[] = [];
  let calls = 0;
  const capture = createTranscriptLog({ write: async lines => { calls++; if (calls === 1) return { accepted: false }; batches.push(lines); return { accepted: true }; },
    failure: message => assert.fail(message), recovered() {}, dropped: count => losses.push(count) });
  try {
    capture.setEnabled(true);
    for (let i = 0; i < 600; i++) capture.append(event({ i }));
    await capture.flush();
    assert.equal(calls, 2); assert.equal(capture.enabled, true);
    assert.deepEqual(losses, [512]); assert.equal(JSON.parse(batches[0][0]).sequence, 513);
  } finally { capture.dispose(); }
});

test('asynchronous native write errors retire only their originating capture', async () => {
  const f = fixture();
  try {
    f.capture.setEnabled(true); f.capture.append(event()); await f.capture.flush();
    const old = JSON.parse(f.batches[0][0]).captureId;
    f.capture.setEnabled(false); f.capture.setEnabled(true); f.capture.append(event()); await f.capture.flush();
    const current = JSON.parse(f.batches[1][0]).captureId;
    f.capture.writeFailed(old, 'old storage failure'); assert.equal(f.capture.enabled, true);
    f.capture.writeFailed(current, 'current storage failure'); assert.equal(f.capture.enabled, false);
    assert.equal(f.errors.length, 1);
  } finally { f.capture.dispose(); }
});

test('Pi transcript logs preserve native prose, reasoning, partial inputs and authoritative results', () => {
  const records: TranscriptLogRecord[] = [];
  const capture = new PiTranscriptLog({ enabled: true, append: record => { records.push(record); } });
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
  const capture = new PiTranscriptLog(f.capture);
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
