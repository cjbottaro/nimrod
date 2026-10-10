import { vscodeMruRanking, type CommandRanking } from './command-ranking';
import { createSessionRowContent, updateSessionRowContent, type SessionRowPresentation } from './session-sidebar';

export interface PaletteItem {
  id: string;
  label: string;
  detail?: string;
  badge?: string;
  current?: boolean;
  projectOpen?: boolean;
  sessionRow?: SessionRowPresentation;
  shortcut?: string;
  keywords?: string;
  run(): void | Promise<void>;
  next?: boolean;
}
export interface PalettePage { items: PaletteItem[]; notice?: string; }
export interface PaletteOptions {
  commands(): PaletteItem[];
  sessions(): Promise<PalettePage>;
  openSessions(): PalettePage;
  projects?: () => Promise<PalettePage>;
  browseProject?: () => Promise<boolean>;
  canOpen(): boolean;
  shortcuts?: boolean;
  ranking?: CommandRanking;
}
export interface SelectionRequest {
  choose(options: string[], current?: string): Promise<string | undefined>;
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
  const browse = dialog.querySelector<HTMLButtonElement>('#palette-browse')!;
  const controller = new realm.AbortController();
  const signal = controller.signal;
  let mode: 'commands' | 'sessions' | 'projects' | 'selection' | 'name' = 'commands';
  let items: PaletteItem[] = [], matches: PaletteItem[] = [];
  let selected = 0;
  let generation = 0;
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
  let browsing = false;

  function cancelChoice(): void { const resolve = resolveChoice; resolveChoice = undefined; resolve?.(undefined); }
  // Invalidate synchronously: native dialog close events are queued, and pending
  // metadata/choices must stop being actionable before focus restoration completes.
  // Omitting an action is cancellation, never navigation or command execution.
  function closeInteraction(action?: () => void | Promise<void>): void {
    if (!dialog.open) return;
    afterClose = action;
    cancelChoice(); createNamed = undefined; retryAction = undefined; generation++;
    closing = true;
    dialog.close();
  }
  function validName(): boolean { return !!input.value.trim() && !/[\r\n\0]/.test(input.value); }
  function draw(): void {
    const naming = mode === 'name';
    dialog.dataset.mode = mode;
    list.hidden = naming; create.hidden = !naming; hint.hidden = naming;
    browse.hidden = mode !== 'projects'; browse.disabled = browsing;
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
    matches = items.filter(item => words.every(word => `${item.label} ${item.badge || ''} ${item.detail || ''} ${item.sessionRow?.indicator.label || ''} ${item.sessionRow?.badge || ''} ${item.projectOpen ? 'Open' : ''} ${item.keywords || ''}`.toLocaleLowerCase().includes(word)));
    if (mode === 'commands') matches = (options.ranking?.strategy ?? vscodeMruRanking).rank(matches, { query: input.value, usage: options.ranking?.usage() ?? [] });
    selected = Math.max(0, matches.findIndex(item => item.id === previous));
    list.replaceChildren(...matches.map((item, index) => {
      const row = doc.createElement('div'); row.id = `palette-option-${index}`; row.setAttribute('role', 'option'); row.dataset.index = String(index);
      if (item.sessionRow) {
        const content = createSessionRowContent(row, `${row.id}-time`);
        content.rowLabel.classList.add('palette-item-label');
        updateSessionRowContent(content, item.label, item.sessionRow);
        return row;
      }
      const heading = doc.createElement('div'); heading.className = 'palette-item-heading';
      const label = doc.createElement('span'); label.className = 'palette-item-label'; label.textContent = item.label;
      if (mode === 'selection' || mode === 'projects') {
        const marker = doc.createElement('span'); marker.className = 'palette-selection-marker';
        marker.setAttribute('aria-hidden', 'true'); marker.textContent = (mode === 'projects' ? item.projectOpen : item.current) ? '•' : '';
        heading.append(marker);
        if (mode === 'selection' && item.current) row.setAttribute('aria-current', 'true');
        if (mode === 'projects') row.setAttribute('aria-label', `${item.label} — ${item.detail || item.id}${item.projectOpen ? ' — Open project window' : ''}`);
      }
      heading.append(label);
      if (item.badge) { const badge = doc.createElement('span'); badge.className = 'palette-item-badge'; badge.textContent = item.badge; heading.append(badge); }
      const detail = doc.createElement('small'); detail.textContent = item.detail || '';
      row.append(heading);
      if (mode !== 'selection' || item.detail) row.append(detail);
      if (item.shortcut) { const shortcut = doc.createElement('kbd'); shortcut.textContent = item.shortcut; row.append(shortcut); }
      row.title = item.keywords || item.detail || item.label;
      return row;
    }));
    const noun = mode === 'commands' ? 'commands' : mode === 'sessions' ? 'sessions' : mode === 'projects' ? 'projects' : 'options';
    status.textContent = loading ? `Loading ${noun}…` : notice || (matches.length ? `${matches.length} ${noun}` : items.length || mode === 'commands' ? `No matching ${noun}.` : mode === 'sessions' ? 'No sessions yet.' : mode === 'projects' ? 'No recent projects. Open a folder to get started.' : 'No options available.');
    input.setAttribute('aria-busy', String(loading));
    selection();
  }
  function selection(): void {
    for (const [index, row] of [...list.children].entries()) row.setAttribute('aria-selected', String(index === selected));
    const row = list.children[selected] as HTMLElement | undefined;
    if (row) {
      input.setAttribute('aria-activedescendant', row.id);
      if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop;
      else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    } else input.removeAttribute('aria-activedescendant');
  }
  function commands(): void {
    cancelChoice(); createNamed = undefined; generation++; mode = 'commands'; loading = false; notice = ''; items = options.commands(); matches = []; selected = 0;
    title.textContent = 'Commands'; input.placeholder = 'Type a command…'; input.setAttribute('aria-label', 'Search commands');
    input.value = commandQuery; back.hidden = true; retry.hidden = true; retryAction = undefined; draw(); input.focus();
  }
  function beginPage(kind: 'sessions' | 'projects' | 'selection', heading: string, placeholder: string, onRetry: () => void, keepQuery = false): number | undefined {
    if (!dialog.open && !open()) return;
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
  async function sessions(kind: 'resume' | 'open' = 'resume', refresh = false): Promise<void> {
    const isResume = kind === 'resume';
    const request = beginPage('sessions', isResume ? 'Resume session' : 'Switch session', isResume ? 'Type to filter project sessions…' : 'Type to filter open sessions…', () => { void sessions(kind, true); }, refresh);
    if (request === undefined) return;
    try {
      const page = isResume ? await options.sessions() : options.openSessions();
      if (!dialog.open || generation !== request) return;
      items = page.items; notice = page.notice || '';
    } catch (error) {
      if (!dialog.open || generation !== request) return;
      notice = `Could not load sessions: ${error}. Use Refresh to retry.`;
    }
    if (dialog.open && generation === request) { loading = false; draw(); }
  }
  async function projects(refresh = false): Promise<void> {
    if (!options.projects || browsing || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    const request = beginPage('projects', 'Open recent project', 'Search recent projects…', () => { void projects(true); }, refresh);
    if (request === undefined) return;
    input.setAttribute('aria-label', 'Search recent projects'); retry.textContent = 'Refresh';
    try {
      const page = await options.projects();
      if (!dialog.open || generation !== request) return;
      items = page.items; notice = page.notice || '';
    } catch (error) {
      if (!dialog.open || generation !== request) return;
      notice = `Could not load projects: ${error}. Use Refresh to retry.`;
    }
    if (dialog.open && generation === request) { loading = false; draw(); }
  }
  async function browseProject(): Promise<void> {
    if (!dialog.open || mode !== 'projects' || browsing || !options.browseProject || doc.querySelector('dialog[open]:not(#command-palette)')) return;
    const request = generation;
    browsing = true; input.disabled = true; back.disabled = true; retry.disabled = true; draw();
    try {
      // Keep the picker mounted under the OS chooser: cancel retains query and focus.
      const opened = await options.browseProject();
      if (dialog.open && generation === request && opened) closeInteraction();
    } catch (error) {
      if (dialog.open && generation === request) { notice = `Could not open folder: ${error}`; draw(); }
    } finally {
      browsing = false; input.disabled = false; back.disabled = false; retry.disabled = false;
      if (dialog.open && generation === request) { draw(); input.focus(); }
    }
  }
  function startSelection(heading: string, onRetry: () => void): SelectionRequest | undefined {
    const request = beginPage('selection', heading, 'Type to filter…', onRetry);
    if (request === undefined) return;
    const current = () => dialog.open && generation === request && mode === 'selection';
    return {
      choose(values, selectedValue) {
        if (!current()) return Promise.resolve(undefined);
        return new Promise(resolve => {
          cancelChoice(); resolveChoice = resolve;
          items = values.map(value => ({ id: value, label: value, current: value === selectedValue, keywords: value === selectedValue ? 'Current' : undefined, run: () => resolve(value) }));
          matches = items; selected = Math.max(0, items.findIndex(item => item.id === selectedValue));
          loading = false; notice = ''; draw();
        });
      },
      error(message) { if (current()) { loading = false; notice = message; draw(); } },
      finish() { if (current() && loading) { loading = false; notice = 'Pi did not provide choices. Retry when the session is ready.'; draw(); } },
      cancel() { if (current()) closeInteraction(); },
    };
  }
  function namedSession(onCreate: (name: string) => void | Promise<void>): void {
    if (doc.querySelector('dialog[open]:not(#command-palette)')) return;
    if (!dialog.open && !open()) return;
    if (mode === 'commands') commandQuery = input.value;
    cancelChoice(); generation++; mode = 'name'; createNamed = onCreate; composing = false;
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
    if (closing || browsing || !options.canOpen() || doc.querySelector('dialog[open]')) return false;
    opener = doc.activeElement instanceof realm.HTMLElement ? doc.activeElement : undefined;
    commandQuery = ''; afterClose = undefined;
    dialog.showModal(); commands(); return true;
  }
  function choose(index = selected): void {
    const item = matches[index];
    if (!dialog.open || !item || loading || browsing) return;
    if (mode === 'commands') options.ranking?.record(item.id);
    if (item.next) { void item.run(); return; }
    // The action owns resolution after native focus restoration. Dismissal alone cancels.
    resolveChoice = undefined;
    closeInteraction(item.run);
  }
  input.addEventListener('compositionstart', () => { composing = true; }, { signal });
  input.addEventListener('compositionend', () => { composing = false; }, { signal });
  input.addEventListener('input', () => { matches = []; selected = 0; draw(); }, { signal });
  dialog.addEventListener('keydown', event => {
    if (!dialog.open || browsing || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeInteraction(); }
    else if (event.target === input && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault(); if (matches.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length; selection();
      } else if (event.key === 'Enter') { event.preventDefault(); if (!event.repeat) { if (mode === 'name') submitName(); else choose(); } }
    } else if (event.target === create && event.key === 'Enter' && event.repeat) {
      event.preventDefault();
    }
  }, { signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!browsing) closeInteraction(); }, { signal });
  dialog.addEventListener('close', () => {
    closing = false;
    cancelChoice(); createNamed = undefined; retryAction = undefined; generation++;
    const action = afterClose; afterClose = undefined;
    if (!doc.querySelector('dialog[open]') && opener?.isConnected && !opener.closest('[hidden], [inert]')) opener.focus({ preventScroll: true });
    if (action) void Promise.resolve().then(action).catch(error => {
      // An action error is not a reason to replay it (especially a launch).
      if (open()) { notice = String(error); draw(); }
    });
  }, { signal });
  list.addEventListener('mousedown', event => event.preventDefault(), { signal });
  list.addEventListener('click', event => {
    const row = (event.target as HTMLElement).closest<HTMLElement>('[data-index]'); if (row) choose(Number(row.dataset.index));
  }, { signal });
  browse.addEventListener('click', () => { void browseProject(); }, { signal });
  create.addEventListener('click', submitName, { signal });
  back.addEventListener('click', commands, { signal });
  retry.addEventListener('click', () => retryAction?.(), { signal });
  win.addEventListener('keydown', event => {
    if (options.shortcuts === false || event.defaultPrevented) return;
    if (!(event.metaKey || event.ctrlKey) || !event.shiftKey || event.altKey || event.key.toLowerCase() !== 'p' || event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (dialog.open) { event.preventDefault(); return; }
    if (open()) event.preventDefault();
  }, { signal });
  return { open, projects, close: () => closeInteraction(), sessions: () => sessions('resume'), openSessions: () => sessions('open'), namedSession, startSelection, dispose: () => { cancelChoice(); createNamed = undefined; generation++; controller.abort(); } };
}
