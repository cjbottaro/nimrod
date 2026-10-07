export interface DeletionTreeSession { file: string; title: string; parent?: string | null; }
export interface DeletionReviewData { id: string; sessions: DeletionTreeSession[]; }

/** App-owned HTML dialog; no native alert, prompts, or filesystem operations. */
export function installDeletionReview(dialog: HTMLDialogElement) {
  const doc = dialog.ownerDocument;
  const tree = dialog.querySelector<HTMLElement>('#deletion-tree')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('#deletion-cancel')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('#deletion-confirm')!;
  let pending: { resolve(answer: boolean): void } | undefined;
  let disposed = false;
  let preview: 'idle' | 'loading' | 'cancelled' = 'idle';

  function tryShow(): void {
    if ((!pending && preview !== 'loading') || disposed || dialog.open || doc.querySelector('dialog[open]')) return;
    dialog.returnValue = '';
    dialog.showModal(); cancel.focus();
  }
  function onOtherClose(event: Event): void { if (event.target !== dialog) tryShow(); }
  function finish(answer = false): void {
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
    if (event.key === 'Enter' && (event.isComposing || event.keyCode === 229 || event.repeat)) event.preventDefault();
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
      doc.addEventListener('close', onOtherClose, true); tryShow();
    },
    review(data: DeletionReviewData): Promise<boolean> {
      if (disposed || pending || preview === 'cancelled') return Promise.resolve(false);
      if (!data.sessions.length) { close(); return Promise.resolve(false); }
      const titles = new Map<string, number>();
      const children = new Map<string | null, DeletionTreeSession[]>();
      const files = new Set(data.sessions.map(session => session.file));
      for (const session of data.sessions) {
        titles.set(session.title, (titles.get(session.title) || 0) + 1);
        const parent = session.parent && files.has(session.parent) ? session.parent : null;
        children.set(parent, [...children.get(parent) || [], session]);
      }
      // Iterative rendering avoids recursive stack limits on deeply forked trees.
      const list = doc.createElement('ul');
      const stack = [...children.get(null) || []].reverse().map(session => ({ session, list }));
      const seen = new Set<string>();
      while (stack.length) {
        const { session, list: target } = stack.pop()!;
        if (seen.has(session.file)) continue;
        seen.add(session.file);
        const row = doc.createElement('li'), name = doc.createElement('span');
        name.textContent = session.title || 'Untitled session'; row.append(name); target.append(row);
        if ((titles.get(session.title) || 0) > 1) {
          const detail = doc.createElement('small'); detail.textContent = session.file; row.append(detail);
        }
        const descendants = children.get(session.file) || [];
        if (descendants.length) {
          const nested = doc.createElement('ul'); row.append(nested);
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
