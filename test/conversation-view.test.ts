import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { buildSync } from 'esbuild';
import { webviewHtml } from './view-fixture';
import { createPiViewProjection, piInteraction } from '../src/pi/view-policy';
import { acpInteraction } from '../src/acp/view-policy';
import { sessionActions, type SessionBackend } from '../src/session-backend';
import type { ConversationView, ConversationViewHost, ConversationViewMessage, ConversationViewState } from '../src/conversation-view-host';

const enter = { key: 'Enter', shiftKey: false, altKey: false, isComposing: false, keyCode: 13 };
test('interaction policies preserve Pi semantics without imposing them on ACP', () => {
  const acp = acpInteraction('Fixture', text => text === '/unadvertised' ? 'Not advertised' : undefined);
  assert.equal(piInteraction.keyboardMode(enter, true), 'steer');
  assert.equal(piInteraction.keyboardMode({ ...enter, altKey: true }, true), 'followUp');
  assert.equal(acp.keyboardMode(enter, true), 'normal');
  assert.equal(acp.keyboardMode({ ...enter, shiftKey: true }, true), undefined);
  assert.equal(acp.keyboardMode({ ...enter, isComposing: true }, true), undefined);
  assert.deepEqual(piInteraction.prepare('/mcp', {}), { kind: 'local', message: { type: 'inspectMcp' } });
  assert.deepEqual(acp.prepare('/mcp', {}), { kind: 'request', message: { type: 'prompt' }, preview: false, navigate: true });
  assert.equal(piInteraction.prepare('/compact', { busy: true }).kind, 'reject');
  assert.equal(acp.prepare('/compact', {}).kind, 'request');
  assert.equal(acp.prepare('/unadvertised', {}).kind, 'reject');
  assert.equal(piInteraction.prepare('/name Changed', {}).kind, 'request');
  assert.equal(acp.userText, undefined, 'ACP must not interpret Pi skill markup');
  assert.equal(acp.commands([]).length, 0);
  assert.ok(piInteraction.commands([]).some(command => command.name === 'compact'));
});

test('Pi view projection keeps lazy history and stable content-only UI dependencies', () => {
  const project = createPiViewProjection();
  const state = {
    busy: false, status: 'Ready', sessionUnavailable: false,
    modelControls: { ready: true, changing: false, model: { id: 'fixture', provider: 'local' }, thinkingLevel: 'medium' },
    extensionStatuses: { subagents: '2 running agents', note: 'Agent note' },
    extensionWidgets: { widget: { lines: ['Widget content'] } },
    queue: { steering: [], followUp: [], authoritative: true },
  };
  let reads = 0;
  const first = project({ ...state, get messages() { reads++; return []; } });
  const second = project({ ...state, get messages() { reads++; return []; } });
  assert.equal(reads, 0, 'projection must not materialize TranscriptUpdates history');
  assert.equal(first.statusArea, second.statusArea);
  assert.equal(first.statusArea?.controls, second.statusArea?.controls);
  assert.equal(first.statusArea?.information, second.statusArea?.information);
  assert.equal(first.queue, second.queue);
  assert.equal(first.statusArea?.subagents, '2 running agents', 'preserve the Pi extension’s reported label');
  assert.equal(first.status, 'Idle — ready for your message');
  const duringWork = project({ ...state, busy: true, compacting: true });
  assert.equal(duringWork.statusArea?.controls.find(control => control.id === 'model')?.disabled, false, 'Pi preferences remain available during work/compaction');
  assert.equal(duringWork.inputLocked, true);
  assert.equal(piInteraction.composer(duringWork).stopLabel, 'Cancel compaction');
  void first.messages; assert.equal(reads, 1);
  const disconnected = project({ ...state, sessionUnavailable: true });
  assert.ok(disconnected.statusArea?.controls.every(control => control.disabled));
});

test('session action contributions expose only the owning integration operations', () => {
  const pi: SessionBackend = { kind: 'pi' };
  const acp: SessionBackend = { kind: 'acp', profile: { id: 'fixture', name: 'Fixture', command: 'unused', args: [], env: {} } };
  assert.deepEqual(sessionActions({ backend: pi }).map(action => action.id), ['mcp', 'model', 'thinking']);
  assert.deepEqual(sessionActions({ backend: acp }), []);
});

function fixture() {
  const dom = new JSDOM(webviewHtml(), { runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const frames = new Map<number, FrameRequestCallback>(); let frameId = 0;
  win.requestAnimationFrame = callback => { frames.set(++frameId, callback); return frameId; };
  win.cancelAnimationFrame = id => { frames.delete(id); };
  let receive: (message: ConversationViewMessage) => void = () => {};
  const sent: Record<string, unknown>[] = [];
  const host: ConversationViewHost = {
    interaction: acpInteraction('Fixture', () => undefined),
    getState: () => undefined, setState() {}, postMessage: message => sent.push(message),
    onMessage: listener => { receive = listener; },
  };
  Object.assign(win, { testHost: host });
  const bundle = buildSync({ entryPoints: ['src/conversation-view.ts'], bundle: true, format: 'iife', globalName: 'Conversation', platform: 'browser', write: false }).outputFiles[0].text;
  win.eval(bundle + '\nwindow.testView = Conversation.mountConversationView(window.testHost);');
  const flush = () => { while (frames.size) { const [id, callback] = frames.entries().next().value!; frames.delete(id); callback(0); } };
  const snapshot = (state: ConversationViewState) => { receive({ type: 'snapshot', state }); flush(); };
  const view = (win as unknown as { testView: ConversationView }).testView;
  return { dom, win, sent, snapshot, receive, view, flush };
}

test('empty assistant envelopes stay mounted without visible markers through streaming and hidden catch-up', () => {
  const f = fixture();
  try {
    const document = f.win.document;
    const empty = { key: 'assistant', role: 'assistant', streaming: true, content: [{ type: 'text', text: '' }] };
    const tool = { key: 'tool', role: 'tool', toolCallId: 'call', toolName: 'view',
      toolSource: { backend: 'copilot-sdk' as const, agent: 'copilot' }, toolStatus: 'result' as const, resultOutput: 'file content' };
    let revision = 0;
    const update = (row: typeof empty, incremental: boolean) => {
      f.receive({ type: 'snapshot', state: { messages: [row, tool] },
        transcript: { base: revision, revision: ++revision, ...(incremental ? { rows: [row] } : {}) } });
      f.flush();
    };
    update(empty, false);
    const article = document.querySelector<HTMLElement>('[data-key="assistant"]')!;
    const card = document.querySelector<HTMLDetailsElement>('.tool-card')!;
    assert.equal(article.hidden, true);
    card.open = true;
    const visible = { ...empty, content: [{ type: 'text', text: 'Response' }] };
    update(visible, true);
    assert.equal(document.querySelector('[data-key="assistant"]'), article);
    assert.equal(article.hidden, false);
    assert.match(article.textContent!, /Response/);
    update({ ...empty, streaming: false }, true);
    assert.equal(article.hidden, true, 'authoritative empty content hides previous prose');
    update(visible, false);
    assert.equal(article.hidden, false, 'full snapshots use the same visibility rule');
    f.view.setActive(false);
    update(empty, true);
    assert.equal(article.hidden, false, 'hidden-session painting stays suspended');
    f.view.setActive(true); f.flush();
    assert.equal(article.hidden, true);
    assert.equal(document.querySelector('[data-key="assistant"]'), article);
    assert.equal(document.querySelector('.tool-card'), card);
    assert.equal(card.open, true);
  } finally { f.dom.window.close(); }
});

test('shared controls retain mounted identity, hide unsupported controls and dispatch opaque control IDs', () => {
  const f = fixture();
  try {
    const mode = { id: 'mode', label: 'Ask', title: 'Select approval mode', disabled: false };
    const statusArea = { capabilities: {}, controlsLabel: 'Fixture settings', controls: [mode] };
    f.snapshot({ statusArea, messages: [], sessionUnavailable: false });
    const button = f.win.document.querySelector<HTMLButtonElement>('[data-control-id="mode"]')!;
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('#model')!.hidden, true);
    assert.equal(f.win.document.querySelector<HTMLButtonElement>('#thinking')!.hidden, true);
    assert.equal(f.win.document.querySelector<HTMLElement>('.status-separator')!.hidden, true);
    button.focus(); button.click();
    assert.deepEqual(JSON.parse(JSON.stringify(f.sent.at(-1))), { type: 'selectControl', id: 'mode' });
    f.snapshot({ statusArea: { ...statusArea, controls: [{ ...mode, label: 'Review', disabled: true }] }, messages: [], busy: true });
    assert.equal(f.win.document.querySelector('[data-control-id="mode"]'), button);
    assert.equal(button.disabled, true);
    assert.equal(f.win.document.querySelector('#send')!.getAttribute('aria-label'), 'Stop Fixture');
    f.snapshot({ statusArea: { ...statusArea, controls: [{ ...mode, label: 'Review' }] }, messages: [], busy: false });
    assert.equal(button.disabled, false);
    assert.equal(f.win.document.querySelector('#send')!.getAttribute('aria-label'), 'Send message');
    f.snapshot({ messages: [], statusArea: { ...statusArea, controls: [] } });
    assert.equal(button.hidden, true, 'removed contribution is unsupported, not merely disabled');
    assert.equal(f.win.document.querySelector<HTMLElement>('#status-controls')!.hidden, true);
    f.snapshot({ messages: [], statusArea });
    assert.equal(f.win.document.querySelector('[data-control-id="mode"]'), button);
    assert.equal(button.hidden, false);
  } finally { f.dom.window.close(); }
});

test('status capabilities gate optional surfaces and reconcile revocation during hidden catch-up', () => {
  const f = fixture();
  try {
    const document = f.win.document;
    const statusArea = {
      capabilities: { metrics: { label: 'Fixture usage' }, information: true, subagents: true, queue: true },
      controlsLabel: 'Fixture configuration', controls: [], metrics: '0 context tokens',
      information: [{ label: 'note', text: 'Reported information' }], subagents: '2 running agents',
    };
    const queue = { steering: [], followUp: ['Follow up'], authoritative: true };
    f.snapshot({ messages: [], statusArea, queue });
    assert.equal(document.querySelector('#session-metrics')!.textContent, '0 context tokens');
    assert.equal(document.querySelector('#session-metrics')!.getAttribute('aria-label'), 'Fixture usage');
    assert.equal(document.querySelector<HTMLElement>('#session-metrics')!.hidden, false);
    assert.match(document.querySelector('#extension-activity')!.textContent!, /Reported information/);
    assert.equal(document.querySelector<HTMLElement>('#subagent-activity')!.hidden, false);
    assert.match(document.querySelector('#queue-activity')!.textContent!, /1 pending/);
    f.view.setActive(false);
    f.snapshot({ messages: [], statusArea: { ...statusArea, capabilities: {} }, queue });
    assert.equal(document.querySelector<HTMLElement>('#session-metrics')!.hidden, false, 'hidden sessions defer painting');
    f.view.setActive(true); f.flush();
    for (const id of ['session-metrics', 'extension-activity', 'subagent-activity', 'queue-activity'])
      assert.equal(document.querySelector<HTMLElement>(`#${id}`)!.hidden, true, `${id} must obey capability revocation despite retained data`);
    f.snapshot({ messages: [], statusArea: { ...statusArea, metrics: undefined }, queue });
    assert.equal(document.querySelector<HTMLElement>('#session-metrics')!.hidden, true, 'supported but not reported stays hidden');
    assert.equal(document.querySelector('#session-metrics')!.getAttribute('aria-label'), 'Fixture usage');
    assert.equal(document.querySelector<HTMLElement>('#queue-activity')!.hidden, false);
  } finally { f.dom.window.close(); }
});

test('configuration progress reuses queued-turn layout and one shimmering title without changing confirmed controls or reading history on replacement', () => {
  const f = fixture();
  try {
    const native = [{ key: 'native', role: 'assistant', content: 'Retained answer' }];
    const statusArea = { capabilities: {}, controlsLabel: 'Fixture', controls: [{ id: 'model', label: 'Current model', title: 'Select model', disabled: false }] };
    const operation = { key: 'configuration:fixture', phase: 'queued' as const, title: 'Configuration change', text: 'Model: requested' };
    f.receive({ type: 'snapshot', state: { messages: native, statusArea }, transcript: { base: 0, revision: 1 } }); f.flush();
    const assistant = f.win.document.querySelector('article')!;
    f.receive({ type: 'snapshot', state: { messages: native, statusArea, configurationOperations: [operation] }, transcript: { base: 1, revision: 2, rows: [] } }); f.flush();
    const row = f.win.document.querySelector<HTMLElement>('.message.configuration')!;
    const title = row.querySelector<HTMLElement>('.delivery-status-text')!;
    assert.equal(row.parentElement?.className, 'queued-turns');
    assert.equal(title.textContent, 'Configuration change');
    assert.equal(title.classList.contains('delivery-status-shimmer'), true);
    assert.equal(f.win.document.querySelector('#model')!.textContent, 'Current model');
    let reads = 0;
    const replacement = { ...operation, text: 'Model: latest' };
    f.receive({ type: 'snapshot', state: { get messages() { reads++; return native; }, statusArea, configurationOperations: [replacement] }, transcript: { base: 2, revision: 3, rows: [] } }); f.flush();
    assert.equal(reads, 0, 'same-key progress is an incremental row update');
    assert.equal(f.win.document.querySelector('.message.configuration'), row);
    assert.equal(row.querySelector('.delivery-status-text'), title);
    assert.equal(row.querySelector('.configuration-text')!.textContent, 'Model: latest');
    assert.equal(f.win.document.querySelector('article.assistant'), assistant);
    f.view.setActive(false);
    const complete = { ...replacement, phase: 'completed' as const, title: 'Configuration change' };
    f.receive({ type: 'snapshot', state: { messages: native, statusArea: { ...statusArea, controls: [{ ...statusArea.controls[0], label: 'Latest model' }] }, configurationOperations: [complete] }, transcript: { base: 3, revision: 4, rows: [] } }); f.flush();
    assert.equal(title.classList.contains('delivery-status-shimmer'), true, 'hidden sessions defer painting');
    f.view.setActive(true); f.flush();
    assert.equal(f.win.document.querySelector('.message.configuration'), row);
    assert.equal(row.querySelector('.delivery-status-text'), title);
    assert.equal(title.classList.contains('delivery-status-shimmer'), false);
    assert.equal(row.parentElement?.id, 'messages');
    assert.equal(f.win.document.querySelector('#model')!.textContent, 'Latest model');
    assert.equal(f.sent.some(message => message.type === 'prompt'), false);
    f.receive({ type: 'sessionReset' }); f.flush();
    assert.equal(f.win.document.querySelector('.message.configuration'), null);
  } finally { f.dom.window.close(); }
});

for (const hidden of [false, true]) for (const empty of [false, true]) {
  test(`configuration acceptance anchors before later output with ${hidden ? 'hidden' : 'coalesced'} painting and ${empty ? 'empty' : 'existing'} history`, () => {
    const f = fixture();
    try {
      const document = f.win.document;
      const native = empty ? [] : [{ key: 'native', role: 'assistant', content: 'Existing answer' }];
      const operation = { key: 'configuration:fixture', phase: 'queued' as const, title: 'Configuration change', text: 'Model: requested' };
      f.receive({ type: 'snapshot', state: { messages: native, configurationOperations: [operation] }, transcript: { base: 0, revision: 1 } }); f.flush();
      const row = document.querySelector<HTMLElement>('.message.configuration')!;
      const title = row.querySelector<HTMLElement>('.delivery-status-text')!;
      const prompt = document.querySelector<HTMLTextAreaElement>('#prompt')!;
      prompt.value = 'Keep newer draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
      assert.equal(row.parentElement?.className, 'queued-turns');
      if (hidden) f.view.setActive(false);
      const operations = [{ ...operation, phase: 'completed' as const, title: 'Configuration change' }];
      f.receive({ type: 'snapshot', state: { messages: native, configurationOperations: operations }, transcript: { base: 1, revision: 2, rows: [] } });
      const future = { key: 'future', role: 'assistant', content: 'Later output' };
      f.receive({ type: 'snapshot', state: { messages: [...native, future], configurationOperations: operations }, transcript: { base: 2, revision: 3 } });
      assert.equal(title.classList.contains('delivery-status-shimmer'), true, 'painting is still deferred');
      if (hidden) { f.flush(); f.view.setActive(true); }
      f.flush();
      const keys = () => Array.from(document.querySelectorAll('#messages > article'), node => (node as HTMLElement).dataset.key);
      assert.deepEqual(keys(), [...native.map(message => message.key), operation.key, 'future']);
      assert.equal(document.querySelector('.message.configuration'), row);
      assert.equal(row.querySelector('.delivery-status-text'), title);
      assert.equal(title.classList.contains('delivery-status-shimmer'), false);
      assert.equal(row.classList.contains('sticky-turn'), false);
      assert.equal(row.parentElement?.id, 'messages');
      assert.equal(document.querySelector('.queued-turns'), null);
      // Later dirty updates must remain lazy and leave the accepted row in place.
      const updated = { ...future, content: 'Later output keeps streaming' };
      f.receive({ type: 'snapshot', state: { get messages(): never { return assert.fail('dirty output must not read history'); }, configurationOperations: operations }, transcript: { base: 3, revision: 4, rows: [updated] } }); f.flush();
      assert.deepEqual(keys(), [...native.map(message => message.key), operation.key, 'future']);
      assert.equal(document.querySelector('[data-key="future"]')?.textContent?.includes(updated.content), true);
      assert.equal(prompt.value, 'Keep newer draft');
      assert.equal(document.activeElement, prompt);
      assert.equal(f.sent.some(message => message.type === 'prompt'), false);
    } finally { f.dom.window.close(); }
  });
}

test('metric tooltip-only changes invalidate presentation, retain text nodes and catch up without touching the draft', () => {
  const f = fixture();
  try {
    const statusArea = { capabilities: { metrics: { label: 'Fixture reported usage' } }, controlsLabel: 'Fixture', controls: [],
      metrics: '~$0.123 · 25.5% / 125k', metricsTitle: '12.3 AIC; 31,875 / 125,000 context tokens' };
    f.snapshot({ messages: [], statusArea });
    const metrics = f.win.document.querySelector<HTMLElement>('#session-metrics')!;
    const text = metrics.firstChild;
    const prompt = f.win.document.querySelector<HTMLTextAreaElement>('#prompt')!;
    prompt.value = 'Keep draft'; prompt.dispatchEvent(new f.win.Event('input')); prompt.focus();
    const revised = { ...statusArea, metricsTitle: '12.3001 AIC; 31,876 / 125,000 context tokens' };
    f.snapshot({ messages: [], statusArea: revised });
    assert.equal(metrics.title, revised.metricsTitle);
    assert.equal(metrics.getAttribute('aria-label'), revised.metricsTitle);
    assert.equal(metrics.firstChild, text, 'rounded display text stays mounted when only exact detail changes');
    f.view.setActive(false);
    f.snapshot({ messages: [], statusArea: { ...revised, metricsTitle: 'Latest exact AIC detail' } });
    assert.equal(metrics.title, revised.metricsTitle);
    f.view.setActive(true); f.flush();
    assert.equal(metrics.title, 'Latest exact AIC detail');
    assert.equal(metrics.firstChild, text);
    assert.equal(prompt.value, 'Keep draft');
    assert.equal(f.win.document.activeElement, prompt);
    assert.equal(f.sent.some(message => message.type === 'prompt'), false);
  } finally { f.dom.window.close(); }
});

test('shared raw blocks preserve literal rich-content fallback across hidden catch-up', () => {
  const f = fixture();
  try {
    const messages = [1, 2].map(id => ({ key: `rich-${id}`, role: 'assistant', content: [{ type: 'raw', text: JSON.stringify({ type: 'resource_link', uri: `file:///${id}`, name: '<b>literal</b>' }, null, 2) }] }));
    f.snapshot({ messages: [messages[0]] });
    const first = f.win.document.querySelector('article')!;
    f.view.setActive(false); f.snapshot({ messages });
    assert.equal(f.win.document.querySelectorAll('article').length, 1);
    f.view.setActive(true); f.flush();
    assert.equal(f.win.document.querySelector('article'), first);
    assert.equal(f.win.document.querySelectorAll('article').length, 2);
    assert.equal(f.win.document.querySelector('article b'), null);
    assert.equal(f.win.document.querySelector('article pre')?.textContent, messages[0].content[0].text);
  } finally { f.dom.window.close(); }
});
