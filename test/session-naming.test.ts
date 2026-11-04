import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionName } from '../src/session-naming';

test('session names trim outer whitespace but retain internal spacing and Unicode', () => {
  assert.equal(sessionName('  Review  café ✦  '), 'Review  café ✦');
});
test('session names reject blank, multiline and control characters', () => {
  for (const value of ['', '  ', 'a\nb', 'a\rb', 'a\tb', 'a\0b', 'a\u007fb']) {
    assert.throws(() => sessionName(value), /non-empty, single-line/);
  }
});
