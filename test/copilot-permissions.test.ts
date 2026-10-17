import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { permissionOptions, validPermissionDecision } from '../copilot/permissions.mjs';
import { CopilotPermissionInteraction } from '../src/copilot/permission-interaction';
import { readFileSync } from 'node:fs';
import { installCommandPalette } from '../src/command-palette';
import { installApplicationNotices, NoticeStore } from '../src/application-notices';
import { stubDialogs } from './dialog-fixture';

test('Copilot offers exact, labelled session rules and explicitly saved URL domains', () => {
  for (const [request, expected] of [
    [{ kind: 'read', path: '/project/test' }, { kind: 'approve-for-session', approval: { kind: 'read' } }],
    [{ kind: 'write', fileName: '/project/file', canOfferSessionApproval: true }, { kind: 'approve-for-session', approval: { kind: 'write' } }],
    [{ kind: 'shell', canOfferSessionApproval: true, fullCommandText: 'git status', commands: [{ identifier: 'git', readOnly: true }, { identifier: 'git', readOnly: false }] },
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
  const shell = permissionOptions({ kind: 'shell', canOfferSessionApproval: true, fullCommandText: 'git status', commands: [{ identifier: 'git' }] })[1];
  assert.equal(shell.label, 'Allow for this session'); assert.equal(shell.detail, 'Approval scope: git');
  assert.doesNotMatch(JSON.stringify(shell), /any arguments/);
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

test('shell/write session approval requires an explicit capability, including in the bridge validator', () => {
  for (const capability of [false, undefined, null, 'true', 1]) {
    for (const request of [
      { kind: 'shell', fullCommandText: 'git worktree add /fixture/tree', commands: [{ identifier: 'git worktree add /fixture/tree' }],
        commandSegments: [{ identifier: 'git worktree', fullCommandText: 'git worktree add /fixture/tree' }], canOfferSessionApproval: capability },
      { kind: 'write', fileName: '/fixture/file', canOfferSessionApproval: capability },
    ]) {
      assert.deepEqual(permissionOptions(request).map(option => option.id), ['once']);
      assert.equal(validPermissionDecision(request, { kind: 'approve-for-session', approval: request.kind === 'write'
        ? { kind: 'write' } : { kind: 'commands', commandIdentifiers: ['git worktree add /fixture/tree'] } }), false);
      assert.equal(validPermissionDecision(request, { kind: 'approve-once', approvedInteractively: true }), true);
      assert.equal(validPermissionDecision(request, { kind: 'reject' }), true);
    }
  }
});

test('shell presentation uses parsed context but preserves literal approval scopes and conservative fallbacks', () => {
  const full = 'git worktree add /fixture/tree -b task/example';
  const request = { kind: 'shell', canOfferSessionApproval: true, fullCommandText: full,
    commands: [{ identifier: full }, { identifier: full }],
    commandSegments: [{ identifier: 'git worktree', fullCommandText: full }] };
  const option = permissionOptions(request)[1];
  assert.equal(option.label, 'Allow for this session');
  assert.equal(option.detail, `Commands: git worktree\nApproval scope: ${full}`);
  assert.deepEqual(option.decision, { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: [full] } });
  assert.equal(validPermissionDecision(request, { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: ['git worktree'] } }), false);
  for (const commandSegments of [undefined, [], [{ identifier: '' }], [{ identifier: 'git' }, null]]) {
    const fallback = permissionOptions({ ...request, commandSegments })[1];
    assert.equal(fallback.detail, `Approval scope: ${full}`); assert.deepEqual(fallback.decision, option.decision);
  }
  const compound = permissionOptions({ kind: 'shell', canOfferSessionApproval: true, fullCommandText: 'cd /fixture && rg pattern .',
    commands: [{ identifier: 'cd /fixture && rg pattern .' }],
    commandSegments: [{ identifier: 'cd' }, { identifier: 'rg' }, { identifier: 'rg' }] })[1];
  assert.equal(compound.detail, 'Commands: cd, rg\nApproval scope: cd /fixture && rg pattern .');
  const multiple = permissionOptions({ ...request, commands: [{ identifier: 'git status' }, { identifier: 'git diff' }], commandSegments: [] })[1];
  assert.equal(multiple.detail, 'Approval scopes:\n• git status\n• git diff');
  assert.equal(permissionOptions({ kind: 'shell', canOfferSessionApproval: true, fullCommandText: full,
    commands: [], commandSegments: request.commandSegments }).length, 1, 'segments alone cannot manufacture a grant');
});

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture() {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window, document = win.document; stubDialogs(win);
  const host = document.createElement('section'); document.body.append(host);
  const draft = document.createElement('textarea'); draft.value = 'keep me'; host.append(draft);
  const dialog = document.querySelector<HTMLDialogElement>('#command-palette')!;
  const child = document.querySelector<HTMLDialogElement>('#host-dialog')!;
  const input = document.querySelector<HTMLInputElement>('#palette-input')!;
  const feedback = document.querySelector<HTMLTextAreaElement>('#host-dialog-input')!;
  let selected = true, pending = 0, opens = 0, closes = 0;
  const show = dialog.showModal.bind(dialog), close = dialog.close.bind(dialog);
  dialog.showModal = () => { opens++; show(); }; dialog.close = value => { closes++; close(value); };
  const palette = installCommandPalette(win as unknown as Window, dialog, {
    canOpen: () => true, commands: () => [], sessions: async () => ({ items: [] }), openSessions: () => ({ items: [] }),
  });
  const store = new NoticeStore(), notices = installApplicationNotices(win as unknown as Window, store, { owner: 'fixture', container: host });
  notices.setActive(true);
  const interaction = new CopilotPermissionInteraction({
    document, project: '/project',
    canPresent: () => selected && !document.querySelector('dialog[open]:not(#command-palette)'),
    start: dismiss => palette.startRetainedSelection('Copilot permission', dismiss),
    feedback: () => new Promise(resolve => {
      child.returnValue = ''; feedback.value = '';
      child.addEventListener('close', () => resolve(child.returnValue === 'ok' ? feedback.value : undefined), { once: true });
      child.showModal(); feedback.focus();
    }),
    cancelFeedback: () => { if (child.open) child.close('cancel'); },
    changed: delta => { pending += delta; },
    banner: (count, review) => {
      if (!count) store.resolve('permission');
      else store.report({ id: 'permission', owner: 'fixture', operation: 'Permissions', message: `Waiting for permission · ${count} requests`,
        presentation: 'pending-action', severity: 'info', dismissible: false, actions: [{ label: 'Review requests', run: review }] });
    },
    error: message => { throw new Error(message); },
  });
  const click = (label: string) => {
    const row = [...document.querySelectorAll<HTMLElement>('#palette-list > [role=option]')]
      .find(row => row.querySelector('.palette-item-label')?.textContent === label);
    assert.ok(row, label); row.click();
  };
  const key = (key: string, extra: KeyboardEventInit = {}) => input.dispatchEvent(new win.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...extra }));
  draft.focus();
  return { dom, win, document, host, draft, dialog, child, input, feedback, interaction, palette, notices, store, click, key,
    counts: () => ({ pending, opens, closes }),
    query(value: string) { input.value = value; input.dispatchEvent(new win.Event('input')); },
    setSelected(value: boolean) { selected = value; notices.setActive(value); interaction.setActive(value); },
    dispose() { interaction.dispose(); palette.dispose(); notices.dispose(); win.close(); },
  };
}

test('sequential permissions retain one modal, details/query on arrivals and exact decisions; dismissing only presentation retains the queue', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const one = f.interaction.request({ kind: 'read', path: '/project/test', intention: 'Search in directory: /project/test' }, owner.signal);
    const raw = f.document.querySelector<HTMLDetailsElement>('#palette-context .acp-permission-raw')!; raw.open = true;
    f.query('Allow');
    const selected = f.document.querySelector('#palette-list > [aria-selected=true]');
    const two = f.interaction.request({ kind: 'read', path: '/project/src/file' }, owner.signal);
    assert.deepEqual(f.counts(), { pending: 2, opens: 1, closes: 0 });
    assert.equal(f.input.value, 'Allow'); assert.equal(raw.open, true);
    assert.equal(f.document.querySelector('#palette-list > [aria-selected=true]'), selected);
    assert.equal(f.document.querySelector('#palette-remaining')!.textContent, '1 more');
    f.click('Allow all file reads this session');
    assert.deepEqual(await one, { kind: 'approve-for-session', approval: { kind: 'read' } });
    assert.deepEqual(f.counts(), { pending: 1, opens: 1, closes: 0 });
    assert.match(f.document.querySelector('#palette-context')!.textContent!, /src\/file/);
    assert.equal(f.input.value, '');
    f.key('Escape');
    assert.deepEqual(f.counts(), { pending: 1, opens: 1, closes: 1 });
    assert.equal(f.document.activeElement, f.draft); assert.equal(f.draft.value, 'keep me');
    assert.equal(f.notices.strip.querySelector('[data-dismiss]'), null);
    const three = f.interaction.request({ kind: 'url', url: 'https://example.test/' }, owner.signal);
    assert.equal(f.dialog.open, false, 'new arrivals never reopen an explicitly dismissed picker');
    f.notices.strip.querySelector<HTMLButtonElement>('button')!.click(); await tick();
    assert.equal(f.dialog.open, true);
    f.click('Deny'); assert.deepEqual(await two, { kind: 'reject' });
    f.click('Always allow domain: example.test (saved across sessions)');
    assert.deepEqual(await three, { kind: 'approve-permanently', domain: 'example.test' });
    assert.deepEqual(f.counts(), { pending: 0, opens: 2, closes: 2 });
    assert.equal(f.notices.strip.hidden, true); assert.equal(f.document.activeElement, f.draft);
  } finally { owner.abort(); f.dispose(); }
});

test('shell scope details are searchable picker metadata and never change the approved identifiers', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const full = 'git worktree add /fixture/tree -b task/example';
    const request = { kind: 'shell', canOfferSessionApproval: true, fullCommandText: full,
      commands: [{ identifier: full }], commandSegments: [{ identifier: 'git worktree', fullCommandText: full }] };
    const result = f.interaction.request(request, owner.signal);
    const row = [...f.document.querySelectorAll('#palette-list > [role=option]')]
      .find(row => row.querySelector('.palette-item-label')?.textContent === 'Allow for this session')!;
    assert.ok(row);
    assert.equal(row.querySelector('.palette-item-label')!.textContent, 'Allow for this session');
    assert.equal(row.querySelector('.palette-item-description')!.textContent, `Commands: git worktree\nApproval scope: ${full}`);
    f.query('git worktree'); assert.equal(f.document.querySelectorAll('#palette-list > [role=option]').length, 1);
    f.click('Allow for this session');
    assert.deepEqual(await result, { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: [full] } });
    const disabled = f.interaction.request({ ...request, canOfferSessionApproval: false }, owner.signal);
    assert.doesNotMatch(f.document.querySelector('#palette-list')!.textContent!, /Allow for this session/);
    f.click('Deny'); assert.deepEqual(await disabled, { kind: 'reject' });
  } finally { owner.abort(); f.dispose(); }
});

test('feedback nests over the retained picker; cancel returns without answering, submit advances without closing the parent', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    const one = f.interaction.request({ kind: 'read', path: '/project/one' }, owner.signal);
    const two = f.interaction.request({ kind: 'read', path: '/project/two' }, owner.signal);
    f.click('Deny with feedback…');
    assert.equal(f.child.open, true); assert.equal(f.dialog.open, true); assert.equal(f.document.activeElement, f.feedback);
    const context = f.document.querySelector('#palette-context')!.firstElementChild;
    const three = f.interaction.request({ kind: 'read', path: '/project/three' }, owner.signal);
    assert.equal(f.document.activeElement, f.feedback); assert.equal(f.document.querySelector('#palette-context')!.firstElementChild, context);
    f.child.close('cancel'); await tick();
    assert.equal(f.dialog.open, true); assert.equal(f.document.activeElement, f.input); assert.equal(f.interaction.pendingCount, 3);
    assert.match(f.document.querySelector('#palette-list > [aria-selected=true]')!.textContent!, /Deny with feedback/);
    f.click('Deny with feedback…'); f.feedback.value = 'Use another file'; f.child.close('ok'); await tick();
    assert.deepEqual(await one, { kind: 'reject', feedback: 'Use another file' });
    assert.equal(f.dialog.open, true); assert.equal(f.child.open, false); assert.equal(f.counts().closes, 0);
    owner.abort(); assert.deepEqual(await Promise.all([two, three]), [undefined, undefined]);
    assert.equal(f.dialog.open, false); assert.equal(f.notices.strip.hidden, true);
  } finally { owner.abort(); f.dispose(); }
});

test('background/obscured sessions never replace dialogs and inactive or late choices cannot approve', async () => {
  const f = fixture(), owner = new AbortController();
  try {
    f.setSelected(false);
    const one = f.interaction.request({ kind: 'read', path: '/project/one' }, owner.signal);
    assert.equal(f.dialog.open, false); assert.equal(f.document.activeElement, f.draft);
    f.child.showModal();
    f.setSelected(true); assert.equal(f.dialog.open, false, 'existing modal keeps priority');
    f.child.close('cancel'); assert.equal(f.dialog.open, false, 'closing another dialog does not summon the picker');
    f.interaction.review(); assert.equal(f.dialog.open, true);
    const stale = f.document.querySelector<HTMLElement>('#palette-list > [role=option]')!;
    f.setSelected(false); assert.equal(f.dialog.open, false);
    stale.click(); assert.equal(f.interaction.pendingCount, 1);
    owner.abort(); assert.equal(await one, undefined);
    assert.equal(f.notices.strip.hidden, true); assert.equal(f.counts().pending, 0);
  } finally { owner.abort(); f.dispose(); }
});

test('aborting while feedback is open closes both layers and late feedback cannot answer a later request', async () => {
  const f = fixture(), owner = new AbortController(), newer = new AbortController();
  try {
    const one = f.interaction.request({ kind: 'read', path: '/project/old' }, owner.signal);
    f.click('Deny with feedback…'); owner.abort();
    assert.equal(await one, undefined); assert.equal(f.dialog.open, false); assert.equal(f.child.open, false);
    const two = f.interaction.request({ kind: 'read', path: '/project/new' }, newer.signal);
    await tick();
    assert.equal(f.interaction.pendingCount, 1); assert.equal(f.child.open, false);
    f.click('Allow once'); assert.deepEqual(await two, { kind: 'approve-once', approvedInteractively: true });
    assert.equal(f.counts().pending, 0);
  } finally { owner.abort(); newer.abort(); f.dispose(); }
});
