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

test('idle-to-busy race adopts authoritative steering queue without duplicates', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('send', 'racing');
  transcript.snapshot([], ['racing']);
  assert.equal(transcript.project([]).length, 1);
  assert.equal(transcript.project([])[0].steeringStatus, 'sending');
  transcript.receipt('send', 'accepted');
  assert.equal(transcript.project([])[0].steeringStatus, 'pending');
});

test('cancelled local turns stay marked and cannot consume a later equal Pi message', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('cancelled', 'same');
  transcript.receipt('cancelled', 'cancelled');
  transcript.recover(['same']);
  const actual = user('actual', 'same');
  transcript.snapshot([actual]);
  assert.deepEqual(transcript.project([actual]).map(message => message.key), ['actual', 'steering:cancelled']);
  assert.equal(transcript.project([actual])[1].steeringStatus, 'cancelled');
});

test('actual user event before receipt removes the preview but does not acknowledge anything', () => {
  const transcript = new SteeringTranscript();
  transcript.begin('send', '  steer  ');
  const actual = user('actual', 'steer');
  transcript.snapshot([actual], []);
  transcript.receipt('send', 'accepted');
  assert.deepEqual(transcript.project([actual]), [{ ...actual, key: 'steering:send' }]);
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
