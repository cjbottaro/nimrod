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
import { CATALOG_THEMES } from '../src/themes/builtins';
import type { DeletionEvent, DeletionSnapshot } from '../src/session-deletion';
import { ACTIONS } from '../src/keybindings';
import { INTENTIONALLY_UNBOUND_ACTIONS } from './keybindings-fixture';
import { copilotHistoryKey } from '../src/copilot/session-history';
import { copilotSdkScope } from '../src/copilot/session-lifecycle';

// Real shell/renderer/controller bundle, mocked native boundary—not native WebKit acceptance.
interface ShellOptions {
  platform?: string;
  menuError?: string;
  menuGate?: Promise<void>;
  sdkCommands?: JsonRecord[];
  sdkCommand?: (request: JsonRecord) => Promise<unknown>;
  acpCleanupError?: string;
  copilotStartError?: string;
  copilotLoadGate?: Promise<void>;
  copilotListError?: string;
  copilotListGate?: Promise<void>;
  copilotDeleteError?: string;
  copilotDeleteGate?: Promise<void>;
  copilotHistory?: JsonRecord[];
  catalogError?: string;
  globalSettings?: boolean;
  appearanceCapabilities?: import('../src/window-appearance').AppearanceCapabilities;
  appearanceGate?: Promise<void>;
  appearanceError?: string;
  appearanceObserverError?: string;
  appearanceApply?: (args: JsonRecord, fail: (payload: { request: string; message: string }) => void) => Promise<void>;
  titlebarGate?: Promise<void>;
  runtimeDefaultsGate?: Promise<void>;
  storage?: Record<string, unknown>;
  nativeDrafts?: Record<string, unknown>;
  draftFlushError?: string;
  draftFlushGate?: Promise<void>;
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
  mcpReport?: string;
  focused?: () => boolean;
  performanceControl?: { after: (() => void)[]; writeError?: string; copyError?: string };
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
  homeDirectory?: string;
  projectPickerPending?: boolean;
  projects?: { cwd: string; open: boolean }[];
  projectOpenError?: string;
  windowWorkspaceGate?: Promise<void>;
  windowWorkspaceError?: string;
  modelFixture?: boolean;
  modelChangeError?: string;
  popout?: { session: string; title: string; text: string; language: string };
  popoutSyncGate?: Promise<void>;
  personalGate?: Promise<import('../src/pi/card-plugins/catalog').PersonalBundles>;
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
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { url: options.popout ? 'http://tauri.localhost/?popout' : options.globalSettings ? 'http://tauri.localhost/?settings=appearance' : 'http://tauri.localhost', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  if (options.platform) Object.defineProperty(win.navigator, 'platform', { value: options.platform });
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
  const nativeDrafts = new Map(Object.entries(options.nativeDrafts ?? {}).map(([key, value]) => [key, { key, value, revision: 1 }]));
  let channel: { onmessage: (packet: Packet) => void };
  let activeToken: string;
  let activeConfig: JsonRecord = {};
  const sessions = new Map<string, { channel: typeof channel; config: JsonRecord; file: string; name?: string }>();
  const acpSessions = new Map<string, { channel: typeof channel; promptId?: unknown; sessionId?: string }>();
  const sdkSessions = new Map<string, { channel: typeof channel; sessionId?: string }>();
  let workspace = options.windowWorkspace;
  let selectedModel: JsonRecord | null = null;
  let thinkingLevel = 'medium';
  for (const [key, value] of Object.entries(options.storage || {})) win.localStorage.setItem(key, JSON.stringify(value));
  const tick = async () => {
    await new Promise(resolve => setTimeout(resolve, 0));
    if (options.performanceControl) { for (const frame of frames.splice(0)) frame(0); }
    else while (frames.length) frames.shift()!(0);
  };
  if (options.performanceControl) {
    const timeout = win.setTimeout.bind(win);
    win.setTimeout = (handler, delay, ...args) => {
      if (delay === 5000 && typeof handler === 'function') { options.performanceControl!.after.push(handler as () => void); return 0; }
      return timeout(handler, delay, ...args);
    };
  }
  const preferences = new MemoryPreferences();
  Object.assign(preferences.value.state, options.appState);
  const callbacks = new Map<number, (event: unknown) => void>();
  let menu: { request: string; options: JsonRecord } | undefined;
  let sessionMenuEvent: ((request: string, action: string) => void) | undefined;
  const preferenceCallbacks = new Set<number>();
  let deletionEvent: ((event: DeletionEvent, target?: string) => void) | undefined;
  let notificationClick: ((event: unknown, target?: string) => void) | undefined;
  let projectPicker: ((target?: string) => void) | undefined;
  let linkError: ((message: string, target?: string) => void) | undefined;
  let nativeBlurFailure: ((payload: { request: string; message: string }, target?: string) => void) | undefined;
  let projectPickerPending = options.projectPickerPending || false;
  Object.assign(win, { TextEncoder, __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
    metadata: { currentWindow: { label: options.windowLabel || 'main' }, currentWebview: { label: options.windowLabel || 'main' } },
    transformCallback: (callback: (event: unknown) => void) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; }, unregisterCallback: () => {},
    invoke: async (command: string, args: JsonRecord = {}) => {
      calls.push({ command, args });
      if (command === 'application_action') return;
      if (command === 'popup_session_menu') {
        await options.menuGate;
        if (options.menuError) throw new Error(options.menuError);
        menu = { request: String(args.request), options: args.options as JsonRecord }; return;
      }
      if (command === 'window_appearance_capabilities' || command === 'apply_window_appearance') {
        if (command === 'window_appearance_capabilities') { await options.appearanceGate; if (options.appearanceError) throw new Error(options.appearanceError); }
        else await options.appearanceApply?.(args, payload => nativeBlurFailure?.(payload, options.windowLabel || 'main'));
        return options.appearanceCapabilities ?? { platform: 'macos', transparency: true, frost: true, reducedTransparency: false };
      }
      if (command === 'tint_window_titlebar') { await options.titlebarGate; return; }
      if (command === 'settings_window_ready') return;
      if (command === 'window_appearance_preview_snapshot') return { revision: 0, opacity: null, blur: null };
      if (command === 'preview_window_appearance') return { revision: calls.length, opacity: args.opacity, blur: args.blur };
      if (command === 'drafts_load') return [...nativeDrafts.values()];
      if (command === 'drafts_stage') { const record = args.record as { key: string; value: unknown; revision: number }; nativeDrafts.set(record.key, record); return; }
      if (command === 'drafts_flush') { await options.draftFlushGate; if (options.draftFlushError) throw new Error(options.draftFlushError); return; }
      if (command === 'drafts_references') return [];
      if (command === 'plugin:event|listen') {
        if (args.event === 'nimrod-window-appearance-error') {
          if (options.appearanceObserverError) throw new Error(options.appearanceObserverError);
          nativeBlurFailure = (payload, target) => {
            const listenerTarget = args.target as { kind: string; label?: string };
            if (!target || listenerTarget.kind === 'Any' || listenerTarget.label === target) callbacks.get(Number(args.handler))?.({ payload });
          };
        }
        if (args.event === 'nimrod-session-menu') sessionMenuEvent = (request, action) => callbacks.get(Number(args.handler))?.({ payload: { request, action } });
        if (args.event === 'nimrod-open-project') projectPicker = target => {
          const listenerTarget = args.target as { kind: string; label?: string };
          if (!target || listenerTarget.kind === 'Any' || listenerTarget.label === target) {
            projectPickerPending = true; callbacks.get(Number(args.handler))?.({ payload: null });
          }
        };
        if (args.event === 'nimrod-link-error') linkError = (payload, target) => {
          const listenerTarget = args.target as { kind: string; label?: string };
          if (!target || listenerTarget.kind === 'Any' || listenerTarget.label === target) callbacks.get(Number(args.handler))?.({ payload });
        };
        if (args.event === 'nimrod-preferences') {
          preferenceCallbacks.add(Number(args.handler));
          preferences.receive = payload => { for (const handler of preferenceCallbacks) callbacks.get(handler)?.({ payload }); };
        }
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
      if (command === 'scoped_preferences_snapshot') {
        preferences.value.projectPath = workspace ? workspace + '/.nimrod/settings.json' : undefined;
        preferences.value.projectText ??= '{}\n';
        return preferences.snapshot();
      }
      if (command.startsWith('preferences_') || command === 'project_preferences_settings' || command === 'record_command_usage') return preferences.invoke(command, args);
      if (command === 'open_global_settings' || command === 'open_owned_project_settings') return;
      if (command === 'take_project_settings_request' || command === 'take_settings_category') return false;
      if (command === 'list_project_overrides') return [];
      if (command === 'plugin:window|is_focused') return options.focused?.() ?? true;
      if (command === 'plugin:clipboard-manager|write_text' && options.performanceControl?.copyError) throw new Error(options.performanceControl.copyError);
      if (command === 'transcript_logs_directory') return '/fixture/.local/state/nimrod/transcript-logs';
      if (command === 'append_transcript_logs') return;
      if (command === 'write_performance_report') {
        if (options.performanceControl?.writeError) throw new Error(options.performanceControl.writeError);
        return '/fixture/.local/state/nimrod/performance-captures/2026-10-14_12-00-00.000Z.json';
      }
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
      if (command === 'load_personal_card_plugins') return options.personalGate ?? { entries: [], plugins: [], warnings: [] };
      if (command === 'runtime_defaults') { await options.runtimeDefaultsGate; return { cwd: '/project', pi: '/bin/pi', node: '/bin/node', home: options.homeDirectory }; }
      if (command === 'window_workspace') {
        await options.windowWorkspaceGate;
        if (options.windowWorkspaceError) throw new Error(options.windowWorkspaceError);
        return workspace || null;
      }
      if (command === 'take_project_picker_request') { const pending = projectPickerPending; projectPickerPending = false; return pending; }
      if (command === 'list_projects') return options.projects || [];
      if (command === 'open_project_directory') { if (options.projectOpenError) throw new Error(options.projectOpenError); return { cwd: args.cwd, current: false }; }
      if (command === 'open_workspace') { workspace = String(args.cwd); return { cwd: workspace, current: true }; }
      if (command === 'list_workspace_sessions') {
        if (options.catalogError) throw new Error(options.catalogError);
        return { sessions: options.catalog || [], warnings: [] };
      }
      if (command === 'plugin:dialog|open') return options.filePath === null ? null : options.filePath || '/sessions/exact.jsonl';
      if (command === 'stop_pi' && activeToken!) {
        const error = options.stopError?.(); if (error) throw new Error(error);
        await options.stopGate;
      }
      if (command === 'start_acp') {
        acpSessions.set(String(args.token), { channel: args.onEvent as typeof channel });
        return (args.config as JsonRecord).cwd;
      }
      if (command === 'start_copilot') {
        if (options.copilotStartError) throw new Error(options.copilotStartError);
        sdkSessions.set(String(args.token), { channel: args.onEvent as typeof channel });
        return (args.config as JsonRecord).cwd;
      }
      if (command === 'stop_copilot') { sdkSessions.delete(String(args.token)); return 'sdk-generation'; }
      if (command === 'write_copilot') {
        const target = sdkSessions.get(String(args.token)); assert.ok(target);
        const request = args.message as JsonRecord;
        const send = (value: JsonRecord) => target.channel.onmessage({ kind: 'rpc', value });
        const event = (type: string, data: JsonRecord) => send({ kind: 'event', event: { id: win.crypto.randomUUID(), type, data } });
        let result: unknown = null;
        if (request.method === 'list') {
          await options.copilotListGate;
          if (options.copilotListError) { send({ kind: 'result', id: request.id, error: options.copilotListError }); return; }
        } else if (request.method === 'delete') {
          await options.copilotDeleteGate;
          if (options.copilotDeleteError) { send({ kind: 'result', id: request.id, error: options.copilotDeleteError }); return; }
          options.copilotHistory = options.copilotHistory?.filter(session => session.sessionId !== request.sessionId);
        } else if (request.method === 'connect') {
          await options.copilotLoadGate;
          target.sessionId = String(request.sessionId ?? 'sdk-fixture');
          send({ kind: 'connected', sessionId: target.sessionId, model: { modelId: 'fixture' }, models: [],
            events: request.sessionId ? [
              { id: 'saved-user', type: 'user.message', data: { content: 'Saved Copilot question' } },
              { id: 'saved-assistant', type: 'assistant.message', data: { messageId: 'saved-assistant', content: 'Saved Copilot answer' } },
            ] : [] });
          send({ kind: 'commands', commands: options.sdkCommands ?? [] });
        } else if (request.method === 'command') {
          result = await options.sdkCommand?.(request);
        } else if (request.method === 'prompt') {
          event('user.message', { content: request.text });
          event('assistant.message', { messageId: 'sdk-answer', content: 'SDK fixture response' });
        } else if (request.method === 'cancel') event('session.idle', {});
        send({ kind: 'result', id: request.id, result: request.method === 'list' ? (options.copilotHistory || []).filter(session => (session.context as JsonRecord)?.workingDirectory === workspace && session.isRemote === false) : result ?? null });
        return;
      }
      if (command === 'stop_acp') { if (options.acpCleanupError) throw new Error(options.acpCleanupError); acpSessions.delete(String(args.token)); return; }
      if (command === 'write_acp') {
        const target = acpSessions.get(String(args.token)); assert.ok(target);
        const request = args.message as JsonRecord;
        const send = (value: JsonRecord) => target.channel.onmessage({ kind: 'rpc', value: { jsonrpc: '2.0', ...value } });
        if (request.method === 'initialize') send({ id: request.id, result: { protocolVersion: 1, agentInfo: { name: 'fixture-agent', version: '1' }, agentCapabilities: {} } });
        else if (request.method === 'session/new') {
          target.sessionId = 'acp-fixture';
          send({ id: request.id, result: { sessionId: 'acp-fixture', configOptions: [] } });
        }
        else if (request.method === 'session/prompt') {
          target.promptId = request.id;
          const params = request.params as { prompt: { text: string }[] };
          send({ method: 'session/update', params: { sessionId: 'acp-fixture', update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: params.prompt[0].text } } } });
          send({ method: 'session/update', params: { sessionId: 'acp-fixture', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ACP fixture response' } } } });
        } else if (request.method === 'session/cancel') send({ id: target.promptId, result: { stopReason: 'cancelled' } });
        return;
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
        if (request.type === 'prompt' && request.message === '/mcp' && options.mcpReport) {
          channel.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', id: 'mcp-status', method: 'notify', notifyType: 'info', message: options.mcpReport } });
          channel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true, data: { disposition: 'handled' } } });
          return;
        }
        if (request.type === 'set_session_name') target.name = String(request.name);
        if (options.modelFixture) {
          if (request.type === 'set_model' && options.modelChangeError) {
            channel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: false, error: options.modelChangeError } }); return;
          }
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
          : request.type === 'get_commands' ? { commands: options.mcpReport ? [{ name: 'mcp', source: 'extension', sourceInfo: { path: 'builtin:mcp' } }] : [] } : {};
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
  async function rowMenu(row: HTMLElement) {
    row.dispatchEvent(new win.MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 50 }));
    await tick(); await tick();
    assert.ok(menu, 'native popup requested');
    const current = menu;
    function item(key: string, label: string, enabled: boolean) {
      return { label, disabled: !enabled, click: () => { if (enabled) sessionMenuEvent?.(current.request, key); } };
    }
    return {
      pin: item('pin', String(current.options.pinLabel), current.options.pinEnabled === true),
      close: item('close', 'Close session', current.options.closeEnabled === true),
      delete: item('delete', String(current.options.deleteLabel), current.options.deleteEnabled === true),
    };
  }
  return { dom, win, tick, calls, element, openSettings, back, preferences, openPalette, rows, rowMenu,
    confirm: async () => { await tick(); element<HTMLDialogElement>('host-dialog').close('ok'); await tick(); await tick(); },
    saved: (): { drafts: Record<string, any>; last: unknown } => ({ drafts: Object.fromEntries([...nativeDrafts].filter(([, record]) => record.value !== null).map(([key, record]) => [key, record.value])), last: preferences.value.state['nimrod.last-session.v1'] }),
    sessions, acpSessions, sdkSessions,
    deletionEvent: (event: DeletionEvent, target?: string) => deletionEvent?.(event, target),
    projectPicker: (target?: string) => projectPicker?.(target),
    linkError: (message: string, target?: string) => linkError?.(message, target),
    nativeBlurFailure: (payload: { request: string; message: string }, target?: string) => nativeBlurFailure?.(payload, target),
    notificationClick: (event: unknown, target?: string) => notificationClick?.(event, target),
    captureChannel: () => channel,
    emit: (event: JsonRecord) => channel.onmessage({ kind: 'rpc', value: event }),
    disconnect: () => channel.onmessage({ kind: 'disconnected', message: 'fixture closed' }),
  };
}

test('native row menu pins its background target without selection, connection, recency or draft effects', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
    'nimrod.tabs.v1:/project': { tabs: [
      { path: '/sessions/older', sessionId: 'fixture-id', name: 'Older', lastUsed: 10 },
      { path: '/sessions/newer', sessionId: 'fixture-id', name: 'Newer', lastUsed: 20 },
    ], active: '/sessions/newer' },
  } });
  try {
    const [older, newer] = f.rows(), prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Keep my draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const before = f.calls.length, time = older.querySelector('time')!.getAttribute('datetime');
    const native = await f.rowMenu(older);
    assert.equal(newer.getAttribute('aria-current'), 'true');
    assert.equal(f.win.document.activeElement, prompt);
    native.pin.click(); await f.tick(); await f.tick();
    assert.equal(f.win.document.querySelector('#open-sessions .session-row'), older);
    assert.equal(older.querySelector('time')!.getAttribute('datetime'), time);
    assert.equal(newer.getAttribute('aria-current'), 'true');
    assert.equal(prompt.value, 'Keep my draft'); assert.equal(f.win.document.activeElement, prompt);
    assert.equal(older.parentElement!.querySelector('.session-pin')!.getAttribute('aria-pressed'), 'true');
    assert.equal(newer.parentElement!.classList.contains('pin-boundary'), true);
    assert.equal(f.calls.slice(before).some(call => ['start_pi', 'write_pi', 'stop_pi'].includes(call.command)), false);
    const layout = f.preferences.value.state['nimrod.tabs.v1:/project'] as { tabs: { pinned?: boolean }[] };
    assert.equal(layout.tabs[0].pinned, true);
    const registration = f.calls.find(call => call.command === 'plugin:event|listen' && call.args.event === 'nimrod-session-menu')!;
    assert.equal((registration.args.target as JsonRecord).kind, 'WebviewWindow');
    assert.equal((registration.args.target as JsonRecord).label, 'main');
    // A delayed event from an older popup must not act on the newly clicked row.
    const oldMenu = await f.rowMenu(older);
    const newMenu = await f.rowMenu(newer);
    oldMenu.close.click(); await f.tick();
    assert.equal(f.rows().length, 2);
    newMenu.pin.click(); await f.tick();
    assert.equal(newer.parentElement!.querySelector('.session-pin')!.getAttribute('aria-pressed'), 'true');
    older.parentElement!.querySelector<HTMLButtonElement>('.session-pin')!.click(); await f.tick();
    assert.equal(older.parentElement!.querySelector('.session-pin')!.getAttribute('aria-pressed'), 'false');
  } finally { f.win.close(); }
});

test('pinning prefers top or minimally reveals a deep pin; unpinning preserves the reading anchor', async () => {
  for (const existingPins of [0, 5]) {
    const entries = Array.from({ length: 8 }, (_, index) => ({ path: `/sessions/pin-${index}`, sessionId: 'fixture-id', name: `Pin ${index}`, lastUsed: 100 - index, pinned: index < existingPins }));
    const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
      'nimrod.tabs.v1:/project': { tabs: entries, active: entries[0].path },
    } });
    try {
      await f.tick(); await f.tick();
      const panel = f.element('sidebar-session-panel'), rows = f.rows(), target = rows[7];
      const rect = (top: number) => ({ top, bottom: top + 40, height: 40 } as DOMRect);
      Object.defineProperty(panel, 'offsetHeight', { value: 100 });
      panel.getBoundingClientRect = () => ({ top: 0, bottom: 100, height: 100 } as DOMRect);
      for (const row of rows) row.parentElement!.getBoundingClientRect = () => rect([...f.element('open-sessions').children].indexOf(row.parentElement!) * 40 - panel.scrollTop);
      const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Retain draft'; prompt.focus();
      panel.scrollTop = 180;
      const before = f.calls.length, timestamp = target.querySelector('time')!.getAttribute('datetime');
      (await f.rowMenu(target)).pin.click(); await f.tick(); await f.tick();
      assert.equal(panel.scrollTop, existingPins ? 140 : 0);
      assert.equal(target.parentElement!.getBoundingClientRect().bottom, existingPins ? 100 : 40);
      assert.equal(rows[0].getAttribute('aria-current'), 'true');
      assert.equal(f.win.document.activeElement, prompt); assert.equal(prompt.value, 'Retain draft');
      assert.equal(target.querySelector('time')!.getAttribute('datetime'), timestamp);
      assert.equal(f.calls.slice(before).some(call => ['start_pi', 'write_pi', 'stop_pi'].includes(call.command)), false);
      panel.scrollTop = 160;
      const anchor = [...f.element('open-sessions').children][4] as HTMLElement;
      const offset = anchor.getBoundingClientRect().top;
      target.parentElement!.querySelector<HTMLButtonElement>('.session-pin')!.click(); await f.tick();
      assert.equal(anchor.getBoundingClientRect().top, offset, 'unpin retains normal anchoring instead of requesting list top');
      assert.ok(panel.scrollTop > 0);
    } finally { f.win.close(); }
  }
});

test('saved Pi and Copilot pins restore without loading background sessions and palette pin is bindable', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
    'nimrod.tabs.v1:/project': { tabs: [
      { path: '/sessions/pinned', sessionId: 'fixture-id', name: 'Pinned Pi', lastUsed: 10, pinned: true },
      { kind: 'copilot-sdk', sessionId: 'saved-id', name: 'Pinned SDK', lastUsed: 20, pinned: true },
      { path: '/sessions/selected', sessionId: 'fixture-id', name: 'Selected', lastUsed: 30 },
    ], active: '/sessions/selected' },
  } });
  try {
    assert.deepEqual([...f.win.document.querySelectorAll('#open-sessions .session-row-label')].map(node => node.textContent), ['Pinned SDK', 'Pinned Pi', 'Selected']);
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'connect'), false);
    f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'Pin session'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.rows()[2].parentElement!.querySelector('.session-pin')!.getAttribute('aria-pressed'), 'true');
    assert.equal(ACTIONS.find(action => action.id === 'pin')!.defaults.length, 0);
  } finally { f.win.close(); }
});

test('keyboard row menu suppresses the webview default and native failures stay session-owned', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', menuError: 'Native popup unavailable' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const row = f.rows()[0]; row.focus();
    const event = new f.win.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
    row.dispatchEvent(event); await f.tick(); await f.tick();
    assert.equal(event.defaultPrevented, true);
    assert.equal(f.calls.filter(call => call.command === 'popup_session_menu').length, 1);
    assert.match(f.win.document.querySelector('.session-view:not([hidden]) .application-notices')?.textContent || f.win.document.querySelector('.session-view:not([hidden])')!.textContent!, /Native popup unavailable/);
    assert.doesNotMatch(f.element('application-notices').textContent!, /Native popup unavailable/);
    const repeat = new f.win.KeyboardEvent('keydown', { key: 'F10', shiftKey: true, repeat: true, bubbles: true, cancelable: true });
    row.dispatchEvent(repeat); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'popup_session_menu').length, 1);
  } finally { f.win.close(); }
});

test('an unavailable ACP host cannot prevent Pi startup or enable ACP launches', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', acpCleanupError: 'ACP host unavailable' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    f.openPalette();
    assert.doesNotMatch(f.element('palette-list').textContent!, /New ACP session/);
    assert.equal(f.calls.some(call => call.command === 'start_acp'), false);
  } finally { f.win.close(); }
});

test('Copilot SDK coexists with Pi without changing its draft, default backend or stop routing', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  const enter = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const piRoot = f.win.document.querySelector<HTMLElement>('.session-view')!, pi = f.captureChannel();
    const piPrompt = f.element<HTMLTextAreaElement>('prompt'); piPrompt.value = 'Keep Pi draft'; piPrompt.dispatchEvent(new f.win.Event('input'));
    f.openPalette(); const input = f.element<HTMLInputElement>('palette-input'); input.value = 'New Copilot session'; input.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').firstElementChild!.querySelector('small')!.textContent, 'Start a Copilot session');
    enter(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'one discovery process plus one conversation');
    assert.equal(f.calls.some(call => call.command === 'start_acp'), false);
    assert.equal(f.element('mode-badge').textContent, 'Copilot');
    const copilotRoot = f.win.document.querySelector('.session-view:not([hidden])')!;
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Copilot request'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(copilotRoot.querySelectorAll('.message.user').length, 1, 'echo reconciles the local user turn');
    assert.match(f.element('messages').textContent!, /SDK fixture response/);
    prompt.value = 'New Copilot draft'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(prompt.value, 'New Copilot draft');
    assert.equal(f.calls.filter(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'prompt').length, 1);
    f.element<HTMLButtonElement>('send').click(); await f.tick(); await f.tick();
    assert.equal(prompt.value, 'New Copilot draft');
    f.rows()[0].click(); await f.tick();
    assert.equal(f.element('prompt'), piPrompt); assert.equal(piPrompt.value, 'Keep Pi draft'); assert.equal(piRoot.hidden, false);
    pi.onmessage({ kind: 'rpc', value: { type: 'agent_start' } }); await f.tick();
    assert.match(f.rows()[0].getAttribute('aria-label')!, /Working/);
    f.rows()[1].click(); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'n', metaKey: true, bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 2, 'New stays explicitly Pi-default, not selected-session-derived');
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2);
    f.rows()[1].click(); await f.tick();
    const piStops = f.calls.filter(call => call.command === 'stop_pi').length;
    const copilotStops = f.calls.filter(call => call.command === 'stop_copilot').length;
    f.rows()[1].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'stop_copilot').length, copilotStops + 1);
    assert.equal(f.calls.filter(call => call.command === 'stop_pi').length, piStops);
    assert.equal(piPrompt.value, 'Keep Pi draft'); assert.equal(f.rows().length, 2);
  } finally { f.win.close(); }
});

test('Copilot slash commands discover arguments, open harness choice modals and render output without Nimrod action dispatch', async () => {
  const choices = [{ name: 'show', description: 'Show permissions' }, { name: 'reset', description: 'Clear approvals' }];
  const f = await fixture(undefined, { windowWorkspace: '/project',
    sdkCommands: [{ name: 'permissions', description: 'Manage permissions', kind: 'builtin', input: { hint: 'Permission operation', choices } }],
    sdkCommand: async request => {
      assert.equal(request.input, 'show', 'bare command must not run before choosing an advertised argument');
      return { kind: 'text', text: '**Permission report**', markdown: true };
    },
  });
  try {
    f.openPalette();
    const paletteInput = f.element<HTMLInputElement>('palette-input');
    const enter = () => paletteInput.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    paletteInput.value = 'New Copilot session'; paletteInput.dispatchEvent(new f.win.Event('input')); enter(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.focus();
    const type = (value: string) => { prompt.value = value; prompt.setSelectionRange(value.length, value.length); prompt.dispatchEvent(new f.win.Event('input')); };
    const send = () => f.element<HTMLButtonElement>('send').click();
    const commands = () => f.calls.filter(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'command');
    type('/permissions sh');
    assert.match(f.element('slash-suggestions').textContent!, /Show permissions/);
    type('/permissions'); send(); await f.tick(); await f.tick();
    assert.equal(prompt.value, '');
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('palette-title').textContent, 'Copilot /permissions');
    assert.equal(commands().length, 0, 'argument picker opens before SDK invocation');
    assert.equal(f.element<HTMLButtonElement>('palette-back').hidden, true);
    assert.equal(f.element<HTMLButtonElement>('palette-refresh').hidden, true);
    assert.match(f.element('palette-list').textContent!, /Show permissions/);
    enter(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal((commands()[0].args.message as JsonRecord).input, 'show');
    assert.match(f.element('messages').textContent!, /Copilot command.*Permission report/s);
    assert.equal(f.element('messages').querySelectorAll('.message.user, .message.assistant').length, 0);
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'prompt'), false);
    type('/permissions'); send(); await f.tick(); await f.tick();
    paletteInput.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(commands().length, 1, 'Escape invokes neither the bare command nor a subcommand');
    type('A newer draft');
    assert.equal(prompt.value, 'A newer draft');
  } finally { f.win.close(); }
});

test('SDK sidebar identity, title, recency and draft survive reopening with selected-session connection and no prompt replay', async () => {
  const key = 'nimrod.tabs.v1:/project', scope = copilotSdkScope('sdk-fixture');
  const first = await fixture(undefined, { windowWorkspace: '/project' });
  let appState: Record<string, unknown>, nativeDrafts: Record<string, unknown>;
  try {
    const enter = () => first.element('palette-input').dispatchEvent(new first.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    first.openPalette();
    const input = first.element<HTMLInputElement>('palette-input');
    input.value = 'New Copilot session'; input.dispatchEvent(new first.win.Event('input'));
    enter(); await first.tick(); await first.tick();
    const prompt = first.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Copilot sidebar title'; prompt.dispatchEvent(new first.win.Event('input'));
    prompt.dispatchEvent(new first.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await first.tick();
    first.element<HTMLButtonElement>('send').click(); await first.tick(); await first.tick();
    prompt.value = 'Draft after restart'; prompt.dispatchEvent(new first.win.Event('input'));
    await first.tick(); await first.tick();
    appState = structuredClone(first.preferences.value.state);
    nativeDrafts = structuredClone(first.saved().drafts);
    const layout = appState[key] as { tabs: JsonRecord[]; active: string };
    assert.equal(layout.active, scope);
    assert.equal(layout.tabs.length, 1);
    assert.equal(layout.tabs[0].kind, 'copilot-sdk');
    assert.equal('profile' in layout.tabs[0], false);
    assert.equal(layout.tabs[0].sessionId, 'sdk-fixture');
    assert.equal(layout.tabs[0].name, 'Copilot sidebar title');
    assert.equal('path' in layout.tabs[0], false, 'Copilot identity is not a Pi path');
    assert.equal('env' in layout.tabs[0], false, 'launch environment is not persisted');
    assert.equal((nativeDrafts[scope] as { draft: string }).draft, 'Draft after restart');
  } finally { first.win.close(); }
  const f = await fixture(undefined, { windowWorkspace: '/project', appState, nativeDrafts });
  try {
    assert.equal(f.rows().length, 1);
    assert.match(f.rows()[0].textContent!, /Copilot sidebar title.*Copilot/);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Draft after restart');
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'project discovery and the selected conversation start independently');
    const messages = () => f.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as JsonRecord);
    assert.equal(messages().find(message => message.method === 'connect')?.sessionId, 'sdk-fixture');
    assert.equal(f.calls.some(call => call.command === 'start_pi' || call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'prompt'), false);
    const used = (f.preferences.value.state[key] as { tabs: { lastUsed: number }[] }).tabs[0].lastUsed;
    assert.equal(messages().some(message => message.method === 'prompt'), false);
    assert.match(f.element('messages').textContent!, /Saved Copilot question.*Saved Copilot answer/s);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Draft after restart');
    assert.equal((f.preferences.value.state[key] as { tabs: { lastUsed: number }[] }).tabs[0].lastUsed, used, 'replay is not local use');
    assert.equal(f.calls.some(call => call.command === 'notify_session'), false);
    const writes = f.calls.filter(call => call.command === 'preferences_state').length;
    const target = [...f.sdkSessions.values()].find(session => session.sessionId === 'sdk-fixture')!;
    for (let i = 0; i < 50; i++) target.channel.onmessage({ kind: 'rpc', value: { kind: 'event', event: {
      id: `stream-${i}`, type: 'assistant.message_delta', data: { messageId: 'stream', deltaContent: ' continued' },
    } } });
    await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'preferences_state').length, writes, 'content-only streaming adds no bookkeeping IPC');
  } finally { f.win.close(); }
});

test('retired Copilot ACP records never launch, restore rows or alias SDK drafts', async () => {
  const legacyScope = 'acp:copilot:"same-id"', sdkScope = copilotSdkScope('same-id');
  const legacy = { kind: 'acp', profile: 'copilot', sessionId: 'same-id', name: 'Retired Copilot' };
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
    'nimrod.history.copilot.v1:/project': true,
    'nimrod.tabs.v1:/project': { tabs: [legacy, { kind: 'copilot-sdk', sessionId: 'same-id', name: 'Current Copilot' }], active: legacyScope },
  }, nativeDrafts: { [legacyScope]: { draft: 'Retired draft' }, [sdkScope]: { draft: 'Current draft' } } });
  try {
    assert.equal(f.rows().length, 1);
    assert.match(f.rows()[0].textContent!, /Current Copilot/);
    assert.doesNotMatch(f.rows()[0].textContent!, /ACP|SDK/);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Current draft');
    assert.equal(f.calls.some(call => call.command === 'start_acp'), false);
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'the valid fallback selection reconnects when the persisted target is retired');
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'connect'), true);
    assert.equal(f.calls.some(call => call.command === 'start_acp'), false);
    assert.equal(f.saved().drafts[legacyScope].draft, 'Retired draft');
    assert.equal(f.saved().drafts[sdkScope].draft, 'Current draft');
  } finally { f.win.close(); }
});

test('missing Copilot executable retains the sidebar identity and draft and supports explicit retry', async () => {
  const key = 'nimrod.tabs.v1:/project', scope = copilotSdkScope('saved-id');
  const options: ShellOptions = { windowWorkspace: '/project', copilotStartError: 'Copilot executable was not found on PATH',
    appState: { [key]: { tabs: [{ kind: 'copilot-sdk', sessionId: 'saved-id', name: 'Keep me', lastUsed: 100 }], active: scope } },
    nativeDrafts: { [scope]: { draft: 'Keep my draft' } } };
  const f = await fixture(undefined, options);
  try {
    assert.equal(f.rows().length, 1);
    assert.match(f.win.document.querySelector('.session-view:not([hidden])')!.textContent!, /not found on PATH/);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Keep my draft');
    assert.equal((f.preferences.value.state[key] as { tabs: { sessionId: string }[] }).tabs[0].sessionId, 'saved-id');
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'startup selection connects once and does not retry its failure automatically');
    options.copilotStartError = undefined;
    const retry = [...f.win.document.querySelectorAll<HTMLButtonElement>('.session-view:not([hidden]) button')].find(button => button.textContent === 'Retry connection')!;
    assert.ok(retry); retry.click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 3);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Keep my draft');
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && ['session/new', 'prompt'].includes(String((call.args.message as JsonRecord).method))), false);
    assert.doesNotMatch(f.win.document.querySelector('.session-view:not([hidden])')!.textContent!, /not found on PATH/);
  } finally { f.win.close(); }
});

test('shared lifecycle preserves mixed sidebar membership independently of connection and Pi-only Restart', async () => {
  const key = 'nimrod.tabs.v1:/project', path = '/sessions/pi.jsonl', scope = copilotSdkScope('fixture-id');
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: { [key]: {
    tabs: [
      { path, sessionId: 'fixture-id', name: 'Pi saved', lastUsed: 100 },
      { kind: 'copilot-sdk', sessionId: 'fixture-id', name: 'Copilot saved', lastUsed: 200 },
    ],
    active: path,
  } } });
  try {
    const layout = () => f.preferences.value.state[key] as { tabs: { path?: string; kind?: string; sessionId: string }[]; active: string };
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 1);
    assert.equal(layout().tabs.length, 2);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, false);
    f.rows()[1].click(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, true);
    assert.equal(layout().active, scope);
    assert.equal(layout().tabs.length, 2, 'disabling Restart cannot remove Copilot persistence');
    const target = [...f.sdkSessions.values()].find(session => session.sessionId === 'fixture-id')!;
    target.channel.onmessage({ kind: 'disconnected', message: 'Offline agent exited' }); await f.tick();
    assert.equal(f.rows().length, 2, 'disconnect cannot close the sidebar entry');
    assert.equal(layout().tabs.length, 2);
    assert.equal(layout().tabs.find(tab => tab.kind === 'copilot-sdk')?.sessionId, 'fixture-id');
    assert.equal(layout().tabs.find(tab => tab.path === path)?.sessionId, 'fixture-id', 'matching IDs across backends stay independent');
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'disconnect is not a reconnect request');
  } finally { f.win.close(); }
});

test('late Copilot loading never steals Pi selection or focus and Close preserves the saved draft', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const scope = copilotSdkScope('saved-id'), key = 'nimrod.tabs.v1:/project';
  const f = await fixture(undefined, { windowWorkspace: '/project', copilotLoadGate: gate,
    appState: { [key]: { tabs: [{ kind: 'copilot-sdk', sessionId: 'saved-id', name: 'Saved Copilot' }] } },
    nativeDrafts: { [scope]: { draft: 'Keep after Close' } } });
  try {
    f.rows()[0].click(); await f.tick();
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Independent Pi draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    release(); await f.tick(); await f.tick();
    assert.equal(f.element('prompt'), prompt);
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(prompt.value, 'Independent Pi draft');
    f.rows()[0].click(); await f.tick();
    const copilotStops = f.calls.filter(call => call.command === 'stop_copilot').length;
    const piStops = f.calls.filter(call => call.command === 'stop_pi').length;
    f.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click();
    await f.tick();
    await f.tick();
    assert.equal(f.rows().length, 1);
    assert.equal((f.saved().drafts[scope] as { draft: string }).draft, 'Keep after Close');
    assert.equal((f.preferences.value.state[key] as { tabs: { kind?: string }[] }).tabs.some(tab => tab.kind === 'copilot-sdk'), false);
    assert.equal(f.calls.filter(call => call.command === 'stop_copilot').length, copilotStops + 1);
    assert.equal(f.calls.filter(call => call.command === 'stop_pi').length, piStops);
  } finally { release(); f.win.close(); }
});

test('Resume cannot reuse an open Pi file with a different saved identity', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog: [
    { path: '/sessions/new.jsonl', sessionId: 'replacement', name: 'Replaced history', preview: '', modified: 100 },
  ] });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Keep original draft'; prompt.dispatchEvent(new f.win.Event('input'));
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'Replaced history'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.match(f.win.document.body.textContent!, /different saved session identity/);
    assert.equal(f.rows().length, 1);
    assert.equal(prompt.value, 'Keep original draft');
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
    assert.equal(f.calls.some(call => call.command === 'start_acp'), false, 'Pi-only projects need no Copilot discovery process');
  } finally { f.win.close(); }
});

test('Delete sessions includes supported Copilot history, retains its picker and deletes closed history without loading it', async () => {
  const scope = copilotSdkScope('saved-id');
  const f = await fixture(undefined, { windowWorkspace: '/project',
    copilotHistory: [{ sessionId: 'saved-id', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Closed Copilot' },
      { sessionId: 'other-project', context: { workingDirectory: '/other' }, isRemote: false, summary: 'Wrong project' }],
    appState: { [copilotHistoryKey('/project')]: true }, nativeDrafts: { [scope]: { draft: 'Saved draft' } },
    catalog: [{ path: '/sessions/pi.jsonl', sessionId: 'pi', name: 'Pi survivor', preview: '', modified: 100 }] });
  const enter = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  try {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.match(f.element('palette-list').textContent!, /Closed Copilot/);
    assert.doesNotMatch(f.element('palette-list').textContent!, /Wrong project/);
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'Copilot'; input.dispatchEvent(new f.win.Event('input'));
    enter(); await f.tick();
    assert.equal(f.element('deletion-title').textContent, 'Delete Copilot session');
    assert.doesNotMatch(f.element('deletion-description').textContent!, /descendants/);
    f.element<HTMLButtonElement>('deletion-cancel').click(); await f.tick();
    assert.equal(f.saved().drafts[scope].draft, 'Saved draft');
    assert.equal(input.value, 'Copilot');
    enter(); await f.tick();
    f.element<HTMLButtonElement>('deletion-confirm').click(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('palette-list').children.length, 0);
    assert.equal(f.saved().drafts[scope], undefined);
    assert.equal(f.rows().length, 0);
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 1, 'only project discovery, not a conversation');
    const methods = f.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as JsonRecord);
    assert.equal(methods.find(message => message.method === 'delete')!.sessionId, 'saved-id');
    assert.equal(methods.filter(message => message.method === 'delete').length, 1);
    assert.equal(methods.some(message => ['session/new', 'connect', 'prompt'].includes(String(message.method))), false);
    assert.equal(f.calls.some(call => ['delete_session_tree', 'start_pi'].includes(call.command)), false);
    input.value = ''; input.dispatchEvent(new f.win.Event('input'));
    assert.match(f.element('palette-list').textContent!, /Pi survivor/);
  } finally { f.win.close(); }
});

test('row deletion stops only the owning Copilot conversation, retains review through completion and keeps drafts on failure', async () => {
  for (const outcome of ['deleted', 'failed']) {
    let release!: () => void;
    const scope = copilotSdkScope('saved-id');
    const f = await fixture(undefined, { windowWorkspace: '/project',
      copilotDeleteGate: new Promise<void>(resolve => { release = resolve; }),
      copilotDeleteError: outcome === 'failed' ? 'Deletion refused' : undefined,
      copilotHistory: [{ sessionId: 'saved-id', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Saved Copilot' }],
      appState: { 'nimrod.tabs.v1:/project': { tabs: [{ kind: 'copilot-sdk', sessionId: 'saved-id', name: 'Saved Copilot' }], active: scope } },
      nativeDrafts: { [scope]: { draft: 'Keep until confirmed' } } });
    try {
      f.rows()[0].click(); await f.tick(); await f.tick();
      const conversation = f.calls.filter(call => call.command === 'start_copilot').at(-1)!.args.token;
      const discovery = f.calls.find(call => call.command === 'start_copilot')!.args.token;
      const callsBefore = f.calls.length;
      (await f.rowMenu(f.rows()[0])).delete.click(); await f.tick();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true);
      assert.equal(f.calls.slice(callsBefore).some(call => call.command === 'stop_copilot'), false, 'review does not stop work');
      f.element<HTMLButtonElement>('deletion-confirm').click(); await f.tick(); await f.tick();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true);
      assert.equal(f.element<HTMLButtonElement>('deletion-confirm').disabled, true);
      assert.equal(f.element<HTMLButtonElement>('deletion-cancel').disabled, true);
      assert.match(f.element('deletion-description').textContent!, /Deleting sessions/);
      const stops = f.calls.slice(callsBefore).filter(call => call.command === 'stop_copilot').map(call => call.args.token);
      assert.ok(stops.includes(conversation));
      assert.equal(stops.includes(discovery), false);
      assert.equal(f.saved().drafts[scope].draft, 'Keep until confirmed');
      release(); await f.tick(); await f.tick();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false);
      assert.equal(f.rows().length, outcome === 'deleted' ? 0 : 1);
      assert.equal(f.saved().drafts[scope]?.draft, outcome === 'deleted' ? undefined : 'Keep until confirmed');
      assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'no automatic reconnect after deletion failure');
      const deletionWrites = f.calls.filter(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'delete');
      assert.equal(deletionWrites.length, 1);
      assert.equal(deletionWrites[0].args.token, discovery);
      if (outcome === 'failed') assert.match(f.win.document.body.textContent!, /Deletion refused/);
    } finally { release(); f.win.close(); }
  }
});

test('Resume discovers closed Copilot history, restores its draft and reuses the same open session row', async () => {
  const scope = copilotSdkScope('saved-id'), layoutKey = 'nimrod.tabs.v1:/project';
  const history = [{ sessionId: 'saved-id', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Closed Copilot', modifiedTime: '2026-10-16T12:00:00Z' },
    { sessionId: 'elsewhere', context: { workingDirectory: '/another-project' }, isRemote: false, summary: 'Wrong project' }];
  const f = await fixture(undefined, { windowWorkspace: '/project', copilotHistory: history,
    appState: { [copilotHistoryKey('/project')]: true }, nativeDrafts: { [scope]: { draft: 'Recovered closed draft' } },
    catalog: [{ path: '/sessions/pi.jsonl', sessionId: 'saved-id', name: 'Pi history', preview: '', modified: 100 }] });
  const resume = async () => {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
  };
  const enter = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  let stateAfterClose: Record<string, unknown> = {};
  try {
    assert.equal(f.rows().length, 0);
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 1);
    await resume();
    assert.match(f.element('palette-list').textContent!, /Pi history/);
    assert.match(f.element('palette-list').textContent!, /Closed Copilot.*Copilot/);
    assert.doesNotMatch(f.element('palette-list').textContent!, /Wrong project/);
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'Closed Copilot'; input.dispatchEvent(new f.win.Event('input')); enter(); await f.tick(); await f.tick();
    assert.equal(f.rows().length, 1);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'Recovered closed draft');
    assert.match(f.element('messages').textContent!, /Saved Copilot question.*Saved Copilot answer/s);
    const writes = () => f.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as JsonRecord);
    assert.equal(writes().find(message => message.method === 'connect')!.sessionId, 'saved-id');
    assert.equal(writes().some(message => message.method === 'session/new' || message.method === 'prompt'), false);
    assert.equal(f.calls.some(call => call.command === 'notify_session'), false);
    assert.equal((f.preferences.value.state[layoutKey] as { tabs: { lastUsed: number }[] }).tabs[0].lastUsed, Date.parse('2026-10-16T12:00:00Z'));
    await resume();
    input.value = 'Copilot'; input.dispatchEvent(new f.win.Event('input'));
    const row = f.element('palette-list').firstElementChild!;
    assert.equal(row.getAttribute('aria-label'), `${f.rows()[0].getAttribute('aria-label')} — Open`);
    enter(); await f.tick(); await f.tick();
    assert.equal(f.rows().length, 1);
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, 2, 'discovery and the reused conversation only');
    f.rows()[0].parentElement!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    assert.equal(f.rows().length, 0);
    assert.equal(f.preferences.value.state[copilotHistoryKey('/project')], true);
    assert.equal((f.saved().drafts[scope] as { draft: string }).draft, 'Recovered closed draft');
    stateAfterClose = structuredClone(f.preferences.value.state);
  } finally { f.win.close(); }
  const reopened = await fixture(undefined, { windowWorkspace: '/project', appState: stateAfterClose, copilotHistory: history });
  try {
    assert.equal(reopened.rows().length, 0);
    assert.equal(reopened.calls.filter(call => call.command === 'start_copilot').length, 1, 'project association survives closing the last conversation');
    assert.equal(reopened.calls.some(call => call.command === 'write_copilot' && ['session/new', 'connect', 'prompt'].includes(String((call.args.message as JsonRecord).method))), false);
  } finally { reopened.win.close(); }
});

test('Resume sorts incremental mixed-harness history by displayed recency after overlaying open rows', async () => {
  let release!: () => void;
  const f = await fixture(undefined, { windowWorkspace: '/project',
    appState: {
      [copilotHistoryKey('/project')]: true,
      'nimrod.tabs.v1:/project': { tabs: [
        { kind: 'copilot-sdk', sessionId: 'open-copilot', name: 'Open Copilot', lastUsed: 400 },
        { path: '/sessions/open.jsonl', sessionId: 'fixture-id', name: 'Open Pi', lastUsed: 500 },
      ], active: copilotSdkScope('open-copilot') },
    },
    copilotListGate: new Promise<void>(resolve => { release = resolve; }),
    catalog: [
      { path: '/sessions/unknown.jsonl', sessionId: 'unknown', name: 'Unknown Pi', preview: '', modified: 999 },
      { path: '/sessions/closed.jsonl', sessionId: 'closed', name: 'Closed Pi', preview: '', modified: 900, lastUserMessageAt: 450 },
      { path: '/sessions/open.jsonl', sessionId: 'fixture-id', name: 'Stale Pi title', preview: '', modified: 100, lastUserMessageAt: 100 },
    ],
    copilotHistory: [
      { sessionId: 'open-copilot', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Stale Copilot title', modifiedTime: new Date(900).toISOString() },
      { sessionId: 'closed-copilot', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Closed Copilot', modifiedTime: new Date(600).toISOString() },
    ],
  });
  const titles = () => [...f.element('palette-list').querySelectorAll('.session-row-label')].map(row => row.textContent);
  try {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.deepEqual(titles(), ['Open Pi', 'Closed Pi', 'Unknown Pi']);
    release(); await f.tick(); await f.tick();
    assert.deepEqual(titles(), ['Closed Copilot', 'Open Pi', 'Closed Pi', 'Open Copilot', 'Unknown Pi']);
    assert.equal(f.element('palette-list').querySelector('[aria-selected="true"] .session-row-label')!.textContent, 'Open Pi', 'late pages preserve the highlighted identity');
    const openTitles = [...f.element('palette-list').children].filter(row => row.getAttribute('aria-label')!.endsWith(' — Open'))
      .map(row => row.querySelector('.session-row-label')!.textContent);
    assert.deepEqual(openTitles, [...f.element('open-sessions').querySelectorAll('.session-row-label')].map(row => row.textContent));
    assert.equal(f.element('palette-list').firstElementChild!.querySelector('small')!.lastElementChild!.textContent, 'Copilot');
  } finally { release(); f.win.close(); }
});

test('Resume isolates Pi and Copilot discovery failures and keeps successful source rows actionable', async () => {
  for (const failure of [{ copilotListError: 'Copilot fixture listing failed' }, { catalogError: 'Pi fixture catalog failed' }]) {
    const f = await fixture(undefined, { windowWorkspace: '/project', ...failure,
      appState: { [copilotHistoryKey('/project')]: true },
      catalog: [{ path: '/sessions/pi.jsonl', sessionId: 'fixture-id', name: 'Pi history', preview: '', modified: 100 }],
      copilotHistory: [{ sessionId: 'saved-id', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Copilot history' }] });
    try {
      f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
      await f.tick(); await f.tick();
      assert.match(f.element('palette-list').textContent!, 'catalogError' in failure ? /Copilot history/ : /Pi history/);
      assert.match(f.win.document.body.textContent!, /listing failed|catalog failed/);
      assert.equal(f.rows().length, 0, 'listing cannot open or create a conversation');
      assert.equal(f.calls.some(call => call.command === 'write_copilot' && ['session/new', 'connect', 'prompt'].includes(String((call.args.message as JsonRecord).method))), false);
    } finally { f.win.close(); }
  }
});

test('Pi history appears before slow Copilot discovery and cancelled results cannot reopen Resume', async () => {
  let release!: () => void;
  const f = await fixture(undefined, { windowWorkspace: '/project',
    appState: { [copilotHistoryKey('/project')]: true }, copilotListGate: new Promise<void>(resolve => { release = resolve; }),
    catalog: [{ path: '/sessions/pi.jsonl', sessionId: 'fixture-id', name: 'Pi ready', preview: '', modified: 100 }],
    copilotHistory: [{ sessionId: 'saved-id', context: { workingDirectory: '/project' }, isRemote: false, summary: 'Late Copilot' }] });
  try {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick();
    assert.match(f.element('palette-list').textContent!, /Pi ready/);
    assert.match(f.element('palette-status').textContent!, /Loading Copilot history/);
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await f.tick(); release(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.rows().length, 0);
    assert.equal(f.sdkSessions.size, 1, 'cancelling the picker retains project discovery');
  } finally { release(); f.win.close(); }
});

test('foreground/background streaming does not persist unchanged session layout; selection and rename still save', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const first = f.captureChannel();
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const second = f.captureChannel();
    const key = 'nimrod.tabs.v1:/project';
    const layout = () => f.preferences.value.state[key] as { tabs: { path: string; name: string; lastUsed: number }[]; active?: string };
    assert.equal(layout().tabs.length, 2);
    const persisted = structuredClone(layout());
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Keep my draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    await f.tick();
    const writes = () => f.calls.filter(call => call.command === 'preferences_state').length;
    const before = writes();
    for (const [index, channel] of [first, second].entries()) {
      channel.onmessage({ kind: 'rpc', value: { type: 'agent_start' } });
      channel.onmessage({ kind: 'rpc', value: { type: 'message_start', message: { role: 'assistant', timestamp: index + 1, content: [{ type: 'text', text: '' }] } } });
    }
    for (let i = 0; i < 100; i++) {
      first.onmessage({ kind: 'rpc', value: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'b' } } });
      second.onmessage({ kind: 'rpc', value: { type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'v' } } });
    }
    await f.tick(); await f.tick();
    assert.equal(writes(), before, '200 real fixture streaming deltas enqueue zero state IPC calls');
    assert.deepEqual(layout(), persisted);
    assert.match(f.element('messages').textContent!, new RegExp('v'.repeat(100)));
    assert.equal(prompt.value, 'Keep my draft'); assert.equal(f.win.document.activeElement, prompt);
    const firstRoot = f.win.document.querySelector('.session-view')!;
    assert.doesNotMatch(firstRoot.querySelector('[data-pi-id="messages"]')!.textContent!, new RegExp('b'.repeat(100)), 'background transcript DOM stays suspended');
    assert.match(f.rows()[0].getAttribute('aria-label')!, /Working/, 'background state/attention remains live');
    f.rows()[0].click();
    assert.match(firstRoot.querySelector('[data-pi-id="messages"]')!.textContent!, new RegExp('b'.repeat(100)), 'reveal reconciles latest content synchronously');
    await f.tick(); await f.tick();
    assert.equal(layout().active, '/sessions/new.jsonl'); assert.ok(writes() > before);
    const renamed = f.element<HTMLTextAreaElement>('prompt');
    renamed.value = '/name Renamed'; renamed.dispatchEvent(new f.win.Event('input'));
    renamed.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(layout().tabs.find(tab => tab.path === '/sessions/new.jsonl')!.name, 'Renamed');
    assert.equal(f.element('project-session-name').textContent, 'Renamed');
    assert.equal(f.element('project-session').title, 'Renamed');
    assert.equal(f.calls.some(call => call.command === 'write_pi' && (call.args.message as JsonRecord).type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('operational notices stay with their session without cross-session sidebar or shell feedback', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const first = f.captureChannel(), firstRoot = f.win.document.querySelector<HTMLElement>('.session-view')!;
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const currentRoot = f.win.document.querySelector<HTMLElement>('.session-view:not([hidden])')!;
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep current draft'; prompt.focus();
    const sidebar = f.element('open-sessions').innerHTML;
    first.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'notify', id: 'background', notifyType: 'error', message: 'First session MCP failure' } }); await f.tick();
    assert.equal(f.element('application-notices').hidden, true);
    assert.equal(f.element('session-notices').hidden, true);
    assert.equal(currentRoot.hidden, false); assert.equal(f.win.document.activeElement, prompt);
    assert.equal(prompt.value, 'Keep current draft');
    assert.equal(firstRoot.querySelector('.notice-announcement')!.textContent, '');
    assert.equal(f.element('open-sessions').innerHTML, sidebar, 'notice reporting adds no sidebar attention');
    f.rows()[0].click(); await f.tick();
    assert.match(f.element('session-notices').textContent!, /First session MCP failure/);
    assert.equal(f.element('application-notices').hidden, true);
    f.rows()[1].click(); await f.tick(); assert.equal(f.element('session-notices').hidden, true);
    f.rows()[0].click(); await f.tick();
    f.element('session-notices').querySelector<HTMLButtonElement>('[data-dismiss]')!.click();
    assert.equal(f.element('session-notices').hidden, true);
    f.rows()[1].click(); f.rows()[0].click(); await f.tick();
    assert.equal(f.element('session-notices').hidden, true, 'navigation does not resurrect a dismissed issue');
  } finally { f.win.close(); }
});

test('native browser failures stay in the originating project or reference notice strip without navigation or Pi work', async () => {
  for (const popout of [undefined, { session: 'source', title: 'Source', text: 'Captured source', language: 'text' }]) {
    const label = popout ? 'popout-fixture' : 'workspace-fixture';
    const f = await fixture(undefined, { windowLabel: label, windowWorkspace: '/project', popout });
    try {
      const before = f.win.location.href;
      f.linkError('Other window browser failure', 'other-window'); await f.tick();
      assert.doesNotMatch(f.element('application-notices').textContent!, /Other window/);
      f.linkError('Could not open link in your browser: fixture opener failed', label); await f.tick();
      assert.match(f.element('application-notices').textContent!, /Open link.*fixture opener failed/);
      assert.equal(f.win.location.href, before);
      assert.equal(f.calls.some(call => call.command === 'start_pi'), false);
      assert.equal(f.calls.some(call => call.command === 'open_card_link' || call.command === 'open_popout_link'), false, 'no automatic retry');
    } finally { f.win.close(); }
  }
});

test('bundled picker previews locally, restores on cancellation, commits offline and honors bind/unbind', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  const input = f.element<HTMLInputElement>('palette-input'), root = f.win.document.documentElement;
  const query = (text: string) => { input.value = text; input.dispatchEvent(new f.win.Event('input')); };
  const key = (key: string) => input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const open = async () => { f.openPalette(); query('Select theme'); key('Enter'); await f.tick(); await f.tick(); };
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep theme draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const conversation = f.win.document.querySelector('.session-view'), baseline = f.preferences.value.text;
    assert.equal(f.calls.some(c => c.command === 'fetch_gogh_catalog'), false);
    await open(); query('Nord');
    assert.equal(root.dataset.themeMode, 'dark'); assert.equal(root.style.getPropertyValue('--vscode-editor-background').toLowerCase(), '#2e3440');
    assert.equal(f.preferences.value.text, baseline);
    assert.equal(f.element<HTMLButtonElement>('palette-refresh').hidden, true);
    key('Escape'); await f.tick(); assert.equal(root.dataset.theme, 'nimrod'); assert.equal(f.win.document.activeElement, prompt);
    await open(); query('Dracula'); key('Enter'); await f.tick(); await f.tick();
    assert.equal(JSON.parse(f.preferences.value.projectText!)['appearance.theme'], 'dracula');
    await open(); query('Nord'); key('Enter'); key('Enter'); await f.tick(); await f.tick();
    const selected = String(JSON.parse(f.preferences.value.projectText!)['appearance.theme']);
    assert.match(selected, /^catalog-/); assert.equal(root.dataset.theme, selected);
    assert.equal((parseSettings(f.preferences.value.text)['appearance.importedThemes'] as unknown[] ?? []).length, 0);
    assert.equal(f.calls.filter(c => c.command === 'fetch_gogh_catalog').length, 0);
    await open(); query('Nimrod'); assert.equal(root.dataset.theme, 'nimrod');
    f.preferences.externalProject(f.preferences.value.projectText!.replace(selected, 'dracula')); await f.tick();
    key('Escape'); await f.tick(); assert.equal(root.dataset.theme, 'dracula', 'cancel restores latest committed selection');
    assert.equal(f.win.document.querySelector('.session-view'), conversation); assert.equal(prompt.value, 'Keep theme draft');
    f.preferences.external('{"keybindings":{"select-theme":["primary+j"]}}'); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true }));
    assert.equal(f.element('palette-title').textContent, 'Select theme'); key('Escape'); await f.tick();
    f.preferences.external('{"keybindings":{"select-theme":[]}}'); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true }));
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('theme persistence failure restores committed colors without replaying acceptance', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  const input = f.element<HTMLInputElement>('palette-input');
  const query = (value: string) => { input.value = value; input.dispatchEvent(new f.win.Event('input')); };
  const key = (key: string) => input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  try {
    let saves = 0;
    f.preferences.projectSettings = async () => { saves++; throw new Error('fixture disk full'); };
    f.openPalette(); query('Select theme'); key('Enter'); await f.tick(); await f.tick();
    query('Nord'); assert.equal(f.win.document.documentElement.dataset.themeMode, 'dark');
    key('Enter'); await f.tick(); await f.tick();
    assert.equal(f.win.document.documentElement.dataset.theme, 'nimrod');
    assert.equal(saves, 1); assert.match(f.element('application-notices').textContent!, /disk full/);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
  } finally { f.win.close(); }
});

test('old saved Gogh themes remain usable and catalog choices never require downloads', async () => {
  const legacy = { id: 'import-gogh-fixture', name: 'Saved Gogh', mode: 'dark', colors: { 'editor.background': '#102030' }, syntax: {}, source: { provider: 'gogh', author: 'Author' } };
  const f = await fixture(undefined, { windowWorkspace: '/project', storage: { 'nimrod.themes.v1': { version: 1, selected: legacy.id, imports: [legacy] } } });
  try {
    assert.equal(f.win.document.documentElement.dataset.theme, legacy.id);
    f.openPalette(); const field = f.element<HTMLInputElement>('palette-input');
    field.value = 'Select theme'; field.dispatchEvent(new f.win.Event('input'));
    field.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    assert.equal(f.element('palette-list').children.length, 5 + CATALOG_THEMES.length);
    assert.equal(f.calls.some(c => c.command === 'fetch_gogh_catalog'), false);
    field.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    assert.equal(f.win.document.documentElement.dataset.theme, legacy.id);
  } finally { f.win.close(); }
});

test('palette commands show shortcuts except intentionally unbound actions and removed actions stay absent and inert', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    assert.equal(f.win.document.querySelector('#start-demo, #resume-file'), null);
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    f.openPalette();
    const rows = [...f.element('palette-list').querySelectorAll('[role=option]')];
    assert.ok(rows.length > 0);
    const unboundLabels = new Set<string>(INTENTIONALLY_UNBOUND_ACTIONS.map(id => ACTIONS.find(action => action.id === id)!.label));
    for (const row of rows) {
      const label = row.querySelector('.palette-item-label')!.textContent!;
      if (unboundLabels.has(label)) assert.equal(row.querySelector('kbd'), null, label);
      else assert.ok(row.querySelector('kbd')?.textContent, label);
    }
    assert.doesNotMatch(f.element('palette-list').textContent!, /offline demo|session file|ACP/i);
    f.element<HTMLDialogElement>('command-palette').close(); await f.tick();
    f.preferences.external('{"keybindings":{"demo":["primary+d"],"file":["primary+f"],"new-acp":["primary+u"],"acp-options":["primary+i"]}}'); await f.tick();
    const calls = f.calls.length;
    for (const key of ['d', 'f', 'u', 'i']) {
      const event = new f.win.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true });
      f.win.dispatchEvent(event); assert.equal(event.defaultPrevented, false);
    }
    await f.tick(); assert.equal(f.calls.length, calls);
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: ',', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await f.tick();
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(f.win.document.activeElement, f.element('settings-back'));
    assert.equal(f.element('settings-category-keybindings').hidden, true);
    f.back();
    f.preferences.external('{"keybindings":{"project-settings":[]}}'); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: ',', metaKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, false);
    f.preferences.external('{"keybindings":{"keybindings":["primary+j"]}}'); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick();
    assert.ok(f.calls.some(call => call.command === 'open_global_settings' && call.args.category === 'keybindings'));
  } finally { f.win.close(); }
});

test('transcript logging setting enables native Pi logging without changing the mounted conversation', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    assert.equal(f.element<HTMLSelectElement>('transcript-logs-mode').value, 'off');
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    f.emit({ type: 'tool_execution_start', toolCallId: 'disabled', toolName: 'extension_tool' }); await f.tick();
    assert.equal(f.calls.some(c => c.command === 'append_transcript_logs'), false);
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'keep draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const view = prompt.closest('.session-view');
    const starts = f.calls.filter(c => c.command === 'start_pi').length;
    f.preferences.external('{"diagnostics.transcriptLogs":true}'); await f.tick();
    assert.equal(f.element<HTMLSelectElement>('transcript-logs-mode').value, 'on');
    f.emit({ type: 'tool_execution_start', toolCallId: 'custom', toolName: 'extension_tool', args: { value: 1 } });
    await new Promise(resolve => setTimeout(resolve, 150)); await f.tick();
    const writes = f.calls.filter(c => c.command === 'append_transcript_logs');
    assert.equal(writes.length, 1);
    const captured = (writes[0].args.lines as string[]).map(line => JSON.parse(line));
    assert.equal(captured[0].payload.toolName, 'extension_tool');
    assert.equal(captured[0].toolCallId, 'custom');
    assert.equal(prompt.closest('.session-view'), view); assert.equal(prompt.value, 'keep draft');
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
    f.preferences.external('{}'); await f.tick();
  } finally { f.win.close(); }
});

test('SDK transcript logging uses the global setting and native append bridge for tools and permissions', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    const enter = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    f.openPalette(); const input = f.element<HTMLInputElement>('palette-input'); input.value = 'New Copilot session'; input.dispatchEvent(new f.win.Event('input')); enter(); await f.tick(); await f.tick();
    const target = [...f.sdkSessions.values()].find(session => session.sessionId === 'sdk-fixture')!;
    const event = (id: string, type: string, data: JsonRecord) => target.channel.onmessage({ kind: 'rpc', value: { kind: 'event', event: { id, type, data } } });
    event('disabled-capture', 'tool.extension_specific', { toolCallId: 'disabled' });
    assert.equal(f.calls.some(call => call.command === 'append_transcript_logs'), false);
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'keep SDK draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const starts = f.calls.filter(call => call.command === 'start_copilot').length;
    f.preferences.external('{"diagnostics.transcriptLogs":true}'); await f.tick();
    event('sdk-delta', 'assistant.tool_call_delta', { toolCallId: 'captured', inputDelta: '{"url":' });
    event('sdk-start', 'tool.execution_start', { toolCallId: 'captured', toolName: 'web_fetch', arguments: { url: 'https://example.test/fixture' } });
    const request = { kind: 'url', toolCallId: 'captured', url: 'https://example.test/fixture' };
    event('sdk-permission-event', 'permission.requested', { requestId: 'native-request', permissionRequest: request });
    target.channel.onmessage({ kind: 'rpc', value: { kind: 'permission', id: 'capture-permission', request } });
    await new Promise(resolve => setTimeout(resolve, 150)); await f.tick();
    const captured = f.calls.filter(call => call.command === 'append_transcript_logs').flatMap(call => (call.args.lines as string[]).map(line => JSON.parse(line)));
    assert.deepEqual(captured.map(record => record.event), ['assistant.tool_call_delta', 'tool.execution_start', 'permission.requested', 'permission.request']);
    assert.ok(captured.every(record => record.source.backend === 'copilot-sdk' && record.sessionId === 'sdk-fixture' && record.toolCallId === 'captured'));
    assert.deepEqual(captured.at(-1).payload, { kind: 'permission', id: 'capture-permission', request });
    assert.equal(prompt.value, 'keep SDK draft'); assert.equal(f.win.document.activeElement, f.element('palette-input'));
    assert.equal(f.calls.filter(call => call.command === 'start_copilot').length, starts);
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'prompt'), false);
    f.preferences.external('{}'); await f.tick();
  } finally { f.win.close(); }
});

test('Copilot permissions retain one modal, escape without answering, reopen through a banner and route exact scoped decisions', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'New Copilot session'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    const target = [...f.sdkSessions.values()].find(session => session.sessionId === 'sdk-fixture')!;
    const draft = f.element<HTMLTextAreaElement>('prompt'); draft.value = 'keep draft'; draft.dispatchEvent(new f.win.Event('input')); draft.focus();
    const request = (id: string, path: string) => target.channel.onmessage({ kind: 'rpc', value: { kind: 'permission', id, request: { kind: 'read', path, intention: `Search in directory: ${path}` } } });
    target.channel.onmessage({ kind: 'rpc', value: { kind: 'event', event: { id: 'working-permissions', type: 'assistant.turn_start', data: {} } } });
    request('first', '/project/test'); request('second', '/project/src');
    await f.tick();
    const host = draft.closest('.session-view')!;
    const picker = f.element<HTMLDialogElement>('command-palette');
    assert.equal(picker.open, true);
    assert.equal(f.element('palette-remaining').textContent, '1 more');
    assert.match(host.querySelector('.notice-pending')!.textContent!, /2 requests/);
    assert.equal(host.querySelector('.notice-pending [data-dismiss]'), null);
    assert.match(f.element('activity').textContent!, /Waiting for permission/);
    assert.doesNotMatch(f.element('keyboard-hint').textContent!, /working/i);
    assert.equal(f.win.document.activeElement, f.element('palette-input')); assert.equal(draft.value, 'keep draft');
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await f.tick();
    assert.equal(picker.open, false); assert.equal(f.win.document.activeElement, draft);
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'decision'), false);
    host.querySelector<HTMLButtonElement>('.notice-pending button')!.click(); await f.tick();
    assert.equal(picker.open, true);
    const allow = [...f.element('palette-list').querySelectorAll<HTMLElement>('[role=option]')].find(row => row.textContent?.includes('Allow all file reads this session'))!;
    allow.click(); await f.tick();
    const decisions = f.calls.filter(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'decision');
    assert.deepEqual((decisions.at(-1)!.args.message as JsonRecord).value, { kind: 'approve-for-session', approval: { kind: 'read' } });
    assert.equal(picker.open, true);
    assert.equal(f.element('palette-remaining').textContent, 'Last request');
    target.channel.onmessage({ kind: 'rpc', value: { kind: 'event', event: { id: 'idle-permissions', type: 'session.idle', data: {} } } });
    await f.tick();
    assert.equal(picker.open, false);
    assert.equal(host.querySelector('.notice-pending > .application-notice'), null);
    assert.equal(draft.value, 'keep draft'); assert.equal(f.win.document.activeElement, draft);
    assert.equal(f.calls.filter(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'decision').length, 1);
  } finally { f.win.close(); }
});

test('Copilot questions use retained picker and nested input without cancelling on dismissal or changing drafts', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'New Copilot session'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    const target = [...f.sdkSessions.values()].find(session => session.sessionId === 'sdk-fixture')!;
    const draft = f.element<HTMLTextAreaElement>('prompt'); draft.value = 'keep question draft'; draft.dispatchEvent(new f.win.Event('input')); draft.focus();
    const host = draft.closest('.session-view')!;
    const request = (id: string) => target.channel.onmessage({ kind: 'rpc', value: { kind: 'input', id, request: { question: 'What scope?', choices: ['Conversation only', 'Include interface'] } } });
    const writes = () => f.calls.filter(call => call.command === 'write_copilot').map(call => call.args.message as JsonRecord);
    const click = (label: string) => {
      const row = [...f.element('palette-list').querySelectorAll<HTMLElement>('[role=option]')].find(row => row.querySelector('.palette-item-label')?.textContent === label)!;
      assert.ok(row, label); row.click();
    };
    request('first'); request('second'); await f.tick();
    assert.equal(host.querySelector('.acp-permission'), null);
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('palette-title').textContent, 'Copilot question');
    assert.equal(f.element('palette-context').textContent, 'What scope?');
    assert.match(host.querySelector('.notice-pending')!.textContent!, /Waiting for input · 2 questions/);
    assert.match(f.element('activity').textContent!, /Waiting for input/);
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(writes().some(message => message.method === 'cancel' || message.method === 'decision'), false);
    host.querySelector<HTMLButtonElement>('.notice-pending button')!.click(); await f.tick();
    click('Enter your own answer…'); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('host-dialog').open, true);
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('host-dialog-title').textContent, 'What scope?');
    assert.equal(f.element('host-dialog').querySelector('button[value="ok"]')!.textContent, 'Submit answer');
    f.element<HTMLDialogElement>('host-dialog').close('cancel'); await f.tick();
    assert.equal(writes().some(message => message.method === 'decision'), false);
    click('Enter your own answer…'); await f.tick();
    f.element<HTMLTextAreaElement>('host-dialog-input').value = 'My custom scope';
    f.element<HTMLDialogElement>('host-dialog').close('ok'); await f.tick(); await f.tick();
    assert.deepEqual(writes().filter(message => message.method === 'decision').at(-1)?.value, { answer: 'My custom scope', wasFreeform: true });
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    click('Conversation only'); await f.tick();
    assert.deepEqual(writes().filter(message => message.method === 'decision').at(-1)?.value, { answer: 'Conversation only', wasFreeform: false });
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(host.querySelector('.notice-pending > .application-notice'), null);
    assert.equal(draft.value, 'keep question draft');
    assert.equal(writes().some(message => message.method === 'prompt' || message.method === 'cancel'), false);
  } finally { f.win.close(); }
});

test('Copilot plan review returns feedback without sending a prompt or changing the draft', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'New Copilot session'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    const target = [...f.sdkSessions.values()].find(session => session.sessionId === 'sdk-fixture')!;
    const draft = f.element<HTMLTextAreaElement>('prompt'); draft.value = 'keep draft'; draft.focus();
    const host = draft.closest('.session-view')!;
    for (const [id, buttonText, expected] of [
      ['revise', 'Request changes', { approved: false, feedback: 'Preserve the API.' }],
      ['approve', 'Continue with Autopilot', { approved: true, selectedAction: 'autopilot', feedback: 'Preserve the API.' }],
      ['cancel', 'Cancel request', { approved: false }],
    ] as const) {
      target.channel.onmessage({ kind: 'rpc', value: { kind: 'plan', id, request: {
        summary: 'Review plan', planContent: 'Inspect and implement', actions: ['interactive', 'autopilot', 'exit_only'],
      } } });
      await f.tick();
      assert.equal(f.win.document.activeElement, draft);
      const feedback = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Plan feedback"]')!;
      feedback.value = ' Preserve the API. ';
      [...host.querySelectorAll<HTMLButtonElement>('.acp-permission button')].find(button => button.textContent === buttonText)!.click();
      await f.tick();
      const decision = f.calls.filter(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'decision').at(-1)!;
      assert.deepEqual((decision.args.message as JsonRecord).value, expected);
      assert.equal(draft.value, 'keep draft');
      assert.equal(host.querySelector('.acp-permission'), null);
    }
    assert.equal(f.calls.some(call => call.command === 'write_copilot' && (call.args.message as JsonRecord).method === 'prompt'), false);
  } finally { f.win.close(); }
});

test('performance capture is opt-in, bindable, timing-only and preserves the mounted session', async () => {
  const control = { after: [] as (() => void)[], writeError: undefined as string | undefined, copyError: undefined as string | undefined };
  const f = await fixture(undefined, { windowWorkspace: '/project', performanceControl: control });
  try {
    assert.equal(f.element<HTMLSelectElement>('performance-mode').value, 'off');
    assert.equal(f.element<HTMLButtonElement>('performance-capture').disabled, true);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'private draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    await f.tick();
    const view = prompt.closest('.session-view');
    const started = f.calls.filter(c => c.command === 'start_pi').length;
    const prompted = f.calls.filter(c => c.command === 'write_pi' && (c.args.message as JsonRecord).type === 'prompt').length;
    f.preferences.external('{"diagnostics.performance":true,"keybindings":{"capture-performance":["primary+alt+p"]}}'); await f.tick();
    assert.equal(f.element<HTMLButtonElement>('performance-capture').disabled, false);
    // The Settings surface owns diagnostics; mounted views must use its same probe.
    prompt.dispatchEvent(new f.win.Event('input'));
    f.emit({ type: 'agent_start' }); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'p', metaKey: true, altKey: true, bubbles: true, cancelable: true }));
    assert.equal(control.after.length, 1);
    assert.equal(f.element<HTMLButtonElement>('performance-capture').disabled, true);
    assert.equal(f.win.document.activeElement, prompt);
    control.after.shift()!(); await f.tick();
    const saved = f.calls.find(c => c.command === 'write_performance_report')!;
    assert.ok(saved); assert.doesNotMatch(JSON.stringify(saved.args), /private draft|\/project|\/sessions/);
    const report = saved.args.report as unknown as import('../src/performance-diagnostics').PerformanceReport;
    for (const kind of ['input-handler', 'composer-layout', 'snapshot', 'transcript-render']) {
      assert.ok(report.samples.some(sample => sample.kind === kind && sample.active === true), `${kind} reaches the window-owned capture through the renderer probe`);
    }
    assert.equal(report.version, 2);
    assert.ok(report.environment.appearance);
    for (const kind of ['pi-event', 'state-reduction', 'timeline-projection', 'snapshot-delivery', 'shell-session-update', 'sidebar-row-update', 'sidebar-reconcile', 'bookkeeping-prepare', 'sidebar-rows']) {
      assert.ok(report.work.some(sample => sample.kind === kind), `${kind} reaches the shared work aggregate capture`);
    }
    const savedPath = '/fixture/.local/state/nimrod/performance-captures/2026-10-14_12-00-00.000Z.json';
    assert.match(f.element('performance-status').textContent!, /Report saved:.*\.json.*Path copied/);
    assert.equal(f.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').at(-1)!.args.text, savedPath);
    assert.equal(prompt.closest('.session-view'), view); assert.equal(prompt.value, 'private draft');
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, started);
    assert.equal(f.calls.filter(c => c.command === 'write_pi' && (c.args.message as JsonRecord).type === 'prompt').length, prompted);
    f.preferences.external('{"diagnostics.performance":true,"keybindings":{"capture-performance":[]}}'); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'p', metaKey: true, altKey: true, bubbles: true, cancelable: true }));
    assert.equal(control.after.length, 0, 'unbound shortcut does not capture');
    const writesBeforeCopyFailure = f.calls.filter(call => call.command === 'write_performance_report').length;
    control.copyError = 'fixture clipboard unavailable';
    f.openPalette(); f.element<HTMLInputElement>('palette-input').value = 'Capture performance report';
    f.element<HTMLInputElement>('palette-input').dispatchEvent(new f.win.Event('input'));
    f.element<HTMLInputElement>('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); control.after.shift()!(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'write_performance_report').length, writesBeforeCopyFailure + 1, 'clipboard failure never retries report saving');
    assert.match(f.element('application-notices').textContent!, /Report saved:.*\.json.*Could not copy.*fixture clipboard unavailable/);
    assert.equal(prompt.value, 'private draft');
    control.copyError = undefined;
    const copiesBeforeButton = f.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').length;
    f.element<HTMLButtonElement>('performance-capture').click(); control.after.shift()!(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'plugin:clipboard-manager|write_text').length, copiesBeforeButton, 'save-only helper does not copy without an action request');
    control.writeError = 'fixture disk full';
    f.element<HTMLButtonElement>('performance-capture').click(); control.after.shift()!(); await f.tick();
    assert.match(f.element('application-notices').textContent!, /fixture disk full/);
    assert.equal(f.element<HTMLButtonElement>('performance-capture').disabled, false);
    f.element<HTMLButtonElement>('performance-capture').click();
    f.preferences.external('{"diagnostics.performance":false}'); await f.tick();
    const writes = f.calls.filter(c => c.command === 'write_performance_report').length;
    control.after.shift()!(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'write_performance_report').length, writes);
    assert.equal(f.element<HTMLButtonElement>('performance-capture').disabled, true);
  } finally { f.win.close(); }
});

test('personal compilation does not gate shell/session boot and Reload card plugins is bindable without Pi restart', async () => {
  let release!: (value: import('../src/pi/card-plugins/catalog').PersonalBundles) => void;
  const gate = new Promise<import('../src/pi/card-plugins/catalog').PersonalBundles>(resolve => { release = resolve; });
  const f = await fixture(undefined, { windowWorkspace: '/project', personalGate: gate });
  try {
    assert.match(f.element('card-plugin-status').textContent || '', /Loading/);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'keep draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
    release({ entries: [], plugins: [], warnings: [] }); await f.tick(); await f.tick();
    assert.match(f.element('card-plugin-status').textContent || '', /0 personal/); assert.equal(prompt.value, 'keep draft'); assert.equal(f.win.document.activeElement, prompt);
    f.preferences.external('{"keybindings":{"reload-card-plugins":["primary+alt+l"]}}'); await f.tick();
    const before = f.calls.filter(call => call.command === 'load_personal_card_plugins').length;
    const starts = f.calls.filter(call => call.command === 'start_pi' || call.command === 'stop_pi').length;
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'l', metaKey: true, altKey: true, bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'load_personal_card_plugins').length, before + 1);
    assert.equal(f.calls.filter(call => call.command === 'start_pi' || call.command === 'stop_pi').length, starts); assert.equal(prompt.value, 'keep draft');
    f.preferences.external('{"keybindings":{"reload-card-plugins":[]}}'); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'l', metaKey: true, altKey: true, bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'load_personal_card_plugins').length, before + 1);
  } finally { f.win.close(); }
});

test('Cmd-R restarts the selected saved session, preserves its draft and honors modality, repeats and overrides', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  const key = (name = 'r', extra: KeyboardEventInit = {}) => {
    const event = new f.win.KeyboardEvent('keydown', { key: name, metaKey: true, bubbles: true, cancelable: true, ...extra });
    f.win.dispatchEvent(event); return event;
  };
  try {
    key(); await f.tick(); assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 0);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    key(); await f.tick(); assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const root = f.win.document.querySelector('.session-view:not([hidden])');
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Retained restart draft'; prompt.dispatchEvent(new f.win.Event('input'));
    f.openPalette(); key(); await f.tick(); assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    f.element<HTMLDialogElement>('command-palette').close(); await f.tick();
    key('r', { repeat: true }); key('r', { isComposing: true }); key('r', { shiftKey: true });
    await f.tick(); assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    key(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 3);
    const config = f.calls.filter(c => c.command === 'start_pi').at(-1)!.args.config as JsonRecord;
    assert.equal(config.mode, 'resume'); assert.equal(config.sessionFile, '/sessions/new.jsonl');
    assert.equal(f.win.document.querySelector('.session-view:not([hidden])'), root);
    assert.equal(f.element('prompt'), prompt); assert.equal(prompt.value, 'Retained restart draft');
    f.preferences.external('{"keybindings":{"restart":["primary+j"]}}'); await f.tick();
    assert.equal(key().defaultPrevented, false);
    key('j'); await f.tick(); await f.tick(); assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 4);
    f.preferences.external('{"keybindings":{"restart":[]}}'); await f.tick();
    assert.equal(key().defaultPrevented, false); assert.equal(key('j').defaultPrevented, false);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('recent-project defaults and overrides use the keybinding registry without native shortcut interception', async () => {
  const f = await fixture(undefined, { projects: [{ cwd: '/work/project', open: false }] });
  const key = (key: string, shiftKey = false) => {
    const event = new f.win.KeyboardEvent('keydown', { key, metaKey: true, shiftKey, bubbles: true, cancelable: true });
    f.win.dispatchEvent(event); return event;
  };
  const close = async () => { f.element<HTMLDialogElement>('command-palette').close(); await f.tick(); };
  try {
    assert.equal(key('o').defaultPrevented, false, 'Cmd-O remains native');
    key('O', true); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Open recent project');
    await close();
    f.preferences.external('{"keybindings":{"open-recent-project":["primary+j"]}}'); await f.tick();
    assert.equal(key('O', true).defaultPrevented, false, 'old default is removed');
    key('j'); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Open recent project');
    await close(); f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'Open recent project'; input.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').querySelector('kbd')!.textContent, 'Ctrl+J');
    await close();
    f.preferences.external('{"keybindings":{"open-recent-project":[]}}'); await f.tick();
    assert.equal(key('j').defaultPrevented, false);
    assert.equal(key('O', true).defaultPrevented, false);
    f.openPalette(); input.value = 'Open recent project'; input.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').querySelector('kbd'), null);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
  } finally { f.win.close(); }
});

test('native project requests are window-scoped, survive boot and never start sessions', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', windowLabel: 'workspace-1', projectPickerPending: true,
    projects: [{ cwd: '/work/nimrod', open: true }, { cwd: '/work/other', open: false }], filePath: null });
  try {
    await f.tick(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('palette-title').textContent, 'Open recent project');
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = '/work/nimrod'; input.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.win.document.querySelector('#palette-browse, #palette-project-footer'), null);
    assert.equal(f.element('palette-list').querySelector('.palette-item-label')!.textContent, 'nimrod');
    assert.equal(f.element('palette-list').querySelector('.palette-project-parent')!.textContent, '/work');
    assert.equal(f.calls.some(c => c.command === 'plugin:dialog|open'), false);
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.calls.filter(c => c.command === 'open_project_directory').length, 1);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    f.projectPicker('workspace-2'); await f.tick(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    f.projectPicker('workspace-1'); await f.tick(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
  } finally { f.win.close(); }
});

test('customizable requested shortcuts use normal session/model/effort actions without submitting drafts', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', modelFixture: true, fileExists: () => false });
  const key = (key: string, extra: KeyboardEventInit = {}) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true, ...extra }));
  const escape = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  try {
    key('n'); await f.tick(); await f.tick();
    assert.equal((f.calls.find(call => call.command === 'start_pi')!.args.config as JsonRecord).mode, 'saved');
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Retain this draft'; prompt.dispatchEvent(new f.win.Event('input'));
    for (const name of ['m', 'e']) {
      assert.equal(key(name), true, 'unshifted shortcuts are not consumed by the project shell');
      await f.tick(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    }
    key('M', { shiftKey: true }); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Select model');
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    key('E', { shiftKey: true }); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Select thinking level'); escape();
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
    escape(); f.openSettings(); assert.equal(f.element('settings-category-keybindings').hidden, true); assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
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
    assert.match(f.element('palette-list').textContent!, /Closed history/); assert.match(f.element('palette-list').innerHTML, /aria-label="[^"]* — Open"/);
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

test('Resume and Delete sessions use the same native catalog and presentation without starting Pi', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog: [
    { path: '/sessions/shared.jsonl', sessionId: 'shared', name: 'Shared name', preview: 'Searchable preview', modified: 1, lastUserMessageAt: 1748781000123 },
  ] });
  const escape = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  try {
    const runtimeLookups = f.calls.filter(call => call.command === 'runtime_defaults').length;
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true })); await f.tick();
    const resumeRows = f.element('palette-list').innerHTML;
    escape(); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, shiftKey: true, bubbles: true })); await f.tick();
    assert.equal(f.element('palette-list').innerHTML, resumeRows);
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'Searchable preview'; input.dispatchEvent(new f.win.Event('input'));
    assert.match(f.element('palette-list').textContent!, /Shared name/);
    assert.equal(f.calls.filter(call => call.command === 'list_workspace_sessions').length, 2);
    assert.equal(f.calls.some(call => ['start_pi', 'write_pi'].includes(call.command)), false);
    assert.equal(f.calls.filter(call => call.command === 'runtime_defaults').length, runtimeLookups);
    escape();
  } finally { f.win.close(); }
});

test('Delete sessions shortcut loops native review over closed history without launching or selecting targets', async () => {
  let answer!: (value: boolean) => void;
  const catalog = ['one', 'two'].map((id, i) => ({ path: `/sessions/${id}.jsonl`, sessionId: id, name: `Old ${id}`, preview: 'history', modified: 2 - i }));
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog,
    confirmReview: args => answer(args.confirmed === true), deleteTree: async (emit, args) => {
      const confirmed = new Promise<boolean>(resolve => { answer = resolve; });
      emit({ id: String(args.root), phase: 'review', files: [String(args.root)], results: [], pending: true, tree: [{ file: String(args.root), title: 'Old session' }] });
      return await confirmed ? [{ file: args.root, deleted: true }] : [];
    },
  });
  const pickerKey = (key: string) => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  const shortcut = (extra: KeyboardEventInit = {}) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Backspace', metaKey: true, shiftKey: true, bubbles: true, cancelable: true, ...extra }));
  try {
    shortcut({ repeat: true }); shortcut({ isComposing: true }); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    shortcut(); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Delete sessions');
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'Old'; input.dispatchEvent(new f.win.Event('input'));
    pickerKey('ArrowDown'); pickerKey('Enter'); pickerKey('Enter'); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true); assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    f.element('deletion-cancel').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true); assert.equal(input.value, 'Old');
    assert.match(f.element('palette-list').querySelector('[aria-selected="true"]')!.textContent!, /Old two/);
    pickerKey('Enter'); await f.tick(); f.element('deletion-confirm').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.element('palette-list').children.length, 1); assert.match(f.element('palette-list').textContent!, /Old one/);
    pickerKey('Enter'); await f.tick(); f.element('deletion-confirm').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    pickerKey('Enter'); await f.tick(); f.element('deletion-confirm').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true); assert.equal(f.element('palette-list').children.length, 0);
    pickerKey('Escape'); await f.tick();
    assert.equal(f.rows().length, 0); assert.equal(f.calls.some(call => call.command === 'start_pi' || call.command === 'recover_deletion_session'), false);
    assert.deepEqual(f.calls.filter(call => call.command === 'delete_session_tree').map(call => ({ root: call.args.root, sessionId: call.args.sessionId })), [
      { root: '/sessions/two.jsonl', sessionId: 'two' }, { root: '/sessions/two.jsonl', sessionId: 'two' },
      { root: '/sessions/one.jsonl', sessionId: 'one' }, { root: '/sessions/one.jsonl', sessionId: 'one' },
    ]);
    assert.equal(f.calls.filter(call => call.command === 'list_workspace_sessions').length, 1, 'deletion never reloads the catalog');
    f.preferences.external('{"keybindings":{"delete-sessions":["primary+j"]}}');
    shortcut(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'j', metaKey: true, bubbles: true })); await f.tick(); assert.equal(f.element('palette-title').textContent, 'Delete sessions');
    pickerKey('Escape'); await f.tick(); f.preferences.external('{"keybindings":{"delete-sessions":[]}}');
    shortcut(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
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

test('Settings sidebar width synchronizes app-wide independently of project width and category selection', async () => {
  const key = 'nimrod.settings.sidebar.width';
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: { [key]: 230, 'nimrod.sidebar.width:/project': 340 } });
  const other = await fixture(undefined, { windowWorkspace: '/other', appState: { [key]: 230, 'nimrod.sidebar.width:/other': 410 } });
  try {
    f.openSettings(); other.openSettings(); await f.tick(); await other.tick();
    const handle = f.element('settings-resizer'), otherHandle = other.element('settings-resizer');
    f.element<HTMLButtonElement>('settings-category-runtime').click();
    assert.equal(f.element('settings-panel-runtime').hidden, false);
    handle.focus(); handle.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.preferences.value.state[key], 240);
    // Model a native state broadcast to a separately mounted project window.
    await other.preferences.state({ [key]: f.preferences.value.state[key] }); await other.tick();
    assert.equal(otherHandle.getAttribute('aria-valuenow'), '240');
    assert.equal(other.element('settings-panel-appearance').hidden, false, 'categories remain window-local');
    assert.equal(f.element('settings-panel-runtime').hidden, false);
    assert.equal(f.element('sidebar-resizer').getAttribute('aria-valuenow'), '340');
    assert.equal(other.element('sidebar-resizer').getAttribute('aria-valuenow'), '410');
    assert.equal(f.calls.some(call => call.command === 'start_pi' || call.command === 'write_pi' || call.command === 'preferences_settings'), false);
    const nested = f.element<HTMLDialogElement>('host-dialog'); nested.showModal();
    handle.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    f.element<HTMLButtonElement>('settings-category-appearance').click(); await f.tick();
    assert.equal(f.preferences.value.state[key], 240); assert.equal(f.element('settings-panel-runtime').hidden, false);
    nested.close(); f.back(); await f.tick();
    handle.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    assert.equal(f.preferences.value.state[key], 240);
  } finally { f.win.close(); other.win.close(); }
});

test('new sessions use creation time, Send updates recency immediately and timer refresh is text-only', async () => {
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
    f.element('sidebar-session-panel').scrollTop = 150;
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.deepEqual(order(), [rows[0], rows[1]], 'Send moves the row synchronously');
    assert.equal(f.element('sidebar-session-panel').scrollTop, 0, 'current recency-ordered view follows Send to the top');
    await f.tick();
    assert.deepEqual(times(), [now, now - 120_000 + 1], 'Send, not its result, advances recency');
    assert.equal(rows[0].querySelector<HTMLElement>('.session-indicator')!.dataset.state, 'sending');
    const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    [...f.sessions.values()][0].channel.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } }); await f.tick();
    assert.deepEqual(order(), [rows[0], rows[1]]); assert.equal(times()[0], now, 'success does not mark use a second time');
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
    const rows = f.rows(), order = () => [...f.win.document.querySelectorAll('#open-sessions .session-row')];
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

test('startup prefers list top or minimum reveal from top once, without focus, filter or recency changes', async () => {
  for (const scenario of [
    { view: 'all', selected: 7, collapsed: false, initial: 0, scroll: 220 },
    { view: 'all', selected: 1, collapsed: false, initial: 120, scroll: 0 },
    { view: 'all', selected: 4, collapsed: false, initial: 160, scroll: 100 },
    { view: 'all', selected: 7, collapsed: false, initial: 240, scroll: 220 },
    { view: 'unread', selected: 7, collapsed: false, initial: 80, scroll: 80 },
    { view: 'working', selected: 7, collapsed: false, initial: 80, scroll: 80 },
    { view: 'all', selected: 7, collapsed: true, initial: 80, scroll: 80 },
  ]) {
    let restore!: () => void;
    const windowWorkspaceGate = new Promise<void>(resolve => { restore = resolve; });
    // Hold connection completion: its existing composer focus policy is separate
    // from startup navigation, which must not focus anything or await the launch.
    const startGate = new Promise<void>(() => {});
    const key = 'nimrod.tabs.v1:/project';
    const entries = Array.from({ length: 8 }, (_, index) => ({ path: `/sessions/${index}`, sessionId: 'fixture-id', name: `Session ${index}`, lastUsed: 100 - index }));
    const f = await fixture(startGate, { windowWorkspace: '/project', windowWorkspaceGate, appState: {
      [key]: { tabs: entries, active: entries[scenario.selected].path },
      'nimrod.sidebar.view:/project': scenario.view,
      'nimrod.sidebar.visible': !scenario.collapsed,
    } });
    try {
      const panel = f.element('sidebar-session-panel');
      Object.defineProperty(panel, 'offsetHeight', { get: () => f.element('session-sidebar').hidden ? 0 : 100 });
      const rect = (top: number, height: number) => ({ top, bottom: top + height, left: 0, right: 200, width: 200, height, x: 0, y: top, toJSON() {} });
      panel.getBoundingClientRect = () => rect(0, 100);
      panel.scrollTop = scenario.initial;
      const originalRect = f.win.HTMLElement.prototype.getBoundingClientRect;
      f.win.HTMLElement.prototype.getBoundingClientRect = function () {
        if (!this.classList.contains('open-session')) return originalRect.call(this);
        const siblings = [...this.parentElement!.children].filter(row => !(row as HTMLElement).hidden);
        return rect(siblings.indexOf(this) * 40 - panel.scrollTop, 40);
      };
      f.win.document.body.tabIndex = -1; f.win.document.body.focus();
      const focused = f.win.document.activeElement;
      restore(); await f.tick(); await f.tick();
      assert.equal(panel.scrollTop, scenario.scroll, JSON.stringify(scenario));
      assert.equal(f.win.document.activeElement, focused, 'startup navigation adds no focus effect');
      assert.equal(f.element(`sidebar-${scenario.view}`).getAttribute('aria-selected'), 'true');
      assert.equal(f.element('session-sidebar').hidden, scenario.collapsed);
      assert.deepEqual([...f.element('open-sessions').children].map(row => row.querySelector('.session-row-label')!.textContent), entries.map(entry => entry.name));
      assert.deepEqual((f.preferences.value.state[key] as { tabs: { lastUsed: number }[] }).tabs.map(entry => entry.lastUsed), entries.map(entry => entry.lastUsed));
      if (scenario.view === 'all') {
        assert.equal(f.rows()[scenario.selected].getAttribute('aria-current'), 'true');
        assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 1);
        panel.scrollTop = 80;
        f.emit({ type: 'agent_start' }); await f.tick();
        assert.equal(panel.scrollTop, 80, 'later activity does not repeat startup reveal');
        assert.equal(f.win.document.activeElement, focused);
      } else {
        assert.equal(f.element('conversation').hidden, true);
        assert.equal(f.calls.filter(call => call.command === 'start_pi').length, 0, 'filtered-out restoration never launches');
      }
    } finally { f.win.close(); }
  }
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
    assert.equal(rows[0].getAttribute('aria-current'), 'true', 'next follows sidebar recency, not open order');
    const cycle = async (key: '[' | ']') => {
      f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, code: key === '[' ? 'BracketLeft' : 'BracketRight', metaKey: true, shiftKey: true, cancelable: true }));
      await f.tick(); await f.tick();
    };
    for (const row of [rows[3], rows[1], rows[2]]) {
      await cycle(']'); assert.equal(row.getAttribute('aria-current'), 'true', 'next wraps in displayed All order');
    }
    for (const row of [rows[1], rows[3], rows[0], rows[2]]) {
      await cycle('['); assert.equal(row.getAttribute('aria-current'), 'true', 'previous wraps in displayed All order');
    }
    f.element<HTMLButtonElement>('sidebar-working').click();
    assert.equal(f.element('conversation').hidden, true);
    await cycle(']');
    assert.equal(rows[0].getAttribute('aria-current'), 'true', 'blank filtered views still cycle all open sessions in All order');
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    f.element<HTMLButtonElement>('toggle-sidebar').click();
    await cycle('[');
    assert.equal(rows[2].getAttribute('aria-current'), 'true', 'collapsed sidebar keeps the same order');
    f.element<HTMLButtonElement>('toggle-sidebar').click();
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'cycling must not reorder All');
    f.openPalette(); const query = f.element<HTMLInputElement>('palette-input');
    query.value = 'switch session'; query.dispatchEvent(new f.win.Event('input'));
    query.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    const switchChoices = [...f.win.document.querySelectorAll<HTMLElement>('#palette-list [role=option]')];
    assert.deepEqual(switchChoices.map(choice => choice.querySelector('.palette-item-label')!.textContent), visible().map(row => row.querySelector('.session-row-label')!.textContent), 'Switch and All share exactly the same order');
    switchChoices[1].click(); await f.tick(); await f.tick();
    assert.equal(rows[2].getAttribute('aria-current'), 'true');
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'palette switching must not reorder All');
    assert.deepEqual((f.preferences.value.state[key] as typeof layout).tabs.map(tab => tab.lastUsed), [50, 100, 75, 0]);
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = '/name Renamed C'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.match(rows[2].getAttribute('aria-label')!, /Renamed C/);
    assert.equal(prompt.value, '', 'local rename submission clears its composer immediately');
    assert.deepEqual(visible(), [rows[1], rows[2], rows[0], rows[3]], 'renaming must not reorder All');
    assert.deepEqual((f.preferences.value.state[key] as typeof layout).tabs.map(tab => tab.lastUsed), [50, 100, 75, 0]);
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'set_session_name').length, 1);
    prompt.value = 'Use C by sending'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.deepEqual(visible(), [rows[2], rows[1], rows[0], rows[3]], 'Send moves C to the top');
    await cycle(']');
    assert.equal(rows[1].getAttribute('aria-current'), 'true', 'cycling uses the latest Send order');
    await cycle('[');
    assert.equal(rows[2].getAttribute('aria-current'), 'true');
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

test('Send updates recency once; background results and snapshots never reorder, scroll or select', async () => {
  for (const outcome of ['accepted', 'rejected', 'unknown']) {
    const f = await fixture(undefined, { windowWorkspace: '/project', holdPrompts: true });
    try {
      for (let i = 0; i < 2; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
      const rows = f.rows(), target = [...f.sessions.values()][0].channel;
      const visible = () => [...f.win.document.querySelectorAll('.session-row')];
      const timestamps = () => (f.preferences.value.state['nimrod.tabs.v1:/project'] as { tabs: { lastUsed: number }[] }).tabs.map(tab => tab.lastUsed);
      rows[0].click(); await f.tick();
      const used = timestamps()[0];
      const prompt = f.element<HTMLTextAreaElement>('prompt');
      prompt.value = 'Pending prompt'; prompt.dispatchEvent(new f.win.Event('input'));
      prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
      assert.deepEqual(visible(), [rows[0], rows[1]], 'Send immediately promotes the older selected session');
      rows[1].click(); await f.tick();
      const before = timestamps();
      assert.ok(before[0] > used);
      f.element('sidebar-session-panel').scrollTop = 120;
      const siblingPrompt = f.element<HTMLTextAreaElement>('prompt');
      siblingPrompt.value = 'Newer draft'; siblingPrompt.dispatchEvent(new f.win.Event('input')); siblingPrompt.focus();
      for (const event of [{ type: 'agent_start' }, { type: 'message_end', message: { role: 'user', content: 'Pending prompt', timestamp: 1 } }, { type: 'agent_settled' }]) target.onmessage({ kind: 'rpc', value: event });
      assert.deepEqual(timestamps(), before);
      const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
      if (outcome === 'unknown') target.onmessage({ kind: 'disconnected', message: 'Acceptance unknown' });
      else target.onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: outcome === 'accepted', error: outcome === 'rejected' ? 'Rejected' : undefined } });
      await f.tick();
      assert.deepEqual(visible(), [rows[0], rows[1]]);
      assert.equal(rows[1].getAttribute('aria-current'), 'true', 'background results never select their conversation');
      assert.deepEqual(timestamps(), before, 'success/failure/uncertainty never repeats or rolls back recency');
      assert.equal(f.element('sidebar-session-panel').scrollTop, 120);
      assert.equal(siblingPrompt.value, 'Newer draft'); assert.equal(f.win.document.activeElement, siblingPrompt);
      assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt').length, 1);
    } finally { f.win.close(); }
  }
});

test('Send follows Working recency to the top but preserves Unread arrival order and scroll', async () => {
  for (const view of ['working', 'unread']) {
    const f = await fixture(undefined, { windowWorkspace: '/project', holdPrompts: true });
    try {
      for (let i = 0; i < 3; i++) { f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
      const rows = f.rows(), channels = [...f.sessions.values()].map(s => s.channel);
      for (const channel of channels) {
        channel.onmessage({ kind: 'rpc', value: { type: 'agent_start' } });
        if (view === 'unread') channel.onmessage({ kind: 'rpc', value: { type: 'agent_settled' } });
      }
      f.element<HTMLButtonElement>(`sidebar-${view}`).click();
      rows[0].click(); await f.tick();
      const displayed = () => [...f.win.document.querySelectorAll<HTMLElement>('.open-session')].filter(row => !row.hidden);
      const before = displayed();
      f.element('sidebar-session-panel').scrollTop = 120;
      const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Send in filtered view'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
      prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      assert.equal(f.element(`sidebar-${view}`).getAttribute('aria-selected'), 'true');
      assert.equal(rows[0].getAttribute('aria-current'), 'true');
      assert.equal(f.win.document.activeElement, prompt);
      if (view === 'working') {
        assert.equal(displayed()[0], rows[0].parentElement);
        assert.equal(f.element('sidebar-session-panel').scrollTop, 0);
      } else {
        assert.deepEqual(displayed(), before);
        assert.equal(f.element('sidebar-session-panel').scrollTop, 120);
      }
      await f.tick();
      const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
      channels[0].onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } });
      await f.tick();
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

test('restored attention view stays blank and closing its last visible row selects a connected session in All', async () => {
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
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(f.element('conversation').hidden, false);
    assert.equal(roots[1].hidden, false);
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
      const expected = view === 'all-last' ? rows[1] : view === 'attention' ? rows[0] : rows[3];
      assert.equal(expected.getAttribute('aria-current'), 'true', `${view}: ${rows.map(row => `${row.id}:${row.getAttribute('aria-current')}`).join(', ')}`);
      assert.equal(f.element('sidebar-unread').getAttribute('aria-selected'), String(view === 'attention'));
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 4, 'no deleted or intermediate replacement launches');
      assert.equal(f.saved().drafts[`file:${root}`], undefined);
      const closed = JSON.parse(f.win.localStorage.getItem('nimrod.sessions.v1:/closed')!);
      assert.equal(closed.drafts[`file:${root}`].draft, 'Closed draft'); assert.deepEqual(closed.last, { path: root }); assert.equal(closed.drafts['file:/keep'].draft, 'Keep');
      assert.deepEqual((f.preferences.value.state['nimrod.tabs.v1:/project'] as { tabs: { path: string }[] }).tabs.map(tab => tab.path), ['/sessions/new.jsonl', view === 'all-last' ? '/sessions/new-1.jsonl' : '/sessions/new-3.jsonl']);
    } finally { f.dom.window.close(); }
  }
});

test('Close and Delete share connected-first selection and reconnect an inactive replacement', async () => {
  for (const action of ['close', 'delete']) for (const scenario of ['all', 'unread-visible', 'unread-hidden', 'working-hidden', 'inactive-middle', 'inactive-oldest', 'background']) {
    let now = 1_700_000_000_000;
    const selectedIndex = scenario === 'inactive-oldest' ? 0 : 1;
    const file = selectedIndex ? '/sessions/new-1.jsonl' : '/sessions/new.jsonl';
    const f = await fixture(undefined, { windowWorkspace: '/project', clock: () => now,
      deleteTree: async () => [{ file, deleted: true }] });
    try {
      for (let i = 0; i < 4; i++) { now += 1000; f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
      const rows = f.rows(), channels = [...f.sessions.values()].map(s => s.channel);
      const emit = (i: number, event: JsonRecord) => channels[i].onmessage({ kind: 'rpc', value: event });
      const complete = (i: number) => { emit(i, { type: 'agent_start' }); emit(i, { type: 'agent_settled' }); };
      const disconnect = (i: number) => channels[i].onmessage({ kind: 'disconnected', message: 'Fixture inactive' });
      let expected = 3, view = 'all';
      if (scenario === 'all') {
        // Send, not connection time, selection or a result, makes the oldest entry latest-used.
        rows[0].click(); now += 1000;
        const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Fixture optimistic prompt'; prompt.dispatchEvent(new f.win.Event('input'));
        f.element<HTMLButtonElement>('send').click(); await f.tick(); await f.tick();
        disconnect(2); expected = 0;
      } else if (scenario.startsWith('unread')) {
        for (const i of scenario === 'unread-visible' ? [1, 2, 0] : [1, 2]) complete(i);
        disconnect(2);
        f.element<HTMLButtonElement>('sidebar-unread').click();
        if (scenario === 'unread-visible') { expected = 0; view = 'unread'; }
      } else if (scenario === 'working-hidden') {
        rows[1].click(); emit(1, { type: 'agent_start' });
        f.element<HTMLButtonElement>('sidebar-working').click(); emit(1, { type: 'agent_settled' });
        // Selected settled row stays readable, but the connected fallback is outside Working.
      } else if (scenario.startsWith('inactive')) {
        for (const i of [0, 1, 2, 3]) if (i !== selectedIndex) disconnect(i);
        expected = 3;
      } else if (scenario === 'background') expected = 3;
      rows[scenario === 'background' ? 3 : selectedIndex].click(); await f.tick();
      const before = f.calls.filter(c => c.command === 'start_pi').length;
      const recency = rows.map(row => row.querySelector('time')!.getAttribute('datetime'));
      const target = rows[selectedIndex].parentElement!;
      if (action === 'close') target.querySelector<HTMLButtonElement>('.session-close')!.click();
      else (await f.rowMenu(rows[selectedIndex])).delete.click();
      await f.tick(); await f.tick(); await f.tick();
      assert.equal(rows[expected].getAttribute('aria-current'), 'true', `${action}/${scenario}`);
      assert.equal(f.element(`sidebar-${view}`).getAttribute('aria-selected'), 'true', `${action}/${scenario} view`);
      const reconnect = scenario.startsWith('inactive');
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, before + Number(reconnect), `${action}/${scenario}: both actions reconnect inactive replacements`);
      for (const i of [0, 1, 2, 3]) if (i !== selectedIndex) assert.equal(rows[i].querySelector('time')!.getAttribute('datetime'), recency[i], 'cleanup must not mark use');
      if (reconnect) {
        const config = f.calls.filter(c => c.command === 'start_pi').at(-1)!.args.config as JsonRecord;
        assert.equal(config.mode, 'resume');
        assert.equal(config.sessionFile, '/sessions/new-3.jsonl');
        assert.equal(rows[expected].querySelector('.session-indicator')!.getAttribute('data-state'), 'ready');
        assert.equal(f.calls.some(c => c.command === 'write_pi' && (c.args.message as JsonRecord).type === 'prompt'), false);
      }
    } finally { f.dom.window.close(); }
  }
});

test('returning to All loads and connects its selected restored session without sending a prompt', async () => {
  const file = '/sessions/restored.jsonl';
  const f = await fixture(undefined, { windowWorkspace: '/project', history: [{ role: 'user', content: [{ type: 'text', text: 'Restored conversation' }] }],
    appState: { 'nimrod.sidebar.view:/project': 'unread', 'nimrod.tabs.v1:/project': { active: file, tabs: [{ path: file, sessionId: 'fixture-id', name: 'Restored' }] } } });
  try {
    assert.equal(f.element('conversation').hidden, true, 'no selected matching row in Unread');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 0);
    f.element<HTMLButtonElement>('sidebar-all').click(); await f.tick(); await f.tick();
    assert.equal(f.rows()[0].getAttribute('aria-current'), 'true');
    assert.equal(f.rows()[0].querySelector('.session-indicator')!.getAttribute('data-state'), 'ready');
    assert.match(f.element('messages').textContent!, /Restored conversation/);
    assert.equal((f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord).sessionFile, file);
    f.element<HTMLButtonElement>('sidebar-all').click(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.calls.some(c => c.command === 'write_pi' && (c.args.message as JsonRecord).type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('deletion reconnects unrelated replacements immediately and respects changed selection/quarantine', async () => {
  for (const scenario of ['event', 'returned-pending', 'changed-selection', 'quarantine']) {
    const root = '/sessions/new-1.jsonl', child = '/sessions/new-2.jsonl', fallback = '/sessions/new-3.jsonl';
    const results = [{ file: root, deleted: true }, { file: child, deleted: true }];
    let now = 1_700_000_000_000;
    const options: ShellOptions = { windowWorkspace: '/project', clock: () => now, deleteTree: async () => results };
    const f = await fixture(undefined, options);
    try {
      for (let i = 0; i < 4; i++) { now += 1000; f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick(); }
      const rows = f.rows(), channels = [...f.sessions.values()].map(s => s.channel);
      rows[1].click();
      for (const i of [0, 2, 3]) channels[i].onmessage({ kind: 'disconnected', message: 'Fixture inactive' });
      await f.tick();
      const event: DeletionEvent = { id: 'fixture-delete', phase: 'complete', files: [root, child], results, pending: true };
      if (scenario === 'quarantine') {
        event.files.push(fallback); event.results = [...results, { file: fallback, deleted: false }];
      }
      if (scenario === 'returned-pending') {
        options.deletionSnapshot = { pending: true, quarantine: [root, child], files: [root, child] };
        f.element<HTMLButtonElement>('delete-session').click();
      } else f.deletionEvent(event);
      await f.tick(); await f.tick(); await f.tick();
      assert.equal(rows[3].getAttribute('aria-current'), 'true', 'whole subtree removed before most-recent survivor selection');
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, scenario === 'quarantine' ? 4 : 5, 'unrelated replacement resumes before transaction release');
      if (scenario === 'changed-selection') { rows[0].click(); await f.tick(); }
      const release: DeletionEvent = { ...event, phase: 'release', pending: false };
      f.deletionEvent(release); await f.tick(); await f.tick();
      const resumes = scenario !== 'quarantine';
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, scenario === 'changed-selection' ? 6 : resumes ? 5 : 4);
      if (resumes) {
        const selected = scenario === 'changed-selection' ? 0 : 3;
        assert.equal((f.calls.filter(c => c.command === 'start_pi').at(-1)!.args.config as JsonRecord).sessionFile, selected === 0 ? '/sessions/new.jsonl' : fallback);
        assert.equal(rows[selected].querySelector('.session-indicator')!.getAttribute('data-state'), 'ready');
      }
      if (scenario === 'changed-selection') assert.equal(rows[0].getAttribute('aria-current'), 'true');
      f.deletionEvent({ ...event, pending: false }); f.deletionEvent(release);
      await f.tick(); await f.tick();
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, scenario === 'changed-selection' ? 6 : resumes ? 5 : 4, 'duplicate reconciliation never reconnects twice');
      assert.equal(f.calls.some(c => c.command === 'write_pi' && (c.args.message as JsonRecord).type === 'prompt'), false);
    } finally { f.win.close(); }
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
      assert.equal(f.win.document.activeElement, f.element('deletion-confirm'));
      f.element<HTMLButtonElement>(confirmed ? 'deletion-confirm' : 'deletion-cancel').click(); await f.tick(); await f.tick(); await f.tick();
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

test('idle and working session deletion retains review until shutdown/removal without sending prompts or get_state', async () => {
  for (const working of [false, true]) for (const outcome of ['cancelled', 'deleted', 'failed']) {
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
      if (working) f.emit({ type: 'agent_start' });
      const underlyingState = indicator.dataset.state;
      const stateRequests = f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'get_state').length;
      const starts = f.calls.filter(c => c.command === 'start_pi').length;
      f.element<HTMLButtonElement>('delete-session').click(); await f.tick(); await f.tick();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true);
      assert.equal(indicator.dataset.state, underlyingState, 'review does not replace the underlying activity indicator');
      assert.equal(f.element('sidebar-working-count').textContent, '0');
      assert.equal(prompt.closest('.session-view')!.getAttribute('aria-busy'), String(working));
      assert.equal(unrelated.parentElement!.querySelector<HTMLElement>('.session-indicator')!.dataset.state, unrelatedState);
      assert.equal(prompt.closest<HTMLElement>('.session-view')!.inert, true, 'review still locks the affected composer');
      f.element<HTMLButtonElement>(outcome === 'cancelled' ? 'deletion-cancel' : 'deletion-confirm').click(); await f.tick(); await f.tick();
      if (outcome === 'cancelled') {
        assert.equal(indicator.dataset.state, underlyingState); assert.equal(prompt.closest<HTMLElement>('.session-view')!.inert, false);
        assert.equal(prompt.value, 'Keep my draft');
      } else {
        assert.equal(indicator.dataset.state, 'deleting'); assert.match(target.getAttribute('aria-label')!, /— Deleting$/);
        assert.equal(f.element('sidebar-working-count').textContent, '0');
        assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true, 'confirmation retains modal through shutdown');
        assert.equal(f.element<HTMLButtonElement>('deletion-confirm').disabled, true);
        assert.equal(f.element<HTMLButtonElement>('deletion-cancel').disabled, true);
        f.element('deletion-tree').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
        assert.equal(f.element<HTMLDialogElement>('deletion-review').open, true);
        f.deletionEvent({ id: 'removing', phase: 'removing', files: [file], results: [], pending: true }); await f.tick();
        assert.match(f.element('deletion-description').textContent!, /Deleting sessions/);
        finishExecution(); await f.tick(); await f.tick(); await f.tick();
        if (outcome === 'failed') { assert.equal(indicator.dataset.state, 'recovery'); assert.equal(prompt.value, 'Keep my draft'); }
        else assert.equal(target.isConnected, false);
      }
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false);
      assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts);
      assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'get_state').length, stateRequests, 'deletion never waits for fresh Pi state');
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

test('sidebar menu deletion targets a background row without selecting/resuming it and preserves confirmed-only cleanup', async () => {
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
    }, nativeDrafts: {
      [`file:${root}`]: { draft: 'Root draft' }, [`file:${child}`]: { draft: 'Child draft' }, [`file:${selected}`]: { draft: 'Selected draft' },
    }, confirmReview: args => answer(args.confirmed === true), deleteTree: async emit => {
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
      const trash = (await f.rowMenu(rows[0])).delete;
      assert.equal(rows[0].parentElement!.querySelector('.session-delete'), null);
      assert.equal(trash.label, 'Delete session tree…');
      assert.equal(trash.disabled, false); assert.equal(rows[2].getAttribute('aria-current'), 'true');
      const starts = f.calls.filter(call => call.command === 'start_pi').length;
      trash.click(); trash.click();
      assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false, 'row action waits briefly before showing loading');
      assert.equal(f.element<HTMLButtonElement>('deletion-confirm').disabled, true);
      await f.tick();
      assert.equal((await f.rowMenu(rows[1])).delete.disabled, true);
      release(); await f.tick(); await f.tick();
      assert.equal(f.win.document.activeElement, f.element('deletion-confirm'));
      assert.equal(rows[2].getAttribute('aria-current'), 'true'); assert.equal(rows[0].getAttribute('aria-current'), 'false');
      f.element<HTMLButtonElement>(outcome === 'cancelled' ? 'deletion-cancel' : 'deletion-confirm').click();
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

test('sidebar menu deletion allows working and pending sessions but guards unsaved, temporary and quarantined sessions', async () => {
  let exists = false;
  const f = await fixture(undefined, { windowWorkspace: '/project', fileExists: () => exists, holdPrompts: true });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    assert.equal((await f.rowMenu(f.rows()[0])).delete.disabled, true, 'unwritten saved sessions cannot be deleted');
    exists = true; f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const trash = () => f.rowMenu(f.rows()[1]).then(menu => menu.delete);
    assert.equal((await trash()).disabled, false);
    f.emit({ type: 'agent_start' }); assert.equal((await trash()).disabled, false, 'working sessions can be deleted');
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, false);
    f.emit({ type: 'agent_settled' }); assert.equal((await trash()).disabled, false);
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Pending send'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    assert.equal((await trash()).disabled, false, 'pending acknowledgement does not prevent native shutdown');
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, false);
    const request = f.calls.find(call => (call.args.message as JsonRecord)?.type === 'prompt')!.args.message as JsonRecord;
    f.captureChannel().onmessage({ kind: 'rpc', value: { type: 'response', id: request.id, success: true } }); await f.tick();
    assert.equal((await trash()).disabled, false, 'receipt settlement refreshes eligibility without an activity event');
    assert.equal(f.element<HTMLButtonElement>('delete-session').disabled, false);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    assert.equal((await f.rowMenu(f.rows()[2])).delete.disabled, true);
    assert.equal(f.calls.some(call => call.command === 'delete_session_tree'), false);
  } finally { f.win.close(); }
  const quarantined = await fixture(undefined, { windowWorkspace: '/project', deletionSnapshot: { pending: false, quarantine: ['/sessions/root'], files: [] }, appState: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/root', sessionId: 'fixture-id', name: 'Root' }], active: '/sessions/root' },
  } });
  try {
    const trash = (await quarantined.rowMenu(quarantined.rows()[0])).delete;
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
      if (!cancelled) assert.match(f.element('application-notices').textContent!, /Session store unavailable/);
      f.disconnect();
    } finally { f.dom.window.close(); }
  }
});

test('restored deletion quarantine blocks implicit launch/restart and explicit Resume validates before recovery', async () => {
  const file = '/sessions/retained.jsonl';
  const f = await fixture(undefined, { windowWorkspace: '/project', deletionSnapshot: { pending: false, quarantine: [file], files: [] }, appState: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: file, sessionId: 'fixture-id', name: 'Retained draft' }], active: file },
  }, nativeDrafts: { [`file:${file}`]: { draft: 'Preserved after unknown deletion' } } });
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
    const allOrder = visible();
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
    assert.equal(choices.length, 3);
    assert.deepEqual([...choices].map(choice => choice.querySelector('time')!.dateTime), allOrder.map(row => row.querySelector('time')!.dateTime), 'Switch uses All order even while Unread shows arrival order');
    choices[0].click(); await f.tick();
    assert.deepEqual(visible(), allOrder);
    assert.equal(f.element('sidebar-all').getAttribute('aria-selected'), 'true');
    assert.equal(rows[2].getAttribute('aria-current'), 'true');
    assert.equal(f.element('conversation').hidden, false);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 3);
    assert.equal(f.calls.filter(c => c.command === 'stop_pi').length, stops);
    assert.equal(f.calls.some(c => c.command === 'list_workspace_sessions'), false);
    f.element<HTMLButtonElement>('sidebar-all').click(); assert.deepEqual(visible(), allOrder); await f.tick();
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

test('notification clicks select exact open sessions, reveal filtered rows and reconnect disconnected history', async () => {
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
    // Selection via a valid notification reconnects the exact still-open saved session.
    first.onmessage({ kind: 'disconnected', message: 'fixture ended' }); await f.tick();
    f.rows()[1].click(); await f.tick();
    const starts = f.calls.filter(c => c.command === 'start_pi').length;
    f.notificationClick(target); await f.tick();
    assert.equal(firstRow.getAttribute('aria-current'), 'true');
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, starts + 1);
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
    assert.match(f.element('application-notices').textContent!, /Test notification submitted.*Could not read diagnostics.*fixture diagnostics unavailable/);
    assert.equal(f.element('launch-error').textContent, '');
    assert.equal(f.calls.filter(c => c.command === 'test_notification').length, 1);
    assert.equal(f.element<HTMLButtonElement>('notification-test').disabled, false);
  } finally { f.dom.window.close(); }
});

test('native notification timeouts can be dismissed in Settings without retrying or affecting the session', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', notificationError: 'macOS notification settings lookup timed out; nothing will be retried' });
  try {
    f.openSettings(); f.element<HTMLButtonElement>('notification-test').click(); await f.tick();
    assert.equal(f.element('notification-status').textContent, '');
    const strip = f.element('application-notices');
    assert.match(strip.textContent!, /macOS notification settings lookup timed out/);
    assert.equal(f.element<HTMLButtonElement>('notification-test').disabled, false);
    const callsBeforeDismiss = f.calls.length;
    strip.querySelector<HTMLButtonElement>('button[data-dismiss]')!.click(); await f.tick();
    assert.equal(strip.hidden, true);
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(f.calls.length, callsBeforeDismiss, 'dismissal must not invoke native operations or retry');
  } finally { f.dom.window.close(); }
});

test('global auto-follow saves and synchronizes without moving readers or restarting sessions', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  const global = await fixture(undefined, { globalSettings: true });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const pane = f.element('transcript-viewport');
    pane.scrollTop = 200; pane.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: -50 }));
    const before = f.calls.filter(c => ['start_pi', 'stop_pi', 'write_pi'].includes(c.command)).length;
    f.openSettings();
    assert.equal(f.element('settings-send-auto-follow').hidden, true);
    assert.equal(f.element('settings-zoom').hidden, true);
    const picker = global.element<HTMLSelectElement>('send-auto-follow');
    assert.equal(picker.value, 'whenIdle');
    picker.value = 'never'; picker.dispatchEvent(new global.win.Event('change')); await global.tick();
    assert.equal(parseSettings(global.preferences.value.text)['appearance.autoFollowAfterSending'], 'never');
    f.preferences.external(global.preferences.value.text);
    assert.equal(JSON.parse(f.preferences.value.projectText!)['appearance.autoFollowAfterSending'], undefined);
    assert.equal(f.element<HTMLSelectElement>('send-auto-follow').value, 'never');
    assert.equal(picker.disabled, false);
    global.preferences.external('{"appearance.autoFollowAfterSending":"always"}');
    f.preferences.external(global.preferences.value.text);
    assert.equal(picker.value, 'always');
    assert.equal(f.element<HTMLSelectElement>('send-auto-follow').value, 'always');
    assert.equal(pane.scrollTop, 200);
    assert.equal(f.calls.filter(c => ['start_pi', 'stop_pi', 'write_pi'].includes(c.command)).length, before);
    global.preferences.external('{"appearance.autoFollowAfterSending":"invalid"}');
    assert.equal(picker.value, 'always', 'invalid global edits retain the last valid setting');
    global.preferences.external('{}');
    assert.equal(picker.value, 'whenIdle');
    global.preferences.settings = async () => { throw new Error('Fixture save failure'); };
    picker.value = 'never'; picker.dispatchEvent(new global.win.Event('change')); await global.tick();
    assert.equal(picker.value, 'whenIdle', 'failed saves restore the committed value');
    assert.equal(picker.disabled, false);
    assert.match(global.element('application-notices').textContent!, /Fixture save failure/);
    const projectBefore = f.preferences.value.projectText;
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: '+', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick();
    assert.equal(f.preferences.value.projectText, projectBefore);
    assert.equal(parseSettings(f.preferences.value.text)['appearance.zoom'], 150);
  } finally { global.win.close(); f.dom.window.close(); }
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

test('new-session commands remain available while another project reviews deletion', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  const key = (altKey = false, shiftKey = false) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'n', metaKey: true, altKey, shiftKey, bubbles: true, cancelable: true }));
  try {
    f.deletionEvent({ id: 'other-project', phase: 'begin', files: [], results: [], pending: true }); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('deletion-review').open, false);
    assert.equal(f.element<HTMLButtonElement>('sidebar-new').disabled, false);
    key(); await f.tick(); await f.tick();
    key(true); await f.tick(); await submitSessionName(f, 'During review');
    key(false, true); await f.tick(); await f.tick();
    await chooseNamedSession(f); await submitSessionName(f, 'Palette during review');
    const starts = f.calls.filter(c => c.command === 'start_pi');
    assert.equal(starts.length, 4);
    assert.deepEqual(starts.map(c => (c.args.config as JsonRecord).mode), ['saved', 'saved', 'temporary', 'saved']);
    assert.equal((starts[1].args.config as JsonRecord).sessionName, 'During review');
    assert.equal((starts[3].args.config as JsonRecord).sessionName, 'Palette during review');
    f.deletionEvent({ id: 'other-project', phase: 'release', files: [], results: [], pending: false }); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 4, 'release does not replay commands');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.dom.window.close(); }
});

test('deletion beginning during session naming does not prevent submission', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    await chooseNamedSession(f);
    f.deletionEvent({ id: 'other-project', phase: 'begin', files: [], results: [], pending: true }); await f.tick();
    await submitSessionName(f, 'Started during review');
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.rows().length, 1);
  } finally { f.dom.window.close(); }
});

test('pending deletion leaves unrelated Resume, Restart and Close available', async () => {
  const file = '/sessions/unrelated.jsonl';
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog: [{ path: file, sessionId: 'fixture-id', name: 'Unrelated', modified: 1 }] });
  const key = (value: string) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: value, metaKey: true, bubbles: true, cancelable: true }));
  try {
    f.deletionEvent({ id: 'other-project', phase: 'lock', files: ['/sessions/affected.jsonl'], results: [], pending: true }); await f.tick();
    key('k'); await f.tick();
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal((f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord).sessionFile, file);
    assert.equal(f.element<HTMLButtonElement>('restart-session').disabled, false);
    key('r'); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 2);
    key('w'); await f.tick(); await f.tick();
    assert.equal(f.rows().length, 0);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.dom.window.close(); }
});

test('a cached Resume row deleted after discovery reports an error without launching or replacing history', async () => {
  const file = '/sessions/stale.jsonl';
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog: [{ path: file, sessionId: 'fixture-id', name: 'Stale history', modified: 1 }] });
  try {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true })); await f.tick();
    assert.match(f.element('palette-list').textContent!, /Stale history/);
    f.deletionEvent({ id: 'deleted-elsewhere', phase: 'complete', files: [file], results: [{ file, deleted: true }], pending: false }); await f.tick();
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    assert.match(f.element('application-notices').textContent!, /selected session was deleted/);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    assert.equal(f.rows().length, 0);
  } finally { f.dom.window.close(); }
});

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
    assert.match(f.element('session-notices').textContent!, /Pi did not confirm the selected session name/);
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
      if (windowWorkspace) {
        assert.equal(f.element('project-name').textContent, 'project');
        assert.equal(f.element('workspace-label').textContent, '/');
        assert.equal(f.element('project-identity').title, windowWorkspace);
      }
    } finally { release(); f.dom.window.close(); }
  }
});

test('project bar identifies the directory, abbreviates home and keeps branding on welcome', async () => {
  for (const [windowWorkspace, name, parent] of [
    ['/Users/fixture/Projects/nimrod', 'nimrod', '~/Projects'],
    ['/Users/fixture/project', 'project', '~'],
    ['/Users/fixture-other/project', 'project', '/Users/fixture-other'],
    ['/', '/', ''],
  ]) {
    const f = await fixture(undefined, { windowWorkspace, homeDirectory: '/Users/fixture' });
    try {
      assert.equal(f.element('project-name').textContent, name);
      assert.equal(f.element('workspace-label').textContent, parent);
      assert.equal(f.element('project-identity').title, windowWorkspace);
      assert.equal(f.element('workspace-bar').querySelector('.wordmark'), null);
      assert.match(f.element('welcome').querySelector('.wordmark')!.textContent!, /nimrod/);
      assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    } finally { f.dom.window.close(); }
  }
});

test('project bar follows the displayed session even with the sidebar collapsed', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    const identity = f.element('project-session'), name = f.element('project-session-name');
    assert.equal(identity.hidden, true);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    assert.equal(identity.hidden, false);
    assert.equal(name.textContent, 'Temporary session');
    const first = f.captureChannel();
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    assert.equal(name.textContent, 'Session');
    f.element<HTMLButtonElement>('toggle-sidebar').click();
    assert.equal(f.element('session-sidebar').hidden, true);
    assert.equal(identity.hidden, false);
    first.onmessage({ kind: 'rpc', value: { type: 'agent_start' } }); await f.tick();
    assert.equal(name.textContent, 'Session', 'background updates preserve the displayed identity');
    f.rows()[0].click();
    assert.equal(name.textContent, 'Temporary session');
    assert.equal(identity.title, 'Temporary session');
    f.element<HTMLButtonElement>('sidebar-working').click();
    assert.equal(identity.hidden, false);
    first.onmessage({ kind: 'rpc', value: { type: 'agent_end' } }); await f.tick();
    assert.equal(identity.hidden, false, 'agent_end does not settle the displayed session');
    first.onmessage({ kind: 'rpc', value: { type: 'agent_settled' } }); await f.tick();
    assert.equal(identity.hidden, false, 'Working retains the selected settled session');
    assert.equal(name.textContent, 'Temporary session');
    f.element<HTMLButtonElement>('sidebar-all').click();
    f.element<HTMLButtonElement>('sidebar-working').click();
    assert.equal(identity.hidden, true, 'empty filtered views have no stale session identity');
    assert.equal(name.textContent, '');
    f.element<HTMLButtonElement>('sidebar-all').click();
    assert.equal(identity.hidden, false);
    assert.equal(name.textContent, 'Temporary session');
  } finally { f.win.close(); }
});

test('failed workspace initialization shows the error without flashing welcome', async () => {
  const f = await fixture(undefined, { windowWorkspaceError: 'fixture startup failure' });
  try {
    assert.equal(f.element('welcome').hidden, true);
    assert.match(f.element('application-notices').textContent!, /fixture startup failure/);
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
  const f = await fixture(undefined, { windowWorkspace: '/project' });
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
    assert.equal(f.element('preferences-error').hidden, true);
    assert.equal(f.element('application-notices').hidden, false);
    assert.equal(f.element<HTMLSelectElement>('theme-picker').value, 'dracula');
    assert.equal(pi.value, '/unsaved/pi');
    f.preferences.external('{"appearance.theme":"dracula","appearance.zoom":150,"runtime.piPath":"/external/pi","runtime.nodePath":"/external/node"}');
    assert.equal(f.element('preferences-error').hidden, true);
    f.back(); f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const config = f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord;
    assert.equal(config.pi, '/external/pi'); assert.equal(config.node, '/external/node');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('project shell boots without Pi and Settings holds layered preferences, not session controls', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' }); const { win, calls, element } = f;
  try {
    assert.ok(calls.some(c => c.command === 'scoped_preferences_snapshot'));
    assert.ok(calls.some(c => c.command === 'runtime_defaults'));
    assert.equal(calls.some(c => c.command === 'start_pi' || c.command === 'write_pi'), false);
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
    assert.equal(JSON.parse(f.preferences.value.projectText!)['appearance.theme'], 'dracula');
    // Even a synthetic launch request while Settings is open cannot start a process.
    element<HTMLButtonElement>('start-temporary').click();
    assert.equal(calls.filter(c => c.command === 'start_pi').length, 0);
    f.back();
    const demo = element<HTMLButtonElement>('start-temporary');
    assert.equal(demo.disabled, false); demo.click(); await f.tick(); await f.tick();
    assert.equal(element('welcome').hidden, true); assert.equal(element('conversation').hidden, false);
    assert.equal((calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord).mode, 'temporary');
    const prompt = element<HTMLTextAreaElement>('prompt');
    prompt.value = 'hello'; prompt.dispatchEvent(new win.Event('input'));
    prompt.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); assert.equal(prompt.value, '');
    assert.equal(calls.filter(c => (c.args.message as JsonRecord | undefined)?.type === 'prompt').length, 1);
    f.disconnect(); await f.tick(); assert.equal(element<HTMLButtonElement>('send').disabled, true);
  } finally { f.dom.window.close(); }
});

test('tool output chunks leave unchanged sidebar, status rows and bookkeeping alone', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    f.emit({ type: 'agent_start' });
    f.emit({ type: 'tool_execution_start', toolCallId: 'stream', toolName: 'bash', args: { command: 'stream' } });
    f.emit({ type: 'tool_execution_update', toolCallId: 'stream', toolName: 'bash', partialResult: { content: [{ type: 'text', text: 'initial' }] } });
    await f.tick();
    let mutations = 0;
    const observer = new f.win.MutationObserver(records => { mutations += records.length; });
    for (const node of [f.element('open-sessions'), f.element('activity')]) observer.observe(node, { subtree: true, childList: true, attributes: true, characterData: true });
    const calls = f.calls.length;
    for (let i = 0; i < 50; i++) f.emit({ type: 'tool_execution_update', toolCallId: 'stream', toolName: 'bash', partialResult: { content: [{ type: 'text', text: `initial ${i}` }] } });
    // Collect records before the observer callback consumes them.
    assert.equal(observer.takeRecords().length, 0, 'ordered delivery performs no shell DOM work');
    await f.tick();
    mutations += observer.takeRecords().length;
    assert.equal(mutations, 0, 'painting output does not rebuild status rows');
    assert.equal(f.calls.length, calls, 'no unrelated IPC or bookkeeping writes');
    assert.match(f.win.document.querySelector('.tool-card')!.textContent!, /initial 49/);
    observer.disconnect(); f.disconnect();
  } finally { f.dom.window.close(); }
});

test('Settings preserves a live conversation and saving paths does not mutate its launch', async () => {
  const f = await fixture(); const { win, element, calls } = f;
  try {
    element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
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
    win.dispatchEvent(new win.KeyboardEvent('keydown', { key: ',', metaKey: true, shiftKey: true, cancelable: true }));
    assert.equal(element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(element('conversation').hidden, false);
    element<HTMLInputElement>('pi-path').value = '/new/pi'; element<HTMLInputElement>('node-path').value = '/new/node';
    element('runtime-settings').dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await f.tick();
    assert.equal(JSON.parse(f.preferences.value.projectText!)['runtime.piPath'], '/new/pi');
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
    f.element<HTMLButtonElement>('start-temporary').click();
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
    assert.equal(config.mode, 'saved'); assert.equal('demo' in config, false);
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

test('resume last is explicit, restores history and editable draft without retired submission recovery', async () => {
  const last = { path: '/sessions/exact.jsonl', cwd: '/project', sessionId: 'fixture-id' };
  const f = await fixture(undefined, { appState: { 'nimrod.last-session.v1': last }, nativeDrafts: {
    [`file:${last.path}`]: { draft: 'newer draft', submission: { id: 'old-send', text: 'possibly accepted', mode: 'steer', status: 'pending' } },
    'file:/sessions/other.jsonl': { draft: 'other conversation' },
  }, history: [{ role: 'user', content: 'restored history', timestamp: 1 }] });
  try {
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
    assert.equal(f.element('resume-last').hidden, false);
    f.element<HTMLButtonElement>('resume-last').click(); await f.confirm();
    const config = f.calls.find(c => c.command === 'start_pi')!.args.config as JsonRecord;
    assert.equal(config.mode, 'resume'); assert.equal(config.sessionFile, last.path); assert.equal(config.sessionId, last.sessionId);
    assert.match(f.element('messages').textContent!, /restored history/);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'newer draft');
    assert.equal(f.saved().drafts[`file:${last.path}`].submission, undefined);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    assert.doesNotMatch(f.element('session-notices').textContent!, /did not confirm/i);
    assert.equal(f.calls.filter(c => (c.args.message as JsonRecord)?.type === 'prompt').length, 0);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('resume picker cancellation starts nothing and identity mismatch disables submission', async () => {
  const catalog = [{ path: '/sessions/exact.jsonl', sessionId: 'fixture-id', name: 'Selected history', preview: '', modified: 1 }];
  const canceled = await fixture(undefined, { windowWorkspace: '/project', catalog });
  try {
    canceled.win.dispatchEvent(new canceled.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await canceled.tick();
    canceled.element<HTMLInputElement>('palette-input').dispatchEvent(new canceled.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await canceled.tick();
    assert.equal(canceled.calls.some(c => c.command === 'start_pi'), false);
  } finally { canceled.dom.window.close(); }
  const f = await fixture(undefined, { windowWorkspace: '/project', catalog, state: () => ({ sessionFile: '/sessions/wrong.jsonl', sessionId: 'wrong-id' }) });
  try {
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick();
    f.element<HTMLInputElement>('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(f.element('welcome').hidden, true);
    assert.match(f.element('session-notices').textContent!, /exact selected session/);
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
    assert.deepEqual(f.saved().drafts, {}, 'temporary editor updates never write the saved draft library');
    assert.equal(JSON.parse(f.win.localStorage.getItem('nimrod.poc.composer')!).draft, 'legacy', 'legacy recovery remains intact without an unrelated migration write');
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('temporary Close discards runtime state only after confirmation and successful owned shutdown', async () => {
  for (const start of ['start-temporary']) {
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
  const f = await fixture(undefined, { startError: 'Session file unavailable', appState: { 'nimrod.last-session.v1': last }, nativeDrafts: { [`file:${last.path}`]: { draft: 'keep me' } } });
  try {
    f.element<HTMLButtonElement>('resume-last').click(); await f.confirm();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.calls.filter(c => c.command === 'write_pi').length, 0);
    assert.match(f.element('session-notices').textContent!, /Session file unavailable/);
    assert.equal(f.saved().drafts[`file:${last.path}`].draft, 'keep me');
    assert.deepEqual(f.saved().last, last);
    assert.equal(f.element('welcome').hidden, true);
    assert.match(f.element('session-notices').textContent!, /Session file unavailable/);
  } finally { f.dom.window.close(); }
});

test('legacy drafts are ignored without deleting their localStorage source', async () => {
  const legacy = { draft: 'legacy text', submission: { id: 'legacy', text: 'legacy text', mode: 'steer', status: 'pending' } };
  const f = await fixture(undefined, { storage: { 'nimrod.poc.composer': legacy } });
  try {
    assert.equal(f.element('recover-draft').hidden, true);
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, '');
    assert.deepEqual(f.saved().drafts, {});
    assert.deepEqual(JSON.parse(f.win.localStorage.getItem('nimrod.poc.composer')!), legacy);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
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

test('Project bar restart stays disabled for no session, temporary sessions and an unverified first save', async () => {
  let saved = false;
  const f = await fixture(undefined, { fileExists: () => saved });
  try {
    const restart = f.element<HTMLButtonElement>('restart-session');
    assert.equal(restart.disabled, true);
    assert.equal(restart.getAttribute('aria-label'), 'Restart session');
    assert.equal(restart.querySelector('svg')?.getAttribute('aria-hidden'), 'true');
    assert.equal(restart.textContent, '');
    for (const id of ['start-temporary']) {
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
    assert.deepEqual({ ...(launches[2].args.config as JsonRecord) }, { cwd: '/project', pi: '/bin/pi', node: '/bin/node', mode: 'resume', sessionName: undefined, sessionFile: '/sessions/new-1.jsonl', sessionId: 'fixture-id' });
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

test('restart confirmation can cancel, serializes shutdown, preserves newer draft and ignores late old receipts', async () => {
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
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission, undefined);
    oldChannel.onmessage({ kind: 'rpc', value: { type: 'response', id: oldRequest.id, success: true } });
    oldChannel.onmessage({ kind: 'rpc', value: { type: 'message_start', message: { role: 'assistant', content: 'Stale output' } } });
    await f.tick();
    assert.equal(prompt.value, 'Newer draft');
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission, undefined);
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
    assert.match(f.element('session-notices').textContent!, /Could not restart Pi.*fixture shutdown failure/);
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
    assert.match(f.element('session-notices').textContent!, /Session file unavailable/);
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
    search.value = 'open recent project'; search.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('palette-list').children.length, 1);
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
      { path: '/sessions/closed.jsonl', sessionId: 'fixture-id', name: 'Closed root', preview: 'Historical preview', modified: 10, lastUserMessageAt: 5 },
      { path: '/sessions/agent.jsonl', sessionId: 'agent', name: 'Subagent', preview: '', modified: 50, parentSession: '/sessions/a.jsonl' },
      { path: '/sessions/fork.jsonl', sessionId: 'fork', name: 'Saved branch', preview: '', modified: 40, parentSession: '/sessions/a.jsonl' },
    ],
  });
  const key = (key: string) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }));
  const escape = () => f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  const pickerRows = () => [...f.element('palette-list').children] as HTMLElement[];
  const isOpen = (row: HTMLElement) => row.getAttribute('aria-label')!.endsWith(' — Open');
  try {
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1, 'only the selected restored entry connects');
    f.element<HTMLButtonElement>('sidebar-unread').click();
    key('k'); await f.tick(); await f.tick();
    assert.deepEqual(pickerRows().map(row => row.querySelector('.palette-item-label')!.textContent), ['Selected root', 'Inactive root', 'Closed root']);
    assert.deepEqual(pickerRows().map(isOpen), [true, true, false]);
    assert.equal(f.element('palette-list').querySelectorAll('.session-row-badge').length, 0);
    assert.equal(f.element('palette-list').querySelectorAll('.picker-enter-hint').length, 3);
    for (const [index, option] of pickerRows().slice(0, 2).entries()) {
      const sidebar = f.rows()[index];
      assert.equal(option.querySelector('.session-row-label')!.textContent, sidebar.querySelector('.session-row-label')!.textContent);
      assert.equal(option.querySelector('small')!.innerHTML.replace(/id="[^"]*"/g, ''), sidebar.querySelector('small')!.innerHTML.replace(/id="[^"]*"/g, ''));
      assert.equal(option.querySelector('.session-indicator')!.outerHTML, sidebar.querySelector('.session-indicator')!.outerHTML);
      assert.equal(option.getAttribute('aria-label'), `${sidebar.getAttribute('aria-label')} — Open`);
      assert.equal(option.getAttribute('aria-describedby'), `${option.querySelector('time')!.id} ${option.querySelector('.session-row-harness')!.id}`);
      assert.equal(option.title, '');
    }
    assert.equal(pickerRows()[2].querySelector('time')!.getAttribute('datetime'), new Date(5).toISOString(), 'closed history uses user-message time, not mtime');
    assert.equal(pickerRows()[2].querySelector('.session-indicator')!.getAttribute('data-state'), 'closed');
    assert.equal(pickerRows()[2].querySelector('.session-indicator')!.textContent, '—');
    assert.doesNotMatch(pickerRows()[2].textContent!, /Historical preview/);
    const search = f.element<HTMLInputElement>('palette-input');
    search.value = 'Historical preview closed.jsonl'; search.dispatchEvent(new f.win.Event('input'));
    assert.equal(pickerRows().length, 1, 'hidden preview and path remain searchable');
    search.value = ''; search.dispatchEvent(new f.win.Event('input'));
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
      assert.equal(option.getAttribute('aria-describedby'), `${option.querySelector('time')!.id} ${option.querySelector('.session-row-harness')!.id}`);
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
    assert.equal(isOpen(pickerRows()[0]), true, 'disconnect does not close the session');
    escape(); assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    f.rows()[1].closest('.open-session')!.querySelector<HTMLButtonElement>('.session-close')!.click(); await f.tick(); await f.tick();
    key('k'); await f.tick(); await f.tick();
    assert.deepEqual(pickerRows().map(isOpen), [true, false, false], 'Close changes membership, not saved history');
    assert.equal(pickerRows()[1].querySelector('.session-indicator')!.getAttribute('data-state'), 'closed');
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

test('the selected restored tab loads its editable draft without replaying a retired submission', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
    'nimrod.tabs.v1:/project': { tabs: [{ path: '/sessions/a.jsonl', sessionId: 'fixture-id', name: 'Earlier work' }], active: '/sessions/a.jsonl' },
  }, nativeDrafts: { 'file:/sessions/a.jsonl': { draft: 'retained', submission: { id: 'old', text: 'uncertain', mode: 'steer', status: 'pending' } } } });
  try {
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'start_pi').length, 1);
    assert.equal(f.win.document.querySelectorAll('#open-sessions .session-row').length, 1);
    assert.equal(f.element<HTMLTextAreaElement>('prompt').value, 'retained');
    assert.equal(f.saved().drafts['file:/sessions/a.jsonl'].submission, undefined);
    assert.equal(f.element<HTMLButtonElement>('send').disabled, false);
    assert.equal(f.win.document.querySelector('.tab-notice button'), null);
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    f.disconnect();
  } finally { f.dom.window.close(); }
});

test('a background extension dialog is labeled and replies only to its originating session', async () => {
  const f = await fixture();
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const first = [...f.sessions.entries()][0];
    f.openPalette();
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'new temporary session'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick(); await f.tick();
    const secondPrompt = f.element('prompt');
    first[1].channel.onmessage({ kind: 'rpc', value: { type: 'extension_ui_request', method: 'input', id: 'question', title: 'Need input' } });
    await f.tick();
    assert.match(f.element('host-dialog-title').textContent!, /Temporary session — Need input/);
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
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
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

test('MCP inspector routes palette and composer entries to the same session without status notices', async () => {
  const f = await fixture(undefined, { mcpReport: 'ado: connected, 40 tools (codemode)\nplaywright: failed (codemode)\n    spawn playwright ENOENT' });
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Keep this draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'P', metaKey: true, shiftKey: true, cancelable: true }));
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'MCP servers'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(f.element('palette-title').textContent, 'MCP servers');
    assert.match(f.element('palette-inspection').textContent!, /playwright.*failed/s);
    assert.match(f.element('palette-inspection').textContent!, /ENOENT/);
    assert.equal(prompt.value, 'Keep this draft');
    assert.equal(f.element('session-notices').hidden, true);
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    assert.equal(f.win.document.activeElement, prompt);
    prompt.value = '/mcp'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(prompt.value, '/mcp ', 'first Enter accepts the slash suggestion without executing it');
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt').length, 1);
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(prompt.value, '');
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    assert.equal(f.element('session-notices').hidden, true);
    const prompts = f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt');
    assert.equal(prompts.length, 2);
    assert.ok(prompts.every(call => (call.args.message as JsonRecord).message === '/mcp'));
    f.disconnect(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
  } finally { f.win.close(); }
});

test('model apply failure after picker acceptance remains session-local and preserves the draft', async () => {
  const f = await fixture(undefined, { modelFixture: true, modelChangeError: 'Fixture model change rejected' });
  try {
    f.element<HTMLButtonElement>('start-temporary').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Keep draft'; prompt.focus();
    f.element<HTMLButtonElement>('model').click(); await f.tick();
    f.element('palette-input').dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false);
    assert.match(f.element('messages').querySelector('.operation-diagnostics')!.textContent!, /Fixture model change rejected/);
    assert.equal(f.element('messages').querySelector<HTMLElement>('.configuration')!.dataset.operationState, 'failed');
    assert.equal(f.element('session-notices').hidden, true);
    assert.equal(f.element('application-notices').hidden, true);
    assert.equal(prompt.value, 'Keep draft'); assert.equal(f.win.document.activeElement, prompt);
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'set_model').length, 1);
    assert.equal(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'prompt'), false);
  } finally { f.win.close(); }
});

test('brand-new unwritten session can select its first model and effort through the palette', async () => {
  const f = await fixture(undefined, { modelFixture: true, fileExists: () => false });
  try {
    f.element<HTMLButtonElement>('start-pi').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Unsent draft'; prompt.dispatchEvent(new f.win.Event('input'));
    assert.equal(f.element('mode-badge').textContent, 'Pi · awaiting first save');
    f.element<HTMLButtonElement>('thinking').click(); await f.tick();
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, false, 'failed session picker returns to its owning conversation');
    assert.match(f.element('session-notices').textContent!, /Select a model/);
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
    assert.equal(f.element('palette-list').querySelector('[aria-current=true] .palette-selection-marker')!.textContent, '•');
    input.value = 'high'; input.dispatchEvent(new f.win.Event('input')); key('Enter'); await f.tick(); await f.tick();
    assert.equal(f.element('thinking').textContent, 'high');
    assert.equal(prompt.value, 'Unsent draft');
    assert.equal(f.calls.some(c => (c.args.message as JsonRecord)?.type === 'prompt'), false);
    assert.equal(f.saved().last, undefined);
    f.disconnect();
  } finally { f.dom.window.close(); }
});


test('native material rebuild failures are window/request scoped and do not replay appearance', async () => {
  const f = await fixture(undefined, { globalSettings: true, windowLabel: 'settings' });
  try {
    const prefs = (blur: number) => f.preferences.external(JSON.stringify({ 'appearance.backgroundOpacity': 60, 'appearance.backgroundBlur': blur }));
    prefs(7); await f.tick(); await f.tick();
    const apply = () => f.calls.filter(call => call.command === 'apply_window_appearance');
    const request = String(apply().at(-1)!.args.request);
    assert.ok(request.length > 0);
    f.nativeBlurFailure({ request, message: 'Other window material failure' }, 'other-window');
    f.nativeBlurFailure({ request: 'obsolete-request', message: 'Obsolete material failure' }, 'settings');
    await f.tick();
    assert.doesNotMatch(f.element('application-notices').textContent!, /material failure/);
    f.nativeBlurFailure({ request, message: 'Native material rebuild failed; using plain transparency' }, 'settings');
    await f.tick();
    assert.match(f.element('application-notices').textContent!, /Native material rebuild failed/);
    const count = apply().length;
    prefs(7); await f.tick(); await f.tick();
    assert.equal(apply().length, count, 'an unchanged preference broadcast does not retry');
    assert.match(f.element('application-notices').textContent!, /Native material rebuild failed/);
    prefs(20); await f.tick(); await f.tick();
    assert.notEqual(apply().at(-1)!.args.request, request);
    f.nativeBlurFailure({ request, message: 'Late old material failure' }, 'settings'); await f.tick();
    assert.doesNotMatch(f.element('application-notices').textContent!, /material failure|rebuild failed/i);
    const current = String(apply().at(-1)!.args.request);
    f.win.dispatchEvent(new f.win.Event('unload'));
    f.nativeBlurFailure({ request: current, message: 'Disposed material failure' }, 'settings'); await f.tick();
    assert.doesNotMatch(f.element('application-notices').textContent!, /Disposed material/);
  } finally { f.win.close(); }
});

test('a material callback preceding its command reply is not cleared by that reply', async () => {
  const f = await fixture(undefined, { globalSettings: true, appearanceApply: async (args, fail) => {
    if (args.blur === 7) fail({ request: String(args.request), message: 'Layer failed before reply' });
  } });
  try {
    f.preferences.external('{"appearance.backgroundOpacity":60,"appearance.backgroundBlur":7}');
    await f.tick(); await f.tick();
    assert.match(f.element('application-notices').textContent!, /Layer failed before reply/);
  } finally { f.win.close(); }
});

test('failure to observe native material rebuilds disables blur without disabling transparency', async () => {
  const f = await fixture(undefined, { globalSettings: true, appearanceObserverError: 'Fixture material observer unavailable' });
  try {
    f.preferences.external('{"appearance.backgroundOpacity":60,"appearance.backgroundBlur":20}');
    await f.tick(); await f.tick();
    assert.equal(f.element('settings-background-blur').hidden, true);
    assert.equal(f.win.document.documentElement.dataset.translucency, 'window');
    assert.match(f.element('application-notices').textContent!, /Fixture material observer unavailable/);
    assert.ok(f.calls.filter(call => call.command === 'apply_window_appearance').every(call => call.args.blur === 0));
  } finally { f.win.close(); }
});

test('global Appearance exposes native-supported controls and applies immediately across preference snapshots', async () => {
  const f = await fixture(undefined, { globalSettings: true });
  try {
    await f.tick();
    assert.equal(f.element('settings-translucency').hidden, false);
    assert.equal(f.element('settings-background-blur').hidden, false);
    const slider = f.element<HTMLInputElement>('background-opacity');
    const writes = f.calls.filter(call => call.command === 'preferences_settings').length;
    slider.value = '60'; slider.dispatchEvent(new f.win.Event('input', { bubbles: true }));
    assert.equal(f.win.document.documentElement.dataset.translucency, 'window');
    assert.equal(f.calls.filter(call => call.command === 'preferences_settings').length, writes);
    slider.dispatchEvent(new f.win.Event('change', { bubbles: true })); await f.tick(); await f.tick();
    assert.equal(parseSettings(f.preferences.value.text)['appearance.backgroundOpacity'], 60);
    f.preferences.external('{"appearance.backgroundOpacity":70,"appearance.translucencyArea":"chrome"}'); await f.tick();
    assert.equal(f.win.document.documentElement.dataset.translucency, 'window');
    assert.equal(f.win.document.querySelector('#translucency-area'), null);
    assert.equal(slider.value, '70');
    assert.equal(f.calls.some(call => ['start_pi', 'stop_pi', 'write_pi'].includes(call.command)), false);
  } finally { f.win.close(); }
});

test('Linux exposes menu replacements in the welcome palette and dispatches Open/Quit without agent work', async () => {
  const f = await fixture(undefined, { platform: 'Linux x86_64' });
  const key = (name: string, extra: KeyboardEventInit = {}) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: name, ctrlKey: true, bubbles: true, cancelable: true, ...extra }));
  try {
    key('p', { shiftKey: true });
    assert.equal(f.element<HTMLDialogElement>('command-palette').open, true);
    for (const label of ['Open project…', 'Quit Nimrod', 'Minimize window', 'Maximize / Restore window', 'Close window', 'About Nimrod']) assert.match(f.element('palette-list').textContent!, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const input = f.element<HTMLInputElement>('palette-input'); input.value = 'About Nimrod'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); await f.tick();
    key('o'); key('q'); await f.tick();
    assert.deepEqual(f.calls.filter(call => call.command === 'application_action').map(call => call.args.action), ['about', 'open-project', 'quit']);
    assert.equal(f.calls.some(call => ['start_pi', 'write_pi'].includes(call.command)), false);
    f.preferences.external('{"keybindings":{"quit":[],"open-project":[]}}'); await f.tick();
    key('q'); key('o'); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'application_action').length, 3);
  } finally { f.win.close(); }
});

test('Linux Quit is available in global Settings and reference windows without session teardown in JS', async () => {
  for (const options of [{ globalSettings: true }, { popout: { session: 'source', title: 'Source', text: 'reference', language: 'text' } }]) {
    const f = await fixture(undefined, { ...options, platform: 'Linux x86_64' });
    try {
      await f.tick();
      const before = f.calls.length;
      f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'q', ctrlKey: true, bubbles: true, cancelable: true })); await f.tick();
      assert.deepEqual(f.calls.slice(before).filter(call => call.command === 'application_action').map(call => call.args.action), ['quit']);
      assert.equal(f.calls.slice(before).some(call => ['stop_pi', 'stop_copilot', 'stop_acp'].includes(call.command)), false);
    } finally { f.win.close(); }
  }
});

test('Linux Appearance hides frosting and performs no native blur operations', async () => {
  const f = await fixture(undefined, { globalSettings: true, appearanceCapabilities: { platform: 'linux', transparency: true, frost: false, reducedTransparency: false } });
  try {
    await f.tick(); assert.equal(f.element('settings-background-blur').hidden, true);
    assert.match(f.element('translucency-hint').textContent!, /compositor/);
    f.preferences.external('{"appearance.backgroundOpacity":50,"appearance.theme":"dracula"}'); await f.tick(); await f.tick();
    assert.equal(f.win.document.documentElement.dataset.translucency, 'window');
    const tint = f.calls.filter(call => call.command === 'tint_window_titlebar').at(-1)!;
    assert.deepEqual(Array.from(tint.args.color as number[]), [40, 42, 54, 128]);
    assert.equal((tint.args.foreground as number[]).length, 4);
    assert.equal((tint.args.foreground as number[])[3], 255);
    assert.equal(f.calls.some(call => call.command === 'apply_window_appearance'), false);
  } finally { f.win.close(); }
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
    const code = f.win.document.querySelector('pre > code');
    for (const [theme, background] of [['tokyo-night', '#1a1b26'], ['osaka-jade', '#111c18']]) {
      f.preferences.external(JSON.stringify({ 'appearance.theme': theme })); await f.tick();
      assert.equal(f.win.document.documentElement.dataset.theme, theme);
      assert.equal(f.win.document.documentElement.style.getPropertyValue('--vscode-editor-background'), background);
      assert.equal(f.win.document.querySelector('pre > code'), code);
    }
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


test('palette command history restores app-wide, persists acceptance and does not count direct shortcuts', async () => {
  const key = 'nimrod.command-usage.v1';
  const f = await fixture(undefined, { windowWorkspace: '/project', appState: {
    [key]: { version: 1, entries: [{ id: 'resume', lastUsedAt: 1, useCount: 2 }] },
  } });
  try {
    f.openPalette(); assert.match(f.element('palette-list').firstElementChild!.textContent!, /Resume session/);
    const input = f.element<HTMLInputElement>('palette-input');
    input.value = 'sidebar'; input.dispatchEvent(new f.win.Event('input'));
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    const usage = f.preferences.value.state[key] as { entries: { id: string }[] };
    assert.deepEqual(usage.entries.map(e => e.id), ['sidebar', 'resume']);
    f.openPalette(); assert.match(f.element('palette-list').firstElementChild!.textContent!, /Show sidebar/);
    input.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await f.tick();
    f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    await f.tick();
    assert.equal(f.calls.filter(c => c.command === 'record_command_usage').length, 1);
    assert.equal(f.calls.some(c => c.command === 'start_pi'), false);
  } finally { f.win.close(); }
});


test('native draft persistence failure reports storage error but does not gate prompt dispatch', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project', draftFlushError: 'fixture disk failure' });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt');
    prompt.value = 'Do not lose this'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt').length, 1);
    assert.equal(prompt.value, '');
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission, undefined);
    assert.equal(f.element('queue-activity').querySelector('[data-recovery-id]'), null);
    assert.equal(f.element('storage-error').textContent, '');
    assert.equal(f.element('submission-notice').hidden, true);
    assert.match(f.element('application-notices').textContent!, /fixture disk failure/);
    assert.doesNotMatch(f.element('application-notices').textContent!, /Nothing was sent/);
    f.disconnect();
  } finally { f.dom.window.close(); }
});


test('native persistence never delays a steer, and finishing a flush after Stop never replays it', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(undefined, { windowWorkspace: '/project', draftFlushGate: gate });
  try {
    f.element<HTMLButtonElement>('sidebar-new').click(); await f.tick(); await f.tick();
    f.sessions.values().next().value!.channel.onmessage({ kind: 'rpc', value: { type: 'agent_start' } }); await f.tick();
    const prompt = f.element<HTMLTextAreaElement>('prompt'); prompt.value = 'Do not send'; prompt.dispatchEvent(new f.win.Event('input'));
    prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await f.tick();
    prompt.value = 'New draft'; prompt.dispatchEvent(new f.win.Event('input'));
    f.element<HTMLButtonElement>('send').click(); await f.tick();
    release(); await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => (call.args.message as JsonRecord)?.type === 'prompt').length, 1);
    assert.equal(prompt.value, 'New draft');
    assert.equal(f.saved().drafts['file:/sessions/new.jsonl'].submission, undefined);
    assert.ok(f.calls.some(call => (call.args.message as JsonRecord)?.type === 'clear_queue'));
    f.disconnect();
  } finally { release(); f.dom.window.close(); }
});

test('cold Settings reveals after appearance/tint/zoom but never waits for runtime discovery', async () => {
  let releaseAppearance!: () => void, releaseTitlebar!: () => void, releaseRuntime!: () => void;
  const appearanceGate = new Promise<void>(resolve => { releaseAppearance = resolve; });
  const titlebarGate = new Promise<void>(resolve => { releaseTitlebar = resolve; });
  const runtimeDefaultsGate = new Promise<void>(resolve => { releaseRuntime = resolve; });
  const f = await fixture(undefined, { globalSettings: true, appearanceGate, titlebarGate, runtimeDefaultsGate });
  try {
    f.win.history.replaceState(null, '', '?settings=appearance&settingsGeneration=fixture-ready');
    f.preferences.external('{"appearance.theme":"tokyo-night","appearance.backgroundOpacity":65,"appearance.frostedBackground":false}');
    await f.tick(); assert.equal(f.calls.some(call => call.command === 'settings_window_ready'), false);
    releaseAppearance(); await f.tick(); await f.tick();
    assert.ok(f.calls.some(call => call.command === 'tint_window_titlebar'));
    assert.equal(f.calls.some(call => call.command === 'settings_window_ready'), false);
    releaseTitlebar(); await f.tick(); await f.tick();
    const ready = f.calls.filter(call => call.command === 'settings_window_ready');
    assert.equal(ready.length, 1); assert.equal(ready[0].args.generation, 'fixture-ready');
    assert.equal(f.win.document.documentElement.dataset.translucency, 'window');
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(f.element<HTMLSelectElement>('zoom-level').value, '125');
    assert.equal(f.element<HTMLFieldSetElement>('runtime-fields').disabled, true);
    assert.ok(f.calls.findIndex(call => call.command === 'runtime_defaults') > f.calls.findIndex(call => call.command === 'settings_window_ready'));
    releaseRuntime(); await f.tick(); assert.equal(f.element<HTMLFieldSetElement>('runtime-fields').disabled, false);
    assert.equal(f.calls.some(call => ['start_pi', 'stop_pi', 'write_pi'].includes(call.command)), false);
  } finally { releaseAppearance(); releaseTitlebar(); releaseRuntime(); f.win.close(); }
});

test('appearance startup failure still reveals a readable Settings error without replaying presentation', async () => {
  const f = await fixture(undefined, { globalSettings: true, appearanceError: 'fixture native appearance failed' });
  try {
    await f.tick(); await f.tick();
    assert.equal(f.calls.filter(call => call.command === 'settings_window_ready').length, 1);
    assert.match(f.element('application-notices').textContent!, /fixture native appearance failed/);
  } finally { f.win.close(); }
});

test('closing cold Settings suppresses late readiness and native focus requests', async () => {
  let release!: () => void; const appearanceGate = new Promise<void>(resolve => { release = resolve; });
  const f = await fixture(undefined, { globalSettings: true, appearanceGate });
  try {
    f.win.dispatchEvent(new f.win.Event('unload')); release(); await f.tick(); await f.tick();
    assert.equal(f.calls.some(call => call.command === 'settings_window_ready'), false);
  } finally { release(); f.win.close(); }
});

test('global Settings boots without any project services', async () => {
  const f = await fixture(undefined, { globalSettings: true });
  try {
    await f.tick();
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, true);
    assert.equal(f.element('workspace-bar').hidden, true);
    assert.equal(f.element('settings-category-keybindings').hidden, false);
    assert.equal(f.element('settings-global-link').hidden, true);
    assert.equal(f.element('performance-capture').hidden, true);
    assert.equal(f.win.document.querySelector('.settings-source'), null);
    assert.equal(f.calls.some(call => ['start_pi', 'stop_pi', 'write_pi', 'drafts_load', 'sync_popout_sessions', 'load_personal_card_plugins'].includes(call.command)), false);
    const theme = f.element<HTMLSelectElement>('theme-picker');
    theme.value = 'dracula'; theme.dispatchEvent(new f.win.Event('change')); await f.tick();
    assert.equal(parseSettings(f.preferences.value.text)['appearance.theme'], 'dracula');
    assert.equal(f.calls.some(call => call.command === 'project_preferences_settings'), false);
  } finally { f.win.close(); }
});

test('project settings routes scope shortcuts and removes overrides rather than copying defaults', async () => {
  const f = await fixture(undefined, { windowWorkspace: '/project' });
  try {
    const shortcut = (shiftKey: boolean) => f.win.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: ',', metaKey: true, shiftKey, bubbles: true, cancelable: true }));
    shortcut(false);
    assert.ok(f.calls.some(call => call.command === 'open_global_settings'));
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, false);
    shortcut(true);
    assert.equal(f.element<HTMLDialogElement>('settings-page').open, true);
    assert.match(f.element('settings-title').textContent!, /Project settings — project/);
    const picker = f.element<HTMLSelectElement>('theme-picker');
    assert.equal(f.element('theme-picker-source').textContent, 'Global default');
    assert.equal([...picker.options].some(option => option.value === '$import'), false);
    picker.value = 'dracula'; picker.dispatchEvent(new f.win.Event('change')); await f.tick();
    assert.equal(f.element('theme-picker-source').textContent, 'Project override');
    f.preferences.external('{"appearance.theme":"tokyo-night"}'); await f.tick();
    assert.equal(picker.value, 'dracula');
    picker.nextElementSibling!.querySelector<HTMLButtonElement>('button')!.click(); await f.tick();
    assert.equal(picker.value, 'tokyo-night');
    assert.equal(f.element('theme-picker-source').textContent, 'Global default');
    assert.equal(JSON.parse(f.preferences.value.projectText!)['appearance.theme'], undefined);
    assert.equal(f.calls.some(call => call.command === 'start_pi' || call.command === 'write_pi'), false);
  } finally { f.win.close(); }
});
