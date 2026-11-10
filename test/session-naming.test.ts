import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionName } from '../src/session-naming';
import { copilotSessionName } from '../src/copilot/session-name';

test('session names trim outer whitespace but retain internal spacing and Unicode', () => {
  assert.equal(sessionName('  Review  café ✦  '), 'Review  café ✦');
});
test('Copilot initial and existing names share the SDK Unicode character limit', () => {
  assert.equal(copilotSessionName('  Review  '), 'Review');
  assert.equal(copilotSessionName('✦'.repeat(100)), '✦'.repeat(100));
  assert.equal(copilotSessionName('🦉'.repeat(100)), '🦉'.repeat(100));
  assert.throws(() => copilotSessionName('🦉'.repeat(101)), /at most 100/);
  assert.throws(() => copilotSessionName('bad\nname'), /single-line/);
});

test('session names reject blank, multiline and control characters', () => {
  for (const value of ['', '  ', 'a\nb', 'a\rb', 'a\tb', 'a\0b', 'a\u007fb']) {
    assert.throws(() => sessionName(value), /non-empty, single-line/);
  }
});
