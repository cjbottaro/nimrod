import { clearModalMotion } from './modal-motion';

export const RUNTIME_STORAGE_KEY = 'nimrod.runtime.v1';
export interface RuntimePaths { pi: string; node: string; copilot?: string; }
export type RuntimeField = 'pi' | 'node' | 'copilot';

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
  return { pi: path(raw.pi, 'Pi'), node: path(raw.node, 'Node'), ...(raw.copilot === undefined ? {} : { copilot: path(raw.copilot, 'Copilot') }) };
}

/** Runtime fields have an explicit Save boundary; unsaved edits never affect a launch. */
export function installRuntimeSettings(elements: {
  form: HTMLFormElement; fields: HTMLFieldSetElement; pi: HTMLInputElement; node: HTMLInputElement; copilot?: HTMLInputElement; status: HTMLElement;
}, host: { read(): unknown; save(paths: RuntimePaths & { version: 1 }, changed: RuntimeField[]): void | RuntimePaths | Promise<void | RuntimePaths>; error?(message?: string): void }): {
  initialize(defaults: RuntimePaths, legacy?: unknown): void;
  current(): RuntimePaths;
  resetField(key: RuntimeField): void;
  reload(): void;
  dispose(): void;
} {
  const { form, fields, pi, node, copilot, status } = elements;
  let committed: RuntimePaths | undefined;
  const edited = new Set<RuntimeField>();
  fields.disabled = true;
  if (host.error) form.noValidate = true;
  const message = (text: string, error = false) => {
    if (error && host.error) { host.error(text); status.textContent = ''; status.classList.remove('error'); }
    else { status.textContent = text; status.classList.toggle('error', error); }
  };
  const show = () => { if (committed) { pi.value = committed.pi; node.value = committed.node; if (copilot) copilot.value = committed.copilot ?? 'copilot'; } };
  const dirty = () => !!committed && (pi.value !== committed.pi || node.value !== committed.node || !!copilot && copilot.value !== (committed.copilot ?? 'copilot'));
  const submit = async (event: Event) => {
    event.preventDefault();
    if (!committed) return;
    try {
      const next = runtimePaths({ pi: pi.value, node: node.value, ...(copilot ? { copilot: copilot.value } : {}) });
      fields.disabled = true;
      const changed = (['pi', 'node', ...(copilot ? ['copilot' as const] : [])] as RuntimeField[]).filter(key => edited.has(key) || next[key] !== committed![key]);
      const saving = host.save({ version: 1, ...next }, changed);
      const authoritative = saving ? await saving : undefined;
      committed = authoritative ? runtimePaths(authoritative) : next; edited.clear(); show(); host.error?.();
      message('Saved. These paths will be used for the next session.');
    } catch (error) { message(`Not saved: ${String(error)}`, true); }
    finally { fields.disabled = false; }
  };
  const input = (event: Event) => {
    if (event.target === pi) edited.add('pi');
    if (event.target === node) edited.add('node');
    if (event.target === copilot) edited.add('copilot');
    if (!committed) return;
    message(dirty() ? 'Unsaved changes. Save to use these paths for the next session.' : '');
  };
  form.addEventListener('submit', submit);
  form.addEventListener('input', input);
  return {
    initialize(defaults, legacy) {
      // Preserve previous launch preferences without replacing a new-format saved choice.
      committed = runtimePaths(defaults);
      try {
        const old = legacy && typeof legacy === 'object' ? legacy as Partial<RuntimePaths> : {};
        committed = runtimePaths({ pi: old.pi ?? defaults.pi, node: old.node ?? defaults.node, ...(defaults.copilot === undefined ? {} : { copilot: defaults.copilot }) });
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
      const dirtyPi = pi.value !== committed.pi || edited.has('pi');
      const dirtyNode = node.value !== committed.node || edited.has('node');
      const dirtyCopilot = !!copilot && (copilot.value !== (committed.copilot ?? 'copilot') || edited.has('copilot'));
      const saved = host.read();
      if (saved == null) return;
      const next = runtimePaths(saved);
      if (next.pi === committed.pi && next.node === committed.node && next.copilot === committed.copilot) return;
      committed = next;
      if (!dirtyPi) pi.value = next.pi;
      if (!dirtyNode) node.value = next.node;
      if (copilot && !dirtyCopilot) copilot.value = next.copilot ?? 'copilot';
      if (!dirtyPi && !dirtyNode && !dirtyCopilot) message('Updated from settings.json. Applies to the next session.');
      else message('Saved paths changed in settings.json. Your unsaved edits are retained; Save replaces the corresponding saved paths.');
    },
    resetField(key) {
      if (!committed) return;
      const field = key === 'pi' ? pi : key === 'node' ? node : copilot;
      if (field) field.value = committed[key] ?? 'copilot';
      edited.delete(key);
      message(dirty() ? 'Unsaved changes. Save to use these paths for the next session.' : '');
    },
    current() {
      if (!committed) throw new Error('Runtime paths are not ready.');
      return { ...committed };
    },
    dispose() { form.removeEventListener('submit', submit); form.removeEventListener('input', input); },
  };
}
