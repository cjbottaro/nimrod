import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';
import { JSDOM } from 'jsdom';
import type { Packet } from '../src/pi/transport';
import type { JsonRecord } from '../src/pi/types';
import { stubDialogs } from './dialog-fixture';
import { MemoryPreferences } from './preferences-fixture';

// Real shell/renderer/controller bundle, mocked native boundary—not native WebKit acceptance.
interface ShellOptions {
  storage?: Record<string, unknown>;
  state?: () => JsonRecord;
  history?: JsonRecord[];
  fileExists?: () => boolean;
  selectedId?: string;
  filePath?: string | null;
  holdPrompts?: boolean;
  startError?: string;
  stopGate?: Promise<void>;
  startupEvents?: JsonRecord[];
  catalog?: JsonRecord[];
  windowWorkspace?: string;
  windowWorkspaceGate?: Promise<void>;
  windowWorkspaceError?: string;
  modelFixture?: boolean;
  popout?: { session: string; title: string; text: string; language: string };
  popoutSyncGate?: Promise<void>;
}
async function fixture(startGate?: Promise<void>, options: ShellOptions = {}) {
  const bundle = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', platform: 'browser', write: false,
    loader: { '.css': 'empty' },
    plugins: [{ name: 'raw-fixture', setup(build) {
      build.onResolve({ filter: /\.html\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'raw' }));
      build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { url: options.popout ? 'http://tauri.localhost/?popout' : 'http://tauri.localhost', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  stubDialogs(win);
  const frames: FrameRequestCallback[] = [];
  win.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  const calls: { command: string; args: JsonRecord }[] = [];
  let channel: { onmessage: (packet: Packet) => void };
  let activeToken: string;
  let activeConfig: JsonRecord = {};
  const sessions = new Map<string, { channel: typeof channel; config: JsonRecord; file: string; name?: string }>();
  let workspace = options.windowWorkspace;
  let selectedModel: JsonRecord | null = null;
  let thinkingLevel = 'medium';
  for (const [key, value] of Object.entries(options.storage || {})) win.localStorage.setItem(key, JSON.stringify(value));
  const tick = async () => { await new Promise(resolve => setTimeout(resolve, 0)); while (frames.length) frames.shift()!(0); };
  const preferences = new MemoryPreferences();
  const callbacks = new Map<number, (event: unknown) => void>();
  Object.assign(win, { TextEncoder, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback: (callback: (event: unknown) => void) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; }, unregisterCallback: () => {},
    invoke: async (command: string, args: JsonRecord = {}) => {
      calls.push({ command, args });
      if (command === 'plugin:event|listen') {
        if (args.event === 'nimrod-preferences') preferences.receive = payload => callbacks.get(Number(args.handler))?.({ payload });
        return 1;
      }
      if (command === 'plugin:event|unlisten') return 1;
      if (command.startsWith('preferences_')) return preferences.invoke(command, args);
      if (command === 'sync_popout_sessions') { await options.popoutSyncGate; return { warnings: [] }; }
      if (command === 'code_popout_snapshot') return options.popout;
      if (command === 'runtime_defaults') return { cwd: '/project', pi: '/bin/pi', node: '/bin/node' };
      if (command === 'window_workspace') {
        await options.windowWorkspaceGate;
        if (options.windowWorkspaceError) throw new Error(options.windowWorkspaceError);
        return workspace || null;
      }
      if (command === 'open_workspace') { workspace = String(args.cwd); return { cwd: workspace, current: true }; }
      if (command === 'list_workspace_sessions') return { sessions: options.catalog || [], warnings: [] };
      if (command === 'plugin:dialog|open') return options.filePath === null ? null : options.filePath || '/sessions/exact.jsonl';
      if (command === 'stop_pi' && activeToken!) await options.stopGate;
      if (command === 'start_pi') {
        if (options.startError) throw new Error(options.startError);
        channel = args.onEvent as typeof channel; activeToken = String(args.token); activeConfig = args.config as JsonRecord;
        const index = [...sessions.values()].filter(s => s.config.mode === 'saved').length;
        sessions.set(activeToken, { channel, config: activeConfig, file: index ? `/sessions/new-${index}.jsonl` : '/sessions/new.jsonl', name: typeof activeConfig.sessionName === 'string' ? activeConfig.sessionName : undefined });
        if (options.modelFixture) channel.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'setStatus', id: 'scope', statusKey: 'pi-gui:model-scope', statusText: JSON.stringify([{ provider: 'fixture', id: 'reasoner' }]) } });
        for (const event of options.startupEvents || []) channel.onmessage({ kind: 'rpc', value: event });
        await startGate;
        return { cwd: '/project', session: activeConfig.mode === 'resume' ? { path: activeConfig.sessionFile, sessionId: options.selectedId || 'fixture-id', exists: true } : undefined };
      }
      if (command === 'inspect_workspace_session') return { path: args.path, sessionId: options.selectedId || 'fixture-id', exists: true };
      if (command === 'session_file_info') return { path: args.path, sessionId: args.sessionId, exists: options.fileExists?.() ?? true };
      if (command === 'write_pi') {
        const target = sessions.get(String(args.token)); assert.ok(target);
        const { channel, config: activeConfig } = target;
        const request = args.message as JsonRecord;
        if (request.type === 'prompt' && options.holdPrompts) return;
        if (request.type === 'set_session_name') target.name = String(request.name);
        if (options.modelFixture) {
          if (request.type === 'set_model') selectedModel = { provider: request.provider, id: request.modelId };
          if (request.type === 'set_thinking_level') thinkingLevel = String(request.level);
          const preferenceData = request.type === 'get_available_models' ? { models: [{ provider: 'fixture', id: 'reasoner' }, { provider: 'outside-scope', id: 'hidden' }] }
            : request.type === 'get_available_thinking_levels' ? { levels: selectedModel ? ['low', 'medium', 'high'] : [] } : undefined;
          if (preferenceData) { channel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true, data: preferenceData } }); return; }
        }
        const data = request.type === 'get_state' ? { model: selectedModel, thinkingLevel, isStreaming: false, isCompacting: false,
          ...(target.name !== undefined ? { sessionName: target.name } : {}),
          ...(activeConfig.mode !== 'temporary' ? options.state?.() ?? { sessionFile: activeConfig.sessionFile || target.file, sessionId: 'fixture-id' } : {}) }
          : request.type === 'get_messages' ? { messages: options.history || [] }
          : request.type === 'get_commands' ? { commands: [] } : {};
        channel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true, data } });
      }
    },
  } });
  const close = win.close.bind(win);
  win.close = () => { win.dispatchEvent(new win.Event('unload')); close(); };
  win.eval(bundle.outputFiles![0].text);
  await tick();
  const element = <T extends HTMLElement>(id: string) => (win.document.getElementById(id) || win.document.querySelector(`.session-view:not([hidden]) [data-pi-id="${id}"]`)) as T;
  const openSettings = () => element<HTMLButtonElement>('open-settings').click();
  const back = () => element<HTMLButtonElement>('settings-back').click();
  return { dom, win, tick, calls, element, openSettings, back, preferences,
    confirm: async () => { await tick(); element<HTMLDialogElement>('host-dialog').close('ok'); await tick(); await tick(); },
    saved: () => JSON.parse(win.localStorage.getItem(`nimrod.sessions.v1:${workspace}`) || win.localStorage.getItem('nimrod.sessions.v1') || '{}'),
    sessions,
    captureChannel: () => channel,
    emit: (event: JsonRecord) => channel.onmessage({ kind: 'rpc', value: event }),
    disconnect: () => channel.onmessage({ kind: 'disconnected', message: 'fixture closed' }),
  };
}

async function chooseNamedSession(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  f.element<HTMLButtonElement>('open-palette').click();
  const input = f.element<HTMLInputElement>('palette-input');
  input.value = 'new named session'; input.dispatchEvent(new f.win.Event('input'));
  input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await f.tick();
  assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
  assert.equal(f.element<HTMLDialogElement>('host-dialog').open, false);
  assert.equal(f.element('palette-title').textContent, 'New named session');
  assert.equal(f.win.document.activeElement, input);
  assert.equal(input.type, 'text');
}
async function submitSessionName(f: Awaited<ReturnType<typeof fixture>>, name: string): Promise<void> {
  const input = f.element<HTMLInputElement>('palette-input');
  input.value = name; input.dispatchEvent(new f.win.Event('input'));
  input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  await f.tick(); await f.tick();
}

test('new named session passes its name at launch without a rename RPC and waits for Pi startup', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(gate, { windowWorkspace: '/project', fileExists: () => false });
  try {
    await chooseNamedSession(f);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    await submitSessionName(f, '  Planned work  ');
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    const starts = f.calls.filter(c => c.command === 'start_pi');
    assert.equal(starts.length, 1);
    assert.equal((starts[0].args.config as JsonRecord).mode, 'saved');
    assert.equal((starts[0].args.config as JsonRecord).sessionName, 'Planned work');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'set_session_name'), false);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, true);
    assert.doesNotMatch(f.win.document.querySelector('.session-row')!.textContent!, /Planned work/);
    release(); await f.tick(); await f.tick();
    assert.match(f.win.document.querySelector('.session-row')!.textContent!, /Planned work/);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    assert.equal(f.element('mode-badge').textContent, 'Pi · awaiting first save');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('new named session cancellation and invalid names create no session', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    await chooseNamedSession(f);
    for (const value of ['', '  ', '\0']) {
      await submitSessionName(f, value);
      assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
      assert.equal(f.element<HTMLButtonElement>('palette-create').disabled, true);
      assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    }
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.win.document.querySelectorAll('.session-row').length, 0);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
  } finally { f.dom.window.close(); }
});

test('unconfirmed launch name fails startup without a rename RPC or prompt fallback', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', state: () => ({ sessionFile: '/sessions/new.jsonl', sessionId: 'fixture-id', sessionName: 'Wrong name' }) });
  try {
    await chooseNamedSession(f);
    await submitSessionName(f, 'Planned work');
    assert.match(f.element('launch-error').textContent!, /Pi did not confirm the selected session name/);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, true);
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'set_session_name').length, 0);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    assert.doesNotMatch(f.win.document.querySelector('.session-row')!.textContent!, /Planned work/);
  } finally { f.dom.window.close(); }
});

test('named-session Escape preserves the existing composer and inline Create launches once', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Keep my draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    await chooseNamedSession(f);
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(prompt.value, 'Keep my draft');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    await chooseNamedSession(f);
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'Pointer creation'; input.dispatchEvent(new f.win.Event('input'));
    f.element<HTMLButtonElement>('palette-create').click(); f.element<HTMLButtonElement>('palette-create').click();
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    assert.equal((f.calls.filter(c => c.command === 'start_pi')[1].args.config as JsonRecord).sessionName, 'Pointer creation');
    assert.equal(f.win.document.activeElement, f.element('prompt'));
    assert.equal(prompt.value, 'Keep my draft');
    for (const s of f.sessions.values()) s.channel.onmessage({ kind: 'disconnected', message: 'done' });
  } finally { f.dom.window.close(); }
});

test('welcome stays hidden until startup resolves and appears only without a workspace', async () => {
  const initial = new JSDOM(readFileSync('index.html', 'utf8'));
  assert.equal(initial.window.document.getElementById('welcome')!.hidden, true);
  initial.window.close();
  for (const windowWorkspace of [undefined, '/project']) {
    let release!: () => void;
    const windowWorkspaceGate = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(undefined, { windowWorkspace, windowWorkspaceGate });
    try {
      assert.equal(f.element('welcome').hidden, true);
      assert.equal(f.element('workspace-empty').hidden, true);
      assert.equal(f.element<HTMLButtonElement>('start-pi').disabled, true);
      release(); await f.tick(); await f.tick();
      assert.equal(f.element('welcome').hidden, !!windowWorkspace);
      assert.equal(f.element('workspace-empty').hidden, !windowWorkspace);
      assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
      if (windowWorkspace) assert.equal(f.element('workspace-label').textContent, windowWorkspace);
    } finally { release(); f.dom.window.close(); }
  }
});

test('failed workspace initialization shows the error without flashing welcome', async () => {
  const f = await fixture(undefined, { windowWorkspaceError: 'fixture startup failure' });
  try {
    assert.equal(f.element('welcome').hidden, true);
    assert.match(f.element('launch-error').textContent!, /fixture startup failure/);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
  } finally { f.dom.window.close(); }
});

test('empty workspace actions work and closing the last session does not return to welcome', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('workspace-resume').click(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('palette-title').textContent, 'Resume session');
    f.element<HTMLDialogElement>('command-palette').close();
    f.element<HTMLButtonElement>('workspace-new').click(); await f.tick(); await f.tick();
    assert.equal(f.element('workspace-empty').hidden, true);
    assert.equal(f.element('conversation').hidden, false);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'w', ctrlKey: true, bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(f.element('welcome').hidden, true);
    assert.equal(f.element('workspace-empty').hidden, false);
    assert.equal(f.element('conversation').hidden, true);
  } finally { f.dom.window.close(); }
});

test('external settings edits synchronize Appearance and saved Runtime while preserving unsaved fields', async () => {
  const f = await fixture();
  try {
    f.openSettings();
    const pi = f.element<HTMLInputElement>('pi-path');
    pi.value = '/unsaved/pi'; pi.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    f.preferences.external('{"appearance.theme":"dracula","appearance.zoom":150,"runtime.piPath":"/external/pi","runtime.nodePath":"/external/node"}');
    await f.tick();
    assert.equal(f.element<HTMLSelectElement>('theme-picker').value, 'dracula');
    assert.equal(f.element<HTMLSelectElement>('zoom-level').value, '150');
    assert.equal(pi.value, '/unsaved/pi');
    assert.match(f.element('runtime-status').textContent!, /unsaved edits are retained/);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    f.preferences.external('{broken}');
    assert.equal(f.element('preferences-error').hidden, false);
    assert.equal(f.element<HTMLSelectElement>('theme-picker').value, 'dracula');
    assert.equal(pi.value, '/unsaved/pi');
    f.preferences.external('{"appearance.theme":"dracula","appearance.zoom":150,"runtime.piPath":"/external/pi","runtime.nodePath":"/external/node"}');
    assert.equal(f.element('preferences-error').hidden, true);
    f.back(); f.element<HTMLButtonElement>('start-demo').click(); await f.tick(); await f.tick();
    const config = f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord;
    assert.equal(config.pi, '/external/pi'); assert.equal(config.node, '/external/node');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('shell boots without Pi and Settings holds application preferences, not session controls', async () => {
  const f = await fixture(); const { win, calls, element } = f;
  try {
    assert.deepEqual(calls.map(c => c.command), ['plugin:event|listen', 'preferences_snapshot', 'preferences_migrate', 'plugin:event|listen', 'stop_pi', 'plugin:webview|set_webview_zoom', 'runtime_defaults', 'window_workspace']);
    assert.equal(calls.find(c => c.command === 'plugin:webview|set_webview_zoom')!.args.value, 1.25);
    assert.equal(element<HTMLSelectElement>('zoom-level').value, '125');
    const page = element<HTMLDialogElement>('settings-page');
    for (const id of ['theme-picker', 'theme-file', 'zoom-level', 'pi-path', 'node-path']) assert.ok(page.contains(element(id)), id);
    assert.equal(page.querySelector('[data-pi-id="model"]'), null);
    assert.equal(page.querySelector('[data-pi-id="thinking"]'), null);
    assert.equal(win.document.querySelector('#workspace-bar select, #launch-form #pi-path'), null);
    f.openSettings(); assert.equal(page.open, true);
    const themes = element<HTMLSelectElement>('theme-picker');
    assert.equal(themes.value, 'nimrod');
    themes.value = 'dracula'; themes.dispatchEvent(new win.Event('change')); await f.tick();
    assert.equal(win.document.documentElement.dataset.theme, 'dracula');
    assert.equal(win.document.documentElement.style.getPropertyValue('--vscode-editor-background'), '#282a36');
    assert.equal(JSON.parse(f.preferences.value.text.replace(/^\/\/[^\n]*\n/, ''))['appearance.theme'], 'dracula');
    // Even a synthetic launch request while Settings is open cannot start a process.
    element<HTMLButtonElement>('start-demo').click();
    assert.equal(calls.filter(c => c.command === 'start_pi').length, 0);
    f.back();
    const demo = element<HTMLButtonElement>('start-demo');
    assert.equal(demo.disabled, false); demo.click(); await f.tick(); await f.tick();
    assert.equal(element('welcome').hidden, true); assert.equal(element('conversation').hidden, false);
    assert.equal((calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord).demo, true);
    const prompt = element<HTMLTextAreaElement>('prompt');
    prompt.value = 'hello'; prompt.dispatchEvent(new win.Event('input'));
    prompt.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); assert.equal(prompt.value, '');
    assert.equal(calls.filter(c => (c.args.message as JsonRecord | undefined)?.type === 'prompt').length, 1);
    f.disconnect(); await f.tick(); assert.equal(element<HTMLButtonElement>('send').disabled, true);
  } finally { f.dom.window.close(); }
});

test('Settings preserves a live conversation and saving paths does not mutate its launch', async () => {
  const f = await fixture(); const { win, element, calls } = f;
  try {
    element<HTMLButtonElement>('start-demo').click(); await f.tick(); await f.tick();
    const original = JSON.stringify(calls.find(c => c.command === 'start_pi')!.args.config);
    f.emit({ type: 'agent_start' });
    f.emit({ type: 'message_start', message: { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'tool', name: 'bash', arguments: { command: 'fixture' } }] } });
    f.emit({ type: 'tool_execution_start', toolCallId: 'tool', toolName: 'bash', args: { command: 'fixture' } });
    await f.tick();
    const details = win.document.querySelector<HTMLDetailsElement>('.tool-card')!;
    details.open = true; details.dispatchEvent(new win.Event('toggle'));
    await f.tick(); // Finish manual disclosure's intentional reveal before choosing an inspection position.
    const spinner = details.querySelector('.tool-card-spinner');
    const pane = element('transcript-viewport');
    Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 500 } });
    pane.scrollTop = 200;
    const prompt = element<HTMLTextAreaElement>('prompt'); prompt.value = 'keep my draft'; prompt.dispatchEvent(new win.Event('input')); prompt.focus();
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: ',', metaKey: true, cancelable: true }));
    assert.equal(element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(element('conversation').hidden, false);
    element<HTMLInputElement>('pi-path').value = '/new/pi'; element<HTMLInputElement>('node-path').value = '/new/node';
    element('runtime-settings').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await f.tick();
    assert.equal(JSON.parse(f.preferences.value.text.replace(/^\/\/[^\n]*\n/, ''))['runtime.piPath'], '/new/pi');
    assert.equal(JSON.stringify(calls.find(c => c.command === 'start_pi')!.args.config), original);
    f.emit({ type: 'tool_execution_update', toolCallId: 'tool', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'still streaming' }] } });
    await f.tick();
    assert.equal(win.document.activeElement, element('settings-back'));
    assert.equal(win.document.querySelector('.tool-card'), details); assert.equal(details.querySelector('.tool-card-spinner'), spinner);
    assert.match(details.textContent!, /still streaming/);
    f.back();
    assert.equal(win.document.activeElement, prompt); assert.equal(prompt.value, 'keep my draft');
    assert.equal(pane.scrollTop, 200); assert.equal(details.open, true); assert.equal(spinner?.isConnected, true);
    assert.equal(calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(calls.filter(c => c.command === 'stop_pi').length, 1); // bootstrap only
    assert.equal(calls.filter(c => (c.args.message as JsonRecord | undefined)?.type === 'prompt').length, 0);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('startup completing behind Settings cannot steal settings focus', async () => {
  let finish!: () => void;
  const f = await fixture(new Promise<void>(resolve => { finish = resolve; }));
  try {
    f.element<HTMLButtonElement>('start-demo').click();
    await f.tick();
    f.openSettings();
    finish(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(f.win.document.activeElement, f.element('settings-back'));
    assert.equal(f.element('conversation').hidden, false);
    f.back(); f.disconnect();
  } finally { f.dom.window.close(); }
});

test('saved launch waits for a written Pi file before remembering exact resume identity', async () => {
  let exists = false;
  const f = await fixture(undefined, { fileExists: () => exists });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const config = f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord;
    assert.equal(config.mode, 'saved'); assert.equal(config.demo, false);
    assert.equal(f.element('mode-badge').textContent, 'Pi · awaiting first save');
    assert.equal(f.saved().last, undefined);
    assert.equal((f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args.sessions as JsonRecord[])[0].pi, null);
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'unsent draft'; prompt.dispatchEvent(new f.win.Event('input'));
    assert.ok(Object.keys(f.saved().drafts).some(key => key.startsWith('unassigned:')));
    exists = true;
    f.emit({ type: 'agent_settled' });
    // Stats are deliberately coalesced at 3 seconds; identity shares that existing read.
    await new Promise(resolve => setTimeout(resolve, 3100)); await f.tick();
    assert.equal(f.element('mode-badge').textContent, 'Pi');
    assert.deepEqual(JSON.parse(JSON.stringify((f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args.sessions as JsonRecord[])[0].pi)), { path: '/sessions/new.jsonl', sessionId: 'fixture-id' });
    assert.deepEqual(f.saved().last, { path: '/sessions/new.jsonl', sessionId: 'fixture-id', cwd: '/project' });
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].draft, 'unsent draft');
    assert.equal(prompt.value, 'unsent draft');
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'prompt').length, 0);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('resume last is explicit, restores exact-file history and scoped uncertain draft without replay', async () => {
  const last = { path: '/sessions/exact.jsonl', cwd: '/project', sessionId: 'fixture-id' };
  const f = await fixture(undefined, { storage: { 'nimrod.sessions.v1': { last, drafts: {
    [`file:${last.path}`]: { draft: 'newer draft', submission: { id: 'old-send', text: 'possibly accepted', mode: 'steer', status: 'pending' } },
    'file:/sessions/other.jsonl': { draft: 'other conversation' },
  } } }, history: [{ role: 'user', content: 'restored history', timestamp: 1 }] });
  try {
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    assert.equal(f.element('resume-last').hidden, false);
    f.element<HTMLButtonElement>('resume-last').click(); await f.confirm();
    const config = f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord;
    assert.equal(config.mode, 'resume'); assert.equal(config.sessionFile, last.path); assert.equal(config.sessionId, last.sessionId);
    assert.match(f.element('messages').textContent!, /restored history/);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'newer draft');
    assert.equal(f.saved().drafts[`file:${last.path}`].submission.status, 'unknown');
    assert.equal(f.element<HTMLButtonElement>('send').disabled, true);
    assert.match(f.element('submission-notice').textContent!, /did not confirm/i);
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'prompt').length, 0);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('resume picker cancellation starts nothing and identity mismatch disables submission', async () => {
  const canceled = await fixture(undefined, { filePath: null });
  try {
    canceled.element<HTMLButtonElement>('resume-file').click(); await canceled.tick(); await canceled.tick();
    assert.equal(canceled.calls.some(c => c.command === 'start_pi'), false);
  } finally { canceled.dom.window.close(); }
  const f = await fixture(undefined, { state: () => ({ sessionFile: '/sessions/wrong.jsonl', sessionId: 'wrong-id' }) });
  try {
    f.element<HTMLButtonElement>('resume-file').click(); await f.tick(); await f.tick();
    assert.equal(f.element('welcome').hidden, true);
    assert.match(f.element('launch-error').textContent!, /exact selected session/);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, true);
    assert.equal(f.saved().last, undefined);
    assert.ok(f.calls.filter(c => c.command === 'stop_pi').length > 1);
  } finally { f.dom.window.close(); }
});

test('startup extension editor events apply only after the target draft is bound', async () => {
  const f = await fixture(undefined, { storage: { 'nimrod.poc.composer': { draft: 'legacy' } },
    startupEvents: [{ type: 'extension_ui_request', method: 'set_editor_text', id: 'editor', text: 'extension draft' }],
  });
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'extension draft');
    assert.equal(Object.entries(f.saved().drafts).filter(([key]) => key.startsWith('temporary:/project:')).map(([, value]) => (value as { draft: string }).draft)[0], 'extension draft');
    assert.equal(f.saved().drafts.legacy.draft, 'legacy');
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('new saved session remains persistent when startup identity is absent', async () => {
  const f = await fixture(undefined, { state: () => ({}) });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    assert.equal(f.element('conversation').hidden, false);
    assert.equal(f.element('mode-badge').textContent, 'Pi · awaiting first save');
    assert.equal(f.saved().last, undefined);
    assert.equal(f.calls.some(c => c.command === 'session_file_info'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('invalid native resume does not fall back to a new session or overwrite remembered drafts', async () => {
  const last = { path: '/sessions/missing.jsonl', cwd: '/project', sessionId: 'fixture-id' };
  const f = await fixture(undefined, { startError: 'Session file unavailable', storage: {
    'nimrod.sessions.v1': { last, drafts: { [`file:${last.path}`]: { draft: 'keep me' } } },
  } });
  try {
    f.element<HTMLButtonElement>('resume-last').click(); await f.confirm();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'write_pi').length, 0);
    assert.match(f.element('launch-error').textContent!, /Session file unavailable/);
    assert.equal(f.saved().drafts[`file:${last.path}`].draft, 'keep me');
    assert.deepEqual(f.saved().last, last);
    assert.equal(f.element('welcome').hidden, true);
    assert.match(f.win.document.querySelector('.tab-notice')!.textContent!, /Session file unavailable/);
  } finally { f.dom.window.close(); }
});

test('legacy draft recovery is explicit and demo/temporary drafts never leak into saved sessions', async () => {
  const f = await fixture(undefined, { storage: { 'nimrod.poc.composer': { draft: 'legacy text',
    submission: { id: 'legacy', text: 'legacy text', mode: 'steer', status: 'pending' } } } });
  try {
    assert.equal(f.element('recover-draft').hidden, false);
    f.element<HTMLButtonElement>('start-demo').click(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, '');
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'demo draft'; prompt.dispatchEvent(new f.win.Event('input'));
    f.element<HTMLButtonElement>('disconnect').click(); await f.confirm();
    f.element<HTMLButtonElement>('recover-draft').click(); await f.confirm();
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'legacy text');
    assert.equal(f.element<HTMLButtonElement>('send').disabled, true);
    assert.equal(Object.entries(f.saved().drafts).filter(([key]) => key.startsWith('demo:/project:')).map(([, value]) => (value as { draft: string }).draft)[0], 'demo draft');
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission.status, 'unknown');
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'prompt').length, 0);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('sibling launch can proceed during shutdown and late old receipts cannot clear its draft', async () => {
  let release!: () => void;
  const f = await fixture(undefined, { holdPrompts: true, stopGate: new Promise<void>(resolve => { release = resolve; }) });
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'unacknowledged'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    const oldChannel = f.captureChannel();
    const oldRequest = f.calls.find(c => (c.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    f.element<HTMLButtonElement>('disconnect').click(); await f.confirm();
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    release(); await f.tick(); await f.tick();
    assert.equal(Object.entries(f.saved().drafts).filter(([key]) => key.startsWith('temporary:/project:')).map(([, value]) => (value as { submission: { status: string } }).submission.status)[0], 'unknown');
    const newPrompt = f.element<HTMLTextAreaElement>('prompt');
    assert.notEqual(newPrompt, prompt);
    assert.equal(newPrompt.value, '');
    newPrompt.value = 'new saved draft'; newPrompt.dispatchEvent(new f.win.Event('input'));
    oldChannel.onmessage({ kind: 'rpc', value: { type: 'response', id: oldRequest.id, success: true } });
    await f.tick(); assert.equal(newPrompt.value, 'new saved draft');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'prompt').length, 1);
    f.disconnect();
  } finally { release(); f.dom.window.close(); }
});

test('project opens without Pi, lists and searches sessions, and focuses an already-open tab', async () => {
  const catalog = [
    { path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'Implement sidebar', preview: 'first task', modified: 20 },
    { path: '/sessions/b.jsonl', sessionId: 'fixture-id', name: 'Review changes', preview: 'second task', modified: 10 },
  ];
  const f = await fixture(undefined, { catalog, state: () => ({ sessionName: 'Review changes', sessionFile: '/sessions/b.jsonl', sessionId: 'fixture-id' }) });
  try {
    f.element<HTMLButtonElement>('enter-workspace').click(); await f.tick(); await f.tick();
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    assert.equal(f.element('session-sidebar').hidden, false);
    assert.equal(f.win.document.querySelector('#sidebar-workspace, #sidebar-directory, #open-section, .sidebar-actions'), null);
    assert.equal(f.win.document.querySelector('#all-sessions, #session-tabs'), null);
    f.element<HTMLButtonElement>('open-palette').click();
    const search = f.element<HTMLInputElement>('palette-input');
    search.value = 'open project'; search.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').children.length, 1);
    assert.match(f.element('palette-list').textContent!, /Open project…/);
    search.value = 'resume'; search.dispatchEvent(new f.win.Event('input'));
    search.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.element('palette-list').children.length, 2);
    assert.equal(search.placeholder, 'Type to filter project sessions…');
    assert.equal(search.getAttribute('aria-label'), 'Search project sessions');
    assert.equal(f.element('open-workspace').textContent, 'Open project…');
    assert.equal(f.element('recent-workspaces').getAttribute('aria-label'), 'Recent projects');
    assert.doesNotMatch(f.element('welcome').textContent!, /workspace/i);
    assert.doesNotMatch(f.element('workspace-empty').textContent!, /workspace/i);
    assert.deepEqual(f.preferences.value.state['nimrod.workspaces.v1'], ['/project']);
    search.value = 'review'; search.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').children.length, 1);
    (f.element('palette-list').firstElementChild as HTMLElement).click(); await f.tick(); await f.tick();
    assert.equal(f.win.document.querySelectorAll('#open-sessions .session-row').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    f.element<HTMLButtonElement>('open-palette').click();
    search.value = 'resume'; search.dispatchEvent(new f.win.Event('input'));
    search.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    search.value = 'review'; search.dispatchEvent(new f.win.Event('input'));
    (f.element('palette-list').firstElementChild as HTMLElement).click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    f.element<HTMLButtonElement>('toggle-sidebar').click(); assert.equal(f.element('session-sidebar').hidden, true);
    f.element<HTMLButtonElement>('toggle-sidebar').click(); assert.equal(f.element('session-sidebar').hidden, false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('live tabs isolate drafts, background acknowledgements and transports without stopping on selection', async () => {
  const f = await fixture(undefined, { holdPrompts: true });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const first = f.element<HTMLTextAreaElement>('prompt');
    first.value = 'first submission'; first.dispatchEvent(new f.win.Event('input'));
    first.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    first.value = 'newer first draft'; first.dispatchEvent(new f.win.Event('input'));
    const firstChannel = f.captureChannel();
    const request = f.calls.find(c => (c.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const second = f.element<HTMLTextAreaElement>('prompt'); second.value = 'second draft'; second.dispatchEvent(new f.win.Event('input'));
    firstChannel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } }); await f.tick();
    assert.equal(second.value, 'second draft'); assert.equal(first.value, 'newer first draft');
    const tabButtons = f.win.document.querySelectorAll<HTMLButtonElement>('#open-sessions .session-row');
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: '[', code: 'BracketLeft', metaKey: true, shiftKey: true, cancelable: true })); await f.tick();
    assert.equal(f.element('prompt'), first);
    tabButtons[1].click(); await f.tick(); assert.equal(f.element('prompt'), second);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, 1);
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].draft, 'newer first draft');
    assert.equal(f.saved().drafts['file:/sessions/new-1.jsonl'].draft, 'second draft');
    const ids = [...f.win.document.querySelectorAll('[id]')].map(n => n.id); assert.equal(new Set(ids).size, ids.length);
    for (const s of f.sessions.values()) s.channel.onmessage({ kind: 'disconnected', message: 'done' });
  } finally { f.dom.window.close(); }
});

test('closing one idle tab stops only its token, preserves history and leaves its sibling usable', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const firstToken = String(f.calls.find(c => c.command === 'start_pi')!.args.token);
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const second = f.element('prompt');
    f.win.document.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    assert.equal(f.win.document.querySelectorAll('#open-sessions .session-row').length, 1);
    assert.equal(f.element('prompt'), second);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').at(-1)!.args.token, firstToken);
    assert.ok(f.saved().drafts['file:/sessions/new.jsonl']);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('the selected restored tab loads automatically without replaying its scoped uncertain draft', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', storage: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'Earlier work' }], active: '/sessions/a.jsonl' },
    'nimrod.sessions.v1:/project': { drafts: { 'file:/sessions/a.jsonl': { draft: 'retained', submission: { id: 'old', text: 'uncertain', mode: 'steer', status: 'pending' } } } },
  } });
  try {
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.win.document.querySelectorAll('#open-sessions .session-row').length, 1);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'retained');
    assert.equal(f.saved().drafts['file:/sessions/a.jsonl'].submission.status, 'unknown');
    assert.equal(f.win.document.querySelector('.tab-notice button'), null);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('a background extension dialog is labeled and replies only to its originating session', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-demo').click(); await f.tick(); await f.tick();
    const first = [...f.sessions.entries()][0];
    f.element<HTMLButtonElement>('open-palette').click();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'new offline demo'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    const secondPrompt = f.element('prompt');
    first[1].channel.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'input', id: 'question', title: 'Need input' } });
    await f.tick();
    assert.match(f.element('host-dialog-title').textContent!, /Offline demo — Need input/);
    assert.match(f.win.document.querySelector('#open-sessions .session-row')!.getAttribute('aria-label')!, /Input needed/);
    f.element<HTMLTextAreaElement>('host-dialog-input').value = 'answer'; await f.confirm();
    const response = f.calls.find(c => (c.args.message as JsonRecord)?.type === 'extension_ui_response');
    assert.equal(response?.args.token, first[0]);
    assert.equal((response?.args.message as JsonRecord).value, 'answer');
    assert.equal(f.element('prompt'), secondPrompt);
    for (const s of f.sessions.values()) s.channel.onmessage({ kind: 'disconnected', message: 'done' });
  } finally { f.dom.window.close(); }
});

test('Cmd-Shift-P resume flow filters history and opens only the selected exact file', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog: [
    { path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'First task', preview: 'Layout implementation', modified: 2 },
    { path: '/sessions/b.jsonl', sessionId: 'fixture-id', name: 'Second task', preview: 'Review navigation', modified: 1 },
  ] });
  try {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true }));
    const input = f.element<HTMLInputElement>('palette-input');
    const key = (key: string) => input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    input.value = 'resume'; input.dispatchEvent(new f.win.Event('input')); key('Enter'); await f.tick();
    input.value = 'review'; input.dispatchEvent(new f.win.Event('input')); key('Enter'); await f.tick(); await f.tick();
    const starts = f.calls.filter(c => c.command === 'start_pi');
    assert.equal(starts.length, 1);
    assert.equal((starts[0].args.config as JsonRecord).sessionFile, '/sessions/b.jsonl');
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.win.document.activeElement, f.element('prompt'));
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('Pi dialogs retain focus priority above the palette without dismissing it', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-demo').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.focus();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true }));
    f.emit({ type: 'extension_ui_request', method: 'input', id: 'above-palette', title: 'Pi question' }); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.win.document.activeElement, f.element('host-dialog-input'));
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true }));
    assert.equal(f.win.document.activeElement, f.element('host-dialog-input'));
    await f.confirm(); assert.equal(f.win.document.activeElement, f.element('palette-input'));
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    assert.equal(f.win.document.activeElement, prompt);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('brand-new unwritten session can select its first model and effort through the palette', async () => {
  const f = await fixture(undefined, { modelFixture: true, fileExists: () => false });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Unsent draft'; prompt.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('mode-badge').textContent, 'Pi · awaiting first save');
    f.element<HTMLButtonElement>('thinking').click(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.match(f.element('palette-status').textContent!, /Select a model/);
    const key = (key: string) => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    key('Escape'); key('Escape');
    f.element<HTMLButtonElement>('model').click(); await f.tick();
    assert.equal(f.element('palette-title').textContent, 'Select model');
    assert.match(f.element('palette-list').textContent!, /fixture\/reasoner/);
    assert.doesNotMatch(f.element('palette-list').textContent!, /outside-scope/);
    assert.equal(f.element<HTMLDialogElement>('host-dialog').open, false);
    key('Enter'); await f.tick(); await f.tick();
    assert.equal(f.element('model').textContent, 'reasoner');
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true }));
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'effort'; input.dispatchEvent(new f.win.Event('input')); key('Enter'); await f.tick();
    assert.equal(f.element('palette-title').textContent, 'Select thinking level');
    assert.match(f.element('palette-list').textContent!, /Current/);
    input.value = 'high'; input.dispatchEvent(new f.win.Event('input')); key('Enter'); await f.tick(); await f.tick();
    assert.equal(f.element('thinking').textContent, 'high');
    assert.equal(prompt.value, 'Unsent draft');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    assert.equal(f.saved().last, undefined);
    f.disconnect();
  } finally { f.dom.window.close(); }
});


test('pop-out route mounts only read-only code, copies exact text and follows theme changes without Pi', async () => {
  const snapshot = { session: 'source', title: 'Source session', text: 'const x = "<tag>";\n', language: 'ts' };
  const f = await fixture(undefined, { popout: snapshot });
  try {
    await f.tick();
    assert.equal(f.win.document.querySelector('pre > code')!.textContent, snapshot.text);
    assert.equal(f.win.document.querySelector('header, .popout-heading, .popout-title, .popout-copy-source'), null);
    assert.doesNotMatch(f.win.document.body.textContent!, /Source session|Read-only snapshot/);
    assert.equal(f.win.document.title, 'const x = "<tag>";');
    assert.equal(f.calls.find(call => call.command === 'plugin:window|set_title')!.args.value, f.win.document.title);
    assert.equal(f.win.document.querySelectorAll('.code-copy').length, 1);
    assert.equal(f.win.document.querySelector('#workspace-bar, #composer, .code-popout'), null);
    assert.equal(f.calls.some(call => ['start_pi', 'stop_pi', 'runtime_defaults', 'window_workspace'].includes(call.command)), false);
    f.win.document.querySelector<HTMLButtonElement>('.code-copy')!.click(); await f.tick();
    assert.equal(f.calls.find(call => call.command === 'plugin:clipboard-manager|write_text')!.args.text, snapshot.text);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('.code-copy')!.title, 'Copied to clipboard');
    f.preferences.external(JSON.stringify({ 'appearance.theme': 'dracula' })); await f.tick();
    assert.equal(f.win.document.documentElement.style.getPropertyValue('--vscode-editor-background'), '#282a36');
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'w', metaKey: true, cancelable: true })); await f.tick();
    assert.ok(f.calls.some(call => call.command === 'plugin:window|close'));
    assert.equal(f.calls.some(call => call.command === 'stop_pi'), false);
  } finally { f.win.close(); }
});

test('shell routes code pop-outs with session identity without sending a Pi operation', async () => {
  const f = await fixture(undefined, { history: [{ role: 'assistant', content: [{ type: 'text', text: '```ts\nconst reference = 1;\n```' }] }] });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const before = f.calls.filter(call => call.command === 'write_pi').length;
    f.win.document.querySelector<HTMLButtonElement>('.code-popout')!.click(); await f.tick();
    const snapshot = f.calls.find(call => call.command === 'open_code_popout')!.args.snapshot as JsonRecord;
    assert.equal(snapshot.text, 'const reference = 1;\n');
    assert.equal(snapshot.language, 'ts');
    assert.equal(typeof snapshot.session, 'string');
    assert.equal('key' in snapshot, false);
    assert.equal(f.calls.filter(call => call.command === 'write_pi').length, before);
  } finally { f.win.close(); }
});


for (const language of ['markdown', 'md', 'MKDOWN', 'mkd']) {
  test(`Markdown pop-outs render formatting, retain source copying and handle nested code (${language})`, async () => {
    const text = '# Reference\n\n**Important**\n\n- first\n- second\n\n[web](https://example.com) [file](README.md:12) [bad](javascript:alert%281%29)\n\n```ts\nconst nested = "<tag>";\n```\n\n<script>alert(1)</script>\n';
    const f = await fixture(undefined, { popout: { session: 'source', title: 'Source session', text, language } });
    try {
      await f.tick();
      assert.equal(f.win.document.querySelector('.popout-content h1')!.textContent, 'Reference');
      assert.equal(f.win.document.querySelector('.popout-content strong')!.textContent, 'Important');
      assert.equal(f.win.document.querySelectorAll('.popout-content li').length, 2);
      assert.equal(f.win.document.querySelector('script:not([type="module"]), .code-popout'), null);
      assert.equal(f.win.document.querySelector('header, .popout-heading, .popout-title'), null);
      assert.equal(f.win.document.title, 'Reference');
      assert.equal(f.calls.find(call => call.command === 'plugin:window|set_title')!.args.value, 'Reference');
      assert.doesNotMatch(f.win.document.body.textContent!, /Source session|Read-only snapshot/);
      const sourceCopy = f.win.document.querySelector<HTMLButtonElement>('.popout-copy-source .code-copy')!;
      assert.equal(sourceCopy.textContent, '');
      sourceCopy.click(); await f.tick();
      assert.equal(f.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)!.args.text, text);
      f.win.document.querySelector<HTMLButtonElement>('.popout-content .code-copy')!.querySelector('path')!.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true }));
      await f.tick();
      assert.equal(f.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)!.args.text, 'const nested = "<tag>";\n');
      const links = f.win.document.querySelectorAll('.popout-content a');
      for (const link of links) {
        assert.equal(link.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true, cancelable: true })), false);
      }
      await f.tick();
      assert.deepEqual(f.calls.filter(call => call.command === 'open_popout_link').map(call => call.args.href), ['https://example.com', 'README.md:12']);
      assert.equal(f.calls.some(call => ['start_pi', 'stop_pi', 'write_pi'].includes(call.command)), false);
    } finally { f.win.close(); }
  });
}


test('session selection synchronizes only its own pop-outs and Close retains saved session provenance', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    let sync = f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    const first = (sync.sessions as JsonRecord[])[0];
    assert.deepEqual(JSON.parse(JSON.stringify(first.pi)), { path: '/sessions/new.jsonl', sessionId: 'fixture-id' });
    assert.equal(sync.active, first.runtimeId);
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    sync = f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    const second = (sync.sessions as JsonRecord[])[1];
    assert.deepEqual(JSON.parse(JSON.stringify(second.pi)), { path: '/sessions/new-1.jsonl', sessionId: 'fixture-id' });
    assert.equal(sync.active, second.runtimeId);
    f.win.document.querySelector<HTMLButtonElement>('.session-row')!.click(); await f.tick();
    sync = f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    assert.equal(sync.active, first.runtimeId);
    f.win.document.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    sync = f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    assert.equal(sync.active, second.runtimeId);
    assert.equal((sync.sessions as JsonRecord[]).length, 1);
    assert.equal(f.calls.some(c => c.command === 'delete_popout'), false);
    f.win.document.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    sync = f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    assert.deepEqual(JSON.parse(JSON.stringify(sync)), { sessions: [], active: null });
  } finally { f.win.close(); }
});

test('restored session layout sends durable pop-out ownership despite regenerated mounted identity and absent source history', async () => {
  const layout = { tabs: [{ path: '/sessions/exact.jsonl', sessionId: 'fixture-id', name: 'A' }], active: '/sessions/exact.jsonl' };
  const options = { windowWorkspace: '/project', storage: { 'nimrod.tabs.v1:/project': layout }, history: [] };
  const first = await fixture(undefined, options);
  let firstRuntime: unknown;
  try {
    await first.tick(); await first.tick();
    const sync = first.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    firstRuntime = (sync.sessions as JsonRecord[])[0].runtimeId;
    assert.deepEqual(JSON.parse(JSON.stringify((sync.sessions as JsonRecord[])[0].pi)), { path: '/sessions/exact.jsonl', sessionId: 'fixture-id' });
    assert.equal(sync.active, firstRuntime);
  } finally { first.win.close(); }
  const reopened = await fixture(undefined, options);
  try {
    await reopened.tick(); await reopened.tick();
    const sync = reopened.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    assert.notEqual((sync.sessions as JsonRecord[])[0].runtimeId, firstRuntime);
    assert.deepEqual(JSON.parse(JSON.stringify((sync.sessions as JsonRecord[])[0].pi)), { path: '/sessions/exact.jsonl', sessionId: 'fixture-id' });
    assert.equal(reopened.win.document.querySelectorAll('.code-block').length, 0);
    assert.equal(reopened.calls.some(c => (c.args.message as JsonRecord | undefined)?.type === 'prompt'), false);
  } finally { reopened.win.close(); }
});


test('restored session focuses its composer while pop-out sync is pending; late completion preserves dialog focus', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const layout = { tabs: [{ path: '/sessions/exact.jsonl', sessionId: 'fixture-id', name: 'A' }], active: '/sessions/exact.jsonl' };
  const f = await fixture(undefined, { windowWorkspace: '/project', storage: { 'nimrod.tabs.v1:/project': layout }, popoutSyncGate: gate });
  try {
    await f.tick(); await f.tick();
    assert.ok(f.calls.some(c => c.command === 'sync_popout_sessions'));
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    assert.equal(f.win.document.activeElement, prompt);
    f.openSettings();
    assert.equal(f.win.document.activeElement, f.element('settings-back'));
    release(); await f.tick(); await f.tick();
    assert.equal(f.win.document.activeElement, f.element('settings-back'));
    f.back();
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord | undefined)?.type === 'prompt'), false);
  } finally { release(); f.win.close(); }
});
