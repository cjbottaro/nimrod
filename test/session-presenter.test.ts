import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { SessionPresenter, type PresentedSession } from '../src/session-presenter';

function fixture() {
  const dom = new JSDOM('<button id="empty">All</button><dialog><input></dialog><div id="identity"><span id="name"></span></div><span id="badge"></span><main hidden></main>');
  const document = dom.window.document;
  const conversation = document.querySelector('main')!;
  const identity = document.querySelector<HTMLElement>('#identity')!, name = document.querySelector<HTMLElement>('#name')!, badge = document.querySelector<HTMLElement>('#badge')!;
  const sessions: PresentedSession[] = [], events: string[] = [];
  let switches = 0, controls = 0;
  const presenter = new SessionPresenter({ sessions: () => sessions, conversation, identity, name, badge,
    emptyFocus: () => document.querySelector<HTMLElement>('#empty')!,
    switched: () => { switches++; }, controlsChanged: () => { controls++; },
  });
  const session = (title: string): PresentedSession => {
    const root = document.createElement('section'), row = document.createElement('button');
    root.hidden = true; root.innerHTML = '<textarea></textarea>';
    conversation.append(root); document.body.append(row);
    const result: PresentedSession = {
      title, root, row, closing: false, reloading: false, deleting: false,
      view: { setActive: active => { events.push(`${title}:view:${active}`); } },
      notices: { setActive: active => { events.push(`${title}:notices:${active}`); } },
      integration: {
        interactions: { setActive: active => { events.push(`${title}:interactions:${active}`); }, dispose() {} },
        presentation: { snapshot: () => ({ harnessLabel: 'Fixture', badge: result.title, badgeTitle: `${result.title} mode`,
          busy: false, working: false, pending: false, compacting: false, queuePending: false, destructiveBusy: false }) },
      },
    };
    sessions.push(result); return result;
  };
  return { dom, document, presenter, session, sessions, events, conversation, identity, name, badge,
    switches: () => switches, controls: () => controls };
}

// The current target cannot be assigned by shell callers, even to clear it.
function readonlyContract(presenter: SessionPresenter<PresentedSession>): void {
  // @ts-expect-error Presentation changes must pass through show/remove.
  presenter.current = undefined;
}
void readonlyContract;

test('presentation transitions update identity, active ports, visibility and row selection together', () => {
  const f = fixture();
  try {
    const a = f.session('A'), b = f.session('B');
    f.presenter.show(a);
    assert.equal(f.presenter.current, a);
    assert.equal(f.conversation.hidden, false); assert.equal(f.identity.hidden, false);
    assert.equal(f.name.textContent, 'A'); assert.equal(f.identity.title, 'A');
    assert.equal(f.badge.textContent, 'A'); assert.equal(f.badge.title, 'A mode');
    assert.equal(a.root.hidden, false); assert.equal(a.root.inert, false); assert.equal(a.row.getAttribute('aria-current'), 'true');
    assert.equal(b.root.hidden, true); assert.equal(b.root.inert, true); assert.equal(b.row.getAttribute('aria-current'), 'false');
    f.events.length = 0;
    f.presenter.show(b);
    assert.deepEqual(f.events, ['A:interactions:false', 'A:notices:false', 'A:view:false', 'B:interactions:true', 'B:view:true', 'B:notices:true']);
    assert.equal(a.root.hidden, true); assert.equal(a.root.inert, true); assert.equal(a.row.getAttribute('aria-current'), 'false');
    assert.equal(b.root.hidden, false); assert.equal(b.root.inert, false); assert.equal(b.row.getAttribute('aria-current'), 'true');
    assert.equal(f.name.textContent, 'B'); assert.equal(f.switches(), 2);
    f.presenter.show(undefined);
    assert.equal(f.presenter.current, undefined); assert.equal(f.conversation.hidden, true);
    assert.equal(f.identity.hidden, true); assert.equal(f.name.textContent, ''); assert.equal(f.identity.title, '');
    assert.equal(f.badge.textContent, ''); assert.equal(f.badge.title, '');
    assert.equal(b.root.hidden, true); assert.equal(b.root.inert, true); assert.equal(b.row.getAttribute('aria-current'), 'false');
    assert.equal(f.controls(), 3);
  } finally { f.dom.window.close(); }
});

test('same-target refresh updates identity and lifecycle state without activation, navigation or focus effects', () => {
  const f = fixture();
  try {
    const a = f.session('A'), b = f.session('B');
    f.presenter.show(a); f.events.length = 0;
    const prompt = a.root.querySelector('textarea')!; prompt.value = 'Draft'; prompt.focus();
    a.title = 'Renamed'; a.reloading = true;
    f.presenter.refresh(a);
    assert.equal(f.name.textContent, 'Renamed'); assert.equal(f.identity.title, 'Renamed');
    assert.equal(f.badge.textContent, 'Renamed'); assert.equal(f.badge.title, 'Renamed mode');
    assert.equal(a.root.inert, true);
    a.reloading = false; f.presenter.show(a);
    assert.equal(a.root.inert, false); assert.equal(f.document.activeElement, prompt); assert.equal(prompt.value, 'Draft');
    b.title = 'Background'; f.presenter.refresh(b);
    assert.equal(f.name.textContent, 'Renamed'); assert.deepEqual(f.events, []); assert.equal(f.switches(), 1);
  } finally { f.dom.window.close(); }
});

test('removing a background target preserves presentation; removing the presented target deactivates it before disposal', () => {
  const f = fixture();
  try {
    const a = f.session('A'), b = f.session('B'); f.presenter.show(a); f.events.length = 0;
    f.sessions.splice(f.sessions.indexOf(b), 1); f.presenter.remove(b);
    assert.equal(f.presenter.current, a); assert.equal(f.name.textContent, 'A'); assert.deepEqual(f.events, []);
    f.sessions.splice(f.sessions.indexOf(a), 1); f.presenter.remove(a);
    assert.deepEqual(f.events, ['A:interactions:false', 'A:notices:false', 'A:view:false']);
    assert.equal(f.presenter.current, undefined); assert.equal(f.identity.hidden, true); assert.equal(f.name.textContent, '');
    assert.equal(a.root.hidden, true); assert.equal(a.root.inert, true);
    const switches = f.switches(); f.presenter.show(undefined);
    assert.equal(f.switches(), switches); assert.equal(f.conversation.hidden, true); assert.equal(f.badge.title, '');
  } finally { f.dom.window.close(); }
});

test('hiding saves composer focus and moves it to the filter only when no dialog is open', () => {
  for (const modal of [false, true]) {
    const f = fixture();
    try {
      const a = f.session('A'); f.presenter.show(a);
      const prompt = a.root.querySelector('textarea')!; prompt.focus();
      if (modal) f.document.querySelector('dialog')!.setAttribute('open', '');
      f.presenter.show(undefined);
      assert.equal(a.focus, prompt);
      assert.equal(f.document.activeElement, modal ? prompt : f.document.querySelector('#empty'));
      assert.equal(f.identity.hidden, true);
    } finally { f.dom.window.close(); }
  }
});
