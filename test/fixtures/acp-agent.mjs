// Offline ACP agent. No tools, providers, network, user history or filesystem writes.
import { createInterface } from 'node:readline';
const sessionId = 'fixture-acp';
const send = value => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...value }) + '\n');
const response = (id, result) => send({ id, result });
const update = value => send({ method: 'session/update', params: { sessionId, update: value } });
let model = 'fixture-small', effort = 'medium', mode = 'ask', turn, timer;
const configOptions = () => [
  { id: 'model', category: 'model', name: 'Model', type: 'select', currentValue: model, options: [{ value: 'fixture-small', name: 'Fixture small' }, { value: 'fixture-large', name: 'Fixture large' }] },
  { id: 'effort', category: 'thought_level', name: 'Thinking level', type: 'select', currentValue: effort, options: ['low', 'medium', 'high'].map(value => ({ value, name: value })) },
  { id: 'mode', category: 'mode', name: 'Approval mode', description: 'Offline fixture policy', type: 'select', currentValue: mode, options: [{ value: 'ask', name: 'Fixture ask' }, { value: 'review', name: 'Fixture review' }] },
];
function finish(reason) {
  clearInterval(timer); timer = undefined;
  if (turn) response(turn.id, { stopReason: reason });
  turn = undefined;
}
function execute() {
  if (!turn) return;
  const id = `tool-${turn.id}`;
  const limit = turn.params.prompt.some(content => content.text?.includes('Second offline request')) ? 180 : 24;
  let output = '', count = 0;
  update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'in_progress' });
  timer = setInterval(() => {
    if (!turn) return;
    output += `${String(++count).padStart(2, '0')} fixture output — no command executed\n`;
    if (count === 1) update({ sessionUpdate: 'config_option_update', configOptions: configOptions() });
    update({ sessionUpdate: 'tool_call_update', toolCallId: id, content: [{ type: 'content', content: { type: 'text', text: output } }] });
    if (count === limit) {
      update({ sessionUpdate: 'tool_call_update', toolCallId: id, status: 'completed', rawOutput: { exitCode: 0 } });
      update({ sessionUpdate: 'agent_message_chunk', messageId: `assistant-${turn.id}`, content: { type: 'text', text: `Offline ACP response. Model: ${model}. Effort: ${effort}.\n\n` + Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: streamed fixture content, no model request.\n\n`).join('') } });
      finish('end_turn');
    }
  }, 35);
}
createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line);
  if (!message.method) {
    if (turn && message.id === `permission-${turn.id}`) {
      if (message.result?.outcome?.outcome === 'selected' && message.result.outcome.optionId === 'allow') execute();
      else { update({ sessionUpdate: 'tool_call_update', toolCallId: `tool-${turn.id}`, status: 'failed', content: [{ type: 'content', content: { type: 'text', text: 'Permission not granted. No command executed.' } }] }); finish('end_turn'); }
    }
    return;
  }
  if (message.method === 'initialize') response(message.id, { protocolVersion: 1, agentInfo: { name: process.env.NIMROD_ACP_FIXTURE_AGENT || 'fixture-agent', title: 'Offline fixture', version: '1' }, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } } });
  else if (message.method === 'session/list') {
    if (message.params.cwd !== process.cwd()) { send({ id: message.id, error: { code: -32602, message: 'Wrong offline fixture project' } }); return; }
    if (message.params.cursor === undefined) response(message.id, { sessions: [
      { sessionId: 'outside-project', cwd: process.cwd() + '/another-project', title: 'Outside project fixture' },
    ], nextCursor: 'fixture-page-2' });
    else if (message.params.cursor === 'fixture-page-2') response(message.id, { sessions: [
      { sessionId, cwd: process.cwd(), title: 'Saved offline conversation', updatedAt: '2026-10-16T12:00:00Z' },
    ] });
    else send({ id: message.id, error: { code: -32602, message: 'Unknown offline pagination cursor' } });
  } else if (message.method === 'session/new') {
    response(message.id, { sessionId, configOptions: configOptions() });
    update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'context', description: 'Offline fixture context' }] });
  } else if (message.method === 'session/load') {
    if (message.params.sessionId !== sessionId) { send({ id: message.id, error: { code: -32602, message: 'Unknown offline fixture session' } }); return; }
    // A fixed replay fixture, not a user-history store or provider invocation.
    update({ sessionUpdate: 'user_message_chunk', messageId: 'saved-user', content: { type: 'text', text: 'Saved offline question' } });
    update({ sessionUpdate: 'agent_thought_chunk', messageId: 'saved-thought', content: { type: 'text', text: 'Saved offline reasoning' } });
    update({ sessionUpdate: 'agent_message_chunk', messageId: 'saved-answer', content: { type: 'text', text: 'Saved offline answer' } });
    update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'context', description: 'Offline fixture context' }] });
    response(message.id, { configOptions: configOptions() });
  } else if (message.method === 'session/set_config_option') {
    if (message.params.configId === 'model') model = message.params.value;
    if (message.params.configId === 'effort') effort = message.params.value;
    if (message.params.configId === 'mode') mode = message.params.value;
    response(message.id, { configOptions: configOptions() });
  } else if (message.method === 'session/prompt') {
    if (turn) { send({ id: message.id, error: { code: -32600, message: 'Turn already active' } }); return; }
    turn = message;
    const prompt = message.params.prompt.map(content => content.text || '').join('');
    update({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: prompt } });
    if (prompt.trim() === '/context') {
      update({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Offline context only; no provider request.' } }); finish('end_turn'); return;
    }
    update({ sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: 'This is an offline fixture, not model reasoning.' } });
    const toolCall = { toolCallId: `tool-${message.id}`, name: 'fixture_shell', title: 'Fixture shell output', kind: 'execute', status: 'pending', rawInput: { command: 'printf fixture-only' } };
    update({ sessionUpdate: 'tool_call', ...toolCall });
    send({ id: `permission-${message.id}`, method: 'session/request_permission', params: { sessionId, toolCall: { toolCallId: toolCall.toolCallId }, options: [
      { optionId: 'deny', kind: 'reject_once', name: 'Deny fixture' }, { optionId: 'allow', kind: 'allow_once', name: 'Allow fixture' },
    ] } });
  } else if (message.method === 'session/cancel') finish('cancelled');
  else send({ id: message.id, error: { code: -32601, message: 'Method not found' } });
}).on('close', () => { clearInterval(timer); process.exit(0); });
