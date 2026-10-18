import { showModal, closeModal } from './modal-motion';
import { fontStack, validFontFamily } from './typography';

export interface InstalledFont { family: string; monospace: boolean; }

export function installFontPicker(doc: Document, host: {
  fonts(): Promise<InstalledFont[]>;
  report(message?: string): void;
}) {
  const realm = doc.defaultView as Window & typeof globalThis;
  const controller = new realm.AbortController(), signal = controller.signal;
  const dialog = doc.createElement('dialog');
  dialog.id = 'font-picker'; dialog.className = 'nimrod-modal modal-stack';
  dialog.setAttribute('aria-labelledby', 'font-picker-title');
  dialog.innerHTML = '<header class="modal-header"><h2 id="font-picker-title" class="modal-title"></h2><button type="button" class="secondary" data-refresh>Refresh</button><button type="button" class="secondary" data-close aria-label="Close font picker">Close</button></header><input id="font-picker-search" type="search" role="combobox" aria-label="Search installed font families" aria-controls="font-picker-list" aria-autocomplete="list" aria-expanded="true" autocomplete="off" spellcheck="false"><div id="font-picker-list" class="modal-body font-picker-list" role="listbox" aria-label="Installed font families"></div><p class="modal-description" role="status"></p>';
  doc.body.append(dialog);
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const list = dialog.querySelector<HTMLElement>('[role=listbox]')!;
  const status = dialog.querySelector<HTMLElement>('[role=status]')!;
  const refresh = dialog.querySelector<HTMLButtonElement>('[data-refresh]')!;
  let fonts: InstalledFont[] | undefined, loading = false, generation = 0, disposed = false;
  let request: { monospace: boolean; current: string; opener: HTMLElement; select(family: string): void } | undefined;
  let matches: InstalledFont[] = [], selected = 0;

  function selection(scroll = false) {
    for (const [index, row] of [...list.children].entries()) row.setAttribute('aria-selected', String(index === selected));
    const row = list.children[selected] as HTMLElement | undefined;
    if (row) {
      input.setAttribute('aria-activedescendant', row.id);
      if (scroll) row.scrollIntoView?.({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  }
  function draw(initial = false) {
    if (!request || !dialog.open) return;
    const words = input.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    const available = [...(fonts ?? [])];
    if (request.current && !available.some(font => font.family === request!.current)) available.unshift({ family: request.current, monospace: request.monospace });
    available.sort((a, b) => (request!.monospace ? Number(b.monospace) - Number(a.monospace) : 0) || a.family.localeCompare(b.family));
    matches = [{ family: '', monospace: request.monospace }, ...available].filter(font => words.every(word => (font.family || 'System default').toLocaleLowerCase().includes(word)));
    selected = initial ? Math.max(0, matches.findIndex(font => font.family === request!.current)) : Math.min(selected, Math.max(0, matches.length - 1));
    list.replaceChildren(...matches.map((font, index) => {
      const row = doc.createElement('div'); row.className = 'font-picker-option'; row.id = `font-picker-option-${index}`;
      row.setAttribute('role', 'option'); row.dataset.index = String(index);
      row.setAttribute('aria-label', font.family || 'System default');
      if (font.family === request!.current) row.setAttribute('aria-current', 'true');
      const name = doc.createElement('span'); name.textContent = font.family || 'System default';
      name.style.fontFamily = fontStack(font.family, request!.monospace);
      const detail = doc.createElement('small');
      detail.textContent = !font.family ? 'System fallback' : !fonts ? 'Saved font' : !fonts.some(item => item.family === font.family) ? 'Unavailable · using fallback' : font.monospace ? 'Monospace' : '';
      row.append(name, detail); return row;
    }));
    status.textContent = loading ? 'Reading installed fonts… System default remains available.'
      : matches.length ? `${matches.length} families · Enter to choose · Esc to close` : 'No matching fonts.';
    input.setAttribute('aria-busy', String(loading));
    refresh.disabled = loading;
    selection(initial);
  }
  async function load() {
    const version = ++generation;
    loading = true; draw();
    try {
      const result = await host.fonts();
      if (disposed || version !== generation) return;
      if (!Array.isArray(result) || result.some(font => !font || !validFontFamily(font.family) || !font.family || typeof font.monospace !== 'boolean')) throw new Error('Invalid installed-font catalog.');
      fonts = [...new Map(result.map(font => [font.family, font])).values()];
      host.report();
    } catch (error) {
      if (!disposed && version === generation) host.report(`Could not list installed fonts: ${String(error)}. Choose System default or Refresh to try again.`);
    } finally {
      if (!disposed && version === generation) {
        const highlighted = matches[selected]?.family;
        loading = false; draw();
        if (highlighted !== undefined) { selected = Math.max(0, matches.findIndex(font => font.family === highlighted)); selection(true); }
      }
    }
  }
  function close(family?: string) {
    const previous = request;
    request = undefined; generation++; loading = false;
    if (dialog.open) closeModal(dialog);
    if (previous?.opener.isConnected && !disposed) previous.opener.focus({ preventScroll: true });
    if (family !== undefined && !disposed) previous?.select(family);
  }
  input.addEventListener('input', () => { selected = 0; draw(); }, { signal });
  dialog.addEventListener('keydown', event => {
    if (event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.target === input && ['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key)) {
      event.preventDefault();
      if (event.key === 'Enter') { if (!event.repeat && matches[selected]) close(matches[selected].family); return; }
      if (event.key === 'Home') selected = 0;
      else if (event.key === 'End') selected = Math.max(0, matches.length - 1);
      else if (matches.length) selected = (selected + (event.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
      selection(true);
    }
  }, { signal });
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal });
  dialog.addEventListener('close', () => { if (!dialog.open && request) close(); }, { signal });
  list.addEventListener('click', event => {
    const row = event.target instanceof realm.Element ? event.target.closest<HTMLElement>('[data-index]') : null;
    const font = row ? matches[Number(row.dataset.index)] : undefined;
    if (font) close(font.family);
  }, { signal });
  refresh.addEventListener('click', () => { void load(); }, { signal });
  dialog.querySelector('[data-close]')!.addEventListener('click', () => close(), { signal });
  return {
    open(options: NonNullable<typeof request>) {
      if (disposed || dialog.open || doc.querySelector('dialog[open]:not(#settings-page)')) return;
      request = options; input.value = ''; selected = 0;
      dialog.querySelector('h2')!.textContent = options.monospace ? 'Monospace font' : 'Conversation font';
      showModal(dialog); draw(true); input.focus({ preventScroll: true });
      if (!fonts) void load();
    },
    dispose() { disposed = true; close(); controller.abort(); dialog.remove(); },
  };
}
