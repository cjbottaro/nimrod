/** Presentation metadata only; each integration still owns keyboard delivery. */
export type ComposerModifier = 'shift' | 'alt' | 'control' | 'meta';
export interface ComposerHint {
  text: string;
  /** Exact held modifiers. Omit for status text or unmodified shortcuts. */
  modifiers?: readonly ComposerModifier[];
}
export type ComposerHints = string | readonly ComposerHint[];

export const sendHint: ComposerHint = { text: 'Enter to send' };
export const newlineHint: ComposerHint = { text: 'Shift+Enter for newline', modifiers: ['shift'] };

/** Shared by all mounted conversations, without interpreting hint text or harness identity. */
export function installComposerHints(prompt: HTMLTextAreaElement, container: HTMLElement, options: {
  enabled(): boolean;
  signal: AbortSignal;
}): { render(hints: ComposerHints): void; reset(): void } {
  const document = prompt.ownerDocument;
  const window = document.defaultView!;
  let signature: string | undefined;
  let held: readonly ComposerModifier[] = [];
  let composing = false;
  let windowFocused = true;
  let entries: { hint: ComposerHint; node: HTMLElement; highlighted: boolean }[] = [];

  function update(): void {
    const eligible = options.enabled() && document.activeElement === prompt && windowFocused && !document.hidden && !composing;
    if (!eligible) held = [];
    for (const entry of entries) {
      const modifiers = entry.hint.modifiers;
      const highlighted = eligible && held.length > 0 && !!modifiers?.length
        && modifiers.length === held.length && modifiers.every(modifier => held.includes(modifier));
      if (entry.highlighted === highlighted) continue;
      entry.highlighted = highlighted;
      entry.node.classList.toggle('composer-hint-active', highlighted);
    }
  }
  function reset(): void { held = []; update(); }
  function keyboard(event: KeyboardEvent): void {
    if (event.isComposing || event.keyCode === 229 || document.activeElement !== prompt || !options.enabled()) {
      reset(); return;
    }
    const modifiers = { shift: event.shiftKey, alt: event.altKey, control: event.ctrlKey, meta: event.metaKey };
    held = (['shift', 'alt', 'control', 'meta'] as const).filter(modifier => modifiers[modifier]);
    update();
  }
  const listenerOptions = { capture: true, signal: options.signal };
  window.addEventListener('keydown', keyboard, listenerOptions);
  window.addEventListener('keyup', keyboard, listenerOptions);
  window.addEventListener('blur', () => { windowFocused = false; reset(); }, { signal: options.signal });
  window.addEventListener('focus', () => { windowFocused = true; reset(); }, { signal: options.signal });
  prompt.addEventListener('blur', reset, { signal: options.signal });
  prompt.addEventListener('compositionstart', () => { composing = true; reset(); }, { signal: options.signal });
  prompt.addEventListener('compositionend', () => { composing = false; reset(); }, { signal: options.signal });
  document.addEventListener('visibilitychange', reset, { signal: options.signal });
  options.signal.addEventListener('abort', reset, { once: true });

  return {
    reset,
    render(hints) {
      const next = JSON.stringify(hints);
      if (signature !== next) {
        signature = next;
        entries = [];
        if (typeof hints === 'string') container.textContent = hints;
        else {
          const nodes: Node[] = [];
          for (const hint of hints) {
            if (nodes.length) nodes.push(document.createTextNode(' · '));
            const node = document.createElement('span');
            node.textContent = hint.text;
            entries.push({ hint, node, highlighted: false });
            nodes.push(node);
          }
          container.replaceChildren(...nodes);
        }
      }
      update();
    },
  };
}
