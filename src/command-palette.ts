import { vscodeMruRanking, type CommandRanking } from './command-ranking';
import { createPickerEnterHint } from './picker-hints';
import { createSessionRowContent, updateSessionRowContent, sessionStatusPresentation } from './session-sidebar';
import type { SessionListEntry } from './session-list';

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  current?: boolean;
  projectOpen?: boolean;
  projectParent?: string;
  sessionRow?: SessionListEntry;
  inspection?: { fields: [string, string][]; text?: string };
  shortcut?: string;
  keywords?: string;
  run(): void | Promise<void>;
  next?: boolean;
}
export interface PalettePage { items: PaletteItem[]; notice?: string; }
export interface PaletteOptions {
  commands(): (PaletteItem & { detail: string })[];
  sessions(signal: AbortSignal, publish: (page: PalettePage) => void): Promise<PalettePage>;
  openSessions(): PalettePage;
  deleteSessions?: (signal: AbortSignal, publish: (page: PalettePage) => void) => Promise<PalettePage>;
  sessionDeleted?: (id: string) => boolean;
  projects?: () => Promise<PalettePage>;
  canOpen(): boolean;
  shortcuts?: boolean;
  error?(message: string, operation: string): void;
  ranking?: CommandRanking;
}
export interface PreviewSelectionRequest {
  show(page: PalettePage, currentId?: string): void;
  error(message: string): void;
  isCurrent(): boolean;
  cancel(): void;
}
export interface InspectionRequest {
  show(page: PalettePage): void;
  isCurrent(): boolean;
  cancel(): void;
}
/** Explicitly retained interaction: selection updates its page instead of closing the shell. */
export interface RetainedSelectionRequest {
  show(page: PalettePage, context: HTMLElement): void;
  remaining(text: string): void;
  focus(): void;
  isCurrent(): boolean;
  cancel(): void;
}
export interface SelectionRequest {
  choose(options: string[], current?: string): Promise<string | undefined>;
  chooseItems(options: readonly { id: string; label: string; detail?: string; keywords?: string }[], current?: string): Promise<string | undefined>;
  error(message: string): void;
  finish(): void;
  cancel(): void;
}

/** Window-local command interaction, not a harness command dispatcher.
 * Pages own their content; this controller owns dismissal, cancellation and focus.
 * Escape always dismisses the interaction. Only explicit Back navigates to commands.
 */
export function installCommandPalette(win: Window, dialog: HTMLDialogElement, options: PaletteOptions) {
  const realm = win as Window & typeof globalThis;
  const doc = dialog.ownerDocument;
  const input = dialog.querySelector<HTMLInputElement>('#palette-input')!;
  const list = dialog.querySelector<HTMLElement>('#palette-list')!;
  const title = dialog.querySelector<HTMLElement>('#palette-title')!;
  const status = dialog.querySelector<HTMLElement>('#palette-status')!;
  const back = dialog.querySelector<HTMLButtonElement>('#palette-back')!;
  const retry = dialog.querySelector<HTMLButtonElement>('#palette-refresh')!;
  const create = dialog.querySelector<HTMLButtonElement>('#palette-create')!;
  const hint = dialog.querySelector<HTMLElement>('#palette-hint')!;
  const inspection = doc.createElement('section');
  inspection.id = 'palette-inspection'; inspection.hidden = true;
  inspection.setAttribute('aria-label', 'Selected item details');
  list.after(inspection);
  const context = doc.createElement('section'); context.id = 'palette-context'; context.hidden = true;
  context.setAttribute('role', 'region'); context.setAttribute('aria-label', 'Choice context');
  input.parentElement!.before(context);
  const remaining = doc.createElement('span'); remaining.id = 'palette-remaining'; remaining.hidden = true;
  hint.before(remaining);
  const controller = new realm.AbortController();
  const signal = controller.signal;
  let mode: 'commands' | 'sessions' | 'projects' | 'selection' | 'inspection' | 'name' = 'commands';
  let items: PaletteItem[] = [], matches: PaletteItem[] = [];
  let selected = 0;
  let generation = 0;
  let historyRequest: AbortController | undefined;
  let commandQuery = '';
  let notice = '';
  let loading = false;
  let opener: HTMLElement | undefined;
  let afterClose: (() => void | Promise<void>) | undefined;
  let resolveChoice: ((value: string | undefined) => void) | undefined;
  let retryAction: (() => void) | undefined;
  let createNamed: ((name: string) => void | Promise<void>) | undefined;
  let composing = false;
  let closing = false;
  let disposed = false;
  let sessionKind: 'resume' | 'open' | 'delete' = 'resume';
  let deleting = false;
  let preview: ((item?: PaletteItem) => void) | undefined;
  let cancelPreview: (() => void) | undefined;
  let dismissRetained: (() => void) | undefined;
  let previewed: string | undefined;
  function failure(message: string): void {
    if (options.error) { options.error(message, title.textContent || 'Command palette'); notice = ''; }
    else notice = message;
  }
  function endPreview(accepted = false): void {
    const cancel = cancelPreview;
    preview = undefined; cancelPreview = undefined; previewed = undefined;
    delete dialog.dataset.preview;
    hint.textContent = 'Esc to close';
    if (!accepted) cancel?.();
  }

  function endRetained(): void {
    const dismiss = dismissRetained; dismissRetained = undefined;
    context.hidden = true; context.replaceChildren(); remaining.hidden = true; remaining.textContent = '';
    delete dialog.dataset.retained;
    dismiss?.();
  }

  function deletionControls(pending: boolean): void {
    deleting = pending;
    input.readOnly = pending; back.disabled = pending; retry.disabled = pending;
    list.setAttribute('aria-busy', String(pending));
  }

  function cancelChoice(): void { const resolve = resolveChoice; resolveChoice = undefined; resolve?.(undefined); }
  // Invalidate synchronously: native dialog close events are queued, and pending
  // metadata/choices must stop being actionable before focus restoration completes.
  // Omitting an action is cancellation, never navigation or command execution.
  function closeInteraction(action?: () => void | Promise<void>): void {
    if (!dialog.open) return;
    afterClose = action;
    endRetained();
    endPreview(!!action);
    cancelChoice(); createNamed = undefined; retryAction = undefined; generation++;
    historyRequest?.abort(); historyRequest = undefined;
    closing = true;
    dialog.close();
  }
  function validName(): boolean { return !!input.value.trim() && !/[\r\n\0]/.test(input.value); }
  function draw(): void {
    const naming = mode === 'name';
    dialog.dataset.mode = mode;
    list.hidden = naming; create.hidden = !naming; hint.hidden = naming;
    inspection.hidden = mode !== 'inspection';
    if (mode !== 'inspection') inspection.replaceChildren();
    if (naming) {
      input.setAttribute('role', 'textbox');
      for (const attr of ['aria-expanded', 'aria-controls', 'aria-autocomplete', 'aria-activedescendant']) input.removeAttribute(attr);
      input.setAttribute('aria-busy', 'false');
      create.disabled = !validName();
      list.replaceChildren();
      status.textContent = 'Enter to create · Esc to cancel';
      return;
    }
    input.setAttribute('role', 'combobox'); input.setAttribute('aria-expanded', 'true');
    input.setAttribute('aria-controls', 'palette-list'); input.setAttribute('aria-autocomplete', 'list');
    const previous = matches[selected]?.id;
    const words = input.value.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
    matches = items.filter(item => words.every(word => `${item.label} ${item.badge || ''} ${item.detail || ''} ${item.sessionRow ? sessionStatusPresentation(item.sessionRow.status).label : ''} ${item.sessionRow?.harnessLabel || ''} ${item.sessionRow?.open ? 'Open' : ''} ${item.projectOpen ? 'Open' : ''} ${item.keywords || ''}`.toLocaleLowerCase().includes(word)));
    if (mode === 'commands') matches = (options.ranking?.strategy ?? vscodeMruRanking).rank(matches, { query: input.value, usage: options.ranking?.usage() ?? [] });
    selected = Math.max(0, matches.findIndex(item => item.id === previous));
    list.replaceChildren(...matches.map((item, index) => {
      const row = doc.createElement('div'); row.id = `palette-option-${index}`; row.setAttribute('role', 'option'); row.dataset.index = String(index);
      if (item.sessionRow) {
        const content = createSessionRowContent(row, `${row.id}-time`);
        content.rowLabel.classList.add('palette-item-label');
        updateSessionRowContent(content, item.sessionRow);
        content.rowLabel.parentElement!.append(createPickerEnterHint(doc));
        return row;
      }
      const heading = doc.createElement('div'); heading.className = 'palette-item-heading';
      const label = doc.createElement('span'); label.className = 'palette-item-label'; label.textContent = item.label;
      if (mode === 'selection' || mode === 'projects') {
        const marker = doc.createElement('span'); marker.className = 'palette-selection-marker';
        marker.setAttribute('aria-hidden', 'true'); marker.textContent = (mode === 'projects' ? item.projectOpen : item.current) ? '•' : '';
        if (preview) heading.append(label, marker);
        else heading.append(marker);
        if (mode === 'selection' && item.current) row.setAttribute('aria-current', 'true');
        if (mode === 'projects') row.setAttribute('aria-label', `${item.label} — ${item.detail || item.id}${item.projectOpen ? ' — Open project window' : ''}`);
      }
      if (!preview) heading.append(label);
      if (mode === 'projects') {
        row.className = 'palette-project-row';
        const parent = doc.createElement('small'); parent.className = 'palette-project-parent'; parent.textContent = item.projectParent || '';
        heading.append(parent, createPickerEnterHint(doc)); row.append(heading);
        row.title = item.detail || item.id;
        row.setAttribute('aria-label', `${item.label} — ${item.detail || item.id}${item.projectOpen ? ' — Open project window' : ''} — Enter to open`);
        return row;
      }
      if (preview) heading.append(createPickerEnterHint(doc));
      if (item.shortcut) { const shortcut = doc.createElement('kbd'); shortcut.className = 'palette-item-shortcut'; shortcut.textContent = item.shortcut; heading.append(shortcut); }
      if (item.badge) { const badge = doc.createElement('span'); badge.className = 'palette-item-badge'; badge.textContent = item.badge; heading.append(badge); }
      const detail = doc.createElement('small'); detail.className = 'palette-item-description'; detail.textContent = item.detail || '';
      row.append(heading);
      if (mode !== 'selection' || item.detail) row.append(detail);
      row.title = item.keywords || item.detail || item.label;
      return row;
    }));
    updateStatus();
    selection();
  }
  function updateStatus(): void {
    const noun = mode === 'commands' ? 'commands' : mode === 'sessions' ? 'sessions' : mode === 'projects' ? 'projects' : mode === 'inspection' ? 'servers' : 'options';
    status.textContent = loading ? `Loading ${noun}…` : notice || (matches.length ? `${matches.length} ${noun}` : items.length || mode === 'commands' ? `No matching ${noun}.` : mode === 'sessions' ? 'No sessions yet.' : mode === 'projects' ? 'No recent projects. Use File → Open project… to open a folder.' : 'No options available.');
    input.setAttribute('aria-busy', String(loading));
  }
  function selection(): void {
    for (const [index, row] of [...list.children].entries()) row.setAttribute('aria-selected', String(index === selected));
    const row = list.children[selected] as HTMLElement | undefined;
    if (row) {
      input.setAttribute('aria-activedescendant', row.id);
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    } else input.removeAttribute('aria-activedescendant');
    const item = matches[selected];
    if (mode === 'inspection') {
      inspection.replaceChildren();
      if (item?.inspection) {
        const heading = doc.createElement('h3'); heading.textContent = item.label;
        const fields = doc.createElement('dl');
        for (const [label, value] of item.inspection.fields) {
          const term = doc.createElement('dt'); term.textContent = label;
          const description = doc.createElement('dd'); description.textContent = value;
          fields.append(term, description);
        }
        inspection.append(heading, fields);
        if (item.inspection.text) {
          const text = doc.createElement('pre'); text.textContent = item.inspection.text;
          inspection.append(text);
        }
      }
      inspection.hidden = !item?.inspection;
    }
    if (preview && item?.id !== previewed) { previewed = item?.id; preview(item); }
  }
  function commands(): void {
    historyRequest?.abort(); historyRequest = undefined;
    endRetained(); endPreview();
    deletionControls(false);
    cancelChoice(); createNamed = undefined; generation++; mode = 'commands'; loading = false; notice = ''; items = options.commands(); matches = []; selected = 0;
    title.textContent = 'Commands'; input.placeholder = 'Type a command…'; input.setAttribute('aria-label', 'Search commands');
    input.value = commandQuery; back.hidden = true; retry.hidden = true; retryAction = undefined; draw(); input.focus();
  }
  function beginPage(kind: 'sessions' | 'projects' | 'selection' | 'inspection', heading: string, placeholder: string, onRetry: () => void, keepQuery = false): number | undefined {
    if (!dialog.open && !open()) return;
    historyRequest?.abort(); historyRequest = undefined;
    endRetained(); endPreview();
    deletionControls(false);
    if (mode === 'commands') commandQuery = input.value;
    cancelChoice(); createNamed = undefined; mode = kind; title.textContent = heading; input.placeholder = placeholder;
    input.setAttribute('aria-label', kind === 'sessions' ? 'Search project sessions' : heading);
    back.hidden = false; retry.hidden = false; retryAction = onRetry;
    retry.textContent = kind === 'sessions' ? 'Refresh' : 'Retry';
    loading = true; notice = ''; items = []; matches = []; selected = 0;
    if (!keepQuery) input.value = '';
    const request = ++generation;
    draw(); input.focus(); return request;
  }
  async function sessions(kind: 'resume' | 'open' | 'delete' = 'resume', refresh = false): Promise<void> {
    if (kind === 'delete' && !options.deleteSessions) return;
    sessionKind = kind;
    const request = beginPage('sessions', kind === 'delete' ? 'Delete sessions' : kind === 'resume' ? 'Resume session' : 'Switch session', kind === 'open' ? 'Type to filter open sessions…' : 'Type to filter project sessions…', () => { void sessions(kind, true); }, refresh);
    if (request === undefined) return;
    const history = historyRequest = new realm.AbortController();
    const publish = (page: PalettePage) => {
      if (history.signal.aborted || !dialog.open || generation !== request) return;
      items = page.items; notice = page.notice || ''; loading = false; draw();
    };
    try {
      const page = kind === 'delete' ? await options.deleteSessions!(history.signal, publish) : kind === 'resume' ? await options.sessions(history.signal, publish) : options.openSessions();
      if (history.signal.aborted || !dialog.open || generation !== request) return;
      items = page.items; notice = page.notice || '';
    } catch (error) {
      if (history.signal.aborted || !dialog.open || generation !== request) return;
      failure(`Could not load sessions: ${error}. Use Refresh to retry.`);
    }
    if (dialog.open && generation === request) { loading = false; draw(); }
  }
  async function projects(refresh = false): Promise<void> {
    if (!options.projects || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    const request = beginPage('projects', 'Open recent project', 'Search recent projects…', () => { void projects(true); }, refresh);
    if (request === undefined) return;
    input.setAttribute('aria-label', 'Search recent projects'); retry.textContent = 'Refresh';
    try {
      const page = await options.projects();
      if (!dialog.open || generation !== request) return;
      items = page.items; notice = page.notice || '';
    } catch (error) {
      if (!dialog.open || generation !== request) return;
      failure(`Could not load projects: ${error}. Use Refresh to retry.`);
    }
    if (dialog.open && generation === request) { loading = false; draw(); }
  }
  function startInspection(heading: string, onRefresh: () => void): InspectionRequest | undefined {
    const request = beginPage('inspection', heading, 'Search servers…', onRefresh);
    if (request === undefined) return;
    retry.textContent = 'Refresh';
    const current = () => !disposed && dialog.open && generation === request && mode === 'inspection';
    return {
      isCurrent: current,
      show(page) { if (current()) { items = page.items; notice = page.notice || ''; loading = false; draw(); } },
      cancel() { if (current()) closeInteraction(); },
    };
  }
  function startSelection(heading: string, onRetry: () => void, onError?: (message: string) => void, standalone = false): SelectionRequest | undefined {
    const request = beginPage('selection', heading, 'Type to filter…', onRetry);
    if (request === undefined) return;
    if (standalone) { back.hidden = true; retry.hidden = true; }
    const current = () => !disposed && dialog.open && generation === request && mode === 'selection';
    let accepted = false;
    const selectionFailure = (message: string) => {
      loading = false;
      if (onError) { closeInteraction(); onError(message); }
      else { failure(message); draw(); }
    };
    const chooseItems: SelectionRequest['chooseItems'] = (values, selectedValue) => {
      if (!current()) return Promise.resolve(undefined);
      return new Promise(resolve => {
        cancelChoice(); resolveChoice = resolve;
        items = values.map(value => ({ ...value, current: value.id === selectedValue,
          keywords: [value.keywords, value.id === selectedValue ? 'Current' : undefined].filter(Boolean).join(' ') || undefined,
          run: () => { accepted = true; resolve(value.id); } }));
        matches = items; selected = Math.max(0, items.findIndex(item => item.id === selectedValue));
        loading = false; notice = ''; draw();
      });
    };
    return {
      choose: (values, selectedValue) => chooseItems(values.map(value => ({ id: value, label: value })), selectedValue),
      chooseItems,
      error(message) {
        if (current()) selectionFailure(message);
        // Applying an explicitly chosen value happens after the picker closes.
        // Report to its owner, without closing any newer interaction.
        else if (accepted) onError?.(message);
      },
      finish() { if (current() && loading) selectionFailure('No choices were provided. Retry when the session is ready.'); },
      cancel() { if (current()) closeInteraction(); },
    };
  }
  function startRetainedSelection(heading: string, onDismiss: () => void): RetainedSelectionRequest | undefined {
    // A request must not replace an unrelated interaction already using the palette.
    if (doc.querySelector('dialog[open]')) return;
    const request = beginPage('selection', heading, 'Type to filter choices…', () => {});
    if (request === undefined) return;
    back.hidden = true; retry.hidden = true;
    dismissRetained = onDismiss; dialog.dataset.retained = 'true';
    const current = () => !disposed && !closing && dialog.open && generation === request && mode === 'selection';
    return {
      isCurrent: current,
      show(page, details) {
        if (!current()) return;
        items = page.items.map(item => ({ ...item, next: true, run: () => { if (current()) return item.run(); } }));
        matches = []; selected = 0; input.value = ''; notice = page.notice || ''; loading = false;
        context.replaceChildren(details); context.hidden = false;
        draw();
        if (!doc.querySelector('dialog[open]:not(#command-palette)')) input.focus({ preventScroll: true });
      },
      remaining(text) { if (current()) { remaining.textContent = text; remaining.hidden = !text; } },
      focus() { if (current() && !doc.querySelector('dialog[open]:not(#command-palette)')) input.focus({ preventScroll: true }); },
      cancel() { if (current()) closeInteraction(); },
    };
  }
  function startPreviewSelection(heading: string, onRetry: (() => void) | undefined, onPreview: (item?: PaletteItem) => void, onCancel: () => void): PreviewSelectionRequest | undefined {
    const request = beginPage('selection', heading, 'Type to filter themes…', onRetry || (() => {}));
    if (request === undefined) return;
    preview = onPreview; cancelPreview = onCancel;
    dialog.dataset.preview = 'theme'; hint.textContent = 'Esc to restore';
    const current = () => !disposed && dialog.open && generation === request && mode === 'selection';
    retry.textContent = 'Refresh'; retry.hidden = !onRetry;
    return {
      isCurrent: current,
      show(page, currentId) {
        if (!current()) return;
        items = page.items; notice = page.notice || ''; loading = false;
        if (!matches.length) { matches = items; selected = Math.max(0, items.findIndex(item => item.id === currentId)); }
        draw();
      },
      error(message) { if (current()) { loading = false; failure(message); updateStatus(); } },
      cancel() { if (current()) closeInteraction(); },
    };
  }
  function namedSession(onCreate: (name: string) => void | Promise<void>): void {
    if (doc.querySelector('dialog[open]:not(#command-palette)')) return;
    if (!dialog.open && !open()) return;
    historyRequest?.abort(); historyRequest = undefined;
    if (mode === 'commands') commandQuery = input.value;
    endRetained(); endPreview(); cancelChoice(); generation++; mode = 'name'; createNamed = onCreate; composing = false;
    title.textContent = 'New named session'; input.placeholder = 'Session name…'; input.setAttribute('aria-label', 'Session name');
    input.value = ''; back.hidden = true; retry.hidden = true; retryAction = undefined;
    loading = false; notice = ''; items = []; matches = []; selected = 0;
    draw(); input.focus();
  }
  function submitName(): void {
    if (!dialog.open || mode !== 'name' || !createNamed || composing || !validName() || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    const action = createNamed, name = input.value.trim();
    // Use the same post-close action boundary as selection, not a prompt.
    closeInteraction(() => action(name));
  }
  function open(): boolean {
    if (disposed || closing || !options.canOpen() || doc.querySelector('dialog[open]')) return false;
    opener = doc.activeElement instanceof realm.HTMLElement ? doc.activeElement : undefined;
    commandQuery = ''; afterClose = undefined;
    dialog.showModal(); commands(); return true;
  }
  function choose(index = selected): void {
    const item = matches[index];
    if (!dialog.open || !item || loading || deleting || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    if (mode === 'inspection') { selected = index; selection(); return; }
    if (mode === 'commands') options.ranking?.record(item.id);
    if (item.next) {
      if (dismissRetained) { selected = index; selection(); }
      void item.run(); return;
    }
    if (mode === 'sessions' && sessionKind === 'delete') {
      if (selected !== index) { selected = index; selection(); }
      const request = generation, selectedId = matches[selected]?.id, previousIndex = selected;
      historyRequest?.abort();
      if (notice.startsWith('Loading ')) notice = 'Refresh to finish loading history.';
      deletionControls(true);
      // Only deletion nests a review over this retained page. Never reload the
      // catalog or rebuild surviving rows after an accepted/cancelled transaction.
      void (async () => {
        let failure = '';
        try { await item.run(); } catch (error) { failure = String(error); }
        if (disposed || !dialog.open || generation !== request) return;
        deletionControls(false);
        const removed = new Set(items.filter(item => options.sessionDeleted?.(item.id)).map(item => item.id));
        if (removed.size) {
          const rows = [...list.children];
          for (let i = 0; i < matches.length; i++) if (removed.has(matches[i].id)) rows[i].remove();
          items = items.filter(item => !removed.has(item.id));
          matches = matches.filter(item => !removed.has(item.id));
          for (const [index, row] of [...list.children].entries()) (row as HTMLElement).dataset.index = String(index);
          const same = matches.findIndex(item => item.id === selectedId);
          selected = same >= 0 ? same : Math.max(0, Math.min(previousIndex, matches.length - 1));
          selection();
        }
        if (failure) { if (options.error) options.error(failure, 'Delete sessions'); else notice = [failure, notice].filter(Boolean).join(' '); }
        updateStatus();
        if (!doc.querySelector('dialog[open]:not(#command-palette)')) input.focus({ preventScroll: true });
      })();
      return;
    }
    // The action owns resolution after native focus restoration. Dismissal alone cancels.
    resolveChoice = undefined;
    closeInteraction(item.run);
  }
  input.addEventListener('compositionstart', () => { composing = true; }, { signal });
  input.addEventListener('compositionend', () => { composing = false; }, { signal });
  input.addEventListener('input', () => { matches = []; selected = 0; draw(); }, { signal });
  dialog.addEventListener('keydown', event => {
    if (!dialog.open || event.isComposing || event.keyCode === 229 || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeInteraction(); }
    else if (!deleting && event.target === input && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (matches.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; selection();
      } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) { if (mode === 'name') submitName(); else choose(); } }
    } else if (event.target === create && event.key === 'Enter' && event.repeat) {
      event.preventDefault();
    }
  }, { signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!doc.querySelector('dialog[open]:not(#command-palette)')) closeInteraction(); }, { signal });
  dialog.addEventListener('close', () => {
    historyRequest?.abort(); historyRequest = undefined;
    closing = false;
    endRetained(); endPreview();
    cancelChoice(); createNamed = undefined; retryAction = undefined; generation++;
    const action = afterClose; afterClose = undefined;
    if (!doc.querySelector('dialog[open]') && opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus({ preventScroll: true });
    if (action) void Promise.resolve().then(action).catch(error => {
      // An action error is not a reason to replay it (especially a launch).
      if (options.error) options.error(String(error), 'Command action');
      else if (open()) { notice = String(error); draw(); }
    });
  }, { signal });
  list.addEventListener('mousedown', event => event.preventDefault(), { signal });
  list.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]'); if (row) choose(Number(row.dataset.index));
  }, { signal });
  list.addEventListener('mousemove', event => {
    if ((!preview && mode !== 'inspection') || !dialog.open || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]');
    if (row && selected !== Number(row.dataset.index)) { selected = Number(row.dataset.index); selection(); }
  }, { signal });
  create.addEventListener('click', submitName, { signal });
  back.addEventListener('click', commands, { signal });
  retry.addEventListener('click', () => retryAction?.(), { signal });
  win.addEventListener('keydown', event => {
    if (options.shortcuts === false || event.defaultPrevented) return;
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'p' || event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (dialog.open) { event.preventDefault(); return; }
    if (open()) event.preventDefault();
  }, { signal });
  return { get isDeleting() { return dialog.open && mode === 'sessions' && sessionKind === 'delete' && deleting; }, open, projects, close: () => closeInteraction(), sessions: () => sessions('resume'), openSessions: () => sessions('open'), deleteSessions: () => sessions('delete'), namedSession, startSelection, startRetainedSelection, startInspection, startPreviewSelection, dispose: () => { disposed = true; historyRequest?.abort(); endRetained(); endPreview(); cancelChoice(); createNamed = undefined; generation++; controller.abort(); } };
}
