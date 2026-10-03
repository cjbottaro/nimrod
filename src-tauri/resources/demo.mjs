// Deterministic offline fixture. No Pi, model, filesystem tools, or network calls.
import { createInterface } from 'node:readline';
const emit = value => process.stdout.write(JSON.stringify(value) + '\n');
const text = text => ({ type: 'text', text });
const model = { provider: 'fixture', id: 'offline-demo', name: 'Offline demo', reasoning: true };
let active = false, compacting = false, pendingCompaction, name = 'Demo', thinking = 'medium', generation = 0, compactionGeneration = 0, queue = [];
const messages = [];
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const reply = (request, data) => emit({ type: 'response', id: request.id, command: request.type, success: true, data });
async function run(prompt) {
  active = true;
  const run = ++generation;
  const user = { role: 'user', content: prompt, timestamp: Date.now() };
  messages.push(user); emit({ type: 'agent_start' }); emit({ type: 'message_end', message: user });
  const assistant = { role: 'assistant', timestamp: Date.now() + 1, content: [] };
  emit({ type: 'message_start', message: assistant });
  emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start', contentIndex: 0 } });
  emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', contentIndex: 0, delta: 'Exercising the real Rust transport with synthetic events.' } });
  await delay(400); if (run !== generation) return;
  const tool = { type: 'toolCall', id: `demo-${run}`, name: 'bash', arguments: { command: 'demo: stream fixture output (not executed)' } };
  emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_start', contentIndex: 1, id: tool.id, toolName: tool.name } });
  emit({ type: 'message_update', assistantMessageEvent: { type: 'toolcall_end', contentIndex: 1, toolCall: tool } });
  emit({ type: 'tool_execution_start', toolCallId: tool.id, toolName: tool.name, args: tool.arguments });
  for (let i = 1; i <= 8; i++) {
    await delay(220); if (run !== generation) return;
    emit({ type: 'tool_execution_update', toolCallId: tool.id, toolName: tool.name, partialResult: { content: [text(Array.from({ length: i }, (_, n) => `Fixture step ${n + 1}/8`).join('\n'))] } });
  }
  emit({ type: 'tool_execution_end', toolCallId: tool.id, toolName: tool.name, result: { content: [text('Fixture complete. No command was executed.')] }, isError: false });
  const answer = 'Nimrod is talking to its Rust host. **This is fixture output, not a model response.**\n\n```rust\nlet project = "Nimrod";\n```\n\nTry sending while this runs to test steering, or press Stop. [Open this project’s README](README.md:1).';
  emit({ type: 'message_update', assistantMessageEvent: { type: 'text_start', contentIndex: 2 } });
  for (const chunk of answer.match(/.{1,12}/gs) || []) {
    await delay(35); if (run !== generation) return;
    emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', contentIndex: 2, delta: chunk } });
  }
  assistant.content = [{ type: 'thinking', thinking: 'Exercising the real Rust transport with synthetic events.' }, tool, text(answer)];
  messages.push(assistant); emit({ type: 'message_end', message: assistant }); emit({ type: 'agent_end', messages: [assistant] });
  if (queue.length) {
    const next = queue.shift(); emit({ type: 'queue_update', steering: queue, followUp: [] }); void runNext(next);
  } else { active = false; emit({ type: 'agent_settled' }); }
}
const runNext = prompt => run(prompt);
async function compact(request) {
  pendingCompaction = request;
  compacting = true;
  const run = ++compactionGeneration;
  emit({ type: 'compaction_start', reason: 'manual' });
  await delay(120);
  if (run !== compactionGeneration) return;
  pendingCompaction = undefined;
  compacting = false;
  const result = { summary: request.customInstructions ? `Fixture compacted context: ${request.customInstructions}` : 'Fixture compacted context', estimatedTokensAfter: 0 };
  emit({ type: 'compaction_end', reason: 'manual', result });
  reply(request, result);
}
emit({ type: 'extension_ui_request', id: 'scope', method: 'setStatus', statusKey: 'pi-gui:model-scope', statusText: '[]' });
createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  switch (request.type) {
    case 'get_state': reply(request, { model, thinkingLevel: thinking, isStreaming: active, isCompacting: compacting, sessionName: name, pendingMessageCount: queue.length }); break;
    case 'get_messages': reply(request, { messages }); break;
    case 'get_available_models': reply(request, { models: [model] }); break;
    case 'get_available_thinking_levels': reply(request, { levels: ['off', 'low', 'medium', 'high'] }); break;
    case 'get_commands': reply(request, { commands: [] }); break;
    case 'get_session_stats': reply(request, { cost: 0, contextUsage: { tokens: 0, contextWindow: 10000, percent: 0 } }); break;
    case 'set_session_name': name = request.name; reply(request); break;
    case 'set_model': reply(request, model); break;
    case 'set_thinking_level': thinking = request.level; reply(request); break;
    case 'prompt':
      reply(request);
      if (active) { queue.push(request.message); emit({ type: 'queue_update', steering: queue, followUp: [] }); }
      else void run(request.message);
      break;
    case 'compact':
      if (active || compacting) emit({ type: 'response', id: request.id, command: request.type, success: false, error: 'Fixture is not idle' });
      else void compact(request);
      break;
    case 'clear_queue': { const steering = queue; queue = []; emit({ type: 'queue_update', steering: [], followUp: [] }); reply(request, { steering, followUp: [] }); break; }
    case 'abort':
      generation++; active = false;
      if (compacting) {
        compacting = false; compactionGeneration++; emit({ type: 'compaction_end', reason: 'manual', aborted: true });
        if (pendingCompaction) { emit({ type: 'response', id: pendingCompaction.id, command: 'compact', success: false, error: 'Fixture compaction cancelled' }); pendingCompaction = undefined; }
      } else emit({ type: 'agent_settled' });
      reply(request);
      break;
    case 'extension_ui_response': break;
    default: emit({ type: 'response', id: request.id, command: request.type, success: false, error: 'Unsupported fixture command' });
  }
}).on('close', () => process.exit(0));
