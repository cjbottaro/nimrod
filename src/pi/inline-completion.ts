/** A presentation-only mirror: ghost text never enters the textarea or draft. */
export function installInlineCompletion(input: HTMLTextAreaElement, id: string): {
  show(suffix: string, announcement: string): void; hide(): void; dispose(): void;
} {
  const document = input.ownerDocument;
  const overlay = document.createElement('div');
  overlay.className = 'composer-inline-completion';
  overlay.setAttribute('aria-hidden', 'true');
  const mirror = document.createElement('div');
  mirror.className = 'composer-inline-mirror';
  const prefix = document.createElement('span');
  prefix.className = 'composer-inline-prefix';
  const anchor = document.createElement('span');
  anchor.className = 'composer-inline-anchor';
  const ghost = document.createElement('span');
  ghost.className = 'composer-inline-suffix';
  anchor.append(ghost); mirror.append(prefix, anchor); overlay.append(mirror);
  const status = document.createElement('span');
  status.id = id; status.className = 'composer-inline-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  input.after(overlay, status);
  const describedBy = input.getAttribute('aria-describedby');
  input.setAttribute('aria-describedby', [describedBy, id].filter(Boolean).join(' '));
  function syncScroll(): void {
    mirror.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
  }
  input.addEventListener('scroll', syncScroll);
  // ResizeObserver accounts for the textarea's scrollbar without layout reads
  // in the typing path. CSS handles font/zoom changes and the initial width.
  const Observer = document.defaultView?.ResizeObserver;
  const observer = Observer && new Observer(entries => {
    const entry = entries[0];
    if (entry) mirror.style.width = `${entry.contentRect.width}px`;
  });
  observer?.observe(input);
  function hide(): void { overlay.hidden = true; status.textContent = ''; }
  hide();
  return {
    show(suffix, announcement) {
      if (prefix.textContent !== input.value) prefix.textContent = input.value;
      if (ghost.textContent !== suffix) ghost.textContent = suffix;
      if (status.textContent !== announcement) status.textContent = announcement;
      overlay.hidden = !suffix;
      syncScroll();
    },
    hide,
    dispose() {
      observer?.disconnect(); input.removeEventListener('scroll', syncScroll);
      overlay.remove(); status.remove();
      const remaining = (input.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(value => value && value !== id);
      if (remaining.length) input.setAttribute('aria-describedby', remaining.join(' '));
      else input.removeAttribute('aria-describedby');
    },
  };
}
