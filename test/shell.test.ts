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
import { parseSettings } from '../src/preferences';
import type { DeletionEvent, DeletionSnapshot } from '../src/session-deletion';

// Real shell/renderer/controller bundle, mocked native boundary—not native WebKit acceptance.
interface ShellOptions {
  storage?: Record<string, unknown>;
  appState?: Record<string, unknown>;
  state?: () => JsonRecord;
  history?: JsonRecord[];
  fileTimes?: Record<string, number>;
  fileParents?: Record<string, string>;
  clock?: () => number;
  timeRefresh?: (() => void)[];
  fileExists?: () => boolean;
  selectedId?: string;
  filePath?: string | null;
  holdPrompts?: boolean;
  focused?: () => boolean;
  notificationError?: string;
  notificationDiagnosticsError?: string;
  notificationFocusGate?: Promise<void>;
  startError?: string;
  stopGate?: Promise<void>;
  stopError?: () => string | undefined;
  startupEvents?: JsonRecord[];
  catalog?: JsonRecord[];
  windowLabel?: string;
  windowWorkspace?: string;
  windowWorkspaceGate?: Promise<void>;
  windowWorkspaceError?: string;
  modelFixture?: boolean;
  popout?: { session: string; title: string; text: string; language: string };
  popoutSyncGate?: Promise<void>;
  deletionSnapshot?: DeletionSnapshot;
  deleteTree?: (emit: (event: DeletionEvent) => void, args: JsonRecord) => Promise<unknown>;
  confirmReview?: (args: JsonRecord) => void;
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
  if (options.clock) win.Date.now = options.clock;
  if (options.timeRefresh) {
    const interval = win.setInterval.bind(win);
    win.setInterval = (handler, delay, ...args) => {
      if (delay === 60_000 && typeof handler === 'function') options.timeRefresh!.push(handler as () => void);
      return interval(handler, delay, ...args);
    };
  }
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
  Object.assign(preferences.value.state, options.appState);
  const callbacks = new Map<number, (event: unknown) => void>();
  let deletionEvent: ((event: DeletionEvent, target?: string) => void) | undefined;
  let notificationClick: ((event: unknown, target?: string) => void) | undefined;
  Object.assign(win, { TextEncoder, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: options.windowLabel || 'main' }, currentWebview: { label: options.windowLabel || 'main' } },
    transformCallback: (callback: (event: unknown) => void) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; }, unregisterCallback: () => {},
    invoke: async (command: string, args: JsonRecord = {}) => {
      calls.push({ command, args });
      if (command === 'plugin:event|listen') {
        if (args.event === 'nimrod-preferences') preferences.receive = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (args.event === 'nimrod-session-deletion') deletionEvent = (payload, target) => {
          const listenerTarget = args.target as { kind: string; label?: string };
          // Tauri Any listeners receive even events emitted to a different label.
          if (!target || listenerTarget.kind === 'Any' || listenerTarget.label === target) callbacks.get(Number(args.handler))?.({ payload });
        };
        if (args.event === 'nimrod-notification-click') notificationClick = (payload, target) => {
          const listenerTarget = args.target as { kind: string; label?: string };
          if (!target || listenerTarget.kind === 'Any' || listenerTarget.label === target) callbacks.get(Number(args.handler))?.({ payload });
        };
        return 1;
      }
      if (command === 'plugin:event|unlisten') return 1;
      if (command.startsWith('preferences_')) return preferences.invoke(command, args);
      if (command === 'plugin:window|is_focused') return options.focused?.() ?? true;
      if (command === 'prepare_notifications') return;
      if (command === 'focus_notification_window') { await options.notificationFocusGate; return; }
      if (command === 'notification_diagnostics') {
        if (options.notificationDiagnosticsError) throw new Error(options.notificationDiagnosticsError);
        return 'macOS: authorized; desktop alerts: enabled; style: temporary; Notification Center: enabled; app active: yes; foreground handler calls: 1 (requests Banner + List).';
      }
      if (command === 'notify_session' || command === 'test_notification') {
        if (options.notificationError) throw new Error(options.notificationError);
        return 'submitted';
      }
      if (command === 'sync_popout_sessions') { await options.popoutSyncGate; return { warnings: [] }; }
      if (command === 'code_popout_snapshot') return options.popout;
      if (command === 'deletion_snapshot') return options.deletionSnapshot || { pending: false, quarantine: [], files: [] };
      if (command === 'acknowledge_deletion' || command === 'recover_deletion_session') return;
      if (command === 'confirm_session_deletion') { options.confirmReview?.(args); return; }
      if (command === 'delete_session_tree') return options.deleteTree ? options.deleteTree(event => deletionEvent?.(event), args) : [];
      if (command === 'runtime_defaults') return { cwd: '/project', pi: '/bin/pi', node: '/bin/node' };
      if (command === 'window_workspace') {
        await options.windowWorkspaceGate;
        if (options.windowWorkspaceError) throw new Error(options.windowWorkspaceError);
        return workspace || null;
      }
      if (command === 'open_workspace') { workspace = String(args.cwd); return { cwd: workspace, current: true }; }
      if (command === 'list_workspace_sessions') return { sessions: options.catalog || [], warnings: [] };
      if (command === 'plugin:dialog|open') return options.filePath === null ? null : options.filePath || '/sessions/exact.jsonl';
      if (command === 'stop_pi' && activeToken!) {
        const error = options.stopError?.(); if (error) throw new Error(error);
        await options.stopGate;
      }
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
      if (command === 'inspect_workspace_session') return { path: args.path, sessionId: options.selectedId || 'fixture-id', exists: true, parentSession: options.fileParents?.[String(args.path)], lastUserMessageAt: options.fileTimes?.[String(args.path)] };
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
  const openPalette = () => win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'p', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
  // Identify sessions by mounted conversation order, not mutable sidebar positions.
  const rows = () => [...win.document.querySelectorAll('.session-view')].map(root => win.document.querySelector<HTMLButtonElement>(`.session-row[aria-controls="${root.id}"]`)!);
  return { dom, win, tick, calls, element, openSettings, back, preferences, openPalette, rows,
    confirm: async () => { await tick(); element<HTMLDialogElement>('host-dialog').close('ok'); await tick(); await tick(); },
    saved: () => JSON.parse(win.localStorage.getItem(`nimrod.sessions.v1:${workspace}`) || win.localStorage.getItem('nimrod.sessions.v1') || '{}'),
    sessions,
    deletionEvent: (event: DeletionEvent, target?: string) => deletionEvent?.(event, target),
    notificationClick: (event: unknown, target?: string) => notificationClick?.(event, target),
    captureChannel: () => channel,
    emit: (event: JsonRecord) => channel.onmessage({ kind: 'rpc', value: event }),
    disconnect: () => channel.onmessage({ kind: 'disconnected', message: 'fixture closed' }),
  };
}

test('customizable requested shortcuts use normal session/model/effort actions without submitting drafts', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', modelFixture: true, fileExists: () => false });
  const key = (key: string, extra: KeyboardEventInit = {}) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...extra }));
  const escape = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  try {
    key('n'); await f.tick(); await f.tick();
    assert.equal((f.calls.find(call => call.command === 'start_pi')!.args.config as JsonRecord).mode, 'saved');
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Retain this draft'; prompt.dispatchEvent(new f.win.Event('input'));
    key('m'); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Select model');
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    key('e'); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Select thinking level'); escape();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    const before = f.calls.filter(call => call.command === 'start_pi').length;
    key('n', { repeat: true }); key('n', { isComposing: true }); await f.tick(); assert.equal(f.calls.filter(call => call.command === 'start_pi').length, before);
    key('N', { shiftKey: true }); await f.tick(); await f.tick();
    assert.equal((f.calls.filter(call => call.command === 'start_pi').at(-1)!.args.config as JsonRecord).mode, 'temporary');
    assert.equal(prompt.value, 'Retain this draft'); assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
    key('Backspace'); await f.tick(); assert.equal(f.calls.some(call => call.command === 'delete_session_tree'), false, 'temporary session is not deletable');
    f.openSettings(); key('n'); await f.tick(); assert.equal(f.calls.filter(call => call.command === 'start_pi').length, before + 1);
    f.back();
    f.preferences.external('{"keybindings":{"new":[],"temporary":["primary+j"],"palette":["primary+l"]}}');
    key('n'); await f.tick(); assert.equal(f.calls.filter(call => call.command === 'start_pi').length, before + 1);
    key('j'); await f.tick(); await f.tick(); assert.equal(f.calls.filter(call => call.command === 'start_pi').length, before + 2);
    f.openPalette(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false, 'old palette binding is disabled');
    key('l'); assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.match(f.element('palette-list').textContent!, /Ctrl\+J/);
    escape(); f.openSettings(); assert.ok(f.element('keybindings-section')); assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('session navigation and named-session defaults open their distinct pickers without accidental launches', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog: [
    { path: '/sessions/closed.jsonl', sessionId: 'closed-id', name: 'Closed history', preview: 'Historical conversation', modified: 1 },
  ] });
  const key = (key: string, extra: KeyboardEventInit = {}) => {
    const event = new f.win.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...extra });
    f.win.dispatchEvent(event); return event;
  };
  const escape = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  try {
    key('n'); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Navigation must retain this draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const starts = f.calls.filter(call => call.command === 'start_pi').length;
    key('t'); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Switch session');
    assert.equal(f.element('palette-list').children.length, 1); assert.doesNotMatch(f.element('palette-list').textContent!, /Closed history/);
    assert.equal(f.calls.some(call => call.command === 'list_workspace_sessions'), false);
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false); assert.equal(f.calls.filter(call => call.command === 'start_pi').length, starts);
    assert.equal(key('p').defaultPrevented, false); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    key('k'); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Resume session');
    assert.match(f.element('palette-list').textContent!, /Closed history/); assert.match(f.element('palette-list').textContent!, /Open/);
    assert.equal(f.calls.filter(call => call.command === 'list_workspace_sessions').length, 1);
    key('t'); key('n', { altKey: true }); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Resume session');
    escape(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    key('n', { altKey: true }); await f.tick(); assert.equal(f.element('palette-title').textContent, 'New named session');
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, starts);
    escape(); await f.tick(); assert.equal(prompt.value, 'Navigation must retain this draft'); assert.equal(f.win.document.activeElement, prompt);
    key('n', { altKey: true, repeat: true }); key('k', { isComposing: true }); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    // Native macOS Option-N can report a dead key rather than the letter n.
    key('Dead', { code: 'KeyN', altKey: true }); await submitSessionName(f, 'Shortcut named session');
    const launches = f.calls.filter(call => call.command === 'start_pi'); assert.equal(launches.length, starts + 1);
    assert.equal((launches.at(-1)!.args.config as JsonRecord).sessionName, 'Shortcut named session');
    assert.equal((launches.at(-1)!.args.config as JsonRecord).mode, 'saved');
    assert.equal(prompt.value, 'Navigation must retain this draft');
    assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
    f.preferences.external('{"keybindings":{"new-named":[],"switch-session":["primary+j"],"resume":[]}}');
    key('t'); key('k'); key('n', { altKey: true }); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    key('j'); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Switch session');
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, starts + 1);
  } finally { f.win.close(); }
});

test('Cmd-Backspace invokes the existing review and Cancel preserves the selected saved session', async () => {
  let answer!: (value: boolean) => void;
  const f = await fixture(undefined, { windowWorkspace: '/project', confirmReview: args => answer(args.confirmed === true), deleteTree: async emit => {
    const confirmed = new Promise<boolean>(resolve => { answer = resolve; });
    emit({ id: 'keybinding-review', phase: 'review', files: ['/sessions/new.jsonl'], results: [], pending: true, tree: [{ file: '/sessions/new.jsonl', title: 'Root' }] });
    assert.equal(await confirmed, false); return [];
  } });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Do not erase draft'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true); assert.equal(f.calls.filter(call => call.command === 'delete_session_tree').length, 1);
    f.element<HTMLDialogElement>('deletion-review').close('cancel'); await f.tick(); await f.tick();
    assert.equal(f.rows().length, 1); assert.equal(prompt.value, 'Do not erase draft');
    assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('sidebar resizing restores and persists per-project app state without harness or settings effects', async () => {
  for (const [project, width] of [['/project', 340], ['/other', 410]] as const) {
    const key = `nimrod.sidebar.width:${project}`;
    const f = await fixture(undefined, { windowWorkspace: project, appState: { [key]: width, 'nimrod.sidebar.width:/unrelated': 480 } });
    try {
      const handle = f.element('sidebar-resizer');
      assert.equal(handle.hidden, false); assert.equal(handle.getAttribute('aria-valuenow'), String(width));
      handle.focus(); handle.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await f.tick();
      assert.equal(f.preferences.value.state[key], width + 10);
      assert.equal(f.preferences.value.state['nimrod.sidebar.width:/unrelated'], 480);
      assert.equal(f.calls.some(call => call.command === 'start_pi' || call.command === 'write_pi' || call.command === 'preferences_settings'), false);
      f.element<HTMLButtonElement>('toggle-sidebar').click();
      assert.equal(handle.hidden, true); assert.equal(f.win.document.activeElement, f.element('toggle-sidebar'));
      f.element<HTMLButtonElement>('toggle-sidebar').click();
      assert.equal(handle.hidden, false); assert.equal(handle.getAttribute('aria-valuenow'), String(width + 10));
    } finally { f.win.close(); }
    const restored = await fixture(undefined, { windowWorkspace: project, appState: { [key]: width + 10 } });
    try { assert.equal(restored.element('sidebar-resizer').getAttribute('aria-valuenow'), String(width + 10)); }
    finally { restored.win.close(); }
  }
});

test('new sessions use creation time, update only after prompt acknowledgement and timer refresh is text-only', async () => {
  let now = new Date(2026, 6, 17, 12).getTime();
  const refresh: (() => void)[] = [];
  const f = await fixture(undefined, { windowWorkspace: '/project', clock: () => now, timeRefresh: refresh, holdPrompts: true });
  try {
    for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
    const rows = f.rows(), order = () => [...f.win.document.querySelectorAll('.session-row')];
    assert.deepEqual(order(), [rows[1], rows[0]], 'same-clock creations still insert newest first');
    const times = () => (f.preferences.value.state['nimrod.tabs.v1:/project'] as { tabs: { lastUsed: number }[] }).tabs.map(tab => tab.lastUsed);
    assert.deepEqual(times(), [now, now + 1]);
    rows[0].click(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep newer draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const timestamp = rows[0].querySelector('time')!, node = timestamp;
    const calls = f.calls.length, state = JSON.stringify(f.preferences.value.state), selected = rows[0].getAttribute('aria-current');
    now += 120_000; refresh[0]();
    assert.match(timestamp.textContent!, /^2 minutes ago · /); assert.equal(rows[0].querySelector('time'), node);
    assert.deepEqual(order(), [rows[1], rows[0]]); assert.equal(rows[0].getAttribute('aria-current'), selected);
    assert.equal(f.win.document.activeElement, prompt); assert.equal(prompt.value, 'Keep newer draft');
    assert.equal(f.calls.length, calls); assert.equal(JSON.stringify(f.preferences.value.state), state);
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.deepEqual(times(), [now - 120_000, now - 120_000 + 1], 'pending send is not recency');
    assert.equal(rows[0].querySelector<HTMLElement>('.session-indicator')!.dataset.state, 'sending');
    const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    [...f.sessions.values()][0].channel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } }); await f.tick();
    assert.deepEqual(order(), [rows[0], rows[1]]); assert.equal(times()[0], now);
    assert.match(timestamp.textContent!, /^Just now · /);
  } finally { f.win.close(); }
});

test('history resume inserts at historical recency, Close/Resume retains it and confirmed deletion purges it', async () => {
  const key = 'nimrod.tabs.v1:/project', cache = 'nimrod.recency.v1:/project';
  const layout = { tabs: [
    { path: '/sessions/newer', sessionId: 'fixture-id', name: 'Newer', lastUsed: 1000 },
    { path: '/sessions/older', sessionId: 'fixture-id', name: 'Older', lastUsed: 100 },
  ], active: '/sessions/newer' };
  const options: ShellOptions = { windowWorkspace: '/project', appState: { [key]: layout }, catalog: [
    { path: '/sessions/restored', sessionId: 'fixture-id', name: 'Restored', preview: '', modified: 9999999999999, lastUserMessageAt: 700 },
  ], deleteTree: async () => [{ file: '/sessions/restored', deleted: true }] };
  const f = await fixture(undefined, options);
  const resume = async () => {
    f.openPalette(); const query = f.element<HTMLInputElement>('palette-input'); query.value = 'resume session'; query.dispatchEvent(new f.win.Event('input'));
    query.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    [...f.win.document.querySelectorAll<HTMLElement>('#palette-list [role=option]')].find(item => item.textContent!.includes('Restored'))!.click(); await f.tick(); await f.tick();
  };
  try {
    await f.tick(); await resume();
    const rows = f.rows(), order = () => [...f.win.document.querySelectorAll('.session-row')];
    assert.deepEqual(order(), [rows[0], rows[2], rows[1]], 'resume neither appends nor bumps to now/mtime');
    assert.equal((f.preferences.value.state[cache] as JsonRecord)['/sessions/restored'] && ((f.preferences.value.state[cache] as JsonRecord)['/sessions/restored'] as JsonRecord).lastUsed, 700);
    rows[2].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    assert.equal(((f.preferences.value.state[cache] as JsonRecord)['/sessions/restored'] as JsonRecord).lastUsed, 700);
    options.catalog![0].lastUserMessageAt = 600; await resume();
    const reopened = f.rows()[2]; assert.equal(reopened.querySelector('time')!.getAttribute('datetime'), new Date(700).toISOString());
    assert.deepEqual(order(), [rows[0], reopened, rows[1]]);
    f.element<HTMLButtonElement>('delete-session').click(); await f.tick(); await f.tick();
    assert.equal((f.preferences.value.state[cache] as JsonRecord)['/sessions/restored'], undefined);
  } finally { f.win.close(); }
});

test('legacy unknown recency seeds before insertion from read-only metadata, not restored RPC history', async () => {
  const key = 'nimrod.tabs.v1:/project';
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: { [key]: { tabs: [
    { path: '/sessions/old', sessionId: 'fixture-id', name: 'Old' },
    { path: '/sessions/new', sessionId: 'fixture-id', name: 'New' },
  ] } }, fileTimes: { '/sessions/old': 100, '/sessions/new': 900 }, history: [{ role: 'user', timestamp: 9999999999999, content: 'Do not treat RPC history as acceptance' }] });
  try {
    await f.tick(); await f.tick();
    const rows = f.rows(); assert.deepEqual([...f.win.document.querySelectorAll('.session-row')], [rows[1], rows[0]]);
    assert.deepEqual((f.preferences.value.state[key] as { tabs: { lastUsed: number }[] }).tabs.map(tab => tab.lastUsed), [100, 900]);
    assert.equal(f.calls.filter(call => call.command === 'inspect_workspace_session').length, 2);
    assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
    assert.equal(rows[0].querySelector<HTMLElement>('.session-indicator')!.dataset.state, 'inactive');
    assert.equal(rows[1].querySelector<HTMLElement>('.session-indicator')!.dataset.state, 'ready');
  } finally { f.win.close(); }
});

test('All uses persisted user recency, preserves legacy ties and does not mark restoration as use', async () => {
  const key = 'nimrod.tabs.v1:/project';
  const layout = { tabs: [
    { path: '/sessions/a', sessionId: 'fixture-id', name: 'A', lastUsed: 50 },
    { path: '/sessions/b', sessionId: 'fixture-id', name: 'B', lastUsed: 100 },
    { path: '/sessions/c', sessionId: 'fixture-id', name: 'C', lastUsed: 75 },
    { path: '/sessions/d', sessionId: 'fixture-id', name: 'D', lastUsed: 'bad' },
  ], active: '/sessions/a' };
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: { [key]: layout } });
  let saved!: unknown;
  try {
    await f.tick(); await f.tick();
    const rows = f.rows(), visible = () => [...f.win.document.querySelectorAll('#open-sessions .session-row')];
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]]);
    assert.equal(rows[0].getAttribute('aria-current'), 'true');
    assert.deepEqual((f.preferences.value.state[key] as typeof layout).tabs.map(tab => tab.lastUsed), [50, 100, 75, 0]);
    rows[2].click(); await f.tick(); await f.tick();
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'selection must not reorder All');
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: ']', code: 'BracketRight', metaKey: true, shiftKey: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(rows[3].getAttribute('aria-current'), 'true');
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'cycling must not reorder All');
    f.openPalette(); const query = f.element<HTMLInputElement>('palette-input');
    query.value = 'switch session'; query.dispatchEvent(new f.win.Event('input'));
    query.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    f.win.document.querySelectorAll<HTMLElement>('#palette-list [role=option]')[2].click(); await f.tick(); await f.tick();
    assert.equal(rows[2].getAttribute('aria-current'), 'true');
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'palette switching must not reorder All');
    assert.deepEqual((f.preferences.value.state[key] as typeof layout).tabs.map(tab => tab.lastUsed), [50, 100, 75, 0]);
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = '/name Renamed C'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.match(rows[2].getAttribute('aria-label')!, /Renamed C/);
    assert.equal(prompt.value, '', 'rename acceptance still clears its unchanged composer draft');
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'renaming must not reorder All');
    assert.deepEqual((f.preferences.value.state[key] as typeof layout).tabs.map(tab => tab.lastUsed), [50, 100, 75, 0]);
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'set_session_name').length, 1);
    prompt.value = 'Use C by sending'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.deepEqual(visible(), [rows[2], rows[1], rows[0], rows[3]], 'acknowledged send moves C to the top');
    saved = JSON.parse(JSON.stringify(f.preferences.value.state[key]));
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt').length, 1);
  } finally { f.win.close(); }
  const reopened = await fixture(undefined, { windowWorkspace: '/project', appState: { [key]: saved } });
  try {
    await reopened.tick(); await reopened.tick();
    const rows = reopened.rows();
    assert.deepEqual([...reopened.win.document.querySelectorAll('.session-row')], [rows[2], rows[1], rows[0], rows[3]]);
    assert.deepEqual((reopened.preferences.value.state[key] as typeof layout).tabs.map(tab => tab.lastUsed), (saved as typeof layout).tabs.map(tab => tab.lastUsed));
  } finally { reopened.win.close(); }
});

test('only explicit prompt acknowledgement updates background session recency, never snapshots or uncertain outcomes', async () => {
  for (const outcome of ['accepted', 'rejected', 'unknown']) {
    const f = await fixture(undefined, { windowWorkspace: '/project', holdPrompts: true });
    try {
      for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
      const rows = f.rows(), target = [...f.sessions.values()][1].channel;
      const visible = () => [...f.win.document.querySelectorAll('.session-row')];
      const timestamps = () => (f.preferences.value.state['nimrod.tabs.v1:/project'] as { tabs: { lastUsed: number }[] }).tabs.map(tab => tab.lastUsed);
      rows[1].click(); await f.tick();
      const used = timestamps()[1];
      const prompt = f.element<HTMLTextAreaElement>('prompt');
      prompt.value = 'Pending prompt'; prompt.dispatchEvent(new f.win.Event('input'));
      prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
      rows[0].click(); await f.tick();
      const before = timestamps();
      assert.equal(before[1], used);
      assert.deepEqual(visible(), [rows[1], rows[0]], 'new sessions start at the top, selection does not move them');
      for (const event of [{ type: 'agent_start' }, { type: 'message_end', message: { role: 'user', content: 'Pending prompt', timestamp: 1 } }, { type: 'agent_settled' }]) target.onmessage({ kind: 'rpc', value: event });
      assert.deepEqual(timestamps(), before);
      const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
      if (outcome === 'unknown') target.onmessage({ kind: 'disconnected', message: 'Acceptance unknown' });
      else target.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: outcome === 'accepted', error: outcome === 'rejected' ? 'Rejected' : undefined } });
      await f.tick();
      assert.deepEqual(visible(), [rows[1], rows[0]]);
      assert.equal(rows[0].getAttribute('aria-current'), 'true', 'background acceptance never selects its conversation');
      assert.equal(timestamps()[1] > before[1], outcome === 'accepted');
      assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt').length, 1);
    } finally { f.win.close(); }
  }
});

test('All, Unread and Working counts overlap and working selection survives settlement without changing ownership', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
    const rows = f.rows(), channels = [...f.sessions.values()].map(s => s.channel);
    const emit = (i: number, event: JsonRecord) => channels[i].onmessage({ kind: 'rpc', value: event });
    const count = (view: string) => f.element(`sidebar-${view}-count`).textContent;
    const visible = () => rows.filter(row => !row.parentElement!.hidden);
    const starts = f.calls.filter(c => c.command === 'start_pi').length, stops = f.calls.filter(c => c.command === 'stop_pi').length;
    assert.equal(count('all'), '2'); assert.equal(count('unread'), '0'); assert.equal(count('working'), '0');
    f.element<HTMLButtonElement>('sidebar-working').click();
    assert.deepEqual(visible(), []); assert.equal(f.element('conversation').hidden, true);
    assert.equal(f.element('sidebar-empty-text').textContent, 'No sessions working.');
    emit(0, { type: 'agent_start' });
    assert.equal(count('working'), '1'); assert.deepEqual(visible(), [rows[0]]);
    assert.equal(f.element('conversation').hidden, true, 'new working rows never open themselves');
    rows[0].click();
    emit(1, { type: 'agent_start' }); emit(1, { type: 'agent_settled' });
    assert.equal(count('working'), '1'); assert.equal(count('unread'), '1');
    emit(0, { type: 'agent_end' }); assert.equal(count('working'), '1');
    emit(0, { type: 'agent_settled' });
    assert.equal(count('working'), '0'); assert.deepEqual(visible(), [rows[0]], 'retain the selected response, not a fake busy count');
    assert.equal(f.element('conversation').hidden, false);
    f.element<HTMLButtonElement>('sidebar-all').click(); f.element<HTMLButtonElement>('sidebar-working').click();
    assert.deepEqual(visible(), []); assert.equal(f.element('conversation').hidden, true);
    emit(1, { type: 'compaction_start' }); assert.equal(count('working'), '1'); assert.equal(count('unread'), '1');
    emit(1, { type: 'compaction_end' }); assert.equal(count('working'), '1');
    emit(1, { type: 'agent_settled' }); assert.equal(count('working'), '0');
    // Explicit navigation still reaches a hidden idle session and switches to All.
    rows[0].click(); assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, stops);
    await f.tick();
    assert.equal(f.preferences.value.state['nimrod.sidebar.view:/project'], 'all');
  } finally { f.win.close(); }
});

test('Working tracks reported subagents but excludes input-waiting and unavailable sessions', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    f.element<HTMLButtonElement>('sidebar-working').click();
    const status = (statusText: string) => f.emit({ type: 'extension_ui_request', method: 'setStatus', id: 'agents', statusKey: 'subagents', statusText });
    status('1 running agent'); assert.equal(f.element('sidebar-working-count').textContent, '1');
    assert.equal(f.rows()[0].parentElement!.hidden, false);
    f.emit({ type: 'extension_ui_request', method: 'input', id: 'question', title: 'Need input' }); await f.tick();
    assert.equal(f.element('sidebar-working-count').textContent, '0');
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
    assert.equal(f.rows()[0].parentElement!.hidden, true);
    f.element<HTMLDialogElement>('host-dialog').close('cancel'); await f.tick();
    assert.equal(f.element('sidebar-working-count').textContent, '1');
    status('0 running agents'); assert.equal(f.element('sidebar-working-count').textContent, '0');
    status('Working on something'); assert.equal(f.element('sidebar-working-count').textContent, '0', 'free-form statuses do not imply work');
    status('2 queued agents'); assert.equal(f.element('sidebar-working-count').textContent, '1');
    f.captureChannel().onmessage({ kind: 'disconnected', message: 'Fixture ended' }); await f.tick();
    assert.equal(f.element('sidebar-working-count').textContent, '0');
    assert.equal(f.rows()[0].parentElement!.hidden, true);
  } finally { f.win.close(); }
});

test('sidebar filter keyboard navigation wraps across three counted views', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    for (const [key, view] of [['ArrowRight', 'unread'], ['ArrowRight', 'working'], ['ArrowRight', 'all'], ['ArrowLeft', 'working'], ['Home', 'all'], ['End', 'working']]) {
      f.element('sidebar-views').dispatchEvent(new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      assert.equal(f.win.document.activeElement, f.element(`sidebar-${view}`));
      assert.equal(f.element(`sidebar-${view}`).getAttribute('aria-selected'), 'true');
      assert.equal(f.element('sidebar-session-panel').getAttribute('aria-labelledby'), `sidebar-${view}`);
      for (const item of ['all', 'unread', 'working']) {
        assert.equal(f.element(`sidebar-${item}-count`).textContent, '0');
        assert.equal(f.element<HTMLButtonElement>(`sidebar-${item}`).tabIndex, item === view ? 0 : -1);
      }
    }
  } finally { f.win.close(); }
});

test('restored Working and Unread views stay blank without launching historical sessions', async () => {
  for (const view of ['working', 'unread']) {
    const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
      'nimrod.sidebar.view:/project': view,
      'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/old.jsonl', sessionId: 'fixture-id', name: 'Old' }] },
    } });
    try {
      assert.equal(f.element(`sidebar-${view}`).getAttribute('aria-selected'), 'true');
      assert.equal(f.element('sidebar-all-count').textContent, '1');
      assert.equal(f.element(`sidebar-${view}-count`).textContent, '0');
      assert.equal(f.element('conversation').hidden, true);
      assert.equal(f.element('workspace-empty').hidden, true);
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 0);
    } finally { f.win.close(); }
  }
});

test('empty attention view reports live working counts without restarting dots or altering membership', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
    const rows = f.rows();
    const channels = [...f.sessions.values()].map(s => s.channel);
    const emit = (i: number, event: JsonRecord) => channels[i].onmessage({ kind: 'rpc', value: event });
    f.element<HTMLButtonElement>('sidebar-unread').click();
    const empty = f.element('sidebar-empty'), text = f.element('sidebar-empty-text'), dots = f.element('sidebar-empty-dots');
    assert.equal(empty.textContent, 'No unread sessions.');
    assert.equal(dots.hidden, true);
    emit(0, { type: 'agent_start' });
    assert.equal(empty.textContent, '1 session working…'); assert.equal(empty.hidden, false);
    assert.equal(dots.hidden, false); assert.equal(dots.getAttribute('aria-hidden'), 'true');
    emit(1, { type: 'agent_start' }); assert.equal(empty.textContent, '2 sessions working…');
    const textNode = text.firstChild, dotText = dots.firstChild;
    emit(0, { type: 'extension_ui_request', method: 'notify', id: 'notice', message: 'Still working' });
    assert.equal(f.element('sidebar-empty-dots'), dots);
    assert.equal(text.firstChild, textNode); assert.equal(dots.firstChild, dotText);
    assert.equal(f.element('sidebar-unread-count').textContent, '0');
    emit(0, { type: 'agent_end' }); assert.equal(empty.textContent, '2 sessions working…');
    emit(0, { type: 'agent_settled' }); assert.equal(empty.hidden, true);
    rows[0].click(); assert.equal(empty.hidden, true); // Read row remains while selected.
    // Explicitly selecting a filtered-out working session reveals it in All.
    rows[1].click();
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    f.element<HTMLButtonElement>('sidebar-unread').click();
    assert.equal(empty.hidden, false); assert.equal(empty.textContent, '1 session working…');
    emit(1, { type: 'agent_settled' });
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
    rows[1].click(); // Visit and retain the completed row, then leave via All.
    f.element<HTMLButtonElement>('sidebar-all').click(); rows[0].click();
    f.element<HTMLButtonElement>('sidebar-unread').click();
    assert.equal(empty.textContent, 'No unread sessions.');
    assert.equal(dots.hidden, true);
    emit(1, { type: 'compaction_start' }); assert.equal(empty.textContent, '1 session working…');
    emit(1, { type: 'compaction_end' }); assert.equal(empty.textContent, '1 session working…');
    emit(1, { type: 'agent_settled' }); assert.equal(empty.textContent, 'No unread sessions.');
    f.element<HTMLButtonElement>('sidebar-all').click(); assert.equal(empty.hidden, true);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, 1);
  } finally { f.dom.window.close(); }
});

test('attention blanks filtered conversations, preserves mounted state and treats hidden completion as unread', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const root = f.win.document.querySelector<HTMLElement>('.session-view')!;
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Keep this draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const pane = f.element('transcript-viewport');
    Object.defineProperties(pane, { scrollHeight: { configurable: true, value: 2000 }, clientHeight: { configurable: true, value: 500 } });
    pane.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: -100 }));
    pane.scrollTop = 42; pane.dispatchEvent(new f.win.Event('scroll')); await f.tick();
    const starts = f.calls.filter(c => c.command === 'start_pi').length;
    const stops = f.calls.filter(c => c.command === 'stop_pi').length;
    f.element<HTMLButtonElement>('sidebar-unread').click();
    assert.equal(root.hidden, true); assert.equal(root.inert, true);
    assert.equal(f.element('conversation').hidden, true);
    assert.equal(f.element('workspace-empty').hidden, true);
    assert.equal(f.element('mode-badge').textContent, '');
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, true);
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, true);
    assert.equal(f.win.document.activeElement, f.element('sidebar-unread'));
    // Session commands must not act on the remembered but hidden selection.
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'w', metaKey: true, bubbles: true }));
    f.openPalette();
    const commands = f.element('palette-list').textContent!;
    assert.doesNotMatch(commands, /Restart session|Delete session tree|Close session|Select model|Select thinking level/);
    f.element<HTMLDialogElement>('command-palette').close(); await f.tick();
    f.element<HTMLButtonElement>('sidebar-all').click();
    assert.equal(root.hidden, false); assert.equal(root.inert, false);
    assert.equal(f.element<HTMLTextAreaElement>('prompt'), prompt);
    assert.equal(prompt.value, 'Keep this draft'); assert.equal(pane.scrollTop, 42);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, false);
    f.element<HTMLButtonElement>('sidebar-unread').click();
    f.emit({ type: 'agent_start' }); f.emit({ type: 'agent_settled' }); await f.tick();
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
    assert.equal(root.hidden, true); // A new arrival never opens itself or steals focus.
    assert.equal(f.win.document.activeElement, f.element('sidebar-unread'));
    assert.equal(f.calls.filter(c => c.command === 'notify_session').at(-1)?.args.selected, false);
    f.win.document.querySelector<HTMLButtonElement>('.session-row')!.click();
    assert.equal(root.hidden, false); assert.equal(f.element('sidebar-unread-count').textContent, '0');
    assert.equal(f.element('sidebar-empty').hidden, true); // Read selected row is retained.
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, stops);
  } finally { f.dom.window.close(); }
});

test('restored attention view stays blank and closing its last visible row never selects a hidden session', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
    'nimrod.sidebar.view:/project': 'attention',
    'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/old.jsonl', sessionId: 'fixture-id', name: 'Old' }] },
  } });
  try {
    assert.equal(f.element('conversation').hidden, true);
    assert.equal(f.element('workspace-empty').hidden, true);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 0);
    // Even with only one remembered session, explicit cycling reveals it in All.
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { code: 'BracketRight', metaKey: true, shiftKey: true }));
    await f.tick(); await f.tick();
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(f.element('conversation').hidden, false);
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const roots = [...f.win.document.querySelectorAll<HTMLElement>('.session-view')];
    const first = [...f.sessions.values()][0].channel;
    f.element<HTMLButtonElement>('sidebar-unread').click();
    for (const event of [{ type: 'agent_start' }, { type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', timestamp: 1 } }, { type: 'agent_settled' }]) first.onmessage({ kind: 'rpc', value: event });
    await f.tick();
    const row = f.win.document.querySelector<HTMLButtonElement>('.open-session:not([hidden]) .session-row')!;
    assert.ok(row); row.click();
    f.win.document.querySelector<HTMLButtonElement>('.open-session:not([hidden]) .session-close')!.click();
    await f.tick(); await f.tick();
    assert.equal(f.element('sidebar-unread').getAttribute('aria-selected'), 'true');
    assert.equal(f.element('conversation').hidden, true);
    assert.equal(roots[1].hidden, true);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
  } finally { f.dom.window.close(); }
});

test('returned deletion results remove a whole subtree once and select according to the sidebar view', async () => {
  for (const view of ['all', 'attention', 'attention-empty', 'all-last']) {
    const root = view === 'all-last' ? '/sessions/new-3.jsonl' : '/sessions/new-1.jsonl', child = '/sessions/new-2.jsonl';
    const options: ShellOptions = { windowWorkspace: '/project', deleteTree: async () => [{ file: root, deleted: true }, { file: child, deleted: true }],
      storage: { 'nimrod.sessions.v1:/closed': { drafts: { [`file:${root}`]: { draft: 'Closed draft' }, 'file:/keep': { draft: 'Keep' } }, last: { path: root } } } };
    const f = await fixture(undefined, options);
    try {
      for (let i = 0; i < 4; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
      const rows = f.rows();
      const channels = [...f.sessions.values()].map(s => s.channel);
      if (view.startsWith('attention')) {
        for (const i of view === 'attention' ? [1, 2, 0] : [1, 2]) {
          channels[i].onmessage({ kind: 'rpc', value: { type: 'agent_start' } }); channels[i].onmessage({ kind: 'rpc', value: { type: 'agent_settled' } });
        }
        f.element<HTMLButtonElement>('sidebar-unread').click();
      }
      rows[view === 'all-last' ? 3 : 1].click();
      const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Deleted draft'; prompt.dispatchEvent(new f.win.Event('input'));
      f.element<HTMLButtonElement>('delete-session').click(); await f.tick(); await f.tick(); await f.tick();
      assert.equal(f.win.document.querySelectorAll('.session-row').length, 2);
      const expected = view === 'all-last' ? rows[1] : rows[0];
      assert.equal(expected.getAttribute('aria-current'), 'true', `${view}: ${rows.map(row => `${row.id}:${row.getAttribute('aria-current')}`).join(', ')}`);
      assert.equal(f.element('sidebar-unread').getAttribute('aria-selected'), String(view === 'attention'));
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 4, 'no deleted or intermediate replacement launches');
      assert.equal(f.saved().drafts[`file:${root}`], undefined);
      const closed = JSON.parse(f.win.localStorage.getItem('nimrod.sessions.v1:/closed')!);
      assert.equal(closed.drafts[`file:${root}`], undefined); assert.equal(closed.last, undefined); assert.equal(closed.drafts['file:/keep'].draft, 'Keep');
      assert.deepEqual((f.preferences.value.state['nimrod.tabs.v1:/project'] as { tabs: { path: string }[] }).tabs.map(tab => tab.path), ['/sessions/new.jsonl', view === 'all-last' ? '/sessions/new-1.jsonl' : '/sessions/new-3.jsonl']);
    } finally { f.dom.window.close(); }
  }
});

test('delete review uses a custom nested modal, Cancel is non-destructive and last deletion returns to empty All', async () => {
  for (const confirmed of [false, true]) {
    const file = '/sessions/new.jsonl'; let answer!: (value: boolean) => void;
    let previewReady!: () => void;
    const preview = new Promise<void>(resolve => { previewReady = resolve; });
    const options: ShellOptions = { windowWorkspace: '/project', confirmReview: args => answer(args.confirmed === true), deleteTree: async emit => {
      await preview;
      const accepted = new Promise<boolean>(resolve => { answer = resolve; });
      emit({ id: 'review', phase: 'review', files: [file], results: [], pending: true, tree: [{ file, title: 'Root' }] });
      if (!await accepted) return [];
      return [{ file, deleted: true }];
    } };
    const f = await fixture(undefined, options);
    try {
      f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
      const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Draft'; prompt.dispatchEvent(new f.win.Event('input'));
      // A visible completed row puts the root in attention before deleting it.
      f.element<HTMLButtonElement>('sidebar-unread').click(); f.emit({ type: 'agent_start' }); f.emit({ type: 'agent_settled' });
      f.win.document.querySelector<HTMLButtonElement>('.session-row')!.click();
      f.element<HTMLButtonElement>('delete-session').click();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false, 'fast preview does not flash loading');
      assert.equal(f.element<HTMLButtonElement>('deletion-confirm').disabled, true);
      previewReady(); await f.tick();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true);
      assert.equal(f.element<HTMLButtonElement>('deletion-confirm').disabled, false);
      assert.equal(f.element<HTMLDialogElement>('host-dialog').open, false);
      assert.equal(f.element('deletion-tree').textContent, 'Root');
      assert.equal(f.win.document.activeElement, f.element('deletion-cancel'));
      f.element<HTMLDialogElement>('deletion-review').close(confirmed ? 'delete' : 'cancel'); await f.tick(); await f.tick(); await f.tick();
      assert.equal(f.win.document.querySelectorAll('.session-row').length, confirmed ? 0 : 1);
      if (confirmed) {
        assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
        assert.equal(f.element('workspace-empty').hidden, false); assert.equal(f.element('conversation').hidden, true);
      }
      else assert.equal(prompt.value, 'Draft');
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
      assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    } finally { f.dom.window.close(); }
  }
});

test('deletion review keeps idle row indicators unchanged until confirmed execution and never counts as agent work', async () => {
  for (const outcome of ['cancelled', 'deleted', 'failed']) {
    const file = '/sessions/new.jsonl';
    let answer!: (confirmed: boolean) => void, finishExecution!: () => void;
    const execution = new Promise<void>(resolve => { finishExecution = resolve; });
    const options: ShellOptions = {
      windowWorkspace: '/project',
      appState: { 'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/other.jsonl', sessionId: 'fixture-id', name: 'Other' }] } },
      confirmReview: args => answer(args.confirmed === true),
      deleteTree: async emit => {
        const event = (phase: DeletionEvent['phase'], pending = true): DeletionEvent => ({ id: phase, phase, files: [file], results: [], pending });
        emit(event('lock')); await f.tick();
        const confirmed = new Promise<boolean>(resolve => { answer = resolve; });
        emit({ ...event('review'), tree: [{ file, title: 'Root' }] });
        if (!await confirmed) { emit(event('release', false)); return []; }
        emit(event('check')); await f.tick(); emit(event('quarantine'));
        await execution;
        const results = [{ file, deleted: outcome === 'deleted', error: outcome === 'failed' ? 'Fixture removal failed' : undefined }];
        options.deletionSnapshot = { pending: false, quarantine: [file], files: [], deleted: outcome === 'deleted' ? [file] : [] };
        emit({ ...event('complete', false), results }); return results;
      },
    };
    const f = await fixture(undefined, options);
    try {
      f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
      const rows = f.rows(), target = rows[1], unrelated = rows[0];
      const indicator = target.parentElement!.querySelector<HTMLElement>('.session-indicator')!;
      const unrelatedState = unrelated.parentElement!.querySelector<HTMLElement>('.session-indicator')!.dataset.state;
      const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep my draft'; prompt.dispatchEvent(new f.win.Event('input'));
      assert.equal(indicator.dataset.state, 'ready');
      const starts = f.calls.filter(c => c.command === 'start_pi').length;
      f.element<HTMLButtonElement>('delete-session').click(); await f.tick(); await f.tick();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true);
      assert.equal(indicator.dataset.state, 'ready'); assert.match(target.getAttribute('aria-label')!, /— Ready$/);
      assert.equal(f.element('sidebar-working-count').textContent, '0');
      assert.equal(prompt.closest('.session-view')!.getAttribute('aria-busy'), 'false');
      assert.equal(unrelated.parentElement!.querySelector<HTMLElement>('.session-indicator')!.dataset.state, unrelatedState);
      assert.equal(prompt.closest<HTMLElement>('.session-view')!.inert, true, 'review still locks the affected composer');
      f.element<HTMLDialogElement>('deletion-review').close(outcome === 'cancelled' ? 'cancel' : 'delete'); await f.tick(); await f.tick();
      if (outcome === 'cancelled') {
        assert.equal(indicator.dataset.state, 'ready'); assert.equal(prompt.closest<HTMLElement>('.session-view')!.inert, false);
        assert.equal(prompt.value, 'Keep my draft');
      } else {
        assert.equal(indicator.dataset.state, 'deleting'); assert.match(target.getAttribute('aria-label')!, /— Deleting$/);
        assert.equal(f.element('sidebar-working-count').textContent, '0');
        finishExecution(); await f.tick(); await f.tick(); await f.tick();
        if (outcome === 'failed') { assert.equal(indicator.dataset.state, 'recovery'); assert.equal(prompt.value, 'Keep my draft'); }
        else assert.equal(target.isConnected, false);
      }
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
      assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    } finally { f.dom.window.close(); }
  }
});

test('confirmed snapshot tombstones clean stale restored layouts and closed drafts instead of retaining a ghost row', async () => {
  const file = '/sessions/deleted.jsonl';
  const f = await fixture(undefined, { windowWorkspace: '/project', deletionSnapshot: { pending: false, quarantine: [file], deleted: [file], files: [] }, appState: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: file, sessionId: 'fixture-id', name: 'Deleted' }], active: file },
  }, storage: { 'nimrod.sessions.v1:/project': { drafts: { [`file:${file}`]: { draft: 'Deleted draft' } } } } });
  try {
    assert.equal(f.win.document.querySelectorAll('.session-row').length, 0);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 0);
    assert.equal(f.saved().drafts[`file:${file}`], undefined);
  } finally { f.dom.window.close(); }
});

test('sidebar trash targets a background row without selecting/resuming it and preserves confirmed-only cleanup', async () => {
  const root = '/sessions/root', child = '/sessions/child', selected = '/sessions/selected';
  for (const outcome of ['confirmed', 'cancelled', 'partial', 'failed']) {
    let release!: () => void, answer!: (confirmed: boolean) => void;
    const preview = new Promise<void>(resolve => { release = resolve; });
    const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
      'nimrod.tabs.v1:/project': { tabs: [
        { path: root, sessionId: 'fixture-id', name: 'Root', lastUsed: 10 },
        { path: child, sessionId: 'fixture-id', name: 'Child', lastUsed: 20 },
        { path: selected, sessionId: 'fixture-id', name: 'Selected', lastUsed: 30 },
      ], active: selected },
    }, storage: { 'nimrod.sessions.v1:/project': { drafts: {
      [`file:${root}`]: { draft: 'Root draft' }, [`file:${child}`]: { draft: 'Child draft' }, [`file:${selected}`]: { draft: 'Selected draft' },
    } } }, confirmReview: args => answer(args.confirmed === true), deleteTree: async emit => {
      await preview;
      const confirmed = new Promise<boolean>(resolve => { answer = resolve; });
      emit({ id: 'row-review', phase: 'review', files: [root, child], results: [], pending: true,
        tree: [{ file: root, title: 'Root' }, { file: child, title: 'Child', parent: root }] });
      if (!await confirmed) return [];
      return [
        { file: root, deleted: outcome !== 'failed', error: outcome === 'failed' ? 'Root failed' : undefined },
        { file: child, deleted: outcome === 'confirmed', error: outcome !== 'confirmed' ? 'Child failed' : undefined },
      ];
    } });
    try {
      await f.tick(); await f.tick();
      const rows = f.rows(), prompt = f.element<HTMLTextAreaElement>('prompt');
      const trash = rows[0].parentElement!.querySelector<HTMLButtonElement>('.session-delete')!;
      assert.equal(trash.nextElementSibling, rows[0].parentElement!.querySelector('.session-close'));
      assert.equal(trash.getAttribute('aria-label'), 'Delete session tree for Root');
      assert.equal(trash.disabled, false); assert.equal(rows[2].getAttribute('aria-current'), 'true');
      const starts = f.calls.filter(call => call.command === 'start_pi').length;
      trash.click(); trash.click();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false, 'row action waits briefly before showing loading');
      assert.equal(f.element<HTMLButtonElement>('deletion-confirm').disabled, true);
      for (const button of f.win.document.querySelectorAll<HTMLButtonElement>('.session-delete')) assert.equal(button.disabled, true);
      release(); await f.tick(); await f.tick();
      assert.equal(f.win.document.activeElement, f.element('deletion-cancel'));
      assert.equal(rows[2].getAttribute('aria-current'), 'true'); assert.equal(rows[0].getAttribute('aria-current'), 'false');
      f.element<HTMLDialogElement>('deletion-review').close(outcome === 'cancelled' ? 'cancel' : 'delete');
      await f.tick(); await f.tick(); await f.tick();
      const calls = f.calls.filter(call => call.command === 'delete_session_tree');
      assert.equal(calls.length, 1); assert.equal(calls[0].args.root, root); assert.equal(calls[0].args.sessionId, 'fixture-id');
      assert.equal(f.calls.filter(call => call.command === 'start_pi').length, starts, 'background deletion never resumes its target');
      assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
      assert.equal(rows[2].getAttribute('aria-current'), 'true'); assert.equal(f.element('prompt'), prompt); assert.equal(prompt.value, 'Selected draft');
      const rootDeleted = outcome === 'confirmed' || outcome === 'partial', childDeleted = outcome === 'confirmed';
      assert.equal(rows[0].isConnected, !rootDeleted); assert.equal(rows[1].isConnected, !childDeleted);
      assert.equal(f.saved().drafts[`file:${root}`]?.draft, rootDeleted ? undefined : 'Root draft');
      assert.equal(f.saved().drafts[`file:${child}`]?.draft, childDeleted ? undefined : 'Child draft');
      assert.equal(f.saved().drafts[`file:${selected}`].draft, 'Selected draft');
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false);
    } finally { release(); f.win.close(); }
  }
});

test('sidebar trash shares selected action guards for unsaved, temporary, busy, pending and quarantined sessions', async () => {
  let exists = false;
  const f = await fixture(undefined, { windowWorkspace: '/project', fileExists: () => exists, holdPrompts: true });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    assert.equal(f.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-delete')!.disabled, true, 'unwritten saved sessions cannot be deleted');
    exists = true; f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const trash = f.rows()[1].parentElement!.querySelector<HTMLButtonElement>('.session-delete')!;
    assert.equal(trash.disabled, false);
    f.emit({ type: 'agent_start' }); assert.equal(trash.disabled, true);
    trash.click(); assert.equal(f.calls.some(call => call.command === 'delete_session_tree'), false);
    f.emit({ type: 'agent_settled' }); assert.equal(trash.disabled, false);
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Pending send'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(trash.disabled, true, 'pending acknowledgement blocks deletion');
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, true);
    trash.click(); assert.equal(f.calls.some(call => call.command === 'delete_session_tree'), false);
    const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    f.captureChannel().onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } }); await f.tick();
    assert.equal(trash.disabled, false, 'receipt settlement refreshes eligibility without an activity event');
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, false);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    assert.equal(f.rows()[2].parentElement!.querySelector<HTMLButtonElement>('.session-delete')!.disabled, true);
    assert.equal(f.calls.some(call => call.command === 'delete_session_tree'), false);
  } finally { f.win.close(); }
  const quarantined = await fixture(undefined, { windowWorkspace: '/project', deletionSnapshot: { pending: false, quarantine: ['/sessions/root'], files: [] }, appState: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/root', sessionId: 'fixture-id', name: 'Root' }], active: '/sessions/root' },
  } });
  try {
    const trash = quarantined.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-delete')!;
    assert.equal(trash.disabled, true); trash.click();
    assert.equal(quarantined.calls.some(call => call.command === 'delete_session_tree' || call.command === 'start_pi'), false);
  } finally { quarantined.win.close(); }
});

test('deletion review is scoped to its initiating project while global completion reaches both windows', async () => {
  const owner = await fixture(undefined, { windowLabel: 'one', windowWorkspace: '/one' });
  const other = await fixture(undefined, { windowLabel: 'two', windowWorkspace: '/two' });
  try {
    const review: DeletionEvent = { id: 'review', phase: 'review', pending: true, files: ['/sessions/root'], results: [], tree: [{ file: '/sessions/root', title: 'Root' }] };
    for (const f of [owner, other]) {
      const registration = f.calls.find(c => c.command === 'plugin:event|listen' && c.args.event === 'nimrod-session-deletion')!;
      assert.equal((registration.args.target as JsonRecord).kind, 'WebviewWindow');
      f.deletionEvent(review, 'one');
    }
    await owner.tick(); await other.tick();
    assert.equal(owner.element<HTMLDialogElement>('deletion-review').open, true);
    assert.equal(other.element<HTMLDialogElement>('deletion-review').open, false);
    owner.element<HTMLDialogElement>('deletion-review').close('cancel'); await owner.tick();
    assert.equal(owner.calls.filter(c => c.command === 'confirm_session_deletion').length, 1);
    assert.equal(other.calls.some(c => c.command === 'confirm_session_deletion'), false);
    const complete: DeletionEvent = { id: '', phase: 'release', pending: false, files: [], results: [] };
    for (const f of [owner, other]) { f.deletionEvent(complete); await f.tick(); }
    assert.equal(other.element<HTMLButtonElement>('sidebar-new').disabled, false);
  } finally { owner.dom.window.close(); other.dom.window.close(); }
});

test('delete-tree icon delegates a verified saved session to native filesystem deletion and removes only confirmed successes', async () => {
  const file = '/sessions/new.jsonl';
  const payload = (phase: DeletionEvent['phase']): DeletionEvent => ({ id: phase, phase, files: [file], results: phase === 'complete' ? [{ file, deleted: true }] : [], pending: phase !== 'complete' });
  const options: ShellOptions = { deleteTree: async emit => {
    emit(payload('lock')); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLTextAreaElement>('prompt').readOnly, true);
    const ack = f.calls.find(c => c.command === 'acknowledge_deletion')!;
    assert.equal((ack.args.sessions as JsonRecord[])[0].hasDraft, true);
    emit(payload('quarantine')); emit(payload('complete'));
    options.deletionSnapshot = { pending: false, quarantine: [file], files: [] };
    await f.tick(); await f.tick(); return [{ file, deleted: true }];
  } };
  const f = await fixture(undefined, options);
  try {
    const trash = f.element<HTMLButtonElement>('delete-session'); assert.equal(trash.disabled, true);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick(); assert.equal(trash.disabled, true);
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick(); assert.equal(trash.disabled, false);
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Discard only after success'; prompt.dispatchEvent(new f.win.Event('input'));
    trash.click(); trash.click(); await f.tick(); await f.tick(); await f.tick();
    const calls = f.calls.filter(c => c.command === 'delete_session_tree'); assert.equal(calls.length, 1);
    assert.deepEqual({ ...calls[0].args }, { root: file, sessionId: 'fixture-id' });
    assert.equal(f.win.document.querySelectorAll('.session-row').length, 1); // Unrelated temporary session stays open.
    assert.equal(f.saved().drafts[`file:${file}`], undefined);
    assert.equal(f.preferences.value.state['nimrod.last-session.v1'], null);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('failed file preview and cancelled confirmation keep the conversation and draft without submission', async () => {
  for (const cancelled of [false, true]) {
    const options: ShellOptions = { deleteTree: async emit => {
      if (!cancelled) throw new Error('Session store unavailable');
      emit({ id: 'preview', phase: 'lock', files: ['/sessions/new.jsonl'], results: [], pending: true });
      await f.tick(); await f.tick();
      emit({ id: '', phase: 'release', files: ['/sessions/new.jsonl'], results: [], pending: false });
      return [];
    } };
    const f = await fixture(undefined, options);
    try {
      f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
      const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep after cancellation'; prompt.dispatchEvent(new f.win.Event('input'));
      f.element<HTMLButtonElement>('delete-session').click(); await f.tick(); await f.tick(); await f.tick();
      assert.equal(f.win.document.querySelectorAll('.session-row').length, 1); assert.equal(prompt.value, 'Keep after cancellation');
      assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, false); assert.equal(prompt.readOnly, false);
      assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
      if (!cancelled) assert.match(f.element('launch-error').textContent!, /Session store unavailable/);
      f.disconnect();
    } finally { f.dom.window.close(); }
  }
});

test('restored deletion quarantine blocks implicit launch/restart and explicit Resume validates before recovery', async () => {
  const file = '/sessions/retained.jsonl';
  const f = await fixture(undefined, { windowWorkspace: '/project', deletionSnapshot: { pending: false, quarantine: [file], files: [] }, appState: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: file, sessionId: 'fixture-id', name: 'Retained draft' }], active: file },
  }, storage: { 'nimrod.sessions.v1:/project': { drafts: { [`file:${file}`]: { draft: 'Preserved after unknown deletion' } } } } });
  try {
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, true);
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, true);
    f.win.document.querySelector<HTMLButtonElement>('.session-row')!.click(); await f.tick(); assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    f.openPalette(); const input = f.element<HTMLInputElement>('palette-input'); input.value = 'resume'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    (f.element('palette-list').firstElementChild as HTMLElement).click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'recover_deletion_session').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Preserved after unknown deletion');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('attention view is a stable inbox, retains the selected read row, and leaves All and Switch session intact', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    for (let i = 0; i < 3; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
    const rows = f.rows();
    const channels = [...f.sessions.values()].map(s => s.channel);
    const emit = (i: number, event: JsonRecord) => channels[i].onmessage({ kind: 'rpc', value: event });
    const complete = (i: number) => { emit(i, { type: 'agent_start' }); emit(i, { type: 'agent_settled' }); };
    const visible = () => [...f.win.document.querySelectorAll<HTMLButtonElement>('.open-session:not([hidden]) .session-row')];
    const stops = f.calls.filter(c => c.command === 'stop_pi').length;
    f.element<HTMLButtonElement>('sidebar-unread').click();
    assert.equal(f.element('sidebar-empty').hidden, false);
    assert.equal(f.element('sidebar-unread').getAttribute('aria-selected'), 'true');
    complete(1); complete(0); await f.tick();
    assert.deepEqual(visible(), [rows[1], rows[0]]);
    assert.equal(f.element('sidebar-unread-count').textContent, '2');
    emit(1, { type: 'agent_settled' }); emit(1, { type: 'extension_ui_request', method: 'notify', id: 'notice', message: 'ordinary update' });
    assert.deepEqual(visible(), [rows[1], rows[0]]);
    rows[1].click(); await f.tick();
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
    assert.deepEqual(visible(), [rows[1], rows[0]]);
    assert.equal(rows[1].getAttribute('aria-current'), 'true');
    rows[0].click(); await f.tick();
    assert.deepEqual(visible(), [rows[0]]);
    assert.equal(f.element('sidebar-unread-count').textContent, '0');
    // The palette still includes the hidden third session, with no discovery or launch.
    f.openPalette();
    const query = f.element<HTMLInputElement>('palette-input');
    query.value = 'switch session'; query.dispatchEvent(new f.win.Event('input'));
    query.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    const choices = f.win.document.querySelectorAll<HTMLElement>('#palette-list [role=option]');
    assert.equal(choices.length, 3); choices[2].click(); await f.tick();
    assert.deepEqual(visible(), rows);
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(rows[2].getAttribute('aria-current'), 'true');
    assert.equal(f.element('conversation').hidden, false);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 3);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, stops);
    assert.equal(f.calls.some(c => c.command === 'list_workspace_sessions'), false);
    f.element<HTMLButtonElement>('sidebar-all').click(); assert.deepEqual(visible(), rows); await f.tick();
    assert.equal(f.preferences.value.state['nimrod.sidebar.view:/project'], 'all');
  } finally { f.dom.window.close(); }
});

test('input and failures remain in attention after visiting; resolved input stays selected until leaving', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
    const rows = f.rows();
    const first = [...f.sessions.values()][0].channel;
    const emit = (event: JsonRecord) => first.onmessage({ kind: 'rpc', value: event });
    f.element<HTMLButtonElement>('sidebar-unread').click();
    emit({ type: 'extension_ui_request', method: 'input', id: 'question', title: 'Need input' }); await f.tick();
    assert.equal(rows[0].parentElement!.hidden, false);
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
    // Selection does not answer the outstanding Pi request.
    rows[0].click(); assert.equal(f.element('sidebar-unread-count').textContent, '1');
    f.element<HTMLDialogElement>('host-dialog').close('cancel'); await f.tick();
    assert.equal(f.element('sidebar-unread-count').textContent, '0');
    assert.equal(rows[0].parentElement!.hidden, false);
    rows[1].click();
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    f.element<HTMLButtonElement>('sidebar-unread').click();
    assert.equal(rows[0].parentElement!.hidden, true);
    emit({ type: 'agent_start' });
    emit({ type: 'message_end', message: { role: 'assistant', content: [], stopReason: 'error', timestamp: 1 } });
    emit({ type: 'agent_settled' }); await f.tick();
    assert.equal(rows[0].parentElement!.hidden, false); assert.match(rows[0].getAttribute('aria-label')!, /Failed/);
    rows[0].click(); assert.equal(f.element('sidebar-unread-count').textContent, '1');
    rows[1].click(); f.element<HTMLButtonElement>('sidebar-unread').click();
    assert.equal(rows[0].parentElement!.hidden, false);
    emit({ type: 'agent_start' }); assert.equal(rows[0].parentElement!.hidden, true);
    emit({ type: 'agent_settled' }); await f.tick();
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
    first.onmessage({ kind: 'disconnected', message: 'unexpected exit' }); await f.tick();
    assert.match(rows[0].getAttribute('aria-label')!, /Failed/);
    assert.equal(f.element('sidebar-unread-count').textContent, '1');
  } finally { f.dom.window.close(); }
});

test('sidebar view restores per project without attention inferred from history; keyboard skips hidden rows', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: { 'nimrod.sidebar.view:/project': 'attention' }, storage: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'Old' }] },
  }, history: [{ role: 'assistant', content: 'Old response', timestamp: 1 }] });
  try {
    await f.tick(); await f.tick();
    assert.equal(f.element('sidebar-unread').getAttribute('aria-selected'), 'true');
    assert.equal(f.element('sidebar-unread-count').textContent, '0');
    assert.equal(f.element('sidebar-empty').hidden, false);
    f.element<HTMLButtonElement>('sidebar-all').click();
    f.win.document.querySelector<HTMLButtonElement>('.session-row')!.click(); await f.tick(); await f.tick();
    for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
    const rows = f.rows();
    const channels = [...f.sessions.values()].map(s => s.channel);
    f.element<HTMLButtonElement>('sidebar-unread').click();
    for (const i of [1, 0]) { channels[i].onmessage({ kind: 'rpc', value: { type: 'agent_start' } }); channels[i].onmessage({ kind: 'rpc', value: { type: 'agent_settled' } }); }
    rows[1].focus(); rows[1].dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(f.win.document.activeElement, rows[0]);
    rows[0].dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
    assert.equal(f.win.document.activeElement, rows[0]);
    f.element('sidebar-unread').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(f.win.document.activeElement, f.element('sidebar-all'));
  } finally { f.dom.window.close(); }
});

test('notifications target background sessions, suppress selected foreground runs, and avoid prompt excerpts', async () => {
  let focused = true;
  const f = await fixture(undefined, { windowWorkspace: '/project', focused: () => focused });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const first = f.captureChannel();
    const emitFirst = (event: JsonRecord) => first.onmessage({ kind: 'rpc', value: event });
    emitFirst({ type: 'agent_start' });
    emitFirst({ type: 'agent_settled' }); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'notify_session').length, 0);
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    emitFirst({ type: 'message_end', message: { role: 'user', content: 'private prompt text', timestamp: 1 } });
    emitFirst({ type: 'agent_start' });
    emitFirst({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: '**Done.**\n\nTests passed.' }, { type: 'thinking', thinking: 'private reasoning' }] } });
    emitFirst({ type: 'agent_end' }); await f.tick();
    assert.match(f.rows()[0].getAttribute('aria-label')!, /Working/);
    assert.match(f.rows()[0].querySelector('small')!.textContent!, / · /);
    assert.equal(f.calls.filter(c => c.command === 'notify_session').length, 0);
    emitFirst({ type: 'agent_settled' }); emitFirst({ type: 'agent_settled' }); await f.tick();
    const notices = f.calls.filter(c => c.command === 'notify_session');
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.match(f.rows()[0].getAttribute('aria-label')!, /Unread/);
    assert.match(f.element('notification-status').textContent!, /Last completed alert: submitted to the OS/);
    assert.equal(f.calls.filter(c => c.command === 'prepare_notifications').length, 1);
    assert.equal(notices.length, 1);
    assert.deepEqual(structuredClone(notices[0].args), { kind: 'completed', session: 'Session', target: { session: f.rows()[0].id.replace('session-', ''), token: [...f.sessions.keys()][0] }, selected: false, preview: 'Done. Tests passed.' });
    focused = false;
    f.emit({ type: 'agent_start' }); f.emit({ type: 'agent_settled' }); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'notify_session').length, 2);
    first.onmessage({ kind: 'disconnected', message: 'private error text' }); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'notify_session').at(-1)?.args.kind, 'failed');
    const count = f.calls.filter(c => c.command === 'notify_session').length;
    // An intentional close of the other session is not a failure notification.
    f.win.document.querySelectorAll<HTMLButtonElement>('.session-close')[1].click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'notify_session').length, count);
  } finally { f.dom.window.close(); }
});

test('notification clicks select exact open sessions, reveal filtered rows, dismiss Settings and jump to bottom without launches', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', windowLabel: 'own-project' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const first = f.captureChannel(), firstRow = f.rows()[0];
    const root = f.win.document.getElementById(firstRow.getAttribute('aria-controls')!)!;
    const pane = root.querySelector<HTMLElement>('[data-pi-id="transcript-viewport"]')!;
    Object.defineProperties(pane, { scrollHeight: { get: () => 2400 }, clientHeight: { get: () => 600 } });
    pane.scrollTop = 200; pane.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: -50 }));
    const prompt = root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')!;
    prompt.value = 'Unsent first draft'; prompt.dispatchEvent(new f.win.Event('input'));
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    first.onmessage({ kind: 'rpc', value: { type: 'agent_start' } });
    first.onmessage({ kind: 'rpc', value: { type: 'agent_settled' } }); await f.tick();
    const target = f.calls.find(c => c.command === 'notify_session')!.args.target;
    const before = f.calls.filter(c => c.command === 'start_pi' || c.command === 'stop_pi' || c.command === 'write_pi').length;
    f.element<HTMLButtonElement>('sidebar-working').click();
    assert.equal(f.element('conversation').hidden, true);
    f.openSettings();
    // Other windows and retired launch tokens must not focus or navigate.
    f.notificationClick(target, 'another-project'); f.notificationClick({ ...(target as object), token: 'retired-token' }); await f.tick();
    assert.equal(f.calls.some(c => c.command === 'focus_notification_window'), false);
    f.notificationClick(target, 'own-project'); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, false);
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(firstRow.getAttribute('aria-current'), 'true');
    assert.equal(root.hidden, false); assert.equal(pane.scrollTop, 2400);
    assert.equal(prompt.value, 'Unsent first draft');
    assert.equal(f.calls.filter(c => c.command === 'focus_notification_window').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'start_pi' || c.command === 'stop_pi' || c.command === 'write_pi').length, before);
    assert.doesNotMatch(firstRow.getAttribute('aria-label')!, /Unread/);
    // A disconnected, still-open session can be read without silently resuming.
    first.onmessage({ kind: 'disconnected', message: 'fixture ended' }); await f.tick();
    f.rows()[1].click(); await f.tick();
    const starts = f.calls.filter(c => c.command === 'start_pi').length;
    f.notificationClick(target); await f.tick();
    assert.equal(firstRow.getAttribute('aria-current'), 'true');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
    // Once closed, even its retained OS notification has no navigation target.
    firstRow.parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    const focuses = f.calls.filter(c => c.command === 'focus_notification_window').length;
    f.notificationClick(target); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'focus_notification_window').length, focuses);
  } finally { f.win.close(); }
});

test('notification focus awaits cannot override later navigation or revive a closed target', async () => {
  let release!: () => void;
  const options: ShellOptions = { windowWorkspace: '/project', focused: () => false };
  const f = await fixture(undefined, options);
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    f.emit({ type: 'agent_start' }); f.emit({ type: 'agent_settled' }); await f.tick();
    const target = f.calls.find(c => c.command === 'notify_session')!.args.target;
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    options.notificationFocusGate = new Promise<void>(resolve => { release = resolve; });
    f.notificationClick(target); await f.tick();
    f.rows()[1].click(); release(); await f.tick();
    assert.equal(f.rows()[1].getAttribute('aria-current'), 'true');
    options.notificationFocusGate = new Promise<void>(resolve => { release = resolve; });
    f.notificationClick(target); await f.tick();
    f.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    const starts = f.calls.filter(c => c.command === 'start_pi').length;
    release(); await f.tick();
    assert.equal(f.rows().length, 1);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
  } finally { release?.(); f.win.close(); }
});

test('input-notification navigation leaves Pi input unanswered and focused', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const first = f.captureChannel();
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    first.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'input', id: 'ask', title: 'Question' } }); await f.tick();
    const target = f.calls.find(c => c.command === 'notify_session')!.args.target;
    const dialog = f.element<HTMLDialogElement>('host-dialog');
    const input = f.element<HTMLTextAreaElement>('host-dialog-input'); input.value = 'Unsent answer';
    f.notificationClick(target); await f.tick();
    assert.equal(f.rows()[0].getAttribute('aria-current'), 'true');
    assert.equal(dialog.open, true); assert.equal(input.value, 'Unsent answer');
    assert.equal(f.win.document.activeElement, input);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'extension_ui_response'), false);
    dialog.close('cancel'); await f.tick();
  } finally { f.win.close(); }
});

test('notification clicks dismiss the command palette without running its selected action', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', focused: () => false });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    f.emit({ type: 'agent_start' }); f.emit({ type: 'agent_settled' }); await f.tick();
    const target = f.calls.find(c => c.command === 'notify_session')!.args.target;
    f.openPalette(); f.element<HTMLInputElement>('palette-input').value = 'New session';
    f.element('palette-input').dispatchEvent(new f.win.Event('input'));
    const starts = f.calls.filter(c => c.command === 'start_pi').length;
    f.notificationClick(target); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
  } finally { f.win.close(); }
});

test('Settings notification test uses only the native diagnostic and respects the On/Off policy', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    const stops = f.calls.filter(c => c.command === 'stop_pi').length;
    f.openSettings();
    const button = f.element<HTMLButtonElement>('notification-test');
    button.click(); assert.equal(button.disabled, true); await f.tick();
    assert.equal(button.disabled, false);
    assert.equal(f.calls.filter(c => c.command === 'test_notification').length, 1);
    assert.match(f.element('notification-status').textContent!, /Test notification submitted/);
    assert.match(f.element('notification-status').textContent!, /foreground handler calls: 1/);
    assert.equal(f.calls.filter(c => c.command === 'notification_diagnostics').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 0);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, stops);
    f.preferences.external('{"notifications.enabled":false}');
    assert.equal(button.disabled, true); button.click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'test_notification').length, 1);
    const diagnostics = f.element<HTMLButtonElement>('notification-diagnostics');
    assert.equal(diagnostics.disabled, false); diagnostics.click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'notification_diagnostics').length, 2);
    assert.equal(f.calls.filter(c => c.command === 'test_notification').length, 1);
    assert.match(f.element('notification-status').textContent!, /Notification diagnostics.*style: temporary/);
  } finally { f.dom.window.close(); }
});

test('diagnostic read failure does not misreport an already accepted test as a delivery failure', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', notificationDiagnosticsError: 'fixture diagnostics unavailable' });
  try {
    f.openSettings(); f.element<HTMLButtonElement>('notification-test').click(); await f.tick();
    assert.match(f.element('notification-status').textContent!, /Test notification submitted.*Could not read diagnostics.*fixture diagnostics unavailable/);
    assert.equal(f.element('launch-error').textContent, '');
    assert.equal(f.calls.filter(c => c.command === 'test_notification').length, 1);
    assert.equal(f.element<HTMLButtonElement>('notification-test').disabled, false);
  } finally { f.dom.window.close(); }
});

test('native notification failures are visible both in Settings and the project error area', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', notificationError: 'fixture macOS submission failure' });
  try {
    f.openSettings(); f.element<HTMLButtonElement>('notification-test').click(); await f.tick();
    assert.match(f.element('notification-status').textContent!, /fixture macOS submission failure/);
    assert.match(f.element('launch-error').textContent!, /fixture macOS submission failure/);
    assert.equal(f.element<HTMLButtonElement>('notification-test').disabled, false);
  } finally { f.dom.window.close(); }
});

test('notification settings save, synchronize and suppress alerts without interrupting sessions', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', focused: () => false });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const stopCount = f.calls.filter(c => c.command === 'stop_pi').length;
    f.openSettings();
    const picker = f.element<HTMLSelectElement>('notification-mode');
    picker.value = 'off'; picker.dispatchEvent(new f.win.Event('change')); await f.tick();
    assert.equal(parseSettings(f.preferences.value.text)['notifications.enabled'], false);
    f.emit({ type: 'agent_start' }); f.emit({ type: 'agent_settled' }); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'notify_session').length, 0);
    f.preferences.external('{"notifications.enabled":true}');
    assert.equal(picker.value, 'on');
    f.emit({ type: 'extension_ui_request', method: 'confirm', id: 'ask', title: 'private request', message: 'private body' }); await f.tick();
    assert.deepEqual(structuredClone(f.calls.filter(c => c.command === 'notify_session').at(-1)?.args), { kind: 'input', session: 'Session', target: { session: f.rows()[0].id.replace('session-', ''), token: [...f.sessions.keys()][0] }, selected: false });
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, stopCount);
    f.element<HTMLDialogElement>('host-dialog').close('cancel'); await f.tick();
  } finally { f.dom.window.close(); }
});

async function chooseNamedSession(f: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  f.openPalette();
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
    assert.deepEqual(calls.map(c => c.command), ['plugin:event|listen', 'preferences_snapshot', 'preferences_migrate', 'plugin:event|listen', 'plugin:event|listen', 'plugin:webview|set_webview_zoom', 'plugin:event|listen', 'stop_pi', 'runtime_defaults', 'window_workspace', 'deletion_snapshot']);
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
    assert.equal(Object.keys(f.saved().drafts).some(key => key.startsWith('temporary:')), false, 'temporary editor text stays in memory');
    assert.equal(f.saved().drafts.legacy.draft, 'legacy');
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('temporary/demo Close discards runtime state only after confirmation and successful owned shutdown', async () => {
  for (const start of ['start-temporary', 'start-demo']) {
    let failStop = false;
    const f = await fixture(undefined, { stopError: () => failStop ? 'fixture stop failure' : undefined });
    try {
      f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
      const savedRow = f.win.document.querySelector<HTMLButtonElement>('.session-row')!;
      const savedPrompt = f.element<HTMLTextAreaElement>('prompt');
      savedPrompt.value = 'saved sibling'; savedPrompt.dispatchEvent(new f.win.Event('input'));
      f.element<HTMLButtonElement>(start).click(); await f.tick(); await f.tick();
      const runtimeId = f.win.document.querySelector<HTMLElement>('.session-view:not([hidden])')!.id.replace('panel-', '');
      const prompt = f.element<HTMLTextAreaElement>('prompt');
      prompt.value = 'temporary secret'; prompt.dispatchEvent(new f.win.Event('input'));
      const close = () => f.rows()[1].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click();
      close(); await f.tick();
      assert.match(f.element('host-dialog').textContent!, /discards this temporary session/);
      assert.doesNotMatch(f.element('host-dialog').textContent!, /draft stays/);
      f.element<HTMLDialogElement>('host-dialog').close('cancel'); await f.tick();
      assert.equal(prompt.value, 'temporary secret');
      assert.equal(f.win.document.querySelectorAll('.session-row').length, 2);
      failStop = true;
      close(); await f.confirm();
      assert.equal(f.win.document.querySelectorAll('.session-row').length, 2);
      assert.equal(prompt.value, 'temporary secret', 'failed shutdown retains the live draft');
      failStop = false;
      close(); await f.confirm();
      assert.equal(f.win.document.querySelectorAll('.session-row').length, 1);
      assert.equal(f.win.document.getElementById(`panel-${runtimeId}`), null);
      assert.deepEqual(Object.keys(f.saved().drafts), ['file:/sessions/new.jsonl']);
      assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].draft, 'saved sibling');
      assert.equal(f.element('recover-draft').hidden, true);
      const lastSync = f.calls.filter(call => call.command === 'sync_popout_sessions').at(-1)!;
      assert.equal((lastSync.args.sessions as { runtimeId: string }[]).some(session => session.runtimeId === runtimeId), false, 'runtime pop-out ownership is retired');
      savedRow.click();
      assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'saved sibling');
      for (let i = 0; i < f.win.localStorage.length; i++) {
        assert.doesNotMatch(f.win.localStorage.getItem(f.win.localStorage.key(i)!)!, /temporary secret/);
      }
    } finally { f.dom.window.close(); }
  }
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
    f.win.document.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.confirm();
    f.element<HTMLButtonElement>('recover-draft').click(); await f.confirm();
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'legacy text');
    assert.equal(f.element<HTMLButtonElement>('send').disabled, true);
    assert.equal(Object.keys(f.saved().drafts).some(key => key.startsWith('demo:')), false, 'closed demo drafts are discarded, not recoverable');
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
    f.win.document.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.confirm();
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    release(); await f.tick(); await f.tick();
    assert.equal(Object.keys(f.saved().drafts).some(key => key.startsWith('temporary:')), false, 'closed temporary submissions are discarded');
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

test('Project bar restart stays disabled for no session, temporary/demo sessions and an unverified first save', async () => {
  let saved = false;
  const f = await fixture(undefined, { fileExists: () => saved });
  try {
    const restart = f.element<HTMLButtonElement>('restart-session');
    assert.equal(restart.disabled, true);
    assert.equal(restart.getAttribute('aria-label'), 'Restart session');
    assert.equal(restart.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
    assert.equal(restart.textContent, '');
    for (const id of ['start-temporary', 'start-demo']) {
      f.element<HTMLButtonElement>(id).click(); await f.tick(); await f.tick();
      assert.equal(restart.disabled, true); assert.match(restart.title, /temporary/);
      const count = f.calls.filter(c => c.command === 'start_pi').length;
      restart.click(); await f.tick(); assert.equal(f.calls.filter(c => c.command === 'start_pi').length, count);
    }
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    assert.equal(restart.disabled, true); assert.match(restart.title, /first save/);
    assert.match(f.element('mode-badge').textContent!, /awaiting first save/);
    saved = true;
    const now = f.win.Date.now(); f.win.Date.now = () => now + 4000;
    f.emit({ type: 'agent_settled' }); await f.tick(); await f.tick();
    assert.equal(restart.disabled, false); assert.equal(restart.title, 'Restart session');
    for (const s of f.sessions.values()) s.channel.onmessage({ kind: 'disconnected', message: 'done' });
  } finally { f.dom.window.close(); }
});

test('restart reaps only the selected child and resumes the exact file in the same mounted conversation with its draft', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const first = [...f.sessions.keys()][0];
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const oldToken = [...f.sessions.keys()][1];
    const root = f.win.document.querySelector('.session-view:not([hidden])');
    const row = f.win.document.querySelectorAll('.session-row')[1];
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep my unsent draft'; prompt.dispatchEvent(new f.win.Event('input'));
    f.element<HTMLButtonElement>('restart-session').click(); await f.tick(); await f.tick();
    const launches = f.calls.filter(c => c.command === 'start_pi');
    assert.equal(launches.length, 3);
    assert.deepEqual({ ...(launches[2].args.config as JsonRecord) }, { cwd: '/project', pi: '/bin/pi', node: '/bin/node', demo: false, mode: 'resume', sessionName: undefined, sessionFile: '/sessions/new-1.jsonl', sessionId: 'fixture-id' });
    assert.notEqual(launches[2].args.token, oldToken);
    assert.deepEqual(f.calls.filter(c => c.command === 'stop_pi' && c.args.token).map(c => c.args.token), [oldToken]);
    assert.ok(f.calls.findIndex(c => c.command === 'stop_pi' && c.args.token === oldToken) < f.calls.indexOf(launches[2]));
    assert.equal(f.win.document.querySelector('.session-view:not([hidden])'), root);
    assert.equal(f.win.document.querySelectorAll('.session-row')[1], row);
    assert.equal(f.element('prompt'), prompt); assert.equal(prompt.value, 'Keep my unsent draft');
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(f.win.document.querySelectorAll('.session-row').length, 2);
    assert.equal(f.calls.some(c => c.command === 'stop_pi' && c.args.token === first), false);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, false);
    for (const s of f.sessions.values()) s.channel.onmessage({ kind: 'disconnected', message: 'done' });
  } finally { f.dom.window.close(); }
});

test('restart confirmation can cancel, serializes shutdown, preserves uncertain submission and ignores late old receipts', async () => {
  let release!: () => void;
  const f = await fixture(undefined, { holdPrompts: true, stopGate: new Promise<void>(resolve => { release = resolve; }) });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Ambiguous acceptance'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    const oldChannel = f.captureChannel();
    const oldRequest = f.calls.find(c => (c.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    prompt.value = 'Newer draft'; prompt.dispatchEvent(new f.win.Event('input'));
    const restart = f.element<HTMLButtonElement>('restart-session'); restart.click(); await f.tick();
    assert.match(f.element('host-dialog-title').textContent!, /Restart/);
    assert.match(f.element('host-dialog-description').textContent!, /Nothing is sent again automatically/);
    f.element<HTMLDialogElement>('host-dialog').close('cancel'); await f.tick();
    assert.equal(restart.disabled, false);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi' && c.args.token).length, 0);
    restart.click(); await f.confirm();
    assert.equal(restart.disabled, true);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('.session-close')!.disabled, true);
    restart.click();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi' && c.args.token).length, 1);
    release(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    assert.equal(f.element('prompt'), prompt); assert.equal(prompt.value, 'Newer draft');
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission.status, 'unknown');
    oldChannel.onmessage({ kind: 'rpc', value: { type: 'response', id: oldRequest.id, success: true } });
    oldChannel.onmessage({ kind: 'rpc', value: { type: 'message_start', message: { role: 'assistant', content: 'Stale output' } } });
    await f.tick();
    assert.equal(prompt.value, 'Newer draft');
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission.status, 'unknown');
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'prompt').length, 1);
    assert.doesNotMatch(f.element('messages').textContent!, /Stale output/);
    f.disconnect();
  } finally { release(); f.dom.window.close(); }
});

test('switching away and back during restart cannot launch early or steal a sibling composer focus', async () => {
  let release!: () => void;
  const f = await fixture(undefined, { stopGate: new Promise<void>(resolve => { release = resolve; }) });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const firstPrompt = f.element<HTMLTextAreaElement>('prompt'); firstPrompt.value = 'Sibling draft'; firstPrompt.dispatchEvent(new f.win.Event('input'));
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const rows = f.rows();
    f.element<HTMLButtonElement>('restart-session').click(); await f.tick();
    rows[0].click(); rows[1].click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, true);
    rows[0].click(); firstPrompt.focus();
    release(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 3);
    assert.equal(f.element('prompt'), firstPrompt); assert.equal(firstPrompt.value, 'Sibling draft');
    assert.equal(f.win.document.activeElement, firstPrompt);
    assert.equal(rows[1].getAttribute('aria-current'), 'false');
    for (const s of f.sessions.values()) s.channel.onmessage({ kind: 'disconnected', message: 'done' });
  } finally { release(); f.dom.window.close(); }
});

test('a disconnected saved session can restart from the Project bar or command palette', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    f.disconnect(); await f.tick();
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, false);
    f.openPalette(); const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'restart session'; input.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').children.length, 1);
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    assert.equal((f.calls.filter(c => c.command === 'start_pi')[1].args.config as JsonRecord).mode, 'resume');
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('failed restart shutdown never launches a replacement and a second attempt retries native stop', async () => {
  let stopError: string | undefined = 'fixture shutdown failure';
  const f = await fixture(undefined, { stopError: () => stopError });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const restart = f.element<HTMLButtonElement>('restart-session'); restart.click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.win.document.querySelectorAll('.session-row').length, 1);
    assert.match(f.win.document.querySelector('.tab-notice')!.textContent!, /Could not restart Pi.*fixture shutdown failure/);
    assert.equal(restart.disabled, false);
    stopError = undefined; restart.click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'stop_pi' && c.args.token).length, 2);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('restart resume failure keeps the saved session and draft without falling back to a new session', async () => {
  const options: ShellOptions = {};
  const f = await fixture(undefined, options);
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Retained after failed resume'; prompt.dispatchEvent(new f.win.Event('input'));
    options.startError = 'Session file unavailable';
    f.element<HTMLButtonElement>('restart-session').click(); await f.tick(); await f.tick();
    const starts = f.calls.filter(c => c.command === 'start_pi');
    assert.equal(starts.length, 2); assert.equal((starts[1].args.config as JsonRecord).mode, 'resume');
    assert.equal(f.win.document.querySelectorAll('.session-row').length, 1);
    assert.equal(prompt.value, 'Retained after failed resume');
    assert.match(f.element('launch-error').textContent!, /Session file unavailable/);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.dom.window.close(); }
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
    f.openPalette();
    const search = f.element<HTMLInputElement>('palette-input');
    search.value = 'open project'; search.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').children.length, 0);
    search.value = 'resume'; search.dispatchEvent(new f.win.Event('input'));
    search.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.element('palette-list').children.length, 2);
    assert.equal(search.placeholder, 'Type to filter project sessions…');
    assert.equal(search.getAttribute('aria-label'), 'Search project sessions');
    assert.equal(f.win.document.querySelector('#open-workspace, #open-palette, #disconnect'), null);
    assert.equal(f.element('recent-workspaces').getAttribute('aria-label'), 'Recent projects');
    assert.doesNotMatch(f.element('welcome').textContent!, /workspace/i);
    assert.doesNotMatch(f.element('workspace-empty').textContent!, /workspace/i);
    assert.deepEqual(f.preferences.value.state['nimrod.workspaces.v1'], ['/project']);
    search.value = 'review'; search.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').children.length, 1);
    (f.element('palette-list').firstElementChild as HTMLElement).click(); await f.tick(); await f.tick();
    assert.equal(f.win.document.querySelectorAll('#open-sessions .session-row').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    f.openPalette();
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

test('Resume marks sidebar membership independently of connectivity and filters child sessions without changing Switch', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project',
    appState: { 'nimrod.tabs.v1:/project': { tabs: [
      { path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'Selected root', lastUsed: 30 },
      { path: '/sessions/b.jsonl', sessionId: 'fixture-id', name: 'Inactive root', lastUsed: 20 },
      { path: '/custom/child.jsonl', sessionId: 'fixture-id', name: 'Open child', lastUsed: 10 },
    ], active: '/sessions/a.jsonl' } },
    fileParents: { '/custom/child.jsonl': '/sessions/a.jsonl' },
    catalog: [
      { path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'Selected root', preview: 'long '.repeat(100), modified: 30 },
      { path: '/sessions/b.jsonl', sessionId: 'fixture-id', name: 'Inactive root', preview: '', modified: 20 },
      { path: '/sessions/closed.jsonl', sessionId: 'fixture-id', name: 'Closed root', preview: '', modified: 10 },
      { path: '/sessions/agent.jsonl', sessionId: 'agent', name: 'Subagent', preview: '', modified: 50, parentSession: '/sessions/a.jsonl' },
      { path: '/sessions/fork.jsonl', sessionId: 'fork', name: 'Saved branch', preview: '', modified: 40, parentSession: '/sessions/a.jsonl' },
    ],
  });
  const key = (key: string) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }));
  const escape = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const pickerRows = () => [...f.element('palette-list').children] as HTMLElement[];
  const badge = (row: HTMLElement) => row.querySelector('.palette-item-badge')?.textContent;
  try {
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1, 'only the selected restored entry connects');
    f.element<HTMLButtonElement>('sidebar-unread').click();
    key('k'); await f.tick(); await f.tick();
    assert.deepEqual(pickerRows().map(row => row.querySelector('.palette-item-label')!.textContent), ['Selected root', 'Inactive root', 'Closed root']);
    assert.deepEqual(pickerRows().map(badge), ['Open', 'Open', undefined]);
    assert.ok(pickerRows()[0].querySelector('.palette-item-heading .palette-item-badge'), 'badge is separate from the truncatable preview');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1, 'listing does not connect inactive sessions');
    escape(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    key('t'); await f.tick();
    assert.equal(pickerRows().length, 3, 'Switch includes the open child and disconnected root');
    for (const [index, option] of pickerRows().entries()) {
      const sidebar = f.rows()[index];
      assert.equal(option.querySelector('.session-row-text')!.textContent, sidebar.querySelector('.session-row-text')!.textContent);
      assert.equal(option.querySelector('.session-row-text > span')!.textContent, sidebar.querySelector('.session-row-text > span')!.textContent);
      assert.equal(option.querySelector('small > time')!.getAttribute('datetime'), sidebar.querySelector('small > time')!.getAttribute('datetime'));
      assert.equal(option.querySelector('.session-indicator')!.outerHTML, sidebar.querySelector('.session-indicator')!.outerHTML);
      assert.equal(option.getAttribute('aria-label'), sidebar.getAttribute('aria-label'));
      assert.equal(option.getAttribute('aria-describedby'), option.querySelector('time')!.id);
      assert.equal(option.title, '', 'shared session rows have no status tooltip');
      assert.doesNotMatch(option.querySelector('small')!.textContent!, /Current|Ready|Inactive/);
    }
    escape(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    key('k'); await f.tick(); await f.tick();
    pickerRows()[0].click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1, 'already-connected selection reuses its process');
    assert.equal(f.rows().length, 3, 'selection reuses the sidebar entry');
    f.disconnect(); await f.tick();
    key('k'); await f.tick(); await f.tick();
    assert.equal(badge(pickerRows()[0]), 'Open', 'disconnect does not close the session');
    escape(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    f.rows()[1].closest('.open-session')!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    key('k'); await f.tick(); await f.tick();
    assert.deepEqual(pickerRows().map(badge), ['Open', undefined, undefined], 'Close removes only the membership badge, not saved history');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.win.close(); }
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
    const tabButtons = f.rows();
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
    f.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
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
    f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'new offline demo'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    const secondPrompt = f.element('prompt');
    first[1].channel.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'input', id: 'question', title: 'Need input' } });
    await f.tick();
    assert.match(f.element('host-dialog-title').textContent!, /Offline demo — Need input/);
    assert.match(f.rows()[0].getAttribute('aria-label')!, /Input needed/);
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
    key('Escape'); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
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
    f.rows()[0].click(); await f.tick();
    sync = f.calls.filter(c => c.command === 'sync_popout_sessions').at(-1)!.args;
    assert.equal(sync.active, first.runtimeId);
    f.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
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
