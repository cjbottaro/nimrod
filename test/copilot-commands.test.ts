import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { copilotCommands, copilotSlashCommands, parseCopilotCommand } from '../src/copilot/commands';
import { CopilotSession, type CopilotSessionUi } from '../src/copilot/session';
import type { BridgeRequest } from '../src/copilot/connection';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import { copilotInteraction } from '../src/copilot/view-policy';
import { installSlashCompletion } from '../src/pi/slash-completion';

const catalog = [{ name: 'permissions', aliases: ['perms'], description: 'Manage permissions', kind: 'builtin', allowDuringAgentExecution: true,
  input: { hint: 'Choose a permission operation', choices: [{ name: 'show', description: 'Show permissions' }, { name: 'reset', description: 'Clear approvals' }] } }];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const resultOnlyCatalog = catalog.map(({ input: _input, ...command }) => command);
async function fixture(commandChoice?: CopilotSessionUi['commandChoice'], commands: unknown[] = catalog) {
  const sent: BridgeRequest[] = [], published: ConversationViewMessage[] = [], notices: string[] = [];
  const session = new CopilotSession(async request => { sent.push(request); }, {
    publish: message => published.push(message), changed() {}, identified() {}, disconnected() {}, completed() { throw new Error('Local command must not announce a completed agent turn'); },
    notice: message => notices.push(message), decision: async () => undefined, commandChoice,
  });
  const reply = (result: unknown, method = 'command') => {
    const request = [...sent].reverse().find(request => request.method === method)!;
    assert.ok(request); session.receive({ kind: 'result', id: request.id, result });
  };
  const ready = session.initialize(); reply(null, 'initialize'); await flush();
  session.receive({ kind: 'connected', sessionId: 'fixture', events: [], models: [], model: {} });
  session.receive({ kind: 'commands', commands }); reply(null, 'connect'); await ready;
  return { session, sent, published, notices, reply };
}

test('SDK command metadata retains aliases, hints and choices, without synthetic GUI commands', () => {
  const commands = copilotSlashCommands([...catalog, { name: 'bad/name', kind: 'builtin' }]);
  assert.deepEqual(commands.map(command => command.name), ['permissions', 'perms']);
  assert.equal(commands[1].input?.choices?.[0].description, 'Show permissions');
  assert.deepEqual(copilotCommands(undefined), []);
  assert.deepEqual(parseCopilotCommand('/perms show  literal\nmore '), { name: 'perms', input: 'show  literal\nmore ' });
  assert.deepEqual(parseCopilotCommand('/permissions'), { name: 'permissions' });
  const interaction = copilotInteraction(() => undefined);
  assert.deepEqual(interaction.prepare('/permissions', {}), { kind: 'request', message: { type: 'command' }, preview: false, navigate: false });
  assert.equal(interaction.prepare('Hello', {}).kind, 'request');
});

test('argument suggestions insert text, preserve raw arguments, and blank Enter can execute the parent command', () => {
  const dom = new JSDOM('<textarea></textarea><div id="suggestions" role="listbox"></div>', { pretendToBeVisual: true });
  try {
    const input = dom.window.document.querySelector('textarea')!, list = dom.window.document.querySelector<HTMLElement>('#suggestions')!;
    const inserted: string[] = [];
    const completion = installSlashCompletion(input, list, value => inserted.push(value), copilotSlashCommands);
    completion.setCommands(catalog); input.focus();
    const type = (value: string) => { input.value = value; input.setSelectionRange(value.length, value.length); input.dispatchEvent(new dom.window.Event('input')); };
    const key = (value: string, init: KeyboardEventInit = {}) => {
      const event = new dom.window.KeyboardEvent('keydown', { key: value, bubbles: true, cancelable: true, ...init });
      input.dispatchEvent(event); return event;
    };
    type('/perms ');
    assert.match(list.textContent!, /Show permissions/); assert.match(list.textContent!, /Choose a permission operation/);
    assert.equal(key('Enter').defaultPrevented, false, 'bare command remains executable instead of selecting its first argument');
    type('/perms sh'); key('Tab');
    assert.equal(input.value, '/perms show '); assert.deepEqual(inserted, ['/perms show ']);
    type('/permissions '); key('ArrowDown'); assert.equal(key('Enter').defaultPrevented, true);
    type('/permissions '); key('Escape'); completion.refresh(); assert.equal(list.hidden, true);
    type('/permissions sh'); assert.equal(key('Enter', { isComposing: true }).defaultPrevented, false);
    type('/permissions something else'); assert.equal(key('Enter').defaultPrevented, false, 'a hint alone never consumes submission');
    type('/permissions sh'); input.setSelectionRange(3, 3); completion.refresh(); assert.equal(list.hidden, true);
    completion.setCommands([]); type('/'); assert.equal(list.hidden, true);
  } finally { dom.window.close(); }
});

test('text commands invoke the SDK once, render labelled output, and never become ordinary prompts', async () => {
  const f = await fixture();
  try {
    const handling = f.session.handle({ type: 'command', id: 'show', text: '/perms show  literal\nmore' });
    assert.deepEqual(f.sent.at(-1) && { method: f.sent.at(-1)!.method, name: f.sent.at(-1)!.name, input: f.sent.at(-1)!.input },
      { method: 'command', name: 'perms', input: 'show  literal\nmore' });
    assert.equal(f.session.state.busy, false);
    assert.equal(f.session.validatePrompt('Newer draft') !== undefined, true);
    f.reply({ kind: 'text', text: '<literal> permission report', markdown: false }); await handling;
    const output = f.session.state.messages[0];
    assert.equal(output.role, 'command'); assert.match(output.originLabel!, /Copilot command/);
    assert.deepEqual(output.content, [{ type: 'raw', text: '<literal> permission report' }]);
    assert.equal(f.sent.some(request => request.method === 'prompt'), false);
    assert.equal(f.session.canSubmit, true);
    assert.equal(f.published.some(message => message.type === 'submissionMessage'), false);
  } finally { f.session.disconnect('fixture complete'); }
});

test('bare commands with advertised arguments open a picker before invoking, even when the SDK would return text', async () => {
  let choose!: (value: string | undefined) => void;
  const f = await fixture(async (title, choices) => {
    assert.equal(title, 'Copilot /permissions'); assert.equal(choices[0].id, 'show');
    return new Promise(resolve => { choose = resolve; });
  });
  try {
    const handling = f.session.handle({ type: 'command', id: 'bare', text: '/perms   ' });
    assert.equal(f.sent.some(request => request.method === 'command'), false, 'no default command invocation before the choice');
    choose('show'); await flush();
    assert.equal(f.sent.at(-1)!.name, 'perms'); assert.equal(f.sent.at(-1)!.input, 'show');
    f.reply({ kind: 'text', text: 'Permission report' }); await handling;
    assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
    assert.equal(f.session.state.messages[0].role, 'command');
    const explicit = f.session.handle({ type: 'command', id: 'explicit', text: '/permissions show' });
    f.reply({ kind: 'text', text: 'Explicit report' }); await explicit;
    assert.equal(f.sent.filter(request => request.method === 'command').length, 2);
  } finally { f.session.disconnect('fixture complete'); }
});

test('cancelling an advertised-argument picker invokes nothing; required choices and stale catalogs stay safe', async () => {
  for (const cancel of ['escape', 'hidden', 'catalog']) {
    let choose!: (value: string | undefined) => void;
    const f = await fixture(async () => new Promise(resolve => { choose = resolve; }));
    try {
      f.session.receive({ kind: 'commands', commands: [{ ...catalog[0], input: { ...catalog[0].input, required: true } }] });
      assert.equal(f.session.validatePrompt('/permissions'), undefined, 'required advertised choices can be supplied by a picker');
      const handling = f.session.handle({ type: 'command', id: cancel, text: '/permissions' });
      if (cancel === 'hidden') f.session.cancelCommands();
      if (cancel === 'catalog') f.session.receive({ kind: 'commands', commands: [] });
      choose(cancel === 'escape' ? undefined : 'show'); await handling;
      assert.equal(f.sent.some(request => request.method === 'command'), false);
      assert.deepEqual(f.session.state.messages, []);
      assert.equal(f.session.canSubmit, true);
    } finally { f.session.disconnect('fixture complete'); }
  }
});

test('commands without advertised choices retain their bare SDK invocation', async () => {
  const f = await fixture(undefined, resultOnlyCatalog);
  try {
    const handling = f.session.handle({ type: 'command', id: 'bare-text', text: '/permissions' });
    assert.equal(f.sent.at(-1)!.method, 'command'); assert.equal(f.sent.at(-1)!.input, undefined);
    f.reply({ kind: 'text', text: 'Default report' }); await handling;
  } finally { f.session.disconnect('fixture complete'); }
});

test('harness subcommand choices invoke only the explicitly selected argument', async () => {
  const f = await fixture(async (title, choices) => { assert.equal(title, 'Permissions'); assert.equal(choices[0].detail, 'Show permissions'); return 'show'; }, resultOnlyCatalog);
  try {
    const handling = f.session.handle({ type: 'command', id: 'choose', text: '/permissions' });
    f.reply({ kind: 'select-subcommand', command: 'permissions', title: 'Permissions', options: catalog[0].input.choices }); await flush();
    assert.equal(f.sent.at(-1)!.input, 'show');
    f.reply({ kind: 'text', text: '**Permissions**', markdown: true }); await handling;
    assert.deepEqual(f.session.state.messages[0].content, [{ type: 'text', text: '**Permissions**' }]);
    assert.equal(f.sent.filter(request => request.method === 'command').length, 2);
  } finally { f.session.disconnect('fixture complete'); }
});

test('Escape, hidden-session cancellation and disconnection suppress follow-on invocation and late modals', async () => {
  for (const cancel of ['escape', 'hidden', 'disconnected']) {
    let shown = 0;
    const f = await fixture(async () => { shown++; return undefined; }, resultOnlyCatalog);
    const handling = f.session.handle({ type: 'command', id: cancel, text: '/permissions' });
    if (cancel === 'hidden') f.session.cancelCommands();
    if (cancel === 'disconnected') f.session.disconnect('fixture closed');
    f.reply({ kind: 'select-subcommand', command: 'permissions', title: 'Permissions', options: catalog[0].input.choices }); await handling;
    assert.equal(shown, cancel === 'escape' ? 1 : 0);
    assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
    assert.deepEqual(f.session.state.messages, []);
    f.session.disconnect('fixture complete');
  }
});

test('an aborted open picker cannot apply a late choice', async () => {
  let choose!: (value: string) => void, signal!: AbortSignal;
  const f = await fixture(async (_title, _choices, owned) => { signal = owned; return new Promise(resolve => { choose = resolve; }); }, resultOnlyCatalog);
  try {
    const handling = f.session.handle({ type: 'command', id: 'late', text: '/permissions' });
    f.reply({ kind: 'select-subcommand', command: 'permissions', title: 'Permissions', options: catalog[0].input.choices }); await flush();
    f.session.cancelCommands(); assert.equal(signal.aborted, true); choose('show'); await handling;
    assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
  } finally { f.session.disconnect('fixture complete'); }
});

test('new catalog commands work mechanically; unknown, malformed and unsupported results never fall back', async () => {
  const f = await fixture();
  try {
    assert.match(f.session.validatePrompt('/future')!, /not advertised/);
    f.session.receive({ kind: 'commands', commands: [{ name: 'future', description: 'New runtime command', kind: 'builtin' }] });
    assert.equal(f.session.validatePrompt('/future'), undefined);
    for (const result of [{ kind: 'future-host-effect' }, { kind: 'set-model', model: 'other' }, { kind: 'select-subcommand', command: 'future', title: 'Bad', options: [{}] }]) {
      const handling = f.session.handle({ type: 'command', id: 'future', text: '/future' });
      f.reply(result); await handling;
      assert.match(String(f.published.at(-2)?.error), /No.*fallback|Nothing was retried/);
    }
    assert.equal(f.sent.some(request => ['prompt', 'configure'].includes(request.method)), false);
    const done = f.session.handle({ type: 'command', id: 'done', text: '/future' });
    f.reply({ kind: 'completed', message: 'Completed without model work' }); await done;
    assert.equal(f.session.state.messages.at(-1)?.role, 'command');
    f.session.receive({ kind: 'command-error', error: 'Discovery unavailable' });
    assert.deepEqual(f.session.commands, []); assert.equal(f.session.canSubmit, true);
  } finally { f.session.disconnect('fixture complete'); }
});

test('only an explicit interactive agent-prompt result sends model work', async () => {
  const f = await fixture(undefined, resultOnlyCatalog);
  try {
    const handling = f.session.handle({ type: 'command', id: 'expand', text: '/permissions' });
    f.reply({ kind: 'agent-prompt', prompt: 'Harness-expanded content', displayPrompt: 'Visible command request', mode: 'interactive' }); await flush();
    assert.equal(f.sent.at(-1)!.method, 'prompt'); assert.equal(f.sent.at(-1)!.text, 'Harness-expanded content');
    f.reply({ messageId: 'accepted' }, 'prompt'); await handling;
    assert.equal(f.session.state.messages[0].content, 'Visible command request');
  } finally { f.session.disconnect('fixture complete'); }
});
