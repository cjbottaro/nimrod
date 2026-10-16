import assert from 'node:assert/strict';
import test from 'node:test';
import { AcpSession } from '../src/acp/session';
import { slashCommands } from '../src/pi/slash-completion';
import type { AcpPacket, AcpRecord } from '../src/acp/connection';
import type { HostMessage } from '../src/pi/webview-client';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const options = (current = 'small') => [{ id: 'model', category: 'model', name: 'Model', type: 'select', currentValue: current, options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }];
async function fixture() {
  const sent: AcpPacket[] = [], published: HostMessage[] = [], completed: boolean[] = [];
  const session = new AcpSession(packet => { sent.push(packet); }, { publish: message => published.push(message), changed() {}, notice() {}, permission: async () => undefined, disconnected() {}, completed: failed => completed.push(failed) });
  const last = (method: string) => { const value = [...sent].reverse().find(value => value.method === method); assert.ok(value); return value; };
  const reply = (method: string, result: unknown) => session.receive({ jsonrpc: '2.0', id: last(method).id, result });
  const update = (update: AcpRecord) => session.receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'test-session', update } });
  const pending = session.initialize('/fixture/project');
  reply('initialize', { protocolVersion: 1, agentInfo: { name: 'fixture-agent', version: '1' }, agentCapabilities: {} });
  await flush(); reply('session/new', { sessionId: 'test-session', configOptions: options() }); await pending;
  return { session, sent, published, completed, last, reply, update };
}
test('ACP presentation correlates one local user turn and preserves native tool metadata without Pi events', async () => {
  const f = await fixture();
  const turn = f.session.handle({ type: 'prompt', id: 'local', text: 'hello' });
  f.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'hel' } });
  f.update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'lo' } });
  assert.equal(f.session.state.messages.filter(message => message.role === 'user').length, 1);
  assert.equal(f.session.state.messages[0].content, 'hello');
  const correlated = f.published.find(message => message.type === 'submissionMessage');
  assert.equal(correlated?.key, f.session.state.messages[0].key);
  f.update({ sessionUpdate: 'tool_call', toolCallId: 'one', title: 'Real title', kind: 'execute', status: 'pending', rawInput: { command: 'fixture' } });
  f.update({ sessionUpdate: 'tool_call_update', toolCallId: 'one', status: 'in_progress', content: [{ type: 'content', content: { type: 'text', text: 'output' } }] });
  const tool = f.session.state.messages.find(message => message.role === 'tool')!;
  assert.deepEqual(tool.toolSource, { backend: 'acp', agent: 'fixture-agent' });
  assert.equal(tool.toolName, 'execute'); assert.equal(tool.toolTitle, 'Real title'); assert.equal(tool.output, 'output');
  assert.equal((tool.toolNative as AcpRecord).toolCallId, 'one');
  assert.equal(Object.isFrozen(tool.toolArguments), true);
  const args = tool.toolArguments;
  f.update({ sessionUpdate: 'tool_call_update', toolCallId: 'one', content: [{ type: 'content', content: { type: 'text', text: 'output continues' } }] });
  assert.equal(f.session.state.messages.find(message => message.role === 'tool')?.toolArguments, args, 'owned immutable inputs retain identity across output updates');
  f.session.client.cancel(); f.reply('session/prompt', { stopReason: 'cancelled' }); await turn;
  assert.equal(f.session.state.messages.find(message => message.role === 'tool')?.uiPhase, 'stopped');
  assert.equal(f.completed.length, 0, 'Stop is not a completion notification');
  assert.equal(f.session.canSubmit, true);
  assert.equal(f.sent.some(packet => 'type' in packet), false, 'only real ACP requests reach the writer');
});

test('ACP applies configuration results in wire order, never over a later update', async () => {
  const f = await fixture();
  const selected = f.session.selectOption(f.session.options[0], async (_title, choices) => choices[1]);
  await flush();
  f.reply('session/set_config_option', { configOptions: options('large') });
  f.update({ sessionUpdate: 'config_option_update', configOptions: options('small') });
  await selected;
  assert.equal(f.session.options[0].current, 'small');
  assert.equal(f.session.state.modelControls.model?.id, 'Small');
  assert.equal(f.session.state.modelControls.changing, false);
});

test('ACP completion never injects Pi-only GUI commands', () => {
  assert.deepEqual(slashCommands(undefined, 'acp'), []);
  assert.deepEqual(slashCommands([{ name: 'context', description: 'Context' }], 'acp'), [{ name: 'context', description: 'Context', source: 'Agent' }]);
  assert.ok(slashCommands(undefined).some(command => command.name === 'name' && command.source === 'GUI'));
});

test('ACP slash commands must be advertised, and busy validation does not dispatch a second turn', async () => {
  const f = await fixture();
  assert.match(f.session.validatePrompt('/mcp')!, /not advertised/);
  f.update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'context', description: 'Context' }] });
  assert.equal(f.session.validatePrompt('/context'), undefined);
  const first = f.session.handle({ type: 'prompt', id: 'first', text: 'one' });
  await f.session.handle({ type: 'prompt', id: 'second', text: 'two' });
  assert.equal(f.sent.filter(packet => packet.method === 'session/prompt').length, 1);
  assert.equal(f.published.find(message => message.type === 'submissionReceipt' && message.id === 'second')?.outcome, 'rejected');
  f.reply('session/prompt', { stopReason: 'end_turn' }); await first;
});
