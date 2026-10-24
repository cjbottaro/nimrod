import { createBundledHarnessRegistry } from './bundled-harnesses';
import type { HarnessProject, HarnessSession, SessionRequest, HarnessAction as SessionAction } from './harness-contract';
import type { HarnessSessionHost, HarnessDeletionParticipant } from './harness-host';
import { SessionDeletionCoordinator } from './session-deletion-coordinator';
import type { SessionDeletionOperation, SessionDeletionTarget } from './session-deletion-operation';
import { loadSessionHistory, type SessionHistorySnapshot } from './session-history';
import { savedSessionKey, resolveSessionListEntry, type SessionListEntry } from './session-list';
import { availableSessionActions } from './session-actions';
import { pickConfiguration } from './configuration-picker';
import { readSavedSidebarSession, type SessionLifecycle, type SessionLifecycleOwner, type SavedSidebarSession, type SavedSessionIdentity } from './session-lifecycle';
import type { ConversationViewMessage, ConversationView } from './conversation-view-host';
import { mountConversationView } from './conversation-view';
import { installApplicationNotices } from './application-notices';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { notificationPreview, sessionNotifications, type NotificationDispatch, type NotificationClick } from './notifications';
import { SessionNavigation, SESSION_VIEWS, type SessionView, type SelectionIntent, type NavigationSnapshot } from './session-navigation';
import { SessionConnection } from './session-connection';
import { installSessionContextMenu } from './session-context-menu';
import { installSidebarResize, sidebarWidthKey } from './sidebar-resize';
import { lastUsed, sortByRecency, captureSidebarScroll, revealSidebarRow, SessionRecency } from './session-recency';
import { sessionStatus, sessionListLabel, createSessionRowContent, updateSessionRowContent, updateSessionRowTime, installSessionTimeRefresh } from './session-sidebar';
import { installDeletionReview } from './deletion-review';
import { listen } from '@tauri-apps/api/event';
import { CardPluginCatalog, type PersonalBundles } from './pi/card-plugins/catalog';
import { installCardPluginLoading } from './card-plugin-loading';
import { installNativePreferences } from './native-preferences';
import { installSettingsSurface } from './settings-surface';
import { open } from '@tauri-apps/plugin-dialog';
import { AttachmentStore } from './attachment-store';
import { readClipboardImage } from './clipboard-image';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { BUILTIN_THEMES, CATALOG_THEMES } from './themes/builtins';
import type { ColorTheme } from './themes/theme';
import { measureWork } from './performance-diagnostics';
import { SessionDrafts } from './session-drafts';
import { NativeDrafts } from './native-drafts';
import { referencedAttachments } from './image-attachments';
import { restoreComposerState } from './pi/webview-state';
import { Dialogs } from './dialogs';
import { COMMAND_USAGE_KEY, readCommandUsage } from './command-ranking';
import { abbreviateHome, projectPathParts } from './project-path';
import { installCommandPalette, type PalettePage } from './command-palette';
import { applicationCommands, isApplicationAction, runApplicationAction, type ApplicationActionId } from './application-actions';
import { ACTIONS, actionContextAvailable, actionDefinition, bindingsFor, installKeybindingDispatch, isMac, shortcutLabel, type ActionId } from './keybindings';
import { installSessionPopouts } from './session-popouts';
import transcript from './pi/transcript.html?raw';
import './pi/transcript.css';
import './acp/session.css';
import './copilot/permission-interaction.css';
import './theme.css';
import './typography.css';
import './range-input.css';
import './workspace.css';
import './keybindings.css';
import './modal.css';
import './application-notices.css';

const required = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let applicationNotices: ReturnType<typeof installApplicationNotices> | undefined;
async function main(): Promise<void> {
const notices = applicationNotices = installApplicationNotices(window);
let noticeSequence = 0;
let projectErrorText = '';
// Transitional producer channel: legacy writers no longer own a visible node.
const projectErrors = {
  get textContent() { return projectErrorText; },
  set textContent(text: string | null) {
    projectErrorText = text ?? '';
    if (projectErrorText) notices.report({ id: `project-operation:${++noticeSequence}`, operation: 'Project action', message: projectErrorText });
  },
};
const preferences = await installNativePreferences(message => {
  required('preferences-error').hidden = true;
  if (message) notices.report({ id: 'preferences', operation: 'Read settings', message });
  else notices.resolve('preferences');
  const button = required('open-settings');
  button.classList.toggle('error', !!message);
  if (message) {
    button.title = 'Settings file error — open Settings for details';
    button.setAttribute('aria-label', 'Settings — settings file error');
  }
});
required('settings-file-path').textContent = preferences.paths.settings;
required('state-file-path').textContent = preferences.paths.state;
const cardPlugins = new CardPluginCatalog();
const pluginLoading = installCardPluginLoading(cardPlugins, {
  config: () => preferences.cardPlugins(),
  read: name => invoke<string>('read_card_plugin', { name }),
  executable: {
    readModule: (name, expectedManifest) => invoke<string>('read_card_plugin_module', { name, expectedManifest }),
    loadPersonal: () => invoke<PersonalBundles>('load_personal_card_plugins'),
  },
  loading: () => { required('card-plugin-status').textContent = 'Loading card plugins…'; },
  complete: (report, errors) => {
    required('card-plugin-status').textContent = `Card plugins: ${report.personalLoaded} personal (${report.cacheHits} cached), ${report.manifestLoaded} manifest packages. Reload affects new cards.`;
    required('card-plugin-error').hidden = true;
    if (errors) notices.report({ id: `card-plugins:${++noticeSequence}`, cause: 'card-plugins', operation: 'Load card plugins', message: errors }); else notices.store.resolveCause('card-plugins');
  },
});
function reloadCardPlugins(force = false): Promise<void> { return pluginLoading.reload(force); }
// Compiler/module loading must not gate project/session boot or input restoration.
void reloadCardPlugins();
const welcome = required('welcome'), conversation = required('conversation');
const error = projectErrors, cwd = required<HTMLInputElement>('cwd');
const dialogs = new Dialogs();
const deletionReview = installDeletionReview(required<HTMLDialogElement>('deletion-review'), {
  canCover: other => other.id === 'command-palette' && palette.isDeleting,
});
const settingsSurface = installSettingsSurface(preferences, notices);
const { settings, themes, zoom, runtime, notificationError, notificationProgress, capturePerformance } = settingsSurface;
const settingsKey = 'nimrod.poc.launch';
const recentKey = 'nimrod.workspaces.v1';
const localState = new Map<string, unknown>();
const attachmentStore = new AttachmentStore();
const temporaryImages = new Map<string, Blob>();
let ready = false;
let unloading = false;
let workspace: string | undefined;
let homeDirectory: string | undefined;
let opening: Promise<boolean> | undefined;
let sidebarVisible = stored('nimrod.sidebar.visible') !== false;
let active: Tab | undefined;
// Remember navigation separately from the conversation actually shown by the filter.
let presented: Tab | undefined;
const navigation = new SessionNavigation<Tab>({ needsAttention, isWorking, isConnected });
const sessionContextMenu = installSessionContextMenu();
// Read-only lifecycle/storage membership; UI order comes only from navigation projections.
const tabs = navigation.open();
let recency = new SessionRecency(undefined);
const sidebarViews = SESSION_VIEWS;
let sidebarView: SessionView = 'all';
function popoutError(message: string): void {
  notices.report({ id: `popout:${++noticeSequence}`, operation: 'Reference windows', message });
}
const popouts = installSessionPopouts({
  sync: (sessions, active) => invoke('sync_popout_sessions', { sessions, active }),
  open: snapshot => invoke('open_code_popout', { snapshot }),
  error: popoutError,
});
const unlistenPopoutErrors = await listen<string>('nimrod-popout-error', event => popoutError(event.payload));
const unlistenLinkErrors = await listen<string>('nimrod-link-error', event => {
  notices.report({ id: `link:${++noticeSequence}`, operation: 'Open link', message: event.payload });
}, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
function syncPopouts(): void {
  if (!workspace) return;
  popouts.sync(tabs.map(tab => ({ runtimeId: tab.id, pi: tab.integration.references.file() ?? null })), presented?.id ?? null);
}
interface Tab {
  readonly project: HarnessProject;
  readonly integration: HarnessSession;
  readonly lifecycle: SessionLifecycle;
  id: string; token?: string; title: string; lastUsed: number; pinned: boolean;
  root: HTMLElement; view: ConversationView; drafts: SessionDrafts; receive?: (message: ConversationViewMessage) => void;
  starting: boolean; closing: boolean; restarting: boolean; deleting: boolean; deletionExecuting: boolean; ended: boolean;
  awaitingSelection: boolean;
  inputCount: number; unread: boolean; failed: boolean; focus?: HTMLElement; notice: HTMLElement;
  notices: ReturnType<typeof installApplicationNotices>;
  cancelPreference?: () => void;
  closeButton: HTMLButtonElement; pinButton: HTMLButtonElement;
  row: HTMLButtonElement; rowLabel: HTMLElement; rowIndicator: HTMLElement; rowTime: HTMLTimeElement; rowHarness: HTMLElement; rowNode: HTMLElement;
}
function stored(key: string): unknown {
  return localState.has(key) ? localState.get(key) : preferences.readState(key);
}
function persistenceError(e: unknown): void {
  notices.report({ id: `storage:${++noticeSequence}`, operation: 'Save local data', message: String(e) });
}
function draftPersistenceError(e: unknown): void {
  notices.report({ id: 'draft-storage', cause: 'draft-storage', operation: 'Save drafts', message: String(e) });
}
function save(key: string, value: unknown): void {
  localState.set(key, value);
  void preferences.saveStateIfChanged(key, value)?.catch(persistenceError);
}
let nativeDrafts: NativeDrafts | undefined;
function makeDrafts(values: Record<string, unknown> = {}): SessionDrafts {
  return new SessionDrafts({ drafts: values }, undefined, () => {}, (key, value) => nativeDrafts?.change(key, value));
}
const sidebarResize = installSidebarResize(window, {
  layout: required('workspace-layout'), sidebar: required('session-sidebar'),
  handle: required('sidebar-resizer'), toggle: required('toggle-sidebar'),
}, {
  read: () => workspace ? stored(sidebarWidthKey(workspace)) : undefined,
  save: width => { if (workspace) save(sidebarWidthKey(workspace), width); },
});
let drafts = makeDrafts();
function lastSession() { return harnesses.get(harnesses.defaultId).saved.last(); }
const previewResponse = notificationPreview(window);
const notifySession = sessionNotifications({
  focused: () => getCurrentWindow().isFocused(),
  prepare: () => invoke('prepare_notifications'),
  send: (kind, target) => invoke<NotificationDispatch>('notify_session', { kind, session: target.session, target: target.target, selected: target.selected(), ...(target.preview ? { preview: target.preview } : {}) }),
}, () => preferences.notificationsEnabled(), notificationError, notificationProgress);
const selectedConnection = new SessionConnection<Tab>({
  selected: () => presented,
  eligibility: tab => {
    if (!ready || unloading || !workspace || !tabs.includes(tab) || tab.closing || tab.restarting || tab.awaitingSelection) return 'unavailable';
    return tab.lifecycle.eligibility();
  },
  connect: tab => tab.lifecycle.connect({ acceptedAction: true }),
  failed: (tab, error) => { if (tabs.includes(tab)) showNotice(tab, `Could not connect ${tab.lifecycle.label}: ${error}`, true); },
});
let registryConstructed = false, deletionCoordinatorReady = false;
const harnesses = createBundledHarnessRegistry({
  project: () => workspace, current: () => !unloading, applicationReady: () => ready, deletionPending: () => deletionCoordinatorReady && deletions.pending,
  runtime: () => ({ ...runtime.current() }), store: { read: stored, save }, recency: () => recency,
  open: () => tabs.map(sessionRow), drafts: () => drafts, transcriptLog: settingsSurface.transcriptLog,
  participants: () => tabs.map<HarnessDeletionParticipant>(tab => {
    const composer = restoreComposerState(tab.drafts.read());
    return { reference: tab.lifecycle.identity, token: tab.token, title: tab.title, busy: deletionBusy(tab),
      hasDraft: !!(composer.draft.trim() || composer.attachments?.length || composer.recovered.length),
      lock: (locked, executing) => { tab.deleting = locked; if (executing !== undefined) tab.deletionExecuting = executing; else if (!locked) tab.deletionExecuting = false; tab.receive?.({ type: 'deletionLock', locked }); updateTab(tab); },
      failed: message => { tab.ended = true; tab.lifecycle.disconnect('Session deletion did not complete'); showNotice(tab, message); } };
  }),
  changed: () => { if (!registryConstructed || unloading) return; for (const tab of tabs) updateTab(tab); controls(); selectedConnection.barriersChanged(); },
  notice: notice => { if (!unloading) notices.report(notice); }, resolve: id => notices.resolve(id),
});
registryConstructed = true;
function blocked(tab: Tab): boolean { return tab.project.saved.blocked(tab.lifecycle.key); }
function locked(tab: Tab): boolean { return tab.project.saved.locked(tab.lifecycle.key); }
const deletions = new SessionDeletionCoordinator({
  canRun: (reference, target) => {
    if (!ready || unloading || settings.isOpen) return false;
    const tab = tabs.find(tab => tab.lifecycle.key === target.key);
    return !tab || !!tab.lifecycle.identity && savedSessionKey(tab.lifecycle.identity) === savedSessionKey(reference)
      && !tab.deleting && !tab.starting && !tab.closing && !tab.restarting;
  },
  participants: key => tabs.filter(tab => tab.lifecycle.key === key).map(tab => ({
    lock: (locked, executing) => {
      if (!tabs.includes(tab)) return;
      tab.deleting = locked; tab.deletionExecuting = executing;
      tab.receive?.({ type: 'deletionLock', locked }); updateTab(tab);
    },
    stop: async () => {
      tab.awaitingSelection = true;
      tab.cancelPreference?.();
      if (tab.token) dialogs.cancel(tab.token);
      await tab.lifecycle.stop();
      tab.ended = true;
      tab.lifecycle.disconnect('Session stopped for deletion');
      tab.receive?.({ type: 'sessionDisconnected' });
    },
  })),
  review: { loadingReview: deletionReview.loading, review: deletionReview.review, progress: deletionReview.progress, closeReview: deletionReview.cancel },
  deleted: removeDeletedSessions,
  changed: () => {
    for (const tab of tabs) updateTab(tab);
    controls(); selectedConnection.barriersChanged();
  },
  error: message => { notices.report({ id: `delete:${++noticeSequence}`, operation: 'Delete session', message }); },
});
deletionCoordinatorReady = true;
for (const project of harnesses.projects) deletions.register(context => project.deletion(context));
function tabDeletion(tab: Tab | undefined): SessionDeletionOperation | undefined {
  const reference = tab?.lifecycle.identity;
  return reference && tab ? deletions.operation(reference, tab.title) : undefined;
}
// A global (Any-target) listener also receives emit_to events for OTHER windows.
let notificationNavigation = 0;
const unlistenNotificationClicks = await listen<NotificationClick>('nimrod-notification-click', event => {
  const target = event.payload;
  const tab = tabs.find(tab => tab.id === target?.session && tab.token === target?.token);
  const valid = () => ready && !unloading && !!tab && tabs.includes(tab) && tab.token === target.token &&
    !tab.starting && !tab.closing && !tab.restarting && !tab.deleting && !locked(tab) && !blocked(tab);
  if (!valid()) return;
  const navigation = ++notificationNavigation;
  void (async () => {
    try { await invoke('focus_notification_window'); }
    catch (error) { notificationError(`Could not focus notification window: ${String(error)}`); }
    if (navigation !== notificationNavigation || !valid() || !tab) return;
    // Dismiss shell navigation, never resolve/cancel Pi's pending input dialogs.
    palette.close(); settings.close();
    activate(tab, 'notification');
    tab.view.scrollToBottom();
  })();
}, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
preferences.subscribe(() => { void reloadCardPlugins(); refreshShortcutHints(); });
const unlistenDraftErrors = await listen<string>('nimrod-draft-error', event => draftPersistenceError(event.payload));
const unlistenDraftClose = await getCurrentWindow().onCloseRequested(() => {
  // Rust owns child shutdown/window destruction and flushes staged drafts.
  void nativeDrafts?.flush().catch(draftPersistenceError);
});
window.addEventListener('pagehide', () => { void nativeDrafts?.flush().catch(draftPersistenceError); });
const disposeTimeRefresh = installSessionTimeRefresh(window, () => { for (const tab of tabs) refreshTime(tab); });
window.addEventListener('unload', () => {
  unloading = true;
  harnesses.dispose();
  notices.dispose();
  settingsSurface.dispose();
  disposeTimeRefresh(); unlistenDraftErrors(); unlistenDraftClose();
  pluginLoading.dispose();
  sessionContextMenu.dispose(); sidebarResize.dispose(); preferences.dispose(); popouts.dispose(); unlistenPopoutErrors(); unlistenLinkErrors(); deletions.dispose(); deletionReview.dispose(); unlistenNotificationClicks();
  for (const tab of tabs) { tab.integration.interactions.dispose(); tab.notices.dispose(); tab.receive?.({ type: 'sessionDisconnected' }); tab.view.dispose(); tab.lifecycle.disconnect('Window closed'); }
  keybindingDispatch.dispose(); unlistenProjectSettings();
  unlistenProjectPicker(); palette.dispose();
}, { once: true });

function recoverableDrafts(): { key: string; label: string }[] {
  return drafts.recoverable().filter(o => !tabs.some(t => o.key === `unassigned:${t.id}` || o.key === `temporary:${workspace}:${t.id}`));
}
function controls(): void {
  welcome.hidden = !ready || !!workspace;
  required('workspace-empty').hidden = !workspace || !!active || sidebarView !== 'all';
  for (const id of ['workspace-new', 'workspace-resume', 'start-pi', 'start-temporary', 'resume-last', 'recover-draft', 'browse', 'cwd', 'enter-workspace', 'sidebar-new']) {
    (required(id) as HTMLButtonElement | HTMLInputElement).disabled = !ready;
  }
  const creation = harnesses.get(harnesses.defaultId).creation;
  required<HTMLButtonElement>('start-temporary').disabled = !ready || !creation.modes.includes('temporary');
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
  const state = tab.integration.conversation.state;
  return !tab.starting && !tab.closing && !tab.restarting && !tab.deleting && !tab.ended && !tab.inputCount &&
    !!state && !state.sessionUnavailable && tab.integration.presentation.snapshot().working;
}
function isConnected(tab: Tab): boolean {
  return tab.lifecycle.connection === 'connected' &&
    !tab.closing && !tab.restarting && !tab.deleting && !blocked(tab);
}
function navigationSnapshot(): NavigationSnapshot<Tab> { return navigation.snapshot(sidebarView, presented, active); }
function sidebarTabs(): readonly Tab[] { return navigationSnapshot().visible; }
function touchTab(tab: Tab): void {
  tab.lastUsed = navigation.nextRecency();
  refreshTime(tab);
  renderSidebar(tab.rowNode);
  // Recency moves only within its pin group; Unread retains inbox arrival.
  if (presented === tab && sidebarView !== 'unread') {
    if (tab.pinned || !tabs.some(item => item.pinned)) required('sidebar-session-panel').scrollTop = 0;
    else revealSidebarRow(required('sidebar-session-panel'), tab.rowNode);
  }
  persistTabs();
}
function canPin(tab: Tab): boolean {
  return ready && !unloading && tabs.includes(tab) && !tab.closing && !tab.restarting && !tab.deleting && !locked(tab);
}
function canClose(tab: Tab): boolean {
  return canPin(tab) && !tab.starting;
}
async function runSessionRowAction(tab: Tab, action: 'pin' | 'close' | 'delete', pinned = !tab.pinned): Promise<void> {
  if (!ready || unloading || !tabs.includes(tab) || settings.isOpen) return;
  if (action === 'pin') {
    if (!canPin(tab) || tab.pinned === pinned) return;
    tab.pinned = pinned;
    // Presentation-only: no activation, connection, transcript reset or recency change.
    updateTab(tab);
    if (pinned) revealSidebarRow(required('sidebar-session-panel'), tab.rowNode, 'prefer-top');
    persistTabs();
  } else if (action === 'close') {
    if (canClose(tab)) await closeTab(tab);
  } else await deleteSession(tab);
}
async function showSessionContextMenu(tab: Tab, position: { x: number; y: number }): Promise<void> {
  if (!ready || unloading || settings.isOpen || document.querySelector('dialog[open]') || !tabs.includes(tab)) return;
  const pinned = !tab.pinned;
  await sessionContextMenu.show({
    valid: () => !unloading && tabs.includes(tab) && !settings.isOpen && !document.querySelector('dialog[open]'),
    pin: { label: pinned ? 'Pin session' : 'Unpin session', enabled: canPin(tab), run: () => runSessionRowAction(tab, 'pin', pinned) },
    close: { label: 'Close session', enabled: canClose(tab), run: () => runSessionRowAction(tab, 'close') },
    delete: { label: tabDeletion(tab)?.label || 'Delete session…', enabled: deletable(tab), run: () => runSessionRowAction(tab, 'delete') },
    error: error => notices.report({ id: `session-menu:${++noticeSequence}`, owner: tab.id, operation: 'Session menu', message: String(error) }),
  }, { x: position.x * window.devicePixelRatio, y: position.y * window.devicePixelRatio });
}
function renderSidebar(moved?: HTMLElement): void {
  measureWork(settingsSurface.performanceProbe, 'sidebar-reconcile', () => reconcileSidebar(moved));
}
function reconcileSidebar(moved?: HTMLElement): void {
  settingsSurface.performanceProbe.count?.('sidebar-rows', tabs.length);
  const visible = sidebarTabs();
  const membership = new Set(visible);
  if (presented && !membership.has(presented)) presentConversation(undefined);
  const sidebar = required('sidebar-session-panel'), list = required('open-sessions');
  const restoreScroll = captureSidebarScroll(sidebar, [...list.children] as HTMLElement[], moved);
  const focused = document.activeElement;
  const filteredFocus = tabs.some(tab => !membership.has(tab) && focused instanceof Node && tab.rowNode.contains(focused));
  const firstUnpinned = visible.find(tab => !tab.pinned);
  for (const tab of tabs) {
    tab.rowNode.hidden = !membership.has(tab);
    tab.rowNode.classList.toggle('pin-boundary', tab === firstUnpinned && !!visible[0]?.pinned);
  }
  // Move only out-of-order nodes: routine snapshots never rebuild sidebar rows
  // or touch the mounted transcript. Hidden rows follow the visible inbox.
  const ordered = [...visible, ...tabs.filter(tab => !membership.has(tab))];
  let anchor = list.firstElementChild;
  for (const tab of ordered) {
    if (tab.rowNode === anchor) anchor = anchor.nextElementSibling;
    else list.insertBefore(tab.rowNode, anchor);
  }
  const counts = navigation.counts();
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
function selectSidebarView(view: SessionView): void {
  notificationNavigation++;
  const returningToAll = view === 'all' && sidebarView !== 'all';
  sidebarView = view;
  if (workspace) save(`nimrod.sidebar.view:${workspace}`, view);
  const target = navigation.presented(navigationSnapshot());
  if (target) activate(target, 'restore');
  else presentConversation(undefined);
  controls();
  if (returningToAll && target) revealSidebarRow(required('sidebar-session-panel'), target.rowNode);
}
function presentConversation(tab: Tab | undefined): void {
  if (presented !== tab) {
    if (presented) {
      presented.integration.interactions.setActive(false);
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && presented.root.contains(focused)) {
        presented.focus = focused;
        if (!tab && !document.querySelector('dialog[open]')) required(`sidebar-${sidebarView}`).focus({ preventScroll: true });
      }
      presented.notices.setActive(false); presented.view.setActive(false); presented.root.hidden = true; presented.root.inert = true;
    }
    presented = tab;
    conversation.hidden = !tab;
    if (tab) { tab.root.hidden = false; tab.integration.interactions.setActive(true); tab.view.setActive(true); tab.notices.setActive(true); }
    syncPopouts();
  }
  for (const item of tabs) {
    item.root.inert = item.closing || item.restarting || item.deleting || item !== presented;
    item.row.setAttribute('aria-current', String(item === presented));
  }
  const sessionIdentity = required('project-session'), sessionName = required('project-session-name');
  const title = tab?.title || '';
  sessionIdentity.hidden = !tab;
  if (sessionName.textContent !== title) sessionName.textContent = title;
  if (sessionIdentity.title !== title) sessionIdentity.title = title;
  const badge = required('mode-badge');
  badge.textContent = tab?.integration.presentation.snapshot().badge ?? '';
  badge.title = tab?.integration.presentation.snapshot().badgeTitle ?? '';
  restartControl();
}
function promptPending(tab: Tab): boolean { return tab.integration.presentation.snapshot().pending; }
function deletionBusy(tab: Tab): boolean {
  return tab.starting || tab.closing || tab.restarting || !!tab.inputCount || tab.integration.presentation.snapshot().destructiveBusy;
}
function restartable(tab: Tab): boolean { const restart = tab.integration.restart; return restart.supported && restart.available(); }
function deletable(tab: Tab | undefined): boolean {
  return ready && !deletions.pending && !!tab && tabs.includes(tab) && !!tabDeletion(tab)?.available() &&
    !tab.deleting && !tab.starting && !tab.closing && !tab.restarting;
}
function restartControl(): void {
  const active = presented;
  const button = required<HTMLButtonElement>('restart-session');
  button.disabled = !ready || !active || !restartable(active) || active.deleting || locked(active) || blocked(active) || active.starting || active.closing || active.restarting;
  const remove = required<HTMLButtonElement>('delete-session');
  remove.disabled = !deletable(active);
  const operation = tabDeletion(active);
  remove.setAttribute('aria-label', operation?.label.replace('…', '') || 'Delete session');
  const unavailable = !active ? 'no open session' : deletions.pending ? 'deletion pending'
    : !operation?.available() ? operation?.unavailableReason || 'requires saved history and harness deletion support'
    : active.starting || active.closing || active.restarting ? 'session lifecycle operation pending' : undefined;
  remove.title = `${operation?.label || 'Delete session…'}${unavailable ? ` — ${unavailable}` : ''}`;
  const restart = active?.integration.restart;
  button.title = !restart ? 'Restart session — no open session' : restart.supported ? restart.reason() : restart.reason;
}
function layoutKey(): string { return `nimrod.tabs.v1:${workspace}`; }
function recencyKey(): string { return `nimrod.recency.v1:${workspace}`; }
function persistTabs(): void {
  measureWork(settingsSurface.performanceProbe, 'bookkeeping-prepare', prepareTabBookkeeping);
}
function prepareTabBookkeeping(): void {
  if (!workspace) return;
  let changed = false;
  for (const tab of tabs) {
    const identity = tab.lifecycle.identity;
    if (identity && recency.record(identity, tab.lastUsed)) changed = true;
  }
  if (changed) save(recencyKey(), recency.dump());
  save(layoutKey(), { tabs: tabs.flatMap<SavedSidebarSession>(tab => {
    const identity = tab.lifecycle.identity;
    return identity ? [{ ...identity, name: tab.title, lastUsed: tab.lastUsed, ...(tab.pinned ? { pinned: true } : {}) }] : [];
  }), active: active?.lifecycle.key });
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
  await preferences.refresh();
  refreshShortcutHints();
  recency = new SessionRecency(stored(recencyKey()));
  if (recency.delete(Object.keys(recency.dump()).filter(key => harnesses.projects.some(project => project.saved.removed(key))))) save(recencyKey(), recency.dump());
  ready = false; controls();
  sidebarResize.reload();
  const savedView = stored(`nimrod.sidebar.view:${path}`);
  sidebarView = savedView === 'attention' || savedView === 'unread' ? 'unread' : savedView === 'working' ? 'working' : 'all';
  nativeDrafts = new NativeDrafts(path, draftPersistenceError);
  try { drafts = makeDrafts(await nativeDrafts.load()); }
  catch (failure) { persistenceError(failure); throw failure; }
  const { name, parent } = projectPathParts(path);
  required('project-name').textContent = name;
  required('workspace-label').textContent = abbreviateHome(parent, homeDirectory);
  required('project-identity').title = path;
  save(settingsKey, { cwd: path });
  save(recentKey, [path, ...recentWorkspaces().filter(p => p !== path)].slice(0, 30)); renderRecents();
  const layout = stored(layoutKey()) as { tabs?: unknown[]; active?: string } | null;
  for (const value of Array.isArray(layout?.tabs) ? layout.tabs : []) {
    const entry = readSavedSidebarSession(value);
    if (!entry) continue;
    let project: HarnessProject;
    try { project = harnesses.forReference(entry); } catch { continue; }
    const key = project.saved.key(entry);
    if (project.saved.removed(key) || tabs.some(tab => tab.lifecycle.key === key)) continue;
    try {
      const prepared = await project.saved.prepare(entry, { title: entry.name, lastUsed: entry.lastUsed, pinned: entry.pinned }, true);
      if (unloading) return;
      const tab = createTab(prepared.request, project, prepared.title, prepared.lastUsed, prepared.pinned);
      tab.awaitingSelection = tab.integration.selection.deferRestored;
      tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
    } catch (failure) { if (!project.saved.removed(key)) persistenceError(failure); }
  }
  ready = true;
  for (const project of harnesses.projects) {
    if (tabs.some(tab => tab.project === project)) project.history.associate();
    else project.history.source();
  }
  const selected = tabs.find(t => t.lifecycle.key === layout?.active) || navigation.all()[0];
  if (selected) activate(selected, 'startup');
  controls();
}
async function ensureWorkspace(): Promise<boolean> { return !!workspace || await openWorkspace(cwd.value.trim()); }
function openSessionPicker(): PalettePage {
  return {
    notice: tabs.length ? undefined : 'No open sessions.',
    items: navigation.all().map(tab => ({
      ...sessionListItem(sessionRow(tab)),
      id: tab.id,
      keywords: tab === presented ? 'Current' : undefined,
      run: () => activate(tab),
    })),
  };
}
function historyError(source: string, label: string, message: string): void {
  if (!unloading) notices.report({ id: `history:${source}`, operation: `Read ${label} history`, message });
}
function sessionListItem(entry: SessionListEntry) {
  return {
    id: entry.reference ? deletions.operation(entry.reference, entry.title)?.target.key || entry.key : entry.key,
    label: sessionListLabel(entry), detail: entry.harnessLabel, keywords: entry.keywords,
    sessionRow: entry,
  };
}
async function paletteSessions(signal: AbortSignal, publish: (page: PalettePage) => void, kind: 'resume' | 'delete' = 'resume'): Promise<PalettePage> {
  if (!workspace) return { items: [], notice: 'Open a project first.' };
  const sources = harnesses.projects.flatMap(project => { const source = project.history.source(); return source ? [source] : []; });
  const project = workspace;
  const page = (snapshot: SessionHistorySnapshot): PalettePage => {
    const open = tabs.map(sessionRow);
    const entries = snapshot.entries.map(entry => resolveSessionListEntry({ ...entry, timestamp: Math.max(lastUsed(entry.timestamp), entry.reference ? recency.get(entry.reference) : 0) || undefined }, open))
      .filter(entry => !deletions.removed(sessionListItem(entry).id))
      .filter(entry => kind !== 'delete' || !!entry.reference && !!deletions.operation(entry.reference, entry.title)?.supported);
    return {
      notice: snapshot.pending.length ? `Loading ${snapshot.pending.join(' and ')} history…` : undefined,
      items: (kind === 'resume' ? sortByRecency(entries, entry => entry.timestamp) : entries).map(entry => ({
        ...sessionListItem(entry),
        run: () => {
          if (workspace !== project || unloading) throw new Error('The history project is no longer open');
          const reference = entry.reference;
          if (!reference) throw new Error('This session has no saved identity');
          if (kind === 'delete') {
            return deleteSavedSession(reference, entry.title);
          }
          return openSavedSession(entry);
        },
      })),
    };
  };
  const update = (snapshot: SessionHistorySnapshot) => {
    if (signal.aborted || unloading || workspace !== project) return;
    for (const tab of tabs) updateTab(tab);
    controls();
    for (const source of sources) {
      const issue = snapshot.issues.find(issue => issue.source === source.id);
      if (issue) historyError(source.id, source.label, `${issue.message}\nUse Refresh to retry. Other history sources remain available.`);
      else if (!snapshot.pending.includes(source.label)) notices.resolve(`history:${source.id}`);
    }
    publish(page(snapshot));
  };
  const snapshot = await loadSessionHistory(sources, signal, update);
  return page(snapshot);
}
async function openProjectDirectory(path: string): Promise<void> {
  const result = await invoke<{ cwd: string }>('open_project_directory', { cwd: path });
  save(recentKey, [result.cwd, ...recentWorkspaces().filter(p => p !== result.cwd)].slice(0, 30));
  renderRecents();
}
async function paletteProjects(): Promise<PalettePage> {
  const projects = await invoke<{ cwd: string; open: boolean }[]>('list_projects');
  return { items: projects.map(project => {
    const { name, parent } = projectPathParts(project.cwd);
    return {
      id: project.cwd, label: name, projectParent: parent,
      detail: project.cwd, projectOpen: project.open,
      run: () => openProjectDirectory(project.cwd),
    };
  }) };
}
const palette = installCommandPalette(window, required<HTMLDialogElement>('command-palette'), {
  canOpen: () => ready && !settings.isOpen,
  error: (message, operation) => notices.report({ id: `palette:${operation}:${++noticeSequence}`, operation, message }),
  shortcuts: false,
  ranking: {
    usage: () => readCommandUsage(preferences.readState(COMMAND_USAGE_KEY)),
    record: id => {
      // Native read-modify-write serializes acceptance across project windows.
      // Failure reports independently; never blocks or replays the command.
      void preferences.recordCommandUsage(id).catch(error => {
        notices.report({ id: `command-history:${++noticeSequence}`, operation: 'Save command history', message: String(error) });
      });
    },
  },
  sessions: (signal, publish) => paletteSessions(signal, publish),
  deleteSessions: (signal, publish) => paletteSessions(signal, publish, 'delete'),
  sessionDeleted: id => deletions.removed(id),
  openSessions: openSessionPicker,
  projects: paletteProjects,
  commands: () => {
    const active = presented;
    return [
    ...applicationCommands(window, runApplication),
    { id: 'open-recent-project', label: 'Open recent project…', detail: 'Open or focus a previously opened project', next: true, run: () => palette.projects() },
    { id: 'capture-performance', label: 'Capture performance report', detail: settingsSurface.performancePath ? `Last report: ${settingsSurface.performancePath}` : 'Save recent timing data and copy its path; enable in global Settings → Diagnostics first.', run: () => capturePerformance(true) },
    { id: 'reload-card-plugins', label: 'Reload card plugins', detail: 'Rescan personal sources and refresh renderers for new cards; no Pi restart', run: () => reloadCardPlugins(true) },
    { id: 'select-theme', label: 'Select theme…', detail: 'Preview bundled VS Code themes and saved imports', next: true, run: () => pickTheme() },
    { id: 'resume', label: 'Resume session…', detail: 'Open a saved conversation in this project', next: true, run: () => palette.sessions() },
    { id: 'delete-sessions', label: 'Delete sessions…', detail: 'Repeatedly review and delete supported saved sessions in this project', next: true, run: () => palette.deleteSessions() },
    ...harnesses.projects.flatMap(project => project.creation.action && project.initialization.ready() ? [{ ...project.creation.action, run: () => newHarnessSession(project) }] : []),
    ...(harnesses.get(harnesses.defaultId).creation.named ? [{ id: 'new-named', label: 'New named session…', detail: 'Choose a name before starting', next: true, run: newNamedSession }] : []),
    ...(tabs.length ? [{ id: 'switch-session', label: 'Switch session…', detail: 'All open sessions, regardless of sidebar view', next: true, run: () => palette.openSessions() }] : []),
    ...(active ? sessionCommands(active) : []),
    ...(active && restartable(active) ? [
      { id: 'restart', label: 'Restart session', detail: active.integration.restart.supported ? active.integration.restart.detail : '', run: () => restartSession(active!) },
    ] : []),
    ...(active && tabDeletion(active)?.available() ? [{
      id: 'delete', label: tabDeletion(active)!.label, detail: tabDeletion(active)!.detail, run: () => runSessionRowAction(active, 'delete'),
    }] : []),
    ...(harnesses.get(harnesses.defaultId).creation.modes.includes('temporary') ? [{ id: 'temporary', label: 'New temporary session', detail: 'Conversation without saved history', run: () => newSession('temporary') }] : []),
    ...(active ? [
      { id: 'pin', label: active.pinned ? 'Unpin session' : 'Pin session', detail: 'Keep this session above unpinned sessions in the sidebar', run: () => runSessionRowAction(active, 'pin') },
      { id: 'close', label: 'Close session', detail: 'Stop its agent and remove it from the sidebar; saved history stays', run: () => runSessionRowAction(active, 'close') },
    ] : []),
    { id: 'sidebar', label: sidebarVisible ? 'Hide sidebar' : 'Show sidebar', detail: 'Toggle the open-session navigation pane', run: () => required<HTMLButtonElement>('toggle-sidebar').click() },
    { id: 'settings', label: 'Global Settings…', detail: 'Defaults for all projects, notifications and keybindings', run: () => invoke('open_global_settings') },
    ...(workspace ? [{ id: 'project-settings', label: 'Project settings…', detail: 'Override global appearance and runtime defaults for this project', run: () => settings.open() }] : []),
    { id: 'keybindings', label: 'Edit keybindings…', detail: 'Customize shortcuts for Nimrod commands', run: openKeybindings },
    ].map(item => ({ ...item, shortcut: ACTIONS.some(action => action.id === item.id) ? shortcutHint(item.id as ActionId) : undefined }));
  },
});
let themePreviewGeneration = 0;
function pickTheme(): void {
  const request = palette.startPreviewSelection('Select theme', undefined, item => {
    const theme = choices.get(item?.id || '');
    if (item) themes.preview(theme);
    else themes.restore();
  }, () => themes.restore());
  if (!request) return;
  const previewGeneration = ++themePreviewGeneration;
  const choices = new Map<string, ColorTheme | undefined>();
  function show(): void {
    const library = preferences.theme();
    choices.clear(); choices.set('nimrod', undefined);
    const items: PalettePage['items'] = [];
    function add(id: string, label: string, detail: string, theme?: ColorTheme) {
      if (items.some(item => item.id === id)) return;
      choices.set(id, theme);
      items.push({ id, label, detail, current: id === library.selected,
        keywords: id === library.selected ? 'Current' : undefined,
        run: async () => {
          try { await preferences.selectTheme(id, id.startsWith('import-') ? theme : undefined); }
          finally { if (themePreviewGeneration === previewGeneration) themes.restore(); }
        },
      });
    }
    add('nimrod', 'Nimrod (system)', 'Built-in · follows system appearance');
    for (const theme of BUILTIN_THEMES) add(theme.id, theme.name, `Built-in · ${theme.mode}`, theme);
    for (const theme of library.imports) add(theme.id, theme.name, `${theme.source?.provider === 'gogh' ? 'Saved Gogh' : 'Imported'} · ${theme.mode}${theme.source?.author ? ` · ${theme.source.author}` : ''}`, theme);
    for (const entry of CATALOG_THEMES) add(entry.theme.id, entry.theme.name, `VS Code · ${entry.theme.mode} · ${entry.author}`, entry.theme);
    request!.show({ items, notice: 'Arrow keys or hover to preview · Enter to apply · Esc to restore' }, library.selected);
  }
  show();
}
async function takeProjectPickerRequest(): Promise<void> {
  if (!ready || unloading) return;
  if (await invoke<boolean>('take_project_picker_request')) await palette.projects();
}
const unlistenProjectPicker = await listen('nimrod-open-project', () => { void takeProjectPickerRequest(); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
function button(text: string, click: () => void): HTMLButtonElement {
  const node = document.createElement('button'); node.type = 'button'; node.textContent = text; node.addEventListener('click', click); return node;
}
function sessionHost(tab: Tab, owner: SessionLifecycleOwner): HarnessSessionHost {
  const project = workspace ?? '';
  const current = () => !unloading && workspace === project && tabs.includes(tab);
  const selected = () => presented === tab;
  const focusComposer = () => {
    if (current() && selected() && !settings.isOpen && !tab.closing && !tab.restarting && !document.querySelector('dialog[open]'))
      tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  };
  return {
    id: tab.id, project, ownership: owner, drafts: tab.drafts,
    performance: settingsSurface.performanceProbe, transcriptLog: settingsSurface.transcriptLog,
    lifetime: {
      current, selected, settingsOpen: () => settings.isOpen,
      closing: () => tab.closing, restarting: () => tab.restarting, deleting: () => tab.deleting,
      available: options => ready && !!project && current() && !tab.deleting && !tab.closing && !blocked(tab) && !locked(tab) && (!!options.acceptedAction || !settings.isOpen),
      conflicts: reference => tabs.some(other => other !== tab && other.lifecycle.identity && savedSessionKey(other.lifecycle.identity) === savedSessionKey(reference)),
    },
    effects: {
      publish: message => tab.receive?.(message), title: () => tab.title,
      changed: change => {
        if (!current()) return;
        if (change?.title !== undefined) tab.title = change.title;
        if (change?.clearFailed) tab.failed = false;
        if (tab.starting) tab.awaitingSelection = false;
        updateTab(tab); if (change?.persist) persistTabs();
      },
      identified: () => { if (current()) { harnesses.assertIdentity(tab.project, tab.integration); persistTabs(); syncPopouts(); } },
      retire: () => { tab.cancelPreference?.(); if (tab.token) dialogs.cancel(tab.token); },
      input: delta => { tab.inputCount += delta; if (current()) updateTab(tab); },
      attention: (kind, token, label, response, signal) => {
        const valid = () => current() && tab.token === token && !tab.closing && !tab.restarting && !tab.deleting && !signal?.aborted && (kind === 'failed' || !tab.ended);
        if (!valid()) return;
        if (kind === 'failed') tab.failed = true;
        else if (kind === 'completed' && (!selected() || settings.isOpen)) tab.unread = true;
        updateTab(tab);
        void notifySession(kind, { valid, selected: () => selected() && !settings.isOpen, session: label,
          target: { session: tab.id, token }, preview: kind === 'completed' ? previewResponse(response) : undefined });
      },
      notice: notice => { if (current() && !tab.closing) notices.report({ ...notice, id: `${tab.id}:${notice.id}`, owner: tab.id }); },
      resolve: id => notices.resolve(`${tab.id}:${id}`),
      connection: (message, retry, details) => { if (current() && !tab.closing && !tab.deleting) showNotice(tab, message, retry, details); },
      hasConnectionOutcome: () => !!tab.view.hasConnectionOutcome?.(),
      storageFailure: persistenceError,
    },
    ui: { document, root: tab.root, palette, dialogs, focusComposer,
      canPresent: () => current() && selected() && !tab.closing && !tab.restarting && !tab.deleting && !tab.ended
        && !settings.isOpen && !document.querySelector('dialog[open]:not(#command-palette)'),
      withDialog: (action, title) => withTabDialog(tab, action, title),
    },
  };
}
function createTab(request: SessionRequest, project = harnesses.get(harnesses.defaultId), title = request.mode === 'temporary' ? 'Temporary session' : project.creation.title, used = 0, pinned = false, copyDraft?: string): Tab {
  const id = crypto.randomUUID();
  const root = document.createElement('section'); root.className = 'session-view'; root.id = `panel-${id}`; root.setAttribute('role', 'region'); root.hidden = true;
  root.innerHTML = transcript;
  // Retain stable semantic hooks for CSS and root-scoped lookup, with unique DOM/ARIA IDs.
  for (const node of root.querySelectorAll<HTMLElement>('[id]')) { node.dataset.piId = node.id; node.id = `${id}-${node.id}`; }
  const notice = document.createElement('div'); notice.className = 'tab-notice'; notice.hidden = true; root.append(notice);
  conversation.append(root);
  const sessionNotices = installApplicationNotices(window, notices.store, { owner: id, container: root });
  const rowNode = document.createElement('div'); rowNode.className = 'open-session';
  const row = button('', () => activate(tab, 'row')); row.className = 'session-row'; row.id = `session-${id}`; row.setAttribute('aria-controls', root.id);
  root.setAttribute('aria-labelledby', row.id);
  const { rowLabel, rowIndicator, rowTime, rowHarness } = createSessionRowContent(row, `session-time-${id}`);
  const pinButton = button('', () => { void runSessionRowAction(tab, 'pin'); }); pinButton.className = 'session-pin';
  pinButton.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m16 3 5 5-4 1-3 5v4l-8-8h4l5-3zM9 15l-6 6"/></svg>';
  const closeButton = button('×', () => { void runSessionRowAction(tab, 'close'); }); closeButton.className = 'session-close';
  rowNode.append(row, pinButton, closeButton); required('open-sessions').append(rowNode);
  rowNode.addEventListener('mousedown', event => {
    // Opening a context menu must not blur the composer or select its row.
    if (event.button === 2 || event.button === 0 && event.ctrlKey && isMac(window)) event.preventDefault();
  });
  rowNode.addEventListener('contextmenu', event => {
    event.preventDefault(); event.stopPropagation();
    if (event.clientX || event.clientY) void showSessionContextMenu(tab, { x: event.clientX, y: event.clientY });
    else { const rect = row.getBoundingClientRect(); void showSessionContextMenu(tab, { x: rect.left, y: rect.bottom }); }
  });
  rowNode.addEventListener('keydown', event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault(); event.stopPropagation();
    if (event.repeat) return;
    const rect = row.getBoundingClientRect(); void showSessionContextMenu(tab, { x: rect.left, y: rect.bottom });
  });
  const owner: SessionLifecycleOwner = { starting: false, ended: false };
  let integration!: HarnessSession;
  const tab: Tab = { id, title, pinned, project, get integration() { return integration; }, get lifecycle() { return integration.lifecycle; },
    get token() { return owner.token; }, set token(value) { owner.token = value; },
    get starting() { return owner.starting; }, set starting(value) { owner.starting = value; },
    get ended() { return owner.ended; }, set ended(value) { owner.ended = value; },
    lastUsed: lastUsed(used), root, notice, notices: sessionNotices, closeButton, pinButton, row, rowLabel, rowIndicator, rowTime, rowHarness, rowNode,
    drafts: drafts.fork(), closing: false, restarting: false, deleting: false, deletionExecuting: false,
    awaitingSelection: false, inputCount: 0, unread: false, failed: false,
    view: { setActive() {}, scrollToBottom() {}, dispose() {} } };
  try { integration = harnesses.create(project, sessionHost(tab, owner), request); }
  catch (error) { sessionNotices.dispose(); root.remove(); rowNode.remove(); throw error; }
  tab.failed = blocked(tab);
  root.addEventListener('focusin', event => { if (event.target instanceof HTMLElement) tab.focus = event.target; });
  tab.drafts.select(integration.lifecycle.draftScope ?? (integration.drafts.durability === 'memory' ? `temporary:${workspace}:${id}` : `unassigned:${id}`), copyDraft);
  const ephemeralImages = new Set<string>();
  let imagesDisposed = false;
  function releaseTemporaryImages(): void {
    if (tab.integration.drafts.durability !== 'memory') return;
    const retained = referencedAttachments(tab.drafts.read());
    for (const id of ephemeralImages) if (!retained.has(id)) { temporaryImages.delete(id); ephemeralImages.delete(id); }
  }
  root.addEventListener('nimrod-dispose-images', () => { imagesDisposed = true; for (const id of ephemeralImages) temporaryImages.delete(id); });
  function guardCardAction(): void {
    if (!ready || !workspace || presented !== tab || !tabs.includes(tab) || tab.closing || tab.restarting || tab.deleting || document.querySelector('dialog[open]')) throw new Error('Card action is no longer available');
  }
  tab.view = mountConversationView({
    projectDirectory: workspace,
    interaction: integration.conversation.interaction,
    messageInput: integration.conversation.messageInput,
    sendAutoFollow: () => preferences.sendAutoFollow(),
    autocompleteAccept: () => preferences.autocompleteAccept(),
    performance: settingsSurface.performanceProbe,
    reportNotice: notice => {
      if (unloading || tab.closing || !tabs.includes(tab)) return;
      notices.report({ ...notice, id: `${tab.id}:${notice.id}`, owner: notice.cause === 'draft-storage' ? undefined : tab.id, operation: notice.operation });
    },
    resolveNotice: id => notices.resolve(`${tab.id}:${id}`),
    resolveNoticeCause: cause => notices.store.resolveCause(cause, tab.id),
    cardSource: { backend: project.id },
    cardRenderer: data => cardPlugins.select(data),
    cardActions: {
      copy: async text => { guardCardAction(); await writeText(text); },
      openLink: async href => { guardCardAction(); await invoke('open_card_link', { href }); },
      popOutCode: async (text, language) => {
        guardCardAction();
        popouts.open({ session: tab.id, title: tab.title, text, language }, () => {
          try { guardCardAction(); return true; } catch { return false; }
        });
        await popouts.settled();
      },
    },
    attachments: {
      readClipboard: readClipboardImage,
      put: async (blob, name) => {
        if (integration.drafts.durability !== 'memory') return attachmentStore.put(blob, name);
        const { validateImageDimensions } = await import('./image-attachments');
        await validateImageDimensions(blob);
        if (imagesDisposed) throw new Error('Temporary session closed while preparing image.');
        const image = { id: crypto.randomUUID(), name: name.slice(0, 200), mimeType: blob.type, size: blob.size };
        if ([...temporaryImages.values()].reduce((sum, item) => sum + item.size, 0) + blob.size > 128 * 1024 * 1024) throw new Error('Temporary image storage is full (128 MiB). Close unused temporary sessions.');
        temporaryImages.set(image.id, blob); ephemeralImages.add(image.id); return image;
      },
      get: async image => {
        if (integration.drafts.durability !== 'memory') return attachmentStore.get(image);
        const blob = temporaryImages.get(image.id);
        if (!blob) throw new Error('Temporary image draft is missing.');
        return blob;
      },
    },
    getState: () => tab.drafts.read(),
    setState: value => {
      const previous = tab.drafts.read() as { draft?: string; recovered?: unknown; attachments?: unknown } | undefined;
      try { tab.drafts.write(value); } catch (e) { persistenceError(e); }
      const next = value as typeof previous;
      releaseTemporaryImages();
      // Best-effort durability of cleared drafts, not a gate on prompt dispatch.
      if (tab.integration.drafts.durability !== 'memory' && (previous?.recovered !== next?.recovered || previous?.attachments !== next?.attachments || (previous?.draft && !next?.draft))) void nativeDrafts?.flush().catch(draftPersistenceError);
    },
    onMessage: receive => { tab.receive = receive; },
    promptSubmitted: () => {
      if (!unloading && tabs.includes(tab) && tab.integration.conversation.state && !tab.ended && !tab.closing && !tab.restarting && !tab.deleting) touchTab(tab);
    },
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
      if (tab.closing || tab.restarting) return;
      if (message.type === 'cancelOperation') {
        if (typeof message.id === 'string') cancelConfiguration(tab, message.id);
        return;
      }
      if (message.type === 'selectControl') {
        const action = sessionActions(tab).find(candidate => candidate.id === message.id);
        if (action) void runSessionAction(tab, action.id);
        else if (typeof message.id === 'string') void integration.actions.control(message.id).catch(error => { if (tabs.includes(tab)) notices.report({ id: `${tab.id}:control:${++noticeSequence}`, owner: tab.id, operation: 'Session control', message: String(error) }); });
        return;
      }
      if (message.type === 'inspectMcp') { void runSessionAction(tab, 'mcp'); return; }
      void integration.conversation.handle(message).catch(error => showNotice(tab, String(error)));
    },
  }, root);
  tab.receive?.({ type: 'snapshot', state: { sessionUnavailable: true } });
  tab.view.setActive(false);
  navigation.add(tab); updateTab(tab); return tab;
}
function activate(tab: Tab, intent: SelectionIntent = 'explicit'): void {
  if (!ready) return;
  const plan = navigation.selection(tab, navigationSnapshot(), intent);
  if (!plan) return;
  if (tab.integration.selection.releasesDeferral(intent)) tab.awaitingSelection = false;
  notificationNavigation++;
  if (plan.view !== sidebarView) {
    sidebarView = plan.view;
    if (workspace) save(`nimrod.sidebar.view:${workspace}`, sidebarView);
  }
  active = plan.target;
  presentConversation(navigation.presented(navigationSnapshot()));
  if (presented === tab) tab.unread = false;
  // Effects live at this one boundary; the model never touches Pi or drafts.
  for (const item of tabs) updateTab(item);
  persistTabs(); controls(); syncPopouts();
  if (plan.reveal && presented === tab) revealSidebarRow(required('sidebar-session-panel'), tab.rowNode, intent === 'startup' ? 'prefer-top' : 'nearest');
  if (plan.focus && presented === tab && !document.querySelector('dialog[open]')) (tab.focus?.isConnected ? tab.focus : tab.root.querySelector<HTMLElement>('[data-pi-id="prompt"]'))?.focus({ preventScroll: true });
  selectedConnection.request();
}
function refreshTime(tab: Tab): void {
  updateSessionRowTime(tab.rowTime, tab.lastUsed);
}
function status(tab: Tab) {
  const state = tab.integration.conversation.state, projection = tab.integration.presentation.snapshot();
  // A preview lock is not activity; show Deleting only after confirmation.
  return sessionStatus({ ...tab, deleting: tab.deletionExecuting, blocked: blocked(tab),
    inactive: tab.ended || !state || state.sessionUnavailable, compacting: projection.compacting,
    busy: projection.working, pending: projection.pending });
}
function sessionRow(tab: Tab): SessionListEntry {
  const reference = tab.lifecycle.identity;
  return {
    key: reference ? savedSessionKey(reference) : tab.id,
    title: tab.title, harnessLabel: tab.integration.presentation.snapshot().harnessLabel,
    timestamp: tab.lastUsed || undefined, open: true, status: status(tab), reference,
  };
}
function updateTab(tab: Tab): void {
  measureWork(settingsSurface.performanceProbe, 'sidebar-row-update', () => updateTabPresentation(tab), presented === tab);
}
function updateTabPresentation(tab: Tab): void {
  tab.root.inert = tab.closing || tab.restarting || tab.deleting || tab !== presented;
  const entry = sessionRow(tab), name = sessionListLabel(entry);
  tab.root.setAttribute('aria-busy', String(tab.integration.conversation.state?.busy === true));
  updateSessionRowContent(tab, entry, false);
  tab.row.disabled = !ready;
  tab.row.setAttribute('aria-current', String(tab === presented)); tab.closeButton.setAttribute('aria-label', `Close ${name}`); tab.closeButton.disabled = !ready || tab.deleting || locked(tab) || tab.closing || tab.starting || tab.restarting;
  tab.pinButton.setAttribute('aria-label', `${tab.pinned ? 'Unpin' : 'Pin'} ${name}`);
  tab.pinButton.setAttribute('aria-pressed', String(tab.pinned));
  tab.pinButton.title = tab.pinned ? 'Unpin session' : 'Pin session';
  tab.pinButton.disabled = !canPin(tab);
  tab.rowNode.classList.toggle('pinned', tab.pinned);
  if (tab.pinned) tab.row.setAttribute('aria-label', `${tab.row.getAttribute('aria-label')} — Pinned`);
  if (presented === tab) presentConversation(tab);
  renderSidebar();
}
function showNotice(tab: Tab, text: string, retry = false, details?: string): void {
  tab.notice.hidden = true; tab.notice.replaceChildren();
  notices.report({ id: `${tab.id}:connection`, owner: tab.id, cause: 'connection', priority: 10, operation: 'Session connection', message: text, ...(details === undefined ? {} : { details }),
    actions: retry && !blocked(tab) ? [{ label: 'Retry connection', enabled: () => tabs.includes(tab) && !tab.closing && !tab.restarting && !tab.deleting && !locked(tab), run: () => tab.lifecycle.connect() }] : undefined,
  });
  updateTab(tab);
}
async function withTabDialog<T>(tab: Tab, action: (title: string) => Promise<T>, title: string): Promise<T> {
  tab.inputCount++; updateTab(tab);
  try { return await action(`${tab.title} — ${title}`); }
  finally { tab.inputCount--; if (tabs.includes(tab)) updateTab(tab); }
}
function sessionCommands(tab: Tab) {
  return sessionActions(tab).filter(action => ACTIONS.some(registered => registered.id === action.id))
    .map(action => ({ ...action, next: action.id !== 'cancel-configuration', run: () => runSessionAction(tab, action.id) }));
}
function cancelConfiguration(tab: Tab, key?: string): void {
  if (!tabs.includes(tab) || tab.ended || tab.closing || tab.restarting || tab.deleting || blocked(tab)) return;
  const configuration = sessionConfiguration(tab);
  const target = key ?? configuration?.operations.find(operation => operation.cancellable)?.key;
  if (target) configuration?.cancel?.(target);
}
async function pickConfigurationCancellation(tab: Tab): Promise<void> {
  const configuration = sessionConfiguration(tab);
  const operations = configuration?.operations.filter(operation => operation.cancellable) || [];
  if (operations.length <= 1) { if (operations[0]) cancelConfiguration(tab, operations[0].key); return; }
  const request = palette.startSelection('Cancel pending configuration change', () => { void pickConfigurationCancellation(tab); });
  if (!request) return;
  tab.cancelPreference?.(); tab.cancelPreference = request.cancel;
  try {
    const key = await request.chooseItems(operations.map(operation => ({ id: operation.key, label: operation.title, detail: operation.text })));
    if (key && tab.cancelPreference === request.cancel && sessionConfiguration(tab) === configuration) cancelConfiguration(tab, key);
  } finally { request.finish(); if (tab.cancelPreference === request.cancel) tab.cancelPreference = undefined; }
}
function sessionConfiguration(tab: Tab) { return tab.integration.configuration.current(); }
function sessionActions(tab: Tab): readonly SessionAction[] {
  return availableSessionActions(tab.integration, () => pickConfigurationCancellation(tab));
}
async function runSessionAction(tab: Tab, id: SessionAction['id']): Promise<void> {
  if (!tabs.includes(tab) || tab.closing || tab.restarting || tab.deleting) return;
  const action = sessionActions(tab).find(action => action.id === id);
  if (!action) return;
  if (action.run) return action.run();
  if (typeof action.configurationSetting === 'string') return pickConfigurationSetting(tab, action.configurationSetting, action.label.replace(/…$/, ''));
  throw new Error('Advertised session action has no implementation');
}
async function pickConfigurationSetting(tab: Tab, setting: string, operation: string): Promise<void> {
  const request = palette.startSelection(operation, () => { void pickConfigurationSetting(tab, setting, operation); }, message => {
    if (tabs.includes(tab) && !tab.closing) notices.report({ id: `${tab.id}:preference:${++noticeSequence}`, owner: tab.id, operation, message });
  });
  if (!request) return;
  const configuration = sessionConfiguration(tab);
  if (!configuration || tab.ended || tab.closing || tab.restarting || tab.deleting || blocked(tab)) { request.error('Resume this session before changing its configuration.'); return; }
  tab.cancelPreference?.(); tab.cancelPreference = request.cancel;
  const valid = () => tabs.includes(tab) && sessionConfiguration(tab) === configuration && tab.cancelPreference === request.cancel
    && !tab.ended && !tab.closing && !tab.restarting && !tab.deleting;
  try {
    await pickConfiguration(configuration, setting,
      (options, current) => request.chooseItems(options.map(option => ({ id: option.value, label: option.label, detail: option.detail, keywords: option.keywords })), current), valid);
  } catch (error) { if (valid()) request.error(String(error)); }
  finally { request.finish(); if (tab.cancelPreference === request.cancel) tab.cancelPreference = undefined; }
}
function cycleTab(direction: 1 | -1): void {
  if (!active || !tabs.length || (tabs.length < 2 && presented)) return;
  const next = navigation.adjacent(active, direction);
  if (next) activate(next);
}
function newNamedSession(): void {
  if (!ready || settings.isOpen) return;
  palette.namedSession(name => newSession('saved', undefined, name));
}
async function newSession(mode: 'saved' | 'temporary' = harnesses.get(harnesses.defaultId).creation.defaultMode, copyDraft?: string, initialName?: string): Promise<void> {
  return newHarnessSession(harnesses.get(harnesses.defaultId), mode, copyDraft, initialName);
}
async function newHarnessSession(project: HarnessProject, mode: 'saved' | 'temporary' = project.creation.defaultMode, copyDraft?: string, initialName?: string): Promise<void> {
  if (!ready || !project.initialization.ready() || settings.isOpen || !await ensureWorkspace()) return;
  if (!ready || unloading || settings.isOpen) return;
  project.history.associate();
  let tab: Tab;
  try { tab = createTab({ mode, initialName }, project, undefined, navigation.nextRecency(), false, copyDraft); }
  catch (error) { notices.report({ id: `create-session:${++noticeSequence}`, operation: 'Create session', message: String(error) }); return; }
  activate(tab); await tab.lifecycle.connect({ acceptedAction: true });
}
async function openSavedSession(entry: SessionListEntry): Promise<void> {
  if (!entry.reference) throw new Error('This session has no saved identity');
  if (deletions.removed(sessionListItem(entry).id)) throw new Error('The selected session was deleted. Refresh history and choose another session.');
  await openSavedReference(entry.reference, entry.title, lastUsed(entry.timestamp));
}
async function openSavedReference(reference: SavedSessionIdentity, title = 'Session', timestamp = 0): Promise<void> {
  if (!ready || settings.isOpen || !await ensureWorkspace() || unloading) return;
  const project = harnesses.forReference(reference), key = project.saved.key(reference);
  const existing = () => tabs.find(tab => tab.project === project && tab.lifecycle.key === key);
  const selectExisting = (tab: Tab) => {
    if (!tab.lifecycle.identity || savedSessionKey(tab.lifecycle.identity) !== savedSessionKey(reference)) throw new Error('This session is open with a different saved session identity. Close it and refresh history before resuming it.');
    activate(tab);
  };
  project.history.associate();
  const open = existing(); if (open) { selectExisting(open); return; }
  const prepared = await project.saved.prepare(reference, { title, lastUsed: timestamp }, false);
  if (!ready || unloading || settings.isOpen) return;
  const concurrent = existing(); if (concurrent) { selectExisting(concurrent); return; }
  const tab = createTab(prepared.request, project, prepared.title, prepared.lastUsed);
  tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  activate(tab); await tab.lifecycle.connect({ acceptedAction: true });
}
async function restartSession(tab: Tab): Promise<void> {
  if (!ready || tab.deleting || locked(tab) || blocked(tab) || !tabs.includes(tab) || !restartable(tab) || tab.starting || tab.closing || tab.restarting || settings.isOpen) return;
  const restart = tab.integration.restart;
  if (!restart.supported) return;
  const needsConfirmation = restart.needsConfirmation(!!tab.inputCount);
  tab.restarting = true; updateTab(tab);
  let resumed = false;
  try {
    if (needsConfirmation && !await dialogs.confirm(`Restart ${tab.title}?`, restart.confirmation, undefined, 'Restart session')) return;
    if (!tabs.includes(tab)) return;
    resumed = true; await restart.run();
  } catch (error) { showNotice(tab, `Could not restart ${tab.lifecycle.label}: ${error}`); }
  finally {
    tab.restarting = false; if (tabs.includes(tab)) updateTab(tab); controls();
    if (resumed && presented === tab && !tab.ended && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  }
}
async function deleteSavedSession(saved: SavedSessionIdentity, title: string): Promise<void> {
  if (unloading || settings.isOpen || !ready || deletions.pending) throw new Error('Session deletion is currently unavailable.');
  const operation = deletions.operation(saved, title);
  if (!operation?.available()) throw new Error(operation?.unavailableReason || 'Deletion is unavailable for this session. Refresh history or finish its pending lifecycle operation.');
  await operation.run();
}
async function deleteSession(tab: Tab): Promise<void> {
  if (settings.isOpen || !deletable(tab)) return;
  await tabDeletion(tab)!.run();
}
function removeDeletedSessions(targets: readonly SessionDeletionTarget[]): void {
  const keys = targets.map(target => target.key);
  const deleted = new Set(keys), before = navigationSnapshot(), selected = active;
  if (recency.delete(keys) && workspace) save(recencyKey(), recency.dump());
  const removed = tabs.filter(tab => tab.lifecycle.key !== undefined && deleted.has(tab.lifecycle.key));
  // Dispose the entire subtree before selecting or persisting a replacement.
  for (const tab of removed) disposeTab(tab);
  for (const target of targets) {
    try { drafts.deleteScope(target.draftScope); } catch (e) { persistenceError(e); }
  }
  void nativeDrafts?.flush().catch(draftPersistenceError);
  if (selected && removed.includes(selected)) selectCleanupReplacement(before);
  controls(); persistTabs(); syncPopouts();
}
function selectCleanupReplacement(before: NavigationSnapshot<Tab>): void {
  const replacement = navigation.replacement(before, navigationSnapshot());
  if (replacement.view !== sidebarView) selectSidebarView(replacement.view);
  if (replacement.target) activate(replacement.target, 'cleanup');
  else { conversation.hidden = true; required('mode-badge').textContent = ''; }
}
function disposeTab(tab: Tab): void {
  if (!tabs.includes(tab)) return;
  tab.closing = true;
  tab.root.dispatchEvent(new Event('nimrod-dispose-images'));
  tab.integration.interactions.dispose();
  tab.notices.dispose(); notices.store.resolveOwner(tab.id);
  navigation.remove(tab);
  if (active === tab) active = undefined;
  if (presented === tab) { tab.view.setActive(false); presented = undefined; conversation.hidden = true; }
  if (tab.token) dialogs.cancel(tab.token);
  tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' }); tab.lifecycle.disconnect('Session closed');
  tab.view.dispose();
  try { tab.drafts.discardTemporary(); } catch (e) { persistenceError(e); }
  tab.root.remove(); tab.rowNode.remove();
}
function detachTab(tab: Tab): void {
  if (!tabs.includes(tab)) return;
  tab.closing = true;
  tab.integration.interactions.dispose();
  tab.notices.dispose(); notices.store.resolveOwner(tab.id);
  if (tab.token) dialogs.cancel(tab.token);
  tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' }); tab.lifecycle.disconnect('Session closed');
  const before = navigationSnapshot();
  navigation.remove(tab); tab.view.dispose();
  try { tab.drafts.discardTemporary(); } catch (e) { persistenceError(e); }
  tab.root.remove(); tab.rowNode.remove();
  if (presented === tab) presentConversation(undefined);
  if (active === tab) {
    active = undefined;
    selectCleanupReplacement(before);
  }
  for (const item of tabs) updateTab(item);
  controls(); persistTabs(); syncPopouts();
}
async function closeTab(tab: Tab): Promise<void> {
  if (tab.deleting || locked(tab) || tab.closing || tab.starting || tab.restarting || settings.isOpen) return;
  const snapshot = tab.integration.presentation.snapshot(), policy = tab.integration.close;
  const running = !!tab.integration.conversation.state && !tab.ended;
  if ((policy.alwaysConfirm || running && (snapshot.busy || snapshot.pending || tab.inputCount || snapshot.queuePending))
    && !await dialogs.confirm(`Close ${tab.title}?`, policy.message, undefined, policy.label)) return;
  if (tab.closing || !tabs.includes(tab)) return;
  tab.closing = true; updateTab(tab);
  try {
    await nativeDrafts?.flush();
    await tab.lifecycle.stop();
    tab.receive?.({ type: 'sessionDisconnected' }); tab.lifecycle.disconnect('Disconnected');
    await nativeDrafts?.flush();
    if (tab.token) dialogs.cancel(tab.token);
    detachTab(tab);
  } catch (e) { tab.closing = false; showNotice(tab, `Could not stop ${tab.lifecycle.label}: ${e}`); updateTab(tab); }
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
required('browse').addEventListener('click', () => void pickWorkspace());
required('enter-workspace').addEventListener('click', () => void openWorkspace(cwd.value.trim()));
required('resume-last').addEventListener('click', () => { const last = lastSession(); if (last) void (async () => { if (workspace !== last.project && !await openWorkspace(last.project)) return; await openSavedReference(last.reference); })().catch(failure => { error.textContent = String(failure); }); });
required('recover-draft').addEventListener('click', () => {
  const options = recoverableDrafts();
  void dialogs.choose('Recover draft into a new session (never sent automatically)', options.map((o, i) => `${i + 1}. ${o.label}`)).then(choice => {
    const index = choice ? Number.parseInt(choice, 10) - 1 : -1; if (options[index]) return newSession('saved', options[index].key);
  });
});
required('restart-session').addEventListener('click', () => { if (presented) void restartSession(presented); });
required('delete-session').addEventListener('click', () => { if (presented) void runSessionRowAction(presented, 'delete'); });
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
  const next = event.key === 'Home' ? visible[0] : event.key === 'End' ? visible[visible.length - 1] : event.key === 'ArrowDown' ? navigation.adjacent(visible[index], 1, visible) : event.key === 'ArrowUp' ? navigation.adjacent(visible[index], -1, visible) : undefined;
  if (next) { event.preventDefault(); next.row.focus(); }
});
function shortcutHint(id: ActionId): string {
  return bindingsFor(id, preferences.keybindings()).map(binding => shortcutLabel(binding, isMac(window))).join(' / ');
}
function refreshShortcutHints(): void {
  const settingsButton = required('open-settings');
  if (!settingsButton.classList.contains('error')) {
    const label = preferences.projectPath ? 'Project settings' : 'Global Settings';
    settingsButton.title = [label, shortcutHint(preferences.projectPath ? 'project-settings' : 'settings')].filter(Boolean).join(' · ');
    settingsButton.setAttribute('aria-label', label);
  }
  settingsButton.setAttribute('aria-haspopup', preferences.projectPath ? 'dialog' : 'false');
  if (preferences.projectPath) settingsButton.setAttribute('aria-controls', 'settings-page');
  else settingsButton.removeAttribute('aria-controls');
  required('toggle-sidebar').title = ['Toggle sidebar', shortcutHint('sidebar')].filter(Boolean).join(' · ');
  required('zoom-level').title = ['App zoom', shortcutHint('zoom-in'), shortcutHint('zoom-out'), shortcutHint('zoom-reset')].filter(Boolean).join(' · ');
  const zoomHint = required('zoom-shortcut-hint');
  if (zoomHint) zoomHint.textContent = `Zoom in: ${shortcutHint('zoom-in') || 'unbound'} · Zoom out: ${shortcutHint('zoom-out') || 'unbound'} · Reset to 100%: ${shortcutHint('zoom-reset') || 'unbound'}. Shortcuts pause in other dialogs.`;
}
function openKeybindings(): Promise<void> { return invoke('open_global_settings', { category: 'keybindings' }); }
async function runApplication(id: ApplicationActionId): Promise<void> {
  const cause = 'application-action:' + id;
  try { await runApplicationAction(id); notices.resolve(cause); }
  catch (error) { notices.report({ id: cause, operation: actionDefinition(id).label, message: String(error) }); }
}
async function takeProjectSettingsRequest() {
  const requested = await invoke<boolean>('take_project_settings_request');
  if (requested && workspace) settings.open();
}
const unlistenProjectSettings = await listen('nimrod-project-settings', () => { if (ready) void takeProjectSettingsRequest().catch(persistenceError); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
const keybindingDispatch = installKeybindingDispatch(window, {
  read: () => preferences.keybindings(),
  enabled: id => {
    if (unloading) return false;
    const contributed = new Set<string>();
    if (presented) {
      for (const action of sessionActions(presented)) contributed.add(action.id);
      contributed.add('close');
      if (canPin(presented)) contributed.add('pin');
      if (restartable(presented)) contributed.add('restart');
      if (tabDeletion(presented)?.available()) contributed.add('delete');
    }
    if (!actionContextAvailable(id, { project: !!workspace, sessionActions: contributed })) return false;
    if (actionDefinition(id).context === 'application') return true;
    if (!ready) return false;
    const creation = harnesses.projects.find(project => project.creation.action?.id === id);
    if (creation) return creation.initialization.ready();
    if (id === 'new-named') return harnesses.get(harnesses.defaultId).creation.named;
    if (id === 'temporary') return harnesses.get(harnesses.defaultId).creation.modes.includes('temporary');
    if (id === 'capture-performance') return preferences.performanceEnabled() && !settingsSurface.capturingPerformance;
    if (actionDefinition(id).context === 'session' && !['pin', 'close', 'delete', 'restart'].includes(id)) return !!presented && sessionActions(presented).some(action => action.id === id);
    return true;
  },
  run: (id: ActionId) => {
    if (isApplicationAction(window, id)) return runApplication(id);
    const creation = harnesses.projects.find(project => project.creation.action?.id === id);
    if (creation) return newHarnessSession(creation);
    if (presented && sessionActions(presented).some(action => action.id === id)) return runSessionAction(presented, id);
    switch (id) {
      case 'open-recent-project': return palette.projects();
      case 'new': return newSession();
      case 'temporary': return newSession('temporary');
      case 'delete': return presented ? runSessionRowAction(presented, 'delete') : undefined;
      case 'pin': return presented ? runSessionRowAction(presented, 'pin') : undefined;
      case 'delete-sessions': return palette.deleteSessions();
      case 'capture-performance': return capturePerformance(true);
      case 'reload-card-plugins': return reloadCardPlugins(true);
      case 'select-theme': return pickTheme();
      case 'palette': palette.open(); return;
      case 'close': return presented ? runSessionRowAction(presented, 'close') : undefined;
      case 'sidebar': required<HTMLButtonElement>('toggle-sidebar').click(); return;
      case 'previous': cycleTab(-1); return;
      case 'next': cycleTab(1); return;
      case 'settings': return invoke('open_global_settings');
      case 'project-settings': settings.open(); return;
      case 'keybindings': return openKeybindings();
      case 'zoom-in': zoom.run('in'); return;
      case 'zoom-out': zoom.run('out'); return;
      case 'zoom-reset': zoom.run('reset'); return;
      case 'resume': return palette.sessions();
      case 'switch-session': return palette.openSessions();
      case 'new-named': return newNamedSession();
      case 'restart': return presented ? restartSession(presented) : undefined;
    }
  },
  error: message => { error.textContent = String(message); },
});
refreshShortcutHints();
async function boot(): Promise<void> {
  controls(); renderRecents();
  try {
    await harnesses.initialize();
    await zoom.ready;
    const defaults = await invoke<{ pi: string; node: string; cwd: string; home?: string }>('runtime_defaults');
    homeDirectory = defaults.home;
    const saved = stored(settingsKey) as Partial<typeof defaults> | null;
    cwd.value = typeof saved?.cwd === 'string' ? saved.cwd : defaults.cwd;
    settingsSurface.initializeRuntime(defaults);
    const path = await invoke<string | null>('window_workspace');
    ready = true;
    if (path) { await enterWorkspace(path); syncPopouts(); }
    controls();
    await takeProjectSettingsRequest();
    await takeProjectPickerRequest();
  } catch (e) { error.textContent = `Could not initialize the native host: ${e}`; }
}
void boot();
}
if (new URLSearchParams(location.search).has('popout')) {
  document.body.replaceChildren();
  void import('./popout').then(module => module.mountPopout());
} else if (new URLSearchParams(location.search).has('settings')) {
  void import('./global-settings').then(module => module.mountGlobalSettings());
} else {
  void main().catch(e => {
    applicationNotices?.report({ id: 'startup', operation: 'Start Nimrod', message: `Could not initialize preferences: ${e}` });
    required('welcome').hidden = false;
  });
}
