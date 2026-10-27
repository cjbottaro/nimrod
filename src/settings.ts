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

/** Commit individual runtime fields on change/blur/Enter, never on each keystroke. */
export function installRuntimeSettings(elements: {
  form: HTMLFormElement; fields: HTMLFieldSetElement; pi: HTMLInputElement; node: HTMLInputElement; copilot?: HTMLInputElement; codex?: HTMLInputElement; status: HTMLElement;
}, host: { read(): unknown; save(paths: RuntimePaths & { version: 1 }, changed: RuntimeField[]): void | RuntimePaths | Promise<void | RuntimePaths>; error?(message?: string, field?: RuntimeField): void }): {
  initialize(defaults: RuntimePaths, legacy?: unknown): void;
  current(): RuntimePaths; resetField(key: RuntimeField): void; reload(): void; dispose(): void;
} {
  const { form, fields, status } = elements;
  const inputs = new Map<RuntimeField, HTMLInputElement>();
  for (const key of ['pi', 'node', 'copilot', 'codex'] as const) if (elements[key]) inputs.set(key, elements[key]!);
  let committed: RuntimePaths | undefined;
  const edited = new Set<RuntimeField>();
  const versions = new Map<RuntimeField, number>();
  const attempts = new Map<RuntimeField, string>();
  const failures = new Map<RuntimeField, string>();
  let disposed = false, sequence = 0, applied = 0;
  const effective = (paths: RuntimePaths, key: RuntimeField) => paths[key] ?? key;
  fields.disabled = true;
  if (host.error) form.noValidate = true;
  const message = (text: string, error = false) => {
    if (error && host.error) { host.error(text); status.textContent = ''; status.classList.remove('error'); }
    else { status.textContent = text; status.classList.toggle('error', error); }
  };
  const dirtyKeys = () => [...inputs].filter(([key, input]) => committed && (input.value !== effective(committed, key) || edited.has(key))).map(([key]) => key);
  const show = () => { if (committed) for (const [key, input] of inputs) input.value = effective(committed, key); };
  const reportFailures = () => {
    if (host.error) {
      if (failures.size) { status.textContent = ''; status.classList.remove('error'); }
      for (const key of inputs.keys()) host.error(failures.get(key), key);
      if (!failures.size) host.error();
    } else if (failures.size) message([...failures.values()].join(' '), true);
  };
  const commit = async (key: RuntimeField) => {
    if (!committed || disposed || !dirtyKeys().includes(key)) return;
    const field = inputs.get(key)!;
    const value = field.value, version = versions.get(key) ?? 0;
    const signature = JSON.stringify([version, value]);
    // Native change followed by blur is one intent, including failed writes.
    if (attempts.get(key) === signature) return;
    attempts.set(key, signature);
    const request = ++sequence;
    try {
      // Validate only this field against committed paths, not other partial drafts.
      const next = runtimePaths({ ...committed, [key]: value });
      message('Saving… Applies to new sessions.');
      const authoritative = await host.save({ version: 1, ...next }, [key]);
      if (disposed) return;
      const dirty = new Set(dirtyKeys());
      if (request >= applied) {
        applied = request;
        committed = authoritative ? runtimePaths(authoritative) : { ...committed, [key]: next[key] };
      }
      if ((versions.get(key) ?? 0) === version && field.value === value) {
        dirty.delete(key); edited.delete(key);
      }
      for (const [name, element] of inputs) if (!dirty.has(name)) element.value = effective(committed, name);
      if (attempts.get(key) === signature) failures.delete(key);
      reportFailures();
      if (!failures.size) message('Saved. Applies to new sessions.');
    } catch (error) {
      if (disposed || attempts.get(key) !== signature || (versions.get(key) ?? 0) !== version) return;
      failures.set(key, `Not saved (${key}): ${String(error)}`); reportFailures();
    }
  };
  const targetKey = (event: Event) => [...inputs].find(([, element]) => event.target === element)?.[0];
  const input = (event: Event) => {
    const key = targetKey(event);
    if (key) {
      edited.add(key); versions.set(key, (versions.get(key) ?? 0) + 1);
      if (!failures.size) message('Changes save when you leave the field. Applies to new sessions.');
    }
  };
  const change = (event: Event) => { const key = targetKey(event); if (key) void commit(key); };
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Enter' || !targetKey(event)) return;
    event.preventDefault(); change(event);
  };
  const submit = (event: Event) => { event.preventDefault(); for (const key of dirtyKeys()) void commit(key); };
  form.addEventListener('submit', submit); form.addEventListener('input', input);
  form.addEventListener('change', change); form.addEventListener('blur', change, true); form.addEventListener('keydown', keydown);
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
      } catch (error) { message(`Could not restore saved runtime settings: ${String(error)}. Review and edit the affected paths.`, true); }
      show(); fields.disabled = false;
    },
    reload() {
      if (!committed) return;
      const dirty = new Set(dirtyKeys()), saved = host.read(); if (saved == null) return;
      const next = runtimePaths(saved);
      if ([...inputs.keys()].every(key => effective(next, key) === effective(committed!, key))) return;
      committed = next;
      for (const [key, input] of inputs) if (!dirty.has(key)) input.value = effective(next, key);
      if (!failures.size) message(dirty.size ? 'Saved paths changed. Your unfinished edits are retained.' : 'Updated from settings.json. Applies to new sessions.');
    },
    resetField(key) {
      if (!committed) return;
      const input = inputs.get(key); if (input) input.value = effective(committed, key);
      edited.delete(key); versions.set(key, (versions.get(key) ?? 0) + 1);
      attempts.delete(key); failures.delete(key); applied = ++sequence;
      reportFailures(); if (!failures.size) message('Applies to new sessions.');
    },
    current() { if (!committed) throw new Error('Runtime paths are not ready.'); return { ...committed }; },
    dispose() {
      disposed = true;
      form.removeEventListener('submit', submit); form.removeEventListener('input', input);
      form.removeEventListener('change', change); form.removeEventListener('blur', change, true); form.removeEventListener('keydown', keydown);
    },
  };
}
