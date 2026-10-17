import assert from 'node:assert/strict';
import test from 'node:test';
import { createToolCapture, type ToolCaptureRecord } from '../src/tool-capture';
import { PiToolCapture } from '../src/pi/tool-capture';

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
test('oversized and unserializable records fail visibly rather than truncating tool payloads', async () => {
  const f = fixture();
  f.capture.setEnabled(true); f.capture.append(event('x'.repeat(2 * 1024 * 1024)));
  assert.equal(f.errors.length, 1); assert.equal(f.capture.enabled, false);
  await f.capture.flush(); assert.equal(f.batches.length, 0);
  f.capture.setEnabled(false); f.capture.setEnabled(true);
  f.capture.append(event({ toJSON() { throw new Error('fixture serialization'); } }));
  assert.equal(f.errors.length, 2); f.capture.dispose();
});
test('Pi captures extension tools, partial input and authoritative results without assistant prose or reasoning', () => {
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
  assert.equal(records.length, 6);
  assert.ok(records.every(r => r.toolCallId === 'custom' && r.sessionId === 'pi-session'));
  assert.equal(JSON.stringify(records).includes('private'), false);
  assert.deepEqual((records[4].payload as Record<string, unknown>).result, { customMetadata: { arbitrary: true } });
});
