/** Confirmation action labels and hints; shortcut glyphs are not part of accessible names. */
export function labelDialogAction(button: HTMLButtonElement, label: string, shortcut?: 'Enter' | 'Escape'): void {
  const doc = button.ownerDocument;
  button.replaceChildren(doc.createTextNode(label));
  button.classList.add('modal-action');
  button.removeAttribute('aria-keyshortcuts');
  if (!shortcut) return;
  button.setAttribute('aria-keyshortcuts', shortcut);
  if (shortcut === 'Escape') {
    const hint = doc.createElement('kbd'); hint.className = 'modal-action-hint'; hint.setAttribute('aria-hidden', 'true'); hint.textContent = 'Esc';
    button.append(hint);
  } else {
    const icon = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
    icon.classList.add('modal-action-hint'); icon.setAttribute('viewBox', '0 0 24 24');
    icon.setAttribute('fill', 'none'); icon.setAttribute('stroke', 'currentColor'); icon.setAttribute('stroke-width', '1.7');
    icon.setAttribute('stroke-linecap', 'round'); icon.setAttribute('stroke-linejoin', 'round');
    icon.setAttribute('aria-hidden', 'true'); icon.setAttribute('focusable', 'false');
    const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', 'M20 4v8a4 4 0 0 1-4 4H4m5-5-5 5 5 5');
    icon.append(path); button.append(icon);
  }
}

/** Respect Cancel focus instead of making Enter silently activate another button. */
export function confirmationKey(event: KeyboardEvent, dialog: HTMLDialogElement, cancel: HTMLButtonElement, confirm: HTMLButtonElement): void {
  if (!dialog.open || !['Enter', 'Escape'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (event.isComposing || event.keyCode === 229 || event.key === 'Enter' && event.repeat) return;
  const button = event.key === 'Escape' || cancel.contains(event.target as Node) ? cancel : confirm;
  if (button.disabled) return;
  if (button.form?.method === 'dialog') dialog.close(button.value);
  else button.click();
}
