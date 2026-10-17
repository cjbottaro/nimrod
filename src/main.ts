import { AcpSession } from './acp/session';
import { CopilotSession } from './copilot/session';
import { CopilotSessionHistory, copilotHistoryKey } from './copilot/session-history';
import { copilotSessionDeletion } from './copilot/session-deletion';
import { copilotSessionLifecycle, copilotSdkScope } from './copilot/session-lifecycle';
import { copilotInteraction } from './copilot/view-policy';
import { piSessionDeletion } from './pi/session-deletion';
import { SessionDeletionCoordinator } from './session-deletion-coordinator';
import type { SessionDeletionOperation, SessionDeletionTarget } from './session-deletion-operation';
import { PiSessionHistory, type PiSessionSummary as SessionSummary } from './pi/session-history';
import { loadSessionHistory, type SessionHistory, type SessionHistorySnapshot } from './session-history';
import { savedSessionKey, resolveSessionListEntry, type SessionListEntry } from './session-list';
import { renderPermissionDetails } from './acp/tool-state';
import { acpInteraction } from './acp/view-policy';
import { createPiViewProjection, piInteraction } from './pi/view-policy';
import { piSession, acpSession, copilotSession, acpProfile as profileFor, sessionActions, type SessionAction, type SessionBackend } from './session-backend';
import { piSessionLifecycle } from './pi/session-lifecycle';
import type { SessionFile } from './pi/session-file';
import { startPiSession, type PiLaunchInfo } from './pi/session-startup';
import { acpSessionLifecycle } from './acp/session-lifecycle';
import { readSavedSidebarSession, type SessionLifecycle, type LaunchMode, type SavedSidebarSession, type SavedSessionIdentity } from './session-lifecycle';
import type { ConversationViewMessage, ConversationView } from './conversation-view-host';
import type { AcpProfile } from './acp/profiles';
import { mountConversationView } from './conversation-view';
import { installApplicationNotices } from './application-notices';
import { Channel, invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { notificationPreview, sessionNotifications, type NotificationDispatch, type NotificationClick } from './notifications';
import { SessionNavigation, SESSION_VIEWS, type SessionView, type SelectionIntent, type NavigationSnapshot } from './session-navigation';
import { SessionConnection } from './session-connection';
import { installSidebarResize, sidebarWidthKey } from './sidebar-resize';
import { lastUsed, sortByRecency, captureSidebarScroll, revealSidebarRow, SessionRecency } from './session-recency';
import { sessionStatus, sessionListLabel, createSessionRowContent, updateSessionRowContent, updateSessionRowTime, installSessionTimeRefresh } from './session-sidebar';
import { installDeletionReview } from './deletion-review';
import type { DeletionEvent, DeletionSnapshot } from './session-deletion';
import { presentActivity } from './pi/activity-state';
import { messageChanges, messageVersion } from './pi/conversation-index';
import type { ConversationState } from './pi/types';
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
import type { HostMessage } from './pi/webview-client';
import { PiTransport, type Packet } from './pi/transport';
import { PiSession } from './pi/session';
import { SessionDrafts, type LastSession } from './pi/session-drafts';
import { NativeDrafts } from './native-drafts';
import { referencedAttachments } from './pi/image-attachments';
import { restoreComposerState } from './pi/webview-state';
import { Dialogs } from './dialogs';
import { COMMAND_USAGE_KEY, readCommandUsage } from './command-ranking';
import { abbreviateHome, projectPathParts } from './project-path';
import { installCommandPalette, type PalettePage } from './command-palette';
import { ACTIONS, bindingsFor, installKeybindingDispatch, isMac, shortcutLabel, type ActionId } from './keybindings';
import { installSessionPopouts } from './session-popouts';
import transcript from './pi/transcript.html?raw';
import './pi/transcript.css';
import './acp/session.css';
import './theme.css';
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
const lastKey = 'nimrod.last-session.v1';
const localState = new Map<string, unknown>();
const attachmentStore = new AttachmentStore();
const temporaryImages = new Map<string, Blob>();
let ready = false;
let acpReady = false;
let copilotReady = false;
let copilotGeneration = '';
let unloading = false;
let workspace: string | undefined;
let copilotHistory: CopilotSessionHistory | undefined;
let homeDirectory: string | undefined;
let opening: Promise<boolean> | undefined;
let sidebarVisible = stored('nimrod.sidebar.visible') !== false;
let active: Tab | undefined;
// Remember navigation separately from the conversation actually shown by the filter.
let presented: Tab | undefined;
const navigation = new SessionNavigation<Tab>({ needsAttention, isWorking, isConnected });
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
  popouts.sync(tabs.map(tab => ({ runtimeId: tab.id, pi: tab.file?.exists && tab.mode !== 'temporary'
    ? { path: tab.file.path, sessionId: tab.file.sessionId } : null })), presented?.id ?? null);
}
interface Tab {
  readonly backend: SessionBackend;
  readonly lifecycle: SessionLifecycle;
  id: string; token?: string; title: string; lastUsed: number; mode: LaunchMode; file?: SessionFile;
  root: HTMLElement; view: ConversationView; drafts: SessionDrafts; receive?: (message: HostMessage | ConversationViewMessage) => void;
  starting: boolean; closing: boolean; restarting: boolean; deleting: boolean; deletionExecuting: boolean; ended: boolean;
  awaitingSelection: boolean;
  inputCount: number; unread: boolean; failed: boolean; focus?: HTMLElement; notice: HTMLElement;
  notices: ReturnType<typeof installApplicationNotices>;
  cancelPreference?: () => void;
  cancelInspector?: () => void;
  preferenceTask?: Promise<void>;
  closeButton: HTMLButtonElement; deleteButton: HTMLButtonElement;
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
function lastSession(): LastSession | undefined {
  if (workspace) return drafts.last?.cwd === workspace ? drafts.last : undefined;
  const last = stored(lastKey) as Partial<LastSession> | null;
  return last && typeof last.path === 'string' && typeof last.cwd === 'string' && typeof last.sessionId === 'string' ? last as LastSession : drafts.last;
}
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
const deletions = new SessionDeletionCoordinator({
  canRun: (reference, target) => {
    if (!ready || unloading || settings.isOpen) return false;
    if ('kind' in reference && tabs.some(tab => tab.backend.kind !== 'pi' && tab.backend.kind !== reference.kind && tab.lifecycle.identity?.sessionId === reference.sessionId)) return false;
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
      tab.cancelPreference?.(); tab.cancelInspector?.();
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
const piDeletion = deletions.register(context => piSessionDeletion({
  panels: () => tabs.filter(tab => tab.file?.exists && tab.mode !== 'temporary').map(tab => ({
    file: tab.file!.path,
    lock: locked => { tab.deleting = locked; if (!locked) tab.deletionExecuting = false; tab.receive?.({ type: 'deletionLock', locked }); updateTab(tab); },
    executionStarted: () => { tab.deletionExecuting = true; updateTab(tab); },
    report: () => {
      const composer = restoreComposerState(tab.drafts.read());
      return { file: tab.file!.path, token: tab.token, title: tab.title, busy: deletionBusy(tab), hasDraft: !!(composer.draft.trim() || composer.attachments?.length || composer.recovered.length) };
    },
    deleted: () => context.removed([{ key: tab.file!.path, draftScope: `file:${tab.file!.path}` }]),
    failed: message => {
      tab.ended = true; piSession(tab)?.rpc.disconnect('Session deletion did not complete');
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
  confirm: (id, confirmed) => invoke('confirm_session_deletion', { id, confirmed }),
}, context));
const deletion = piDeletion.transaction;
deletions.register(context => copilotSessionDeletion(() => copilotHistory, context));
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
    !tab.starting && !tab.closing && !tab.restarting && !tab.deleting && !deletion.locked(tab.file?.path) && !deletion.blocked(tab.file?.path);
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
const unlistenDeletion = await listen<DeletionEvent>('nimrod-session-deletion', event => { void deletion.handle(event.payload); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
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
  void copilotHistory?.dispose().catch(error => console.error('Could not stop Copilot history discovery', error));
  notices.dispose();
  settingsSurface.dispose();
  disposeTimeRefresh(); unlistenDraftErrors(); unlistenDraftClose();
  pluginLoading.dispose();
  sidebarResize.dispose(); preferences.dispose(); popouts.dispose(); unlistenPopoutErrors(); unlistenLinkErrors(); deletions.dispose(); deletionReview.dispose(); unlistenDeletion(); unlistenNotificationClicks();
  for (const tab of tabs) { tab.notices.dispose(); tab.receive?.({ type: 'sessionDisconnected' }); tab.view.dispose(); tab.lifecycle.disconnect('Window closed'); }
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
  const state = tab.backend.session?.state;
  return !tab.starting && !tab.closing && !tab.restarting && !tab.deleting && !tab.ended && !tab.inputCount &&
    !!state && !state.sessionUnavailable && (state.busy || !!presentActivity(false, '', piSession(tab)?.state.extensionStatuses).subagents);
}
function isConnected(tab: Tab): boolean {
  return tab.lifecycle.connection === 'connected' &&
    !tab.closing && !tab.restarting && !tab.deleting && !deletion.blocked(tab.file?.path);
}
function navigationSnapshot(): NavigationSnapshot<Tab> { return navigation.snapshot(sidebarView, presented, active); }
function sidebarTabs(): readonly Tab[] { return navigationSnapshot().visible; }
function touchTab(tab: Tab): void {
  tab.lastUsed = navigation.nextRecency();
  refreshTime(tab);
  renderSidebar(tab.rowNode);
  // All/Working use recency order; Unread keeps its independent arrival order.
  if (presented === tab && sidebarView !== 'unread') required('sidebar-session-panel').scrollTop = 0;
  persistTabs();
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
  for (const tab of tabs) tab.rowNode.hidden = !membership.has(tab);
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
      copilotSession(presented)?.cancelCommands();
      const focused = document.activeElement;
      if (focused instanceof HTMLElement && presented.root.contains(focused)) {
        presented.focus = focused;
        if (!tab && !document.querySelector('dialog[open]')) required(`sidebar-${sidebarView}`).focus({ preventScroll: true });
      }
      presented.notices.setActive(false); presented.view.setActive(false); presented.root.hidden = true; presented.root.inert = true;
    }
    presented = tab;
    conversation.hidden = !tab;
    if (tab) { tab.root.hidden = false; tab.view.setActive(true); tab.notices.setActive(true); }
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
  badge.textContent = !tab ? '' : tab.backend.kind === 'copilot-sdk' ? 'Copilot' : profileFor(tab) ? `${profileFor(tab)!.name} · ACP POC` : tab.mode === 'temporary' ? 'Pi · temporary' : tab.file?.exists ? 'Pi' : 'Pi · awaiting first save';
  badge.title = tab?.file?.path || '';
  restartControl();
}
function promptPending(tab: Tab): boolean {
  const backend = tab.backend;
  return backend.kind === 'acp' ? backend.session?.client.phase === 'working' : backend.kind === 'copilot-sdk' ? backend.session?.state.busy === true : backend.session?.rpc.hasPendingRequest('prompt', 'set_session_name') ?? false;
}
function deletionBusy(tab: Tab): boolean {
  const state = piSession(tab)?.state;
  return tab.starting || tab.closing || tab.restarting || !!tab.inputCount || promptPending(tab) || !!(state && !tab.ended && (state.busy || state.compacting || state.modelControls.changing || state.sessionUnavailable || state.queue.pendingCount || state.queue.steering.length || state.queue.followUp.length || presentActivity(false, '', state.extensionStatuses).subagents));
}
function restartable(tab: Tab): boolean { return tab.backend.kind === 'pi' && !!tab.file?.exists && tab.mode !== 'temporary'; }
function deletable(tab: Tab | undefined): boolean {
  return ready && !deletions.pending && !!tab && tabs.includes(tab) && !!tabDeletion(tab)?.available() &&
    !tab.deleting && !tab.starting && !tab.closing && !tab.restarting;
}
function restartControl(): void {
  const active = presented;
  const button = required<HTMLButtonElement>('restart-session');
  button.disabled = !ready || !active || !restartable(active) || active.deleting || deletion.locked(active.file?.path) || deletion.blocked(active.file?.path) || active.starting || active.closing || active.restarting;
  const remove = required<HTMLButtonElement>('delete-session');
  remove.disabled = !deletable(active);
  const operation = tabDeletion(active);
  remove.setAttribute('aria-label', operation?.label.replace('…', '') || 'Delete session');
  const unavailable = !active ? 'no open session' : deletions.pending ? 'deletion pending'
    : !operation?.available() ? operation?.unavailableReason || 'requires saved history and harness deletion support'
    : active.starting || active.closing || active.restarting ? 'session lifecycle operation pending' : undefined;
  remove.title = `${operation?.label || 'Delete session…'}${unavailable ? ` — ${unavailable}` : ''}`;
  button.title = !active ? 'Restart session — no open session' : active.backend.kind === 'copilot-sdk' ? 'Restart session — unavailable for Copilot; Close and Resume explicitly' : profileFor(active) ? 'Restart session — unavailable in the ACP POC' : deletion.blocked(active.file?.path) ? 'Restart session — recover through Resume session first' : active.mode === 'temporary'
    ? 'Restart session — unavailable for temporary sessions' : !active.file?.exists
    ? 'Restart session — available after the first save' : active.restarting ? 'Restarting session…' : 'Restart session';
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
    if (identity && 'path' in identity && recency.record(identity, tab.lastUsed)) changed = true;
  }
  if (changed) save(recencyKey(), recency.dump());
  save(layoutKey(), { tabs: tabs.flatMap<SavedSidebarSession>(tab => {
    const identity = tab.lifecycle.identity;
    return identity ? [{ ...identity, name: tab.title, lastUsed: tab.lastUsed }] : [];
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
  if (recency.delete(Object.keys(recency.dump()).filter(file => deletion.removed(file)))) save(recencyKey(), recency.dump());
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
    const t = readSavedSidebarSession(value);
    if (!t) continue;
    if ('kind' in t) {
      if (tabs.some(tab => tab.lifecycle.key === copilotSdkScope(t.sessionId))) continue;
      const tab = createTab('resume', undefined, t.name, lastUsed(t.lastUsed), undefined, t.sessionId, true);
      tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
      continue;
    }
    if (deletion.removed(t.path) || tabs.some(tab => tab.lifecycle.key === t.path)) continue;
    let used = Math.max(lastUsed(t.lastUsed), recency.get({ path: t.path, sessionId: t.sessionId }));
    if (!used) {
      try {
        const info = await invoke<SessionFile>('inspect_workspace_session', { path: t.path });
        if (info.path === t.path && info.sessionId === t.sessionId) used = lastUsed(info.lastUserMessageAt);
      } catch { /* Retain unreadable entries/drafts for explicit recovery; never substitute mtime. */ }
    }
    if (unloading) return;
    if (deletion.removed(t.path)) continue;
    const tab = createTab('resume', { path: t.path, sessionId: t.sessionId, exists: true }, typeof t.name === 'string' ? t.name : 'Session', used);
    tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  }
  ready = true;
  if (tabs.some(tab => tab.backend.kind === 'copilot-sdk')) rememberCopilot();
  else startCopilotHistory();
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
const piHistory = new PiSessionHistory({
  catalog: () => invoke('list_workspace_sessions'),
  inspect: path => invoke('inspect_workspace_session', { path }),
  open: () => tabs.map(sessionRow),
  removed: path => deletion.removed(path),
  recency: reference => recency.get(reference),
});
function historyError(source: string, label: string, message: string): void {
  if (!unloading) notices.report({ id: `history:${source}`, operation: `Read ${label} history`, message });
}
function startCopilotHistory(): CopilotSessionHistory | undefined {
  if (!workspace || unloading || !copilotReady || stored(copilotHistoryKey(workspace)) !== true) return;
  if (!copilotHistory) {
    const project = workspace;
    copilotHistory = new CopilotSessionHistory(project, {
      start: (token, receive, disconnected) => {
        const onEvent = new Channel<Packet>();
        onEvent.onmessage = packet => { if (packet.kind === 'rpc') receive(packet.value); else disconnected(packet.message); };
        return invoke('start_copilot', { token, config: { cwd: project, node: runtime.current().node, cli: runtime.current().copilot, generation: copilotGeneration }, onEvent });
      },
      send: (token, message) => invoke('write_copilot', { token, message }),
      stop: token => invoke('stop_copilot', { token }),
      error: error => {
        historyError('copilot-sdk', 'Copilot', String(error));
        if (!unloading) { for (const tab of tabs) updateTab(tab); controls(); }
      },
    });
    void copilotHistory.initialize().then(() => {
      if (!unloading) { for (const tab of tabs) updateTab(tab); controls(); }
    }).catch(error => historyError('copilot-sdk', 'Copilot', String(error)));
  }
  return copilotHistory;
}
function rememberCopilot(): void {
  if (!workspace) return;
  save(copilotHistoryKey(workspace), true);
  startCopilotHistory();
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
  const sources: SessionHistory[] = [piHistory];
  if (stored(copilotHistoryKey(workspace)) === true) {
    const history = startCopilotHistory();
    if (history) sources.push(history);
    else historyError('copilot-sdk', 'Copilot', 'Copilot history is unavailable while the SDK host is unavailable or initializing. Use Refresh after resolving the problem. Pi history remains available.');
  }
  const project = workspace;
  const page = (snapshot: SessionHistorySnapshot): PalettePage => {
    const open = tabs.map(sessionRow);
    const entries = snapshot.entries.map(entry => resolveSessionListEntry(entry, open))
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
    { id: 'open-recent-project', label: 'Open recent project…', detail: 'Open or focus a previously opened project', next: true, run: () => palette.projects() },
    { id: 'capture-performance', label: 'Capture performance report', detail: settingsSurface.performancePath ? `Last report: ${settingsSurface.performancePath}` : 'Save recent timing data and copy its path; enable in global Settings → Diagnostics first.', run: () => capturePerformance(true) },
    { id: 'reload-card-plugins', label: 'Reload card plugins', detail: 'Rescan personal sources and refresh renderers for new cards; no Pi restart', run: () => reloadCardPlugins(true) },
    { id: 'select-theme', label: 'Select theme…', detail: 'Preview bundled VS Code themes and saved imports', next: true, run: () => pickTheme() },
    { id: 'resume', label: 'Resume session…', detail: 'Open a saved conversation in this project', next: true, run: () => palette.sessions() },
    { id: 'delete-sessions', label: 'Delete sessions…', detail: 'Repeatedly review and delete supported saved sessions in this project', next: true, run: () => palette.deleteSessions() },
    { id: 'new', label: 'New session', detail: 'Pi · persistent conversation (default harness)', run: () => newSession() },
    ...(copilotReady ? [{ id: 'new-copilot', label: 'New Copilot session', detail: 'Start a Copilot session', run: newCopilotSession }] : []),
    { id: 'new-named', label: 'New named session…', detail: 'Choose a name before starting', next: true, run: newNamedSession },
    ...(tabs.length ? [{ id: 'switch-session', label: 'Switch session…', detail: 'All open sessions, regardless of sidebar view', next: true, run: () => palette.openSessions() }] : []),
    ...(active ? sessionCommands(active) : []),
    ...(active && restartable(active) ? [
      { id: 'restart', label: 'Restart session', detail: 'Restart Pi and retain this conversation', run: () => restartSession(active!) },
    ] : []),
    ...(active && tabDeletion(active)?.available() ? [{
      id: 'delete', label: tabDeletion(active)!.label, detail: tabDeletion(active)!.detail, run: () => deleteSession(active),
    }] : []),
    { id: 'temporary', label: 'New temporary session', detail: 'Pi · conversation without saved history', run: () => newSession('temporary') },
    ...(active ? [{ id: 'close', label: 'Close session', detail: 'Stop its agent and remove it from the sidebar; saved history stays', run: () => closeTab(active!) }] : []),
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
function createTab(mode: LaunchMode, file?: SessionFile, title = mode === 'temporary' ? 'Temporary session' : 'Session', used = 0, acpProfile?: AcpProfile, copilotSessionId?: string, sdk = false): Tab {
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
  const deleteButton = button('', () => { void deleteSession(tab); }); deleteButton.className = 'session-delete';
  deleteButton.append(required('delete-session').querySelector('svg')!.cloneNode(true));
  const closeButton = button('×', () => { void closeTab(tab); }); closeButton.className = 'session-close';
  rowNode.append(row, deleteButton, closeButton); required('open-sessions').append(rowNode);
  const backend: SessionBackend = sdk ? { kind: 'copilot-sdk', savedSessionId: copilotSessionId } : acpProfile ? { kind: 'acp', profile: acpProfile } : { kind: 'pi' };
  const lifecycle: SessionLifecycle = backend.kind === 'copilot-sdk' ? copilotSessionLifecycle(() => tab, backend, {
    connect: options => launchCopilot(tab, options.acceptedAction),
    stop: token => invoke<void>('stop_copilot', { token }),
    gate: () => copilotReady && !tab.deleting && !deletions.pending ? 'ready' : 'blocked',
  }) : backend.kind === 'acp' ? acpSessionLifecycle(() => tab, backend, {
    connect: options => launchAcp(tab, options.acceptedAction),
    stop: token => invoke<void>('stop_acp', { token }),
    gate: () => acpReady && !tab.deleting ? 'ready' : 'blocked',
  }) : piSessionLifecycle(() => tab, backend, {
    connect: options => launchPi(tab, undefined, options.acceptedAction),
    stop: token => invoke<void>('stop_pi', { token }),
    gate: () => deletion.blocked(tab.file?.path) ? 'unavailable' : tab.deleting || deletion.locked(tab.file?.path) ? 'blocked' : 'ready',
  });
  const tab: Tab = { id, mode, file, title, backend, lifecycle, lastUsed: Math.max(lastUsed(used), file ? recency.get(file) : 0), root, notice, notices: sessionNotices, closeButton, deleteButton, row, rowLabel, rowIndicator, rowTime, rowHarness, rowNode,
    drafts: drafts.fork(), starting: false, closing: false, restarting: false, deleting: false, deletionExecuting: false, ended: false, awaitingSelection: mode === 'resume' && !lifecycle.connectOnStartup, inputCount: 0, unread: false, failed: deletion.blocked(file?.path),
    view: { setActive() {}, scrollToBottom() {}, dispose() {} } };
  root.addEventListener('focusin', event => { if (event.target instanceof HTMLElement) tab.focus = event.target; });
  tab.drafts.select(lifecycle.draftScope ?? (file ? `file:${file.path}` : mode === 'temporary' ? `temporary:${workspace}:${id}` : `unassigned:${id}`));
  const ephemeralImages = new Set<string>();
  let imagesDisposed = false;
  function releaseTemporaryImages(): void {
    if (tab.mode !== 'temporary') return;
    const retained = referencedAttachments(tab.drafts.read());
    for (const id of ephemeralImages) if (!retained.has(id)) { temporaryImages.delete(id); ephemeralImages.delete(id); }
  }
  root.addEventListener('nimrod-dispose-images', () => { imagesDisposed = true; for (const id of ephemeralImages) temporaryImages.delete(id); });
  function guardCardAction(): void {
    if (!ready || !workspace || presented !== tab || !tabs.includes(tab) || tab.closing || tab.restarting || tab.deleting || document.querySelector('dialog[open]')) throw new Error('Card action is no longer available');
  }
  const projectPi = createPiViewProjection();
  tab.view = mountConversationView({
    projectDirectory: workspace,
    interaction: sdk ? copilotInteraction(text => tab.starting || !copilotSession(tab)
      ? 'Copilot is still connecting. Your draft was kept.' : copilotSession(tab)!.validatePrompt(text)) : acpProfile ? acpInteraction(acpProfile.name, text => tab.starting || !acpSession(tab)
      ? 'ACP is still connecting. Your draft was kept.' : acpSession(tab)!.validatePrompt(text)) : piInteraction,
    sendAutoFollow: () => preferences.sendAutoFollow(),
    performance: settingsSurface.performanceProbe,
    reportNotice: notice => {
      if (unloading || tab.closing || !tabs.includes(tab)) return;
      notices.report({ ...notice, id: `${tab.id}:${notice.id}`, owner: notice.cause === 'draft-storage' ? undefined : tab.id, operation: notice.operation });
    },
    resolveNotice: id => notices.resolve(`${tab.id}:${id}`),
    resolveNoticeCause: cause => notices.store.resolveCause(cause, tab.id),
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
    attachments: acpProfile || sdk ? undefined : {
      readClipboard: readClipboardImage,
      put: async (blob, name) => {
        if (mode !== 'temporary') return attachmentStore.put(blob, name);
        const { validateImageDimensions } = await import('./pi/image-attachments');
        await validateImageDimensions(blob);
        if (imagesDisposed) throw new Error('Temporary session closed while preparing image.');
        const image = { id: crypto.randomUUID(), name: name.slice(0, 200), mimeType: blob.type, size: blob.size };
        if ([...temporaryImages.values()].reduce((sum, item) => sum + item.size, 0) + blob.size > 128 * 1024 * 1024) throw new Error('Temporary image storage is full (128 MiB). Close unused temporary sessions.');
        temporaryImages.set(image.id, blob); ephemeralImages.add(image.id); return image;
      },
      get: async image => {
        if (mode !== 'temporary') return attachmentStore.get(image);
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
      if (tab.mode !== 'temporary' && (previous?.recovered !== next?.recovered || previous?.attachments !== next?.attachments || (previous?.draft && !next?.draft))) void nativeDrafts?.flush().catch(draftPersistenceError);
    },
    onMessage: receive => { tab.receive = message => receive(acpProfile || sdk || !message.state ? message : { ...message, state: projectPi(message.state) }); },
    promptSubmitted: () => {
      if (!unloading && tabs.includes(tab) && tab.backend.session && !tab.ended && !tab.closing && !tab.restarting && !tab.deleting) touchTab(tab);
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
      if (message.type === 'selectControl') {
        if (message.id === 'model' || message.id === 'thinking') void runSessionAction(tab, message.id);
        else {
          const option = typeof message.id === 'string' ? acpSession(tab)?.controlOption(message.id) : undefined;
          if (option) void pickAcpOption(tab, undefined, option);
        }
        return;
      }
      if (message.type === 'inspectMcp') { void runSessionAction(tab, 'mcp'); return; }
      const backend = tab.backend;
      if (!backend.session) return;
      if (backend.kind !== 'pi') void backend.session.handle(message).catch(error => showNotice(tab, String(error)));
      else {
        const session = backend.session;
        void session.handle(message).finally(() => { if (tabs.includes(tab) && tab.backend.session === session) updateTab(tab); });
        updateTab(tab);
      }
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
  if (intent !== 'startup') tab.awaitingSelection = false;
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
  if (plan.reveal && presented === tab) revealSidebarRow(required('sidebar-session-panel'), tab.rowNode);
  if (plan.focus && presented === tab && !document.querySelector('dialog[open]')) (tab.focus?.isConnected ? tab.focus : tab.root.querySelector<HTMLElement>('[data-pi-id="prompt"]'))?.focus({ preventScroll: true });
  selectedConnection.request();
}
function refreshTime(tab: Tab): void {
  updateSessionRowTime(tab.rowTime, tab.lastUsed);
}
function status(tab: Tab) {
  const state = tab.backend.session?.state;
  // A preview lock is not activity; show Deleting only after confirmation.
  return sessionStatus({ ...tab, deleting: tab.deletionExecuting, blocked: deletion.blocked(tab.file?.path),
    inactive: tab.ended || !state || state.sessionUnavailable, compacting: piSession(tab)?.state.compacting,
    busy: state?.busy || !!presentActivity(false, '', piSession(tab)?.state.extensionStatuses).subagents, pending: promptPending(tab) });
}
function sessionRow(tab: Tab): SessionListEntry {
  const reference = tab.lifecycle.identity;
  return {
    key: reference ? savedSessionKey(reference) : tab.id,
    title: tab.title, harnessLabel: tab.backend.kind === 'copilot-sdk' ? 'Copilot' : profileFor(tab) ? `${profileFor(tab)!.name} ACP` : 'Pi',
    timestamp: tab.lastUsed || undefined, open: true, status: status(tab), reference,
  };
}
function updateTab(tab: Tab): void {
  measureWork(settingsSurface.performanceProbe, 'sidebar-row-update', () => updateTabPresentation(tab), presented === tab);
}
/** State dependencies of sidebar/title/bookkeeping updates; local tab effects run separately. */
function shellPresentationChanged(before: ConversationState | undefined, after: ConversationState): boolean {
  if (!before) return true;
  if (before.busy !== after.busy || before.compacting !== after.compacting
    || before.sessionUnavailable !== after.sessionUnavailable || before.sessionName !== after.sessionName
    || before.extensionStatuses !== after.extensionStatuses || before.queue !== after.queue
    || before.modelControls !== after.modelControls) return true;
  if (before.messages === after.messages) return false;
  const changes = messageChanges(after.messages);
  // Only user content supplies an automatic session title. Untracked history
  // replacement is conservative even if its visible title happens to be equal.
  if (!changes || changes.previous !== messageVersion(before.messages)) return true;
  return changes.indices.some(index => after.messages[index].role === 'user');
}
function updateTabPresentation(tab: Tab): void {
  tab.root.inert = tab.closing || tab.restarting || tab.deleting || tab !== presented;
  const entry = sessionRow(tab), name = sessionListLabel(entry);
  tab.root.setAttribute('aria-busy', String(tab.backend.session?.state.busy === true));
  updateSessionRowContent(tab, entry, false);
  tab.row.disabled = !ready;
  tab.row.setAttribute('aria-current', String(tab === presented)); tab.closeButton.setAttribute('aria-label', `Close ${name}`); tab.closeButton.disabled = !ready || tab.deleting || deletion.locked(tab.file?.path) || tab.closing || tab.starting || tab.restarting;
  const remove = tabDeletion(tab);
  tab.deleteButton.setAttribute('aria-label', `${remove?.label.replace('…', '') || 'Delete session'} for ${name}`);
  tab.deleteButton.disabled = !deletable(tab);
  tab.deleteButton.title = `${remove?.label || 'Delete session…'}${!remove?.available() && remove?.unavailableReason ? ` — ${remove.unavailableReason}` : ''}`;
  if (presented === tab) presentConversation(tab);
  renderSidebar();
}
function showNotice(tab: Tab, text: string, retry = false): void {
  tab.notice.hidden = true; tab.notice.replaceChildren();
  notices.report({ id: `${tab.id}:connection`, owner: tab.id, cause: 'connection', priority: 10, operation: 'Session connection', message: text,
    actions: retry && !deletion.blocked(tab.file?.path) ? [{ label: 'Retry connection', enabled: () => tabs.includes(tab) && !tab.closing && !tab.restarting && !tab.deleting && !deletion.locked(tab.file?.path), run: () => tab.lifecycle.connect() }] : undefined,
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
    .map(action => ({ ...action, next: true, run: () => runSessionAction(tab, action.id) }));
}
async function runSessionAction(tab: Tab, id: SessionAction['id']): Promise<void> {
  if (!tabs.includes(tab) || tab.closing || tab.restarting || tab.deleting || !ACTIONS.some(action => action.id === id) || !sessionActions(tab).some(action => action.id === id)) return;
  if (id === 'mcp') return inspectMcp(tab);
  if (id === 'acp-options') return pickAcpOption(tab);
  return pickPreference(tab, id);
}
async function inspectMcp(tab: Tab): Promise<void> {
  if (profileFor(tab)) return;
  const request = palette.startInspection('MCP servers', () => { void inspectMcp(tab); });
  if (!request) return;
  tab.cancelInspector = request.cancel;
  const session = piSession(tab);
  const valid = () => tabs.includes(tab) && piSession(tab) === session && !tab.ended && !tab.closing && !tab.restarting && !tab.deleting && !deletion.blocked(tab.file?.path);
  if (!session || !valid()) {
    request.cancel();
    if (tabs.includes(tab) && !tab.closing) notices.report({ id: `${tab.id}:mcp-inspection`, owner: tab.id, operation: 'Inspect MCP servers', message: 'Connect this session before inspecting MCP servers.' });
    return;
  }
  try {
    const report = await session.inspectMcp();
    if (!request.isCurrent()) return;
    if (!valid()) { request.cancel(); return; }
    notices.resolve(`${tab.id}:mcp-inspection`);
    const attention = new Set(['failed', 'needs sign-in', 'disconnected']);
    request.show({
      items: [
        ...[...report.servers].sort((a, b) => Number(attention.has(b.state)) - Number(attention.has(a.state))).map(server => ({
          id: server.name, label: server.name, badge: server.state,
          detail: `${server.toolCount === undefined ? 'Tool count unavailable' : `${server.toolCount} tools`} · ${server.exposure}`,
          keywords: server.details,
          inspection: { fields: [
            ['Connection', server.state], ['Exposure', server.exposure],
            ['Tools', server.toolCount === undefined ? 'Not reported' : String(server.toolCount)],
          ] as [string, string][], text: server.details || (server.state === 'disconnected' ? 'Pi reconnects this server on its next call.' : undefined) },
          run() {},
        })),
        ...(report.diagnostics.length ? [{ id: ':diagnostics', label: 'Configuration diagnostics', detail: `${report.diagnostics.length} reported entries`, inspection: { fields: [] as [string, string][], text: report.diagnostics.join('\n\n') }, run() {} }] : []),
      ],
      notice: report.empty || 'Read-only snapshot from Pi · Refresh to update. Tool details and configuration sources are not exposed by this status API.',
    });
  } catch (error) {
    if (!request.isCurrent()) return;
    request.cancel();
    if (valid()) notices.report({ id: `${tab.id}:mcp-inspection`, owner: tab.id, operation: 'Inspect MCP servers', message: String(error) });
  }
}
async function pickPreference(tab: Tab, kind: 'model' | 'thinking'): Promise<void> {
  if (tab.backend.kind === 'copilot-sdk') return pickCopilotPreference(tab, kind);
  if (profileFor(tab)) return pickAcpOption(tab, kind);
  const operation = kind === 'model' ? 'Select model' : 'Select thinking level';
  const request = palette.startSelection(operation, () => { void pickPreference(tab, kind); }, message => {
    if (tabs.includes(tab) && !tab.closing) notices.report({ id: `${tab.id}:preference:${++noticeSequence}`, owner: tab.id, operation, message });
  });
  if (!request) return;
  const session = piSession(tab);
  if (!session || tab.ended || tab.closing || tab.restarting || tab.deleting || deletion.blocked(tab.file?.path)) { request.error('Resume this session before changing its model or thinking level.'); return; }
  tab.cancelPreference = request.cancel;
  error.textContent = '';
  const previous = tab.preferenceTask;
  const task = (async () => {
    await previous;
    if (tab.cancelPreference !== request.cancel || piSession(tab) !== session || tab.ended || tab.restarting || tab.deleting) return;
    await session.selectPreference(kind, {
      choose: (_title, options, current) => request.choose(options, current),
      error: message => {
        request.error(message);
        // The selection's owned callback returns the failure to this session,
        // never to the window's application notice strip.
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
async function pickAcpOption(tab: Tab, kind?: 'model' | 'thinking', selectedOption?: import('./acp/session').AcpOption): Promise<void> {
  const session = acpSession(tab);
  if (!session || tab.ended || tab.closing) return;
  const operation = kind === 'model' ? 'Select model' : kind === 'thinking' ? 'Select thinking level' : 'ACP session options';
  const request = palette.startSelection(operation, () => { void pickAcpOption(tab, kind); }, message => {
    if (tabs.includes(tab) && !tab.closing) notices.report({ id: `${tab.id}:acp-option:${++noticeSequence}`, owner: tab.id, operation, message });
  });
  if (!request) return;
  tab.cancelPreference?.(); tab.cancelPreference = request.cancel;
  try {
    let option = selectedOption ?? (kind ? session.options.find(option => option.category === (kind === 'model' ? 'model' : 'thought_level')) : undefined);
    if (!kind && !selectedOption) {
      const options = session.options.slice(), labels = options.map((option, index) => `${index + 1}. ${option.name}`);
      const choice = await request.choose(labels);
      const selected = choice ? options[labels.indexOf(choice)] : undefined;
      if (selected && tabs.includes(tab) && acpSession(tab) === session && !tab.ended && !tab.closing) return pickAcpOption(tab, undefined, selected);
      return;
    }
    if (!option) { request.error('This ACP option is no longer available.'); return; }
    if (tab.cancelPreference !== request.cancel || acpSession(tab) !== session || tab.closing || tab.ended) return;
    await session.selectOption(option, (_title, values, current) => request.choose(values, current));
  } catch (error) { request.error(String(error)); }
  finally { request.finish(); if (tab.cancelPreference === request.cancel) tab.cancelPreference = undefined; }
}
function requestAcpPermission(tab: Tab, request: import('./acp/client').AcpPermissionRequest, signal: AbortSignal): Promise<string | undefined> {
  return requestSessionChoice(tab, renderPermissionDetails(document, request.toolCall), request.options.map(option => ({ id: option.optionId, label: option.name, kind: option.kind })), signal);
}
function requestSessionChoice(tab: Tab, details: HTMLElement, options: { id: string; label: string; kind?: string }[], signal: AbortSignal): Promise<string | undefined> {
  if (signal.aborted || !tabs.includes(tab) || tab.closing) return Promise.resolve(undefined);
  return new Promise(resolve => {
    const region = document.createElement('section'); region.className = 'acp-permission'; region.setAttribute('role', 'group'); region.setAttribute('aria-label', 'Agent permission request');
    region.append(details);
    const actions = document.createElement('div'); actions.className = 'acp-permission-actions'; region.append(actions);
    const raw = details.querySelector('.acp-permission-raw'); if (raw) region.append(raw);
    let settled = false;
    const finish = (choice?: string) => {
      if (settled) return; settled = true;
      signal.removeEventListener('abort', abort);
      const restoreFocus = region.contains(document.activeElement);
      region.remove(); tab.inputCount--; if (tabs.includes(tab)) updateTab(tab);
      if (restoreFocus && presented === tab && !tab.closing && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
      resolve(choice);
    };
    const abort = () => finish();
    for (const option of options) {
      const control = button(option.label, () => { if (!signal.aborted && presented === tab && !tab.closing && !document.querySelector('dialog[open]')) finish(option.id); });
      if (option.kind) control.dataset.permissionKind = option.kind; actions.append(control);
    }
    actions.append(button('Cancel request', () => finish()));
    signal.addEventListener('abort', abort, { once: true });
    tab.inputCount++;
    tab.root.querySelector('[data-pi-id="composer-area"]')!.prepend(region);
    updateTab(tab); // No focus, modal, navigation or background live-region announcement.
    const token = tab.token;
    if (token) void notifySession('input', {
      valid: () => !signal.aborted && !unloading && tabs.includes(tab) && tab.token === token && !tab.closing && !tab.ended,
      selected: () => presented === tab && !settings.isOpen,
      session: tab.backend.kind === 'copilot-sdk' ? 'Copilot' : profileFor(tab)?.name || 'ACP session', target: { session: tab.id, token },
    });
  });
}
async function requestCopilotDecision(tab: Tab, kind: 'permission' | 'input', request: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown> | undefined> {
  const details = document.createElement('div');
  const title = document.createElement('strong'); title.textContent = kind === 'permission' ? 'Copilot requests permission' : typeof request.question === 'string' ? request.question : 'Copilot requests input';
  details.append(title);
  if (kind === 'permission') {
    const raw = document.createElement('pre'); raw.textContent = JSON.stringify(request, null, 2); details.append(raw);
    const choice = await requestSessionChoice(tab, details, [{ id: 'allow', label: 'Allow once' }, { id: 'deny', label: 'Deny' }], signal);
    return { kind: choice === 'allow' ? 'approved' : 'denied-interactively-by-user' };
  }
  const choices = Array.isArray(request.choices) ? request.choices.filter((value): value is string => typeof value === 'string') : [];
  const input = document.createElement('textarea'); input.setAttribute('aria-label', 'Answer Copilot');
  const freeform = request.allowFreeform !== false;
  if (freeform) details.append(input);
  const choice = await requestSessionChoice(tab, details, [
    ...choices.map((label, index) => ({ id: String(index), label })),
    ...(freeform ? [{ id: 'freeform', label: 'Submit answer' }] : []),
  ], signal);
  if (choice === undefined) return;
  if (choice === 'freeform') {
    if (!input.value.trim()) throw new Error('No answer was supplied. The Copilot request was interrupted.');
    return { answer: input.value, wasFreeform: true };
  }
  return { answer: choices[Number(choice)], wasFreeform: false };
}
async function pickCopilotPreference(tab: Tab, kind: 'model' | 'thinking'): Promise<void> {
  const session = copilotSession(tab);
  if (!session || tab.ended || tab.closing || tab.deleting) return;
  const operation = kind === 'model' ? 'Select model' : 'Select thinking level';
  const request = palette.startSelection(operation, () => { void pickCopilotPreference(tab, kind); }, message => {
    if (tabs.includes(tab) && !tab.closing) notices.report({ id: `${tab.id}:copilot-configuration:${++noticeSequence}`, owner: tab.id, operation, message });
  });
  if (!request) return;
  tab.cancelPreference?.(); tab.cancelPreference = request.cancel;
  try {
    await session.selectPreference(kind, async (values, current) => {
      const value = await request.choose(values, current);
      if (!tabs.includes(tab) || copilotSession(tab) !== session || tab.ended || tab.closing || tab.deleting) return;
      return value;
    });
  } catch (error) { request.error(String(error)); }
  finally { request.finish(); if (tab.cancelPreference === request.cancel) tab.cancelPreference = undefined; }
}
async function newCopilotSession(): Promise<void> {
  if (!ready || !copilotReady || settings.isOpen || !await ensureWorkspace() || unloading || deletions.pending) return;
  rememberCopilot();
  const tab = createTab('saved', undefined, 'Copilot session', navigation.nextRecency(), undefined, undefined, true);
  activate(tab);
  await tab.lifecycle.connect({ acceptedAction: true });
}
function conflictingCopilotIdentity(tab: Tab, id: string): boolean {
  return tabs.some(other => other !== tab && other.backend.kind === 'copilot-sdk' && other.lifecycle.identity?.sessionId === id);
}
async function launchCopilot(tab: Tab, acceptedAction = false): Promise<void> {
  if (tab.backend.kind !== 'copilot-sdk' || !ready || !copilotReady || unloading || !workspace || !tabs.includes(tab) || deletions.pending || tab.deleting || tab.starting || tab.closing || tab.restarting || tab.backend.session && !tab.ended || !acceptedAction && settings.isOpen) return;
  const backend = tab.backend, project = workspace, savedId = backend.savedSessionId;
  if (savedId && conflictingCopilotIdentity(tab, savedId)) { showNotice(tab, 'This ID is already open in another Copilot session. Select that entry or close it before connecting.'); return; }
  tab.awaitingSelection = false; tab.starting = true; updateTab(tab);
  try { await tab.lifecycle.stop(); }
  catch (error) { tab.starting = false; showNotice(tab, `Could not stop the previous Copilot connection: ${String(error)}`, !!savedId); updateTab(tab); return; }
  if (unloading || !tabs.includes(tab) || tab.closing || workspace !== project) { tab.starting = false; return; }
  tab.cancelPreference?.(); tab.lifecycle.disconnect('Reconnecting Copilot');
  tab.token = crypto.randomUUID(); tab.ended = false;
  const token = tab.token;
  const valid = () => !unloading && tabs.includes(tab) && tab.token === token;
  let shellSignature = '';
  const session: CopilotSession = new CopilotSession(message => invoke('write_copilot', { token, message }), {
    toolCapture: settingsSurface.toolCapture,
    publish: message => { if (valid()) tab.receive?.(message); },
    identified: id => {
      if (!valid()) throw new Error('Copilot connection is no longer owned');
      if (savedId !== undefined && id !== savedId || conflictingCopilotIdentity(tab, id)) throw new Error('Copilot returned a conflicting identity. No draft was migrated or replaced.');
      tab.drafts.bindScope(copilotSdkScope(id)); backend.savedSessionId = id; persistTabs();
    },
    changed: () => {
      if (!valid()) return;
      const state = session.state;
      const first = state.messages.find(message => message.role === 'user' && !message.originLabel);
      // The initial SDK name makes empty sessions durable, not meaningfully titled.
      const name = state.sessionName === 'Copilot session' ? undefined : state.sessionName;
      tab.title = name || (typeof first?.content === 'string' ? first.content.trim().replace(/\s+/g, ' ').slice(0, 70) : '') || tab.title;
      const signature = JSON.stringify([state.busy, state.sessionUnavailable, tab.title]);
      if (signature !== shellSignature) { shellSignature = signature; if (state.busy) tab.failed = false; updateTab(tab); if (tab.lifecycle.identity) persistTabs(); }
    },
    notice: message => { if (valid() && !tab.closing) notices.report({ id: `${tab.id}:copilot:${++noticeSequence}`, owner: tab.id, operation: 'Copilot', message }); },
    decision: (kind, request, signal) => requestCopilotDecision(tab, kind, request, signal),
    commandChoice: async (title, choices, signal) => {
      const current = () => valid() && copilotSession(tab) === session && presented === tab && !settings.isOpen && !tab.closing && !tab.deleting && !signal.aborted;
      // A late/background result never opens or replaces a modal interaction.
      if (!current() || document.querySelector('dialog[open]')) return;
      const request = palette.startSelection(title, () => {}, undefined, true);
      if (!request) return;
      const cancel = () => request.cancel();
      signal.addEventListener('abort', cancel, { once: true });
      try {
        const selected = await request.chooseItems(choices);
        return current() ? selected : undefined;
      } finally { signal.removeEventListener('abort', cancel); request.finish(); }
    },
    disconnected: message => {
      if (!valid()) return;
      tab.ended = true; tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' });
      if (!tab.closing && !tab.deleting) showNotice(tab, `${message}. Your draft and any saved identity remain. Nothing was replayed or replaced by a new session.`, !!tab.lifecycle.identity);
      void tab.lifecycle.stop().catch(error => { if (valid()) showNotice(tab, `Could not stop Copilot: ${String(error)}`, !!tab.lifecycle.identity); });
      updateTab(tab);
    },
    completed: (failed, response) => {
      if (!valid() || tab.closing || tab.deleting) return;
      if (failed) tab.failed = true; else if (presented !== tab || settings.isOpen) tab.unread = true;
      updateTab(tab);
      void notifySession(failed ? 'failed' : 'completed', { valid: () => valid() && !tab.closing, selected: () => presented === tab && !settings.isOpen, session: 'Copilot', target: { session: tab.id, token }, preview: failed ? undefined : previewResponse(response) });
    },
  });
  backend.session = session;
  tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  tab.receive?.({ type: 'snapshot', state: session.state });
  const onEvent = new Channel<Packet>();
  onEvent.onmessage = packet => { if (!valid()) return; if (packet.kind === 'rpc') session.receive(packet.value); else session.disconnect(packet.message); };
  try {
    const confirmed = await invoke<string>('start_copilot', { token, config: { cwd: project, node: runtime.current().node, cli: runtime.current().copilot, generation: copilotGeneration }, onEvent });
    if (!valid() || confirmed !== project) throw new Error('Native SDK host did not confirm this project');
    await session.initialize(savedId);
    if (valid()) notices.resolve(`${tab.id}:connection`);
  } catch (error) {
    session.disconnect(String(error));
    try { await tab.lifecycle.stop(); } catch (error) { if (valid()) showNotice(tab, String(error), !!savedId); }
  } finally { tab.starting = false; if (valid()) { updateTab(tab); controls(); } }
}
async function launchAcp(tab: Tab, acceptedAction = false): Promise<void> {
  const profile = profileFor(tab);
  if (!profile || !ready || !acpReady || unloading || !workspace || !tabs.includes(tab) || deletions.pending || tab.deleting || tab.starting || tab.closing || tab.restarting || (tab.backend.session && !tab.ended) || (!acceptedAction && settings.isOpen)) return;
  const project = workspace;
  tab.awaitingSelection = false;
  tab.starting = true; updateTab(tab);
  try { await tab.lifecycle.stop(); }
  catch (error) { tab.starting = false; showNotice(tab, `Could not stop the previous ACP process: ${error}`, !!tab.lifecycle.identity); updateTab(tab); return; }
  if (unloading || !tabs.includes(tab) || tab.closing || workspace !== project) { tab.starting = false; return; }
  tab.cancelPreference?.();
  tab.lifecycle.disconnect('Reconnecting session');
  tab.starting = true; tab.token = crypto.randomUUID(); tab.ended = false; updateTab(tab);
  const token = tab.token;
  const valid = () => !unloading && tabs.includes(tab) && tab.token === token;
  let shellSignature = '';
  const session = new AcpSession(message => invoke('write_acp', { token, message }), {
    toolCapture: settingsSurface.toolCapture,
    publish: message => { if (valid()) tab.receive?.(message); },
    changed: () => {
      if (!valid()) return;
      const state = session.state;
      if (state.sessionName) tab.title = state.sessionName;
      else {
        const first = state.messages.find(message => message.role === 'user');
        if (typeof first?.content === 'string') tab.title = first.content.trim().replace(/\s+/g, ' ').slice(0, 70) || `${profile.name} session`;
      }
      const signature = JSON.stringify([state.busy, state.sessionUnavailable, tab.title]);
      if (signature !== shellSignature) {
        shellSignature = signature; if (state.busy) tab.failed = false; updateTab(tab);
        if (tab.lifecycle.identity) persistTabs();
      }
    },
    notice: message => { if (valid() && !tab.closing) notices.report({ id: `${tab.id}:acp:${++noticeSequence}`, owner: tab.id, operation: 'ACP session', message }); },
    permission: (request, signal) => requestAcpPermission(tab, request, signal),
    disconnected: message => {
      if (!valid()) return;
      tab.ended = true; tab.cancelPreference?.(); tab.receive?.({ type: 'sessionDisconnected' });
      if (!tab.closing && !tab.deleting) showNotice(tab, `${message}. Nothing was retried. Create a new ACP session explicitly.`);
      void tab.lifecycle.stop().catch(error => { if (valid()) showNotice(tab, `Could not stop ACP agent: ${error}`, !!tab.lifecycle.identity); });
      updateTab(tab);
    },
    completed: (failed, response) => {
      if (!valid() || tab.closing || tab.deleting) return;
      if (failed) tab.failed = true; else if (presented !== tab || settings.isOpen) tab.unread = true;
      updateTab(tab);
      const kind = failed ? 'failed' : 'completed';
      void notifySession(kind, { valid: () => valid() && !tab.closing, selected: () => presented === tab && !settings.isOpen, session: profile.name, target: { session: tab.id, token }, preview: failed ? undefined : previewResponse(response) });
    },
  });
  if (tab.backend.kind === 'acp') tab.backend.session = session;
  tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  tab.receive?.({ type: 'snapshot', state: session.state });
  const onEvent = new Channel<Packet>();
  onEvent.onmessage = packet => { if (!valid()) return; if (packet.kind === 'rpc') session.receive(packet.value); else session.disconnect(packet.message); };
  try {
    const confirmed = await invoke<string>('start_acp', { token, config: { cwd: project, command: profile.command, args: profile.args, env: profile.env, node: runtime.current().node }, onEvent });
    if (!valid() || confirmed !== project) throw new Error('Native ACP host did not confirm this project');
    await session.initialize(project);
    if (!valid()) return;
    notices.resolve(`${tab.id}:connection`);
    if (presented === tab && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  } catch (error) { session.disconnect(error); try { await tab.lifecycle.stop(); } catch (error) { if (valid()) showNotice(tab, String(error), !!tab.lifecycle.identity); } }
  finally { tab.starting = false; if (valid()) { updateTab(tab); controls(); } }
}
async function launchPi(tab: Tab, copyDraft?: string, acceptedAction = false, initialName?: string): Promise<void> {
  if (!ready || deletion.blocked(tab.file?.path) || deletion.locked(tab.file?.path) || tab.deleting || tab.starting || tab.closing || (piSession(tab) && !tab.ended) || (!acceptedAction && settings.isOpen) || !workspace) return;
  tab.starting = true; tab.failed = false; updateTab(tab); error.textContent = ''; tab.notice.hidden = true;
  try { await tab.lifecycle.stop(); } catch (e) { tab.starting = false; showNotice(tab, `Could not stop the previous process: ${e}`); updateTab(tab); return; }
  const token = crypto.randomUUID(); tab.token = token; tab.ended = false;
  const currentToken = () => tabs.includes(tab) && tab.token === token;
  const rpc = new PiTransport(message => invoke('write_pi', { token, message }));
  const mode = tab.file?.exists ? 'resume' : tab.mode;
  const config = { cwd: workspace, pi: runtime.current().pi, node: runtime.current().node, mode, sessionName: initialName, sessionFile: mode === 'resume' ? tab.file?.path : undefined, sessionId: mode === 'resume' ? tab.file?.sessionId || undefined : undefined };
  let launchInfo: PiLaunchInfo;
  let identityGeneration = 0;
  let confirmedRaw: { path: string; sessionId: string } | undefined;
  let shellState: ConversationState | undefined;
  const current = new PiSession(rpc, {
    toolCapture: settingsSurface.toolCapture,
    performance: settingsSurface.performanceProbe,
    active: () => presented === tab,
    publish: message => { if (currentToken()) tab.receive?.(message); },
    notice: (message, severity, cause) => {
      if (currentToken() && !tab.closing && !tab.restarting && !tab.deleting) notices.report({ id: `${tab.id}:pi:${++noticeSequence}`, owner: tab.id, cause, operation: 'Pi operation', message, severity });
    },
    attention: (kind, response) => {
      if (unloading || !currentToken() || tab.closing || tab.restarting || tab.deleting) return;
      if (kind === 'completed' && (presented !== tab || settings.isOpen)) tab.unread = true;
      if (kind === 'failed') tab.failed = true;
      updateTab(tab);
      void notifySession(kind, {
        valid: () => !unloading && currentToken() && !tab.closing && !tab.restarting && !tab.deleting && (kind === 'failed' || !tab.ended),
        selected: () => presented === tab && !settings.isOpen,
        // Auto-generated sidebar titles are prompt excerpts, not notification-safe labels.
        session: piSession(tab)?.state.sessionName || 'Session',
        target: { session: tab.id, token },
        preview: kind === 'completed' ? previewResponse(response) : undefined,
      });
    },
    choose: (title, options) => withTabDialog(tab, label => dialogs.choose(label, options, token), title),
    input: (title, prefill) => withTabDialog(tab, label => dialogs.input(label, prefill, token), title),
    confirm: (title, message) => withTabDialog(tab, label => dialogs.confirm(label, message, token), title),
    copy: writeText, openLink: href => invoke('open_link', { token, href }),
    disconnected: reason => {
      if (!currentToken()) return;
      tab.ended = true; tab.cancelPreference?.(); tab.cancelInspector?.(); tab.receive?.({ type: 'sessionDisconnected' }); dialogs.cancel(token);
      void tab.lifecycle.stop().catch(e => { if (currentToken()) showNotice(tab, `Could not stop Pi: ${e}`); });
      if (!tab.closing && !tab.restarting && !tab.deleting) showNotice(tab, `${reason || 'Session disconnected'}. Nothing will be sent automatically.`, !!tab.file?.exists);
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
      const before = shellState; shellState = state;
      if (!shellPresentationChanged(before, state)) return;
      if (!state.sessionUnavailable) notices.resolve(`${tab.id}:connection`);
      if (state.busy && !state.compacting && !state.sessionUnavailable) tab.failed = false;
      const previousTitle = tab.title;
      if (state.sessionName) tab.title = state.sessionName;
      else {
        const first = state.messages.find(message => message.role === 'user');
        const content = first?.content;
        const preview = typeof content === 'string' ? content : Array.isArray(content) ? content.filter(block => block.type === 'text').map(block => String(block.text || '')).join(' ') : '';
        tab.title = tab.mode === 'temporary' ? 'Temporary session' : preview.trim().replace(/\s+/g, ' ').slice(0, 70) || (tab.starting ? previousTitle : 'Session');
      }
      updateTab(tab); persistTabs();
    },
  }, mode === 'temporary');
  if (tab.backend.kind === 'pi') tab.backend.session = current;
  try {
    if (copyDraft) tab.drafts.select(`unassigned:${tab.id}`, copyDraft);
    tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
    await startPiSession(config, {
      start: receive => {
        const onEvent = new Channel<Packet>(); onEvent.onmessage = receive;
        return invoke<PiLaunchInfo>('start_pi', { config, token, onEvent });
      },
      currentProject: () => workspace,
      current: currentToken,
      receive: packet => rpc.receive(packet),
      validated: info => {
        launchInfo = info;
        if (info.session) {
          tab.file = info.session;
          tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.select(`file:${info.session.path}`) });
        }
      },
      initialize: () => current.initialize(initialName),
    });
    if (presented === tab && !tab.restarting && !document.querySelector('dialog[open]')) tab.root.querySelector<HTMLTextAreaElement>('[data-pi-id="prompt"]')?.focus({ preventScroll: true });
  } catch (e) {
    rpc.disconnect(String(e));
    try { await tab.lifecycle.stop(); } catch (stopError) { notices.report({ id: `${tab.id}:stop:${++noticeSequence}`, owner: tab.id, operation: 'Stop Pi', message: String(stopError) }); }
    showNotice(tab, String(e), !!tab.file?.exists); tab.ended = true;
  } finally { tab.starting = false; updateTab(tab); controls(); }
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
async function newSession(mode: LaunchMode = 'saved', copyDraft?: string, initialName?: string): Promise<void> {
  if (!ready || settings.isOpen || !await ensureWorkspace()) return;
  if (!ready || unloading || settings.isOpen) return;
  const tab = createTab(mode, undefined, undefined, navigation.nextRecency()); activate(tab); await launchPi(tab, copyDraft, true, initialName);
}
async function openSavedSession(entry: SessionListEntry): Promise<void> {
  const reference = entry.reference;
  if (!reference) throw new Error('This session has no saved identity');
  if (deletions.removed(sessionListItem(entry).id)) throw new Error('The selected session was deleted. Refresh history and choose another session.');
  if ('path' in reference) return openSession({ ...reference, name: entry.title, lastUserMessageAt: entry.timestamp });
  if (!ready || unloading || settings.isOpen || !workspace) return;
  if (deletions.pending) throw new Error('Finish the deletion review before opening another Copilot connection.');
  rememberCopilot();
  const existing = tabs.find(tab => tab.backend.kind === 'copilot-sdk' && tab.lifecycle.identity?.sessionId === reference.sessionId);
  if (existing) { activate(existing); return; }
  const tab = createTab('resume', undefined, entry.title, lastUsed(entry.timestamp), undefined, reference.sessionId, true);
  tab.receive?.({ type: 'sessionReset', composerState: tab.drafts.read() });
  activate(tab);
}
async function openSession(info: Pick<SessionSummary, 'path' | 'sessionId' | 'name' | 'lastUserMessageAt'>): Promise<void> {
  if (!ready || settings.isOpen || !await ensureWorkspace()) return;
  if (deletion.locked(info.path)) { error.textContent = 'This session is locked for deletion. Finish or cancel its review before resuming it.'; return; }
  if (deletion.removed(info.path)) { error.textContent = 'The selected session was deleted. Refresh Resume session and choose another session.'; return; }
  if (deletion.blocked(info.path)) {
    try { await deletion.recover(info.path, info.sessionId); } catch (e) { error.textContent = String(e); return; }
  }
  const existing = tabs.find(tab => tab.file?.path === info.path);
  if (existing) {
    if (existing.file?.sessionId !== info.sessionId) { error.textContent = 'This file is open with a different saved session identity. Close that session and refresh history before resuming it.'; return; }
    activate(existing); return;
  }
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
  if (!ready || unloading || settings.isOpen) return;
  if (deletion.removed(info.path)) { error.textContent = 'The selected session was deleted. Refresh Resume session and choose another session.'; return; }
  if (deletion.locked(info.path) || deletion.blocked(info.path)) { error.textContent = 'This session is unavailable because of deletion. Finish or cancel its review, or explicitly recover it through Resume session.'; return; }
  const concurrent = tabs.find(tab => tab.file?.path === info.path);
  if (concurrent) {
    if (concurrent.file?.sessionId !== info.sessionId) { error.textContent = 'This file is open with a different saved session identity. Close that session and refresh history before resuming it.'; return; }
    activate(concurrent); return;
  }
  const tab = createTab('resume', { path: info.path, sessionId: info.sessionId, exists: true }, info.name || 'Session', used);
  activate(tab); await tab.lifecycle.connect({ acceptedAction: true });
}
async function restartSession(tab: Tab): Promise<void> {
  if (!ready || tab.deleting || deletion.locked(tab.file?.path) || deletion.blocked(tab.file?.path) || !tabs.includes(tab) || !restartable(tab) || tab.starting || tab.closing || tab.restarting || settings.isOpen) return;
  const session = piSession(tab);
  const needsConfirmation = !!session && !tab.ended && (session.state.busy || promptPending(tab) || !!tab.inputCount || !!session.state.queue?.pendingCount);
  tab.restarting = true; updateTab(tab);
  let resumed = false;
  try {
    if (needsConfirmation && !await dialogs.confirm(`Restart ${tab.title}?`, 'This interrupts this session’s agent and resumes its saved history. Your draft stays; queued and in-flight work will not continue. Nothing is sent again automatically.', undefined, 'Restart session')) return;
    if (!tabs.includes(tab)) return;
    // Stop is a native lifecycle operation, not an RPC request to a stuck agent.
    await tab.lifecycle.stop();
    tab.cancelPreference?.(); tab.cancelInspector?.();
    if (tab.token) dialogs.cancel(tab.token);
    tab.receive?.({ type: 'sessionDisconnected' }); piSession(tab)?.rpc.disconnect('Session restarted');
    tab.ended = true;
    resumed = true;
    await tab.lifecycle.connect({ acceptedAction: true });
  } catch (error) { showNotice(tab, `Could not restart Pi: ${error}`); }
  finally {
    tab.restarting = false; if (tabs.includes(tab)) updateTab(tab); controls();
    // The restart lock keeps the pane inert during startup. Restore explicit-launch
    // focus only after unlocking, never over another session or an open dialog.
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
    if ((stored(lastKey) as LastSession | null)?.path === target.key) save(lastKey, null);
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
  tab.notices.dispose(); notices.store.resolveOwner(tab.id);
  navigation.remove(tab);
  if (active === tab) active = undefined;
  if (presented === tab) { tab.view.setActive(false); presented = undefined; conversation.hidden = true; }
  if (tab.token) dialogs.cancel(tab.token);
  tab.cancelPreference?.(); tab.cancelInspector?.(); tab.receive?.({ type: 'sessionDisconnected' }); tab.lifecycle.disconnect('Session closed');
  tab.view.dispose();
  try { tab.drafts.discardTemporary(); } catch (e) { persistenceError(e); }
  tab.root.remove(); tab.rowNode.remove();
}
function detachTab(tab: Tab): void {
  if (!tabs.includes(tab)) return;
  tab.closing = true;
  tab.notices.dispose(); notices.store.resolveOwner(tab.id);
  if (tab.token) dialogs.cancel(tab.token);
  tab.cancelPreference?.(); tab.cancelInspector?.(); tab.receive?.({ type: 'sessionDisconnected' }); tab.lifecycle.disconnect('Session closed');
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
  if (tab.deleting || deletion.locked(tab.file?.path) || tab.closing || tab.starting || tab.restarting || settings.isOpen) return;
  const state = tab.backend.session?.state;
  const running = tab.backend.session && !tab.ended;
  if ((profileFor(tab) || tab.mode === 'temporary' || (running && (state?.busy || promptPending(tab) || tab.inputCount || piSession(tab)?.state.queue?.pendingCount))) && !await dialogs.confirm(`Close ${tab.title}?`, profileFor(tab) ? 'This stops this ACP agent and discards Nimrod’s in-memory transcript, draft and pop-outs. Nimrod cannot resume it in this POC. The agent may keep its own saved history; this does not delete it.' : tab.mode === 'temporary' ? 'This stops its agent and discards this temporary session, including its draft, queued messages and pop-outs.' : 'This stops only this session’s agent. Written history and your draft remain; queued and in-flight work will not continue.', undefined, profileFor(tab) ? 'Close ACP session' : tab.mode === 'temporary' ? 'Close temporary session' : 'Close session')) return;
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
required('resume-last').addEventListener('click', () => { const last = lastSession(); if (last) void (async () => { if (workspace !== last.cwd && !await openWorkspace(last.cwd)) return; await openSession(last); })(); });
required('recover-draft').addEventListener('click', () => {
  const options = recoverableDrafts();
  void dialogs.choose('Recover draft into a new session (never sent automatically)', options.map((o, i) => `${i + 1}. ${o.label}`)).then(choice => {
    const index = choice ? Number.parseInt(choice, 10) - 1 : -1; if (options[index]) return newSession('saved', options[index].key);
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
async function takeProjectSettingsRequest() {
  const requested = await invoke<boolean>('take_project_settings_request');
  if (requested && workspace) settings.open();
}
const unlistenProjectSettings = await listen('nimrod-project-settings', () => { if (ready) void takeProjectSettingsRequest().catch(persistenceError); }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
const keybindingDispatch = installKeybindingDispatch(window, {
  read: () => preferences.keybindings(),
  enabled: id => {
    if (unloading) return false;
    if (['settings', 'keybindings', 'zoom-in', 'zoom-out', 'zoom-reset'].includes(id)) return true;
    if (id === 'project-settings') return !!workspace;
    if (!ready) return false;
    if (id === 'new-copilot') return copilotReady;
    if (id === 'capture-performance') return preferences.performanceEnabled() && !settingsSurface.capturingPerformance;
    if (['mcp', 'model', 'thinking'].includes(id)) return !!presented && sessionActions(presented).some(action => action.id === id);
    if (['close', 'restart', 'delete'].includes(id)) return !!presented;
    return true;
  },
  run: (id: ActionId) => {
    switch (id) {
      case 'open-recent-project': return palette.projects();
      case 'new': return newSession();
      case 'new-copilot': return newCopilotSession();
      case 'temporary': return newSession('temporary');
      case 'delete': return presented ? deleteSession(presented) : undefined;
      case 'delete-sessions': return palette.deleteSessions();
      case 'capture-performance': return capturePerformance(true);
      case 'reload-card-plugins': return reloadCardPlugins(true);
      case 'select-theme': return pickTheme();
      case 'mcp': case 'model': case 'thinking': return presented ? runSessionAction(presented, id) : undefined;
      case 'palette': palette.open(); return;
      case 'close': return presented ? closeTab(presented) : undefined;
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
    await invoke('stop_pi'); // Window-scoped reload cleanup; never stop another workspace.
    // Reap any owned legacy child left by a webview reload. This does not
    // enable ACP creation or register product actions.
    void invoke('stop_acp').then(() => {
      if (!unloading) { acpReady = true; selectedConnection.barriersChanged(); }
    }).catch(error => {
      if (!unloading) notices.report({ id: 'acp-startup', operation: 'Clean up agents', message: `Could not finish legacy agent cleanup; Pi remains available. ${String(error)}` });
    });
    void invoke<string>('stop_copilot').then(generation => {
      if (typeof generation !== 'string' || !generation) throw new Error('Native Copilot host did not confirm a new window generation');
      if (!unloading) { copilotGeneration = generation; copilotReady = true; selectedConnection.barriersChanged(); startCopilotHistory(); }
    }).catch(error => {
      if (!unloading) notices.report({ id: 'copilot-startup', operation: 'Initialize Copilot', message: `Copilot is unavailable; Pi remains available. ${String(error)}` });
    });
    await zoom.ready;
    const defaults = await invoke<{ pi: string; node: string; cwd: string; home?: string }>('runtime_defaults');
    homeDirectory = defaults.home;
    const saved = stored(settingsKey) as Partial<typeof defaults> | null;
    cwd.value = typeof saved?.cwd === 'string' ? saved.cwd : defaults.cwd;
    settingsSurface.initializeRuntime(defaults);
    const path = await invoke<string | null>('window_workspace');
    deletion.load(await invoke<DeletionSnapshot>('deletion_snapshot'));
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
