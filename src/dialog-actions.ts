import { closeModal } from './modal-motion';

/** Plain action labels with non-visual shortcut metadata. */
export function labelDialogAction(button: HTMLButtonElement, label: string, shortcut?: 'Enter' | 'Escape'): void {
  button.textContent = label;
  button.removeAttribute('aria-keyshortcuts');
  if (shortcut) button.setAttribute('aria-keyshortcuts', shortcut);
}

/** Arrow keys cycle enabled footer actions, never editing/selection controls. */
export function navigateDialogActions(event: KeyboardEvent, cancel: HTMLButtonElement, confirm: HTMLButtonElement): boolean {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key) ||
    event.altKey || event.ctrlKey || event.metaKey || event.shiftKey ||
    ![cancel, confirm].some(button => button.contains(event.target as Node))) return false;
  event.preventDefault(); event.stopPropagation();
  if (event.isComposing || event.keyCode === 229) return true;
  const buttons = [cancel, confirm]
    .filter(button => !button.disabled && !button.closest('[hidden], [inert]'))
    .sort((a, b) => a.compareDocumentPosition(b) & 2 ? 1 : -1);
  if (!buttons.length) return true;
  const index = buttons.findIndex(button => button.contains(event.target as Node));
  const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  buttons[(index + step + buttons.length) % buttons.length].focus({ preventScroll: true });
  return true;
}

/** Respect Cancel focus instead of making Enter silently activate another button. */
export function confirmationKey(event: KeyboardEvent, dialog: HTMLDialogElement, cancel: HTMLButtonElement, confirm: HTMLButtonElement, activate?: (button: HTMLButtonElement) => void): void {
  if (!dialog.open || navigateDialogActions(event, cancel, confirm) || !['Enter', 'Escape'].includes(event.key)) return;
  event.preventDefault(); event.stopPropagation();
  if (event.isComposing || event.keyCode === 229 || event.key === 'Enter' && event.repeat) return;
  const button = event.key === 'Escape' || cancel.contains(event.target as Node) ? cancel : confirm;
  if (button.disabled) return;
  if (activate) activate(button);
  else if (button.form?.method === 'dialog') closeModal(dialog, button.value);
  else button.click();
}
