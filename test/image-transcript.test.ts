import assert from 'node:assert/strict';
import test from 'node:test';
import { SteeringTranscript, type SteeringMessage } from '../src/pi/steering-transcript';

const image = { type: 'image' as const, mimeType: 'image/png', data: 'YWJj' };
const normalized = { type: 'image' as const, mimeType: 'image/jpeg', data: 'ZGVm' };
const user = (key: string, text: string, images = [normalized]): SteeringMessage => ({ key, role: 'user', content: [{ type: 'text', text }, ...images] });

for (const mode of ['normal', 'steer', 'followUp'] as const) for (const text of ['', 'caption']) test(`${mode} image correlation adopts normalized bytes/text once (${text || 'image only'})`, () => {
  const projection = new SteeringTranscript();
  projection.begin('send', text, 'sending', [image], mode);
  const actual = user('actual', `${text}\n\nPi normalization hint`);
  projection.reconcile('send', 'actual');
  projection.snapshot([actual], [], []);
  projection.receipt('send', 'accepted');
  assert.deepEqual(projection.project([actual]), [{ ...actual, key: 'steering:send' }]);
  projection.snapshot([actual, { key: 'assistant', role: 'assistant', content: 'Working' }], [], []);
  assert.equal(projection.project([actual]).length, 1, 'streaming must not resurrect the original image preview');
});

test('correlation uses submission identity, not equal captions or older history', () => {
  const projection = new SteeringTranscript();
  const historical = user('historical', 'same');
  projection.snapshot([historical]);
  projection.begin('first', 'same', 'sending', [image], 'normal');
  projection.begin('second', 'same', 'sending', [image], 'normal');
  projection.reconcile('second', 'actual');
  const actual = user('actual', 'rewritten input');
  projection.snapshot([historical, actual]);
  const display = projection.project([historical, actual]);
  assert.deepEqual(display.map(message => message.key), ['historical', 'steering:second', 'steering:first']);
  assert.equal(display[2].steeringStatus, 'sending');
});

for (const outcome of ['rejected', 'cancelled'] as const) test(`${outcome} image previews cannot be consumed by a correlation packet`, () => {
  const projection = new SteeringTranscript();
  projection.begin('send', 'caption', 'sending', [image], 'normal');
  projection.receipt('send', outcome);
  projection.reconcile('send', 'actual');
  const actual = user('actual', 'caption');
  projection.snapshot([actual]);
  assert.deepEqual(projection.project([actual]).map(message => message.key), ['actual', 'steering:send']);
});

test('without explicit correlation, normalization and caption-only history never infer image delivery', () => {
  const projection = new SteeringTranscript();
  projection.begin('send', 'caption', 'sending', [image], 'normal');
  projection.receipt('send', 'accepted');
  projection.snapshot([user('other-image', 'caption'), user('caption-only', 'caption', [])]);
  assert.equal(projection.project([]).length, 1);
  projection.reconcile('unknown-id', 'other-image');
  assert.equal(projection.project([]).length, 1);
});
