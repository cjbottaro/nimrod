import { Channel, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { installPreferences, type PreferencesSnapshot } from './preferences';
import { open } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { installZoom } from './zoom';
import { installThemes } from './themes/picker';
import { mountPiView, type HostMessage, type PiView } from './pi/webview-client';
import { PiTransport, type Packet } from './pi/transport';
import { PiSession } from './pi/session';
import { SessionDrafts, SESSION_STORAGE_KEY, type LastSession } from './pi/session-drafts';
import { restoreComposerState } from './pi/webview-state';
import { Dialogs } from './dialogs';
import { installCommandPalette, type PalettePage } from './command-palette';
import { installSettings, installRuntimeSettings } from './settings';
import { installSessionPopouts } from './session-popouts';
import transcript from './pi/transcript.html?raw';
import './pi/transcript.css';
import './theme.css';
import './workspace.css';

const required = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
async function main(): Promise<void> {
const preferences = await installPreferences({
  snapshot: () => invoke<PreferencesSnapshot>('preferences_snapshot'),
  settings: (expected, text) => invoke<PreferencesSnapshot>('preferences_settings', { expected, text }),
  state: entries => invoke<PreferencesSnapshot>('preferences_state', { entries }),
  migrate: (text, entries) => invoke<PreferencesSnapshot>('preferences_migrate', { text, entries }),
  listen: receive => listen<PreferencesSnapshot>('nimrod-preferences', event => receive(event.payload)),
}, localStorage, message => {
  const notice = required('preferences-error');
  notice.hidden = !message; notice.textContent = message ?? '';
  const button = required('open-settings');
  button.classList.toggle('error', !!message);
  button.title = message ? 'Settings file error — open Settings for details' : 'Settings · ⌘/Ctrl ,';
  button.setAttribute('aria-label', message ? 'Open Settings — settings file error' : 'Open Settings');
});
required('settings-file-path').textContent = preferences.paths.settings;
required('state-file-path').textContent = preferences.paths.state;
const welcome = required('welcome'), conversation = required('conversation');
const error = required('launch-error'), cwd = required<HTMLInputElement>('cwd');
const dialogs = new Dialogs();
const settings = installSettings(window, required<HTMLDialogElement>('settings-page'), required<HTMLButtonElement>('open-settings'), required<HTMLButtonElement>('settings-back'));
const settingsKey = 'nimrod.poc.launch';
const recentKey = 'nimrod.workspaces.v1';
const lastKey = 'nimrod.last-session.v1';
const localState = new Map<string, unknown>();
let ready = false;
let workspace: string | undefined;
let opening: Promise<boolean> | undefined;
let sidebarVisible = stored('nimrod.sidebar.visible') !== false;
let active: Tab | undefined;
const tabs: Tab[] = [];
function popoutError(message: string): void {
  const notice = required('storage-error');
  notice.hidden = false; notice.textContent = `Pop-outs: ${message}`;
}
const popouts = installSessionPopouts({
  sync: (sessions, active) => invoke('sync_popout_sessions', { sessions, active }),
  open: snapshot => invoke('open_code_popout', { snapshot }),
  error: popoutError,
});
const unlistenPopoutErrors = await listen<string>('nimrod-popout-error', event => popoutError(event.payload));
function syncPopouts(): void {
  if (!workspace) return;
  popouts.sync(tabs.map(tab => ({ runtimeId: tab.id, pi: tab.file?.exists && !tab.demo && tab.mode !== 'temporary'
    ? { path: tab.file.path, sessionId: tab.file.sessionId } : null })), active?.id ?? null);
}
type LaunchMode = 'saved' | 'temporary' | 'resume';
interface SessionFile { path: string; sessionId: string; exists: boolean; }
interface LaunchInfo { cwd: string; session?: SessionFile; }
interface SessionSummary { path: string; sessionId: string; name?: string; preview: string; modified: number; }
interface Tab {
  id: string; token?: string; title: string; mode: LaunchMode; demo: boolean; file?: SessionFile;
  root: HTMLElement; view: PiView; drafts: SessionDrafts; receive?: (message: HostMessage) => void;
  session?: PiSession; starting: boolean; closing: boolean; ended: boolean; stopTask?: Promise<void>;
  inputCount: number; unread: boolean; focus?: HTMLElement; notice: HTMLElement;
  cancelPreference?: () => void;
  preferenceTask?: Promise<void>;
  closeButton: HTMLButtonElement;
  row: HTMLButtonElement; rowLabel: HTMLElement; rowIndicator: HTMLElement; rowStatus: HTMLElement; rowNode: HTMLElement;
}
function stored(key: string): unknown {
  if (!key.startsWith('nimrod.sessions.') && key !== 'nimrod.poc.composer') return localState.has(key) ? localState.get(key) : preferences.readState(key);
  try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; }
}
function persistenceError(e: unknown): void {
  required('storage-error').hidden = false;
  required('storage-error').textContent = `Local persistence failed: ${e}. Keep a copy of your draft before quitting.`;
}
function save(key: string, value: unknown): void {
  localState.set(key, value);
  void preferences.saveState(key, value).catch(persistenceError);
}
function makeDrafts(key = SESSION_STORAGE_KEY): SessionDrafts {
  return new SessionDrafts(stored(key) || stored(SESSION_STORAGE_KEY), stored('nimrod.poc.composer'), value => localStorage.setItem(key, JSON.stringify(value)));
}
let drafts = makeDrafts();
function lastSession(): LastSession | undefined {
  if (workspace) return drafts.last?.cwd === workspace ? drafts.last : undefined;
  const last = stored(lastKey) as Partial<LastSession> | null;
  return last && typeof last.path === 'string' && typeof last.cwd === 'string' && typeof last.sessionId === 'string' ? last as LastSession : drafts.last;
}
let runtimeDefaults: { pi: string; node: string } | undefined;
const runtime = installRuntimeSettings({
  form: required<HTMLFormElement>('runtime-settings'), fields: required<HTMLFieldSetElement>('runtime-fields'),
  pi: required<HTMLInputElement>('pi-path'), node: required<HTMLInputElement>('node-path'), status: required('runtime-status'),
}, {
  read: () => runtimeDefaults ? preferences.runtime(runtimeDefaults) : null,
  save: paths => preferences.saveRuntime(paths),
});
const themes = installThemes({
  root: document.documentElement,
  select: required<HTMLSelectElement>('theme-picker'), file: required<HTMLInputElement>('theme-file'),
  notice: required('theme-notice'), noticeText: required('theme-notice-text'), dismiss: required<HTMLButtonElement>('theme-notice-dismiss'),
}, {
  read: () => preferences.theme(),
  save: library => preferences.saveTheme(library), newId: () => `import-${crypto.randomUUID()}`,
});
const zoom = installZoom(window, required<HTMLSelectElement>('zoom-level'), required('zoom-error'), {
  read: () => preferences.zoom(), save: percent => preferences.saveZoom(percent),
  apply: scale => getCurrentWebview().setZoom(scale),
});
preferences.subscribe(() => { runtime.reload(); themes.reload(); void zoom.reload(); });
window.addEventListener('unload', () => {
  preferences.dispose(); popouts.dispose(); unlistenPopoutErrors();
  for (const tab of tabs) { tab.receive?.({ type: 'sessionDisconnected' }); tab.view.dispose(); tab.session?.rpc.disconnect('Window closed'); }
  palette.dispose(); zoom.dispose(); themes.dispose(); runtime.dispose(); settings.dispose();
}, { once: true });

function recoverableDrafts(): { key: string; label: string }[] {
  return drafts.recoverable().filter(o => !tabs.some(t => o.key === `unassigned:${t.id}` || o.key === `${t.demo ? 'demo' : 'temporary'}:${workspace}:${t.id}`));
}
function controls(): void {
  welcome.hidden = !ready || !!workspace;
  required('workspace-empty').hidden = !workspace || !!active;
  if (workspace && !active) required('mode-badge').textContent = '';
  for (const id of ['workspace-new', 'workspace-resume', 'start-pi', 'start-temporary', 'start-demo', 'resume-file', 'resume-last', 'recover-draft', 'browse', 'cwd', 'enter-workspace', 'open-workspace', 'sidebar-new', 'open-palette']) {
    (required(id) as HTMLButtonElement | HTMLInputElement).disabled = !ready;
  }
  cwd.readOnly = !!workspace;
  required('resume-last').hidden = !lastSession();
  required('recover-draft').hidden = !recoverableDrafts().length;
  required('session-sidebar').hidden = !workspace || !sidebarVisible;
  required('toggle-sidebar').setAttribute('aria-expanded', String(!!workspace && sidebarVisible));
  required('disconnect').hidden = !active?.session || active.ended;
}
function layoutKey(): string { return `nimrod.tabs.v1:${workspace}`; }
function persistTabs(): void {
  if (!workspace) return;
  save(layoutKey(), { tabs: tabs.filter(t => t.file?.exists).map(t => ({ path: t.file!.path, sessionId: t.file!.sessionId, name: t.title })), active: active?.file?.path });
}
function recentWorkspaces(): string[] { const raw = stored(recentKey); return Array.isArray(raw) ? raw.filter((s): s is string => typeof s === 'string') : []; }
function renderRecents(): void {
  required('recent-workspaces').replaceChildren(...recentWorkspaces().map(path => {
    const node = button(path, () => { void openWorkspace(path); }); node.className = 'secondary'; node.title = path; return node;
  }));
}
async function openWorkspace(path: string): Promise<boolean> {
  if (!ready || settings.isOpen) return false;
  if (opening) return opening;
  opening = (async () => {
    try {
      const result = await invoke<{ cwd: string; current: boolean }>('open_workspace', { cwd: path });
      save(recentKey, [result.cwd, ...recentWorkspaces().filter(p => p !== result.cwd)].slice(0, 30));
      renderRecents();
      if (!result.current) return false;
      if (!workspace) enterWorkspace(result.cwd);
      return workspace === result.cwd;
    } catch (e) { error.textContent = String(e); return false; }
  })();
  try { return await opening; } finally { opening = undefined; }
}
function enterWorkspace(path: string): void {
  workspace = path; cwd.value = path;
  drafts = makeDrafts(`${SESSION_STORAGE_KEY}:${path}`);
  required('workspace-label').textContent = path;
  required('workspace-label').title = path;
  save(settingsKey, { cwd: path });
  const layout = stored(layoutKey()) as { tabs?: unknown[]; active?: string } | null;
  for (const value of Array.isArray(layout?.tabs) ? layout.tabs : []) {
    const t = value as Partial<SessionSummary> | null;
    if (!t || typeof t.path !== 'string' || typeof t.sessionId !== 'string' || tabs.some(tab => tab.file?.path === t.path)) continue;
    const tab = createTab('resume', false, { path: t.path, sessionId: t.sessionId, exists: true }, typeof t.name === 'string' ? t.name : 'Session');
    tab.drafts.select(`file:${t.path}`);
    tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  }
  const selected = tabs.find(t => t.file?.path === layout?.active) || tabs[0];
  if (selected) activate(selected, false);
  controls();
}
async function ensureWorkspace(): Promise<boolean> { return !!workspace || await openWorkspace(cwd.value.trim()); }
function openSessionPicker(): PalettePage {
  return {
    notice: tabs.length ? undefined : 'No open sessions.',
    items: tabs.map(tab => ({
      id: tab.id,
      label: tab.title,
      detail: `${tab === active ? 'Current · ' : ''}${tab.rowStatus.textContent || 'Inactive'}`,
      run: () => activate(tab),
    })),
  };
}
async function paletteSessions(): Promise<PalettePage> {
  if (!workspace) return { items: [], notice: 'Open a project first.' };
  const result = await invoke<{ sessions: SessionSummary[]; warnings: string[] }>('list_workspace_sessions');
  const entries = new Map(result.sessions.map(s => [s.path, s]));
  for (const tab of tabs) if (tab.file?.exists) entries.set(tab.file.path, { ...entries.get(tab.file.path), path: tab.file.path, sessionId: tab.file.sessionId, name: tab.title, preview: entries.get(tab.file.path)?.preview || '', modified: entries.get(tab.file.path)?.modified || Date.now() });
  return {
    notice: result.warnings.length ? `${result.warnings.length} session file(s) could not be read. Use Refresh to retry.` : undefined,
    items: [...entries.values()].sort((a, b) => b.modified - a.modified).map(s => ({
      id: s.path, label: s.name || s.preview || 'Untitled session', keywords: `${s.path} ${s.preview}`,
      detail: `${tabs.some(t => t.file?.path === s.path) ? 'Open · ' : ''}${new Date(s.modified).toLocaleDateString()}${s.preview ? ` · ${s.preview}` : ''}`,
      run: () => openSession(s),
    })),
  };
}
const palette = installCommandPalette(window, required<HTMLDialogElement>('command-palette'), {
  canOpen: () => ready && !settings.isOpen,
  sessions: paletteSessions,
  openSessions: openSessionPicker,
  commands: () => [
    { id: 'resume', label: 'Resume session…', detail: workspace || 'Open a project first', next: true, run: () => palette.sessions() },
    { id: 'new', label: 'New session', detail: 'Persistent by default', run: () => newSession() },
    { id: 'new-named', label: 'New named session…', detail: 'Choose a name before starting', next: true, run: newNamedSession },
    ...(tabs.length ? [{ id: 'switch-session', label: 'Switch session…', detail: 'Only sessions open in the sidebar', next: true, run: () => palette.openSessions() }] : []),
    ...(active ? [
      { id: 'model', label: 'Select model…', detail: active.session?.state.modelControls.model?.id || 'Choose a model for this session', next: true, run: () => pickPreference(active!, 'model') },
      { id: 'thinking', label: 'Select thinking level…', keywords: 'effort reasoning', detail: active.session?.state.modelControls.thinkingLevel || 'Choose reasoning effort', next: true, run: () => pickPreference(active!, 'thinking') },
    ] : []),
    { id: 'workspace', label: 'Open project…', run: pickWorkspace },
    { id: 'file', label: 'Open session file…', run: pickSession },
    { id: 'temporary', label: 'New temporary session', run: () => newSession('temporary') },
    { id: 'demo', label: 'New offline demo', run: () => newSession('temporary', true) },
    ...(active ? [{ id: 'close', label: 'Close session', detail: active.title, run: () => closeTab(active!) }] : []),
    { id: 'sidebar', label: sidebarVisible ? 'Hide sidebar' : 'Show sidebar', run: () => required<HTMLButtonElement>('toggle-sidebar').click() },
    { id: 'settings', label: 'Settings', run: () => required<HTMLButtonElement>('open-settings').click() },
  ],
});
function button(text: string, click: () => void): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', click); return node;
}
function createTab(mode: LaunchMode, demo: boolean, file?: SessionFile, title = demo ? 'Offline demo' : mode === 'temporary' ? 'Temporary session' : 'Session'): Tab {
  const id = crypto.randomUUID();
  const root = document.createElement('section'); root.className = 'session-view'; root.id = `panel-${id}`; root.setAttribute('role', 'region'); root.hidden = true;
  root.innerHTML = transcript;
  // Retain stable semantic hooks for CSS and root-scoped lookup, with unique DOM/ARIA IDs.
  for (const node of root.querySelectorAll<HTMLElement>('[id]')) { node.dataset.piId = node.id; node.id = `${id}-${node.id}`; }
  const notice = document.createElement('div'); notice.className = 'tab-notice'; notice.hidden = true; root.append(notice);
  conversation.append(root);
  const rowNode = document.createElement('div'); rowNode.className = 'open-session';
  const row = button('', () => activate(tab)); row.className = 'session-row'; row.id = `session-${id}`; row.setAttribute('aria-controls', root.id);
  root.setAttribute('aria-labelledby', row.id);
  const text = document.createElement('span'); text.className = 'session-row-text';
  const rowLabel = document.createElement('span');
  const rowStatus = document.createElement('small'); text.append(rowLabel, rowStatus);
  const rowIndicator = document.createElement('span'); rowIndicator.className = 'session-indicator'; rowIndicator.setAttribute('aria-hidden', 'true');
  row.append(rowIndicator, text);
  const closeButton = button('×', () => { void closeTab(tab); }); closeButton.className = 'session-close';
  rowNode.append(row, closeButton); required('open-sessions').append(rowNode);
  const tab: Tab = { id, mode, demo, file, title, root, notice, closeButton, row, rowLabel, rowIndicator, rowStatus, rowNode,
    drafts: drafts.fork(), starting: false, closing: false, ended: false, inputCount: 0, unread: false,
    view: { setActive() {}, dispose() {} } }; 
  root.addEventListener('focusin', event => { if (event.target instanceof HTMLElement) tab.focus = event.target; });
  tab.drafts.select(file ? `file:${file.path}` : mode === 'temporary' ? `${demo ? 'demo' : 'temporary'}:${workspace}:${id}` : `unassigned:${id}`);
  tab.view = mountPiView({
    getState: () => tab.drafts.read(),
    setState: value => { try { tab.drafts.write(value); } catch (e) { persistenceError(e); } },
    onMessage: receive => { tab.receive = receive; },
    postMessage: message => {
      if (message.type === 'popOutCode') {
        if (typeof message.text === 'string' && typeof message.language === 'string') {
          popouts.open({ session: tab.id, title: tab.title, text: message.text, language: message.language },
            () => active === tab && !tab.closing && tabs.includes(tab));
        }
        return;
      }
      if (!tab.session || tab.closing) return;
      if (message.type === 'selectModel' || message.type === 'selectThinking') void pickPreference(tab, message.type === 'selectModel' ? 'model' : 'thinking');
      else void tab.session.handle(message);
    },
  }, root);
  tab.receive?.({ type: 'snapshot', state: { sessionUnavailable: true } });
  tab.view.setActive(false);
  tabs.push(tab); updateTab(tab); return tab;
}
function activate(tab: Tab, focus = true): void {
  if (!tabs.includes(tab)) return;
  if (active !== tab) {
    if (active) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && active.root.contains(focused)) active.focus = focused;
      active.view.setActive(false); active.root.hidden = true; active.root.inert = true;
    }
    active = tab; tab.root.hidden = false; tab.root.inert = false;
    welcome.hidden = true; conversation.hidden = false;
    tab.view.setActive(true);
  }
  tab.unread = false;
  for (const item of tabs) updateTab(item);
  persistTabs(); controls(); syncPopouts();
  if (focus && !document.querySelector('dialog[open]')) (tab.focus?.isConnected ? tab.focus : tab.root.querySelector<HTMLElement>('[data-pi-id="prompt"]'))?.focus({ preventScroll: true });
  // An inactive persisted session becomes live as soon as it is selected; there
  // is no separate unavailable-session state for the user to resolve.
  if (tab.file?.exists && !tab.starting && !tab.closing && (!tab.session || tab.ended)) void launch(tab, undefined, true);
}
function updateTab(tab: Tab): void {
  tab.root.inert = tab.closing || tab !== active;
  const status = tab.closing ? 'Closing' : tab.starting ? 'Starting' : tab.inputCount ? 'Input needed' : tab.ended || !tab.session ? 'Inactive' : tab.session.state.busy ? 'Working' : tab.unread ? 'Completed' : 'Ready';
  const mark = status === 'Working' || status === 'Starting' ? '◐' : status === 'Input needed' ? '!' : status === 'Completed' ? '●' : '○';
  const name = tab.title;
  tab.root.setAttribute('aria-busy', String(tab.session?.state.busy === true));
  tab.rowLabel.textContent = name; tab.rowStatus.textContent = status;
  tab.rowIndicator.textContent = mark;
  tab.row.setAttribute('aria-label', `${name} — ${status}`);
  tab.row.setAttribute('aria-current', String(tab === active)); tab.closeButton.setAttribute('aria-label', `Close ${name}`); tab.closeButton.disabled = tab.closing || tab.starting;
  if (active === tab) {
    required('mode-badge').textContent = tab.demo ? 'Fixture · no model' : tab.mode === 'temporary' ? 'Pi · temporary' : tab.file?.exists ? 'Pi' : 'Pi · awaiting first save';
    required('mode-badge').title = tab.file?.path || '';
  }
}
function showNotice(tab: Tab, text: string, retry = false): void {
  tab.notice.hidden = false; tab.notice.replaceChildren();
  const message = document.createElement('p'); message.textContent = text; tab.notice.append(message);
  if (retry) tab.notice.append(button('Retry', () => { void launch(tab); }));
}
async function withTabDialog<T>(tab: Tab, action: (title: string) => Promise<T>, title: string): Promise<T> {
  tab.inputCount++; updateTab(tab);
  try { return await action(`${tab.title} — ${title}`); }
  finally { tab.inputCount--; if (tabs.includes(tab)) updateTab(tab); }
}
async function pickPreference(tab: Tab, kind: 'model' | 'thinking'): Promise<void> {
  const request = palette.startSelection(kind === 'model' ? 'Select model' : 'Select thinking level', () => { void pickPreference(tab, kind); });
  if (!request) return;
  const session = tab.session;
  if (!session || tab.ended || tab.closing) { request.error('Resume this session before changing its model or thinking level.'); return; }
  tab.cancelPreference = request.cancel;
  error.textContent = '';
  const previous = tab.preferenceTask;
  const task = (async () => {
    await previous;
    if (tab.cancelPreference !== request.cancel || tab.session !== session || tab.ended) return;
    await session.selectPreference(kind, {
      choose: (_title, options, current) => request.choose(options, current),
      error: message => {
        request.error(message);
        if (tab.cancelPreference === request.cancel) error.textContent = `${tab.title}: ${message}`;
      },
    });
  })();
  tab.preferenceTask = task.catch(() => {});
  try {
    await task;
  } catch (error) { request.error(String(error)); }
  finally {
    request.finish();
    if (tab.cancelPreference === request.cancel) tab.cancelPreference = undefined;
  }
}
async function stopOwned(tab: Tab): Promise<void> {
  if (!tab.token) return;
  if (!tab.stopTask) tab.stopTask = invoke<void>('stop_pi', { token: tab.token });
  await tab.stopTask;
}
async function launch(tab: Tab, copyDraft?: string, acceptedAction = false, initialName?: string): Promise<void> {
  if (!ready || tab.starting || tab.closing || (tab.session && !tab.ended) || (!acceptedAction && settings.isOpen) || !workspace) return;
  tab.starting = true; updateTab(tab); error.textContent = ''; tab.notice.hidden = true;
  try { await stopOwned(tab); } catch (e) { tab.starting = false; showNotice(tab, `Could not stop the previous process: ${e}`); updateTab(tab); return; }
  const token = crypto.randomUUID(); tab.token = token; tab.stopTask = undefined; tab.ended = false;
  const currentToken = () => tabs.includes(tab) && tab.token === token;
  const rpc = new PiTransport(message => invoke('write_pi', { token, message }));
  const mode = tab.file?.exists ? 'resume' : tab.mode;
  const config = { cwd: workspace, ...runtime.current(), demo: tab.demo, mode, sessionName: initialName, sessionFile: mode === 'resume' ? tab.file?.path : undefined, sessionId: mode === 'resume' ? tab.file?.sessionId || undefined : undefined };
  let launchInfo: LaunchInfo;
  let identityGeneration = 0;
  let confirmedRaw: { path: string; sessionId: string } | undefined;
  let startupPackets: Packet[] | undefined = [];
  const current = new PiSession(rpc, {
    publish: message => { if (currentToken()) tab.receive?.(message); },
    choose: (title, options) => withTabDialog(tab, label => dialogs.choose(label, options, token), title),
    input: (title, prefill) => withTabDialog(tab, label => dialogs.input(label, prefill, token), title),
    confirm: (title, message) => withTabDialog(tab, label => dialogs.confirm(label, message, token), title),
    copy: writeText, openLink: href => invoke('open_link', { token, href }),
    disconnected: () => {
      if (!currentToken()) return;
      tab.ended = true; tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' }); dialogs.cancel(token);
      void stopOwned(tab).catch(e => { if (currentToken()) showNotice(tab, `Could not stop Pi: ${e}`); });
      if (!tab.closing) showNotice(tab, 'Session disconnected. Your draft is retained; nothing will be sent automatically.', !!tab.file?.exists);
      updateTab(tab); controls();
    },
    identity: async (file, id) => {
      if (!currentToken() || tab.ended) return;
      if (!file || !id) { if (mode === 'resume') throw new Error('Pi did not confirm the selected session identity'); return; }
      if (confirmedRaw && (file !== confirmedRaw.path || id !== confirmedRaw.sessionId)) throw new Error('Pi unexpectedly changed session identity');
      if (confirmedRaw && tab.file?.exists) return;
      const generation = ++identityGeneration;
      const info = await invoke<SessionFile>('session_file_info', { token, path: file, sessionId: id });
      if (!currentToken() || tab.ended || generation !== identityGeneration) return;
      if (launchInfo.session && (!info.exists || info.path !== launchInfo.session.path || info.sessionId !== launchInfo.session.sessionId)) throw new Error('Pi did not resume the exact selected session');
      confirmedRaw = { path: file, sessionId: id }; tab.file = info;
      if (info.exists) {
        try { tab.drafts.bind(info.path); tab.drafts.remember({ path: info.path, sessionId: info.sessionId, cwd: launchInfo.cwd }); save(lastKey, { path: info.path, sessionId: info.sessionId, cwd: launchInfo.cwd }); } catch (e) { persistenceError(e); }
        persistTabs(); syncPopouts();
      }
      updateTab(tab);
    },
    changed: state => {
      if (!currentToken()) return;
      const previousTitle = tab.title;
      if (state.sessionName) tab.title = state.sessionName;
      else {
        const first = state.messages.find(message => message.role === 'user');
        const content = first?.content;
        const preview = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => String(block.text || '')).join(' ') : '';
        tab.title = tab.demo ? 'Offline demo' : tab.mode === 'temporary' ? 'Temporary session' : preview.trim().replace(/\s+/g, ' ').slice(0, 70) || (tab.starting ? previousTitle : 'Session');
      }
      if (active !== tab && !state.busy && !state.sessionUnavailable && state.messages.length) tab.unread = true;
      updateTab(tab); persistTabs();
    },
  }, mode === 'temporary');
  tab.session = current;
  try {
    if (copyDraft) tab.drafts.select(`unassigned:${tab.id}`, copyDraft);
    tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
    const onEvent = new Channel<Packet>();
    onEvent.onmessage = packet => { if (!currentToken()) return; if (startupPackets) startupPackets.push(packet); else rpc.receive(packet); };
    launchInfo = await invoke<LaunchInfo>('start_pi', { config, token, onEvent });
    if (!launchInfo?.cwd || launchInfo.cwd !== workspace) throw new Error('Native host did not confirm this project');
    if (mode === 'resume' && !launchInfo.session) throw new Error('Native host did not validate the selected session');
    if (launchInfo.session) {
      if (config.sessionId && config.sessionId !== launchInfo.session.sessionId) throw new Error('The session file was replaced with a different session');
      tab.file = launchInfo.session;
      tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.select(`file:${launchInfo.session.path}`) });
    }
    const packets = startupPackets; startupPackets = undefined;
    for (const packet of packets) rpc.receive(packet);
    await current.initialize(initialName);
    if (active === tab && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  } catch (e) {
    error.textContent = String(e); startupPackets = undefined; rpc.disconnect(String(e));
    try { await stopOwned(tab); } catch (stopError) { persistenceError(stopError); }
    showNotice(tab, String(e), !!tab.file?.exists); tab.ended = true;
  } finally { tab.starting = false; updateTab(tab); controls(); }
}
function cycleTab(direction: 1 | -1): void {
  if (!active || tabs.length < 2) return;
  const index = tabs.indexOf(active);
  activate(tabs[(index + direction + tabs.length) % tabs.length]);
}
function newNamedSession(): void {
  if (!ready || settings.isOpen) return;
  palette.namedSession(name => newSession('saved', false, undefined, name));
}
async function newSession(mode: LaunchMode = 'saved', demo = false, copyDraft?: string, initialName?: string): Promise<void> {
  if (!ready || settings.isOpen || !await ensureWorkspace()) return;
  const tab = createTab(mode, demo); activate(tab); await launch(tab, copyDraft, true, initialName);
}
async function openSession(info: Pick<SessionSummary, 'path' | 'sessionId' | 'name'>): Promise<void> {
  if (!ready || settings.isOpen || !await ensureWorkspace()) return;
  const existing = tabs.find(tab => tab.file?.path === info.path);
  if (existing) { activate(existing); return; }
  const tab = createTab('resume', false, { path: info.path, sessionId: info.sessionId, exists: true }, info.name || 'Session');
  activate(tab); await launch(tab, undefined, true);
}
async function closeTab(tab: Tab, disconnectOnly = false): Promise<void> {
  if (tab.closing || tab.starting || settings.isOpen) return;
  const composer = restoreComposerState(tab.drafts.read());
  const running = tab.session && !tab.ended;
  if ((disconnectOnly || tab.mode === 'temporary' || (running && (tab.session!.state.busy || composer.submission || tab.inputCount || tab.session!.state.queue?.pendingCount))) && !await dialogs.confirm(disconnectOnly ? 'Disconnect this session?' : `Close ${tab.title}?`, tab.mode === 'temporary' ? 'This stops its agent and discards temporary history. Your draft stays on this device.' : 'This stops only this session’s agent. Written history and your draft remain; queued and in-flight work will not continue.')) return;
  if (tab.closing || !tabs.includes(tab)) return;
  tab.closing = true; updateTab(tab);
  try {
    await stopOwned(tab);
    tab.receive?.({ type: 'sessionDisconnected' }); tab.session?.rpc.disconnect('Disconnected');
    if (tab.token) dialogs.cancel(tab.token);
    if (disconnectOnly) { tab.closing = false; tab.ended = true; showNotice(tab, 'Disconnected. Select this session to reconnect.', !!tab.file?.exists); updateTab(tab); controls(); return; }
    tab.cancelPreference?.();
    const index = tabs.indexOf(tab); tabs.splice(index, 1); tab.view.dispose(); tab.root.remove(); tab.rowNode.remove();
    if (active === tab) { active = undefined; const next = tabs[Math.min(index, tabs.length - 1)]; if (next) activate(next); else { conversation.hidden = true; required('mode-badge').textContent = ''; } }
    for (const item of tabs) updateTab(item);
    controls(); persistTabs(); syncPopouts();
  } catch (e) { tab.closing = false; showNotice(tab, `Could not stop Pi: ${e}`); updateTab(tab); }
}
async function pickSession(): Promise<void> {
  if (!ready || settings.isOpen || !await ensureWorkspace()) return;
  try {
    const path = await open({ multiple: false, title: 'Open exact Pi session file', filters: [{ name: 'Pi session', extensions: ['jsonl'] }] });
    if (typeof path === 'string') {
      const info = await invoke<SessionFile>('inspect_workspace_session', { path });
      await openSession(info);
    }
  } catch (e) { error.textContent = String(e); }
}
async function pickWorkspace(): Promise<void> {
  if (!ready || settings.isOpen) return;
  try { const path = await open({ directory: true, multiple: false, title: 'Open project directory' }); if (typeof path === 'string') await openWorkspace(path); }
  catch (e) { error.textContent = String(e); }
}
required('launch-form').addEventListener('submit', event => { event.preventDefault(); void newSession(); });
for (const id of ['sidebar-new', 'workspace-new']) required(id).addEventListener('click', () => void newSession());
required('workspace-resume').addEventListener('click', () => { if (ready && !settings.isOpen) void palette.sessions(); });
required('open-palette').addEventListener('click', () => palette.open());
required('start-temporary').addEventListener('click', () => void newSession('temporary'));
required('start-demo').addEventListener('click', () => void newSession('temporary', true));
required('resume-file').addEventListener('click', () => void pickSession());
for (const id of ['browse', 'open-workspace']) required(id).addEventListener('click', () => void pickWorkspace());
required('enter-workspace').addEventListener('click', () => void openWorkspace(cwd.value.trim()));
required('resume-last').addEventListener('click', () => { const last = lastSession(); if (last) void (async () => { if (workspace !== last.cwd && !await openWorkspace(last.cwd)) return; await openSession(last); })(); });
required('recover-draft').addEventListener('click', () => {
  const options = recoverableDrafts();
  void dialogs.choose('Recover draft into a new session (never sent automatically)', options.map((o, i) => `${i + 1}. ${o.label}`)).then(choice => {
    const index = choice ? Number.parseInt(choice, 10) - 1 : -1; if (options[index]) return newSession('saved', false, options[index].key);
  });
});
required('disconnect').addEventListener('click', () => { if (active) void closeTab(active, true); });
required('toggle-sidebar').addEventListener('click', () => { sidebarVisible = !sidebarVisible; save('nimrod.sidebar.visible', sidebarVisible); controls(); });
required('open-sessions').addEventListener('keydown', event => {
  const index = tabs.findIndex(t => t.row === event.target);
  if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : event.key === 'ArrowDown' ? tabs[(index + 1) % tabs.length] : event.key === 'ArrowUp' ? tabs[(index - 1 + tabs.length) % tabs.length] : undefined;
  if (next) { event.preventDefault(); next.row.focus(); }
});
window.addEventListener('keydown', event => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey || event.isComposing || document.querySelector('dialog[open]')) return;
  if (event.shiftKey) {
    if (event.code === 'BracketLeft') { event.preventDefault(); cycleTab(-1); }
    if (event.code === 'BracketRight') { event.preventDefault(); cycleTab(1); }
    return;
  }
  if (event.key.toLowerCase() === 't') { event.preventDefault(); void newSession(); }
  if (event.key.toLowerCase() === 'w' && active) { event.preventDefault(); void closeTab(active); }
  if (event.key.toLowerCase() === 'b') { event.preventDefault(); required<HTMLButtonElement>('toggle-sidebar').click(); }
});
async function boot(): Promise<void> {
  controls(); renderRecents();
  try {
    await invoke('stop_pi'); // Window-scoped reload cleanup; never stop another workspace.
    await zoom.ready;
    const defaults = await invoke<{ pi: string; node: string; cwd: string }>('runtime_defaults');
    const saved = stored(settingsKey) as Partial<typeof defaults> | null;
    cwd.value = typeof saved?.cwd === 'string' ? saved.cwd : defaults.cwd;
    runtimeDefaults = defaults;
    runtime.initialize(defaults);
    const path = await invoke<string | null>('window_workspace');
    ready = true;
    if (path) { enterWorkspace(path); syncPopouts(); }
    controls();
  } catch (e) { error.textContent = `Could not initialize the native host: ${e}`; }
}
void boot();
}
if (new URLSearchParams(location.search).has('popout')) {
  document.body.replaceChildren();
  void import('./popout').then(module => module.mountPopout());
} else {
  void main().catch(e => {
    required('launch-error').textContent = `Could not initialize preferences: ${e}`;
    required('welcome').hidden = false;
  });
}
