import { showModal, closeModal } from './modal-motion';
import { confirmationKey, labelDialogAction, navigateDialogActions } from './dialog-actions';

export class Dialogs {
  private queue = Promise.resolve();
  private generation = 0;
  private owners = new Map<string, number>();
  private activeOwner?: string;
  private dialog = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  private select = document.querySelector<HTMLSelectElement>('#host-dialog-select')!;
  private inputNode = document.querySelector<HTMLTextAreaElement>('#host-dialog-input')!;

  cancel(owner?: string): void {
    if (owner) this.owners.set(owner, (this.owners.get(owner) || 0) + 1);
    else this.generation++;
    if (this.dialog.open && (!owner || this.activeOwner === owner)) closeModal(this.dialog, 'cancel');
  }

  private show(title: string, options?: string[], prefill?: string, message?: string, owner?: string, action = 'Confirm'): Promise<string | undefined> {
    const generation = this.generation;
    const ownerGeneration = owner ? this.owners.get(owner) : undefined;
    const result = this.queue.then(() => new Promise<string | undefined>(resolve => {
      if (generation !== this.generation || (owner && ownerGeneration !== this.owners.get(owner))) { resolve(undefined); return; }
      this.activeOwner = owner;
      document.querySelector('#host-dialog-title')!.textContent = title;
      document.querySelector('#host-dialog-description')!.textContent = message || '';
      this.select.hidden = !options;
      this.inputNode.hidden = options !== undefined || message !== undefined;
      this.select.replaceChildren(...(options || []).map(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; return option; }));
      if (this.select.options.length) this.select.selectedIndex = 0;
      this.inputNode.value = prefill || '';
      this.dialog.returnValue = '';
      const cancel = this.dialog.querySelector<HTMLButtonElement>('button[value="cancel"]')!;
      const confirm = this.dialog.querySelector<HTMLButtonElement>('button[value="ok"]')!;
      labelDialogAction(cancel, 'Cancel', message !== undefined ? 'Escape' : undefined);
      labelDialogAction(confirm, action, message !== undefined ? 'Enter' : undefined);
      const onKey = (event: KeyboardEvent) => {
        // Editing/selection controls keep arrows; footer buttons share navigation.
        if (!this.dialog.open) return;
        if (message !== undefined) confirmationKey(event, this.dialog, cancel, confirm);
        else navigateDialogActions(event, cancel, confirm);
      };
      this.dialog.addEventListener('keydown', onKey);
      this.dialog.addEventListener('close', () => {
        this.dialog.removeEventListener('keydown', onKey);
        resolve(this.dialog.returnValue !== 'ok' ? undefined : options ? this.select.value : message !== undefined ? 'confirmed' : this.inputNode.value);
      }, { once: true });
      showModal(this.dialog);
      if (options) this.select.focus(); else if (message === undefined) this.inputNode.focus(); else confirm.focus();
    }));
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  choose(title: string, options: string[], owner?: string): Promise<string | undefined> { return this.show(title, options, undefined, undefined, owner); }
  input(title: string, prefill?: string, owner?: string, action = 'Confirm'): Promise<string | undefined> { return this.show(title, undefined, prefill, undefined, owner, action); }
  async confirm(title: string, message: string, owner?: string, action = 'Confirm'): Promise<boolean> { return (await this.show(title, undefined, undefined, message, owner, action)) !== undefined; }
}
