import { expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { Packet } from '../../src/pi/transport';
import type { JsonRecord } from '../../src/pi/types';
import { MemoryPreferences } from '../preferences-fixture';
import { PROJECT_SETTING_KEYS, type PreferencesSnapshot } from '../../src/preferences';
import { parse } from 'jsonc-parser';
import type { DeletionEvent } from '../../src/session-deletion';

type TestWindow = Window & {
  __fixtureHost(command: string, args: JsonRecord): Promise<unknown>;
  __fixtureChannels: Record<string, { onmessage(packet: Packet): void }>;
  __fixtureSettled: number;
  __fixtureOpacityReceive?: (snapshot: { revision: number; opacity: number | null; blur: number | null }) => void;
  __fixturePreferenceReceive?: (snapshot: PreferencesSnapshot) => void;
  __fixtureDeletionReceive?: (event: DeletionEvent) => void;
  __fixtureNotificationClick?: (event: { session: string; token: string }) => void;
};
export const visible = (id: string) => `.session-view:not([hidden]) [data-pi-id="${id}"]`;

/** Real app bundle and independent offline demo children. Never starts Pi. */
export async function demoFixture(page: Page, appState: Record<string, unknown> = {}, catalog: { path: string; sessionId: string; name: string; preview: string; modified: number; lastUserMessageAt?: number }[] = [], typingOptions?: { drafts: Record<string, unknown>; persistent: boolean }, pluginOptions?: { settings: string; packages: Record<string, string>; personal?: () => Promise<import('../../src/pi/card-plugins/catalog').PersonalBundles> }, fixtureOptions?: { tool?: 'edit'; enforceCsp?: boolean; acpAgentName?: 'Copilot' }) {
  const result = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', platform: 'browser', write: false,
    loader: { '.css': 'empty' }, plugins: [{ name: 'raw', setup(builder) {
      builder.onResolve({ filter: /\.html\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const css = ['src/pi/transcript.css', 'src/theme.css', 'src/typography.css', 'src/range-input.css', 'src/workspace.css', 'src/keybindings.css', 'src/modal.css', 'src/application-notices.css', 'src/window-appearance.css', 'src/acp/session.css'].map(p => readFileSync(p, 'utf8')).join('\n');
  let html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '').replace('</head>', `<style>${css}</style></head>`);
  if (fixtureOptions?.enforceCsp) {
    const policy = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).app.security.csp as string;
    html = html.replace('<head>', `<head><meta http-equiv="Content-Security-Policy" content="${policy}">`);
  }
  const children = new Map<string, ChildProcessWithoutNullStreams>();
  let delivery = Promise.resolve();
  let closing = false;
  const errors: string[] = [];
  const calls: { command: string; args: JsonRecord }[] = [];
  let opacityPreview = { revision: 0, opacity: null as number | null, blur: null as number | null };
  const nativeDrafts = new Map(Object.entries(typingOptions?.drafts ?? {}).map(([key, value]) => [key, { key, value, revision: 1 }]));
  const preferences = new MemoryPreferences();
  if (pluginOptions) { preferences.value.text = pluginOptions.settings; preferences.value.state.legacyMigrated = true; }
  Object.assign(preferences.value.state, appState);
  page.on('pageerror', error => errors.push(String(error)));
  const send = (token: string, packet: Packet) => {
    if (closing) return;
    delivery = delivery.then(async () => {
      if (closing) return;
      await page.evaluate(({ token, packet }) => {
        const state = window as unknown as TestWindow;
        if (packet.kind === 'rpc' && packet.value.type === 'agent_settled') state.__fixtureSettled++;
        state.__fixtureChannels[token]?.onmessage(packet);
      }, { token, packet });
    }).catch(error => { if (!closing) errors.push(String(error)); });
  };
  async function stopChildren(token?: string) {
    for (const [id, child] of children) {
      if (token && token !== id) continue;
      if (child.exitCode === null && child.signalCode === null) await new Promise<void>(resolve => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
        child.once('exit', () => { clearTimeout(timer); resolve(); }); child.stdin.end();
      });
      children.delete(id);
    }
  }
  const host = async (command: string, args: JsonRecord) => {
    calls.push({ command, args });
    if (command === 'tint_window_titlebar' || command === 'settings_window_ready') return;
    if (command === 'installed_fonts') return [{ family: 'Courier New', monospace: true }, { family: 'Arial', monospace: false }];
    if (command === 'window_appearance_capabilities' || command === 'apply_window_appearance') return { platform: 'macos', transparency: true, frost: true, reducedTransparency: false };
    if (command === 'drafts_load') return [...nativeDrafts.values()];
    if (command === 'drafts_stage') { const record = args.record as { key: string; value: unknown; revision: number }; nativeDrafts.set(record.key, record); return; }
    if (command === 'drafts_flush') return;
    if (command === 'drafts_references') return [];
    if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 1;
    if (command === 'popup_session_menu') return; // Record native popup intent only; browser cannot render OS menus.
    if (command === 'scoped_preferences_snapshot') return preferences.snapshot();
    if (command === 'open_global_settings') { await openSettingsWindow(typeof args.category === 'string' ? args.category : undefined); return; }
    if (command === 'open_owned_project_settings') { await page.bringToFront(); return; }
    if (command === 'list_project_overrides') { const keys = Object.keys(parse(preferences.value.projectText ?? '{}')).filter(key => (PROJECT_SETTING_KEYS as readonly string[]).includes(key)); return keys.length ? [{ cwd: process.cwd(), keys }] : []; }
    if (command === 'take_project_settings_request' || command === 'take_settings_category') return false;
    if (command.startsWith('preferences_') || command === 'project_preferences_settings' || command === 'record_command_usage') return preferences.invoke(command, args);
    if (command === 'plugin:clipboard-manager|write_text' || command === 'open_card_link' || command === 'open_code_popout') return; // Recorded presentation actions, no OS side effects.
    if (command === 'load_personal_card_plugins') return pluginOptions?.personal?.() ?? { entries: [], plugins: [], warnings: [] };
    if (command === 'read_card_plugin_module') {
      const name = String(args.name); const manifestText = pluginOptions?.packages[name];
      // Native trust uses current settings, not the initial fixture options.
      const current = parse(preferences.value.text) as { 'cards.plugins'?: string[]; 'cards.trustedPlugins'?: string[] };
      if (!current['cards.plugins']?.includes(name) || !current['cards.trustedPlugins']?.includes(name)) throw new Error('Fixture package not trusted');
      if (manifestText !== args.expectedManifest) throw new Error('Fixture manifest changed');
      const entry = JSON.parse(manifestText!).entry as string;
      const source = pluginOptions?.packages[entry]; if (source === undefined) throw new Error('Fixture module missing');
      return source;
    }
    if (command === 'read_card_plugin') {
      const text = pluginOptions?.packages[String(args.name)];
      if (text === undefined) throw new Error('Fixture package missing');
      return text;
    }
    if (command === 'runtime_defaults') return { cwd: process.cwd(), node: process.execPath, pi: 'fixture-only' };
    if (command === 'take_project_picker_request') return false;
    if (command === 'list_projects') return (preferences.value.state['nimrod.workspaces.v1'] as string[] || []).map(cwd => ({ cwd, open: cwd === process.cwd() }));
    if (command === 'open_project_directory') return { cwd: args.cwd, current: false };
    if (command === 'plugin:dialog|open') return null; // Canceled chooser fixture only.
    if (command === 'window_workspace') return null;
    if (command === 'open_workspace') {
      preferences.value.projectPath = process.cwd() + '/.nimrod/settings.json'; preferences.value.projectText ??= '{}\n';
      return { cwd: process.cwd(), current: true };
    }
    if (command === 'sync_popout_sessions') return { warnings: [] };
    if (command === 'deletion_snapshot') return { pending: false, quarantine: [], files: [] };
    if (command === 'confirm_session_deletion' || command === 'acknowledge_deletion') return; // Recorded only, no native file deletion.
    if (command === 'plugin:window|is_focused') return true;
    if (command === 'transcript_logs_directory') return '/fixture/.local/state/nimrod/transcript-logs';
    if (command === 'append_transcript_logs') return; // Fixture-only: never writes user files.
    if (command === 'write_performance_report') return '/fixture/.local/state/nimrod/performance-captures/2026-10-14_12-00-00.000Z.json'; // Recorded only; never writes user files.
    if (command === 'prepare_notifications' || command === 'focus_notification_window') return;
    if (command === 'notification_diagnostics') return 'macOS: authorized; desktop alerts: enabled; style: temporary; Notification Center: enabled; app active: yes; foreground handler calls: 1 (requests Banner + List).';
    if (command === 'notify_session' || command === 'test_notification') return 'submitted'; // Recorded only: never emit real OS notifications.
    if (command === 'list_workspace_sessions') return { sessions: catalog, warnings: [] };
    if (command === 'start_copilot') {
      const token = String(args.token);
      if (children.has(token)) throw new Error('Duplicate offline SDK token');
      const child = spawn(process.execPath, ['--import', './test/fixtures/copilot-sdk-register.mjs', 'copilot/bridge.mjs', '/fixture/copilot', process.cwd()], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
      children.set(token, child);
      createInterface({ input: child.stdout }).on('line', line => {
        const value = JSON.parse(line);
        if (value.kind !== 'stopped') send(token, { kind: 'rpc', value });
      });
      child.stderr.on('data', chunk => errors.push(String(chunk)));
      child.on('error', error => errors.push(String(error)));
      child.on('exit', () => send(token, { kind: 'disconnected', message: 'Offline SDK fixture ended' }));
      return process.cwd();
    }
    if (command === 'write_copilot') {
      const child = children.get(String(args.token));
      if (!child?.stdin.writable) throw new Error('No writable SDK fixture');
      child.stdin.write(JSON.stringify(args.message) + '\n'); return;
    }
    if (command === 'stop_copilot') { await stopChildren(typeof args.token === 'string' ? args.token : undefined); return 'sdk-generation'; }
    if (command === 'start_acp') {
      const token = String(args.token);
      if (children.has(token)) throw new Error('Duplicate offline ACP token');
      const child = spawn(process.execPath, ['test/fixtures/acp-agent.mjs'], { cwd: process.cwd(), env: { ...process.env, NIMROD_ACP_FIXTURE_AGENT: fixtureOptions?.acpAgentName || 'fixture-agent' }, stdio: ['pipe', 'pipe', 'pipe'] });
      children.set(token, child);
      createInterface({ input: child.stdout }).on('line', line => send(token, { kind: 'rpc', value: JSON.parse(line) }));
      child.stderr.on('data', chunk => errors.push(String(chunk)));
      child.on('error', error => errors.push(String(error)));
      child.on('exit', () => send(token, { kind: 'disconnected', message: 'Offline ACP fixture ended' }));
      return process.cwd();
    }
    if (command === 'write_acp') {
      const child = children.get(String(args.token));
      if (!child?.stdin.writable) throw new Error('No writable ACP fixture');
      child.stdin.write(JSON.stringify(args.message) + '\n'); return;
    }
    if (command === 'stop_acp') { await stopChildren(typeof args.token === 'string' ? args.token : undefined); return; }
    if (command === 'start_pi') {
      const token = String(args.token);
      if ((args.config as JsonRecord)?.mode !== (typingOptions?.persistent ? 'saved' : 'temporary') || children.has(token)) throw new Error('Only independent offline fixture processes are allowed');
      const child = spawn(process.execPath, ['src-tauri/resources/demo.mjs'], { cwd: process.cwd(), env: { ...process.env, NIMROD_DEMO_TOOL: fixtureOptions?.tool ?? '' }, stdio: ['pipe', 'pipe', 'pipe'] });
      children.set(token, child);
      createInterface({ input: child.stdout }).on('line', line => send(token, { kind: 'rpc', value: JSON.parse(line) }));
      child.stderr.on('data', chunk => errors.push(String(chunk)));
      child.on('error', error => errors.push(String(error)));
      child.on('exit', () => send(token, { kind: 'disconnected', message: 'Offline fixture ended' }));
      return { cwd: process.cwd() };
    }
    if (command === 'write_pi') {
      const child = children.get(String(args.token));
      if (!child?.stdin.writable) throw new Error('No writable fixture');
      child.stdin.write(JSON.stringify(args.message) + '\n'); return;
    }
    if (command === 'stop_pi') { await stopChildren(typeof args.token === 'string' ? args.token : undefined); return; }
    if (command === 'plugin:webview|set_webview_zoom') return;
    throw new Error(`Unexpected native operation ${command}`);
  };
  if (typingOptions) await page.addInitScript(({ cwd, drafts }) => {
    localStorage.setItem(`nimrod.sessions.v1:${cwd}`, JSON.stringify({ version: 1, drafts }));
  }, { cwd: process.cwd(), drafts: typingOptions.drafts });
  const installHost = (global: boolean) => {
    const state = window as unknown as TestWindow;
    state.__fixtureSettled = 0; state.__fixtureChannels = {};
    const callbacks = new Map<number, (event: unknown) => void>();
    const preferenceCallbacks = new Set<number>();
    Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: global ? 'settings' : 'main' }, currentWebview: { label: global ? 'settings' : 'main' } },
      transformCallback: (callback: (event: unknown) => void) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; }, unregisterCallback: () => {},
      invoke: async (command: string, args: JsonRecord = {}) => {
        if (command === 'plugin:event|listen' && args.event === 'nimrod-preferences') {
          preferenceCallbacks.add(Number(args.handler));
          state.__fixturePreferenceReceive = payload => { for (const handler of preferenceCallbacks) callbacks.get(handler)?.({ payload }); };
        }
        if (command === 'plugin:event|listen' && args.event === 'nimrod-window-appearance-preview') state.__fixtureOpacityReceive = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (command === 'plugin:event|listen' && args.event === 'nimrod-session-deletion') state.__fixtureDeletionReceive = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (command === 'plugin:event|listen' && args.event === 'nimrod-notification-click') state.__fixtureNotificationClick = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (command === 'plugin:event|unlisten') state.__fixturePreferenceReceive = undefined;
        if (command === 'start_pi' || command === 'start_acp') {
          state.__fixtureChannels[String(args.token)] = args.onEvent as { onmessage(packet: Packet): void };
          return state.__fixtureHost(command, { config: args.config, token: args.token });
        }
        return state.__fixtureHost(command, args);
      },
    } });
  };
  await page.addInitScript(installHost, false);
  let settingsPage: Page | undefined;
  const globalSnapshot = (snapshot: PreferencesSnapshot) => ({ ...snapshot, projectText: null, projectPath: null, projectError: null, projectRevision: 0 });
  async function broadcast() {
    const snapshot = await preferences.snapshot();
    for (const [target, scoped] of [[page, snapshot], [settingsPage, globalSnapshot(snapshot)]] as const) {
      if (target && !target.isClosed()) await target.evaluate(snapshot => (window as unknown as TestWindow).__fixturePreferenceReceive?.(snapshot), scoped);
    }
  }
  const projectHost = async (command: string, args: JsonRecord) => {
    if (command === 'window_appearance_preview_snapshot') { calls.push({ command, args }); return opacityPreview; }
    if (command === 'preview_window_appearance') {
      calls.push({ command, args });
      opacityPreview = { revision: opacityPreview.revision + 1, opacity: args.opacity as number | null, blur: args.blur as number | null };
      for (const target of [page, settingsPage]) if (target && !target.isClosed()) await target.evaluate(snapshot => (window as unknown as TestWindow).__fixtureOpacityReceive?.(snapshot), opacityPreview);
      return opacityPreview;
    }
    const result = await host(command, args);
    if (['preferences_settings', 'project_preferences_settings', 'preferences_state'].includes(command)) await broadcast();
    return result;
  };
  await page.exposeFunction('__fixtureHost', projectHost);
  async function openSettingsWindow(category = 'appearance'): Promise<Page> {
    if (settingsPage && !settingsPage.isClosed()) { await settingsPage.bringToFront(); return settingsPage; }
    const target = settingsPage = await page.context().newPage();
    target.on('pageerror', error => errors.push(String(error)));
    target.on('close', () => {
      opacityPreview = { revision: opacityPreview.revision + 1, opacity: null, blur: null };
      if (!closing && !page.isClosed()) void page.evaluate(snapshot => (window as unknown as TestWindow).__fixtureOpacityReceive?.(snapshot), opacityPreview).catch(error => errors.push(String(error)));
    });
    await target.exposeFunction('__fixtureHost', async (command: string, args: JsonRecord) => {
      if (command === 'plugin:window|close') { await target.close(); await page.bringToFront(); return; }
      if (['start_pi', 'stop_pi', 'write_pi', 'start_acp', 'stop_acp', 'write_acp', 'start_copilot', 'stop_copilot', 'write_copilot', 'drafts_load', 'sync_popout_sessions', 'load_personal_card_plugins'].includes(command)) throw new Error('Global Settings must not initialize project services');
      const result = await projectHost(command, args);
      return command === 'scoped_preferences_snapshot' ? globalSnapshot(result as PreferencesSnapshot) : result;
    });
    await target.addInitScript(installHost, true);
    const url = 'https://nimrod.test/?settings=' + category;
    await target.route('**/*', route => route.request().url() === url ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
    await target.goto(url); await target.addScriptTag({ content: result.outputFiles![0].text });
    await expect(target.locator('#settings-page')).toBeVisible();
    await target.evaluate(() => { document.documentElement.style.zoom = '1.25'; document.body.style.height = 'calc(100dvh / 1.25)'; });
    return target;
  }
  await page.route('**/*', route => route.request().url() === 'https://nimrod.test/'
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.request().url().startsWith('blob:') ? route.continue() : route.abort());
  try {
    await page.goto('https://nimrod.test/');
    if (fixtureOptions?.enforceCsp) {
      const url = await page.evaluate(source => URL.createObjectURL(new Blob([source], { type: 'text/javascript' })), result.outputFiles![0].text);
      try { await page.addScriptTag({ url }); } finally { await page.evaluate(url => URL.revokeObjectURL(url), url); }
    } else await page.addScriptTag({ content: result.outputFiles![0].text });
    await page.locator(typingOptions?.persistent ? '#start-pi' : '#start-temporary').click();
    await expect(page.locator(visible('send'))).toBeEnabled();
    await page.evaluate(() => {
      document.documentElement.style.zoom = '1.25';
      document.body.style.height = 'calc(100dvh / 1.25)';
    });
  } catch (error) { closing = true; await stopChildren(); throw error; }
  const metrics = () => page.locator(visible('transcript-viewport')).evaluate(pane => ({
    top: pane.scrollTop, max: Math.max(0, pane.scrollHeight - pane.clientHeight),
    gap: Math.max(0, pane.scrollHeight - pane.clientHeight - pane.scrollTop),
  }));
  return {
    errors, metrics, calls, children, nativeDrafts,
    settingsWindow: openSettingsWindow,
    async notificationClick(target: { session: string; token: string }) { await page.evaluate(payload => (window as unknown as TestWindow).__fixtureNotificationClick?.(payload), target); },
    state: () => structuredClone(preferences.value.state),
    settingsText: () => preferences.value.text,
    async deletionEvent(event: DeletionEvent) { await page.evaluate(payload => (window as unknown as TestWindow).__fixtureDeletionReceive?.(payload), event); },
    async editPreferences(text: string) {
      preferences.external(text);
      await broadcast();
    },
    async turn(number: number) {
      await page.locator(visible('prompt')).fill(`Offline fixture message ${number}`);
      await page.locator(visible('prompt')).press('Enter');
      await page.waitForFunction(number => (window as unknown as TestWindow).__fixtureSettled >= number, number);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(errors).toEqual([]);
    },
    async close() { closing = true; if (settingsPage && !settingsPage.isClosed()) await settingsPage.close(); await stopChildren(); await delivery; },
  };
}
