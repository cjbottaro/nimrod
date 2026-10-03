export const RUNTIME_STORAGE_KEY = 'nimrod.runtime.v1';
export interface RuntimePaths { pi: string; node: string; }

/** A full-window settings page, using native modality to keep the workspace inert but laid out. */
export function installSettings(window: Window, page: HTMLDialogElement, openButton: HTMLButtonElement, backButton: HTMLButtonElement): {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  dispose(): void;
} {
  const document = page.ownerDocument;
  const anotherDialog = () => [...document.querySelectorAll('dialog[open], #dialog.open')].some(dialog => dialog !== page);
  const open = () => {
    if (page.open || anotherDialog()) return;
    page.showModal();
    backButton.focus({ preventScroll: true });
  };
  const close = () => {
    if (!page.open || anotherDialog()) return;
    // Native dialog.close() restores the preceding focus target without touching workspace DOM.
    page.close();
    // A startup transition can hide the original launch control while Settings is open.
    if (document.hasFocus() && document.activeElement === document.body) openButton.focus({ preventScroll: true });
  };
  const cancel = (event: Event) => { event.preventDefault(); close(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey) || event.key !== ',' || anotherDialog()) return;
    event.preventDefault(); open();
  };
  openButton.addEventListener('click', open);
  backButton.addEventListener('click', close);
  page.addEventListener('cancel', cancel);
  window.addEventListener('keydown', keydown);
  return { get isOpen() { return page.open; }, open, close, dispose() {
    openButton.removeEventListener('click', open);
    backButton.removeEventListener('click', close);
    page.removeEventListener('cancel', cancel);
    window.removeEventListener('keydown', keydown);
  } };
}

export function runtimePaths(value: unknown): RuntimePaths {
  const raw = value && typeof value === 'object' ? value as Partial<RuntimePaths> : {};
  const path = (value: unknown, name: string) => {
    if (typeof value !== 'string' || !value.trim() || value.length > 4096 || /[\u0000-\u001f\u007f]/.test(value)) throw new Error(`${name} must be a non-empty executable name or path on one line.`);
    return value.trim();
  };
  return { pi: path(raw.pi, 'Pi'), node: path(raw.node, 'Node') };
}

/** Runtime fields have an explicit Save boundary; unsaved edits never affect a launch. */
export function installRuntimeSettings(elements: {
  form: HTMLFormElement; fields: HTMLFieldSetElement; pi: HTMLInputElement; node: HTMLInputElement; status: HTMLElement;
}, host: { read(): unknown; save(paths: RuntimePaths & { version: 1 }): void | Promise<void> }): {
  initialize(defaults: RuntimePaths, legacy?: unknown): void;
  current(): RuntimePaths;
  reload(): void;
  dispose(): void;
} {
  const { form, fields, pi, node, status } = elements;
  let committed: RuntimePaths | undefined;
  fields.disabled = true;
  const message = (text: string, error = false) => { status.textContent = text; status.classList.toggle('error', error); };
  const show = () => { if (committed) { pi.value = committed.pi; node.value = committed.node; } };
  const submit = async (event: Event) => {
    event.preventDefault();
    if (!committed) return;
    try {
      const next = runtimePaths({ pi: pi.value, node: node.value });
      fields.disabled = true;
      const saving = host.save({ version: 1, ...next });
      if (saving) await saving;
      committed = next; show();
      message('Saved. These paths will be used for the next session.');
    } catch (error) { message(`Not saved: ${String(error)}`, true); }
    finally { fields.disabled = false; }
  };
  const input = () => {
    if (!committed) return;
    message(pi.value !== committed.pi || node.value !== committed.node ? 'Unsaved changes. Save to use these paths for the next session.' : '');
  };
  form.addEventListener('submit', submit);
  form.addEventListener('input', input);
  return {
    initialize(defaults, legacy) {
      // Preserve previous launch preferences without replacing a new-format saved choice.
      committed = runtimePaths(defaults);
      try {
        const old = legacy && typeof legacy === 'object' ? legacy as Partial<RuntimePaths> : {};
        committed = runtimePaths({ pi: old.pi ?? defaults.pi, node: old.node ?? defaults.node });
      } catch { /* invalid legacy values fall back to detected paths */ }
      try {
        const saved = host.read();
        if (saved != null) {
          if (typeof saved !== 'object' || (saved as { version?: unknown }).version !== 1) throw new Error('Invalid saved runtime settings');
          committed = runtimePaths(saved);
        }
        message('');
      } catch (error) { message(`Could not restore saved runtime settings: ${String(error)}. Review the paths and save again.`, true); }
      show(); fields.disabled = false;
    },
    reload() {
      if (!committed) return;
      const dirty = pi.value !== committed.pi || node.value !== committed.node;
      const saved = host.read();
      if (saved == null) return;
      const next = runtimePaths(saved);
      if (next.pi === committed.pi && next.node === committed.node) return;
      committed = next;
      if (!dirty) { show(); message('Updated from settings.json. Applies to the next session.'); }
      else message('Saved paths changed in settings.json. Your unsaved edits are retained; Save replaces the corresponding saved paths.');
    },
    current() {
      if (!committed) throw new Error('Runtime paths are not ready.');
      return { ...committed };
    },
    dispose() { form.removeEventListener('submit', submit); form.removeEventListener('input', input); },
  };
}
