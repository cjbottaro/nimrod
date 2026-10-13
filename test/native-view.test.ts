import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { webviewHtml, rendererBundle } from './view-fixture';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';
import { initialConversationState, reduceRpcEvent } from '../src/pi/reducer';

function fixture(options: { sendAutoFollow?: import('../src/pi/view-host').ViewHost['sendAutoFollow']; performance?: import('../src/pi/view-host').ViewHost['performance']; reportNotice?: import('../src/pi/view-host').ViewHost['reportNotice']; resolveNotice?: import('../src/pi/view-host').ViewHost['resolveNotice']; images?: boolean; clipboard?: boolean; missing?: boolean; imageGate?: Promise<void>; releaseOnClear?: boolean; cardRenderer?: import('../src/pi/view-host').ViewHost['cardRenderer']; cardActions?: import('../src/pi/view-host').ViewHost['cardActions'] } = {}) {
  const dom = new JSDOM(webviewHtml(), { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  let persisted: unknown;
  let clipboardReads = 0;
  let submittedPrompts = 0;
  const blobs = new Map<string, Blob>();
  let imageId = 0;
  Object.assign(win.URL, { createObjectURL: () => `blob:fixture-${imageId}`, revokeObjectURL: () => {} });
  const attachments = options.images ? {
    put: async (blob: Blob, name: string) => { const image = { id: `image-${++imageId}`, name, mimeType: blob.type, size: blob.size }; blobs.set(image.id, blob); return image; },
    get: async (image: { id: string }) => { if (options.missing) throw new Error('Image draft is missing'); const blob = blobs.get(image.id)!; await options.imageGate; return blob; },
    readClipboard: options.clipboard ? async () => { clipboardReads++; return new win.Blob(['abc'], { type: 'image/png' }); } : undefined,
  } : undefined;
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  win.requestAnimationFrame = cb => { frames.set(++nextFrame, cb); return nextFrame; };
  win.cancelAnimationFrame = id => { frames.delete(id); };
  const sent: Record<string, unknown>[] = [];
  let receive: (message: unknown) => void = () => {};
  Object.assign(win, { testHost: { sendAutoFollow: options.sendAutoFollow, performance: options.performance, reportNotice: options.reportNotice, resolveNotice: options.resolveNotice, promptSubmitted: () => { submittedPrompts++; }, attachments, cardRenderer: options.cardRenderer, cardActions: options.cardActions, getState: () => undefined, setState: (state: unknown) => { persisted = state; if (options.releaseOnClear) { const images = (state as { attachments?: { id: string }[] }).attachments ?? []; for (const id of blobs.keys()) if (!images.some(image => image.id === id)) blobs.delete(id); } }, postMessage: (message: Record<string, unknown>) => sent.push(message), onMessage: (listener: typeof receive) => { receive = listener; } } });
  win.eval(rendererBundle() + '\nwindow.testView = PiView.mountPiView(window.testHost);');
  const flush = () => { while (frames.size) { const [id, frame] = frames.entries().next().value!; frames.delete(id); frame(0); } };
  const view = (win as unknown as { testView: import('../src/pi/webview-client').PiView }).testView;
  const snapshot = (state: Record<string, unknown>) => { receive({ type: 'snapshot', state }); flush(); };
  const prompt = win.document.querySelector<HTMLTextAreaElement>('#prompt')!;
  const draft = (text: string) => { prompt.value = text; prompt.dispatchEvent(new win.Event('input')); };
  const send = () => prompt.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const paste = (image = true, text = '') => {
    const event = new win.Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: image ? [{ kind: 'file', type: 'image/png', getAsFile: () => new win.File(['abc'], 'Screenshot.png', { type: 'image/png' }) }] : [], types: text ? ['text/plain'] : [], files: [], getData: () => text } });
    prompt.dispatchEvent(event); return event;
  };
  return { dom, win, sent, receive, snapshot, prompt, draft, send, flush, paste, view, frames, state: () => persisted, clipboardReads: () => clipboardReads, submittedPrompts: () => submittedPrompts };
}

function scrollFixture(f: ReturnType<typeof fixture>) {
  const pane = f.win.document.querySelector<HTMLElement>('#transcript-viewport')!;
  let top = 0, height = 2000;
  Object.defineProperties(pane, {
    clientHeight: { get: () => 400 },
    clientWidth: { get: () => 800 },
    scrollHeight: { get: () => height },
    scrollTop: { get: () => top, set: value => { top = Math.max(0, Math.min(value, height - 400)); } },
  });
  const readHistory = () => { pane.scrollTop = 200; pane.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: -50 })); };
  return { pane, readHistory, grow: () => { height += 500; } };
}

for (const mode of [undefined, 'always', 'whenIdle', 'never'] as const) {
  for (const delivery of ['idle', 'steer', 'followUp', 'idleAlt'] as const) {
    test(`send auto-follow ${mode ?? 'default'} handles ${delivery} locally and never repeats on acknowledgement`, () => {
      const f = fixture({ sendAutoFollow: mode ? () => mode : undefined });
      try {
        const s = scrollFixture(f);
        const busy = delivery === 'steer' || delivery === 'followUp';
        f.snapshot({ sessionUnavailable: false, busy, messages: [] });
        s.readHistory();
        f.draft('Local message');
        f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: delivery === 'followUp' || delivery === 'idleAlt', bubbles: true, cancelable: true }));
        const follow = mode === 'always' || ((mode ?? 'whenIdle') === 'whenIdle' && !busy);
        assert.equal(s.pane.scrollTop, follow ? 1600 : 200, 'navigation precedes render, dispatch receipt and Pi events');
        f.flush();
        s.grow();
        f.snapshot({ busy: true, messages: [] });
        assert.equal(s.pane.scrollTop, follow ? 2100 : 200, 'subsequent growth follows only the selected intent');
        s.readHistory(); f.draft('Newer draft');
        f.receive({ type: 'submissionReceipt', id: f.sent.find(m => m.type === 'prompt')!.id, outcome: 'accepted' }); f.flush();
        s.grow(); f.snapshot({ busy: true, messages: [] });
        assert.equal(s.pane.scrollTop, 200, 'upward navigation cancels follow; receipts never jump again');
        assert.equal(f.prompt.value, 'Newer draft');
      } finally { f.dom.window.close(); }
    });
  }
}

test('whenIdle follows the latest observed activity even before the next paint', () => {
  const f = fixture();
  try {
    const s = scrollFixture(f);
    f.snapshot({ sessionUnavailable: false, busy: false, messages: [] }); s.readHistory();
    f.receive({ type: 'snapshot', state: { sessionUnavailable: false, busy: true, messages: [] } });
    f.draft('Already working'); f.send();
    assert.equal(s.pane.scrollTop, 200);
    f.flush();
    f.receive({ type: 'snapshot', state: { sessionUnavailable: false, busy: false, messages: [] } });
    f.draft('Now idle'); f.send();
    assert.equal(s.pane.scrollTop, 1600);
  } finally { f.dom.window.close(); }
});

test('send follow reads live preferences without navigating on changes or non-message controls', () => {
  let mode: 'always' | 'never' = 'never';
  const f = fixture({ sendAutoFollow: () => mode });
  try {
    const s = scrollFixture(f);
    f.snapshot({ sessionUnavailable: false, messages: [] }); s.readHistory();
    mode = 'always';
    assert.equal(s.pane.scrollTop, 200);
    for (const text of ['/name New', '/compact', '/delete', '']) {
      f.draft(text); f.send(); f.flush();
      assert.equal(s.pane.scrollTop, 200);
    }
    f.draft('/skill fixture'); f.send();
    assert.equal(s.pane.scrollTop, 1600, 'prompt slash expansions count as messages');
    mode = 'never';
    s.grow(); f.snapshot({ sessionUnavailable: false, messages: [] });
    assert.equal(s.pane.scrollTop, 2100, 'Never does not disable existing follow');
  } finally { f.dom.window.close(); }
});

test('hidden snapshots do no painting; reveal catches up synchronously and cancelled frames cannot paint', () => {
  const paints: boolean[] = [], snapshots: boolean[] = [];
  const f = fixture({ performance: {
    measure(kind, work, active) { if (kind === 'transcript-render') paints.push(active === true); return work(); },
    record(_kind, active) { snapshots.push(active); },
  } });
  try {
    f.snapshot({ messages: [{ key: 'a', role: 'assistant', content: 'Visible' }] });
    const article = f.win.document.querySelector('#messages article')!;
    const before = paints.length;
    f.receive({ type: 'snapshot', state: { messages: [{ key: 'a', role: 'assistant', content: 'Scheduled' }] } });
    const cancelled = [...f.frames.values()];
    f.view.setActive(false);
    for (let i = 0; i < 100; i++) f.snapshot({ busy: true, messages: [{ key: 'a', role: 'assistant', content: [{ type: 'text', text: `Hidden ${i}` }] }] });
    for (const frame of cancelled) frame(0); // Simulate delivery despite cancellation.
    assert.equal(paints.length, before);
    assert.equal(article.textContent, 'Visible');
    assert.equal(f.frames.size, 0, 'no hidden presentation frames');
    assert.equal(snapshots.filter(active => !active).length, 100, 'every hidden snapshot was received');
    f.prompt.focus(); f.draft('Retained draft');
    f.view.setActive(true);
    assert.equal(paints.length, before + 1, 'one synchronous catch-up, without another host event');
    assert.match(f.win.document.querySelector('#messages')!.textContent!, /Hidden 99/);
    assert.equal(f.win.document.activeElement, f.prompt);
    assert.equal(f.prompt.value, 'Retained draft');
    f.view.setActive(true); f.flush();
    for (const frame of cancelled) frame(0);
    assert.equal(paints.length, before + 1, 'idempotent activation and retired callbacks');
    assert.ok(paints.every(Boolean), 'zero inactive transcript renders');
  } finally { f.dom.window.close(); }
});

for (const follow of [false, true]) test(`hidden catch-up retains transcript intent and independent tool inspection (follow: ${follow})`, () => {
  const f = fixture();
  try {
    const pane = f.win.document.querySelector<HTMLElement>('#transcript-viewport')!;
    let height = 1000, hidden = false;
    Object.defineProperties(pane, { clientHeight: { get: () => hidden ? 0 : 100 }, scrollHeight: { get: () => hidden ? 0 : height } });
    const tools = ['one', 'two'].map(id => ({ type: 'toolCall', id, name: 'bash', arguments: { command: id }, toolStatus: 'running', executionOutput: 'Start', hasStreamingOutput: true }));
    const state = (output: string) => ({ busy: true, messages: [{ key: 'a', role: 'assistant', content: tools.map(tool => ({ ...tool, executionOutput: output })) }] });
    f.snapshot(state('Start'));
    const cards = [...f.win.document.querySelectorAll<HTMLDetailsElement>('.tool-card')];
    cards.forEach(card => { card.open = true; card.dispatchEvent(new f.win.Event('toggle')); });
    f.flush();
    const outputs = cards.map(card => card.querySelector<HTMLElement>('.tool-output')!);
    outputs.forEach((output, index) => {
      Object.defineProperties(output, { clientHeight: { get: () => hidden ? 0 : 100 }, scrollHeight: { get: () => hidden ? 0 : height } });
      output.scrollTop = 37 + 40 * index;
    });
    pane.scrollTop = follow ? height - 100 : 240;
    pane.dispatchEvent(new f.win.Event('scroll'));
    if (!follow) pane.dispatchEvent(new f.win.WheelEvent('wheel', { deltaY: -100 }));
    else { f.view.scrollToBottom(); f.flush(); }
    f.view.setActive(false); hidden = true;
    f.snapshot(state('Latest output')); height = 2000;
    hidden = false; f.view.setActive(true); f.flush();
    assert.equal(pane.scrollTop, follow ? height : 240, 'mock offsets retain the existing follow target or reader position');
    assert.deepEqual(outputs.map(output => output.scrollTop), [37, 77]);
    cards.forEach((card, index) => {
      assert.equal(f.win.document.querySelectorAll('.tool-card')[index], card);
      assert.equal(card.open, true);
      assert.match(card.textContent!, /Latest output/);
    });
    // Hiding again before output-restoration delivery must retain the intended offset.
    f.receive({ type: 'snapshot', state: state('Another output') });
    const [id, render] = f.frames.entries().next().value!;
    f.frames.delete(id); render(0);
    f.view.setActive(false); hidden = true;
    f.snapshot(state('Final visible output'));
    hidden = false; f.view.setActive(true); f.flush();
    assert.deepEqual(outputs.map(output => output.scrollTop), [37, 77]);
    f.receive({ type: 'snapshot', state: state('Paint before immediate hide') });
    const [nextId, nextRender] = f.frames.entries().next().value!;
    f.frames.delete(nextId); nextRender(0);
    f.view.setActive(false); hidden = true;
    outputs.forEach(output => { output.scrollTop = 0; }); // Hidden-geometry settlement before restoration.
    hidden = false; f.view.setActive(true); f.flush();
    assert.deepEqual(outputs.map(output => output.scrollTop), [37, 77], 'restore a cancelled output frame even without a newer snapshot');
  } finally { f.dom.window.close(); }
});

test('hidden ordered queue consumption adopts the existing pending article despite a later identical queue entry', () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('Later');
    f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true })); f.flush();
    const pending = f.win.document.querySelector('.queued-turns .user')!;
    const submission = f.sent.find(message => message.type === 'prompt')!;
    f.draft('New draft'); f.view.setActive(false);
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: [], followUp: ['Later'] } });
    f.snapshot({ busy: true, messages: [{ key: 'actual', role: 'user', content: 'Later' }], queue: { authoritative: true, steering: [], followUp: [] } });
    f.snapshot({ busy: false, messages: [{ key: 'actual', role: 'user', content: 'Later' }], queue: { authoritative: true, steering: [], followUp: ['Later'] } });
    assert.ok(pending.closest('.queued-turns'), 'hidden DOM is untouched');
    f.view.setActive(true);
    assert.equal(f.win.document.querySelector('#messages > .user'), pending);
    assert.equal(pending.querySelector('.steering-status'), null);
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 2);
    assert.equal(f.prompt.value, 'New draft');
    assert.equal(f.sent.filter(message => message.type === 'prompt').length, 1);
  } finally { f.dom.window.close(); }
});

test('hidden reset/disposal retire pending paints and plugins; reveal updates mounted plugins only once', () => {
  let updates = 0, disposals = 0;
  const phases: string[] = [], notices: string[] = [];
  const f = fixture({ reportNotice: notice => notices.push(notice.message), cardRenderer: () => ({
    apiVersion: 2, id: 'fixture.hidden', supports: () => true,
    mount(context) {
      const input = context.document.createElement('input'); input.value = 'Local plugin state'; context.body.append(input);
      return { update(data) { updates++; phases.push(data.toolStatus ?? ''); }, dispose() { disposals++; } };
    },
  }) });
  try {
    const state = (text: string, toolStatus = 'running') => ({ messages: [{ key: 'a', role: 'assistant', content: [{ type: 'toolCall', id: 'one', name: 'bash', arguments: { command: text }, toolStatus }] }] });
    f.snapshot(state('Start'));
    const card = f.win.document.querySelector<HTMLDetailsElement>('.tool-card')!;
    const input = card.querySelector<HTMLInputElement>('input')!;
    const before = updates;
    f.view.setActive(false);
    for (let i = 0; i < 20; i++) f.snapshot(state(`Hidden ${i}`));
    f.snapshot({ ...state('Latest', 'finished'), recoveryNotice: 'Unavailable in background' });
    assert.equal(updates, before); assert.equal(disposals, 0);
    assert.ok(notices.includes('Unavailable in background'), 'notices are live before reveal');
    const modal = f.win.document.createElement('dialog'); modal.setAttribute('open', ''); f.win.document.body.append(modal);
    const focus = f.win.document.createElement('button'); modal.append(focus); focus.focus();
    f.view.setActive(true);
    assert.equal(updates, before + 1); assert.equal(disposals, 0);
    assert.equal(phases.at(-1), 'finished', 'completion is current on reveal');
    assert.equal(f.win.document.querySelector('.tool-card'), card);
    assert.equal(card.querySelector('input'), input); assert.equal(input.value, 'Local plugin state');
    assert.equal(f.win.document.activeElement, focus);
    f.receive({ type: 'snapshot', state: state('Scheduled') });
    const retired = [...f.frames.values()];
    f.view.setActive(false);
    f.receive({ type: 'sessionReset' });
    assert.equal(disposals, 1, 'reset is immediate even while hidden');
    f.snapshot(state('Replacement'));
    f.view.setActive(true); f.flush();
    assert.notEqual(f.win.document.querySelector('.tool-card'), card);
    const paintsBeforeDispose = updates;
    f.receive({ type: 'snapshot', state: state('Never paint') });
    retired.push(...f.frames.values());
    f.view.dispose();
    for (const frame of retired) frame(0);
    f.view.setActive(true);
    assert.equal(updates, paintsBeforeDispose); assert.equal(disposals, 2);
  } finally { f.dom.window.close(); }
});

test('bundled native bridge clears immediately and isolates new drafts from pending/unknown/late receipts', () => {
  const f = fixture();
  try {
    f.snapshot({ sessionUnavailable: false, status: 'Ready', messages: [] });
    f.draft('original'); f.send();
    assert.equal(f.submittedPrompts(), 1, 'local Send effects run before any RPC result');
    const submission = f.sent.find(m => m.type === 'prompt')!;
    assert.equal(f.prompt.value, '');
    assert.equal(Object.hasOwn(f.state() as object, 'submission'), false);
    f.draft('new draft'); f.send();
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 2, 'send the next message without waiting for acknowledgement');
    f.draft('new draft');
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    assert.equal(f.prompt.value, 'new draft');
    const second = f.sent.filter(m => m.type === 'prompt').at(-1)!;
    f.receive({ type: 'submissionReceipt', id: second.id, outcome: 'unknown' });
    assert.equal(f.prompt.value, 'new draft');
    f.send();
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 3);
    assert.equal(f.prompt.value, '');
    assert.equal(f.win.document.querySelector("[data-action='dismiss-unknown']"), null);
    f.draft('new draft');
    f.receive({ type: 'submissionReceipt', id: second.id, outcome: 'accepted' });
    assert.equal(f.prompt.value, 'new draft');
    assert.equal(f.submittedPrompts(), 3, 'late RPC results never repeat local Send effects');
    f.send();
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 4, 'late old receipt does not gate new sends');
  } finally { f.dom.window.close(); }
});

test('local Send intent covers ordinary, steering and follow-up messages but excludes controls and validation failures', () => {
  const f = fixture();
  try {
    f.snapshot({ sessionUnavailable: false, messages: [] });
    f.draft('normal'); f.send();
    assert.equal(f.submittedPrompts(), 1);
    f.snapshot({ sessionUnavailable: false, busy: true, messages: [] });
    f.draft('steering'); f.send();
    f.draft('follow-up');
    f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    assert.equal(f.submittedPrompts(), 3, 'all message delivery kinds mark local use');
    f.snapshot({ sessionUnavailable: false, busy: false, messages: [] });
    for (const text of ['/name Inline', '/name', '/compact', '/mcp', '/delete', '']) { f.draft(text); f.send(); }
    f.snapshot({ sessionUnavailable: true, messages: [] }); f.draft('unavailable'); f.send();
    f.snapshot({ sessionUnavailable: false, compacting: true, messages: [] }); f.draft('compacting'); f.send();
    f.receive({ type: 'deletionLock', locked: true });
    f.snapshot({ sessionUnavailable: false, messages: [] }); f.draft('deletion'); f.send();
    assert.equal(f.submittedPrompts(), 3, 'controls and locally blocked sends never mark use');
  } finally { f.dom.window.close(); }
});

test('/mcp opens inspection without a prompt, turn, recency or transcript navigation', () => {
  for (const busy of [false, true]) {
    const f = fixture({ sendAutoFollow: () => 'always' });
    try {
      const scroll = scrollFixture(f);
      f.snapshot({ sessionUnavailable: false, busy, messages: [] });
      scroll.readHistory();
      const top = scroll.pane.scrollTop;
      f.draft('/mcp'); f.send(); f.flush();
      assert.equal(f.prompt.value, '');
      assert.equal(f.sent.at(-1)?.type, 'inspectMcp');
      assert.equal(f.sent.some(message => message.type === 'prompt'), false);
      assert.equal(f.submittedPrompts(), 0);
      assert.equal(scroll.pane.scrollTop, top);
      assert.equal(f.win.document.querySelectorAll('[data-message-key]').length, 0);
      f.draft('new draft');
      assert.equal(f.prompt.value, 'new draft');
    } finally { f.win.close(); }
  }
});

test('model and thinking controls stay available during work but respect readiness and lifecycle', () => {
  const f = fixture();
  try {
    const controls = { ready: true, changing: false, model: { provider: 'fixture', id: 'demo' }, thinkingLevel: 'high', thinkingLevels: ['off', 'high'] };
    const model = f.win.document.querySelector<HTMLButtonElement>('#model')!;
    const thinking = f.win.document.querySelector<HTMLButtonElement>('#thinking')!;
    f.draft('unsent draft');
    for (const compacting of [false, true]) {
      f.snapshot({ busy: true, compacting, sessionUnavailable: false, modelControls: controls });
      assert.equal(model.disabled, false);
      assert.equal(thinking.disabled, false);
      model.click(); thinking.click();
      assert.equal(f.prompt.value, 'unsent draft');
    }
    assert.deepEqual(f.sent.filter(m => m.type === 'selectModel' || m.type === 'selectThinking').map(m => m.type),
      ['selectModel', 'selectThinking', 'selectModel', 'selectThinking']);
    for (const state of [
      { modelControls: { ...controls, ready: false } },
      { modelControls: { ...controls, changing: true } },
      { modelControls: controls, sessionUnavailable: true },
    ]) {
      f.snapshot({ busy: true, sessionUnavailable: false, ...state });
      assert.equal(model.disabled, true);
      assert.equal(thinking.disabled, true);
    }
    assert.equal(f.sent.some(m => m.type === 'prompt' || m.type === 'stop'), false);
  } finally { f.dom.window.close(); }
});

test('file and HTTP links route once through native host; unsafe schemes stay inert', () => {
  const f = fixture();
  try {
    f.snapshot({ messages: [{ key: 'a', role: 'assistant', content: '[file](README.md:12) [web](https://example.com) [bad](javascript:alert%281%29)' }] });
    const links = f.win.document.querySelectorAll('a');
    assert.equal(links[0].getAttribute('href'), 'README.md:12');
    for (const link of links) link.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true, cancelable: true }));
    assert.deepEqual(f.sent.filter(m => m.type === 'openLink').map(m => m.href), ['README.md:12', 'https://example.com']);
    assert.equal(links[2].hasAttribute('href'), false);
  } finally { f.dom.window.close(); }
});

test('manual compaction is a dedicated idle-only host operation', () => {
  const f = fixture();
  try {
    f.snapshot({ status: 'Ready', sessionUnavailable: false });
    f.prompt.focus();
    f.draft('/com');
    assert.match(f.win.document.querySelector('#slash-suggestions')!.textContent!, /\/compact/);
    f.draft('/compact Keep implementation details'); f.send();
    const compact = f.sent.find(m => m.type === 'compact')!;
    assert.equal(compact.customInstructions, 'Keep implementation details');
    assert.equal(f.prompt.value, '');
    f.receive({ type: 'submissionReceipt', id: compact.id, outcome: 'accepted' });
    f.snapshot({ busy: true, status: 'Working…', sessionUnavailable: false });
    f.draft('/compact now'); f.send();
    assert.equal(f.sent.filter(m => m.type === 'compact').length, 1);
    assert.match(f.win.document.querySelector('#submission-notice')!.textContent!, /only while Pi is idle/);
  } finally { f.dom.window.close(); }
});

test('deferred native operations are rejected locally, never silently sent as chat', () => {
  const f = fixture();
  try {
    f.snapshot({ status: 'Ready', sessionUnavailable: false });
    for (const command of ['/resume', '/delete', '/new']) { f.draft(command); f.send(); }
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 0);
    assert.match(f.win.document.querySelector('#submission-notice')!.textContent!, /not supported/);
  } finally { f.dom.window.close(); }
});

test('streaming updates preserve connected tool spinner and manual disclosure', () => {
  const f = fixture();
  try {
    const tool = { type: 'toolCall', id: 'tool', name: 'bash', arguments: { command: 'demo' }, toolStatus: 'running', executionOutput: 'one' };
    const snapshot = (block: object) => f.snapshot({ busy: true, messages: [{ key: 'a', role: 'assistant', content: [block] }] });
    snapshot(tool);
    const details = f.win.document.querySelector<HTMLDetailsElement>('.tool-card')!;
    const spinner = details.querySelector('.tool-card-spinner')!;
    details.open = true; details.dispatchEvent(new f.win.Event('toggle'));
    snapshot({ ...tool, executionOutput: 'one\ntwo', hasStreamingOutput: true });
    assert.equal(f.win.document.querySelector('.tool-card'), details);
    assert.equal(details.querySelector('.tool-card-spinner'), spinner);
    assert.equal(spinner.isConnected, true);
    assert.equal(details.open, true);
  } finally { f.dom.window.close(); }
});

for (const assistantFirst of [false, true]) test(`either source creates one stable card (assistant first: ${assistantFirst})`, () => {
  const f = fixture();
  try {
    let state = initialConversationState();
    const apply = (event: Record<string, unknown>) => {
      state = reduceRpcEvent(state, event); f.snapshot({ ...state });
      assert.equal(f.win.document.querySelectorAll('.tool-card').length, 1);
      assert.equal(f.win.document.querySelectorAll('article > .label').length, 0);
      assert.equal(f.sent.filter(m => m.type === 'renderError').length, 0);
    };
    const assistant = { type: 'message_start', message: { role: 'assistant', timestamp: 1, content: [{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'README.md' } }] } };
    const execution = { type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read', args: { path: 'README.md' } };
    apply(assistantFirst ? assistant : execution);
    const card = f.win.document.querySelector<HTMLDetailsElement>('.tool-card')!;
    card.open = true; card.dispatchEvent(new f.win.Event('toggle'));
    apply({ type: 'tool_execution_update', toolCallId: 'read-1', partialResult: { content: [{ type: 'text', text: 'live' }] } });
    const spinner = card.querySelector('.tool-card-spinner');
    const output = card.querySelector<HTMLElement>('.tool-output')!;
    Object.defineProperties(output, { scrollHeight: { value: 1_000 }, clientHeight: { value: 100 } });
    output.scrollTop = 37;
    apply(assistantFirst ? execution : assistant);
    assert.equal(f.win.document.querySelector('.tool-card'), card);
    assert.equal(card.querySelector('.tool-card-spinner'), spinner);
    assert.equal(card.querySelector('.tool-output'), output);
    assert.equal(output.scrollTop, 37);
    assert.equal(card.open, true);
    assert.equal(card.querySelector('.tool-card-preview')?.textContent, 'README.md');
    apply({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 0, id: 'read-1', toolName: 'read' } });
    assert.equal(card.querySelector('.tool-output'), output);
    const result = { role: 'toolResult', toolCallId: 'read-1', toolName: 'read', content: [{ type: 'text', text: 'final' }] };
    apply({ type: 'turn_end', toolResults: [result] });
    apply({ type: 'message_end', message: result });
    apply(execution); // A duplicate start must not rewind the finished card.
    assert.equal(card.querySelector('.tool-card-spinner'), null);
    assert.equal(card.querySelector('[data-output-kind="result"] .tool-output')?.textContent, 'final');
    assert.equal(card.open, true);
    assert.equal(f.win.document.querySelector('.tool-card'), card);
    f.receive({ type: 'sessionReset' });
    f.snapshot({ ...state });
    assert.notEqual(f.win.document.querySelector('.tool-card'), card);
    assert.equal(f.win.document.querySelector<HTMLDetailsElement>('.tool-card')!.open, false);
  } finally { f.dom.window.close(); }
});

test('each tool output retains its own inspection position in a multi-tool turn', () => {
  const f = fixture();
  try {
    const tool = (id: string, text: string) => ({ type: 'toolCall', id, name: 'bash', arguments: { command: id }, toolStatus: 'running', executionOutput: text });
    const snapshot = (text: string) => f.snapshot({ messages: [{ key: 'multi', role: 'assistant', content: [tool('a', text), tool('b', text)] }] });
    snapshot('one');
    const outputs = Array.from(f.win.document.querySelectorAll<HTMLElement>('.tool-output'));
    outputs.forEach((output, index) => {
      Object.defineProperties(output, { scrollHeight: { value: 1_000 }, clientHeight: { value: 100 } });
      output.scrollTop = 30 + index * 50;
    });
    snapshot('one\\ntwo');
    assert.deepEqual(outputs.map(output => output.scrollTop), [30, 80]);
  } finally { f.dom.window.close(); }
});

test('reasoning patches preserve the mounted shell, indicator and disclosure without stealing focus', () => {
  const f = fixture();
  try {
    const snapshot = (thinking: string, thinkingComplete = false) => f.snapshot({ messages: [{
      key: 'reasoning', role: 'assistant', content: [{ type: 'thinking', thinking, thinkingComplete }],
    }] });
    snapshot('First line');
    const card = f.win.document.querySelector<HTMLDetailsElement>('.reasoning-card')!;
    const indicator = card.querySelector('.reasoning-indicator');
    card.open = true; card.dispatchEvent(new f.win.Event('toggle'));
    f.prompt.focus();
    snapshot('First line\nMore reasoning');
    assert.equal(f.win.document.querySelector('.reasoning-card'), card);
    assert.equal(card.querySelector('.reasoning-indicator'), indicator);
    assert.equal(indicator?.isConnected, true);
    assert.equal(card.open, true);
    assert.equal(f.win.document.activeElement, f.prompt);
    snapshot('First line\nCompleted reasoning', true);
    assert.equal(card.querySelector('.reasoning-indicator'), indicator);
    assert.ok(card.querySelector('.tool-card-succeeded'));
    assert.equal(card.open, true);
    snapshot('');
    assert.equal(f.win.document.querySelector('.reasoning-card'), null);
    assert.equal(f.sent.some(message => message.type === 'renderError'), false);
  } finally { f.dom.window.close(); }
});

test('the same tool invocation has independent shells and disclosure in separate mounted views', () => {
  const first = fixture();
  const second = fixture();
  try {
    const state = { messages: [{ key: 'a', role: 'assistant', content: [{
      type: 'toolCall', id: 'shared-id', name: 'bash', arguments: { command: 'fixture' }, toolStatus: 'running',
    }] }] };
    first.snapshot(state); second.snapshot(state);
    const firstCard = first.win.document.querySelector<HTMLDetailsElement>('.tool-card')!;
    const secondCard = second.win.document.querySelector<HTMLDetailsElement>('.tool-card')!;
    firstCard.open = true; firstCard.dispatchEvent(new first.win.Event('toggle'));
    first.snapshot(state); second.snapshot(state);
    assert.notEqual(firstCard, secondCard);
    assert.equal(firstCard.open, true);
    assert.equal(secondCard.open, false);
    first.receive({ type: 'sessionReset' }); first.flush();
    assert.equal(first.win.document.querySelector('.tool-card'), null);
    assert.equal(second.win.document.querySelector('.tool-card'), secondCard);
    assert.equal(secondCard.isConnected, true);
  } finally { first.dom.window.close(); second.dom.window.close(); }
});

test('mounted view disposes tool renderer instances on removal, reset and view disposal, not routine snapshots', () => {
  let mounted = 0; let disposed = 0;
  const f = fixture({ cardRenderer: () => ({ id: 'fixture.tool', supports: () => true, mount() {
    mounted++; return { update: () => ({ title: 'fixture', sections: [] }), dispose() { disposed++; } };
  } }) });
  try {
    const state = { messages: [{ key: 'a', role: 'assistant', content: [{ type: 'toolCall', id: 'a', name: 'bash' }] }] };
    f.snapshot(state); f.snapshot(state);
    assert.deepEqual([mounted, disposed], [1, 0]);
    f.snapshot({ messages: [] });
    assert.deepEqual([mounted, disposed], [1, 1]);
    f.snapshot(state); f.receive({ type: 'sessionReset' }); f.flush();
    assert.deepEqual([mounted, disposed], [2, 2]);
    f.snapshot(state);
    (f.win as unknown as { testView: { dispose(): void } }).testView.dispose();
    assert.deepEqual([mounted, disposed], [3, 3]);
  } finally { f.dom.window.close(); }
});

test('historical edit Copy uses presentation capability without connection, draft mutation or modal delivery', async () => {
  const copied: string[] = [];
  const f = fixture({ cardActions: { copy: async text => { copied.push(text); }, openLink: async () => {}, popOutCode: async () => {} } });
  try {
    f.snapshot({ sessionUnavailable: true, messages: [{ key: 'history', role: 'assistant', content: [{ type: 'toolCall', id: 'edit', name: 'edit', arguments: { oldText: 'a', newText: 'b' }, toolStatus: 'result', resultOutput: 'saved' }] }] });
    f.draft('retained draft');
    const button = f.win.document.querySelector<HTMLButtonElement>('.card-plugin-copy')!;
    button.focus(); button.click(); await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.deepEqual(copied, ['-a\n+b']); assert.equal(f.prompt.value, 'retained draft'); assert.equal(f.win.document.activeElement, button);
    const modal = f.win.document.createElement('dialog'); modal.setAttribute('open', ''); f.win.document.body.append(modal);
    button.click(); await Promise.resolve(); assert.equal(copied.length, 1);
    assert.equal(f.sent.some(message => message.type === 'prompt'), false);
  } finally { f.dom.window.close(); }
});

test('Markdown cannot add scripts or native command links', () => {
  const dom = new JSDOM('');
  try {
    const renderer = createSafeMarkdownRenderer(dom.window as unknown as Window);
    const output = renderer.render('<script>alert(1)</script>\n[bad](command:workbench.action)\n[remote](file://server/share)\n[local](file:///tmp/a.ts#L2)');
    assert.doesNotMatch(output, /<script|href="command:|href="file:\/\/server/);
    assert.match(output, /href="file:\/\/\/tmp\/a.ts#L2"/);
  } finally { dom.window.close(); }
});


test('code actions are icon-only; duplicate content sends the same pop-out payload without a transcript locator', () => {
  const f = fixture();
  try {
    const text = '```ts\nconst value = "<script>";\n```\n\n```text\nsecond\n```';
    const state = { messages: [{ key: 'answer', role: 'assistant', content: text }] };
    f.snapshot(state);
    const buttons = f.win.document.querySelectorAll<HTMLButtonElement>('.code-popout');
    assert.equal(buttons.length, 2);
    assert.equal(buttons[0].textContent, '');
    assert.ok(buttons[0].nextElementSibling?.classList.contains('code-copy'));
    assert.ok(buttons[0].querySelector('svg[aria-hidden="true"]'));
    assert.match(buttons[0].title, /read-only snapshot/);
    buttons[0].querySelector('path')!.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true }));
    buttons[1].click();
    f.snapshot({ messages: [{ key: 'different-turn', role: 'assistant', content: text }] });
    f.win.document.querySelector<HTMLButtonElement>('.code-popout')!.click();
    const sent = f.sent.filter(m => m.type === 'popOutCode');
    assert.equal(sent[0].text, 'const value = "<script>";\n');
    assert.equal(sent[0].language, 'ts');
    assert.notEqual(sent[0].text, sent[1].text);
    assert.equal(JSON.stringify(sent[0]), JSON.stringify(sent[2]));
    assert.equal('key' in sent[0], false);
    assert.equal(f.win.document.querySelector('.code-copy')!.textContent, '');
  } finally { f.dom.window.close(); }
});

test('only unlabeled user code is detected across string, block and pending turns; pop-outs capture its language', () => {
  const f = fixture();
  try {
    const source = 'def hello(name):\n    print("Hello", name)\n    return None\n';
    const code = `\`\`\`\n${source}\`\`\``;
    const messages = [
      { key: 'user-string', role: 'user', content: code },
      { key: 'user-block', role: 'user', content: [{ type: 'text', text: code }] },
      { key: 'assistant', role: 'assistant', content: code },
      { key: 'assistant-block', role: 'assistant', content: [{ type: 'text', text: code }, { type: 'thinking', thinking: code }] },
      { key: 'user-explicit', role: 'user', content: `\`\`\`text\n${source}\`\`\`` },
    ];
    f.snapshot({ busy: true, messages });
    assert.deepEqual(Array.from(f.win.document.querySelectorAll('.code-language'), node => node.textContent),
      ['python (detected)', 'python (detected)', 'plain text', 'plain text', 'plain text', 'text']);
    f.win.document.querySelector<HTMLButtonElement>('.user .code-popout')!.click();
    const payload = f.sent.find(m => m.type === 'popOutCode')!;
    assert.equal(payload.language, 'python');
    assert.equal(payload.text, source);
    f.draft(code); f.send(); f.flush();
    assert.equal(f.win.document.querySelector('.user:last-child .code-language')!.textContent, 'python (detected)');
    f.snapshot({ busy: true, messages: [{ ...messages[0], content: `\`\`\`plaintext\n${source}\`\`\`` }, ...messages.slice(1)] });
    assert.equal(f.win.document.querySelector('.user .code-language')!.textContent, 'plaintext');
  } finally { f.dom.window.close(); }
});

test('copy falls back to host clipboard and briefly swaps to a checkmark or failure icon', async () => {
  const f = fixture();
  try {
    f.snapshot({ messages: [{ key: 'answer', role: 'assistant', content: '```text\nexact <value>\n```' }] });
    const timers: (() => void)[] = [];
    f.win.setTimeout = ((callback: () => void, delay: number) => {
      assert.equal(delay, 1_200); timers.push(callback); return timers.length;
    }) as typeof f.win.setTimeout;
    const copy = f.win.document.querySelector<HTMLButtonElement>('.code-copy')!;
    const initial = copy.innerHTML;
    copy.querySelector('path')!.dispatchEvent(new f.win.MouseEvent('click', { bubbles: true }));
    await Promise.resolve();
    const request = f.sent.find(m => m.type === 'copyCode')!;
    assert.equal(request.text, 'exact <value>\n');
    assert.equal(copy.disabled, true);
    f.receive({ type: 'copyResult', id: request.id, success: true });
    assert.notEqual(copy.innerHTML, initial);
    assert.equal(copy.textContent, '');
    assert.equal(copy.title, 'Copied to clipboard');
    assert.equal(copy.disabled, false);
    timers.shift()!();
    assert.equal(copy.innerHTML, initial);
    copy.click(); await Promise.resolve();
    const failed = f.sent.filter(m => m.type === 'copyCode').at(-1)!;
    f.receive({ type: 'copyResult', id: failed.id, success: false });
    assert.match(copy.title, /Copy failed/);
    assert.match(f.win.document.querySelector('.code-copy-status')!.textContent!, /Unable/);
    timers.shift()!();
    assert.equal(copy.innerHTML, initial);
  } finally { f.dom.window.close(); }
});

test('pop-out rendering preserves raw code without interpreting Markdown or HTML', () => {
  const dom = new JSDOM('');
  try {
    const source = '<script>alert(1)</script>\n```\n[link](https://example.com)\n';
    dom.window.document.body.innerHTML = createSafeMarkdownRenderer(dom.window as unknown as Window).renderCode(source, 'html');
    assert.equal(dom.window.document.querySelector('pre > code')!.textContent, source);
    assert.equal(dom.window.document.querySelectorAll('script, a, .code-popout').length, 0);
    assert.equal(dom.window.document.querySelectorAll('.code-copy').length, 1);
    assert.ok(dom.window.document.querySelector('code span'));
  } finally { dom.window.close(); }
});

for (const eventFirst of [false, true]) test(`idle send previews immediately and reconciles in place with ${eventFirst ? 'event' : 'receipt'} first`, () => {
  const f = fixture();
  try {
    const old = { key: 'old', role: 'user', content: 'repeat **message**' };
    f.snapshot({ busy: false, messages: [old] });
    f.prompt.focus();
    f.draft('repeat **message**'); f.send(); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    const pending = f.win.document.querySelectorAll<HTMLElement>('#messages .user')[1];
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 2);
    assert.equal(pending.querySelector('.steering-status'), null);
    assert.equal(pending.querySelector('strong')?.textContent, 'message');
    f.draft('new draft');
    const actual = { key: 'actual', role: 'user', content: [{ type: 'text', text: submission.text }] };
    const reconcile = () => f.snapshot({ busy: true, messages: [old, actual, { key: 'assistant', role: 'assistant', content: 'Working' }] });
    if (eventFirst) reconcile();
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush();
    if (!eventFirst) {
      assert.equal(pending.querySelector('.steering-status'), null);
      reconcile();
    }
    assert.equal(f.win.document.querySelectorAll('#messages .user')[1], pending);
    assert.equal(pending.querySelector('.steering-status'), null);
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 2);
    assert.equal(f.prompt.value, 'new draft');
    assert.equal(f.win.document.activeElement, f.prompt);
  } finally { f.dom.window.close(); }
});

test('steering appears before acknowledgement, remains after live output, and reconciles in place', () => {
  const f = fixture();
  try {
    const assistant = { key: 'assistant', role: 'assistant', content: 'Working' };
    f.snapshot({ busy: true, messages: [assistant] });
    f.prompt.focus();
    f.draft('Please **change direction**'); f.send(); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    const pending = f.win.document.querySelector<HTMLElement>('#messages .user')!;
    const label = pending.querySelector('.delivery-status-shimmer')!;
    assert.equal(label.textContent, 'Steering');
    assert.equal(pending.querySelector('strong')?.textContent, 'change direction');
    assert.equal(f.prompt.value, '');
    assert.equal(f.win.document.activeElement, f.prompt);
    f.snapshot({ busy: true, messages: [assistant], queue: { authoritative: true, steering: [submission.text], followUp: ['Later'] } });
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 2);
    assert.doesNotMatch(f.win.document.querySelector('#queue-activity')!.textContent!, /change direction/);
    assert.match(f.win.document.querySelector('#queue-activity')!.textContent!, /queued.*1 pending/);
    assert.doesNotMatch(f.win.document.querySelector('#queue-activity')!.textContent!, /Later/);
    assert.equal(pending.querySelector('.delivery-status-shimmer'), label, 'queue observation cannot acknowledge steering');
    f.draft('new draft');
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush();
    assert.equal(f.prompt.value, 'new draft');
    assert.equal(pending.querySelector('.delivery-status-shimmer'), label, 'acceptance does not settle steering');
    f.snapshot({ busy: true, messages: [assistant, { key: 'tool', role: 'tool', toolCallId: 't', toolName: 'bash', toolStatus: 'running' }], queue: { authoritative: true, steering: [], followUp: [] } });
    assert.equal(f.win.document.querySelector('#messages')!.lastElementChild?.previousElementSibling, pending);
    assert.equal(pending.querySelector('.delivery-status-shimmer'), label, 'dequeue does not settle steering');
    assert.equal(pending.closest('.queued-turns'), null);
    f.snapshot({ busy: true, messages: [assistant, { key: 'user', role: 'user', content: [{ type: 'text', text: submission.text }] }] });
    assert.equal(f.win.document.querySelector('#messages .user'), pending);
    assert.equal(pending.querySelector('.steering-status'), null);
    assert.equal(pending.getAttribute('aria-label'), 'User message');
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 2);
    assert.equal(f.win.document.activeElement, f.prompt);
  } finally { f.dom.window.close(); }
});

for (const eventFirst of [false, true]) test(`steering status is removed only by consumption with ${eventFirst ? 'user event before receipt' : 'receipt before user event'} without replacing the turn`, () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('change course'); f.send(); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    const turn = f.win.document.querySelector('#messages .user')!;
    assert.equal(turn.querySelector('.delivery-status-shimmer')?.textContent, 'Steering');
    f.draft('newer draft');
    const actual = { key: 'actual', role: 'user', content: 'change course' };
    if (eventFirst) f.snapshot({ busy: true, messages: [actual] });
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush();
    if (!eventFirst) {
      assert.equal(turn.querySelector('.delivery-status-shimmer')?.textContent, 'Steering');
      f.snapshot({ busy: true, messages: [actual] });
    }
    assert.equal(turn.querySelector('.steering-status'), null);
    assert.equal(f.win.document.querySelector('#messages .user'), turn);
    assert.equal(f.prompt.value, 'newer draft');
  } finally { f.dom.window.close(); }
});

test('steering status shimmers after local image preparation through acceptance until consumption', async () => {
  const f = fixture({ images: true });
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('caption'); f.paste(); await tickImages(); f.send();
    const deadline = Date.now() + 2000;
    while (!f.sent.some(m => m.type === 'prompt') && Date.now() < deadline) await tickImages();
    f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    assert.ok(submission);
    const turn = f.win.document.querySelector('#messages .user')!;
    assert.ok(turn.querySelector('.transcript-image'));
    assert.equal(turn.querySelector('.delivery-status-shimmer')?.textContent, 'Steering');
    const label = turn.querySelector('.delivery-status-shimmer');
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush();
    assert.equal(turn.querySelector('.delivery-status-shimmer'), label);
    f.snapshot({ busy: true, messages: [{ key: 'actual-image-steer', role: 'user', content: [{ type: 'text', text: 'caption' }, ...(submission.images as object[])] }] });
    assert.equal(turn.querySelector('.steering-status'), null);
    assert.equal(f.win.document.querySelector('#messages .user'), turn);
  } finally { f.dom.window.close(); }
});

test('authoritative steering queue entries shimmer until consumed, without becoming sticky', () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: ['queued steer'], followUp: [] } });
    const turn = f.win.document.querySelector('#messages .user')!;
    const label = turn.querySelector('.delivery-status-shimmer');
    assert.equal(label?.textContent, 'Steering');
    assert.equal(turn.closest('.queued-turns'), null);
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: [], followUp: [] } });
    assert.equal(turn.querySelector('.delivery-status-shimmer'), label);
    f.snapshot({ busy: true, messages: [{ key: 'actual', role: 'user', content: 'queued steer' }] });
    assert.equal(f.win.document.querySelector('#messages .user'), turn);
    assert.equal(turn.querySelector('.steering-status'), null);
  } finally { f.dom.window.close(); }
});

test('coalesced queue removal and clear_queue recovery do not recreate pending steering', () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('stop this steer'); f.send();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    f.receive({ type: 'snapshot', state: { busy: true, queue: { authoritative: true, steering: ['stop this steer'], followUp: [] } } });
    f.receive({ type: 'snapshot', state: { busy: true, queue: { authoritative: true, steering: [], followUp: [] } } });
    f.receive({ type: 'queueRecovery', steering: ['stop this steer'], followUp: [] }); f.flush();
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 0);
    assert.match(f.win.document.querySelector('#queue-activity')!.textContent!, /Recovered steering.*stop this steer.*Restore/);
    f.win.document.querySelector<HTMLButtonElement>('[data-recovery-id]')!.click();
    assert.equal(f.prompt.value, 'stop this steer');
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 1);
  } finally { f.dom.window.close(); }
});

for (const busy of [false, true]) for (const outcome of ['rejected', 'unknown'] as const) test(`${busy ? 'steering' : 'idle send'} ${outcome} marks the retained turn without replay`, () => {
  const f = fixture();
  try {
    f.snapshot({ busy, messages: [] });
    f.draft('uncertain steer'); f.send();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome }); f.flush();
    if (outcome === 'unknown') assert.match(f.win.document.querySelector('#messages .user')!.textContent!, /Acceptance unknown/);
    else assert.match(f.win.document.querySelector('#messages .user')!.textContent!, /Not sent/);
    assert.equal(f.win.document.querySelector('.delivery-status-shimmer'), null, 'errors do not animate');
    assert.equal(f.prompt.value, '');
    assert.equal(f.win.document.querySelector('[data-recovery-id]'), null);
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 1);
    f.receive({ type: 'sessionReset' }); f.flush();
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 0);
  } finally { f.dom.window.close(); }
});

test('follow-ups stay pinned through acceptance and dequeue, then reconcile in place; slash controls have no preview', () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('Later');
    f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true })); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    assert.equal(submission.mode, 'followUp');
    const pending = f.win.document.querySelector('#messages .user')!;
    assert.ok(pending.closest('.queued-turns'));
    assert.match(pending.textContent!, /Queued.*Later/);
    const label = pending.querySelector('.delivery-status-shimmer')!;
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush();
    assert.match(pending.textContent!, /Queued.*Later/);
    assert.equal(pending.querySelector('.delivery-status-shimmer'), label, 'receipt retains the same label/animation');
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: [], followUp: ['Later'] } });
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 1);
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: [], followUp: [] } });
    assert.ok(pending.closest('.queued-turns'), 'dequeue is not consumption');
    f.snapshot({ busy: true, messages: [{ key: 'actual', role: 'user', content: 'Later' }] });
    assert.equal(f.win.document.querySelector('#messages .user'), pending);
    assert.equal(pending.parentElement?.id, 'messages');
    assert.equal(pending.querySelector('.steering-status'), null);
    f.draft('/name renamed'); f.send(); f.flush();
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 1);
  } finally { f.dom.window.close(); }
});


for (const hidden of [false, true]) for (const outcome of ['rejected', 'unknown', 'cancelled', 'disconnected'] as const) test(`queued ${outcome} becomes an ordinary transcript turn without losing identity (hidden: ${hidden})`, () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('Later');
    f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true })); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    const pending = f.win.document.querySelector('.queued-turns .user')!;
    f.draft('New draft');
    if (hidden) f.view.setActive(false);
    f.receive(outcome === 'disconnected' ? { type: 'sessionDisconnected' } : { type: 'submissionReceipt', id: submission.id, outcome }); f.flush();
    if (hidden) { assert.ok(pending.closest('.queued-turns')); f.view.setActive(true); }
    assert.equal(f.win.document.querySelector('#messages > .user'), pending);
    assert.equal(pending.classList.contains('sticky-turn'), false);
    assert.equal(f.prompt.value, 'New draft');
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 1);
  } finally { f.dom.window.close(); }
});

for (const hidden of [false, true]) test(`queued recovery handles coalesced removal and reset discards the old sticky stack (hidden: ${hidden})`, () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: ['same'], followUp: ['same', 'same'] } });
    assert.equal(f.win.document.querySelectorAll('.queued-turns .user').length, 2);
    if (hidden) f.view.setActive(false);
    f.receive({ type: 'snapshot', state: { busy: true, messages: [], queue: { authoritative: true, steering: ['same'], followUp: [] } } });
    f.receive({ type: 'queueRecovery', steering: [], followUp: ['same', 'same'] }); f.flush();
    if (hidden) f.view.setActive(true);
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 1);
    assert.equal(f.win.document.querySelectorAll('[data-recovery-id]').length, 2);
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: [], followUp: ['old'] } });
    f.receive({ type: 'sessionReset' }); f.flush();
    f.snapshot({ busy: true, messages: [], queue: { authoritative: true, steering: [], followUp: ['new'] } });
    assert.equal(f.win.document.querySelectorAll('.queued-turns .user').length, 1);
    assert.doesNotMatch(f.win.document.querySelector('#messages')!.textContent!, /old/);
  } finally { f.dom.window.close(); }
});

const tickImages = () => new Promise(resolve => setTimeout(resolve, 30));

test('idle image Send follows before preparation and does not override later upward navigation', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const f = fixture({ images: true, imageGate: gate });
  try {
    const s = scrollFixture(f);
    f.snapshot({ sessionUnavailable: false, messages: [] });
    f.paste(); await tickImages(); s.readHistory();
    f.draft('Image caption'); f.send();
    assert.equal(s.pane.scrollTop, 1600, 'local intent precedes image-byte preparation');
    assert.equal(f.sent.filter(message => message.type === 'prompt').length, 0);
    f.flush(); s.readHistory(); release();
    const deadline = Date.now() + 2000;
    while (!f.sent.some(message => message.type === 'prompt') && Date.now() < deadline) await tickImages();
    assert.ok(f.sent.find(message => message.type === 'prompt'));
    f.flush();
    assert.equal(s.pane.scrollTop, 200, 'prepared preview must respect newer reader intent');
  } finally { release(); f.dom.window.close(); }
});

test('paste uses event images once, preserves newer attachments on ack, and never persists base64', async () => {
  const f = fixture({ images: true, clipboard: true });
  try {
    f.snapshot({ sessionUnavailable: false, messages: [] });
    assert.equal(f.paste().defaultPrevented, true); await tickImages();
    assert.equal(f.clipboardReads(), 0);
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 1);
    f.send();
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 0, 'clear the tray before image preparation completes');
    // FileReader completion is asynchronous and may exceed a fixed 30ms while
    // the full suite/build is running. Wait for the actual fixture submission.
    const deadline = Date.now() + 2000;
    while (!f.sent.some(message => message.type === 'prompt') && Date.now() < deadline) await tickImages();
    const submission = f.sent.find(message => message.type === 'prompt');
    assert.ok(submission, 'image preparation should produce a prompt');
    assert.deepEqual(JSON.parse(JSON.stringify(submission.images)), [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }]);
    f.draft('newer'); f.paste(); await tickImages();
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    assert.equal(f.prompt.value, 'newer');
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 1);
    assert.equal(JSON.stringify(f.state()).includes('YWJj'), false);
    assert.equal(f.win.document.querySelector('.image-recovery'), null);
    assert.equal(Object.hasOwn(f.state() as object, 'imageRecovery'), false);
  } finally { f.dom.window.close(); }
});

for (const eventFirst of [false, true]) for (const queuedFallback of [false, true]) test(`normalized image Send reconciles once with ${eventFirst ? 'event before receipt' : 'receipt before event'} (${queuedFallback ? 'queue-to-idle fallback' : 'idle'})`, async () => {
  const f = fixture({ images: true });
  try {
    f.snapshot({ busy: queuedFallback, sessionUnavailable: false, messages: [] });
    f.draft('caption'); f.paste(); await tickImages();
    if (queuedFallback) f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true }));
    else f.send();
    const deadline = Date.now() + 2000;
    while (!f.sent.some(message => message.type === 'prompt') && Date.now() < deadline) await tickImages();
    const submission = f.sent.find(message => message.type === 'prompt')!; assert.ok(submission);
    f.flush();
    const preview = f.win.document.querySelector('#messages .user')!;
    assert.ok(preview.querySelector('.transcript-image'));
    assert.equal(!!preview.closest('.queued-turns'), queuedFallback);
    f.draft('newer draft');
    if (!eventFirst) f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    f.receive({ type: 'submissionMessage', id: submission.id, key: 'normalized-image' });
    const actual = { key: 'normalized-image', role: 'user', content: [{ type: 'text', text: 'caption\n\nPi normalization hint' }, { type: 'image', mimeType: 'image/jpeg', data: 'ZGVm' }] };
    f.snapshot({ busy: true, messages: [actual] });
    if (eventFirst) { f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush(); }
    assert.equal(f.win.document.querySelector('#messages .user'), preview);
    assert.equal(f.win.document.querySelectorAll('#messages .transcript-image img').length, 1);
    assert.equal(preview.closest('.queued-turns'), null);
    assert.equal(preview.querySelector('.steering-status'), null);
    assert.match(preview.textContent!, /Pi normalization hint/);
    f.snapshot({ busy: true, messages: [actual, { key: 'assistant', role: 'assistant', content: 'Continuing work' }] });
    assert.equal(f.win.document.querySelectorAll('#messages .transcript-image img').length, 1);
    assert.equal(f.win.document.querySelector('#messages')!.lastElementChild?.textContent?.trim(), 'Continuing work');
    assert.equal(f.prompt.value, 'newer draft');
    assert.equal(f.sent.filter(message => message.type === 'prompt').length, 1);
  } finally { f.dom.window.close(); }
});

test('image sends capture bytes before cleared drafts release temporary storage, without waiting for receipts', async () => {
  let release!: () => void;
  const f = fixture({ images: true, releaseOnClear: true, imageGate: new Promise<void>(resolve => { release = resolve; }) });
  try {
    f.snapshot({ sessionUnavailable: false, messages: [] });
    f.draft('caption'); f.paste(); await tickImages(); f.send();
    assert.equal(f.submittedPrompts(), 1, 'image Send intent is immediate, not delayed by byte preparation');
    assert.equal(f.prompt.value, '');
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 0);
    assert.equal(f.sent.filter(message => message.type === 'prompt').length, 0);
    f.draft('next message');
    release();
    const deadline = Date.now() + 2000;
    while (!f.sent.some(message => message.type === 'prompt') && Date.now() < deadline) await tickImages();
    const sent = f.sent.find(message => message.type === 'prompt')!;
    assert.ok(sent);
    assert.deepEqual(JSON.parse(JSON.stringify(sent.images)), [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }]);
    f.flush();
    const preview = f.win.document.querySelector('#messages .user')!;
    assert.equal(preview.querySelector('.steering-status'), null);
    assert.ok(preview.querySelector('.transcript-image img'));
    f.snapshot({ messages: [{ key: 'actual-image', role: 'user', content: [{ type: 'text', text: 'caption' }, ...(sent.images as object[])] }] });
    assert.equal(f.win.document.querySelector('#messages .user'), preview);
    assert.equal(preview.querySelector('.steering-status'), null);
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 1);
    assert.equal(f.prompt.value, 'next message');
    f.send();
    assert.equal(f.sent.filter(message => message.type === 'prompt').length, 2, 'image acknowledgement does not block the next send');
  } finally { release(); f.dom.window.close(); }
});

for (const boundary of ['stop', 'sessionReset', 'sessionDisconnected'] as const) test(`image preparation cannot post across ${boundary}`, async () => {
  let release!: () => void;
  const f = fixture({ images: true, imageGate: new Promise<void>(resolve => { release = resolve; }) });
  try {
    f.snapshot({ sessionUnavailable: false, busy: true, messages: [] });
    f.paste(); await tickImages(); f.send();
    if (boundary === 'stop') f.win.document.querySelector<HTMLButtonElement>('#send')!.click();
    else f.receive({ type: boundary });
    f.draft('new draft');
    release(); await tickImages(); await tickImages();
    assert.equal(f.sent.filter(message => message.type === 'prompt').length, 0);
    assert.equal(f.prompt.value, 'new draft');
    assert.equal(f.win.document.querySelector('[data-recovery-id]'), null);
  } finally { release(); f.dom.window.close(); }
});

test('native fallback reads only empty composer pastes; missing image data blocks submission', async () => {
  const f = fixture({ images: true, clipboard: true, missing: true });
  try {
    f.snapshot({ sessionUnavailable: false, messages: [] });
    assert.equal(f.paste(false, 'ordinary text').defaultPrevented, false); await tickImages();
    assert.equal(f.clipboardReads(), 0);
    f.receive({ type: 'deletionLock', locked: true }); f.paste(false); await tickImages();
    assert.equal(f.clipboardReads(), 0);
    f.receive({ type: 'deletionLock', locked: false }); f.paste(false); await tickImages();
    assert.equal(f.clipboardReads(), 1);
    f.send(); await tickImages();
    assert.equal(f.sent.some(message => message.type === 'prompt'), false);
    assert.match(f.win.document.querySelector('#submission-notice')!.textContent!, /missing/);
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 0);
    assert.equal(f.prompt.value, '');
    assert.equal(f.win.document.querySelector('#queue-activity')!.textContent, '');
  } finally { f.dom.window.close(); }
});

for (const outcome of ['rejected', 'unknown'] as const) test(`image send ${outcome} has no backup UI and never replays the attempt`, async () => {
  const f = fixture({ images: true });
  try {
    f.snapshot({ sessionUnavailable: false, messages: [] }); f.draft('caption'); f.paste(); await tickImages(); f.send(); await tickImages();
    const submission = f.sent.find(message => message.type === 'prompt')!;
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome, error: 'Fixture error' });
    assert.equal(f.win.document.querySelector('.image-recovery'), null);
    assert.equal(f.win.document.querySelector('[data-recovery-id]'), null);
    assert.equal(f.prompt.value, '');
    assert.match(f.win.document.querySelector('#submission-notice')!.textContent!, outcome === 'unknown' ? /did not confirm/ : /Fixture error/);
    assert.equal(f.win.document.querySelector("[data-action='dismiss-unknown']"), null);
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 0);
    f.send(); assert.equal(f.sent.filter(message => message.type === 'prompt').length, 1);
  } finally { f.dom.window.close(); }
});

test('unchanged image transcript blocks keep their DOM identity across later streaming snapshots', () => {
  const f = fixture();
  try {
    const user = { key: 'image', role: 'user', content: [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }, { type: 'text', text: 'caption' }] };
    f.snapshot({ messages: [user] });
    const image = f.win.document.querySelector('.transcript-image img');
    f.snapshot({ messages: [{ ...user, content: [user.content[0], { type: 'text', text: 'updated caption' }] }] });
    assert.equal(f.win.document.querySelector('.transcript-image img'), image);
    assert.ok(image);
  } finally { f.dom.window.close(); }
});
