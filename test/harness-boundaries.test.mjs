import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { checkHarnessBoundaries } from '../scripts/check-harness-boundaries.mjs';

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), 'nimrod-harness-boundary-'));
  for (const [path, source] of Object.entries(files)) { const target = join(root, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, source); }
  return { root, dispose: () => rmSync(root, { recursive: true }) };
}
test('new integration directories automatically become private to shared consumers, including type imports and exports', () => {
  const f = fixture({ 'src/new-agent/integration.ts': 'export {};',
    'src/main.ts': "import type { Client } from './new-agent/client';\nexport { Native } from './new-agent/native';" });
  try { const failures = checkHarnessBoundaries(f.root); assert.equal(failures.length, 2); assert.ok(failures.every(failure => failure.includes('integration authority'))); }
  finally { f.dispose(); }
});
test('shell-native bypasses and backend discrimination are rejected without a known harness list', () => {
  const f = fixture({ 'src/main.ts': "invoke('start_new_agent');\nconst phase = tab.backend.kind;" });
  try { const failures = checkHarnessBoundaries(f.root); assert.equal(failures.length, 2); }
  finally { f.dispose(); }
});
test('explicit composition and inherited shared presentation remain permitted', () => {
  const f = fixture({ 'src/pi/integration.ts': 'export {};', 'src/pi/session.ts': 'export {};', 'src/future/integration.ts': 'export {};',
    'src/bundled-harnesses.ts': "import './future/integration';", 'src/main.ts': "import './pi/transcript.css';\nimport './future/session.css';\nimport './pi/composer-dom';\nimport './harness-contract';" });
  try { assert.deepEqual(checkHarnessBoundaries(f.root), []); }
  finally { f.dispose(); }
});
test('legacy Pi protocol authority is still forbidden in shared application code', () => {
  const f = fixture({ 'src/pi/integration.ts': 'export {};', 'src/consumer.ts': "import './pi/session';\nimport './pi/transport';\nimport './pi/view-policy';" });
  try { assert.equal(checkHarnessBoundaries(f.root).length, 3); }
  finally { f.dispose(); }
});
