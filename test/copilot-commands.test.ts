import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { copilotCommands, copilotSlashCommands, isCopilotModelCommand, parseCopilotCommand } from '../src/copilot/commands';
import { CopilotSession, type CopilotSessionUi } from '../src/copilot/session';
import type { BridgeRequest } from '../src/copilot/connection';
import type { ConversationViewMessage } from '../src/conversation-view-host';
import { copilotInteraction } from '../src/copilot/view-policy';
import { installSlashCompletion } from '../src/pi/slash-completion';

const catalog = [{ name: 'permissions', aliases: ['perms'], description: 'Manage permissions', kind: 'builtin', allowDuringAgentExecution: true,
  input: { hint: 'Choose a permission operation', choices: [{ name: 'show', description: 'Show permissions' }, { name: 'reset', description: 'Clear approvals' }] } }];
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const resultOnlyCatalog = catalog.map(({ input: _input, ...command }) => command);
async function fixture(commandChoice?: CopilotSessionUi['commandChoice'], commands: unknown[] = catalog, models: unknown[] = []) {
  const sent: BridgeRequest[] = [], published: ConversationViewMessage[] = [], notices: string[] = [], completions: boolean[] = [];
  const session: CopilotSession = new CopilotSession(async request => {
    sent.push(request);
    if (['usage', 'context'].includes(request.method)) queueMicrotask(() => session.receive({ kind: 'result', id: request.id, result: request.method === 'usage' ? {} : null }));
  }, {
    publish: message => published.push(message), changed() {}, identified() {}, disconnected() {}, completed(failed) { completions.push(failed); },
    notice: message => notices.push(message), decision: async () => undefined, commandChoice,
  });
  const reply = (result: unknown, method = 'command') => {
    const request = [...sent].reverse().find(request => request.method === method)!;
    assert.ok(request); session.receive({ kind: 'result', id: request.id, result });
  };
  const ready = session.initialize(); reply(null, 'initialize'); await flush();
  session.receive({ kind: 'connected', sessionId: 'fixture', events: [], models, model: {} });
  session.receive({ kind: 'commands', commands }); reply(null, 'connect'); await ready; await flush();
  return { session, sent, published, notices, completions, reply };
}

test('SDK command metadata retains aliases, hints and choices, without synthetic GUI commands', () => {
  const commands = copilotSlashCommands([...catalog, { name: 'bad/name', kind: 'builtin' }]);
  assert.deepEqual(commands.map(command => command.name), ['permissions', 'perms']);
  assert.equal(commands[1].input?.choices?.[0].description, 'Show permissions');
  assert.deepEqual(copilotCommands(undefined), []);
  assert.deepEqual(parseCopilotCommand('/perms show  literal\nmore '), { name: 'perms', input: 'show  literal\nmore ' });
  assert.deepEqual(parseCopilotCommand('/permissions'), { name: 'permissions' });
  assert.equal(isCopilotModelCommand(copilotCommands([{ name: 'model', kind: 'builtin' }])[0]), true);
  assert.equal(isCopilotModelCommand(copilotCommands([{ name: 'model', kind: 'client' }])[0]), false);
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
    assert.equal(f.session.state.configurationOperations?.[0].settlementAnchor, null);
    const output = f.session.state.messages[0];
    assert.equal(output.role, 'command'); assert.match(output.originLabel!, /Copilot command/);
    assert.deepEqual(output.content, [{ type: 'raw', text: '<literal> permission report' }]);
    assert.equal(f.sent.some(request => request.method === 'prompt'), false);
    assert.equal(f.session.canSubmit, true);
    assert.equal(f.published.some(message => message.type === 'submissionMessage'), false);
    assert.deepEqual(f.completions, []);
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

for (const slash of ['/model', '/models']) test(`${slash} supplies Copilot's missing bare-command picker before harness invocation`, async () => {
  let choose!: (value: string | undefined) => void;
  const commands = [{ name: 'model', aliases: ['models'], description: 'Select model', kind: 'builtin', input: { hint: 'model' } }];
  const models = [{ id: 'small', name: 'Small' }, { id: 'large', name: 'Large' }];
  const f = await fixture(async (title, choices) => {
    assert.equal(title, 'Copilot /model');
    assert.deepEqual(choices, [{ id: 'small', label: 'Small', detail: 'small' }, { id: 'large', label: 'Large', detail: 'large' }]);
    return new Promise(resolve => { choose = resolve; });
  }, commands, models);
  try {
    const handling = f.session.handle({ type: 'command', id: slash, text: slash });
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    choose('large'); await flush();
    assert.deepEqual(f.sent.at(-1) && { method: f.sent.at(-1)!.method, name: f.sent.at(-1)!.name, input: f.sent.at(-1)!.input },
      { method: 'command', name: slash.slice(1), input: 'large' });
    f.reply({ kind: 'set-model', model: 'large', commandApplied: true, configuration: { modelId: 'large' } });
    await handling;
    assert.equal(f.session.configuration.get('model'), 'large');
    assert.equal(f.sent.some(request => request.method === 'configure'), false);
  } finally { f.session.disconnect('fixture complete'); }
});

test('cancelling Copilot model command picker invokes nothing', async () => {
  const commands = [{ name: 'model', aliases: ['models'], description: 'Select model', kind: 'builtin', input: { hint: 'model' } }];
  const f = await fixture(async () => undefined, commands, [{ id: 'small', name: 'Small' }]);
  try {
    await f.session.handle({ type: 'command', id: 'model-cancel', text: '/model' });
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    assert.equal(f.session.state.configurationOperations?.length, 0);
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
    for (const result of [{ kind: 'future-host-effect' }, { kind: 'select-subcommand', command: 'future', title: 'Bad', options: [{}] }]) {
      const handling = f.session.handle({ type: 'command', id: 'future', text: '/future' });
      f.reply(result); await handling;
      const operation = f.session.state.configurationOperations!.at(-1)!;
      assert.equal(operation.phase, 'failed');
      assert.match(operation.details!, /No.*fallback|Nothing was retried/);
      assert.equal(f.published.some(message => message.type === 'submissionReceipt' && message.outcome === 'rejected'), false, 'the operation card owns the error');
    }
    assert.equal(f.sent.some(request => ['prompt', 'configure'].includes(request.method)), false);
    const done = f.session.handle({ type: 'command', id: 'done', text: '/future' });
    f.reply({ kind: 'completed', message: 'Completed without model work' }); await done;
    assert.equal(f.session.state.messages.at(-1)?.role, 'command');
    f.session.receive({ kind: 'command-error', error: 'Discovery unavailable' });
    assert.deepEqual(f.session.commands, []); assert.equal(f.session.canSubmit, true);
  } finally { f.session.disconnect('fixture complete'); }
});

test('finalized harness model effects reconcile configuration without invoking Nimrod actions', async () => {
  const f = await fixture(undefined, [{ name: 'model', description: 'Select model', kind: 'builtin' }]);
  try {
    const handling = f.session.handle({ type: 'command', id: 'model', text: '/model large' });
    f.reply({ kind: 'set-model', model: 'large', reasoningEffort: 'high', effectFinalized: true, commandApplied: true,
      configuration: { modelId: 'large', reasoningEffort: 'high' }, warning: 'Preview model' });
    await handling;
    assert.equal(f.session.configuration.get('model'), 'large');
    assert.equal(f.session.configuration.get('effort'), 'high');
    assert.deepEqual(f.notices, ['Preview model']);
    assert.equal(f.sent.some(request => request.method === 'configure'), false);
  } finally { f.session.disconnect('fixture complete'); }
});

test('finalization failure belongs to the queued command card without a duplicate submission error', async () => {
  for (const outcome of ['cancelled', 'unknown']) {
    const f = await fixture(undefined, [{ name: 'model', kind: 'builtin' }]);
    try {
      const handling = f.session.handle({ type: 'command', id: outcome, text: '/model large' });
      f.reply({ kind: 'command-effect-failed', outcome, error: 'Native finalization did not finish' });
      await handling;
      const operation = f.session.state.configurationOperations!.at(-1)!;
      assert.equal(operation.phase, outcome === 'cancelled' ? 'failed' : 'unknown');
      assert.match(operation.details!, /Native finalization/);
      assert.equal(f.published.some(message => message.type === 'submissionReceipt' && message.outcome !== 'accepted'), false);
      assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
      assert.equal(f.sent.some(request => request.method === 'prompt'), false);
    } finally { f.session.disconnect('fixture complete'); }
  }
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

test('busy /allow-all and subsequent commands queue FIFO until terminal root idle, without prompts or draft effects', async () => {
  const f = await fixture(undefined, [{ name: 'allow-all', aliases: ['allow'], kind: 'builtin' }, ...catalog]);
  try {
    f.session.receive({ kind: 'event', event: { id: 'working', type: 'assistant.turn_start', data: {} } });
    assert.equal(f.session.validatePrompt('/allow-all'), undefined);
    assert.match(f.session.validatePrompt('newer ordinary draft')!, /not idle/);
    assert.match(f.session.validatePrompt('/unknown')!, /not advertised/);
    const first = f.session.handle({ type: 'command', id: 'first', text: '/allow' });
    const second = f.session.handle({ type: 'command', id: 'second', text: '/permissions show  literal\nmore ' });
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    const operations = f.session.state.configurationOperations!;
    assert.deepEqual(operations.map(operation => operation.phase), ['queued', 'queued']);
    f.session.receive({ kind: 'event', event: { id: 'child-idle', agentId: 'child', type: 'session.idle', data: {} } });
    f.session.receive({ kind: 'event', event: { id: 'autopilot-idle', type: 'session.idle', data: { mode: 'autopilot' } } });
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    assert.equal(f.session.state.configurationOperations, operations, 'streaming/idle observations retain progress identity');
    f.session.receive({ kind: 'event', event: { id: 'terminal', type: 'session.idle', data: { mode: 'interactive' } } });
    assert.equal(f.sent.filter(request => request.method === 'command').length, 1);
    assert.equal(f.sent.filter(request => request.method === 'command').at(-1)!.name, 'allow');
    f.reply({ kind: 'completed' }); await first; await flush();
    assert.equal(f.sent.filter(request => request.method === 'command').length, 2);
    assert.equal(f.sent.filter(request => request.method === 'command').at(-1)!.input, 'show  literal\nmore ');
    f.reply({ kind: 'text', text: 'Report' }); await second;
    assert.deepEqual(f.session.state.configurationOperations!.map(operation => operation.phase), ['completed', 'completed']);
    assert.equal(f.sent.some(request => request.method === 'prompt'), false);
    assert.equal(f.published.some(message => message.type === 'setEditorText' || message.type === 'submissionMessage'), false);
    assert.deepEqual(f.completions, [false], 'only the actual agent turn announces completion');
  } finally { f.session.disconnect('fixture complete'); }
});

test('queued command choices wait for idle, and switching away, Stop or disconnect prevents dispatch', async () => {
  for (const cancel of ['hidden', 'stop', 'disconnect']) {
    let shown = 0;
    const f = await fixture(async () => { shown++; return 'show'; });
    f.session.receive({ kind: 'event', event: { id: 'working', type: 'assistant.turn_start', data: {} } });
    const handling = f.session.handle({ type: 'command', id: cancel, text: '/permissions' });
    assert.equal(shown, 0);
    if (cancel === 'disconnect') f.session.disconnect('fixture closed');
    else if (cancel === 'hidden') f.session.cancelCommands();
    else {
      const stopping = f.session.handle({ type: 'stop' });
      f.reply(null, 'cancel'); await stopping;
    }
    await handling;
    if (cancel !== 'disconnect') f.session.receive({ kind: 'event', event: { id: 'terminal', type: 'session.idle', data: {} } });
    assert.equal(shown, 0);
    assert.equal(f.sent.some(request => request.method === 'command'), false);
    assert.equal(f.session.state.configurationOperations?.length, cancel === 'disconnect' ? 1 : 0);
    if (cancel === 'disconnect') assert.equal(f.session.state.configurationOperations![0].phase, 'not-applied');
    f.session.disconnect('fixture complete');
  }
});

test('queued commands revalidate revoked advertisement without invoking or replaying', async () => {
  const f = await fixture();
  try {
    f.session.receive({ kind: 'event', event: { id: 'working', type: 'assistant.turn_start', data: {} } });
    const handling = f.session.handle({ type: 'command', id: 'revoked', text: '/permissions show' });
    f.session.receive({ kind: 'commands', commands: [] });
    f.session.receive({ kind: 'event', event: { id: 'terminal', type: 'session.idle', data: {} } });
    await handling;
    assert.equal(f.sent.some(request => ['command', 'prompt'].includes(request.method)), false);
    assert.equal(f.session.state.configurationOperations![0].phase, 'failed');
    assert.match(f.session.state.configurationOperations![0].details!, /not advertised/);
  } finally { f.session.disconnect('fixture complete'); }
});
