import assert from 'node:assert/strict';
import test from 'node:test';
import { ConfigurationTranscript } from '../src/configuration-transcript';
import type { RenderMessage } from '../src/conversation-view-host';

const operation = { key: 'configuration:fixture', phase: 'queued' as const, title: 'Configuration change', text: 'Model: b' };
const message = (key: string): RenderMessage => ({ key, role: 'assistant', content: key });
const noHistory = (): never => assert.fail('unchanged or pending operations must not read history');

for (const phase of ['completed', 'failed', 'unknown', 'not-applied'] as const) {
  test(`${phase} configuration in an empty transcript stays before future messages and pending work`, () => {
    const transcript = new ConfigurationTranscript();
    transcript.sync([operation], noHistory);
    const terminal = { ...operation, phase, title: 'Terminal configuration' };
    const pending = { ...operation, key: 'configuration:next' };
    transcript.sync([terminal, pending], () => []);
    // No intervening paint: future output must not become the terminal anchor.
    const future = message('future');
    const queued: RenderMessage = { key: 'queued', role: 'user', sticky: true };
    const first = transcript.project([future, queued]);
    assert.deepEqual(first.map(row => row.key), [operation.key, 'future', 'queued', pending.key]);
    assert.equal(first[0].sticky, false);
    assert.equal(first.at(-1)?.sticky, true);
    const later = transcript.project([future, message('later'), queued]);
    assert.deepEqual(later.map(row => row.key), [operation.key, 'future', 'later', 'queued', pending.key]);
    assert.equal(later[0], first[0]);
  });
}

test('terminal anchors capture the ordered snapshot once, excluding sticky queued turns', () => {
  const transcript = new ConfigurationTranscript();
  transcript.sync([operation], noHistory);
  const native = message('native');
  const queued = { key: 'queued', role: 'user', sticky: true };
  let reads = 0;
  const terminal = { ...operation, phase: 'completed' as const };
  const operations = [terminal, { ...terminal, key: 'configuration:effort' }];
  transcript.sync(operations, () => { reads++; return [native, queued]; });
  assert.equal(reads, 1, 'one tail capture per terminal snapshot, not per operation');
  transcript.sync(operations, noHistory);
  transcript.sync(operations.map(entry => ({ ...entry, title: 'Confirmed' })), noHistory);
  assert.deepEqual(transcript.project([native, message('future'), queued]).map(row => row.key),
    ['native', operation.key, 'configuration:effort', 'future', 'queued']);
});

test('an explicit pre-result boundary keeps an operation before its own output', () => {
  const transcript = new ConfigurationTranscript();
  const before = message('before'), output = message('command-output');
  const command = { ...operation, key: 'command', title: 'Copilot command', settlementAnchor: before.key };
  transcript.sync([command], noHistory);
  transcript.sync([{ ...command, phase: 'completed' }], () => assert.fail('explicit settlement anchors must not read current history'));
  assert.deepEqual(transcript.project([before, output]).map(row => row.key), [before.key, command.key, output.key]);
});

test('an explicit empty boundary keeps an operation before its first output', () => {
  const transcript = new ConfigurationTranscript();
  const output = message('command-output');
  const command = { ...operation, key: 'command', title: 'Copilot command', settlementAnchor: null };
  transcript.sync([command], noHistory);
  transcript.sync([{ ...command, phase: 'completed' }], () => assert.fail('explicit settlement anchors must not read current history'));
  assert.deepEqual(transcript.project([output]).map(row => row.key), [command.key, output.key]);
});

test('a removed explicit boundary falls back before output rather than after it', () => {
  const transcript = new ConfigurationTranscript();
  const output = message('command-output');
  const command = { ...operation, key: 'command', title: 'Copilot command', settlementAnchor: 'removed' };
  transcript.sync([command], noHistory);
  transcript.sync([{ ...command, phase: 'completed' }], () => assert.fail('explicit settlement anchors must not read current history'));
  assert.deepEqual(transcript.project([output]).map(row => row.key), [command.key, output.key]);
});

for (const remaining of [[], [message('replacement')]]) {
  test(`removed anchors settle at ${remaining.length ? 'remaining tail' : 'empty start'} rather than following future output`, () => {
    const transcript = new ConfigurationTranscript();
    transcript.sync([{ ...operation, phase: 'completed' }], () => [message('removed')]);
    assert.deepEqual(transcript.project(remaining).map(row => row.key), [...remaining.map(row => row.key), operation.key]);
    assert.deepEqual(transcript.project([...remaining, message('future')]).map(row => row.key),
      [...remaining.map(row => row.key), operation.key, 'future']);
  });
}
