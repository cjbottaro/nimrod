import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import type { installUiTemplates, UiTemplateFiles } from '../src/ui-templates';

// Exercise the exact bundled HTML/CSS and runtime, without a provider or native app.
let bundle: Promise<string> | undefined;
async function fixture(files: UiTemplateFiles = {}) {
  bundle ??= build({ entryPoints: ['src/ui-templates.ts'], bundle: true, format: 'iife', globalName: 'Templates', write: false,
    plugins: [{ name: 'raw', setup(builder) {
      builder.onResolve({ filter: /\.(html|css)\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  }).then(result => result.outputFiles[0].text);
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(await bundle);
  const api = (dom.window as unknown as { Templates: { installUiTemplates: typeof installUiTemplates } }).Templates;
  const document = dom.window.document, notices: string[] = [];
  const sidebar = document.getElementById('session-sidebar'), content = document.getElementById('workspace-content');
  const ui = api.installUiTemplates(document, files, message => notices.push(message));
  return { dom, document, ui, notices, sidebar, content, close() { ui.dispose(); dom.window.close(); } };
}
const rightLayout = `<section class="custom-layout">
  <div data-nimrod-sidebar-layout data-nimrod-sidebar-side="right">
    <nimrod-slot name="content"></nimrod-slot><nimrod-slot name="sidebar-resizer"></nimrod-slot><nimrod-slot name="session-sidebar"></nimrod-slot>
  </div><nimrod-slot name="project-bar"></nimrod-slot>
</section>`;
const customBar = `<nav><button data-nimrod-action="settings">Preferences</button>
  <strong data-nimrod-text="project.name"></strong><span data-nimrod-visible="session.present" data-nimrod-text="session.title"></span>
  <button data-nimrod-action="sidebar">Sessions</button></nav>`;

test('the bundled templates mount owned components and patch public bindings without replacing nodes', async () => {
  const f = await fixture();
  try {
    assert.deepEqual(f.notices, []);
    assert.equal(f.document.getElementById('session-sidebar'), f.sidebar);
    assert.equal(f.document.getElementById('workspace-content'), f.content);
    assert.equal(f.document.querySelectorAll('nimrod-slot').length, 0);
    const name = f.document.getElementById('project-name')!, session = f.document.getElementById('project-session')!;
    assert.equal(name.textContent, 'Choose a project'); assert.equal(session.hidden, true);
    f.ui.update({ 'project.name': '<script>literal</script>', 'project.path': '/fixture', 'session.present': true, 'session.title': 'Session A' });
    assert.equal(name.textContent, '<script>literal</script>'); assert.equal(name.children.length, 0);
    assert.equal(f.document.getElementById('project-identity')!.title, '/fixture');
    assert.equal(session.hidden, false); assert.equal(session.title, 'Session A');
    const settings = f.ui.actions.settings; settings.focus();
    f.ui.update({ 'session.title': 'Renamed' });
    assert.equal(f.document.getElementById('project-name'), name);
    assert.equal(f.document.getElementById('project-session'), session);
    assert.equal(f.document.activeElement, settings);
    assert.equal(f.document.getElementById('project-session-name')!.textContent, 'Renamed');
  } finally { f.close(); }
});

test('a genuinely different custom layout/bar uses the same API and can omit actions', async () => {
  const f = await fixture({ layout: rightLayout, layoutCss: '.custom-layout { display:grid; height:100%; grid-template-rows:minmax(0,1fr) 48px; }', projectBar: customBar, projectBarCss: 'nav { display:flex; gap:8px; }' });
  try {
    assert.deepEqual(f.notices, []); assert.equal(f.ui.sidebarSide(), 'right');
    assert.equal(f.document.querySelector('.custom-layout')!.lastElementChild?.id, 'workspace-bar');
    const group = f.document.getElementById('workspace-layout')!;
    assert.equal(group.firstElementChild, f.content); assert.equal(group.lastElementChild, f.sidebar);
    assert.equal(f.ui.actions.settings.textContent, 'Preferences');
    assert.equal(f.ui.actions.reload.isConnected, false);
    let invocations = 0; f.ui.actions.sidebar.addEventListener('click', () => invocations++);
    f.ui.actions.sidebar.click(); assert.equal(invocations, 1);
    f.ui.update({ 'project.name': 'Custom', 'session.present': true, 'session.title': 'A' });
    assert.equal(f.document.querySelector('nav strong')!.textContent, 'Custom');
    f.ui.update({ 'session.present': false });
    assert.equal(f.document.querySelector<HTMLElement>('nav span')!.hidden, true);
    const style = f.document.querySelector('style[data-nimrod-ui-templates]')!.textContent!;
    assert.match(style, /:where\(#workspace-shell\)/); assert.match(style, /:where\(#workspace-bar\)/);
  } finally { f.close(); }
});

test('explicit reload retains mounted content, resize owner, actions, values, draft, selection and scroll', async () => {
  const f = await fixture();
  try {
    const group = f.document.getElementById('workspace-layout')!, settings = f.ui.actions.settings;
    const prompt = f.document.createElement('textarea'); f.content!.append(prompt);
    prompt.value = 'Retained draft'; prompt.focus(); prompt.setSelectionRange(2, 7, 'backward');
    f.sidebar!.scrollTop = 42; group.style.setProperty('--session-sidebar-width', '320px');
    f.ui.update({ 'project.name': 'Retained project', 'session.title': 'Retained session', 'session.present': true });
    let clicks = 0; settings.addEventListener('click', () => clicks++);
    settings.title = 'Current shortcut hint'; settings.classList.add('error');
    for (let count = 0; count < 3; count++) {
      f.ui.reload({ layout: rightLayout, layoutCss: '.custom-layout { display:grid; height:100%; }', projectBar: customBar });
      assert.equal(f.document.getElementById('workspace-layout'), group);
      assert.equal(f.document.getElementById('workspace-content'), f.content);
      assert.equal(f.document.getElementById('session-sidebar'), f.sidebar);
      assert.equal(f.ui.sidebarSide(), 'right');
      assert.equal(f.ui.actions.settings, settings); assert.equal(settings.isConnected, true);
      assert.equal(settings.title, 'Current shortcut hint'); assert.equal(settings.classList.contains('error'), true);
      assert.equal(f.document.querySelector('nav strong')!.textContent, 'Retained project');
      assert.equal(prompt.value, 'Retained draft'); assert.equal(f.document.activeElement, prompt);
      assert.deepEqual([prompt.selectionStart, prompt.selectionEnd, prompt.selectionDirection], [2, 7, 'backward']);
      assert.equal(f.sidebar!.scrollTop, 42); assert.equal(group.style.getPropertyValue('--session-sidebar-width'), '320px');
      assert.equal(f.document.querySelectorAll('#workspace-layout').length, 1);
      assert.equal(f.document.querySelectorAll('.custom-layout').length, 1);
    }
    settings.click(); assert.equal(clicks, 1);
    f.ui.reload({});
    assert.equal(f.ui.sidebarSide(), 'left'); assert.equal(f.ui.actions.settings, settings);
    assert.equal(f.document.getElementById('project-name')!.textContent, 'Retained project');
    assert.equal(f.document.getElementById('project-session-name')!.textContent, 'Retained session');
    assert.equal(f.document.querySelectorAll('.custom-layout').length, 0);
    assert.equal(f.document.querySelectorAll('style[data-nimrod-ui-templates]').length, 1);
  } finally { f.close(); }
});

test('invalid reload, active composition and open dialog leave the current UI untouched', async () => {
  const f = await fixture();
  try {
    const root = f.document.getElementById('workspace-shell')!.firstElementChild;
    const css = f.document.querySelector('style[data-nimrod-ui-templates]')!.textContent;
    assert.throws(() => f.ui.reload({ layout: '<div></div>' }), /requires/);
    assert.throws(() => f.ui.reload({ projectBar: '<script>bad()</script>' }), /Unsupported/);
    assert.throws(() => f.ui.reload({ layoutCss: '@import "bad.css";' }), /external/);
    f.document.dispatchEvent(new f.dom.window.CompositionEvent('compositionstart', { bubbles: true }));
    assert.throws(() => f.ui.reload({}), /composing/);
    f.document.dispatchEvent(new f.dom.window.CompositionEvent('compositionend', { bubbles: true }));
    const dialog = f.document.querySelector('dialog')!; dialog.setAttribute('open', '');
    assert.throws(() => f.ui.reload({}), /dialog/); dialog.removeAttribute('open');
    assert.equal(f.document.getElementById('workspace-shell')!.firstElementChild, root);
    assert.equal(f.document.querySelector('style[data-nimrod-ui-templates]')!.textContent, css);
    f.ui.reload({}); assert.equal(f.document.getElementById('workspace-content'), f.content);
  } finally { f.close(); }
});

for (const [label, files] of Object.entries<UiTemplateFiles>({
  missingSlot: { layout: '<div></div>' },
  duplicateSlot: { layout: rightLayout.replace('name="content"', 'name="session-sidebar"') },
  nestedSlot: { layout: rightLayout.replace('<nimrod-slot name="content"></nimrod-slot>', '<div><nimrod-slot name="content"></nimrod-slot></div>') },
  unknownBinding: { projectBar: '<span data-nimrod-text="internal.controller"></span>' },
  unknownAction: { projectBar: '<button data-nimrod-action="constructor">Oops</button>' },
  duplicateAction: { projectBar: '<button data-nimrod-action="settings"></button><button data-nimrod-action="settings"></button>' },
  eventHandler: { projectBar: '<span onclick="alert(1)">No</span>' },
  script: { projectBar: '<script>alert(1)</script>' },
  iframe: { projectBar: '<iframe src="https://example.invalid"></iframe>' },
  idCollision: { projectBar: '<span id="settings-page"></span>' },
  importCss: { layoutCss: '@import "https://example.invalid/style.css";' },
  resourceCss: { projectBarCss: 'span { background:url(https://example.invalid/image); }' },
  globalCss: { projectBarCss: '@font-face { font-family:bad; src:local(bad); }' },
})) {
  test(`invalid ${label} falls back before losing owned components`, async () => {
    const f = await fixture(files);
    try {
      assert.equal(f.notices.length, 1); assert.match(f.notices[0], /bundled default/);
      assert.equal(f.document.getElementById('session-sidebar'), f.sidebar);
      assert.equal(f.document.getElementById('workspace-content'), f.content);
      assert.equal(f.ui.actions.settings.isConnected, true);
      assert.equal(f.document.querySelectorAll('#settings-page').length, 1);
      assert.ok(f.document.getElementById('project-name'));
    } finally { f.close(); }
  });
}
