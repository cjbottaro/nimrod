import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'node:fs';
import { CodexQuestionInteraction } from '../src/codex/question-interaction';
import { codexQuestionRequest, codexQuestionAnswers, CODEX_ANSWER_LIMIT, type CodexQuestionRequest } from '../src/codex/questions';
import { installCommandPalette } from '../src/command-palette';
import { stubDialogs } from './dialog-fixture';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const question = (id: string, options: string[] | null = ['A', 'B'], isOther = false) => ({ id, header: `Topic ${id}`, question: `Choose ${id}?`, isOther, isSecret: false,
  options: options?.map(label => ({ label, description: `${label} detail` })) ?? null });
const request = (questions = [question('scope')]): CodexQuestionRequest => codexQuestionRequest({ threadId: 'thread', turnId: 'turn', itemId: 'tool', questions, isBlocking: true, autoResolutionMs: null });
function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window, document = win.document; stubDialogs(win);
  const dialog = document.querySelector<HTMLDialogElement>('#command-palette')!, child = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  const input = document.querySelector<HTMLInputElement>('#palette-input')!, answer = document.querySelector<HTMLTextAreaElement>('#host-dialog-input')!;
  const draft = document.createElement('textarea'); draft.value = 'newer draft'; document.body.append(draft); draft.focus();
  const palette = installCommandPalette(win as unknown as Window, dialog, { canOpen: () => true, commands: () => [], sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }) });
  let selected = true, count = 0, inputs = 0, review: (() => void) | undefined;
  const errors: string[] = [];
  const interaction = new CodexQuestionInteraction({
    document, canPresent: () => selected && !document.querySelector('dialog[open]:not(#command-palette)'),
    start: dismiss => palette.startRetainedSelection('Codex question', dismiss),
    input: () => new Promise(resolve => { child.returnValue = ''; answer.value = ''; child.addEventListener('close', () => resolve(child.returnValue === 'ok' ? answer.value : undefined), { once: true }); child.showModal(); answer.focus(); }),
    cancelInput: () => { if (child.open) child.close('cancel'); }, changed: delta => { inputs += delta; },
    banner: (pending, reopen) => { count = pending; review = reopen; }, error: message => errors.push(message),
  });
  return { interaction, dialog, child, input, answer, draft, document, errors, count: () => count, inputs: () => inputs,
    selected(value: boolean) { selected = value; interaction.setActive(value); },
    click(label: string) { const row = [...document.querySelectorAll<HTMLElement>('#palette-list > [role=option]')].find(row => row.querySelector('.palette-item-label')?.textContent === label); assert.ok(row, label); row.click(); },
    dismiss() { dialog.dispatchEvent(new win.Event('cancel', { cancelable: true })); }, review() { review?.(); },
    dispose() { interaction.dispose(); palette.dispose(); win.close(); },
  };
}

test('Codex question batches keep exact native IDs/labels and send no partial answer on dismissal', async () => {
  const f = fixture(), owner = new AbortController(); let settled = false;
  try {
    const pending = f.interaction.request(request([question('first'), question('second', ['C'])]), owner.signal).then(value => { settled = true; return value; });
    assert.equal(f.count(), 2); assert.match(f.document.querySelector('#palette-context')!.textContent!, /Topic first/);
    assert.match(f.document.querySelector('#palette-list')!.textContent!, /A detail/);
    f.click('A'); await tick(); assert.equal(settled, false); assert.equal(f.count(), 1);
    f.dismiss(); await tick(); assert.equal(settled, false); assert.equal(f.dialog.open, false);
    f.selected(false); f.selected(true); assert.equal(f.dialog.open, false);
    f.review(); f.click('C'); assert.deepEqual(await pending, { first: { answers: ['A'] }, second: { answers: ['C'] } });
    assert.equal(f.count(), 0); assert.equal(f.inputs(), 0); assert.equal(f.draft.value, 'newer draft');
  } finally { owner.abort(); f.dispose(); }
});

test('Codex options constrain custom answers; free text uses the shared nested input and keeps exact text', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const pending = f.interaction.request(request([question('text', null)]), owner.signal);
    f.click('Enter your own answer…'); assert.equal(f.child.open, true); assert.equal(f.dialog.open, true);
    f.child.close('cancel'); await tick(); assert.equal(f.count(), 1);
    f.click('Enter your own answer…'); f.answer.value = ' '; f.child.close('ok'); await tick(); assert.match(f.errors.at(-1)!, /non-empty/);
    f.click('Enter your own answer…'); f.answer.value = 'x'.repeat(CODEX_ANSWER_LIMIT + 1); f.child.close('ok'); await tick(); assert.match(f.errors.at(-1)!, /at most/);
    f.click('Enter your own answer…'); f.answer.value = '  Exact answer\nwith detail  '; f.child.close('ok');
    assert.deepEqual(await pending, { text: { answers: ['  Exact answer\nwith detail  '] } });
    const next = f.interaction.request(request([question('choice', ['Only'], false)]), owner.signal);
    assert.doesNotMatch(f.document.querySelector('#palette-list')!.textContent!, /Enter your own answer/);
    f.click('Only'); await next;
    const other = f.interaction.request(request([question('other', ['A'], true)]), owner.signal);
    f.click('Enter your own answer…'); f.answer.value = 'Alternative'; f.child.close('ok');
    assert.deepEqual(await other, { other: { answers: ['Alternative'] } });
  } finally { owner.abort(); f.dispose(); }
});

test('Codex background and server-aborted batches do not steal focus or transmit partially answered input', async () => {
  const f = fixture(), owner = new AbortController(), newer = new AbortController();
  try {
    f.selected(false); const pending = f.interaction.request(request([question('one'), question('two', null)]), owner.signal);
    assert.equal(f.dialog.open, false); assert.equal(f.document.activeElement, f.draft);
    f.selected(true); f.click('A'); f.click('Enter your own answer…'); owner.abort();
    assert.equal(await pending, undefined); assert.equal(f.child.open, false); assert.equal(f.dialog.open, false);
    const next = f.interaction.request(request([question('new', ['Safe'])]), newer.signal);
    await tick(); f.click('Safe'); assert.deepEqual(await next, { new: { answers: ['Safe'] } });
    assert.equal(f.inputs(), 0); assert.equal(f.draft.value, 'newer draft');
  } finally { owner.abort(); newer.abort(); f.dispose(); }
});

test('Codex async picker retains Escape dismissal, opts into Ignore, and preserves drafts', async () => {
  const f = fixture(), owner = new AbortController(); let settled = false;
  try {
    const pending = f.interaction.requestAsync({ id: 'async', question: 'Which?', options: ['A'] }, owner.signal)
      .then(value => { settled = true; return value; });
    f.dismiss(); await tick(); assert.equal(settled, false); assert.equal(f.count(), 1);
    f.selected(false); f.selected(true); assert.equal(f.dialog.open, false);
    f.review(); f.click('Ignore question'); assert.equal(await pending, undefined);
    assert.equal(f.count(), 0); assert.equal(f.inputs(), 0); assert.equal(f.draft.value, 'newer draft');
    const next = f.interaction.request(request(), owner.signal);
    assert.doesNotMatch(f.document.querySelector('#palette-list')!.textContent!, /Ignore question/);
    f.click('A'); await next;
  } finally { owner.abort(); f.dispose(); }
});

test('Codex async custom answers cancel only the child and keep exact free text', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const pending = f.interaction.requestAsync({ id: 'async', question: 'Which?', options: [] }, owner.signal);
    f.click('Enter your own answer…'); f.child.close('cancel'); await tick();
    assert.equal(f.count(), 1); assert.equal(f.dialog.open, true);
    f.click('Enter your own answer…'); f.answer.value = '  Exact answer  '; f.child.close('ok');
    assert.deepEqual(await pending, { answer: '  Exact answer  ', wasFreeform: true });
  } finally { owner.abort(); f.dispose(); }
});

test('Codex question parsing rejects secret, malformed, duplicate and unknown semantic fields explicitly', () => {
  const valid = request(); assert.deepEqual(codexQuestionAnswers(valid, { scope: { answers: ['A'] } }), { scope: { answers: ['A'] } });
  for (const questions of [[], [question('duplicate'), question('duplicate')], [{ ...question('secret'), isSecret: true }], [{ ...question('future'), multiSelect: true }], [{ ...question('invalid'), options: [] }]]) {
    assert.throws(() => codexQuestionRequest({ ...valid, questions }));
  }
  for (const answers of [{}, { scope: { answers: ['Invented'] } }, { scope: { answers: ['A', 'B'] } }, { extra: { answers: ['A'] } }]) assert.throws(() => codexQuestionAnswers(valid, answers));
  const special = request([question('__proto__')]);
  const answers = codexQuestionAnswers(special, Object.fromEntries([['__proto__', { answers: ['A'] }]]));
  assert.ok(Object.hasOwn(answers, '__proto__')); assert.equal(Object.getPrototypeOf(answers), Object.prototype);
});
