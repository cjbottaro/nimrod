export interface DeletionTreeSession { file: string; title: string; parent?: string | null; cwd?: string; }
export interface DeletionReviewData { id: string; sessions: DeletionTreeSession[]; }

function sessionIcon(doc: Document): SVGSVGElement {
  const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('deletion-tree-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
  icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor');
  icon.setAttribute('stroke-width', '1.6'); icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M21 15a3 3 0 0 1-3 3H7l-4 3V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3z M7 8h10 M7 12h6');
  icon.append(path); return icon;
}

/** App-owned HTML dialog; no native alert, prompts, or filesystem operations. */
export function installDeletionReview(dialog: HTMLDialogElement) {
  const doc = dialog.ownerDocument;
  const win = doc.defaultView!;
  const tree = dialog.querySelector<HTMLElement>('#deletion-tree')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('#deletion-cancel')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('#deletion-confirm')!;
  let pending: { resolve(answer: boolean): void } | undefined;
  let disposed = false;
  let preview: 'idle' | 'loading' | 'cancelled' = 'idle';
  let loadingTimer: number | undefined;

  function clearLoadingTimer(): void {
    if (loadingTimer !== undefined) win.clearTimeout(loadingTimer);
    loadingTimer = undefined;
  }
  function tryShow(): void {
    if (loadingTimer !== undefined || (!pending && preview !== 'loading') || disposed || dialog.open || doc.querySelector('dialog[open]')) return;
    dialog.returnValue = '';
    dialog.showModal(); cancel.focus();
  }
  function onOtherClose(event: Event): void { if (event.target !== dialog) tryShow(); }
  function finish(answer = false): void {
    clearLoadingTimer();
    const request = pending; pending = undefined;
    doc.removeEventListener('close', onOtherClose, true);
    request?.resolve(answer);
  }
  function close(): void {
    preview = 'idle';
    if (dialog.open) dialog.close('cancel'); else finish();
  }
  const onClose = () => {
    if (preview === 'loading') preview = 'cancelled';
    finish(!confirm.disabled && dialog.returnValue === 'delete');
  };
  const onKey = (event: KeyboardEvent) => {
    if (!dialog.open || !['Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopPropagation();
    if (event.isComposing || event.keyCode === 229 || (event.key === 'Enter' && event.repeat)) return;
    if (event.key === 'Escape') dialog.close('cancel');
    else if (pending && !confirm.disabled) dialog.close('delete');
  };
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('keydown', onKey);
  return {
    loading(): void {
      if (disposed || pending || preview === 'loading') return;
      preview = 'loading';
      confirm.disabled = true; confirm.textContent = 'Delete sessions';
      tree.setAttribute('aria-busy', 'true');
      const status = doc.createElement('div'); status.className = 'deletion-loading'; status.setAttribute('role', 'status');
      const spinner = doc.createElement('span'); spinner.className = 'deletion-spinner'; spinner.setAttribute('aria-hidden', 'true');
      status.append(spinner, 'Loading session tree…'); tree.replaceChildren(status);
      doc.addEventListener('close', onOtherClose, true);
      // Local previews normally finish before this: show a populated review
      // directly instead of flashing an intermediate loading modal.
      loadingTimer = win.setTimeout(() => { loadingTimer = undefined; tryShow(); }, 150);
    },
    review(data: DeletionReviewData): Promise<boolean> {
      if (disposed || pending || preview === 'cancelled') return Promise.resolve(false);
      clearLoadingTimer();
      if (!data.sessions.length) { close(); return Promise.resolve(false); }
      const projects = new Set(data.sessions.map(session => session.cwd).filter(Boolean));
      const titles = new Map<string, number>();
      const children = new Map<string | null, DeletionTreeSession[]>();
      const files = new Set(data.sessions.map(session => session.file));
      for (const session of data.sessions) {
        titles.set(session.title, (titles.get(session.title) || 0) + 1);
        const parent = session.parent && files.has(session.parent) ? session.parent : null;
        children.set(parent, [...children.get(parent) || [], session]);
      }
      // Iterative rendering avoids recursive stack limits on deeply forked trees.
      const list = doc.createElement('ul'); list.setAttribute('role', 'list');
      const stack = [...children.get(null) || []].reverse().map(session => ({ session, list }));
      const seen = new Set<string>();
      while (stack.length) {
        const { session, list: target } = stack.pop()!;
        if (seen.has(session.file)) continue;
        seen.add(session.file);
        const item = doc.createElement('li'), row = doc.createElement('div'), text = doc.createElement('div'), name = doc.createElement('span');
        row.className = 'deletion-tree-row'; text.className = 'deletion-tree-text'; name.className = 'deletion-tree-name';
        if (target === list) row.classList.add('deletion-tree-root');
        name.textContent = session.title || 'Untitled session'; text.append(name);
        if ((titles.get(session.title) || 0) > 1) {
          const detail = doc.createElement('small'); detail.textContent = session.file; text.append(detail);
        }
        if (projects.size > 1 && session.cwd) {
          const project = doc.createElement('small'); project.textContent = `Project: ${session.cwd}`; text.append(project);
        }
        row.append(sessionIcon(doc), text); item.append(row); target.append(item);
        const descendants = children.get(session.file) || [];
        if (descendants.length) {
          const nested = doc.createElement('ul'); nested.setAttribute('role', 'list'); item.append(nested);
          for (const child of [...descendants].reverse()) stack.push({ session: child, list: nested });
        }
      }
      if (seen.size !== files.size) { close(); return Promise.resolve(false); }
      preview = 'idle'; confirm.disabled = false; tree.setAttribute('aria-busy', 'false');
      tree.replaceChildren(list); tree.scrollTop = 0;
      confirm.textContent = `Delete ${data.sessions.length} ${data.sessions.length === 1 ? 'session' : 'sessions'}`;
      return new Promise(resolve => {
        pending = { resolve }; doc.addEventListener('close', onOtherClose, true); tryShow();
      });
    },
    cancel: close,
    dispose() { disposed = true; close(); dialog.removeEventListener('close', onClose); dialog.removeEventListener('keydown', onKey); },
  };
}
