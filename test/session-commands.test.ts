import assert from 'node:assert/strict';
import test from 'node:test';
import { bindSessionCommands, commandCatalog, commandSuggestions, parseCommand, SessionCommandQueue, CommandUncertain, unsupportedCommands, type SessionCommands } from '../src/session-commands';

const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
test('catalog revisions and alias completion preserve native metadata and literal arguments', () => {
  let choices = [{ name: 'one', description: 'First' }];
  const catalog = commandCatalog(() => [{ name: 'model', aliases: ['models'], source: 'Agent', description: 'Models', input: { hint: 'model', choices } }]);
  const first = catalog(); assert.equal(catalog(), first);
  assert.deepEqual(commandSuggestions(first.commands).map(command => command.name), ['model', 'models']);
  choices = [{ name: 'two', description: 'Second' }];
  assert.equal(catalog().revision, first.revision + 1);
  assert.deepEqual(parseCommand('/models one  literal\nmore '), { name: 'models', input: 'one  literal\nmore ' });
});
test('required facade captures one command owner and never replays across reconnect', async () => {
  let invoked = 0, settle!: () => void;
  const owner: SessionCommands = { ...unsupportedCommands(''), validate: () => undefined,
    invoke: async () => { invoked++; await new Promise<void>(resolve => { settle = resolve; }); } };
  let connected = true, current = owner;
  const port = bindSessionCommands(() => current, () => connected);
  const invoking = port.invoke({ id: 'one', text: '/sample' });
  current = unsupportedCommands('Replacement owner'); connected = false;
  settle(); await invoking; assert.equal(invoked, 1);
  assert.match(port.validate('/sample')!, /Connect/);
  await assert.rejects(port.invoke({ id: 'late', text: '/sample' }), /Connect/);
});
test('FIFO cards appear before dispatch, retain output and withdraw only undispatched work', async () => {
  let ready = false, finish!: () => void;
  const dispatched: string[] = [];
  const queue = new SessionCommandQueue(() => ready, async (_id, text, signal, dispatch) => {
    assert.equal(signal.aborted, false); dispatch(); dispatched.push(text);
    queue.output('**Report**', true);
    await new Promise<void>(resolve => { finish = resolve; });
  }, () => {}, 'Fixture');
  const first = queue.enqueue('one', '/report', null), second = queue.enqueue('two', '/report next', null);
  const key = queue.operations[0].key;
  assert.deepEqual(queue.operations.map(operation => operation.phase), ['queued', 'queued']);
  queue.cancel(undefined, queue.operations[1].key); await second;
  assert.equal(queue.operations.length, 1);
  ready = true; queue.update();
  assert.equal(queue.operations[0].key, key);
  assert.equal(queue.operations[0].cancellable, false);
  assert.deepEqual(queue.operations[0].commandOutput, [{ text: '**Report**', markdown: true }]);
  finish(); await first;
  assert.equal(queue.operations[0].key, key); assert.equal(queue.operations[0].phase, 'completed');
  assert.deepEqual(dispatched, ['/report']);
});
test('cancellation and disconnection retain uncertainty after possible delivery, with no late output', async () => {
  let finish!: () => void;
  const queue = new SessionCommandQueue(() => true, async (_id, _text, _signal, dispatched) => {
    dispatched(); await new Promise<void>(resolve => { finish = resolve; }); queue.output('late');
  }, () => {});
  const running = queue.enqueue('one', '/mutate', null);
  queue.cancel('Connection lost'); finish(); await running;
  assert.equal(queue.operations[0].phase, 'unknown');
  assert.equal(queue.operations[0].cause, 'connection');
  assert.equal(queue.operations[0].commandOutput, undefined);
  await assert.rejects(queue.enqueue('two', '/mutate', null), /connection ended/);
});
test('concrete uncertainty is distinct from known rejection and pre-dispatch cancellation', async () => {
  for (const [result, expected] of [['reject', 'failed'], ['uncertain', 'unknown'], ['cancel', undefined]] as const) {
    const queue = new SessionCommandQueue(() => true, async () => {
      if (result === 'cancel') return false;
      if (result === 'uncertain') throw new CommandUncertain('Not confirmed');
      throw new Error('Rejected');
    }, () => {});
    await queue.enqueue('one', '/command', null); await flush();
    assert.equal(queue.operations[0]?.phase, expected);
  }
});
