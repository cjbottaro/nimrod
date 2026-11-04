import { showModal, closeModal } from './modal-motion';
import { resizeComposer } from './pi/composer-dom';
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

  private show(title: string, options?: string[], prefill?: string, message?: string, owner?: string, action = 'Confirm', selectPrefill = false): Promise<string | undefined> {
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
      const view = this.dialog.ownerDocument.defaultView!;
      let resizeFrame: number | undefined;
      const scheduleResize = () => {
        if (this.inputNode.hidden || view.CSS?.supports('field-sizing', 'content') || resizeFrame !== undefined) return;
        resizeFrame = view.requestAnimationFrame(() => {
          resizeFrame = undefined;
          if (this.dialog.open) resizeComposer(this.inputNode);
        });
      };
      const onKey = (event: KeyboardEvent) => {
        // Editing/selection controls keep arrows; footer buttons share navigation.
        if (!this.dialog.open) return;
        if (message !== undefined) confirmationKey(event, this.dialog, cancel, confirm);
        else if (event.target === this.inputNode && event.key === 'Enter' && !event.shiftKey) {
          // Match composer delivery without sending partial IME text or repeats.
          if (event.isComposing || event.keyCode === 229) return;
          event.preventDefault(); event.stopPropagation();
          if (!event.repeat && !confirm.disabled) closeModal(this.dialog, confirm.value);
        } else navigateDialogActions(event, cancel, confirm);
      };
      this.dialog.addEventListener('keydown', onKey);
      this.inputNode.addEventListener('input', scheduleResize);
      view.addEventListener('resize', scheduleResize);
      this.dialog.addEventListener('close', () => {
        this.dialog.removeEventListener('keydown', onKey);
        this.inputNode.removeEventListener('input', scheduleResize);
        view.removeEventListener('resize', scheduleResize);
        if (resizeFrame !== undefined) view.cancelAnimationFrame(resizeFrame);
        resolve(this.dialog.returnValue !== 'ok' ? undefined : options ? this.select.value : message !== undefined ? 'confirmed' : this.inputNode.value);
      }, { once: true });
      this.inputNode.style.height = '';
      this.inputNode.style.overflowY = '';
      showModal(this.dialog);
      if (!this.inputNode.hidden) resizeComposer(this.inputNode);
      if (options) this.select.focus();
      else if (message === undefined) {
        this.inputNode.focus();
        if (selectPrefill) this.inputNode.select();
      } else confirm.focus();
    }));
    this.queue = result.then(() => {}, () => {});
    return result;
  }
  choose(title: string, options: string[], owner?: string): Promise<string | undefined> { return this.show(title, options, undefined, undefined, owner); }
  input(title: string, prefill?: string, owner?: string, action = 'Confirm', selectPrefill = false): Promise<string | undefined> { return this.show(title, undefined, prefill, undefined, owner, action, selectPrefill); }
  async confirm(title: string, message: string, owner?: string, action = 'Confirm'): Promise<boolean> { return (await this.show(title, undefined, undefined, message, owner, action)) !== undefined; }
}
