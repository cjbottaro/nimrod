import { expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';
import type { Packet } from '../../src/pi/transport';
import type { JsonRecord } from '../../src/pi/types';
import { MemoryPreferences } from '../preferences-fixture';
import type { PreferencesSnapshot } from '../../src/preferences';
import type { DeletionEvent } from '../../src/session-deletion';

type TestWindow = Window & {
  __fixtureHost(command: string, args: JsonRecord): Promise<unknown>;
  __fixtureChannels: Record<string, { onmessage(packet: Packet): void }>;
  __fixtureSettled: number;
  __fixturePreferenceReceive?: (snapshot: PreferencesSnapshot) => void;
  __fixtureDeletionReceive?: (event: DeletionEvent) => void;
  __fixtureNotificationClick?: (event: { session: string; token: string }) => void;
};
export const visible = (id: string) => `.session-view:not([hidden]) [data-pi-id="${id}"]`;

/** Real app bundle and independent offline demo children. Never starts Pi. */
export async function demoFixture(page: Page, appState: Record<string, unknown> = {}, catalog: { path: string; sessionId: string; name: string; preview: string; modified: number; lastUserMessageAt?: number }[] = []) {
  const result = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', platform: 'browser', write: false,
    loader: { '.css': 'empty' }, plugins: [{ name: 'raw', setup(builder) {
      builder.onResolve({ filter: /\.html\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace('?raw', '')), namespace: 'raw' }));
      builder.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: readFileSync(args.path, 'utf8'), loader: 'text' }));
    } }],
  });
  const css = ['src/pi/transcript.css', 'src/theme.css', 'src/workspace.css', 'src/keybindings.css'].map(p => readFileSync(p, 'utf8')).join('\n');
  const html = readFileSync('index.html', 'utf8').replace('<script type="module" src="/src/main.ts"></script>', '').replace('</head>', `<style>${css}</style></head>`);
  const children = new Map<string, ChildProcessWithoutNullStreams>();
  let delivery = Promise.resolve();
  let closing = false;
  const errors: string[] = [];
  const calls: { command: string; args: JsonRecord }[] = [];
  const preferences = new MemoryPreferences();
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
  await page.exposeFunction('__fixtureHost', async (command: string, args: JsonRecord) => {
    calls.push({ command, args });
    if (command === 'plugin:event|listen' || command === 'plugin:event|unlisten') return 1;
    if (command.startsWith('preferences_') || command === 'record_command_usage') return preferences.invoke(command, args);
    if (command === 'runtime_defaults') return { cwd: process.cwd(), node: process.execPath, pi: 'fixture-only' };
    if (command === 'window_workspace') return null;
    if (command === 'open_workspace') return { cwd: process.cwd(), current: true };
    if (command === 'sync_popout_sessions') return { warnings: [] };
    if (command === 'deletion_snapshot') return { pending: false, quarantine: [], files: [] };
    if (command === 'confirm_session_deletion' || command === 'acknowledge_deletion') return; // Recorded only, no native file deletion.
    if (command === 'plugin:window|is_focused') return true;
    if (command === 'prepare_notifications' || command === 'focus_notification_window') return;
    if (command === 'notification_diagnostics') return 'macOS: authorized; desktop alerts: enabled; style: temporary; Notification Center: enabled; app active: yes; foreground handler calls: 1 (requests Banner + List).';
    if (command === 'notify_session' || command === 'test_notification') return 'submitted'; // Recorded only: never emit real OS notifications.
    if (command === 'list_workspace_sessions') return { sessions: catalog, warnings: [] };
    if (command === 'start_pi') {
      const token = String(args.token);
      if ((args.config as JsonRecord)?.demo !== true || children.has(token)) throw new Error('Only independent offline fixture processes are allowed');
      const child = spawn(process.execPath, ['src-tauri/resources/demo.mjs'], { cwd: process.cwd(), stdio: ['pipe', 'pipe', 'pipe'] });
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
  });
  await page.addInitScript(() => {
    const state = window as unknown as TestWindow;
    state.__fixtureSettled = 0; state.__fixtureChannels = {};
    const callbacks = new Map<number, (event: unknown) => void>();
    Object.assign(window, { __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} }, __TAURI_INTERNALS__: {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
      transformCallback: (callback: (event: unknown) => void) => { const id = callbacks.size + 1; callbacks.set(id, callback); return id; }, unregisterCallback: () => {},
      invoke: async (command: string, args: JsonRecord = {}) => {
        if (command === 'plugin:event|listen' && args.event === 'nimrod-preferences') state.__fixturePreferenceReceive = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (command === 'plugin:event|listen' && args.event === 'nimrod-session-deletion') state.__fixtureDeletionReceive = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (command === 'plugin:event|listen' && args.event === 'nimrod-notification-click') state.__fixtureNotificationClick = payload => callbacks.get(Number(args.handler))?.({ payload });
        if (command === 'plugin:event|unlisten') state.__fixturePreferenceReceive = undefined;
        if (command === 'start_pi') {
          state.__fixtureChannels[String(args.token)] = args.onEvent as { onmessage(packet: Packet): void };
          return state.__fixtureHost(command, { config: args.config, token: args.token });
        }
        return state.__fixtureHost(command, args);
      },
    } });
  });
  await page.route('**/*', route => route.request().url() === 'https://nimrod.test/'
    ? route.fulfill({ contentType: 'text/html', body: html }) : route.abort());
  try {
    await page.goto('https://nimrod.test/');
    await page.addScriptTag({ content: result.outputFiles![0].text });
    await page.locator('#start-demo').click();
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
    errors, metrics, calls, children,
    async notificationClick(target: { session: string; token: string }) { await page.evaluate(payload => (window as unknown as TestWindow).__fixtureNotificationClick?.(payload), target); },
    state: () => structuredClone(preferences.value.state),
    async deletionEvent(event: DeletionEvent) { await page.evaluate(payload => (window as unknown as TestWindow).__fixtureDeletionReceive?.(payload), event); },
    async editPreferences(text: string) {
      preferences.external(text);
      await page.evaluate(snapshot => (window as unknown as TestWindow).__fixturePreferenceReceive?.(snapshot), await preferences.snapshot());
    },
    async turn(number: number) {
      await page.locator(visible('prompt')).fill(`Offline fixture message ${number}`);
      await page.locator(visible('prompt')).press('Enter');
      await page.waitForFunction(number => (window as unknown as TestWindow).__fixtureSettled >= number, number);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(errors).toEqual([]);
    },
    async close() { closing = true; await stopChildren(); await delivery; },
  };
}
