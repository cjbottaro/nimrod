import assert from 'node:assert/strict';
import test from 'node:test';
import { startupAvailability } from '../src/harness-availability';

test('startup availability coalesces discovery and retains its snapshot until a new owner', async () => {
  let installed = false, calls = 0;
  const discover = async () => { calls++; return installed; };
  const availability = startupAvailability(discover);
  assert.equal(availability.available(), false);
  const first = availability.discover();
  assert.equal(availability.discover(), first);
  await first;
  installed = true;
  await availability.discover();
  assert.equal(calls, 1);
  assert.equal(availability.available(), false);
  const restarted = startupAvailability(discover);
  await restarted.discover();
  assert.equal(restarted.available(), true);
  installed = false;
  await restarted.discover();
  assert.equal(restarted.available(), true, 'uninstall does not invalidate the startup snapshot');
});

test('unexpected discovery failures remain failures, not silently classified as missing', async () => {
  const availability = startupAvailability(async () => { throw new Error('Native IPC failed'); });
  await assert.rejects(availability.discover(), /Native IPC failed/);
  assert.equal(availability.available(), false);
  await assert.rejects(availability.discover(), /Native IPC failed/);
});
