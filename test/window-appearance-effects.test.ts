import assert from 'node:assert/strict';
import test from 'node:test';
import { installAppearanceEffects } from '../src/window-appearance-effects';
import type { AppearanceCapabilities, TitlebarTint } from '../src/window-appearance';
const capabilities: AppearanceCapabilities = { platform: 'macos', transparency: true, frost: true, reducedTransparency: false };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

test('one native pipeline orders material before tint, serializes stages and coalesces latest targets', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: string[] = []; let active = 0, maximum = 0;
  const effects = installAppearanceEffects({
    apply: async (_blur, dark) => { maximum = Math.max(maximum, ++active); calls.push('material:' + dark); --active; return capabilities; },
    tintTitlebar: async color => { maximum = Math.max(maximum, ++active); calls.push('tint:' + color[0]); if (calls.length === 2) await gate; --active; },
    report: () => {},
  }, () => {});
  try {
    effects.request({ material: { blur: 20, dark: true }, tint: [10, 20, 30, 128] });
    await tick(); assert.deepEqual(calls, ['material:true', 'tint:10']);
    effects.request({ material: { blur: 20, dark: false }, tint: [20, 20, 30, 128] });
    effects.request({ material: { blur: 0, dark: false }, tint: [30, 20, 30, 128] });
    await tick(); assert.equal(calls.length, 2); release(); await effects.settled();
    assert.deepEqual(calls, ['material:true', 'tint:10', 'material:false', 'tint:30']);
    assert.equal(maximum, 1);
    for (let i = 0; i < 200; i++) effects.request({ material: { blur: 0, dark: false }, tint: [30, 20, 30, 128] });
    await effects.settled(); assert.equal(calls.length, 4);
  } finally { release(); effects.dispose(); }
});

test('blur-only changes do not reapply the native theme or re-tint unchanged chrome', async () => {
  const updates: { blur: number; dark: boolean | null; updateTheme: boolean }[] = [];
  const tints: number[] = [];
  const effects = installAppearanceEffects({
    apply: async (blur, dark, updateTheme) => { updates.push({ blur, dark, updateTheme }); return capabilities; },
    tintTitlebar: async color => { tints.push(color[0]); }, report: () => {},
  }, () => {});
  const tint: [number, number, number, number] = [10, 20, 30, 128];
  try {
    for (const blur of [0, 7, 20, 0]) {
      effects.request({ material: { blur, dark: true }, tint });
      await effects.settled();
    }
    assert.deepEqual([...updates], [
      { blur: 0, dark: true, updateTheme: true },
      { blur: 7, dark: true, updateTheme: false },
      { blur: 20, dark: true, updateTheme: false },
      { blur: 0, dark: true, updateTheme: false },
    ]);
    assert.deepEqual([...tints], [10]);
    effects.request({ material: { blur: 0, dark: false }, tint });
    await effects.settled();
    assert.equal(updates.at(-1)!.updateTheme, true);
    assert.deepEqual([...tints], [10, 10]); // Same-colour theme changes still re-tint.
    effects.refreshTint(); await effects.settled();
    assert.equal(tints.length, 3); assert.equal(updates.length, 5);
  } finally { effects.dispose(); }
});

test('blur changes cannot retry a failed unchanged title tint', async () => {
  let tints = 0;
  const effects = installAppearanceEffects({
    apply: async () => capabilities,
    tintTitlebar: async () => { ++tints; throw new Error('tint unavailable'); }, report: () => {},
  }, () => {});
  try {
    for (const blur of [0, 7, 20, 0]) {
      effects.request({ material: { blur, dark: null }, tint: [10, 20, 30, 128] });
      await effects.settled();
    }
    assert.equal(tints, 1);
  } finally { effects.dispose(); }
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

test('tint-only chrome snapshots copy and coalesce foreground as well as background', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: { color: TitlebarTint; foreground?: TitlebarTint }[] = [];
  const effects = installAppearanceEffects({
    apply: async () => { throw new Error('Linux chrome must not apply material'); },
    tintTitlebar: async (color, foreground) => { calls.push({ color, foreground }); if (calls.length === 1) await gate; },
    report: () => {},
  }, () => {});
  try {
    const tint: TitlebarTint = [10, 20, 30, 128], foreground: TitlebarTint = [200, 210, 220, 255];
    effects.request({ tint, foreground }); tint[0] = 99; foreground[0] = 99;
    await tick();
    assert.deepEqual(calls[0], { color: [10, 20, 30, 128], foreground: [200, 210, 220, 255] });
    effects.request({ tint: [10, 20, 30, 128], foreground: [210, 220, 230, 255] });
    effects.request({ tint: [10, 20, 30, 128], foreground: [220, 230, 240, 255] });
    release(); await effects.settled();
    assert.equal(calls.length, 2); assert.deepEqual(calls.at(-1)!.foreground, [220, 230, 240, 255]);
    effects.request({ tint: [10, 20, 30, 128], foreground: [220, 230, 240, 255] });
    await effects.settled(); assert.equal(calls.length, 2);
  } finally { release(); effects.dispose(); }
});

test('capture requested values and suppress remaining native stages after disposal', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const calls: number[] = [];
  const effects = installAppearanceEffects({
    apply: async () => { await gate; return capabilities; },
    tintTitlebar: async color => { calls.push(color[0]); }, report: () => {},
  }, () => {});
  const tint: [number, number, number, number] = [10, 0, 0, 255];
  effects.request({ material: { blur: 20, dark: true }, tint }); tint[0] = 99;
  await tick(); effects.dispose(); release(); await effects.settled(); assert.deepEqual(calls, []);
});
