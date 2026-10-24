import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { CopilotPlanInteraction } from '../src/copilot/plan-interaction';
import { installCommandPalette } from '../src/command-palette';
import { stubDialogs } from './dialog-fixture';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const request = { summary: 'Review the workflow', planContent: '# Workflow\n\nKeep **drafts**.\n\n<script>unsafe()</script>',
  actions: ['interactive', 'autopilot', 'exit_only'], recommendedAction: 'interactive' };
function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window, document = win.document; stubDialogs(win);
  const dialog = document.querySelector<HTMLDialogElement>('#command-palette')!;
  const child = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  const input = document.querySelector<HTMLInputElement>('#palette-input')!;
  const feedback = document.querySelector<HTMLTextAreaElement>('#host-dialog-input')!;
  const draft = document.createElement('textarea'); draft.value = 'keep draft'; document.body.append(draft); draft.focus();
  const palette = installCommandPalette(win as unknown as Window, dialog, {
    canOpen: () => true, commands: () => [], sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }),
  });
  let selected = true, pending = 0, bannerCount = 0, opens = 0, closes = 0;
  const errors: string[] = [], links: string[] = [];
  let review: (() => void) | undefined;
  const show = dialog.showModal.bind(dialog), close = dialog.close.bind(dialog);
  dialog.showModal = () => { opens++; show(); }; dialog.close = value => { closes++; close(value); };
  const interaction = new CopilotPlanInteraction({
    document, canPresent: () => selected && !document.querySelector('dialog[open]:not(#command-palette)'),
    start: dismiss => palette.startRetainedSelection('Review Copilot plan', dismiss),
    feedback: (_revision, current) => new Promise(resolve => {
      child.returnValue = ''; feedback.value = current;
      child.addEventListener('close', () => resolve(child.returnValue === 'ok' ? feedback.value : undefined), { once: true });
      child.showModal(); feedback.focus();
    }),
    cancelFeedback: () => { if (child.open) child.close('cancel'); },
    openLink: async href => { links.push(href); },
    changed: delta => { pending += delta; }, banner: (count, reopen) => { bannerCount = count; review = count ? reopen : undefined; },
    error: message => { errors.push(message); },
  });
  return { document, dialog, child, input, feedback, draft, interaction, errors, links,
    counts: () => ({ pending, bannerCount, opens, closes }),
    click(label: string) {
      const row = [...document.querySelectorAll<HTMLElement>('#palette-list > [role=option]')]
        .find(row => row.querySelector('.palette-item-label')?.textContent === label);
      assert.ok(row, label); row.click();
    },
    query(value: string) { input.value = value; input.dispatchEvent(new win.Event('input')); },
    escape() { input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); },
    nativeCancel() { dialog.dispatchEvent(new win.Event('cancel', { cancelable: true })); },
    review() { assert.ok(review); review(); },
    setSelected(value: boolean) { selected = value; interaction.setActive(value); },
    dispose() { interaction.dispose(); palette.dispose(); win.close(); },
  };
}

test('plan review renders safe Markdown, marks recommendation and dismissal never settles the SDK callback', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    let settled = false;
    const result = f.interaction.request(request, owner.signal).then(value => { settled = true; return value; });
    assert.equal(f.document.querySelector('#palette-context h1')?.textContent, 'Workflow');
    assert.equal(f.document.querySelector('#palette-context strong')?.textContent, 'drafts');
    assert.equal(f.document.querySelector('#palette-context script'), null);
    assert.match(f.document.querySelector('#palette-list > [role=option]')!.textContent!, /Recommended/);
    f.escape(); await tick();
    assert.equal(settled, false); assert.equal(f.dialog.open, false); assert.equal(f.counts().bannerCount, 1);
    f.setSelected(false); f.setSelected(true); assert.equal(f.dialog.open, false);
    f.review(); f.nativeCancel(); await tick(); assert.equal(settled, false);
    f.review(); f.click('Continue with Autopilot');
    assert.deepEqual(await result, { approved: true, selectedAction: 'autopilot' });
    assert.equal(f.counts().pending, 0); assert.equal(f.counts().bannerCount, 0); assert.equal(f.draft.value, 'keep draft');
  } finally { owner.abort(); f.dispose(); }
});

test('queued arrivals retain filter, preview and feedback; native action names cannot collide with host choices', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const one = f.interaction.request(request, owner.signal);
    f.click('Add feedback…'); f.feedback.value = ' Preserve the API. ';
    const preview = f.document.querySelector('#palette-context > div');
    const two = f.interaction.request({ ...request, actions: ['revise'], recommendedAction: 'not-advertised' }, owner.signal);
    assert.equal(f.child.open, true); assert.equal(f.feedback.value, ' Preserve the API. ');
    assert.equal(f.document.querySelector('#palette-context > div'), preview);
    f.child.close('ok'); await tick();
    f.query('Autopilot');
    const selected = f.document.querySelector('#palette-list > [aria-selected=true]');
    const three = f.interaction.request(request, owner.signal);
    assert.equal(f.document.querySelector('#palette-list > [aria-selected=true]'), selected);
    assert.equal(f.input.value, 'Autopilot');
    f.click('Continue with Autopilot');
    assert.deepEqual(await one, { approved: true, selectedAction: 'autopilot', feedback: 'Preserve the API.' });
    assert.equal(f.counts().opens, 1); assert.equal(f.counts().closes, 0);
    f.click('revise'); assert.deepEqual(await two, { approved: true, selectedAction: 'revise' });
    f.click('Decline plan'); assert.deepEqual(await three, { approved: false });
  } finally { owner.abort(); f.dispose(); }
});

test('nested feedback cancellation returns to the plan; revisions require text and never approve', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const result = f.interaction.request(request, owner.signal);
    f.click('Request changes…'); f.feedback.value = 'discarded'; f.child.close('cancel'); await tick();
    assert.equal(f.dialog.open, true); assert.equal(f.interaction.pendingCount, 1);
    f.click('Request changes…'); f.feedback.value = ' '; f.child.close('ok'); await tick();
    assert.equal(f.errors.length, 1); assert.equal(f.interaction.pendingCount, 1);
    f.click('Request changes…'); f.feedback.value = ' Keep the old API. '; f.child.close('ok');
    assert.deepEqual(await result, { approved: false, feedback: 'Keep the old API.' });
    assert.equal(f.draft.value, 'keep draft');
  } finally { owner.abort(); f.dispose(); }
});

test('background and other modals retain priority; Stop/disposal retire callbacks and reject stale feedback', async () => {
  const f = fixture(), owner = new AbortController(), newer = new AbortController();
  try {
    f.setSelected(false);
    const one = f.interaction.request(request, owner.signal);
    assert.equal(f.dialog.open, false); assert.equal(f.counts().bannerCount, 1);
    f.child.showModal(); f.setSelected(true); assert.equal(f.dialog.open, false);
    f.child.close(); await tick(); f.review(); f.click('Add feedback…');
    f.feedback.value = 'stale'; owner.abort(); assert.equal(await one, undefined);
    assert.equal(f.child.open, false); assert.equal(f.counts().bannerCount, 0);
    const two = f.interaction.request(request, newer.signal); await tick();
    f.click('Finish planning'); assert.deepEqual(await two, { approved: true, selectedAction: 'exit_only' });
    const three = f.interaction.request(request, newer.signal);
    f.click('Request changes…'); f.interaction.dispose();
    assert.equal(await three, undefined); assert.equal(f.child.open, false); assert.equal(f.counts().pending, 0);
  } finally { owner.abort(); newer.abort(); f.dispose(); }
});

test('invalid choices fail without presenting or retaining a request; plan links use the host', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    for (const actions of [undefined, [], [''], [1]]) await assert.rejects(f.interaction.request({ actions }, owner.signal), /valid plan/);
    assert.equal(f.interaction.pendingCount, 0); assert.equal(f.dialog.open, false);
    const result = f.interaction.request({ ...request, planContent: '[Review](https://example.com) [Unsafe](javascript:alert(1))' }, owner.signal);
    const links = f.document.querySelectorAll<HTMLAnchorElement>('#palette-context a');
    links[0].click(); assert.deepEqual(f.links, ['https://example.com']); assert.equal(links[1].hasAttribute('href'), false);
    owner.abort(); await result;
  } finally { owner.abort(); f.dispose(); }
});
