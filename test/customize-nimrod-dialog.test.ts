import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { stubDialogs } from './dialog-fixture';
import { installCustomizeNimrodDialog, type CustomizationRequestOwner } from '../src/customize-nimrod-dialog';
import { parseCustomizationMessage } from '../src/customization-message';

function fixture() {
  const dom = new JSDOM('<body><textarea id="draft">Existing draft</textarea></body>', { pretendToBeVisual: true });
  stubDialogs(dom.window);
  const document = dom.window.document, controller = installCustomizeNimrodDialog(dom.window as unknown as Window);
  const dialog = document.querySelector<HTMLDialogElement>('#customize-nimrod')!, input = dialog.querySelector('textarea')!;
  const send = dialog.querySelector<HTMLButtonElement>('[value="send"]')!, cancel = dialog.querySelector<HTMLButtonElement>('[value="cancel"]')!;
  const sent: string[] = [], errors: string[] = [];
  let reason: string | undefined, invalid: string | undefined;
  const owner: CustomizationRequestOwner = { availability: () => reason, instructions: async () => 'Installed reference: /outside/checkout/guide.md', validate: () => invalid,
    submit: text => { sent.push(text); }, report: error => { errors.push(error); } };
  const type = (value: string) => { input.value = value; input.dispatchEvent(new dom.window.Event('input')); };
  const tick = () => new Promise(resolve => setTimeout(resolve, 0));
  return { dom, document, controller, dialog, input, send, cancel, sent, errors, owner, type, tick,
    unavailable(value?: string) { reason = value; controller.refresh(); }, invalid(value?: string) { invalid = value; },
    close() { controller.dispose(); dom.window.close(); } };
}
test('inspectable brief, separate draft, local validation, IME guards and one explicit submission', async () => {
  const f = fixture();
  try {
    const draft = f.document.querySelector<HTMLTextAreaElement>('#draft')!; draft.focus();
    f.controller.open(f.owner); assert.equal(f.dialog.open, true); assert.equal(f.sent.length, 0); assert.equal(f.document.activeElement, f.input);
    f.type('  Move the bar.\nKeep this exact request.  '); await f.tick();
    assert.equal(f.dialog.querySelector('details')!.open, false);
    assert.match(f.dialog.querySelector('pre')!.textContent!, /outside\/checkout/);
    f.unavailable('The originating connection changed'); assert.equal(f.send.disabled, true); assert.match(f.input.value, /Move the bar/);
    f.unavailable(); f.invalid('Local validation failed'); f.send.click(); assert.equal(f.dialog.open, true); assert.equal(f.errors.length, 1);
    f.invalid();
    for (const extra of [{ isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true }]) {
      f.input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, ...extra }));
      assert.equal(f.sent.length, 0); assert.equal(f.dialog.open, true);
    }
    f.input.dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    assert.equal(f.dialog.open, false); assert.equal(f.sent.length, 1);
    assert.deepEqual(parseCustomizationMessage(f.sent[0]), { instructions: 'Installed reference: /outside/checkout/guide.md', request: '  Move the bar.\nKeep this exact request.  ' });
    assert.equal(draft.value, 'Existing draft'); assert.equal(f.document.activeElement, draft);
  } finally { f.close(); }
});
test('cancelled guidance cannot populate a newer modal; failed guidance keeps unsent input', async () => {
  const f = fixture(); let finish!: (value: string) => void;
  try {
    f.controller.open({ ...f.owner, instructions: () => new Promise(resolve => { finish = resolve; }) });
    await Promise.resolve(); f.type('Do not send'); f.cancel.click(); assert.equal(f.sent.length, 0);
    f.controller.open(f.owner); await f.tick(); finish('Stale brief'); await f.tick();
    assert.doesNotMatch(f.dialog.querySelector('pre')!.textContent!, /Stale/); assert.equal(f.input.value, '');
    f.cancel.click();
    f.controller.open({ ...f.owner, instructions: async () => { throw new Error('Missing installed references'); } });
    f.type('Keep unsent input'); await f.tick();
    assert.equal(f.input.value, 'Keep unsent input'); assert.equal(f.send.disabled, true); assert.match(f.errors.at(-1)!, /Missing installed references/);
    assert.equal(f.sent.length, 0);
  } finally { f.close(); }
});
