import { Channel, invoke } from '@tauri-apps/api/core';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { notificationPreview, sessionNotifications, type NotificationDispatch, type NotificationClick } from './notifications';
import { SessionAttention } from './session-attention';
import { installSidebarResize, sidebarWidthKey } from './sidebar-resize';
import { lastUsed, recentSessions, nextLastUsed, captureSidebarScroll, revealSidebarRow, SessionRecency } from './session-recency';
import { sessionIndicator, createSessionRowContent, updateSessionRowContent, updateSessionRowTime, installSessionTimeRefresh } from './session-sidebar';
import { installDeletionReview } from './deletion-review';
import { SessionDeletion, type DeletionEvent, type DeletionSnapshot } from './session-deletion';
import { presentActivity } from './pi/activity-state';
import { listen } from '@tauri-apps/api/event';
import { installPreferences, type PreferencesSnapshot } from './preferences';
import { open } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { installZoom } from './zoom';
import { installThemes } from './themes/picker';
import { mountPiView, type HostMessage, type PiView } from './pi/webview-client';
import { PiTransport, type Packet } from './pi/transport';
import { PiSession } from './pi/session';
import { SessionDrafts, purgeDeletedDrafts, SESSION_STORAGE_KEY, type LastSession } from './pi/session-drafts';
import { restoreComposerState } from './pi/webview-state';
import { Dialogs } from './dialogs';
import { installCommandPalette, type PalettePage } from './command-palette';
import { installSettings, installRuntimeSettings } from './settings';
import { ACTIONS, bindingsFor, installKeybindingDispatch, isMac, shortcutLabel, type ActionId } from './keybindings';
import { installKeybindingEditor } from './keybinding-editor';
import { installSessionPopouts } from './session-popouts';
import transcript from './pi/transcript.html?raw';
import './pi/transcript.css';
import './theme.css';
import './workspace.css';
import './keybindings.css';

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
const deletionReview = installDeletionReview(required<HTMLDialogElement>('deletion-review'));
const settings = installSettings(window, required<HTMLDialogElement>('settings-page'), required<HTMLButtonElement>('open-settings'), required<HTMLButtonElement>('settings-back'), false);
const keybindingEditor = installKeybindingEditor(window, required('settings-page').querySelector<HTMLElement>('.settings-content')!, {
  read: () => preferences.keybindings(),
  save: (id, bindings, reassign) => preferences.saveKeybinding(id, bindings, reassign, isMac(window)),
  resetAll: () => preferences.resetKeybindings(),
});
const settingsKey = 'nimrod.poc.launch';
const recentKey = 'nimrod.workspaces.v1';
const lastKey = 'nimrod.last-session.v1';
const localState = new Map<string, unknown>();
let ready = false;
let unloading = false;
let workspace: string | undefined;
let opening: Promise<boolean> | undefined;
let sidebarVisible = stored('nimrod.sidebar.visible') !== false;
let active: Tab | undefined;
// Remember navigation separately from the conversation actually shown by the filter.
let presented: Tab | undefined;
const tabs: Tab[] = [];
let recency = new SessionRecency(undefined);
const sessionAttention = new SessionAttention();
const sidebarViews = ['all', 'unread', 'working'] as const;
type SidebarView = typeof sidebarViews[number];
const sessionWorking = new SessionAttention();
let sidebarView: SidebarView = 'all';
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
    ? { path: tab.file.path, sessionId: tab.file.sessionId } : null })), presented?.id ?? null);
}
type LaunchMode = 'saved' | 'temporary' | 'resume';
interface SessionFile { path: string; sessionId: string; exists: boolean; parentSession?: string | null; lastUserMessageAt?: number; }
interface LaunchInfo { cwd: string; session?: SessionFile; }
interface SessionSummary { path: string; sessionId: string; name?: string; preview: string; modified: number; parentSession?: string | null; lastUserMessageAt?: number; }
interface Tab {
  id: string; token?: string; title: string; lastUsed: number; mode: LaunchMode; demo: boolean; file?: SessionFile;
  root: HTMLElement; view: PiView; drafts: SessionDrafts; receive?: (message: HostMessage) => void;
  session?: PiSession; starting: boolean; closing: boolean; restarting: boolean; deleting: boolean; deletionExecuting: boolean; ended: boolean; stopTask?: Promise<void>;
  inputCount: number; unread: boolean; failed: boolean; focus?: HTMLElement; notice: HTMLElement;
  cancelPreference?: () => void;
  preferenceTask?: Promise<void>;
  closeButton: HTMLButtonElement; deleteButton: HTMLButtonElement;
  row: HTMLButtonElement; rowLabel: HTMLElement; rowIndicator: HTMLElement; rowTime: HTMLTimeElement; rowNode: HTMLElement;
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
const sidebarResize = installSidebarResize(window, {
  layout: required('workspace-layout'), sidebar: required('session-sidebar'),
  handle: required('sidebar-resizer'), toggle: required('toggle-sidebar'),
}, {
  read: () => workspace ? stored(sidebarWidthKey(workspace)) : undefined,
  save: width => { if (workspace) save(sidebarWidthKey(workspace), width); },
});
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
}, false);
const notificationPicker = required<HTMLSelectElement>('notification-mode');
const notificationStatus = required('notification-status');
const notificationTest = required<HTMLButtonElement>('notification-test');
const notificationDiagnostics = required<HTMLButtonElement>('notification-diagnostics');
let testingNotification = false, readingNotificationDiagnostics = false;
const reloadNotifications = () => {
  notificationPicker.value = preferences.notificationsEnabled() ? 'on' : 'off';
  notificationTest.disabled = testingNotification || readingNotificationDiagnostics || !preferences.notificationsEnabled();
  notificationDiagnostics.disabled = testingNotification || readingNotificationDiagnostics;
};
const notificationProgress = (message: string) => { notificationStatus.textContent = message; };
const notificationError = (message: string) => { notificationProgress(message); error.textContent = message; };
async function refreshNotificationDiagnostics(prefix = 'Notification diagnostics.') {
  try { notificationProgress(`${prefix} ${await invoke<string>('notification_diagnostics')}`); }
  catch (error) { notificationProgress(`${prefix} Could not read diagnostics: ${String(error)}`); }
}
notificationDiagnostics.addEventListener('click', () => {
  if (testingNotification || readingNotificationDiagnostics) return;
  readingNotificationDiagnostics = true; reloadNotifications();
  notificationProgress('Reading notification diagnostics…');
  void refreshNotificationDiagnostics().finally(() => { readingNotificationDiagnostics = false; reloadNotifications(); });
});
notificationTest.addEventListener('click', () => {
  if (testingNotification || readingNotificationDiagnostics || !preferences.notificationsEnabled()) return;
  testingNotification = true; reloadNotifications();
  notificationProgress('Test notification: checking OS authorization and submitting…');
  void invoke<NotificationDispatch>('test_notification').then(async outcome => {
    if (outcome === 'suppressed') notificationProgress('Test notification was suppressed because the app is closing or alerts were disabled.');
    else {
      if (outcome === 'submitted' && error.textContent?.startsWith('Notifications:')) error.textContent = '';
      await refreshNotificationDiagnostics('Test notification submitted to the OS.');
    }
  }).catch(error => notificationError(`Notifications: ${String(error)}`)).finally(() => {
    testingNotification = false; reloadNotifications();
  });
});
reloadNotifications();
notificationPicker.addEventListener('change', () => {
  notificationPicker.disabled = true;
  void preferences.saveNotifications(notificationPicker.value === 'on').then(() => {
    notificationStatus.textContent = 'Saved. System notification settings still apply.';
  }).catch(error => { notificationStatus.textContent = String(error); }).finally(() => {
    reloadNotifications(); notificationPicker.disabled = false;
  });
});
const previewResponse = notificationPreview(window);
const notifySession = sessionNotifications({
  focused: () => getCurrentWindow().isFocused(),
  prepare: () => invoke('prepare_notifications'),
  send: (kind, target) => invoke<NotificationDispatch>('notify_session', { kind, session: target.session, target: target.target, selected: target.selected(), ...(target.preview ? { preview: target.preview } : {}) }),
}, () => preferences.notificationsEnabled(), notificationError, notificationProgress);
const deletion = new SessionDeletion({
  panels: () => tabs.filter(tab => tab.file?.exists && !tab.demo && tab.mode !== 'temporary').map(tab => ({
    file: tab.file!.path,
    lock: locked => { tab.deleting = locked; if (!locked) tab.deletionExecuting = false; tab.receive?.({ type: 'deletionLock', locked }); updateTab(tab); },
    executionStarted: () => { tab.deletionExecuting = true; updateTab(tab); },
    refresh: async () => { if (tab.session && !tab.ended) await tab.session.refreshDeletionState(); },
    report: () => {
      const composer = restoreComposerState(tab.drafts.read());
      return { file: tab.file!.path, token: tab.token, title: tab.title, busy: deletionBusy(tab), hasDraft: !!(composer.draft.trim() || composer.submission || composer.recovered.length) };
    },
    deleted: () => removeDeletedSessions([tab.file!.path]),
    failed: message => {
      tab.ended = true; tab.session?.rpc.disconnect('Session deletion did not complete');
      showNotice(tab, message);
    },
  })),
  acknowledge: (id, sessions) => {
    if (!ready || unloading) return Promise.reject(new Error('Project window is not ready to acknowledge deletion'));
    return invoke('acknowledge_deletion', { id, sessions });
  },
  snapshot: () => invoke<DeletionSnapshot>('deletion_snapshot'),
  run: (root, sessionId) => invoke('delete_session_tree', { root, sessionId }),
  recover: (path, sessionId) => invoke('recover_deletion_session', { path, sessionId }),
  changed: () => { for (const tab of tabs) updateTab(tab); controls(); },
  deleted: removeDeletedSessions,
  loadingReview: deletionReview.loading,
  review: (id, sessions) => deletionReview.review({ id, sessions }),
  confirm: (id, confirmed) => invoke('confirm_session_deletion', { id, confirmed }),
  cancelReview: deletionReview.cancel,
  error: message => { error.textContent = message; },
});
// A global (Any-target) listener also receives emit_to events for OTHER windows.
let notificationNavigation = 0;
const unlistenNotificationClicks = await listen<NotificationClick>('nimrod-notification-click', event => {
  const target = event.payload;
  const tab = tabs.find(tab => tab.id === target?.session && tab.token === target?.token);
  const valid = () => ready && !unloading && !!tab && tabs.includes(tab) && tab.token === target.token &&
    !tab.starting && !tab.closing && !tab.restarting && !tab.deleting && !deletion.pending && !deletion.blocked(tab.file?.path);
  if (!valid()) return;
  const navigation = ++notificationNavigation;
  void (async () => {
    try { await invoke('focus_notification_window'); }
    catch (error) { notificationError(`Could not focus notification window: ${String(error)}`); }
    if (navigation !== notificationNavigation || !valid() || !tab) return;
    // Dismiss shell navigation, never resolve/cancel Pi's pending input dialogs.
    palette.close(); settings.close();
    activate(tab, true, true, true, false);
    tab.view.scrollToBottom();
  })();
}, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
const unlistenDeletion = await listen<DeletionEvent>('nimrod-session-deletion', event => { void deletion.handle(event.payload); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
preferences.subscribe(() => { runtime.reload(); themes.reload(); void zoom.reload(); reloadNotifications(); keybindingEditor.reload(); refreshShortcutHints(); });
const disposeTimeRefresh = installSessionTimeRefresh(window, () => { for (const tab of tabs) refreshTime(tab); });
window.addEventListener('unload', () => {
  unloading = true;
  disposeTimeRefresh();
  sidebarResize.dispose(); preferences.dispose(); popouts.dispose(); unlistenPopoutErrors(); deletion.dispose(); deletionReview.dispose(); unlistenDeletion(); unlistenNotificationClicks();
  for (const tab of tabs) { tab.receive?.({ type: 'sessionDisconnected' }); tab.view.dispose(); tab.session?.rpc.disconnect('Window closed'); }
  keybindingDispatch.dispose(); keybindingEditor.dispose();
  palette.dispose(); zoom.dispose(); themes.dispose(); runtime.dispose(); settings.dispose();
}, { once: true });

function recoverableDrafts(): { key: string; label: string }[] {
  return drafts.recoverable().filter(o => !tabs.some(t => o.key === `unassigned:${t.id}` || o.key === `${t.demo ? 'demo' : 'temporary'}:${workspace}:${t.id}`));
}
function controls(): void {
  welcome.hidden = !ready || !!workspace;
  required('workspace-empty').hidden = !workspace || !!active || sidebarView !== 'all';
  for (const id of ['workspace-new', 'workspace-resume', 'start-pi', 'start-temporary', 'start-demo', 'resume-file', 'resume-last', 'recover-draft', 'browse', 'cwd', 'enter-workspace', 'sidebar-new']) {
    (required(id) as HTMLButtonElement | HTMLInputElement).disabled = !ready || deletion.pending;
  }
  cwd.readOnly = !!workspace;
  required('resume-last').hidden = !lastSession();
  required('recover-draft').hidden = !recoverableDrafts().length;
  required('session-sidebar').hidden = !workspace || !sidebarVisible;
  sidebarResize.refresh();
  required('toggle-sidebar').setAttribute('aria-expanded', String(!!workspace && sidebarVisible));
  renderSidebar(); restartControl();
}
function needsAttention(tab: Tab): boolean { return !!tab.inputCount || tab.unread || tab.failed; }
function isWorking(tab: Tab): boolean {
  const state = tab.session?.state;
  return !tab.starting && !tab.closing && !tab.restarting && !tab.deleting && !tab.ended && !tab.inputCount &&
    !!state && !state.sessionUnavailable && (state.busy || !!presentActivity(false, '', state.extensionStatuses).subagents);
}
function sidebarTabs(): Tab[] {
  const order = sessionAttention.reconcile(tabs.map(tab => ({ id: tab.id, needsAttention: needsAttention(tab) })), presented?.id);
  // Reuse selected-row retention so a run settling doesn't hide the response being read.
  const working = new Set(sessionWorking.reconcile(tabs.map(tab => ({ id: tab.id, needsAttention: isWorking(tab) })), sidebarView === 'working' ? presented?.id : undefined));
  const byId = new Map(tabs.map(tab => [tab.id, tab]));
  return sidebarView === 'unread' ? order.map(id => byId.get(id)!) :
    recentSessions(tabs).filter(tab => sidebarView === 'all' || working.has(tab.id));
}
function touchTab(tab: Tab): void {
  tab.lastUsed = nextLastUsed(tabs);
  refreshTime(tab);
  renderSidebar(tab.rowNode);
  persistTabs();
}
function renderSidebar(moved?: HTMLElement): void {
  const visible = sidebarTabs();
  const membership = new Set(visible);
  if (presented && !membership.has(presented)) presentConversation(undefined);
  const sidebar = required('session-sidebar'), list = required('open-sessions');
  const restoreScroll = captureSidebarScroll(sidebar, [...list.children] as HTMLElement[], moved);
  const focused = document.activeElement;
  const filteredFocus = tabs.some(tab => !membership.has(tab) && focused instanceof Node && tab.rowNode.contains(focused));
  for (const tab of tabs) tab.rowNode.hidden = !membership.has(tab);
  // Move only out-of-order nodes: routine snapshots never rebuild sidebar rows
  // or touch the mounted transcript. Hidden rows follow the visible inbox.
  const ordered = [...visible, ...tabs.filter(tab => !membership.has(tab))];
  let anchor = list.firstElementChild;
  for (const tab of ordered) {
    if (tab.rowNode === anchor) anchor = anchor.nextElementSibling;
    else list.insertBefore(tab.rowNode, anchor);
  }
  const counts = { all: tabs.length, unread: tabs.filter(needsAttention).length, working: tabs.filter(isWorking).length };
  for (const view of sidebarViews) {
    const control = required<HTMLButtonElement>(`sidebar-${view}`);
    control.setAttribute('aria-selected', String(sidebarView === view)); control.tabIndex = sidebarView === view ? 0 : -1;
    const count = required(`sidebar-${view}-count`), text = String(counts[view]);
    if (count.textContent !== text) count.textContent = text;
  }
  required('sidebar-session-panel').setAttribute('aria-labelledby', `sidebar-${sidebarView}`);
  const working = sidebarView === 'unread' && !visible.length ? counts.working : 0;
  const emptyText = required('sidebar-empty-text'), dots = required('sidebar-empty-dots');
  const label = working ? `${working} ${working === 1 ? 'session' : 'sessions'} working` : sidebarView === 'unread' ? 'No unread sessions.' : sidebarView === 'working' ? 'No sessions working.' : 'No open sessions.';
  // Keep the animated node and unchanged status text intact during streaming.
  if (emptyText.textContent !== label) emptyText.textContent = label;
  if (dots.textContent !== (working ? '…' : '')) dots.textContent = working ? '…' : '';
  dots.hidden = !working;
  required('sidebar-empty').hidden = !!visible.length;
  restoreScroll();
  if (!filteredFocus && focused instanceof HTMLElement && focused.isConnected && document.activeElement !== focused) focused.focus({ preventScroll: true });
  if (filteredFocus && !document.querySelector('dialog[open]')) required(`sidebar-${sidebarView}`).focus({ preventScroll: true });
}
function selectSidebarView(view: SidebarView): void {
  notificationNavigation++;
  const returningToAll = view === 'all' && sidebarView !== 'all';
  sidebarView = view;
  if (workspace) save(`nimrod.sidebar.view:${workspace}`, view);
  const target = active && sidebarTabs().includes(active) ? active : undefined;
  presentConversation(target);
  if (target) { target.unread = false; updateTab(target); }
  controls();
  if (returningToAll && target) revealSidebarRow(required('session-sidebar'), target.rowNode);
}
function presentConversation(tab: Tab | undefined): void {
  if (presented !== tab) {
    if (presented) {
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && presented.root.contains(focused)) {
        presented.focus = focused;
        if (!tab && !document.querySelector('dialog[open]')) required(`sidebar-${sidebarView}`).focus({ preventScroll: true });
      }
      presented.view.setActive(false); presented.root.hidden = true; presented.root.inert = true;
    }
    presented = tab;
    conversation.hidden = !tab;
    if (tab) { tab.root.hidden = false; tab.view.setActive(true); }
    syncPopouts();
  }
  for (const item of tabs) {
    item.root.inert = item.closing || item.restarting || item.deleting || item !== presented;
    item.row.setAttribute('aria-current', String(item === presented));
  }
  const badge = required('mode-badge');
  badge.textContent = !tab ? '' : tab.demo ? 'Fixture · no model' : tab.mode === 'temporary' ? 'Pi · temporary' : tab.file?.exists ? 'Pi' : 'Pi · awaiting first save';
  badge.title = tab?.file?.path || '';
  restartControl();
}
function submissionPending(tab: Tab): boolean {
  // restoreComposerState intentionally marks pending submissions unknown on reload;
  // live action eligibility must inspect the actual persisted-in-memory status.
  const composer = tab.drafts.read() as { submission?: { status?: unknown } } | undefined;
  return composer?.submission?.status === 'pending';
}
function deletionBusy(tab: Tab): boolean {
  const state = tab.session?.state;
  return tab.starting || tab.closing || tab.restarting || !!tab.inputCount || submissionPending(tab) || !!(state && !tab.ended && (state.busy || state.compacting || state.modelControls.changing || state.sessionUnavailable || state.queue.pendingCount || state.queue.steering.length || state.queue.followUp.length || presentActivity(false, '', state.extensionStatuses).subagents));
}
function restartable(tab: Tab): boolean { return !!tab.file?.exists && !tab.demo && tab.mode !== 'temporary'; }
function deletable(tab: Tab | undefined): boolean {
  return ready && !deletion.pending && !!tab && tabs.includes(tab) && restartable(tab) &&
    !tab.deleting && !deletion.blocked(tab.file?.path) && !deletionBusy(tab);
}
function restartControl(): void {
  const active = presented;
  const button = required<HTMLButtonElement>('restart-session');
  button.disabled = !ready || deletion.pending || !active || !restartable(active) || deletion.blocked(active.file?.path) || active.starting || active.closing || active.restarting;
  const remove = required<HTMLButtonElement>('delete-session');
  remove.disabled = !deletable(active);
  remove.title = !active ? 'Delete session tree… — no open session' : deletion.pending ? 'Delete session tree… — deletion pending' : deletion.blocked(active.file?.path) ? 'Delete session tree… — recover through Resume session first' : active.demo || active.mode === 'temporary' ? 'Delete session tree… — unavailable for temporary sessions' : !restartable(active) ? 'Delete session tree… — unavailable until saved' : deletionBusy(active) ? 'Delete session tree… — wait for active work to finish' : 'Delete session tree…';
  button.title = !active ? 'Restart session — no open session' : deletion.blocked(active.file?.path) ? 'Restart session — recover through Resume session first' : active.demo || active.mode === 'temporary'
    ? 'Restart session — unavailable for temporary sessions' : !active.file?.exists
    ? 'Restart session — available after the first save' : active.restarting ? 'Restarting session…' : 'Restart session';
}
function layoutKey(): string { return `nimrod.tabs.v1:${workspace}`; }
function recencyKey(): string { return `nimrod.recency.v1:${workspace}`; }
function persistTabs(): void {
  if (!workspace) return;
  let changed = false;
  for (const tab of tabs) if (restartable(tab) && recency.record(tab.file!, tab.lastUsed)) changed = true;
  if (changed) save(recencyKey(), recency.dump());
  save(layoutKey(), { tabs: tabs.filter(t => restartable(t)).map(t => ({ path: t.file!.path, sessionId: t.file!.sessionId, name: t.title, lastUsed: t.lastUsed })), active: active && restartable(active) ? active.file!.path : undefined });
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
      if (!workspace) await enterWorkspace(result.cwd);
      return workspace === result.cwd;
    } catch (e) { error.textContent = String(e); return false; }
  })();
  try { return await opening; } finally { opening = undefined; }
}
async function enterWorkspace(path: string): Promise<void> {
  workspace = path; cwd.value = path;
  recency = new SessionRecency(stored(recencyKey()));
  if (recency.delete(Object.keys(recency.dump()).filter(file => deletion.removed(file)))) save(recencyKey(), recency.dump());
  ready = false; controls();
  sidebarResize.reload();
  const savedView = stored(`nimrod.sidebar.view:${path}`);
  sidebarView = savedView === 'attention' || savedView === 'unread' ? 'unread' : savedView === 'working' ? 'working' : 'all';
  drafts = makeDrafts(`${SESSION_STORAGE_KEY}:${path}`);
  required('workspace-label').textContent = path;
  required('workspace-label').title = path;
  save(settingsKey, { cwd: path });
  save(recentKey, [path, ...recentWorkspaces().filter(p => p !== path)].slice(0, 30)); renderRecents();
  const layout = stored(layoutKey()) as { tabs?: unknown[]; active?: string } | null;
  for (const value of Array.isArray(layout?.tabs) ? layout.tabs : []) {
    const t = value as (Partial<SessionSummary> & { lastUsed?: unknown }) | null;
    if (!t || typeof t.path !== 'string' || typeof t.sessionId !== 'string' || deletion.removed(t.path) || tabs.some(tab => tab.file?.path === t.path)) continue;
    let used = Math.max(lastUsed(t.lastUsed), recency.get({ path: t.path, sessionId: t.sessionId }));
    if (!used) {
      try {
        const info = await invoke<SessionFile>('inspect_workspace_session', { path: t.path });
        if (info.path === t.path && info.sessionId === t.sessionId) used = lastUsed(info.lastUserMessageAt);
      } catch { /* Retain unreadable entries/drafts for explicit recovery; never substitute mtime. */ }
    }
    if (unloading) return;
    if (deletion.removed(t.path)) continue;
    const tab = createTab('resume', false, { path: t.path, sessionId: t.sessionId, exists: true }, typeof t.name === 'string' ? t.name : 'Session', used);
    tab.drafts.select(`file:${t.path}`);
    tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  }
  ready = true;
  const selected = tabs.find(t => t.file?.path === layout?.active) || recentSessions(tabs)[0];
  if (selected) activate(selected, false, false);
  controls();
}
async function ensureWorkspace(): Promise<boolean> { return !!workspace || await openWorkspace(cwd.value.trim()); }
function openSessionPicker(): PalettePage {
  return {
    notice: tabs.length ? undefined : 'No open sessions.',
    items: tabs.map(tab => ({
      id: tab.id,
      label: tab.title,
      sessionRow: sessionRow(tab),
      keywords: tab === presented ? 'Current' : undefined,
      run: () => activate(tab),
    })),
  };
}
async function paletteSessions(): Promise<PalettePage> {
  if (!workspace) return { items: [], notice: 'Open a project first.' };
  const result = await invoke<{ sessions: SessionSummary[]; warnings: string[] }>('list_workspace_sessions');
  const entries = new Map(result.sessions.filter(s => !deletion.removed(s.path)).map(s => [s.path, s]));
  // Exact-file sessions can live outside discovery. Inspect missing entries so
  // an open child is not accidentally reintroduced as a top-level session.
  for (const tab of tabs) if (tab.file?.exists && !deletion.removed(tab.file.path)) {
    let saved = entries.get(tab.file.path);
    if (!saved) {
      try {
        const info = await invoke<SessionFile>('inspect_workspace_session', { path: tab.file.path });
        if (info.sessionId !== tab.file.sessionId) throw new Error('The session file was replaced with a different session');
        saved = { path: info.path, sessionId: info.sessionId, parentSession: info.parentSession, name: tab.title, preview: '', modified: 0, lastUserMessageAt: info.lastUserMessageAt };
      } catch { result.warnings.push(tab.file.path); continue; }
    }
    entries.set(saved.path, { ...saved, name: tab.title });
  }
  return {
    notice: result.warnings.length ? `${result.warnings.length} session file(s) could not be read. Use Refresh to retry.` : undefined,
    items: [...entries.values()].filter(s => !s.parentSession && !deletion.removed(s.path)).sort((a, b) => b.modified - a.modified).map(s => {
      const open = tabs.find(t => t.file?.path === s.path);
      return {
        id: s.path, label: s.name || s.preview || 'Untitled session', keywords: `${s.path} ${s.preview}`,
        sessionRow: {
          ...(open ? sessionRow(open) : { timestamp: Math.max(recency.get(s), lastUsed(s.lastUserMessageAt)), indicator: sessionIndicator({ inactive: true }) }),
          badge: open ? 'Open' : undefined,
        },
        run: () => openSession(s),
      };
    }),
  };
}
const palette = installCommandPalette(window, required<HTMLDialogElement>('command-palette'), {
  canOpen: () => ready && !settings.isOpen,
  shortcuts: false,
  sessions: paletteSessions,
  openSessions: openSessionPicker,
  commands: () => {
    const active = presented;
    return [
    { id: 'resume', label: 'Resume session…', detail: workspace || 'Open a project first', next: true, run: () => palette.sessions() },
    { id: 'new', label: 'New session', detail: 'Persistent by default', run: () => newSession() },
    { id: 'new-named', label: 'New named session…', detail: 'Choose a name before starting', next: true, run: newNamedSession },
    ...(tabs.length ? [{ id: 'switch-session', label: 'Switch session…', detail: 'All open sessions, regardless of sidebar view', next: true, run: () => palette.openSessions() }] : []),
    ...(active ? [
      { id: 'model', label: 'Select model…', detail: active.session?.state.modelControls.model?.id || 'Choose a model for this session', next: true, run: () => pickPreference(active!, 'model') },
      { id: 'thinking', label: 'Select thinking level…', keywords: 'effort reasoning', detail: active.session?.state.modelControls.thinkingLevel || 'Choose reasoning effort', next: true, run: () => pickPreference(active!, 'thinking') },
    ] : []),
    ...(active && restartable(active) ? [
      { id: 'restart', label: 'Restart session', detail: active.title, run: () => restartSession(active!) },
      { id: 'delete', label: 'Delete session tree…', detail: active.title, run: () => deleteSession(active!) },
    ] : []),
    { id: 'file', label: 'Open session file…', run: pickSession },
    { id: 'temporary', label: 'New temporary session', run: () => newSession('temporary') },
    { id: 'demo', label: 'New offline demo', run: () => newSession('temporary', true) },
    ...(active ? [{ id: 'close', label: 'Close session', detail: active.title, run: () => closeTab(active!) }] : []),
    { id: 'sidebar', label: sidebarVisible ? 'Hide sidebar' : 'Show sidebar', run: () => required<HTMLButtonElement>('toggle-sidebar').click() },
    { id: 'settings', label: 'Settings', run: () => required<HTMLButtonElement>('open-settings').click() },
    { id: 'keybindings', label: 'Edit keybindings…', run: openKeybindings },
    ].map(item => ({ ...item, shortcut: ACTIONS.some(action => action.id === item.id) ? shortcutHint(item.id as ActionId) : undefined }));
  },
});
function button(text: string, click: () => void): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', click); return node;
}
function createTab(mode: LaunchMode, demo: boolean, file?: SessionFile, title = demo ? 'Offline demo' : mode === 'temporary' ? 'Temporary session' : 'Session', used = 0): Tab {
  const id = crypto.randomUUID();
  const root = document.createElement('section'); root.className = 'session-view'; root.id = `panel-${id}`; root.setAttribute('role', 'region'); root.hidden = true;
  root.innerHTML = transcript;
  // Retain stable semantic hooks for CSS and root-scoped lookup, with unique DOM/ARIA IDs.
  for (const node of root.querySelectorAll<HTMLElement>('[id]')) { node.dataset.piId = node.id; node.id = `${id}-${node.id}`; }
  const notice = document.createElement('div'); notice.className = 'tab-notice'; notice.hidden = true; root.append(notice);
  conversation.append(root);
  const rowNode = document.createElement('div'); rowNode.className = 'open-session';
  const row = button('', () => activate(tab, true, true, false)); row.className = 'session-row'; row.id = `session-${id}`; row.setAttribute('aria-controls', root.id);
  root.setAttribute('aria-labelledby', row.id);
  const { rowLabel, rowIndicator, rowTime } = createSessionRowContent(row, `session-time-${id}`);
  const deleteButton = button('', () => { void deleteSession(tab); }); deleteButton.className = 'session-delete';
  deleteButton.append(required('delete-session').querySelector('svg')!.cloneNode(true));
  const closeButton = button('×', () => { void closeTab(tab); }); closeButton.className = 'session-close';
  rowNode.append(row, deleteButton, closeButton); required('open-sessions').append(rowNode);
  const tab: Tab = { id, mode, demo, file, title, lastUsed: Math.max(lastUsed(used), file ? recency.get(file) : 0), root, notice, closeButton, deleteButton, row, rowLabel, rowIndicator, rowTime, rowNode,
    drafts: drafts.fork(), starting: false, closing: false, restarting: false, deleting: false, deletionExecuting: false, ended: false, inputCount: 0, unread: false, failed: deletion.blocked(file?.path),
    view: { setActive() {}, scrollToBottom() {}, dispose() {} } };
  root.addEventListener('focusin', event => { if (event.target instanceof HTMLElement) tab.focus = event.target; });
  tab.drafts.select(file ? `file:${file.path}` : mode === 'temporary' ? `${demo ? 'demo' : 'temporary'}:${workspace}:${id}` : `unassigned:${id}`);
  tab.view = mountPiView({
    getState: () => tab.drafts.read(),
    setState: value => {
      const pending = submissionPending(tab);
      try { tab.drafts.write(value); } catch (e) { persistenceError(e); }
      // A receipt can be pending before Pi publishes any state/activity event.
      if (pending !== submissionPending(tab)) updateTab(tab);
    },
    onMessage: receive => { tab.receive = receive; },
    postMessage: message => {
      if (message.type === 'deletionState') return;
      if (tab.deleting) return;
      if (message.type === 'popOutCode') {
        if (typeof message.text === 'string' && typeof message.language === 'string') {
          popouts.open({ session: tab.id, title: tab.title, text: message.text, language: message.language },
            () => presented === tab && !tab.closing && tabs.includes(tab));
        }
        return;
      }
      if (!tab.session || tab.closing || tab.restarting) return;
      if (message.type === 'selectModel' || message.type === 'selectThinking') void pickPreference(tab, message.type === 'selectModel' ? 'model' : 'thinking');
      else void tab.session.handle(message);
    },
  }, root);
  tab.receive?.({ type: 'snapshot', state: { sessionUnavailable: true } });
  tab.view.setActive(false);
  tabs.push(tab); updateTab(tab); return tab;
}
function activate(tab: Tab, focus = true, reveal = true, scroll = true, connect = true): void {
  if (!ready || !tabs.includes(tab)) return;
  notificationNavigation++;
  // Explicit navigation reaches every open session, but never leaves a shown
  // conversation without its selected row. Boot/close fallback must not change views.
  if (reveal && sidebarView !== 'all' && !sidebarTabs().includes(tab)) {
    sidebarView = 'all';
    if (workspace) save(`nimrod.sidebar.view:${workspace}`, sidebarView);
  }
  active = tab;
  presentConversation(sidebarTabs().includes(tab) ? tab : undefined);
  if (presented === tab) tab.unread = false;
  // Navigation only selects/reveals. Recency changes exclusively on Pi's send acknowledgement.
  for (const item of tabs) updateTab(item);
  persistTabs(); controls(); syncPopouts();
  if (reveal && scroll && presented === tab) revealSidebarRow(required('session-sidebar'), tab.rowNode);
  if (focus && presented === tab && !document.querySelector('dialog[open]')) (tab.focus?.isConnected ? tab.focus : tab.root.querySelector<HTMLElement>('[data-pi-id="prompt"]'))?.focus({ preventScroll: true });
  // An inactive persisted session becomes live as soon as it is selected; there
  // is no separate unavailable-session state for the user to resolve.
  if (connect && presented === tab && tab.file?.exists && !deletion.pending && !deletion.blocked(tab.file.path) && !tab.starting && !tab.closing && !tab.restarting && (!tab.session || tab.ended)) void launch(tab, undefined, true);
}
function refreshTime(tab: Tab): void {
  updateSessionRowTime(tab.rowTime, tab.lastUsed);
}
function indicator(tab: Tab) {
  const state = tab.session?.state;
  // A preview lock is not activity; show Deleting only after confirmation.
  return sessionIndicator({ ...tab, deleting: tab.deletionExecuting, blocked: deletion.blocked(tab.file?.path),
    inactive: tab.ended || !state || state.sessionUnavailable, compacting: state?.compacting,
    busy: state?.busy || !!(state && presentActivity(false, '', state.extensionStatuses).subagents), pending: submissionPending(tab) });
}
function sessionRow(tab: Tab) { return { timestamp: tab.lastUsed, indicator: indicator(tab) }; }
function updateTab(tab: Tab): void {
  tab.root.inert = tab.closing || tab.restarting || tab.deleting || tab !== presented;
  const name = tab.title;
  tab.root.setAttribute('aria-busy', String(tab.session?.state.busy === true));
  updateSessionRowContent(tab, name, sessionRow(tab));
  tab.row.disabled = !ready;
  tab.row.setAttribute('aria-current', String(tab === presented)); tab.closeButton.setAttribute('aria-label', `Close ${name}`); tab.closeButton.disabled = !ready || deletion.pending || tab.closing || tab.starting || tab.restarting;
  tab.deleteButton.setAttribute('aria-label', `Delete session tree for ${name}`); tab.deleteButton.disabled = !deletable(tab);
  if (presented === tab) presentConversation(tab);
  renderSidebar();
}
function showNotice(tab: Tab, text: string, retry = false): void {
  tab.failed = true;
  tab.notice.hidden = false; tab.notice.replaceChildren();
  const message = document.createElement('p'); message.textContent = text; tab.notice.append(message);
  if (retry && !deletion.blocked(tab.file?.path)) tab.notice.append(button('Retry', () => { if (!tab.restarting && !deletion.pending) void launch(tab); }));
  updateTab(tab);
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
  if (!session || tab.ended || tab.closing || tab.restarting || tab.deleting || deletion.blocked(tab.file?.path)) { request.error('Resume this session before changing its model or thinking level.'); return; }
  tab.cancelPreference = request.cancel;
  error.textContent = '';
  const previous = tab.preferenceTask;
  const task = (async () => {
    await previous;
    if (tab.cancelPreference !== request.cancel || tab.session !== session || tab.ended || tab.restarting || tab.deleting) return;
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
  const task = tab.stopTask;
  try { await task; }
  catch (error) { if (tab.stopTask === task) tab.stopTask = undefined; throw error; }
}
async function launch(tab: Tab, copyDraft?: string, acceptedAction = false, initialName?: string): Promise<void> {
  if (!ready || deletion.pending || deletion.blocked(tab.file?.path) || tab.deleting || tab.starting || tab.closing || (tab.session && !tab.ended) || (!acceptedAction && settings.isOpen) || !workspace) return;
  tab.starting = true; tab.failed = false; updateTab(tab); error.textContent = ''; tab.notice.hidden = true;
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
    promptAccepted: () => { if (!unloading && currentToken() && !tab.closing && !tab.restarting && !tab.deleting) touchTab(tab); },
    attention: (kind, response) => {
      if (unloading || !currentToken() || tab.closing || tab.restarting || tab.deleting) return;
      if (kind === 'completed' && (presented !== tab || settings.isOpen)) tab.unread = true;
      if (kind === 'failed') tab.failed = true;
      updateTab(tab);
      void notifySession(kind, {
        valid: () => !unloading && currentToken() && !tab.closing && !tab.restarting && !tab.deleting && (kind === 'failed' || !tab.ended),
        selected: () => presented === tab && !settings.isOpen,
        // Auto-generated sidebar titles are prompt excerpts, not notification-safe labels.
        session: tab.session?.state.sessionName || 'Session',
        target: { session: tab.id, token },
        preview: kind === 'completed' ? previewResponse(response) : undefined,
      });
    },
    choose: (title, options) => withTabDialog(tab, label => dialogs.choose(label, options, token), title),
    input: (title, prefill) => withTabDialog(tab, label => dialogs.input(label, prefill, token), title),
    confirm: (title, message) => withTabDialog(tab, label => dialogs.confirm(label, message, token), title),
    copy: writeText, openLink: href => invoke('open_link', { token, href }),
    disconnected: () => {
      if (!currentToken()) return;
      tab.ended = true; tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' }); dialogs.cancel(token);
      void stopOwned(tab).catch(e => { if (currentToken()) showNotice(tab, `Could not stop Pi: ${e}`); });
      if (!tab.closing && !tab.restarting && !tab.deleting) showNotice(tab, 'Session disconnected. Your draft is retained; nothing will be sent automatically.', !!tab.file?.exists);
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
      if (state.busy && !state.compacting && !state.sessionUnavailable) tab.failed = false;
      const previousTitle = tab.title;
      if (state.sessionName) tab.title = state.sessionName;
      else {
        const first = state.messages.find(message => message.role === 'user');
        const content = first?.content;
        const preview = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => String(block.text || '')).join(' ') : '';
        tab.title = tab.demo ? 'Offline demo' : tab.mode === 'temporary' ? 'Temporary session' : preview.trim().replace(/\s+/g, ' ').slice(0, 70) || (tab.starting ? previousTitle : 'Session');
      }
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
    if (presented === tab && !tab.restarting && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  } catch (e) {
    error.textContent = String(e); startupPackets = undefined; rpc.disconnect(String(e));
    try { await stopOwned(tab); } catch (stopError) { persistenceError(stopError); }
    showNotice(tab, String(e), !!tab.file?.exists); tab.ended = true;
  } finally { tab.starting = false; updateTab(tab); controls(); }
}
function cycleTab(direction: 1 | -1): void {
  if (!active || !tabs.length || (tabs.length < 2 && presented)) return;
  const index = tabs.indexOf(active);
  activate(tabs[(index + direction + tabs.length) % tabs.length]);
}
function newNamedSession(): void {
  if (!ready || settings.isOpen) return;
  palette.namedSession(name => newSession('saved', false, undefined, name));
}
async function newSession(mode: LaunchMode = 'saved', demo = false, copyDraft?: string, initialName?: string): Promise<void> {
  if (!ready || deletion.pending || settings.isOpen || !await ensureWorkspace()) return;
  const tab = createTab(mode, demo, undefined, undefined, nextLastUsed(tabs)); activate(tab); await launch(tab, copyDraft, true, initialName);
}
async function openSession(info: Pick<SessionSummary, 'path' | 'sessionId' | 'name' | 'lastUserMessageAt'>): Promise<void> {
  if (!ready || deletion.pending || settings.isOpen || !await ensureWorkspace()) return;
  if (deletion.blocked(info.path)) {
    try { await deletion.recover(info.path, info.sessionId); } catch (e) { error.textContent = String(e); return; }
  }
  const existing = tabs.find(tab => tab.file?.path === info.path);
  if (existing) { activate(existing); return; }
  let used = Math.max(recency.get(info), lastUsed(info.lastUserMessageAt));
  if (info.lastUserMessageAt === undefined) {
    try {
      const inspected = await invoke<SessionFile>('inspect_workspace_session', { path: info.path });
      if (inspected.sessionId !== info.sessionId) throw new Error('The session file was replaced with a different session');
      info = { ...info, path: inspected.path, lastUserMessageAt: inspected.lastUserMessageAt };
      used = Math.max(recency.get(info), lastUsed(info.lastUserMessageAt));
    } catch (e) { error.textContent = String(e); return; }
  }
  // Recheck after metadata awaits: duplicate open actions must share one mounted session.
  if (!ready || unloading || settings.isOpen || deletion.pending || deletion.removed(info.path) || deletion.blocked(info.path)) return;
  const concurrent = tabs.find(tab => tab.file?.path === info.path);
  if (concurrent) { activate(concurrent); return; }
  const tab = createTab('resume', false, { path: info.path, sessionId: info.sessionId, exists: true }, info.name || 'Session', used);
  activate(tab); await launch(tab, undefined, true);
}
async function restartSession(tab: Tab): Promise<void> {
  if (!ready || deletion.pending || deletion.blocked(tab.file?.path) || !tabs.includes(tab) || !restartable(tab) || tab.starting || tab.closing || tab.restarting || settings.isOpen) return;
  const composer = restoreComposerState(tab.drafts.read());
  const needsConfirmation = !!tab.session && !tab.ended && (tab.session.state.busy || !!composer.submission || !!tab.inputCount || !!tab.session.state.queue?.pendingCount);
  tab.restarting = true; updateTab(tab);
  let resumed = false;
  try {
    if (needsConfirmation && !await dialogs.confirm(`Restart ${tab.title}?`, 'This interrupts this session’s agent and resumes its saved history. Your draft stays; queued and in-flight work will not continue. Nothing is sent again automatically.')) return;
    if (!tabs.includes(tab)) return;
    // Stop is a native lifecycle operation, not an RPC request to a stuck agent.
    await stopOwned(tab);
    tab.cancelPreference?.();
    if (tab.token) dialogs.cancel(tab.token);
    tab.receive?.({ type: 'sessionDisconnected' }); tab.session?.rpc.disconnect('Session restarted');
    tab.ended = true;
    resumed = true;
    await launch(tab, undefined, true);
  } catch (error) { showNotice(tab, `Could not restart Pi: ${error}`); }
  finally {
    tab.restarting = false; if (tabs.includes(tab)) updateTab(tab); controls();
    // The restart lock keeps the pane inert during startup. Restore explicit-launch
    // focus only after unlocking, never over another session or an open dialog.
    if (resumed && presented === tab && !tab.ended && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  }
}
async function deleteSession(tab: Tab): Promise<void> {
  if (settings.isOpen || !deletable(tab)) return;
  await deletion.run(tab.file!.path, tab.file!.sessionId);
}
function removeDeletedSessions(files: string[]): void {
  const deleted = new Set(files), before = recentSessions(tabs), shown = [...sidebarTabs()], selected = active;
  if (recency.delete(files) && workspace) save(recencyKey(), recency.dump());
  const removed = tabs.filter(tab => tab.file && deleted.has(tab.file.path));
  // Dispose the entire subtree before selecting or persisting a replacement.
  for (const tab of removed) disposeTab(tab);
  for (const file of files) {
    try { drafts.deleteFile(file); } catch (e) { persistenceError(e); }
    if ((stored(lastKey) as LastSession | null)?.path === file) save(lastKey, null);
  }
  try { purgeDeletedDrafts(localStorage, files); } catch (e) { persistenceError(e); }
  if (selected && removed.includes(selected)) {
    const nextIn = (order: Tab[], candidates: Tab[]) => {
      const index = order.indexOf(selected), allowed = new Set(candidates);
      return order.slice(index + 1).find(tab => allowed.has(tab)) || order.slice(0, Math.max(0, index)).reverse().find(tab => allowed.has(tab)) || candidates[0];
    };
    let next = nextIn(shown, sidebarTabs());
    // Tree deletion intentionally differs from ordinary Close: the agreed
    // deletion flow falls back to All when the current filter is exhausted.
    if (!next && sidebarView !== 'all') { selectSidebarView('all'); next = nextIn(before, recentSessions(tabs)); }
    if (next) activate(next, true, false);
    else { conversation.hidden = true; required('mode-badge').textContent = ''; }
  }
  controls(); persistTabs(); syncPopouts();
}
function disposeTab(tab: Tab): void {
  if (!tabs.includes(tab)) return;
  tab.closing = true;
  tabs.splice(tabs.indexOf(tab), 1);
  if (active === tab) active = undefined;
  if (presented === tab) { tab.view.setActive(false); presented = undefined; conversation.hidden = true; }
  if (tab.token) dialogs.cancel(tab.token);
  tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' }); tab.session?.rpc.disconnect('Session closed');
  tab.view.dispose();
  try { tab.drafts.discardTemporary(); } catch (e) { persistenceError(e); }
  tab.root.remove(); tab.rowNode.remove();
}
function detachTab(tab: Tab): void {
  if (!tabs.includes(tab)) return;
  tab.closing = true;
  if (tab.token) dialogs.cancel(tab.token);
  tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' }); tab.session?.rpc.disconnect('Session closed');
  const shown = sidebarTabs(), index = shown.indexOf(tab);
  tabs.splice(tabs.indexOf(tab), 1); tab.view.dispose();
  try { tab.drafts.discardTemporary(); } catch (e) { persistenceError(e); }
  tab.root.remove(); tab.rowNode.remove();
  if (presented === tab) presentConversation(undefined);
  if (active === tab) {
    active = undefined;
    const candidates = sidebarTabs();
    const next = candidates[Math.max(0, Math.min(index, candidates.length - 1))] || recentSessions(tabs)[0];
    if (next) activate(next, true, false);
  }
  for (const item of tabs) updateTab(item);
  controls(); persistTabs(); syncPopouts();
}
async function closeTab(tab: Tab): Promise<void> {
  if (deletion.pending || tab.closing || tab.starting || tab.restarting || settings.isOpen) return;
  const composer = restoreComposerState(tab.drafts.read());
  const running = tab.session && !tab.ended;
  if ((tab.mode === 'temporary' || (running && (tab.session!.state.busy || composer.submission || tab.inputCount || tab.session!.state.queue?.pendingCount))) && !await dialogs.confirm(`Close ${tab.title}?`, tab.mode === 'temporary' ? 'This stops its agent and discards this temporary session, including its draft, queued messages and pop-outs.' : 'This stops only this session’s agent. Written history and your draft remain; queued and in-flight work will not continue.')) return;
  if (tab.closing || !tabs.includes(tab)) return;
  tab.closing = true; updateTab(tab);
  try {
    await stopOwned(tab);
    tab.receive?.({ type: 'sessionDisconnected' }); tab.session?.rpc.disconnect('Disconnected');
    if (tab.token) dialogs.cancel(tab.token);
    detachTab(tab);
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
required('start-temporary').addEventListener('click', () => void newSession('temporary'));
required('start-demo').addEventListener('click', () => void newSession('temporary', true));
required('resume-file').addEventListener('click', () => void pickSession());
required('browse').addEventListener('click', () => void pickWorkspace());
required('enter-workspace').addEventListener('click', () => void openWorkspace(cwd.value.trim()));
required('resume-last').addEventListener('click', () => { const last = lastSession(); if (last) void (async () => { if (workspace !== last.cwd && !await openWorkspace(last.cwd)) return; await openSession(last); })(); });
required('recover-draft').addEventListener('click', () => {
  const options = recoverableDrafts();
  void dialogs.choose('Recover draft into a new session (never sent automatically)', options.map((o, i) => `${i + 1}. ${o.label}`)).then(choice => {
    const index = choice ? Number.parseInt(choice, 10) - 1 : -1; if (options[index]) return newSession('saved', false, options[index].key);
  });
});
required('restart-session').addEventListener('click', () => { if (presented) void restartSession(presented); });
required('delete-session').addEventListener('click', () => { if (presented) void deleteSession(presented); });
required('toggle-sidebar').addEventListener('click', () => { sidebarVisible = !sidebarVisible; save('nimrod.sidebar.visible', sidebarVisible); controls(); });
for (const view of sidebarViews) required(`sidebar-${view}`).addEventListener('click', () => selectSidebarView(view));
required('sidebar-views').addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing || event.repeat) return;
  const index = sidebarViews.indexOf(sidebarView);
  const view = event.key === 'Home' ? 'all' : event.key === 'End' ? 'working' :
    event.key === 'ArrowLeft' ? sidebarViews[(index + sidebarViews.length - 1) % sidebarViews.length] :
    event.key === 'ArrowRight' ? sidebarViews[(index + 1) % sidebarViews.length] : undefined;
  if (!view) return;
  event.preventDefault(); selectSidebarView(view);
  required(`sidebar-${view}`).focus({ preventScroll: true });
});
required('open-sessions').addEventListener('keydown', event => {
  const visible = sidebarTabs();
  const index = visible.findIndex(t => t.row === event.target);
  if (index < 0 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
  const next = event.key === 'Home' ? visible[0] : event.key === 'End' ? visible[visible.length - 1] : event.key === 'ArrowDown' ? visible[(index + 1) % visible.length] : event.key === 'ArrowUp' ? visible[(index - 1 + visible.length) % visible.length] : undefined;
  if (next) { event.preventDefault(); next.row.focus(); }
});
function shortcutHint(id: ActionId): string {
  return bindingsFor(id, preferences.keybindings()).map(binding => shortcutLabel(binding, isMac(window))).join(' / ');
}
function refreshShortcutHints(): void {
  const settingsButton = required('open-settings');
  if (!settingsButton.classList.contains('error')) settingsButton.title = ['Settings', shortcutHint('settings')].filter(Boolean).join(' · ');
  required('toggle-sidebar').title = ['Toggle sidebar', shortcutHint('sidebar')].filter(Boolean).join(' · ');
  required('zoom-level').title = ['App zoom', shortcutHint('zoom-in'), shortcutHint('zoom-out'), shortcutHint('zoom-reset')].filter(Boolean).join(' · ');
  const zoomHint = required('zoom-level').nextElementSibling;
  if (zoomHint) zoomHint.textContent = `Zoom in: ${shortcutHint('zoom-in') || 'unbound'} · Zoom out: ${shortcutHint('zoom-out') || 'unbound'} · Reset to 100%: ${shortcutHint('zoom-reset') || 'unbound'}. Shortcuts pause in other dialogs.`;
}
function openKeybindings(): void { settings.open(); if (settings.isOpen) keybindingEditor.focus(); }
const keybindingDispatch = installKeybindingDispatch(window, {
  read: () => preferences.keybindings(),
  enabled: id => {
    if (unloading) return false;
    if (['settings', 'zoom-in', 'zoom-out', 'zoom-reset'].includes(id)) return true;
    if (!ready) return false;
    if (['close', 'model', 'thinking', 'restart', 'delete'].includes(id)) return !!presented;
    return true;
  },
  run: (id: ActionId) => {
    switch (id) {
      case 'new': return newSession();
      case 'temporary': return newSession('temporary');
      case 'delete': return presented ? deleteSession(presented) : undefined;
      case 'model': return presented ? pickPreference(presented, 'model') : undefined;
      case 'thinking': return presented ? pickPreference(presented, 'thinking') : undefined;
      case 'palette': palette.open(); return;
      case 'close': return presented ? closeTab(presented) : undefined;
      case 'sidebar': required<HTMLButtonElement>('toggle-sidebar').click(); return;
      case 'previous': cycleTab(-1); return;
      case 'next': cycleTab(1); return;
      case 'settings': settings.open(); return;
      case 'keybindings': openKeybindings(); return;
      case 'zoom-in': zoom.run('in'); return;
      case 'zoom-out': zoom.run('out'); return;
      case 'zoom-reset': zoom.run('reset'); return;
      case 'resume': return palette.sessions();
      case 'switch-session': return palette.openSessions();
      case 'new-named': return newNamedSession();
      case 'restart': return presented ? restartSession(presented) : undefined;
      case 'file': return pickSession();
      case 'demo': return newSession('temporary', true);
    }
  },
  error: message => { error.textContent = String(message); },
});
refreshShortcutHints();
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
    deletion.load(await invoke<DeletionSnapshot>('deletion_snapshot'));
    ready = true;
    if (path) { await enterWorkspace(path); syncPopouts(); }
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
