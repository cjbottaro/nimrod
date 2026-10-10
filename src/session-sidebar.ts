import { lastUsed } from './session-recency';

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
export function sessionIndicator(state: SidebarState): { state: string; label: string; mark: string } {
  if (state.deleting) return { state: 'deleting', label: 'Deleting', mark: '' };
  if (state.blocked) return { state: 'recovery', label: 'Recovery needed', mark: '↻' };
  if (state.restarting) return { state: 'restarting', label: 'Restarting', mark: '' };
  if (state.closing) return { state: 'closing', label: 'Closing', mark: '' };
  if (state.starting) return { state: 'starting', label: 'Starting', mark: '' };
  if (state.inputCount) return { state: 'input', label: 'Input needed', mark: '?' };
  if (state.failed) return { state: 'failed', label: 'Failed', mark: '!' };
  if (state.inactive) return { state: 'inactive', label: 'Inactive', mark: '○' };
  if (state.compacting) return { state: 'compacting', label: 'Compacting', mark: '' };
  if (state.busy) return { state: 'working', label: 'Working', mark: '' };
  if (state.unread) return { state: 'unread', label: 'Unread', mark: '◉' };
  if (state.pending) return { state: 'sending', label: 'Sending', mark: '' };
  return { state: 'ready', label: 'Ready', mark: '•' };
}

export interface SessionRowContent {
  row: HTMLElement;
  rowLabel: HTMLElement;
  rowIndicator: HTMLElement;
  rowTime: HTMLTimeElement;
}
export interface SessionRowPresentation {
  timestamp: unknown;
  indicator: ReturnType<typeof sessionIndicator>;
  badge?: string;
}

/** Shared content and styling for the sidebar and both session pickers. */
export function createSessionRowContent(row: HTMLElement, timeId: string): SessionRowContent {
  const doc = row.ownerDocument;
  row.classList.add('session-row');
  const text = doc.createElement('span'); text.className = 'session-row-text';
  const heading = doc.createElement('span'); heading.className = 'session-row-heading';
  const rowLabel = doc.createElement('span'); rowLabel.className = 'session-row-label';
  heading.append(rowLabel);
  const secondary = doc.createElement('small'), rowTime = doc.createElement('time');
  rowTime.id = timeId; row.setAttribute('aria-describedby', timeId);
  secondary.append(rowTime); text.append(heading, secondary);
  const rowIndicator = doc.createElement('span'); rowIndicator.className = 'session-indicator'; rowIndicator.setAttribute('aria-hidden', 'true');
  row.append(rowIndicator, text);
  return { row, rowLabel, rowIndicator, rowTime };
}

export function updateSessionRowTime(time: HTMLTimeElement, timestamp: unknown, now = Date.now()): void {
  const label = sessionTime(timestamp, now), used = lastUsed(timestamp);
  if (time.textContent !== label) time.textContent = label;
  const datetime = used ? new Date(used).toISOString() : '';
  if (datetime && time.getAttribute('datetime') !== datetime) time.setAttribute('datetime', datetime);
  else if (!datetime) time.removeAttribute('datetime');
}

export function updateSessionRowContent(content: SessionRowContent, name: string, presentation: SessionRowPresentation): void {
  const { row, rowLabel, rowIndicator, rowTime } = content;
  const status = presentation.indicator;
  if (rowLabel.textContent !== name) rowLabel.textContent = name;
  updateSessionRowTime(rowTime, presentation.timestamp);
  if (rowIndicator.dataset.state !== status.state) rowIndicator.dataset.state = status.state;
  if (rowIndicator.textContent !== status.mark) rowIndicator.textContent = status.mark;
  const heading = rowLabel.parentElement!;
  let badge = heading.querySelector<HTMLElement>('.session-row-badge');
  if (presentation.badge) {
    if (!badge) { badge = row.ownerDocument.createElement('span'); badge.className = 'session-row-badge'; heading.append(badge); }
    if (badge.textContent !== presentation.badge) badge.textContent = presentation.badge;
  } else badge?.remove();
  row.setAttribute('aria-label', `${name} — ${status.label}${presentation.badge ? ` — ${presentation.badge}` : ''}`);
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
