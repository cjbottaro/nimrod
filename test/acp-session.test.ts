import assert from 'node:assert/strict';
import test from 'node:test';
import { AcpSession, type AcpSessionUi } from '../src/acp/session';
import type { AcpPermissionRequest } from '../src/acp/client';
import { agentSlashCommands } from '../src/acp/view-policy';
import { renderPermissionDetails } from '../src/acp/tool-state';
import { JSDOM } from 'jsdom';
import { slashCommands } from '../src/pi/slash-completion';
import type { AcpPacket, AcpRecord } from '../src/acp/connection';
import type { ConversationViewMessage } from '../src/conversation-view-host';
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
const options = (current = 'small') => [{ id: 'model', category: 'model', name: 'Model', type: 'select', currentValue: current, options: [{ value: 'small', name: 'Small' }, { value: 'large', name: 'Large' }] }];
async function fixture(permission?: AcpSessionUi['permission']) {
  const sent: AcpPacket[] = [], published: ConversationViewMessage[] = [], completed: boolean[] = [], permissions: AcpPermissionRequest[] = [];
  const session = new AcpSession(packet => { sent.push(packet); }, { publish: message => published.push(message), changed() {}, notice() {}, permission: async (request, signal) => { permissions.push(request); return permission?.(request, signal); }, disconnected() {}, completed: failed => completed.push(failed) });
  const last = (method: string) => { const value = [...sent].reverse().find(value => value.method === method); assert.ok(value); return value; };
  const reply = (method: string, result: unknown) => session.receive({ jsonrpc: '2.0', id: last(method).id, result });
  const update = (update: AcpRecord) => session.receive({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 'test-session', update } });
  const pending = session.initialize('/fixture/project');
  reply('initialize', { protocolVersion: 1, agentInfo: { name: 'fixture-agent', version: '1' }, agentCapabilities: {} });
  await flush(); reply('session/new', { sessionId: 'test-session', configOptions: options() }); await pending;
  return { session, sent, published, completed, permissions, last, reply, update };
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
  assert.equal(tool.toolName, undefined); assert.equal(tool.toolKind, 'execute'); assert.equal(tool.toolTitle, 'Real title'); assert.equal(tool.output, 'output');
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
  assert.equal(f.session.state.controls?.find(control => control.id === 'model')?.label, 'Small');
  assert.equal(f.session.state.controls?.find(control => control.id === 'model')?.disabled, false);
});

test('ACP completion never injects Pi-only GUI commands', () => {
  assert.deepEqual(agentSlashCommands(undefined), []);
  assert.deepEqual(agentSlashCommands([{ name: 'context', description: 'Context' }]), [{ name: 'context', description: 'Context', source: 'Agent' }]);
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

test('ACP null tool patches retain native name, inputs and output without conflating kind', async () => {
  const f = await fixture();
  f.update({ sessionUpdate: 'tool_call', toolCallId: 'nulls', name: 'run_shell', title: 'Run fixture', kind: 'execute', status: 'in_progress', rawInput: { command: 'fixture', nullable: null }, rawOutput: { stdout: 'retained' } });
  const before = f.session.state.messages[0];
  f.update({ sessionUpdate: 'tool_call_update', toolCallId: 'nulls', status: 'completed', name: null, rawInput: null, rawOutput: null, content: null });
  const after = f.session.state.messages[0];
  assert.equal(after.toolName, 'run_shell'); assert.equal(after.toolKind, 'execute');
  assert.equal(after.toolArguments, before.toolArguments);
  assert.equal(after.resultOutput, before.output);
  assert.equal(after.toolStatus, 'result');
  assert.deepEqual(after.toolArguments, { command: 'fixture', nullable: null });
});

test('ID-only permissions resolve retained metadata; permission patches also update the transcript', async () => {
  const f = await fixture(async () => 'deny');
  const turn = f.session.handle({ type: 'prompt', id: 'permission-turn', text: 'review' });
  const diff = { type: 'diff', path: '/fixture/file', oldText: 'before', newText: '<script>after</script>' };
  f.update({ sessionUpdate: 'tool_call', toolCallId: 'edit', name: 'replace_file', title: 'Edit the fixture', kind: 'edit', rawInput: { path: '/fixture/file' }, content: [diff], locations: [{ path: '/fixture/file', line: 1 }] });
  const request = (id: string, toolCall: AcpRecord) => f.session.receive({ jsonrpc: '2.0', id, method: 'session/request_permission', params: { sessionId: 'test-session', toolCall, options: [{ optionId: 'deny', name: 'Reject', kind: 'reject_once' }] } });
  request('permission-one', { toolCallId: 'edit' }); await flush();
  assert.equal(f.permissions[0].toolCall.title, 'Edit the fixture');
  assert.deepEqual(f.permissions[0].toolCall.content, [diff]);
  assert.equal(Object.isFrozen(f.permissions[0].toolCall), true);
  const dom = new JSDOM();
  try {
    const detail = renderPermissionDetails(dom.window.document, f.permissions[0].toolCall);
    assert.match(detail.textContent!, /Edit the fixture/);
    assert.match(detail.textContent!, /Tool call: edit/);
    assert.match(detail.textContent!, /before/); assert.match(detail.textContent!, /<script>after<\/script>/);
    assert.equal(detail.querySelector('script'), null);
  } finally { dom.window.close(); }
  request('permission-two', { toolCallId: 'edit', title: 'Updated title', rawInput: null }); await flush();
  assert.equal(f.session.state.messages.find(message => message.toolCallId === 'edit')?.toolTitle, 'Updated title');
  assert.deepEqual(f.permissions[1].toolCall.rawInput, { path: '/fixture/file' });
  assert.deepEqual(f.sent.find(packet => packet.id === 'permission-two')?.result, { outcome: { outcome: 'selected', optionId: 'deny' } });
  f.reply('session/prompt', { stopReason: 'end_turn' }); await turn;
});

test('consecutive rich content blocks survive JSON fallback, with or without a message ID', async () => {
  const f = await fixture();
  const blocks = [
    { type: 'resource_link', uri: 'file:///one', name: 'one' },
    { type: 'resource_link', uri: 'file:///two', name: 'two' },
    { type: 'image', mimeType: 'image/png', data: 'first' },
    { type: 'image', mimeType: 'image/png', data: 'second' },
  ];
  blocks.forEach((content, index) => f.update({ sessionUpdate: 'agent_message_chunk', ...(index < 2 ? { messageId: 'same-message' } : {}), content }));
  assert.equal(new Set(f.session.state.messages.map(message => message.key)).size, 4);
  assert.deepEqual(f.session.state.messages.map(message => Array.isArray(message.content) ? JSON.parse(message.content[0].text!) : null), blocks);
});

test('configuration updates while working do not latch controls disabled after completion', async () => {
  const f = await fixture();
  const turn = f.session.handle({ type: 'prompt', id: 'working', text: 'work' });
  const mode = { id: 'approval', name: 'Approval mode', description: 'Agent-owned permission policy', type: 'select', category: 'mode', currentValue: 'ask', options: [{ value: 'ask', name: 'Ask first' }] };
  f.update({ sessionUpdate: 'config_option_update', configOptions: [...options('large'), mode] });
  assert.ok(f.session.state.controls?.every(control => control.disabled));
  assert.equal(f.session.controlOption('mode')?.id, 'approval');
  assert.match(f.session.state.controls?.find(control => control.id === 'mode')?.title || '', /Agent-owned permission policy/);
  assert.equal('modelControls' in f.session.state, false);
  assert.equal('queue' in f.session.state, false);
  assert.equal('extensionWidgets' in f.session.state, false);
  f.reply('session/prompt', { stopReason: 'end_turn' }); await turn;
  assert.ok(f.session.state.controls?.every(control => !control.disabled));
  assert.equal(f.session.state.controls?.find(control => control.id === 'model')?.label, 'Large');
});
