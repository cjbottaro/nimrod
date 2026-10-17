import type { ToolCaptureSink } from '../tool-capture';
import type { JsonRecord } from './types';
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const string = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** Select native Pi tool data without capturing the surrounding assistant text/thinking. */
export class PiToolCapture {
  private calls = new Map<unknown, string>();
  private messageSequence = 0;
  private connectionId = crypto.randomUUID();
  constructor(private sink: ToolCaptureSink | undefined) {}
  observe(event: JsonRecord, sessionId: string): void {
    if (event.type === 'message_start' && record(event.message).role === 'assistant') { this.calls.clear(); this.messageSequence++; }
    if (!this.sink?.enabled) return;
    const append = (name: string, payload: unknown, toolCallId?: string) => this.sink!.append({
      source: { backend: 'pi', agent: 'pi' }, sessionId, connectionId: this.connectionId, toolCallId, event: name, payload,
    });
    if (typeof event.type === 'string' && event.type.startsWith('tool_execution_')) {
      append(event.type, event, string(event.toolCallId));
    } else if (event.type === 'message_update') {
      const raw = record(event.assistantMessageEvent);
      if (typeof raw.type !== 'string' || !raw.type.startsWith('toolcall_')) return;
      const id = string(raw.id) || string(record(raw.toolCall).id) || this.calls.get(raw.contentIndex);
      if (id) this.calls.set(raw.contentIndex, id);
      // Pi's partial field is the entire assistant message, including unrelated text/reasoning.
      const { partial: _partial, ...toolEvent } = raw;
      append(`message_update.${raw.type}`, { messageSequence: this.messageSequence, assistantMessageEvent: toolEvent }, id);
    } else if (event.type === 'turn_end' && Array.isArray(event.toolResults)) {
      for (const result of event.toolResults) append('turn_end.toolResult', result, string(record(result).toolCallId));
    } else if (event.type === 'message_start' || event.type === 'message_end') {
      const message = record(event.message);
      if (message.role === 'toolResult') append(`${event.type}.toolResult`, message, string(message.toolCallId));
      else if (event.type === 'message_end' && message.role === 'assistant' && Array.isArray(message.content)) {
        for (const block of message.content) if (record(block).type === 'toolCall') append('message_end.toolCall', block, string(record(block).id));
      }
    }
  }
}
