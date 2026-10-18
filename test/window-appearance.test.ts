import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { DEFAULT_WINDOW_APPEARANCE, readWindowAppearance, windowSurfaceOpacities, titlebarTint, type TitlebarTint, type AppearanceCapabilities, type WindowAppearance } from '../src/window-appearance';

import { installWindowAppearance } from '../src/window-appearance-controller';
import { applyTheme } from '../src/themes/theme';

const mac: AppearanceCapabilities = { platform: 'macos', transparency: true, frost: true, reducedTransparency: false };
const linux: AppearanceCapabilities = { platform: 'linux', transparency: true, frost: false, reducedTransparency: false };
const tick = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
function fixture(support = mac, initial: Partial<WindowAppearance> = {}, tintTitlebar?: (color: TitlebarTint) => Promise<void>) {
  const dom = new JSDOM('<input id="opacity" type="range" min="0" max="100"><output></output><select><option value="window">Whole window</option><option value="chrome">Sidebar and Project bar</option></select><div id="blur"><input type="range" min="0" max="40"><output id="blur-value"></output></div><p></p><textarea>draft</textarea><details open>Retained card</details>', { pretendToBeVisual: true });
  const window = dom.window as unknown as Window;
  const root = dom.window.document.documentElement;
  const setTheme = (mode: 'dark' | 'light' | null, background = mode === 'light' ? '#f7f9f8' : '#151c20') => {
    applyTheme(root, mode === null ? undefined : { id: 'fixture-' + mode, name: 'Fixture', mode, colors: { 'editor.background': background }, syntax: {} });
  };
  setTheme('dark');
  let value = { ...DEFAULT_WINDOW_APPEARANCE, ...initial };
  const saves: Partial<WindowAppearance>[] = [];
  const previews: (number | null)[] = [];
  const blurPreviews: (number | null)[] = [];
  const effects: { blur: number; dark: boolean | null }[] = [];
  const reports: { message?: string; cause?: string }[] = [];
  const controls = {
    opacity: root.querySelector<HTMLInputElement>('#opacity')!, value: root.querySelector<HTMLOutputElement>('output')!,
    area: root.querySelector<HTMLSelectElement>('select')!, blur: root.querySelector<HTMLInputElement>('#blur input')!, blurValue: root.querySelector<HTMLOutputElement>('#blur-value')!,
    blurGroup: root.querySelector<HTMLElement>('#blur')!, hint: root.querySelector<HTMLElement>('p')!,
  };
  let save = async (patch: Partial<WindowAppearance>) => { value = { ...value, ...patch }; };
  let apply = async (_blur: number, _dark: boolean | null) => support;
  const controller = installWindowAppearance(window, root, {
    read: () => value,
    save: patch => { saves.push(patch); return save(patch); },
    previewOpacity: async opacity => { previews.push(opacity); },
    previewBlur: async blur => { blurPreviews.push(blur); },
    capabilities: async () => support,
    tintTitlebar,
    apply: (blur, dark) => { effects.push({ blur, dark }); return apply(blur, dark); },
    report: (message, cause) => reports.push({ message, cause }),
  }, controls);
  const event = (target: HTMLElement, type: string) => target.dispatchEvent(new dom.window.Event(type, { bubbles: true }));
  return { dom, root, controls, saves, previews, blurPreviews, effects, reports, controller, event, setTheme,
    external(patch: Partial<WindowAppearance>) { value = { ...value, ...patch }; controller.reload(); },
    setSave(next: typeof save) { save = next; }, setApply(next: typeof apply) { apply = next; },
    close() { controller.dispose(); dom.window.close(); },
  };
}

test('appearance range fills exist before interaction and track reloads/previews without writes', async () => {
  const f = fixture(mac, { opacity: 65, blur: 20 });
  try {
    // paint() runs during installation, before capability readiness or input.
    assert.equal(f.controls.opacity.style.getPropertyValue('--range-fill'), '65%');
    assert.equal(f.controls.blur.style.getPropertyValue('--range-fill'), '50%');
    await f.controller.ready;
    assert.equal(f.saves.length, 0); assert.equal(f.previews.length, 0); assert.equal(f.blurPreviews.length, 0);
    f.external({ opacity: 30, blur: 8 });
    assert.equal(f.controls.opacity.style.getPropertyValue('--range-fill'), '30%');
    assert.equal(f.controls.blur.style.getPropertyValue('--range-fill'), '20%');
    f.controls.opacity.value = '70'; f.event(f.controls.opacity, 'input');
    assert.equal(f.controls.opacity.style.getPropertyValue('--range-fill'), '70%');
    f.controls.blur.value = '30'; f.event(f.controls.blur, 'input');
    assert.equal(f.controls.blur.style.getPropertyValue('--range-fill'), '75%');
    assert.equal(f.saves.length, 0);
  } finally { f.close(); }
});

test('opacity input publishes a paint-only preview and only its matching save clears it', async () => {
  const f = fixture();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  try {
    await f.controller.ready;
    f.controls.opacity.value = '65'; f.event(f.controls.opacity, 'input');
    assert.deepEqual([...f.previews], [65]); assert.equal(f.saves.length, 0);
    f.setSave(() => pending);
    f.event(f.controls.opacity, 'change');
    f.controls.opacity.value = '25'; f.event(f.controls.opacity, 'input');
    release(); await tick();
    assert.equal(f.previews.includes(null), false); // Old completion cannot cancel a newer drag.
    f.setSave(async () => { f.external({ opacity: 25 }); });
    f.event(f.controls.opacity, 'change'); await tick();
    assert.equal(f.previews.at(-1), null);
    f.setSave(async () => { throw new Error('disk'); });
    f.controls.opacity.value = '40'; f.event(f.controls.opacity, 'change'); await tick();
    assert.equal(f.previews.at(-1), null); assert.equal(f.controls.opacity.value, '25');
  } finally { release(); f.close(); }
});

test('performance context is read-only and includes native reduced-transparency policy', async () => {
  for (const support of [mac, { ...mac, reducedTransparency: true }, linux]) {
    const f = fixture(support, { opacity: 65, area: 'chrome' });
    try {
      await f.controller.ready;
      const html = f.root.outerHTML, effects = f.effects.length;
      for (let i = 0; i < 200; i++) assert.deepEqual(f.controller.diagnostics(), {
        effectiveArea: support.reducedTransparency ? 'off' : 'chrome',
        effectiveBackgroundOpacity: support.reducedTransparency ? 100 : 65,
        reducedTransparency: support.reducedTransparency, frostSupported: support.frost,
      });
      assert.equal(f.root.outerHTML, html);
      assert.equal(f.effects.length, effects);
    } finally { f.close(); }
  }
});

test('appearance schema uses opaque defaults and rejects invalid values including explicit null', () => {
  assert.deepEqual(readWindowAppearance({}), DEFAULT_WINDOW_APPEARANCE);
  for (const [key, values] of Object.entries({
    'appearance.backgroundOpacity': [-1, 101, 50.5, '80', true, null],
    'appearance.frostedBackground': [1, 'false', null],
    'appearance.backgroundBlur': [-1, 41, 1.5, '20', true, null],
    'appearance.translucencyArea': ['whole', 'sidebar', true, null],
  })) for (const value of values) assert.throws(() => readWindowAppearance({ [key]: value }));
  assert.equal(readWindowAppearance({ 'appearance.backgroundOpacity': 0 }).opacity, 0);
});

test('legacy frosting maps to blur without overriding an explicit numeric value', () => {
  assert.equal(readWindowAppearance({ 'appearance.frostedBackground': true }).blur, 20);
  assert.equal(readWindowAppearance({ 'appearance.frostedBackground': false }).blur, 0);
  assert.equal(readWindowAppearance({ 'appearance.frostedBackground': false, 'appearance.backgroundBlur': 12 }).blur, 12);
  assert.equal(readWindowAppearance({ 'appearance.frostedBackground': true, 'appearance.backgroundBlur': 0 }).blur, 0);
});

test('blur previews independently of opacity and stale save completion cannot cancel a newer drag', async () => {
  const f = fixture(mac, { opacity: 50 });
  let release!: () => void;
  try {
    await f.controller.ready;
    f.controls.blur.value = '8'; f.event(f.controls.blur, 'input'); await tick();
    assert.deepEqual([...f.blurPreviews], [8]); assert.equal(f.saves.length, 0);
    assert.equal(f.root.style.getPropertyValue('--nimrod-background-opacity'), '50%');
    assert.deepEqual(f.effects.at(-1), { blur: 8, dark: true });
    f.setSave(() => new Promise<void>(resolve => { release = resolve; }));
    f.event(f.controls.blur, 'change');
    f.controls.blur.value = '30'; f.event(f.controls.blur, 'input');
    release(); await tick();
    assert.equal(f.blurPreviews.includes(null), false);
    assert.equal(f.controls.blur.value, '30');
    f.setSave(async () => { throw new Error('disk'); });
    f.event(f.controls.blur, 'change'); await tick();
    assert.equal(f.controls.blur.value, '20'); assert.equal(f.blurPreviews.at(-1), null);
    f.external({ blur: 12 }); f.external({ opacity: 100 }); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 0, dark: true });
    assert.equal(f.controls.blur.value, '12'); // Opaque mode retains the saved strength.
    f.external({ opacity: 50 }); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 12, dark: true });
    assert.equal(f.previews.length, 0);
  } finally { release?.(); f.close(); }
});

test('macOS without native blur support retains sharp alpha and window-local theme work', async () => {
  const f = fixture({ ...mac, frost: false }, { opacity: 50 });
  try {
    await f.controller.ready;
    assert.equal(f.controls.blurGroup.hidden, true);
    assert.equal(f.root.dataset.translucency, 'window');
    assert.deepEqual(f.effects.at(-1), { blur: 0, dark: true });
    assert.match(f.controls.hint.textContent!, /plain transparency/);
  } finally { f.close(); }
});

test('native title tint follows bounded hex theme colors and background opacity', () => {
  assert.deepEqual(titlebarTint('#123456', 50), [18, 52, 86, 128]);
  assert.deepEqual(titlebarTint('#abc', 100), [170, 187, 204, 255]);
  assert.deepEqual(titlebarTint('#abcd', 50), [170, 187, 204, 111]);
  assert.deepEqual(titlebarTint('#11223380', 50), [17, 34, 51, 64]);
  assert.equal(titlebarTint('red', 100), undefined); assert.equal(titlebarTint('#12', 100), undefined);
});

test('initial readiness waits for native tint and coalesces same-mode palette changes without reinstalling blur', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const tints: TitlebarTint[] = [];
  const f = fixture(mac, { opacity: 50, blur: 0 }, color => {
    tints.push(color); return tints.length === 1 ? gate : Promise.resolve();
  });
  try {
    f.setTheme('dark', '#123456');
    let ready = false; void f.controller.ready.then(() => { ready = true; });
    await tick(); assert.equal(ready, false); assert.deepEqual(tints[0], [18, 52, 86, 128]);
    f.setTheme('dark', '#334455'); await tick();
    assert.equal(tints.length, 1); release(); await f.controller.ready;
    assert.deepEqual(tints.at(-1), [51, 68, 85, 128]); assert.equal(f.effects.length, 1);
    assert.deepEqual(f.effects[0], { blur: 0, dark: true });
    const before = tints.length;
    for (let i = 0; i < 200; i++) f.controller.reload();
    await tick(); assert.equal(tints.length, before); assert.equal(f.effects.length, 1);
    f.external({ opacity: 100 }); await tick(); assert.equal(tints.at(-1)![3], 255);
  } finally { release(); f.close(); }
});

test('a same-colour appearance change cannot be hidden by an older title-tint reply', async () => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const tints: TitlebarTint[] = [];
  const f = fixture(mac, { opacity: 50, blur: 0 }, color => {
    tints.push(color); return tints.length === 1 ? gate : Promise.resolve();
  });
  try {
    f.setTheme('dark', '#123456'); await tick();
    assert.equal(tints.length, 1);
    f.setTheme('light', '#123456'); await tick();
    assert.equal(f.effects.length, 1); // Tint and material no longer overlap.
    release(); await f.controller.ready;
    assert.deepEqual(f.effects.at(-1), { blur: 0, dark: false });
    assert.equal(tints.length, 2); assert.deepEqual(tints[0], tints[1]);
  } finally { release(); f.close(); }
});

test('unrelated root-style mutations are not an appearance update interface', async () => {
  const tints: TitlebarTint[] = [];
  const f = fixture(mac, { opacity: 50 }, async color => { tints.push(color); });
  try {
    await f.controller.ready; const before = tints.length;
    f.root.style.setProperty('--unrelated', 'keep');
    f.root.style.zoom = '1.25'; await tick();
    assert.equal(tints.length, before);
    f.setTheme('dark', '#334455'); await f.controller.settled();
    assert.deepEqual(tints.at(-1), [51, 68, 85, 128]);
  } finally { f.close(); }
});

test('surface density is continuous, role-ordered and converges exactly to the opaque endpoint', () => {
  const zero = windowSurfaceOpacities(0);
  assert.equal(zero.control, .10); assert.equal(zero.panel, .25);
  let previous = zero;
  for (let opacity = 0; opacity <= 100; opacity++) {
    const current = windowSurfaceOpacities(opacity);
    for (const key of Object.keys(current) as (keyof typeof current)[]) {
      assert.ok(current[key] >= previous[key]); assert.ok(current[key] >= 0 && current[key] <= 1);
    }
    assert.ok(current.panel >= current.control);
    assert.ok(current.buttonHover >= current.button);
    const base = opacity / 100;
    const composer = base + (1 - base) * current.control;
    const status = composer + (1 - composer) * current.panel;
    const notice = base + (1 - base) * current.panel;
    if (opacity < 100) { assert.ok(status > composer); assert.ok(notice > base); }
    previous = current;
  }
  const opaque = windowSurfaceOpacities(100);
  for (const key of Object.keys(opaque) as (keyof typeof opaque)[]) {
    assert.equal(opaque[key], key === 'modalBackdrop' ? 1 / 3 : 1);
    assert.ok(opaque[key] - windowSurfaceOpacities(99)[key] < .08);
    assert.ok(opaque[key] - windowSurfaceOpacities(99.999)[key] < .0001);
  }
  assert.equal(zero.modal, .72); assert.equal(zero.modalBackdrop, .20);
  const middle = windowSurfaceOpacities(65);
  assert.ok(middle.control < .15); assert.ok(middle.panel > .25 && middle.panel < .30);
});

test('Linux exposes opacity and area without frosting or any native effect work; input previews before saving', async () => {
  const f = fixture(linux);
  try {
    await tick(); assert.equal(f.root.dataset.translucency, 'off'); assert.equal(f.controls.blurGroup.hidden, true);
    assert.match(f.controls.hint.textContent!, /compositor/);
    f.controls.opacity.value = '65'; f.event(f.controls.opacity, 'input');
    assert.equal(f.root.dataset.translucency, 'window'); assert.equal(f.controls.value.value, '65%');
    assert.equal(f.saves.length, 0);
    f.event(f.controls.opacity, 'change'); await tick();
    assert.deepEqual(f.saves, [{ opacity: 65 }]);
    f.controls.area.value = 'chrome'; f.event(f.controls.area, 'change');
    assert.equal(f.root.dataset.translucency, 'chrome'); await tick();
    f.controller.reload(); f.controller.reload(); await tick(); assert.equal(f.effects.length, 0);
  } finally { f.close(); }
});

test('macOS blur follows opacity, strength and local dark/light theme previews without repeated effect work', async () => {
  const f = fixture(mac, { opacity: 70 });
  try {
    await tick(); assert.equal(f.controls.blurGroup.hidden, false);
    assert.deepEqual(f.effects, [{ blur: 20, dark: true }]);
    const overlays = windowSurfaceOpacities(70);
    assert.ok(Math.abs(parseFloat(f.root.style.getPropertyValue('--nimrod-control-overlay-opacity')) / 100 - overlays.control) < .00001);
    assert.ok(Math.abs(parseFloat(f.root.style.getPropertyValue('--nimrod-panel-overlay-opacity')) / 100 - overlays.panel) < .00001);
    assert.equal(f.root.style.getPropertyValue('--nimrod-control-opacity'), '');
    let rootMutations = 0;
    const observer = new f.dom.window.MutationObserver(records => { rootMutations += records.length; });
    observer.observe(f.root, { attributes: true });
    for (let i = 0; i < 200; i++) f.controller.reload();
    await tick(); assert.equal(f.effects.length, 1); assert.equal(rootMutations, 0); observer.disconnect();
    f.setTheme('light'); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 20, dark: false });
    f.controls.blur.value = '0'; f.event(f.controls.blur, 'change');
    assert.equal(f.root.dataset.translucency, 'window'); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 0, dark: false });
    f.external({ opacity: 100 }); assert.equal(f.root.dataset.translucency, 'off');
  } finally { f.close(); }
});

test('the system theme leaves native appearance inherited while explicit previews use window-local overrides', async () => {
  const f = fixture(mac, { opacity: 60 });
  try {
    await tick(); f.setTheme(null); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 20, dark: null });
    f.setTheme('light'); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 20, dark: false });
    f.setTheme('dark'); await tick();
    assert.deepEqual(f.effects.at(-1), { blur: 20, dark: true });
  } finally { f.close(); }
});

test('native capability enforcement keeps Reduce Transparency and unsupported platforms opaque', async () => {
  for (const support of [{ ...mac, reducedTransparency: true }, { platform: 'windows', transparency: false, frost: false, reducedTransparency: false }]) {
    const f = fixture(support, { opacity: 40 });
    try {
      await tick(); assert.equal(f.root.dataset.translucency, 'off');
      assert.equal(f.controls.opacity.value, '40'); // retain requested value, not a destructive preference rewrite
      assert.equal(f.effects.some(effect => effect.blur > 0), false);
      if (support.transparency) assert.match(f.controls.hint.textContent!, /Reduce Transparency/);
      else assert.equal(f.controls.opacity.disabled, true);
    } finally { f.close(); }
  }
});

test('native operations serialize/coalesce to the latest request while preserving mounted nodes and focus', async () => {
  const f = fixture(mac, { opacity: 60 });
  try {
    await tick();
    let release!: (support: AppearanceCapabilities) => void;
    const pending = new Promise<AppearanceCapabilities>(resolve => { release = resolve; });
    let inFlight = 0, max = 0;
    f.setApply(async () => { max = Math.max(max, ++inFlight); const result = await pending; --inFlight; return result; });
    const prompt = f.root.querySelector('textarea')!, card = f.root.querySelector('details')!;
    prompt.focus();
    f.setTheme('light'); await tick();
    f.external({ opacity: 100 }); f.external({ opacity: 55 }); f.external({ blur: 0 });
    release(mac); await tick();
    assert.equal(max, 1); assert.deepEqual(f.effects.at(-1), { blur: 0, dark: false });
    assert.equal(f.root.ownerDocument.activeElement, prompt);
    assert.equal(f.root.querySelector('textarea'), prompt); assert.equal(prompt.value, 'draft');
    assert.equal(f.root.querySelector('details'), card); assert.equal(card.open, true);
  } finally { f.close(); }
});

test('a failed older save cannot roll back a newer local edit and no save is automatically replayed', async () => {
  const f = fixture(linux);
  try {
    await tick();
    let reject!: (error: Error) => void;
    f.setSave(() => new Promise<void>((_resolve, fail) => { reject = fail; }));
    f.controls.opacity.value = '80'; f.event(f.controls.opacity, 'change');
    const rejectOld = reject;
    f.controls.opacity.value = '50'; f.event(f.controls.opacity, 'input');
    rejectOld(new Error('CAS conflict')); await tick();
    assert.equal(f.controls.opacity.value, '50'); assert.equal(f.root.style.getPropertyValue('--nimrod-background-opacity'), '50%');
    assert.equal(f.saves.length, 1); assert.match(f.reports.at(-1)!.message!, /CAS conflict/);
  } finally { f.close(); }
});

test('failed native effects are reported once, not retried on unrelated broadcasts', async () => {
  const f = fixture(mac);
  try {
    await tick(); f.setApply(async () => { throw new Error('native unavailable'); });
    f.external({ opacity: 70 }); await tick();
    const calls = f.effects.length;
    for (let i = 0; i < 200; i++) f.controller.reload();
    await tick(); assert.equal(f.effects.length, calls);
    assert.equal(f.reports.filter(report => report.message?.includes('native unavailable')).length, 1);
  } finally { f.close(); }
});
