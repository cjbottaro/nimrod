import { showModal, closeModal } from './modal-motion';
import { labelDialogAction, navigateDialogActions } from './dialog-actions';
import { resizeComposer } from './pi/composer-dom';
import { customizationMessage } from './customization-message';

export interface CustomizationRequestOwner {
  availability(): string | undefined;
  instructions(): Promise<string>;
  validate(text: string): string | undefined;
  submit(text: string): void;
  report(message: string): void;
}

/** A separate input owner: opening/editing/cancelling never mutates the Composer. */
export function installCustomizeNimrodDialog(window: Window) {
  const document = window.document, dialog = document.createElement('dialog');
  dialog.id = 'customize-nimrod'; dialog.className = 'nimrod-modal modal-stack';
  dialog.setAttribute('aria-labelledby', 'customize-nimrod-title');
  dialog.innerHTML = `<header class="modal-header"><h2 id="customize-nimrod-title" class="modal-title">Customize Nimrod</h2></header>
    <div class="modal-body customization-request-body">
      <label for="customize-nimrod-input">How would you like to customize Nimrod?</label>
      <textarea id="customize-nimrod-input" rows="1" placeholder="Describe the changes you want…" aria-describedby="customize-nimrod-description customize-nimrod-status"></textarea>
      <p id="customize-nimrod-description" class="modal-description">Send one ordinary message to this session, including the instructions below. Your existing Composer draft is kept.</p>
      <details id="customize-nimrod-instructions"><summary>Instructions included with your request</summary><pre></pre></details>
      <p id="customize-nimrod-status" class="modal-description" role="status"></p>
    </div>
    <footer class="modal-actions"><button type="button" value="cancel" class="secondary">Cancel</button><button type="button" value="send">Send request</button></footer>`;
  document.body.append(dialog);
  const input = dialog.querySelector<HTMLTextAreaElement>('textarea')!, instructions = dialog.querySelector('pre')!;
  const status = dialog.querySelector<HTMLElement>('#customize-nimrod-status')!;
  const send = dialog.querySelector<HTMLButtonElement>('[value="send"]')!, cancel = dialog.querySelector<HTMLButtonElement>('[value="cancel"]')!;
  labelDialogAction(cancel, 'Cancel'); labelDialogAction(send, 'Send request');
  let owner: CustomizationRequestOwner | undefined, brief: string | undefined, loading = false, disposed = false, generation = 0;
  const refresh = () => {
    if (!dialog.open || !owner) return;
    const reason = owner.availability();
    const message = reason ?? (loading ? 'Loading customization instructions…' : !brief ? 'Customization instructions are unavailable. Cancel and try again.' : '');
    if (status.textContent !== message) status.textContent = message;
    const disabled = !!reason || !brief || !input.value.trim();
    if (send.disabled !== disabled) send.disabled = disabled;
  };
  const dismiss = () => { generation++; owner = undefined; brief = undefined; loading = false; input.value = ''; instructions.textContent = ''; };
  const submit = () => {
    if (!owner || !brief || !dialog.open || !input.value.trim()) return;
    const current = owner;
    const text = customizationMessage(brief, input.value);
    const error = current.availability() ?? current.validate(text);
    if (error) { current.report(error); refresh(); return; }
    // Synchronous dispatch revalidates the owning view before input is discarded.
    // Never await an RPC, or restore/replay text after dispatch uncertainty.
    try { current.submit(text); } catch (error) { current.report(String(error)); refresh(); return; }
    dismiss(); closeModal(dialog, 'send');
  };
  const onInput = () => { resizeComposer(input); refresh(); };
  input.addEventListener('input', onInput);
  const onKey = (event: KeyboardEvent) => {
    if (event.target === input && event.key === 'Enter' && !event.shiftKey) {
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault(); event.stopPropagation();
      if (!event.repeat && !send.disabled) submit();
    } else navigateDialogActions(event, cancel, send);
  };
  dialog.addEventListener('keydown', onKey);
  send.addEventListener('click', () => { if (!send.disabled) submit(); });
  cancel.addEventListener('click', () => { dismiss(); closeModal(dialog, 'cancel'); });
  dialog.addEventListener('cancel', dismiss);
  dialog.addEventListener('close', () => { if (!dialog.open) dismiss(); });
  const resized = () => { if (dialog.open) resizeComposer(input); };
  window.addEventListener('resize', resized);
  return {
    refresh,
    open(next: CustomizationRequestOwner): void {
      if (disposed || document.querySelector('dialog[open], #dialog.open')) return;
      const reason = next.availability(); if (reason) { next.report(reason); return; }
      owner = next; brief = undefined; loading = true; const version = ++generation;
      input.value = ''; instructions.textContent = '';
      dialog.querySelector('details')!.open = false;
      showModal(dialog); input.focus(); resizeComposer(input); refresh();
      void Promise.resolve().then(() => next.instructions()).then(value => {
        if (disposed || generation !== version || owner !== next || !dialog.open) return;
        brief = value; instructions.textContent = value; loading = false; refresh();
      }).catch(error => {
        if (disposed || generation !== version || owner !== next || !dialog.open) return;
        loading = false; next.report(String(error)); refresh();
      });
    },
    dispose() {
      disposed = true; dismiss();
      if (dialog.open) closeModal(dialog, 'cancel');
      window.removeEventListener('resize', resized); dialog.remove();
    },
  };
}
