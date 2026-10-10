/** Plain action labels with non-visual shortcut metadata. */
export function labelDialogAction(button: HTMLButtonElement, label: string, shortcut?: 'Enter' | 'Escape'): void {
  button.textContent = label;
  button.removeAttribute('aria-keyshortcuts');
  if (shortcut) button.setAttribute('aria-keyshortcuts', shortcut);
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
