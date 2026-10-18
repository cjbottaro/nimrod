import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { CopilotQuestionInteraction } from '../src/copilot/question-interaction';
import { installCommandPalette } from '../src/command-palette';
import { stubDialogs } from './dialog-fixture';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window, document = win.document; stubDialogs(win);
  const dialog = document.querySelector<HTMLDialogElement>('#command-palette')!;
  const child = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  const input = document.querySelector<HTMLInputElement>('#palette-input')!;
  const answer = document.querySelector<HTMLTextAreaElement>('#host-dialog-input')!;
  const draft = document.createElement('textarea'); draft.value = 'keep draft'; document.body.append(draft); draft.focus();
  const palette = installCommandPalette(win as unknown as Window, dialog, {
    canOpen: () => true, commands: () => [], sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }),
  });
  let selected = true, pending = 0, bannerCount = 0, opens = 0, closes = 0;
  const errors: string[] = [];
  const show = dialog.showModal.bind(dialog), close = dialog.close.bind(dialog);
  dialog.showModal = () => { opens++; show(); }; dialog.close = value => { closes++; close(value); };
  const interaction = new CopilotQuestionInteraction({
    document, canPresent: () => selected && !document.querySelector('dialog[open]:not(#command-palette)'),
    start: dismiss => palette.startRetainedSelection('Copilot question', dismiss),
    input: () => new Promise(resolve => {
      child.returnValue = ''; answer.value = '';
      child.addEventListener('close', () => resolve(child.returnValue === 'ok' ? answer.value : undefined), { once: true });
      child.showModal(); answer.focus();
    }),
    cancelInput: () => { if (child.open) child.close('cancel'); },
    changed: delta => { pending += delta; }, banner: count => { bannerCount = count; }, error: message => { errors.push(message); },
  });
  return { document, dialog, child, input, answer, draft, interaction, errors,
    counts: () => ({ pending, bannerCount, opens, closes }),
    click(label: string) {
      const row = [...document.querySelectorAll<HTMLElement>('#palette-list > [role=option]')]
        .find(row => row.querySelector('.palette-item-label')?.textContent === label);
      assert.ok(row, label); row.click();
    },
    query(value: string) { input.value = value; input.dispatchEvent(new win.Event('input')); },
    escape() { input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); },
    setSelected(value: boolean) { selected = value; interaction.setActive(value); },
    dispose() { interaction.dispose(); palette.dispose(); win.close(); },
  };
}

test('question choices retain exact answers, advance in one picker and Escape never answers', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const one = f.interaction.request({ question: 'Scope?', choices: ['Conversation only', 'Include interface'] }, owner.signal);
    f.query('Conversation');
    const selected = f.document.querySelector('#palette-list > [aria-selected=true]');
    const two = f.interaction.request({ question: 'Next?', choices: ['freeform'], allowFreeform: false }, owner.signal);
    assert.equal(f.input.value, 'Conversation'); assert.equal(f.document.querySelector('#palette-list > [aria-selected=true]'), selected);
    assert.equal(f.document.querySelector('#palette-remaining')!.textContent, '1 more');
    f.click('Conversation only'); assert.deepEqual(await one, { answer: 'Conversation only', wasFreeform: false });
    assert.deepEqual(f.counts(), { pending: 1, bannerCount: 1, opens: 1, closes: 0 });
    assert.equal(f.input.value, ''); assert.equal(f.document.querySelector('#palette-context')!.textContent, 'Next?');
    assert.doesNotMatch(f.document.querySelector('#palette-list')!.textContent!, /Enter your own answer/);
    f.escape(); assert.equal(f.dialog.open, false); assert.equal(f.interaction.pendingCount, 1);
    const three = f.interaction.request({ question: 'Third?' }, owner.signal);
    assert.equal(f.dialog.open, false, 'arrival cannot reopen dismissed questions');
    f.interaction.review(); f.click('freeform'); assert.deepEqual(await two, { answer: 'freeform', wasFreeform: false });
    owner.abort(); assert.equal(await three, undefined);
    assert.equal(f.draft.value, 'keep draft'); assert.equal(f.document.activeElement, f.draft);
  } finally { owner.abort(); f.dispose(); }
});

test('custom answer nests above picker; cancel and blank answers keep the question pending', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const one = f.interaction.request({ question: 'What scope?', choices: ['Default'] }, owner.signal);
    f.query('own'); f.click('Enter your own answer…');
    assert.equal(f.child.open, true); assert.equal(f.dialog.open, true); assert.equal(f.document.activeElement, f.answer);
    const context = f.document.querySelector('#palette-context')!.firstChild;
    const two = f.interaction.request({ question: 'Next?', choices: ['Done'] }, owner.signal);
    assert.equal(f.document.querySelector('#palette-context')!.firstChild, context); assert.equal(f.document.activeElement, f.answer);
    f.child.close('cancel'); await tick();
    assert.equal(f.input.value, 'own'); assert.equal(f.document.activeElement, f.input); assert.equal(f.interaction.pendingCount, 2);
    f.click('Enter your own answer…'); f.answer.value = '  '; f.child.close('ok'); await tick();
    assert.equal(f.interaction.pendingCount, 2); assert.match(f.errors[0], /non-empty/);
    f.click('Enter your own answer…'); f.answer.value = '  My exact answer\nwith detail  '; f.child.close('ok'); await tick();
    assert.deepEqual(await one, { answer: '  My exact answer\nwith detail  ', wasFreeform: true });
    assert.deepEqual(f.counts(), { pending: 1, bannerCount: 1, opens: 1, closes: 0 });
    f.click('Done'); assert.deepEqual(await two, { answer: 'Done', wasFreeform: false });
    assert.deepEqual(f.counts(), { pending: 0, bannerCount: 0, opens: 1, closes: 1 });
  } finally { owner.abort(); f.dispose(); }
});

test('background and obscured questions stay pending; navigation and abort invalidate stale child replies', async () => {
  const f = fixture(), owner = new AbortController(), newer = new AbortController();
  try {
    f.setSelected(false);
    const one = f.interaction.request({ question: 'Old?' }, owner.signal);
    assert.equal(f.dialog.open, false); assert.equal(f.document.activeElement, f.draft);
    f.child.showModal(); f.setSelected(true); assert.equal(f.dialog.open, false);
    f.child.close('cancel'); f.interaction.review(); f.click('Enter your own answer…');
    f.setSelected(false); assert.equal(f.child.open, false); assert.equal(f.dialog.open, false);
    await tick(); assert.equal(f.interaction.pendingCount, 1);
    f.setSelected(true); f.click('Enter your own answer…'); owner.abort();
    assert.equal(await one, undefined); assert.equal(f.child.open, false); assert.equal(f.dialog.open, false);
    const two = f.interaction.request({ question: 'New?', choices: ['Safe'] }, newer.signal);
    await tick(); assert.equal(f.interaction.pendingCount, 1);
    f.click('Safe'); assert.deepEqual(await two, { answer: 'Safe', wasFreeform: false });
    const three = f.interaction.request({ question: 'Dispose?' }, newer.signal);
    f.click('Enter your own answer…'); f.interaction.dispose();
    assert.equal(await three, undefined); assert.equal(f.child.open, false); assert.equal(f.counts().bannerCount, 0);
  } finally { owner.abort(); newer.abort(); f.dispose(); }
});
