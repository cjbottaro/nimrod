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
