import type { ToolCaptureSink } from '../tool-capture';
import type { JsonRecord } from './types';
const record = (value: unknown): JsonRecord => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : {};
const string = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** Native Pi transcript/debug capture. The legacy module/type names preserve existing plumbing. */
export class PiToolCapture {
  private calls = new Map<unknown, string>();
  private connectionId = crypto.randomUUID();
  constructor(private sink: ToolCaptureSink | undefined) {}
  observe(event: JsonRecord, sessionId: string): void {
    if (event.type === 'message_start' && record(event.message).role === 'assistant') this.calls.clear();
    if (!this.sink?.enabled) return;
    let toolCallId = string(event.toolCallId) || string(record(event.message).toolCallId);
    if (event.type === 'message_update') {
      const raw = record(event.assistantMessageEvent);
      if (typeof raw.type === 'string' && raw.type.startsWith('toolcall_')) {
        toolCallId = string(raw.id) || string(record(raw.toolCall).id) || this.calls.get(raw.contentIndex);
        if (toolCallId) this.calls.set(raw.contentIndex, toolCallId);
      }
    }
    this.capture(typeof event.type === 'string' ? event.type : 'unknown', event, sessionId, toolCallId);
  }
  capture(event: string, payload: unknown, sessionId: string, toolCallId?: string): void {
    if (!this.sink?.enabled) return;
    this.sink.append({ source: { backend: 'pi', agent: 'pi' }, sessionId,
      connectionId: this.connectionId, toolCallId, event, payload });
  }
}
