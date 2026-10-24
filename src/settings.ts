import { clearModalMotion } from './modal-motion';

export const RUNTIME_STORAGE_KEY = 'nimrod.runtime.v1';
export interface RuntimePaths { pi: string; node: string; copilot?: string; codex?: string; }
export type RuntimeField = 'pi' | 'node' | 'copilot' | 'codex';

/** A full-window settings page, using native modality to keep the workspace inert but laid out. */
export function installSettings(window: Window, page: HTMLDialogElement, openButton: HTMLButtonElement, backButton: HTMLButtonElement, shortcuts = true, options: { canOpen?(): boolean; unavailable?(): void; closeWindow?(): void } = {}): {
  readonly isOpen: boolean;
  open(): void;
  close(): void;
  dispose(): void;
} {
  const document = page.ownerDocument;
  const anotherDialog = () => [...document.querySelectorAll('dialog[open], #dialog.open')].some(dialog => dialog !== page);
  const open = () => {
    if (page.open || anotherDialog()) return;
    if (options.canOpen && !options.canOpen()) { options.unavailable?.(); return; }
    clearModalMotion(document);
    page.showModal();
    backButton.focus({ preventScroll: true });
  };
  const close = () => {
    if (!page.open || anotherDialog()) return;
    clearModalMotion(document);
    if (options.closeWindow) { options.closeWindow(); return; }
    // Native dialog.close() restores the preceding focus target without touching workspace DOM.
    page.close();
    // A startup transition can hide the original launch control while Settings is open.
    if (document.hasFocus() && document.activeElement === document.body) openButton.focus({ preventScroll: true });
  };
  const cancel = (event: Event) => { event.preventDefault(); close(); };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.altKey || event.shiftKey || !(event.metaKey || event.ctrlKey) || event.key !== ',' || anotherDialog()) return;
    event.preventDefault(); open();
  };
  openButton.addEventListener('click', open);
  backButton.addEventListener('click', close);
  page.addEventListener('cancel', cancel);
  if (shortcuts) window.addEventListener('keydown', keydown);
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
  return { pi: path(raw.pi, 'Pi'), node: path(raw.node, 'Node'), ...(raw.copilot === undefined ? {} : { copilot: path(raw.copilot, 'Copilot') }), ...(raw.codex === undefined ? {} : { codex: path(raw.codex, 'Codex') }) };
}

/** Runtime fields have an explicit Save boundary; unsaved edits never affect a launch. */
export function installRuntimeSettings(elements: {
  form: HTMLFormElement; fields: HTMLFieldSetElement; pi: HTMLInputElement; node: HTMLInputElement; copilot?: HTMLInputElement; codex?: HTMLInputElement; status: HTMLElement;
}, host: { read(): unknown; save(paths: RuntimePaths & { version: 1 }, changed: RuntimeField[]): void | RuntimePaths | Promise<void | RuntimePaths>; error?(message?: string): void }): {
  initialize(defaults: RuntimePaths, legacy?: unknown): void;
  current(): RuntimePaths; resetField(key: RuntimeField): void; reload(): void; dispose(): void;
} {
  const { form, fields, status } = elements;
  const inputs = new Map<RuntimeField, HTMLInputElement>();
  for (const key of ['pi', 'node', 'copilot', 'codex'] as const) if (elements[key]) inputs.set(key, elements[key]!);
  let committed: RuntimePaths | undefined;
  const edited = new Set<RuntimeField>();
  const effective = (paths: RuntimePaths, key: RuntimeField) => paths[key] ?? key;
  fields.disabled = true;
  if (host.error) form.noValidate = true;
  const message = (text: string, error = false) => {
    if (error && host.error) { host.error(text); status.textContent = ''; status.classList.remove('error'); }
    else { status.textContent = text; status.classList.toggle('error', error); }
  };
  const dirtyKeys = () => [...inputs].filter(([key, input]) => committed && (input.value !== effective(committed, key) || edited.has(key))).map(([key]) => key);
  const show = () => { if (committed) for (const [key, input] of inputs) input.value = effective(committed, key); };
  const submit = async (event: Event) => {
    event.preventDefault(); if (!committed) return;
    try {
      const next = runtimePaths(Object.fromEntries([...inputs].map(([key, input]) => [key, input.value])));
      fields.disabled = true;
      const changed = dirtyKeys();
      const authoritative = await host.save({ version: 1, ...next }, changed);
      committed = authoritative ? runtimePaths(authoritative) : next; edited.clear(); show(); host.error?.();
      message('Saved. These paths will be used for the next session.');
    } catch (error) { message(`Not saved: ${String(error)}`, true); }
    finally { fields.disabled = false; }
  };
  const input = (event: Event) => {
    for (const [key, element] of inputs) if (event.target === element) edited.add(key);
    if (committed) message(dirtyKeys().length ? 'Unsaved changes. Save to use these paths for the next session.' : '');
  };
  form.addEventListener('submit', submit); form.addEventListener('input', input);
  return {
    initialize(defaults, legacy) {
      committed = runtimePaths(defaults);
      try {
        const old = legacy && typeof legacy === 'object' ? legacy as Partial<RuntimePaths> : {};
        committed = runtimePaths({ ...defaults, pi: old.pi ?? defaults.pi, node: old.node ?? defaults.node });
      } catch { /* Preserve detected defaults for invalid legacy values. */ }
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
      const dirty = new Set(dirtyKeys()), saved = host.read(); if (saved == null) return;
      const next = runtimePaths(saved);
      if ([...inputs.keys()].every(key => effective(next, key) === effective(committed!, key))) return;
      committed = next;
      for (const [key, input] of inputs) if (!dirty.has(key)) input.value = effective(next, key);
      message(dirty.size ? 'Saved paths changed in settings.json. Your unsaved edits are retained; Save replaces the corresponding saved paths.' : 'Updated from settings.json. Applies to the next session.');
    },
    resetField(key) {
      if (!committed) return;
      const input = inputs.get(key); if (input) input.value = effective(committed, key);
      edited.delete(key); message(dirtyKeys().length ? 'Unsaved changes. Save to use these paths for the next session.' : '');
    },
    current() { if (!committed) throw new Error('Runtime paths are not ready.'); return { ...committed }; },
    dispose() { form.removeEventListener('submit', submit); form.removeEventListener('input', input); },
  };
}
