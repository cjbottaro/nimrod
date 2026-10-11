import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { webviewHtml, rendererBundle } from './view-fixture';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';
import { initialConversationState, reduceRpcEvent } from '../src/pi/reducer';

function fixture(options: { images?: boolean; clipboard?: boolean; missing?: boolean } = {}) {
  const dom = new JSDOM(webviewHtml(), { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  let persisted: unknown;
  let clipboardReads = 0;
  const blobs = new Map<string, Blob>();
  let imageId = 0;
  Object.assign(win.URL, { createObjectURL: () => `blob:fixture-${imageId}`, revokeObjectURL: () => {} });
  const attachments = options.images ? {
    put: async (blob: Blob, name: string) => { const image = { id: `image-${++imageId}`, name, mimeType: blob.type, size: blob.size }; blobs.set(image.id, blob); return image; },
    get: async (image: { id: string }) => { if (options.missing) throw new Error('Image draft is missing'); return blobs.get(image.id)!; },
    readClipboard: options.clipboard ? async () => { clipboardReads++; return new win.Blob(['abc'], { type: 'image/png' }); } : undefined,
  } : undefined;
  const frames: FrameRequestCallback[] = [];
  win.requestAnimationFrame = cb => { frames.push(cb); return frames.length; };
  const sent: Record<string, unknown>[] = [];
  let receive: (message: unknown) => void = () => {};
  Object.assign(win, { testHost: { attachments, getState: () => undefined, setState: (state: unknown) => { persisted = state; }, postMessage: (message: Record<string, unknown>) => sent.push(message), onMessage: (listener: typeof receive) => { receive = listener; } } });
  win.eval(rendererBundle() + '\nwindow.testView = PiView.mountPiView(window.testHost);');
  const flush = () => { while (frames.length) frames.shift()!(0); };
  const snapshot = (state: Record<string, unknown>) => { receive({ type: 'snapshot', state }); flush(); };
  const prompt = win.document.querySelector<HTMLTextAreaElement>('#prompt')!;
  const draft = (text: string) => { prompt.value = text; prompt.dispatchEvent(new win.Event('input')); };
  const send = () => prompt.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  const paste = (image = true, text = '') => {
    const event = new win.Event('paste', { cancelable: true, bubbles: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: image ? [{ kind: 'file', type: 'image/png', getAsFile: () => new win.File(['abc'], 'Screenshot.png', { type: 'image/png' }) }] : [], types: text ? ['text/plain'] : [], files: [], getData: () => text } });
    prompt.dispatchEvent(event); return event;
  };
  return { dom, win, sent, receive, snapshot, prompt, draft, send, flush, paste, state: () => persisted, clipboardReads: () => clipboardReads };
}

test('bundled native bridge preserves drafts through pending/unknown/late acknowledgements', () => {
  const f = fixture();
  try {
    f.snapshot({ sessionUnavailable: false, status: 'Ready', messages: [] });
    f.draft('original'); f.send();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    assert.equal(f.prompt.value, 'original');
    f.draft('new draft');
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    assert.equal(f.prompt.value, 'new draft');
    f.send();
    const second = f.sent.filter(m => m.type === 'prompt').at(-1)!;
    f.receive({ type: 'submissionReceipt', id: second.id, outcome: 'unknown' });
    f.send();
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 2);
    assert.equal(f.prompt.value, 'new draft');
  } finally { f.dom.window.close(); }
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

test('steering appears before acknowledgement, remains after live output, and reconciles in place', () => {
  const f = fixture();
  try {
    const assistant = { key: 'assistant', role: 'assistant', content: 'Working' };
    f.snapshot({ busy: true, messages: [assistant] });
    f.prompt.focus();
    f.draft('Please **change direction**'); f.send(); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    const pending = f.win.document.querySelector<HTMLElement>('#messages .user')!;
    assert.match(pending.textContent!, /Sending…/);
    assert.equal(pending.querySelector('strong')?.textContent, 'change direction');
    assert.equal(f.prompt.value, 'Please **change direction**');
    assert.equal(f.win.document.activeElement, f.prompt);
    f.snapshot({ busy: true, messages: [assistant], queue: { authoritative: true, steering: [submission.text], followUp: ['Later'] } });
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 1);
    assert.doesNotMatch(f.win.document.querySelector('#queue-activity')!.textContent!, /change direction/);
    assert.match(f.win.document.querySelector('#queue-activity')!.textContent!, /1 pending.*Later/);
    f.draft('new draft');
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' }); f.flush();
    assert.equal(f.prompt.value, 'new draft');
    assert.match(pending.textContent!, /Pending steering/);
    f.snapshot({ busy: true, messages: [assistant, { key: 'tool', role: 'tool', toolCallId: 't', toolName: 'bash', toolStatus: 'running' }], queue: { authoritative: true, steering: [], followUp: [] } });
    assert.equal(f.win.document.querySelector('#messages')!.lastElementChild, pending);
    f.snapshot({ busy: true, messages: [assistant, { key: 'user', role: 'user', content: [{ type: 'text', text: submission.text }] }] });
    assert.equal(f.win.document.querySelector('#messages .user'), pending);
    assert.equal(pending.querySelector('.steering-status'), null);
    assert.equal(pending.getAttribute('aria-label'), 'User message');
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 1);
    assert.equal(f.win.document.activeElement, f.prompt);
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

for (const outcome of ['rejected', 'unknown'] as const) test(`steering ${outcome} stays visibly marked without clearing or replaying the draft`, () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('uncertain steer'); f.send();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome }); f.flush();
    assert.match(f.win.document.querySelector('#messages .user')!.textContent!, outcome === 'unknown' ? /Acceptance unknown/ : /Not sent/);
    assert.equal(f.prompt.value, 'uncertain steer');
    assert.equal(f.sent.filter(m => m.type === 'prompt').length, 1);
    f.receive({ type: 'sessionReset' }); f.flush();
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 0);
  } finally { f.dom.window.close(); }
});

test('follow-up delivery and slash controls do not acquire optimistic steering turns', () => {
  const f = fixture();
  try {
    f.snapshot({ busy: true, messages: [] });
    f.draft('Later');
    f.prompt.dispatchEvent(new f.win.KeyboardEvent('keydown', { key: 'Enter', altKey: true, bubbles: true, cancelable: true })); f.flush();
    const submission = f.sent.find(m => m.type === 'prompt')!;
    assert.equal(submission.mode, 'followUp');
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 0);
    f.receive({ type: 'submissionReceipt', id: submission.id, outcome: 'accepted' });
    f.draft('/name renamed'); f.send(); f.flush();
    assert.equal(f.win.document.querySelectorAll('#messages .user').length, 0);
  } finally { f.dom.window.close(); }
});


const tickImages = () => new Promise(resolve => setTimeout(resolve, 30));
test('paste uses event images once, preserves newer attachments on ack, and never persists base64', async () => {
  const f = fixture({ images: true, clipboard: true });
  try {
    f.snapshot({ sessionUnavailable: false, messages: [] });
    assert.equal(f.paste().defaultPrevented, true); await tickImages();
    assert.equal(f.clipboardReads(), 0);
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 1);
    f.send();
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
    assert.match(f.win.document.querySelector('.image-recovery')!.textContent!, /1 image/);
  } finally { f.dom.window.close(); }
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
    assert.equal(f.win.document.querySelectorAll('.composer-attachments img').length, 1);
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
