import { showModal, closeModal } from './modal-motion';
import { confirmationKey, labelDialogAction } from './dialog-actions';

export interface DeletionTreeSession { file: string; title: string; parent?: string | null; cwd?: string; }
export interface DeletionReviewData { id: string; sessions: DeletionTreeSession[]; title?: string; description?: string; }

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
export function installDeletionReview(dialog: HTMLDialogElement, options: { canCover?: (other: HTMLDialogElement) => boolean } = {}) {
  const doc = dialog.ownerDocument;
  const win = doc.defaultView!;
  const tree = dialog.querySelector<HTMLElement>('#deletion-tree')!;
  const cancel = dialog.querySelector<HTMLButtonElement>('#deletion-cancel')!;
  const confirm = dialog.querySelector<HTMLButtonElement>('#deletion-confirm')!;
  const form = confirm.form!;
  const description = dialog.querySelector<HTMLElement>('#deletion-description')!;
  const reviewDescription = description.textContent || '';
  const title = dialog.querySelector<HTMLElement>('#deletion-title');
  const reviewTitle = title?.textContent || 'Delete session tree';
  labelDialogAction(cancel, 'Cancel', 'Escape');
  labelDialogAction(confirm, 'Delete sessions', 'Enter');
  let pending: { resolve(answer: boolean): void } | undefined;
  let disposed = false;
  let preview: 'idle' | 'loading' | 'cancelled' = 'idle';
  let loadingTimer: number | undefined;
  let executing = false;
  let progressText: HTMLSpanElement | undefined;
  let bodyProgressText: HTMLSpanElement | undefined;

  function clearLoadingTimer(): void {
    if (loadingTimer !== undefined) win.clearTimeout(loadingTimer);
    loadingTimer = undefined;
  }
  function tryShow(): void {
    if (loadingTimer !== undefined || (!pending && preview !== 'loading') || disposed || dialog.open ||
      [...doc.querySelectorAll<HTMLDialogElement>('dialog[open]')].some(other => !options.canCover?.(other))) return;
    dialog.returnValue = '';
    showModal(dialog); (confirm.disabled ? cancel : confirm).focus();
  }
  function onOtherClose(event: Event): void { if (event.target !== dialog) tryShow(); }
  function finish(answer = false): void {
    clearLoadingTimer();
    const request = pending; pending = undefined;
    doc.removeEventListener('close', onOtherClose, true);
    request?.resolve(answer);
  }
  function close(): void {
    executing = false;
    cancel.disabled = false; labelDialogAction(cancel, 'Cancel', 'Escape');
    preview = 'idle';
    if (dialog.open) closeModal(dialog, 'cancel'); else finish();
  }
  function progress(phase: 'stopping' | 'deleting'): void {
    if (!executing || disposed) return;
    const text = phase === 'stopping' ? 'Stopping sessions…' : 'Deleting sessions…';
    if (progressText) progressText.textContent = text;
    if (bodyProgressText) bodyProgressText.textContent = text;
  }
  function activate(button: HTMLButtonElement): void {
    if (executing || button.disabled) return;
    if (button === cancel) { closeModal(dialog, 'cancel'); return; }
    if (!pending) return;
    executing = true;
    labelDialogAction(confirm, confirm.textContent || 'Delete sessions');
    cancel.disabled = true; confirm.disabled = true;
    labelDialogAction(cancel, 'Cancel');
    tree.setAttribute('aria-busy', 'true');
    tree.dataset.executing = 'true';
    // Reserve the reviewed tree's responsive footprint without presenting it
    // as the current body. This feedback happens before resolving confirmation.
    const reviewedTree = tree.firstElementChild!;
    reviewedTree.classList.add('deletion-tree-reserved');
    reviewedTree.setAttribute('aria-hidden', 'true');
    const status = doc.createElement('div'); status.className = 'deletion-execution';
    // The description's live status announces the same phase once.
    status.setAttribute('aria-hidden', 'true');
    const spinner = doc.createElement('span'); spinner.className = 'deletion-spinner';
    bodyProgressText = doc.createElement('span');
    status.append(spinner, bodyProgressText); tree.append(status); tree.scrollTop = 0;
    // Keep the reviewed copy in layout so progress cannot shrink the modal.
    // Both spans share a grid cell, preserving responsive wrapping without
    // freezing viewport-dependent shell dimensions in pixels.
    const reservedDescription = doc.createElement('span');
    reservedDescription.className = 'deletion-description-reserved';
    reservedDescription.setAttribute('aria-hidden', 'true');
    reservedDescription.textContent = description.textContent;
    progressText = doc.createElement('span'); progressText.className = 'deletion-progress';
    description.replaceChildren(reservedDescription, progressText);
    description.setAttribute('role', 'status');
    // Resolve the answer without closing the dialog or restoring underlying focus.
    progress('stopping');
    tree.focus({ preventScroll: true });
    finish(true);
  }
  const onClose = () => {
    if (preview === 'loading') preview = 'cancelled';
    finish(false);
  };
  const onKey = (event: KeyboardEvent) => {
    confirmationKey(event, dialog, cancel, confirm, activate);
  };
  const onCancel = (event: Event) => { event.preventDefault(); if (!executing) activate(cancel); };
  const onClick = (event: Event) => { event.preventDefault(); activate(event.currentTarget as HTMLButtonElement); };
  const onSubmit = (event: SubmitEvent) => { event.preventDefault(); activate(event.submitter === cancel ? cancel : confirm); };
  dialog.addEventListener('close', onClose);
  dialog.addEventListener('cancel', onCancel);
  dialog.addEventListener('keydown', onKey);
  cancel.addEventListener('click', onClick); confirm.addEventListener('click', onClick);
  form.addEventListener('submit', onSubmit);
  return {
    loading(): void {
      if (disposed || pending || executing || preview === 'loading') return;
      preview = 'loading';
      if (title) title.textContent = reviewTitle;
      progressText = undefined; bodyProgressText = undefined;
      delete tree.dataset.executing;
      cancel.disabled = false; description.textContent = reviewDescription; description.removeAttribute('role');
      confirm.disabled = true; labelDialogAction(confirm, 'Delete sessions');
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
      if (disposed || pending || executing || preview === 'cancelled') return Promise.resolve(false);
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
      preview = 'idle'; cancel.disabled = false; confirm.disabled = false;
      bodyProgressText = undefined; delete tree.dataset.executing;
      if (title) title.textContent = data.title || reviewTitle;
      progressText = undefined;
      description.textContent = data.description || reviewDescription; description.removeAttribute('role');
      tree.setAttribute('aria-busy', 'false');
      tree.replaceChildren(list); tree.scrollTop = 0;
      labelDialogAction(confirm, `Delete ${data.sessions.length} ${data.sessions.length === 1 ? 'session' : 'sessions'}`, 'Enter');
      // A visible loading dialog keeps its user's focus when review arrives.
      // Fresh populated reviews focus Delete in tryShow().
      return new Promise(resolve => {
        pending = { resolve }; doc.addEventListener('close', onOtherClose, true); tryShow();
      });
    },
    progress,
    cancel: close,
    dispose() {
      disposed = true; close(); dialog.removeEventListener('close', onClose); dialog.removeEventListener('cancel', onCancel); dialog.removeEventListener('keydown', onKey);
      cancel.removeEventListener('click', onClick); confirm.removeEventListener('click', onClick); form.removeEventListener('submit', onSubmit);
    },
  };
}
