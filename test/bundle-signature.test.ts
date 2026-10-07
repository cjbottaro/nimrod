import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { validateSignature } from '../scripts/verify-macos-bundle';

const signed = 'Identifier=dev.nimrod.desktop\nCodeDirectory flags=0x2(adhoc)\nInfo.plist entries=14\nSealed Resources version=2 rules=13 files=4\n';

test('macOS bundles require a full application signature with matching identity', () => {
  assert.doesNotThrow(() => validateSignature(signed, 'dev.nimrod.desktop'));
  assert.doesNotThrow(() => validateSignature(signed.replace('0x2(adhoc)', '0x10000(runtime)'), 'dev.nimrod.desktop'));
  assert.throws(() => validateSignature(signed.replace('dev.nimrod.desktop', 'nimrod-random-linker-id'), 'dev.nimrod.desktop'), /identifier must match/);
  assert.throws(() => validateSignature(signed.replace('0x2(adhoc)', '0x20002(adhoc,linker-signed)'), 'dev.nimrod.desktop'), /linker-generated/);
  assert.throws(() => validateSignature(signed.replace('Info.plist entries=14', 'Info.plist=not bound'), 'dev.nimrod.desktop'), /bind Info.plist/);
  assert.throws(() => validateSignature(signed.replace('Sealed Resources version=2 rules=13 files=4', 'Sealed Resources=none'), 'dev.nimrod.desktop'), /seal bundle resources/);
});

test('local packaging config requests whole-bundle ad-hoc signing', () => {
  const config = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8'));
  assert.equal(config.bundle.macOS.signingIdentity, '-');
});
