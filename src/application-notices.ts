export interface NoticeAction {
  label: string;
  run(): void | Promise<void>;
  enabled?(): boolean;
}
export interface ApplicationNotice {
  id: string;
  operation: string;
  message: string;
  /** Optional diagnostics, kept out of the primary summary. */
  details?: string;
  /** Session runtime ID; absent for window/application operations. */
  owner?: string;
  cause?: string;
  priority?: number;
  severity?: 'error' | 'warning' | 'info';
  dismissible?: boolean;
  actions?: NoticeAction[];
}

/** Window-local UI state. No harness protocol, persistence or automatic retry. */
export class NoticeStore {
  private entries = new Map<string, ApplicationNotice>();
  private subscribers = new Set<() => void>();
  private signatures = new Map<string, string>();
  private dismissed = new Map<string, { signature: string; cause?: string; owner?: string }>();
  get notices(): readonly ApplicationNotice[] {
    const result: ApplicationNotice[] = [];
    for (const notice of this.entries.values()) {
      const index = notice.cause ? result.findIndex(entry => entry.cause === notice.cause && entry.owner === notice.owner) : -1;
      if (index < 0) result.push(notice);
      else if ((notice.priority ?? 0) >= (result[index].priority ?? 0)) result[index] = notice;
    }
    return result;
  }
  subscribe(callback: () => void): () => void { this.subscribers.add(callback); return () => { this.subscribers.delete(callback); }; }
  report(notice: ApplicationNotice): void {
    const signature = JSON.stringify([notice.operation, notice.message, notice.details, notice.owner, notice.cause, notice.priority, notice.severity, notice.dismissible, notice.actions?.map(action => [action.label, action.enabled?.() !== false])]);
    if (this.dismissed.get(notice.id)?.signature === signature) return;
    this.dismissed.delete(notice.id);
    this.entries.set(notice.id, notice); // Always refresh guarded action closures.
    if (this.signatures.get(notice.id) === signature) return;
    this.signatures.set(notice.id, signature);
    for (const listener of this.subscribers) listener();
  }
  resolve(id: string): void {
    this.dismissed.delete(id);
    if (!this.entries.delete(id)) return;
    this.signatures.delete(id);
    for (const listener of this.subscribers) listener();
  }
  resolveOwner(owner: string): void {
    for (const [id, entry] of this.entries) if (entry.owner === owner) this.resolve(id);
    for (const [id, entry] of this.dismissed) if (entry.owner === owner) this.dismissed.delete(id);
  }
  resolveCause(cause: string, owner?: string): void {
    for (const [id, entry] of this.entries) if (entry.cause === cause && entry.owner === owner) this.resolve(id);
    for (const [id, entry] of this.dismissed) if (entry.cause === cause && entry.owner === owner) this.dismissed.delete(id);
  }
  dismiss(id: string): void {
    const notice = this.entries.get(id);
    if (!notice || notice.dismissible === false) return;
    for (const [key, entry] of this.entries) {
      if (key !== id && (!notice.cause || entry.cause !== notice.cause || entry.owner !== notice.owner)) continue;
      this.dismissed.set(key, { signature: this.signatures.get(key)!, cause: entry.cause, owner: entry.owner });
      this.entries.delete(key); this.signatures.delete(key);
    }
    for (const listener of this.subscribers) listener();
  }
}

/** Fixed SVG geometry avoids font-dependent symbol baselines in session rows. */
function sessionNoticeIcon(document: Document, kind: 'warning' | 'info' | 'dismiss'): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8'); svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true'); svg.setAttribute('focusable', 'false');
  const paths = {
    warning: '<path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
    dismiss: '<path d="m6 6 12 12M6 18 18 6"/>',
  };
  svg.innerHTML = paths[kind];
  return svg;
}

/** Shared presentation and store, scoped by operation ownership.
 * Only window notices portal into dialogs. Session notices stay with their pane.
 */
export function installApplicationNotices(win: Window, store = new NoticeStore(), session?: { owner: string; container: HTMLElement }) {
  const document = win.document;
  if (!session) document.body.classList.add('application-notice-shell');
  const strip = document.createElement('section');
  if (session) { strip.className = 'session-notices'; strip.dataset.piId = 'session-notices'; strip.dataset.noticeOwner = session.owner; }
  else strip.id = 'application-notices';
  strip.setAttribute('role', 'region'); strip.setAttribute('aria-label', session ? 'Session notices' : 'Application notices'); strip.hidden = true;
  const announcement = document.createElement('span'); announcement.className = 'notice-announcement';
  announcement.setAttribute('role', 'status'); announcement.setAttribute('aria-live', 'polite'); announcement.setAttribute('aria-atomic', 'true');
  const group = document.createElement('details'); group.className = 'notice-group';
  const summary = document.createElement('summary'); summary.className = 'notice-group-summary';
  const list = document.createElement('div'); list.className = 'notice-list';
  group.append(summary, list);
  strip.append(announcement, group);
  let active = !session;
  const slot = document.createElement('div'); slot.id = 'application-notice-slot'; slot.setAttribute('aria-hidden', 'true');
  const bar = document.getElementById('workspace-bar');
  if (session) session.container.prepend(strip);
  else {
    if (bar) bar.after(slot); else document.body.prepend(slot);
    document.body.append(strip);
  }
  // Pi's fallback producer label adds no context; retain actual operation names.
  const hasOperationContext = (notice: ApplicationNotice) => !session || notice.operation !== 'Pi operation';
  const rows = new Map<string, { node: HTMLElement; signature: string }>();
  const dialogs: HTMLDialogElement[] = [];
  const focus = new Map<Element, HTMLElement>();
  let disposed = false;
  let sequence = 0;
  let announced = '';
  let measureFrame: number | undefined;
  const realm = win as Window & typeof globalThis;
  const focused = (event: FocusEvent) => {
    if (!(event.target instanceof realm.HTMLElement) || event.target instanceof realm.HTMLDialogElement || strip.contains(event.target)) return;
    if (session && !session.container.contains(event.target)) return;
    focus.set(session?.container ?? event.target.closest('dialog[open]') ?? document.body, event.target);
  };
  document.addEventListener('focusin', focused);
  const owner = () => session?.container ?? dialogs.filter(dialog => dialog.open && dialog.isConnected).at(-1) ?? document.body;
  const measure = () => {
    if (session) return;
    const height = strip.hidden ? 0 : strip.offsetHeight;
    const next = `${Math.ceil(height)}px`;
    if (document.documentElement.style.getPropertyValue('--application-notice-height') !== next) document.documentElement.style.setProperty('--application-notice-height', next);
  };
  const scheduleMeasure = () => {
    if (session || disposed || measureFrame !== undefined) return;
    measureFrame = win.requestAnimationFrame(() => { measureFrame = undefined; if (!disposed) measure(); });
  };
  const restoreFocus = (wasInStrip: boolean) => {
    if (session && !active) return;
    const parent = owner();
    if (!wasInStrip || strip.contains(document.activeElement) || (document.activeElement !== document.body && document.activeElement !== parent)) return;
    const previous = focus.get(parent);
    if (previous?.isConnected && (parent === document.body || parent.contains(previous))) previous.focus({ preventScroll: true });
  };
  const position = () => {
    const parent = owner();
    if (strip.parentElement !== parent) {
      const selected = document.activeElement;
      parent.append(strip);
      // Moving a focused notice control can blur it. Retain that exact control,
      // but never steal focus from the modal's normal opening/restoration target.
      if (selected instanceof realm.HTMLElement && strip.contains(selected) && document.activeElement === document.body) selected.focus({ preventScroll: true });
    }
  };
  const modalObserver = new realm.MutationObserver(records => {
    if (disposed) return;
    for (const record of records) {
      if (!(record.target instanceof realm.HTMLDialogElement)) continue;
      const dialog = record.target, index = dialogs.indexOf(dialog);
      if (index >= 0) dialogs.splice(index, 1);
      if (dialog.open) dialogs.push(dialog);
    }
    position(); scheduleMeasure();
  });
  for (const dialog of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) dialogs.push(dialog);
  if (!session) modalObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  const resize = 'ResizeObserver' in win ? new realm.ResizeObserver(scheduleMeasure) : undefined;
  resize?.observe(strip);
  const render = () => {
    if (disposed) return;
    const wasInStrip = strip.contains(document.activeElement);
    const notices = store.notices.filter(notice => notice.owner === session?.owner);
    let changed = false;
    for (const [id, row] of rows) if (!notices.some(notice => notice.id === id)) { row.node.remove(); rows.delete(id); changed = true; }
    for (const notice of notices) {
      let row = rows.get(notice.id);
      const enabled = notice.actions?.map(action => action.enabled?.() !== false) ?? [];
      const signature = JSON.stringify([notice.operation, notice.message, notice.details, notice.severity, notice.dismissible, notice.actions?.map(action => action.label), enabled]);
      if (!row) {
        const node = document.createElement('div'); node.className = 'application-notice'; node.dataset.noticeId = notice.id;
        row = { node, signature: '' }; rows.set(notice.id, row); list.append(node);
      }
      if (signature === row.signature) continue;
      changed = true;
      row.signature = signature; row.node.dataset.severity = notice.severity ?? 'error';
      const text = document.createElement('div'); text.className = 'application-notice-text';
      const title = document.createElement('strong');
      const body = document.createElement('span'); body.className = 'notice-message';
      // Long/raw producer messages remain available verbatim, without dominating
      // the conversation. Explicit diagnostics do not require text classification.
      const firstLine = notice.message.split('\n')[0];
      const compact = firstLine.length > 160 ? `${firstLine.slice(0, 157)}…` : firstLine;
      title.textContent = session ? compact : notice.operation;
      text.append(title);
      if (hasOperationContext(notice)) {
        body.textContent = session ? notice.operation : compact;
        text.append(body);
      }
      // Keep the complete message when shortened, even with explicit diagnostics.
      const diagnostics = [compact !== notice.message ? notice.message : undefined, notice.details].filter(Boolean).join('\n\n');
      if (diagnostics) {
        const detail = document.createElement('details'); detail.className = 'notice-details';
        const label = document.createElement('summary'); label.textContent = 'Details';
        const content = document.createElement('div'); content.textContent = diagnostics;
        detail.append(label, content); text.append(detail);
      }
      const icon = document.createElement('span'); icon.className = 'notice-icon'; icon.setAttribute('aria-hidden', 'true');
      if (session) icon.append(sessionNoticeIcon(document, notice.severity === 'info' ? 'info' : 'warning'));
      else icon.textContent = notice.severity === 'info' ? 'ⓘ' : '⚠';
      const actions = document.createElement('div'); actions.className = 'application-notice-actions';
      notice.actions?.forEach((action, index) => {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = action.label; button.disabled = !enabled[index];
        button.dataset.actionIndex = String(index); actions.append(button);
      });
      if (notice.dismissible !== false) {
        const dismiss = document.createElement('button'); dismiss.type = 'button'; dismiss.dataset.dismiss = 'true';
        if (session) dismiss.append(sessionNoticeIcon(document, 'dismiss')); else dismiss.textContent = '×';
        dismiss.setAttribute('aria-label', hasOperationContext(notice) ? `Dismiss ${notice.operation}` : 'Dismiss notice'); actions.append(dismiss);
      }
      row.node.replaceChildren(icon, text, actions);
    }
    if (strip.hidden !== !notices.length) changed = true;
    strip.hidden = !notices.length;
    const multiple = notices.length > 1;
    if (group.classList.contains('notice-group-multiple') !== multiple) { changed = true; group.open = !multiple || wasInStrip; }
    if (!multiple) group.open = true;
    group.classList.toggle('notice-group-multiple', multiple);
    const heading = `${notices.length} ${session ? 'session' : 'application'} issues`;
    if (summary.textContent !== heading) summary.textContent = heading;
    const signature = active ? JSON.stringify(notices.map(notice => [notice.id, notice.operation, notice.message])) : '';
    if (signature !== announced) { announced = signature; announcement.textContent = active ? notices.map(notice => hasOperationContext(notice) ? `${notice.operation}. ${notice.message}` : notice.message).join(' ') : ''; }
    position(); if (changed) scheduleMeasure(); restoreFocus(wasInStrip);
  };
  const click = (event: MouseEvent) => {
    const button = event.target instanceof realm.Element ? event.target.closest<HTMLButtonElement>('button') : null;
    const id = button?.closest<HTMLElement>('[data-notice-id]')?.dataset.noticeId;
    if (!button || button.disabled || !id) return;
    event.stopPropagation();
    if (button.dataset.dismiss) { store.dismiss(id); restoreFocus(true); return; }
    const notice = store.notices.find(notice => notice.id === id);
    const action = notice?.actions?.[Number(button.dataset.actionIndex)];
    if (!action || action.enabled?.() === false) return;
    button.disabled = true;
    void Promise.resolve().then(() => {
      if (disposed) return;
      const current = store.notices.find(entry => entry.id === id);
      const guarded = current?.actions?.[Number(button.dataset.actionIndex)];
      if (guarded?.label === action.label && guarded.enabled?.() !== false) return guarded.run();
    }).catch(error => {
      if (!disposed) store.report({ id: `notice-action:${session?.owner ?? 'application'}:${++sequence}`, operation: `${notice!.operation}: ${action.label}`, message: String(error), owner: notice!.owner });
    }).finally(() => {
      if (!disposed) {
        const current = store.notices.find(entry => entry.id === id);
        button.disabled = current?.actions?.[Number(button.dataset.actionIndex)]?.enabled?.() === false;
        render(); restoreFocus(true);
      }
    });
  };
  strip.addEventListener('click', click);
  strip.addEventListener('toggle', scheduleMeasure, true);
  const unsubscribe = store.subscribe(render);
  render();
  return {
    store, strip,
    setActive(value: boolean) { active = value; render(); },
    report(notice: ApplicationNotice) { store.report(notice); },
    resolve(id: string) { store.resolve(id); },
    dispose() { disposed = true; if (measureFrame !== undefined) win.cancelAnimationFrame(measureFrame); unsubscribe(); modalObserver.disconnect(); resize?.disconnect(); document.removeEventListener('focusin', focused); strip.removeEventListener('click', click); strip.removeEventListener('toggle', scheduleMeasure, true); strip.remove(); slot.remove(); if (!session) { document.body.classList.remove('application-notice-shell'); document.documentElement.style.removeProperty('--application-notice-height'); } },
  };
}
