import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { permissionOptions, validPermissionDecision } from '../copilot/permissions.mjs';
import { CopilotPermissionPanel } from '../src/copilot/permission-panel';

test('Copilot offers exact, labelled session rules and explicitly saved URL domains', () => {
  for (const [request, expected] of [
    [{ kind: 'read', path: '/project/test' }, { kind: 'approve-for-session', approval: { kind: 'read' } }],
    [{ kind: 'write', fileName: '/project/file' }, { kind: 'approve-for-session', approval: { kind: 'write' } }],
    [{ kind: 'shell', fullCommandText: 'git status', commands: [{ identifier: 'git', readOnly: true }, { identifier: 'git', readOnly: false }] },
      { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: ['git'] } }],
    [{ kind: 'mcp', serverName: 'github', toolName: 'search' },
      { kind: 'approve-for-session', approval: { kind: 'mcp', serverName: 'github', toolName: 'search' } }],
  ] as const) {
    const options = permissionOptions(request);
    assert.deepEqual(options[1].decision, expected);
    assert.ok(validPermissionDecision(request, expected));
    assert.equal(validPermissionDecision(request, { ...expected, extra: true }), false);
    assert.equal(validPermissionDecision(request, { kind: 'approve-for-session' }), false);
  }
  const read = permissionOptions({ kind: 'read', path: '/project/file' });
  assert.match(read[1].label, /all file reads this session/); // Not a directory-confined grant.
  assert.match(permissionOptions({ kind: 'shell', fullCommandText: 'git status', commands: [{ identifier: 'git' }] })[1].label, /any arguments/);
  const url = { kind: 'url', url: 'https://example.test/docs' };
  const options = permissionOptions(url);
  assert.deepEqual(options[1].decision, { kind: 'approve-for-session', domain: 'example.test' });
  assert.deepEqual(options[2].decision, { kind: 'approve-permanently', domain: 'example.test' });
  assert.match(options[2].label, /saved across sessions/);
  assert.equal(validPermissionDecision(url, { kind: 'approve-permanently', domain: 'other.test' }), false);
  assert.equal(validPermissionDecision(url, { kind: 'approve-for-session', approval: { kind: 'read' } }), false);
  assert.equal(validPermissionDecision({ kind: 'read', path: '/project/file' }, { kind: 'approve-for-session', approval: { kind: 'write' } }), false);
  assert.equal(validPermissionDecision({ kind: 'mcp', serverName: 'github', toolName: 'search' },
    { kind: 'approve-for-session', approval: { kind: 'mcp', serverName: 'github', toolName: null } }), false);
});

test('managed, elevated, unknown and malformed scopes retain only explicit one-time approval', () => {
  for (const request of [
    { kind: 'read', managedApprovalRequired: true }, { kind: 'url', url: 'https://example.test/', requestSandboxBypass: true },
    { kind: 'future' }, { kind: 'read' }, { kind: 'write' }, { kind: 'shell', commands: [] }, { kind: 'shell', commands: [{ identifier: '' }] },
    { kind: 'url', url: 'javascript:literal' }, { kind: 'url', url: 'https://name:secret@example.test/' },
  ]) {
    assert.equal(permissionOptions(request).length, 1);
    assert.equal(validPermissionDecision(request, { kind: 'approve-for-session', approval: { kind: 'read' } }), false);
    assert.equal(validPermissionDecision(request, { kind: 'approve-permanently', domain: 'example.test' }), false);
    assert.equal(validPermissionDecision(request, { kind: 'approve-once', approvedInteractively: true }), true);
    assert.equal(validPermissionDecision(request, { kind: 'reject', feedback: 'Use another approach' }), true);
    assert.equal(validPermissionDecision(request, { kind: 'user-not-available' }), true);
    for (const value of [{ kind: 'approved' }, { kind: 'approve-once' }, { kind: 'reject', feedback: 42 }, { kind: 'reject', approval: {} }])
      assert.equal(validPermissionDecision(request, value), false);
  }
});

function fixture() {
  const dom = new JSDOM('<body><main></main><textarea id="draft">keep me</textarea></body>');
  const document = dom.window.document, host = document.querySelector('main')!, draft = document.querySelector<HTMLTextAreaElement>('#draft')!;
  let selected = true, pending = 0, releases = 0;
  const panel = new CopilotPermissionPanel(document, host, '/project', () => selected,
    delta => { pending += delta; }, () => { releases++; draft.focus(); });
  const controls = () => [...host.querySelectorAll<HTMLButtonElement>('.copilot-permission-body:not([hidden]) button')];
  const click = (label: string) => { const button = controls().find(control => control.textContent === label); assert.ok(button, label); button.click(); };
  draft.focus();
  return { dom, document, host, draft, panel, controls, click, setSelected(value: boolean) { selected = value; }, pending: () => pending, releases: () => releases };
}

test('one FIFO panel bounds simultaneous requests, preserves mounted details/draft/focus and settles exact choices', async () => {
  const f = fixture(), first = new AbortController(), second = new AbortController();
  try {
    const one = f.panel.request({ kind: 'read', path: '/project/test', intention: 'Search in directory: /project/test' }, first.signal);
    const body = f.host.querySelector('.copilot-permission-body')!, raw = body.querySelector<HTMLDetailsElement>('.acp-permission-raw')!;
    raw.open = true;
    const two = f.panel.request({ kind: 'read', path: '/project/src/file' }, second.signal);
    assert.equal(f.host.querySelectorAll('.copilot-permission-panel').length, 1);
    assert.equal(f.host.querySelectorAll('.copilot-permission-body:not([hidden])').length, 1);
    assert.equal(f.host.querySelector('.copilot-permission-body'), body); assert.equal(raw.open, true);
    assert.match(f.host.querySelector('.copilot-permission-header')!.textContent!, /2 pending/);
    assert.match(f.host.querySelector('.copilot-permission-queue')!.textContent!, /src\/file/);
    assert.equal(f.document.activeElement, f.draft); assert.equal(f.draft.value, 'keep me');
    assert.equal(f.host.textContent!.includes('Cancel request'), false);
    assert.equal(f.pending(), 2);
    f.controls()[0].focus(); f.click('Allow all file reads this session');
    assert.deepEqual(await one, { kind: 'approve-for-session', approval: { kind: 'read' } });
    assert.equal(f.pending(), 1); assert.equal(f.document.activeElement, f.controls()[0]);
    const feedback = f.host.querySelector<HTMLTextAreaElement>('.copilot-permission-body:not([hidden]) textarea')!;
    feedback.value = 'Use a different file'; feedback.focus(); f.click('Send denial');
    assert.deepEqual(await two, { kind: 'reject', feedback: 'Use a different file' });
    assert.equal(f.pending(), 0); assert.equal(f.host.childElementCount, 0);
    assert.equal(f.document.activeElement, f.draft); assert.equal(f.releases(), 1);
  } finally { first.abort(); second.abort(); f.dom.window.close(); }
});

test('background/obscured requests cannot decide; cancellation removes all entries without approving or stealing focus', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const choices = [f.panel.request({ kind: 'read', path: '/project/one' }, owner.signal),
      f.panel.request({ kind: 'read', path: '/project/two' }, owner.signal)];
    f.setSelected(false); f.click('Allow once'); f.click('Deny');
    assert.equal(f.pending(), 2); assert.equal(f.document.activeElement, f.draft);
    owner.abort();
    assert.deepEqual(await Promise.all(choices), [undefined, undefined]);
    assert.equal(f.pending(), 0); assert.equal(f.host.childElementCount, 0); assert.equal(f.releases(), 0);
    assert.equal(f.document.activeElement, f.draft);
    assert.equal(await f.panel.request({ kind: 'read' }, owner.signal), undefined);
  } finally { owner.abort(); f.dom.window.close(); }
});

test('separate conversations never share permission queues', async () => {
  const a = fixture(), b = fixture(), owner = new AbortController();
  try {
    const one = a.panel.request({ kind: 'read', path: '/a' }, owner.signal);
    const two = b.panel.request({ kind: 'url', url: 'https://example.test/' }, owner.signal);
    a.click('Deny'); assert.deepEqual(await one, { kind: 'reject' }); assert.equal(b.pending(), 1);
    b.click('Always allow domain: example.test (saved across sessions)');
    assert.deepEqual(await two, { kind: 'approve-permanently', domain: 'example.test' });
  } finally { owner.abort(); a.dom.window.close(); b.dom.window.close(); }
});
