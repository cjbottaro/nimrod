import assert from 'node:assert/strict';
import test from 'node:test';
import { SteeringTranscript, type SteeringMessage } from '../src/pi/steering-transcript';

const user = (key: string, content: string): SteeringMessage => ({ key, role: 'user', content });

test('identical steers reconcile FIFO and never match existing history', () => {
  const transcript = new SteeringTranscript();
  const old = user('old', 'repeat');
  transcript.snapshot([old]);
  transcript.begin('first', 'repeat');
  transcript.receipt('first', 'accepted');
  transcript.begin('second', 'repeat');
  transcript.snapshot([old], ['repeat', 'repeat']);
  assert.deepEqual(transcript.project([old]).map(message => message.key), ['old', 'steering:first', 'steering:second']);
  const first = user('first', 'repeat');
  transcript.snapshot([old, first], ['repeat']);
  assert.deepEqual(transcript.project([old, first]).map(message => message.key), ['old', 'steering:first', 'steering:second']);
  transcript.snapshot([old, first], []);
  const second = user('second', 'repeat');
  transcript.snapshot([old, first, second], []);
  assert.deepEqual(transcript.project([old, first, second]).map(message => message.key), ['old', 'steering:first', 'steering:second']);
  assert.ok(transcript.project([old, first, second]).every(message => !message.steeringStatus));
});

test('idle sends retain FIFO identity and handle disconnect', () => {
  const transcript = new SteeringTranscript();
  const old = user('old', 'repeat');
  transcript.snapshot([old]);
  transcript.begin('first', 'repeat');
  transcript.begin('second', 'repeat');
  transcript.receipt('second', 'accepted');
  assert.deepEqual(transcript.project([old]).map(message => message.steeringStatus), [undefined, 'sending', 'pending']);
  const actual = user('actual', 'repeat');
  transcript.snapshot([old, actual]);
  transcript.receipt('first', 'accepted');
  assert.deepEqual(transcript.project([old, actual]).map(message => message.key), ['old', 'steering:first', 'steering:second']);
  transcript.disconnect();
  assert.equal(transcript.project([old, actual])[2].steeringStatus, 'interrupted');
});

test('presentation distinguishes explicit steering from ordinary sends without changing queue matching', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('ordinary', 'idle race', 'sending', undefined, 'normal');
  transcript.begin('steer', 'change course', 'sending', undefined, 'steer');
  transcript.snapshot([], ['idle race', 'change course']);
  assert.equal(transcript.project([])[0].steering, undefined);
  assert.equal(transcript.project([])[1].steering, true);
  assert.equal(transcript.project([]).length, 2);
  transcript.receipt('steer', 'accepted');
  assert.equal(transcript.project([])[1].steeringStatus, 'pending');
});

test('idle-to-busy race adopts authoritative steering queue without duplicates', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('send', 'racing');
  transcript.snapshot([], ['racing']);
  assert.equal(transcript.project([]).length, 1);
  assert.equal(transcript.project([])[0].steeringStatus, 'sending');
  transcript.receipt('send', 'accepted');
  assert.equal(transcript.project([])[0].steeringStatus, 'pending');
});

test('confirmed user cancellation removes the local turn without consuming a later equal Pi message', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('cancelled', 'same');
  transcript.receipt('cancelled', 'cancelled');
  transcript.recover(['same']);
  const actual = user('actual', 'same');
  transcript.snapshot([actual]);
  assert.deepEqual(transcript.project([actual]).map(message => message.key), ['actual']);
});

test('actual user event before receipt removes the preview but does not acknowledge anything', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('send', '  steer  ');
  const actual = user('actual', 'steer');
  transcript.snapshot([actual], []);
  transcript.receipt('send', 'accepted');
  assert.deepEqual(transcript.project([actual]), [{ ...actual, key: 'steering:send', operation: { title: 'Steering', state: 'succeeded', details: undefined } }]);
});

test('authoritative queue text appears once, survives dequeue-before-consumption, and clears by occurrence', () => {
  const transcript = new SteeringTranscript();
  transcript.snapshot([], ['same', 'same']);
  transcript.snapshot([], ['same', 'same']);
  assert.equal(transcript.project([]).length, 2);
  transcript.snapshot([], []);
  assert.equal(transcript.project([]).length, 2);
  transcript.recover(['same']);
  assert.equal(transcript.project([]).length, 1);
  transcript.recover(['same']);
  assert.equal(transcript.project([]).length, 0);
});

test('disconnect distinguishes unconfirmed delivery from unknown acceptance; rejected turns remain marked and never consume Pi history', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('send', 'sending');
  transcript.snapshot([], ['queued']);
  transcript.begin('failed', 'failed');
  transcript.receipt('failed', 'rejected');
  transcript.disconnect();
  assert.deepEqual(transcript.project([]).map(message => message.steeringStatus), ['unknown', 'interrupted', 'rejected']);
  transcript.snapshot([user('other', 'failed')]);
  assert.equal(transcript.project([user('other', 'failed')]).length, 4);
});

test('follow-ups reconcile duplicate occurrences without adopting identical steering queue entries', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('queued', 'same', 'sending', undefined, 'followUp');
  transcript.snapshot([], ['same'], ['same', 'same']);
  assert.equal(transcript.project([]).length, 3);
  assert.equal(transcript.project([]).filter(message => message.sticky).length, 3);
  transcript.receipt('queued', 'accepted');
  transcript.snapshot([], [], []);
  assert.equal(transcript.project([]).filter(message => message.sticky).length, 3);
  transcript.recover(['same'], 'followUp');
  assert.equal(transcript.project([]).filter(message => message.sticky).length, 2);
  transcript.recover(['same'], 'followUp');
  assert.equal(transcript.project([]).length, 1);
  assert.equal(transcript.project([])[0].queued, undefined);
});

test('steering overtakes an identical follow-up without unpinning it', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('queued', 'same', 'sending', undefined, 'followUp');
  transcript.begin('steer', 'same');
  transcript.snapshot([], ['same'], ['same']);
  transcript.snapshot([], [], ['same']);
  const actual = user('actual', 'same');
  transcript.snapshot([actual], [], ['same']);
  assert.equal(transcript.project([actual])[0].key, 'steering:steer');
  assert.equal(transcript.project([actual])[1].key, 'steering:queued');
  assert.equal(transcript.project([actual])[1].sticky, true);
});

test('follow-up user event before receipt adopts identity and unpins without duplication', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('queued', 'later', 'sending', undefined, 'followUp');
  const actual = user('actual', 'later');
  transcript.snapshot([actual], [], []);
  transcript.receipt('queued', 'accepted');
  assert.deepEqual(transcript.project([actual]), [{ ...actual, key: 'steering:queued', operation: { title: 'Queued', state: 'succeeded', details: undefined } }]);
});

for (const outcome of ['rejected', 'unknown'] as const) test(`follow-up ${outcome} unpins but retains its status`, () => {
  const transcript = new SteeringTranscript();
  transcript.begin('queued', 'later', 'sending', undefined, 'followUp');
  transcript.receipt('queued', outcome);
  assert.equal(transcript.project([])[0].sticky, false);
  assert.equal(transcript.project([])[0].steeringStatus, outcome);
});

test('disconnection unpins before later output and a late receipt cannot revive shimmer', () => {
  const transcript = new SteeringTranscript();
  transcript.snapshot([]);
  transcript.begin('pending', 'Change course');
  transcript.disconnect();
  assert.equal(transcript.hasConnectionOutcome, true);
  transcript.receipt('pending', 'accepted');
  const future = user('future', 'Other content');
  transcript.snapshot([future]);
  const rows = transcript.project([future]);
  assert.deepEqual(rows.map(row => row.key), ['steering:pending', 'future']);
  assert.equal(rows[0].operation?.state, 'unknown'); assert.equal(rows[0].sticky, false);
  const actual = user('actual', 'Change course');
  transcript.snapshot([future, actual]);
  assert.equal(transcript.project([future, actual])[1].operation?.state, 'succeeded');
});

test('follow-up disconnect unpins and image-bearing queue recovery matches text-only occurrences', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('queued', '', 'sending', [{ type: 'image', mimeType: 'image/png', data: 'abc' }], 'followUp');
  transcript.snapshot([], [], ['']);
  assert.equal(transcript.project([]).length, 1);
  transcript.receipt('queued', 'accepted');
  transcript.disconnect();
  assert.equal(transcript.project([])[0].sticky, false);
  assert.equal(transcript.project([])[0].steeringStatus, 'interrupted');
  transcript.recover([''], 'followUp');
  assert.equal(transcript.project([]).length, 0);
});
