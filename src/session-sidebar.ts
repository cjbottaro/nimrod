import { lastUsed } from './session-recency';
import type { SessionListEntry, SessionStatus } from './session-list';

const statusPresentation: Record<SessionStatus, { label: string; mark: string }> = {
  closed: { label: 'Closed', mark: '—' },
  inactive: { label: 'Inactive', mark: '○' },
  starting: { label: 'Starting', mark: '' },
  ready: { label: 'Ready', mark: '•' },
  working: { label: 'Working', mark: '' },
  input: { label: 'Input needed', mark: '?' },
  failed: { label: 'Failed', mark: '!' },
  unread: { label: 'Unread', mark: '◉' },
  sending: { label: 'Sending', mark: '' },
  compacting: { label: 'Compacting', mark: '' },
  restarting: { label: 'Restarting', mark: '' },
  closing: { label: 'Closing', mark: '' },
  deleting: { label: 'Deleting', mark: '' },
  recovery: { label: 'Recovery needed', mark: '↻' },
};

export function sessionStatusPresentation(state: SessionStatus): { state: SessionStatus; label: string; mark: string } {
  return { state, ...statusPresentation[state] };
}

export function sessionTime(timestamp: unknown, now = Date.now(), locale?: string): string {
  const used = lastUsed(timestamp);
  if (!used) return 'No message time';
  const date = new Date(used), current = new Date(now);
  const elapsed = Math.max(0, now - used);
  const minute = 60_000, hour = 60 * minute, day = 24 * hour;
  const [unit, size]: [Intl.RelativeTimeFormatUnit, number] = elapsed < hour ? ['minute', minute]
    : elapsed < day ? ['hour', hour] : elapsed < 30 * day ? ['day', day]
    : elapsed < 365 * day ? ['month', 30 * day] : ['year', 365 * day];
  const relative = elapsed < minute ? 'Just now' : new Intl.RelativeTimeFormat(locale, { numeric: 'always' }).format(-Math.floor(elapsed / size), unit);
  const absolute = date.toLocaleDateString(locale, { month: 'short', day: 'numeric', ...(date.getFullYear() !== current.getFullYear() ? { year: 'numeric' } : {}) });
  return `${relative} · ${absolute}`;
}

export interface SidebarState {
  deleting?: boolean; blocked?: boolean; restarting?: boolean; closing?: boolean; starting?: boolean;
  inputCount?: number; failed?: boolean; inactive?: boolean; compacting?: boolean; busy?: boolean; pending?: boolean; unread?: boolean;
}
/** Keep lifecycle/error precedence separate from timestamp presentation. */
export function sessionStatus(state: SidebarState): SessionStatus {
  if (state.deleting) return 'deleting';
  if (state.blocked) return 'recovery';
  if (state.restarting) return 'restarting';
  if (state.closing) return 'closing';
  if (state.starting) return 'starting';
  if (state.inputCount) return 'input';
  if (state.failed) return 'failed';
  if (state.inactive) return 'inactive';
  if (state.compacting) return 'compacting';
  if (state.busy) return 'working';
  if (state.unread) return 'unread';
  if (state.pending) return 'sending';
  return 'ready';
}

export function sessionIndicator(state: SidebarState) { return sessionStatusPresentation(sessionStatus(state)); }

export interface SessionRowContent {
  row: HTMLElement;
  rowLabel: HTMLElement;
  rowIndicator: HTMLElement;
  rowTime: HTMLTimeElement;
  rowHarness: HTMLElement;
}
/** Shared content and styling for the sidebar and both session pickers. */
export function createSessionRowContent(row: HTMLElement, timeId: string): SessionRowContent {
  const doc = row.ownerDocument;
  row.classList.add('session-row');
  const text = doc.createElement('span'); text.className = 'session-row-text';
  const heading = doc.createElement('span'); heading.className = 'session-row-heading';
  const rowLabel = doc.createElement('span'); rowLabel.className = 'session-row-label';
  heading.append(rowLabel);
  const secondary = doc.createElement('small'), rowTime = doc.createElement('time'), rowHarness = doc.createElement('span');
  rowTime.id = timeId; rowHarness.id = `${timeId}-harness`; rowHarness.className = 'session-row-harness';
  row.setAttribute('aria-describedby', `${timeId} ${rowHarness.id}`);
  secondary.append(rowTime, ' · ', rowHarness); text.append(heading, secondary);
  const rowIndicator = doc.createElement('span'); rowIndicator.className = 'session-indicator'; rowIndicator.setAttribute('aria-hidden', 'true');
  row.append(rowIndicator, text);
  return { row, rowLabel, rowIndicator, rowTime, rowHarness };
}

export function updateSessionRowTime(time: HTMLTimeElement, timestamp: unknown, now = Date.now()): void {
  const label = sessionTime(timestamp, now), used = lastUsed(timestamp);
  if (time.textContent !== label) time.textContent = label;
  const datetime = used ? new Date(used).toISOString() : '';
  if (datetime && time.getAttribute('datetime') !== datetime) time.setAttribute('datetime', datetime);
  else if (!datetime) time.removeAttribute('datetime');
}

export function updateSessionRowContent(content: SessionRowContent, entry: SessionListEntry, showMembership = true): void {
  const { row, rowLabel, rowIndicator, rowTime, rowHarness } = content;
  const name = sessionListLabel(entry), status = sessionStatusPresentation(entry.status);
  if (rowLabel.textContent !== entry.title) rowLabel.textContent = entry.title;
  if (rowHarness.textContent !== entry.harnessLabel) rowHarness.textContent = entry.harnessLabel;
  updateSessionRowTime(rowTime, entry.timestamp);
  if (rowIndicator.dataset.state !== status.state) rowIndicator.dataset.state = status.state;
  if (rowIndicator.textContent !== status.mark) rowIndicator.textContent = status.mark;
  row.setAttribute('aria-label', `${name} — ${status.label}${showMembership && entry.open ? ' — Open' : ''}`);
}

export function sessionListLabel(entry: SessionListEntry): string {
  return entry.harnessLabel === 'Pi' ? entry.title : `${entry.title} · ${entry.harnessLabel}`;
}
/** Text refresh only: callers must not sort, persist, navigate or request history. */
export function installSessionTimeRefresh(win: Window, refresh: () => void): () => void {
  const update = () => { if (win.document.visibilityState !== 'hidden') refresh(); };
  const timer = win.setInterval(update, 60_000);
  win.document.addEventListener('visibilitychange', update);
  win.addEventListener('focus', update);
  return () => {
    win.clearInterval(timer);
    win.document.removeEventListener('visibilitychange', update);
    win.removeEventListener('focus', update);
  };
}
