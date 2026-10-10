import assert from 'node:assert/strict';
import test from 'node:test';
import { COMMAND_USAGE_KEY, readCommandUsage, vscodeMruRanking } from '../src/command-ranking';
import { MemoryPreferences } from './preferences-fixture';

const commands = [{ id: 'a', label: 'Alpha' }, { id: 'c', label: 'Charlie' }, { id: 'b', label: 'Bravo' }];
test('MRU ranks used commands first regardless of frequency, then unused alphabetically without mutation', () => {
  const usage = [{ id: 'c', lastUsedAt: 10, useCount: 1 }, { id: 'a', lastUsedAt: 100, useCount: 200 }];
  const context = { query: '', usage };
  assert.deepEqual(vscodeMruRanking.rank(commands, context).map(c => c.id), ['c', 'a', 'b']);
  assert.deepEqual(vscodeMruRanking.rank(commands, { ...context, usage: [] }).map(c => c.id), ['a', 'b', 'c']);
  assert.deepEqual(vscodeMruRanking.rank(commands.slice(0, 1), context), [commands[0]], 'unmatched history IDs do not create results');
  assert.deepEqual(commands.map(c => c.id), ['a', 'c', 'b']);
  assert.deepEqual(usage.map(c => c.id), ['c', 'a']);
});
test('usage validates version, fields, duplicates and bounds', () => {
  assert.deepEqual(readCommandUsage(null), []);
  assert.deepEqual(readCommandUsage({ version: 2, entries: [] }), []);
  const entries = [null, {}, { id: 'bad', lastUsedAt: -1, useCount: 1 },
    ...Array.from({ length: 60 }, (_, n) => ({ id: String(n), lastUsedAt: 1, useCount: 1 }))];
  entries.splice(5, 0, entries[4]);
  const result = readCommandUsage({ version: 1, entries });
  assert.equal(result.length, 50);
  assert.equal(new Set(result.map(e => e.id)).size, 50);
});
test('shared persistence records repeated use and survives a fresh snapshot', async () => {
  const host = new MemoryPreferences();
  await host.commandUsage('a'); await host.commandUsage('a'); await host.commandUsage('b');
  const snapshot = await host.snapshot();
  const usage = readCommandUsage(snapshot.state[COMMAND_USAGE_KEY]);
  assert.deepEqual(usage.map(e => [e.id, e.useCount]), [['b', 1], ['a', 2]]);
  assert.deepEqual(vscodeMruRanking.rank(commands, { query: '', usage }).map(c => c.id), ['b', 'a', 'c']);
});
