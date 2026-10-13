import assert from 'node:assert/strict';
import test from 'node:test';
import { installAppearanceEffects } from '../src/window-appearance-effects';
import type { AppearanceCapabilities } from '../src/window-appearance';
const capabilities: AppearanceCapabilities = { platform: 'macos', transparency: true, frost: true, reducedTransparency: false };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('one native pipeline orders material before tint, serializes stages and coalesces latest targets', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = []; let active = 0, maximum = 0;
  const effects = installAppearanceEffects({
    apply: async (_frosted, dark) => { maximum = Math.max(maximum, ++active); calls.push('material:' + dark); --active; return capabilities; },
    tintTitlebar: async color => { maximum = Math.max(maximum, ++active); calls.push('tint:' + color[0]); if (calls.length === 2) await gate; --active; },
    report: () => {},
  }, () => {});
  try {
    effects.request({ material: { frosted: true, dark: true }, tint: [10, 20, 30, 128] });
    await tick(); assert.deepEqual(calls, ['material:true', 'tint:10']);
    effects.request({ material: { frosted: true, dark: false }, tint: [20, 20, 30, 128] });
    effects.request({ material: { frosted: false, dark: false }, tint: [30, 20, 30, 128] });
    await tick(); assert.equal(calls.length, 2); release(); await effects.settled();
    assert.deepEqual(calls, ['material:true', 'tint:10', 'material:false', 'tint:30']);
    assert.equal(maximum, 1);
    for (let i = 0; i < 200; i++) effects.request({ material: { frosted: false, dark: false }, tint: [30, 20, 30, 128] });
    await effects.settled(); assert.equal(calls.length, 4);
  } finally { release(); effects.dispose(); }
});

test('failed stages are not repeated by unchanged requests or native refresh', async () => {
  let tints = 0; const failures: string[] = [];
  const effects = installAppearanceEffects({
    apply: async () => capabilities,
    tintTitlebar: async color => { tints++; if (color[0] === 20) throw new Error('unavailable'); },
    report: message => { if (message) failures.push(message); },
  }, () => {});
  try {
    effects.request({ tint: [10, 0, 0, 255] }); await effects.settled();
    effects.request({ tint: [20, 0, 0, 255] }); await effects.settled();
    for (let i = 0; i < 200; i++) effects.request({ tint: [20, 0, 0, 255] });
    effects.refreshTint(); await effects.settled();
    assert.equal(tints, 2); assert.equal(failures.length, 1);
    effects.request({ tint: [30, 0, 0, 255] }); await effects.settled(); assert.equal(tints, 3);
  } finally { effects.dispose(); }
});

test('capture requested values and suppress remaining native stages after disposal', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: number[] = [];
  const effects = installAppearanceEffects({
    apply: async () => { await gate; return capabilities; },
    tintTitlebar: async color => { calls.push(color[0]); }, report: () => {},
  }, () => {});
  const tint: [number, number, number, number] = [10, 0, 0, 255];
  effects.request({ material: { frosted: true, dark: true }, tint }); tint[0] = 99;
  await tick(); effects.dispose(); release(); await effects.settled(); assert.deepEqual(calls, []);
});
