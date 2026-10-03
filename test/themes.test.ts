import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { applyTheme, COLOR_KEYS, importTheme, isColor, MAX_THEME_BYTES, readLibrary, themeProperties, type ThemeLibrary } from '../src/themes/theme';
import { DRACULA } from '../src/themes/builtins';
import { installThemes } from '../src/themes/picker';
import { webviewHtml, rendererBundle } from './view-fixture';

const minimal = { name: 'Sample', colors: { 'editor.background': '#112233', 'editor.foreground': '#eeddcc' } };
const parse = (value: unknown, filename = 'theme.json') => importTheme(JSON.stringify(value), filename, 'import-test');

test('Dracula uses the official base/accent/syntax palette', () => {
  assert.equal(DRACULA.name, 'Dracula'); assert.equal(DRACULA.mode, 'dark');
  const properties = themeProperties(DRACULA);
  assert.equal(properties['--vscode-editor-background'], '#282a36');
  assert.equal(properties['--vscode-focusBorder'], '#bd93f9');
  assert.equal(properties['--nimrod-syntax-keyword'], '#ff79c6');
  assert.equal(properties['--nimrod-syntax-string'], '#f1fa8c');
  assert.equal(properties['--nimrod-syntax-function'], '#50fa7b');
  assert.equal(properties['--nimrod-syntax-regexp'], '#ffb86c');
});

test('JSONC comments, trailing commas, BOM, and uppercase file extensions work', () => {
  const { theme } = importTheme('\uFEFF{ // comment\n"name": "Example", "colors": {"editor.background":"#123",},}', 'colors.JSONC', 'import-test');
  assert.equal(theme.name, 'Example'); assert.equal(theme.colors['editor.background'], '#123');
});

test('all accepted values are bounded hex colors, never CSS code or resources', () => {
  for (const good of ['#abc', '#abcd', '#123456', '#12345678', '#AABBCC']) assert.equal(isColor(good), true);
  for (const bad of ['red', 'transparent', 'url(https://evil)', 'var(--other)', '#112233;display:none', '#12', '#12345', '#123456789', 42, null]) {
    assert.equal(isColor(bad), false);
    if (bad !== null) assert.throws(() => parse({ ...minimal, colors: { ...minimal.colors, foreground: bad } }), /Invalid color/);
  }
});

test('unknown style/font keys and unrelated JSON are never applied', () => {
  const raw = JSON.parse('{"colors":{"editor.background":"#123456","foreground":"#ffffff","editor.fontFamily":"evil","--font-size":"400px","__proto__":{"polluted":true}},"css":"body{display:none}","fontSize":300}');
  const properties = themeProperties(parse(raw).theme);
  assert.equal(properties['--vscode-foreground'], '#ffffff');
  assert.equal(Object.keys(properties).some(k => /font|css|proto/i.test(k)), false);
  assert.equal(({} as Record<string, unknown>).polluted, undefined);
});

test('rejects unsupported packages, terminal palettes, includes, and external token files', () => {
  assert.throws(() => parse(minimal, 'theme.vsix'), /not a .vsix/);
  assert.throws(() => parse({ palette: ['#123456'] }), /colors object/);
  assert.throws(() => parse({ ...minimal, include: './parent.json' }), /references other files/);
  assert.throws(() => parse({ ...minimal, tokenColors: 'file.tmTheme' }), /references other files/);
  assert.throws(() => parse({ ...minimal, tokenColors: {} }), /array/);
  assert.throws(() => importTheme('{ nope', 'theme.json', 'import-test'), /Invalid theme JSON/);
  assert.throws(() => parse([]), /JSON object/);
});

test('requires an opaque editor background; accepts alpha for other roles', () => {
  for (const background of [undefined, '#1234', '#11223380']) assert.throws(() => parse({ colors: { 'editor.background': background } }), /opaque/);
  assert.equal(parse({ colors: { 'editor.background': '#123f', 'widget.shadow': '#0007' } }).theme.colors['widget.shadow'], '#0007');
  assert.equal(parse({ colors: { 'editor.background': '#112233ff' } }).theme.mode, 'dark');
});

test('light/dark type is explicit or inferred, independent of OS appearance', () => {
  assert.equal(parse({ colors: { 'editor.background': '#fafafa' } }).theme.mode, 'light');
  assert.equal(parse({ ...minimal, type: 'hcLight' }).theme.mode, 'light');
  assert.equal(parse({ ...minimal, type: 'hc' }).theme.mode, 'dark');
  assert.throws(() => parse({ ...minimal, type: 'system' }), /Theme type/);
});

test('maps broad token scopes with specificity, while ignoring language-context selectors', () => {
  const { theme, warnings } = parse({ ...minimal, semanticTokenColors: { variable: '#ffffff' }, tokenColors: [
    { scope: ['string.regexp', 'constant.numeric'], settings: { foreground: '#ff0000' } },
    { scope: 'string, keyword', settings: { foreground: '#ffff00' } },
    { scope: 'source.js keyword', settings: { foreground: '#00ff00' } },
    { scope: 'keyword.control.js', settings: { foreground: '#0000ff' } },
    { scope: 'comment', settings: { foreground: '#666666', fontStyle: 'italic' } },
  ] });
  assert.deepEqual(theme.syntax, { regexp: '#ff0000', number: '#ff0000', string: '#ffff00', keyword: '#ffff00', comment: '#666666' });
  assert.equal(warnings.length, 1);
  assert.equal('fontStyle' in theme.syntax, false);
});

test('caps raw theme byte size before parsing', () => {
  assert.throws(() => importTheme(' '.repeat(MAX_THEME_BYTES + 1), 'big.json', 'import-test'), /512 KiB/);
});

test('theme selection clears every previous override and preserves unrelated root styles', () => {
  const dom = new JSDOM(''); const root = dom.window.document.documentElement;
  try {
    root.style.setProperty('--unrelated', 'keep');
    applyTheme(root, DRACULA);
    applyTheme(root, parse({ colors: { 'editor.background': '#ffffff' } }).theme);
    assert.equal(root.style.colorScheme, 'light');
    assert.notEqual(root.style.getPropertyValue('--nimrod-syntax-keyword'), '#ff79c6');
    applyTheme(root);
    assert.equal(root.dataset.theme, 'nimrod'); assert.equal(root.dataset.themeMode, undefined);
    assert.equal(root.style.getPropertyValue('--vscode-editor-background'), '');
    assert.equal(root.style.getPropertyValue('--nimrod-syntax-keyword'), '');
    assert.equal(root.style.colorScheme, ''); assert.equal(root.style.getPropertyValue('--unrelated'), 'keep');
  } finally { dom.window.close(); }
});

test('all renderer color tokens have explicit imported-theme fallbacks', () => {
  const css = readFileSync('src/theme.css', 'utf8') + readFileSync('src/pi/transcript.css', 'utf8');
  const properties = themeProperties(parse(minimal).theme);
  for (const match of css.matchAll(/--vscode-[\w-]+/g)) {
    if (match[0].endsWith('font-family')) continue;
    assert.ok(isColor(properties[match[0]]), `missing color: ${match[0]}`);
  }
  assert.equal(COLOR_KEYS.includes('editor.background'), true);
});

test('saved library round trips and rejects injected values and duplicate/reserved IDs', () => {
  const library: ThemeLibrary = { version: 1, selected: 'import-test', imports: [parse(minimal).theme] };
  assert.deepEqual(readLibrary(JSON.parse(JSON.stringify(library))), library);
  assert.equal(readLibrary({ ...library, selected: 'missing' }).selected, 'nimrod');
  assert.throws(() => readLibrary({ ...library, imports: [{ ...library.imports[0], id: 'dracula' }] }), /invalid/);
  assert.throws(() => readLibrary({ ...library, imports: [library.imports[0], library.imports[0]] }), /invalid/);
  assert.throws(() => readLibrary({ ...library, imports: [{ ...library.imports[0], syntax: { comment: 'url(evil)' } }] }), /syntax color/);
});

function pickerFixture(saved?: unknown, write: (value: ThemeLibrary) => void = () => {}) {
  const dom = new JSDOM('<select id="theme"></select><input type="file"><div hidden><span></span><button>Dismiss</button></div>');
  const document = dom.window.document;
  const select = document.querySelector('select')!, file = document.querySelector('input')!;
  const notice = document.querySelector('div')!, noticeText = document.querySelector('span')!;
  const saves: ThemeLibrary[] = []; let count = 0;
  const picker = installThemes({ root: document.documentElement, select, file, notice, noticeText, dismiss: document.querySelector('button')! }, {
    read: () => saved, save: value => { write(value); saves.push(value); }, newId: () => `import-${++count}`,
  });
  const choose = (id: string) => { select.value = id; select.dispatchEvent(new dom.window.Event('change')); };
  const importFile = (data = JSON.stringify(minimal), name = 'theme.json') => picker.importFile({ name, size: data.length, text: async () => data });
  return { dom, document, select, file, notice, noticeText, saves, picker, choose, importFile, close: () => { picker.dispose(); dom.window.close(); } };
}

test('picker switches builtins immediately and restores the saved selection', () => {
  const f = pickerFixture();
  try {
    assert.equal(f.select.value, 'nimrod');
    f.choose('dracula'); assert.equal(f.document.documentElement.dataset.theme, 'dracula');
    const next = pickerFixture(f.saves.at(-1));
    try { assert.equal(next.select.value, 'dracula'); assert.equal(next.document.documentElement.style.colorScheme, 'dark'); }
    finally { next.close(); }
    f.choose('nimrod'); assert.equal(f.document.documentElement.style.getPropertyValue('--vscode-focusBorder'), '');
  } finally { f.close(); }
});

test('file import adds, selects, persists and removes only the local theme copy', async () => {
  const f = pickerFixture();
  try {
    await f.importFile();
    assert.equal(f.select.value, 'import-1'); assert.match(f.noticeText.textContent!, /Imported Sample/);
    const next = pickerFixture(f.saves.at(-1));
    try { assert.equal(next.select.value, 'import-1'); assert.equal(next.document.documentElement.style.getPropertyValue('--vscode-editor-background'), '#112233'); }
    finally { next.close(); }
    await f.importFile(); assert.equal(f.saves.at(-1)!.imports[1].name, 'Sample (2)');
    f.choose('$remove'); assert.equal(f.select.value, 'nimrod'); assert.equal(f.saves.at(-1)!.imports.length, 1);
  } finally { f.close(); }
});

test('cancelled file picking and invalid files retain the active theme', async () => {
  const f = pickerFixture();
  try {
    f.choose('dracula');
    let clicked = false; f.file.click = () => { clicked = true; };
    f.choose('$import'); assert.equal(clicked, true); assert.equal(f.select.value, 'dracula');
    f.file.dispatchEvent(new f.dom.window.Event('change'));
    await f.importFile('{ nope');
    assert.equal(f.select.value, 'dracula'); assert.equal(f.document.documentElement.dataset.theme, 'dracula');
    assert.match(f.noticeText.textContent!, /not imported/); assert.equal(f.saves.length, 1);
  } finally { f.close(); }
});

test('file input changes import through the visible picker flow', async () => {
  const f = pickerFixture();
  try {
    const data = JSON.stringify(minimal);
    Object.defineProperty(f.file, 'files', { value: [{ name: 'selected.jsonc', size: data.length, text: async () => data }] });
    f.file.dispatchEvent(new f.dom.window.Event('change'));
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(f.select.value, 'import-1');
    assert.equal(f.file.value, '');
    assert.equal(f.saves.at(-1)?.selected, 'import-1');
  } finally { f.close(); }
});

test('oversized files and full libraries are rejected before reading another file', async () => {
  const imports = Array.from({ length: 50 }, (_, i) => ({ ...parse(minimal).theme, id: `import-${i}` }));
  const full = pickerFixture({ version: 1, selected: 'nimrod', imports });
  let read = false;
  try {
    await full.picker.importFile({ name: 'extra.json', size: 1, text: async () => { read = true; return '{}'; } });
    assert.equal(read, false); assert.match(full.noticeText.textContent!, /50 imported themes/);
  } finally { full.close(); }
  const f = pickerFixture();
  try {
    await f.picker.importFile({ name: 'large.json', size: MAX_THEME_BYTES + 1, text: async () => { read = true; return '{}'; } });
    assert.equal(read, false); assert.match(f.noticeText.textContent!, /512 KiB/);
    assert.equal(f.select.value, 'nimrod');
  } finally { f.close(); }
});

test('storage failure leaves the current palette intact and reports why', async () => {
  const f = pickerFixture(undefined, () => { throw new Error('quota exceeded'); });
  try {
    f.choose('dracula'); await Promise.resolve(); assert.equal(f.select.value, 'nimrod');
    assert.equal(f.document.documentElement.dataset.theme, 'nimrod'); assert.match(f.noticeText.textContent!, /quota exceeded/);
    await f.importFile(); assert.equal(f.select.value, 'nimrod'); assert.equal(f.saves.length, 0);
  } finally { f.close(); }
});

test('theme names are text and cannot inject markup', async () => {
  const f = pickerFixture();
  try {
    await f.importFile(JSON.stringify({ ...minimal, name: '<img src=x onerror=alert(1)>' }));
    assert.equal(f.select.selectedOptions[0].textContent, '<img src=x onerror=alert(1)>');
    assert.equal(f.document.querySelector('img, [onerror]'), null);
  } finally { f.close(); }
});

test('a stale asynchronous import cannot override a newer selection or disposal', async () => {
  const f = pickerFixture();
  try {
    let finish!: (text: string) => void;
    const pending = f.picker.importFile({ name: 'slow.json', size: 100, text: () => new Promise(resolve => { finish = resolve; }) });
    f.choose('dracula'); finish(JSON.stringify(minimal)); await pending;
    assert.equal(f.document.documentElement.dataset.theme, 'dracula'); assert.equal(f.saves.length, 1);
    const pending2 = f.picker.importFile({ name: 'slow.json', size: 100, text: () => new Promise(resolve => { finish = resolve; }) });
    f.picker.dispose(); finish(JSON.stringify(minimal)); await pending2;
    assert.equal(f.saves.length, 1);
  } finally { f.close(); }
});

test('theme changes preserve live transcript DOM, spinners, disclosure, drafts and scroll positions', () => {
  const dom = new JSDOM(webviewHtml(), { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const frames: FrameRequestCallback[] = []; win.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  let receive: (message: unknown) => void = () => {};
  Object.assign(win, { testHost: { getState: () => undefined, setState: () => {}, postMessage: () => {}, onMessage: (listener: typeof receive) => { receive = listener; } } });
  try {
    win.eval(rendererBundle() + '\nPiView.mountPiView(window.testHost);');
    receive({ type: 'snapshot', state: { busy: true, messages: [{ key: 'a', role: 'assistant', content: [{ type: 'toolCall', id: 'tool', name: 'bash', arguments: {}, toolStatus: 'running', executionOutput: 'test output' }] }] } });
    while (frames.length) frames.shift()!(0);
    const tool = win.document.querySelector<HTMLDetailsElement>('.tool-card')!, spinner = tool.querySelector('.tool-card-spinner');
    tool.open = true; tool.dispatchEvent(new win.Event('toggle'));
    const prompt = win.document.querySelector<HTMLTextAreaElement>('#prompt')!; prompt.value = 'keep me'; prompt.focus();
    const pane = win.document.getElementById('transcript-viewport')!; pane.scrollTop = 100;
    applyTheme(win.document.documentElement, DRACULA); applyTheme(win.document.documentElement);
    assert.equal(win.document.querySelector('.tool-card'), tool); assert.equal(tool.open, true);
    assert.equal(tool.querySelector('.tool-card-spinner'), spinner); assert.equal(spinner?.isConnected, true);
    assert.equal(win.document.activeElement, prompt); assert.equal(prompt.value, 'keep me'); assert.equal(pane.scrollTop, 100);
  } finally { dom.window.close(); }
});
