import { CopilotConnection, record, type BridgeRequest } from './connection';
import type { DisplayMessage } from '../conversation-model';
import type { ConversationViewMessage, ConversationViewState } from '../conversation-view-host';
import type { ToolCaptureSink } from '../tool-capture';
import { copilotToolResult } from './tool-result';

interface Model { id: string; name: string; supportedReasoningEfforts?: string[]; capabilities?: { supports?: { reasoningEffort?: boolean } }; policy?: { state: string }; }
export interface CopilotSessionUi {
  publish(message: ConversationViewMessage): void;
  changed(): void;
  identified(id: string): void;
  disconnected(reason: string): void;
  completed(failed: boolean, response?: string): void;
  notice(message: string): void;
  decision(kind: 'permission' | 'input', request: Record<string, unknown>, signal: AbortSignal): Promise<Record<string, unknown> | undefined>;
  toolCapture?: ToolCaptureSink;
}
/** SDK semantic events project directly to shared presentation, never Pi/ACP events. */
export class CopilotSession {
  readonly connection: CopilotConnection;
  state: Omit<ConversationViewState, 'messages'> & { messages: DisplayMessage[]; sessionName?: string } = {
    messages: [], sessionUnavailable: true, busy: false, status: 'Connecting Copilot…', controls: [],
  };
  private revision = 0;
  private indices = new Map<string, number>();
  private events = new Set<string>();
  private shellSequences = new Map<string, number>();
  private models: Model[] = [];
  private model?: string;
  private effort?: string;
  private configuring = false;
  private configurationVersion = 0;
  private controlsSignature = '';
  private ended = false;
  private replaying = false;
  private failed = false;
  private stopped = false;
  private sessionId = '';
  private echo?: { key: string };
  private decisions = new AbortController();
  private captureConnectionId = crypto.randomUUID();
  constructor(send: (message: BridgeRequest) => Promise<void>, private ui: CopilotSessionUi) {
    this.connection = new CopilotConnection(send, packet => this.packet(packet), reason => {
      this.ended = true; this.decisions.abort(); this.finish();
      this.state = { ...this.state, sessionUnavailable: true, busy: false, status: 'Disconnected' };
      this.publish(); ui.disconnected(reason);
    });
  }
  get canSubmit(): boolean { return !this.ended && !this.state.sessionUnavailable && !this.state.busy && !this.configuring; }
  supports(kind: 'model' | 'thinking'): boolean {
    const model = this.models.find(model => model.id === this.model);
    return kind === 'model' ? this.models.length > 0 : model?.capabilities?.supports?.reasoningEffort !== false && !!model?.supportedReasoningEfforts?.length;
  }
  validatePrompt(text: string): string | undefined {
    if (!this.canSubmit) return 'Copilot is not idle or is still connecting. Your draft was kept.';
    if (text.trimStart().startsWith('/')) return 'Copilot CLI slash commands are not exposed by this SDK integration. Nothing was sent; your draft was kept.';
  }
  receive(packet: unknown): void { this.connection.receive(packet); }
  disconnect(reason: string): void { this.connection.disconnect(reason); }
  async initialize(sessionId?: string): Promise<void> {
    await this.connection.request('initialize');
    await this.connection.request('connect', sessionId === undefined ? {} : { sessionId });
    if (this.state.sessionUnavailable) throw new Error('Copilot did not publish a connected session');
  }
  async handle(message: Record<string, unknown>): Promise<void> {
    if (message.type === 'renderError') { this.ui.notice(String(message.error)); return; }
    if (message.type === 'stop') {
      if (this.state.busy) { this.stopped = true; this.cancelDecisions(); await this.connection.request('cancel'); }
      return;
    }
    if (message.type !== 'prompt') return;
    const id = String(message.id ?? ''), text = typeof message.text === 'string' ? message.text : '';
    const invalid = this.validatePrompt(text);
    if (invalid || !text.trim() || message.images !== undefined) {
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'rejected', error: invalid || 'Copilot sessions currently accept non-empty text only.' }); return;
    }
    const key = `copilot:user:pending:${id}`;
    this.echo = { key };
    this.ui.publish({ type: 'submissionMessage', id, key });
    this.failed = false; this.stopped = false;
    this.state = { ...this.state, busy: true, status: 'Working…' };
    this.replace(key, { key, role: 'user', content: text });
    try {
      await this.connection.request('prompt', { text });
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'accepted' });
    } catch (error) {
      // An SDK error after dispatch is not proof the runtime rejected delivery.
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'unknown', error: `Copilot delivery was not confirmed: ${String(error)}. Nothing was replayed.` });
      this.disconnect(`Copilot delivery was not confirmed: ${String(error)}`);
    }
  }
  async selectPreference(kind: 'model' | 'thinking', choose: (values: string[], current?: string) => Promise<string | undefined>): Promise<void> {
    if (!this.canSubmit) throw new Error('Copilot configuration is available while idle.');
    const models = this.models, model = this.model;
    const options = kind === 'model' ? models.map(item => ({ value: item.id, name: `${item.name} (${item.id})` }))
      : (models.find(item => item.id === model)?.supportedReasoningEfforts ?? []).map(value => ({ value, name: value }));
    const labels = options.map((option, index) => `${index + 1}. ${option.name}`);
    const selected = await choose(labels, labels[options.findIndex(option => option.value === (kind === 'model' ? this.model : this.effort))]);
    if (!selected) return;
    if (!this.canSubmit || this.models !== models || this.model !== model) throw new Error('Copilot configuration changed. Open the picker again.');
    const value = options[labels.indexOf(selected)]?.value;
    if (!value) return;
    this.configuring = true; this.publish([]);
    try {
      const version = this.configurationVersion;
      const result = await this.connection.request('configure', { model: kind === 'model' ? value : model, ...(kind === 'thinking' ? { effort: value } : {}) });
      if (version === this.configurationVersion) this.configuration(result);
    } catch (error) {
      this.disconnect(`Copilot configuration was not confirmed: ${String(error)}. Reconnect explicitly to read the authoritative configuration.`);
      throw error;
    } finally { this.configuring = false; this.publish([]); }
  }
  private configuration(value: unknown): void {
    if (!record(value)) throw new Error('Invalid Copilot model snapshot');
    this.model = typeof value.modelId === 'string' ? value.modelId : undefined;
    this.effort = typeof value.reasoningEffort === 'string' ? value.reasoningEffort : undefined;
  }
  private packet(packet: Record<string, unknown>): void {
    if (packet.kind === 'identified') {
      if (typeof packet.sessionId !== 'string' || !packet.sessionId || this.sessionId && this.sessionId !== packet.sessionId) throw new Error('Invalid or changed Copilot session identity');
      this.ui.identified(packet.sessionId); this.sessionId = packet.sessionId;
    } else if (packet.kind === 'connected') {
      if (typeof packet.sessionId !== 'string' || !packet.sessionId || !Array.isArray(packet.events) || !Array.isArray(packet.models)) throw new Error('Invalid Copilot connection snapshot');
      if (this.sessionId && this.sessionId !== packet.sessionId) throw new Error('Copilot connection snapshot changed its saved identity');
      if (!this.sessionId) { this.ui.identified(packet.sessionId); this.sessionId = packet.sessionId; }
      this.models = packet.models.filter(record).filter(model => typeof model.id === 'string' && typeof model.name === 'string' && (!record(model.policy) || model.policy.state === 'enabled'))
        .map(model => ({ ...model, supportedReasoningEfforts: Array.isArray(model.supportedReasoningEfforts) ? model.supportedReasoningEfforts.filter((value): value is string => typeof value === 'string' && !!value) : undefined })) as unknown as Model[];
      this.replaying = true;
      try { for (const event of packet.events) this.event(event); this.finish(); }
      finally { this.replaying = false; }
      this.configuration(packet.model);
      this.state = { ...this.state, sessionUnavailable: false, busy: false, status: 'Idle' }; this.publish();
    } else if (packet.kind === 'event') this.event(packet.event);
    else if (packet.kind === 'permission' || packet.kind === 'input') {
      if (typeof packet.id !== 'string' || !record(packet.request)) throw new Error('Invalid Copilot decision request');
      const id = packet.id;
      const signal = this.decisions.signal;
      if (packet.kind === 'permission') this.capture('permission.request', packet.request);
      void this.ui.decision(packet.kind, packet.request, signal).then(async choice => {
        if (signal.aborted) return;
        if (!choice && packet.kind === 'input') {
          this.stopped = true;
          await this.connection.request('cancel');
          return;
        }
        await this.connection.request('decision', { decisionId: id, value: choice ?? { kind: 'denied-interactively-by-user' } });
      }).catch(error => { if (!signal.aborted) { this.ui.notice(`Copilot decision failed: ${String(error)}`); this.disconnect(String(error)); } });
    } else throw new Error('Unknown Copilot bridge record');
  }
  private event(raw: unknown): void {
    if (!record(raw) || typeof raw.type !== 'string' || typeof raw.id !== 'string' || !raw.id || !record(raw.data)) throw new Error('Invalid Copilot SDK event');
    if (this.events.has(raw.id)) return;
    this.events.add(raw.id);
    const data = raw.data, type = raw.type;
    const originLabel = typeof raw.agentId === 'string' && raw.agentId ? `Copilot agent ${raw.agentId}` : undefined;
    const string = (key: string) => typeof data[key] === 'string' ? data[key] as string : '';
    if (type.startsWith('tool.')) this.capture(type, raw);
    if (type === 'user.message') {
      const content = string('content'), echo = this.echo;
      const key = echo && !raw.agentId ? echo.key : `copilot:user:${raw.id}`;
      this.replace(key, { key, role: 'user', originLabel, content: Array.isArray(data.attachments) && data.attachments.length ? [
        { type: 'text', text: content }, { type: 'raw', text: JSON.stringify({ attachments: data.attachments }, null, 2) },
      ] : content });
      if (echo?.key === key) this.echo = undefined;
    } else if (['assistant.message_delta', 'assistant.message', 'assistant.reasoning_delta', 'assistant.reasoning'].includes(type)) {
      const thinking = type.startsWith('assistant.reasoning'), delta = type.endsWith('_delta');
      const identity = thinking ? string('reasoningId') : string('messageId');
      if (!identity) throw new Error('Copilot content event has no stable identity');
      const key = `copilot:${raw.agentId || 'main'}:${thinking ? 'reasoning' : 'assistant'}:${identity}`;
      const previous = this.message(key), block = Array.isArray(previous?.content) ? previous.content[0] : undefined;
      if (delta && previous?.streaming === false) return;
      const content = delta ? (thinking ? block?.thinking : block?.text) || '' : '';
      const value = content + string(delta ? 'deltaContent' : 'content');
      this.replace(key, { key, role: 'assistant', originLabel, streaming: delta, content: [thinking
        ? { type: 'thinking', thinking: value, thinkingComplete: !delta }
        : { type: 'text', text: value }] });
    } else if (['tool.execution_start', 'tool.execution_partial_result', 'tool.execution_progress', 'tool.execution_complete', 'tool.shell_output'].includes(type)) {
      const id = string('toolCallId'); if (!id) throw new Error('Copilot tool event has no call identity');
      const key = `copilot:tool:${raw.agentId || 'main'}:${id}`, previous = this.message(key);
      const native = record(previous?.toolNative) ? previous.toolNative : {};
      const complete = type === 'tool.execution_complete', start = type === 'tool.execution_start';
      if ((previous?.toolStatus === 'result' || previous?.toolStatus === 'finished') && !complete) return;
      if (type === 'tool.shell_output' && typeof data.sequence === 'number') {
        const sequence = this.shellSequences.get(key);
        if (sequence !== undefined && data.sequence <= sequence) return;
        this.shellSequences.set(key, data.sequence);
      }
      const result = record(data.result) ? data.result : undefined;
      const error = record(data.error) ? data.error : undefined;
      const name = start ? string('toolName') : previous?.toolName;
      this.replace(key, { ...previous, key, role: 'tool', originLabel, toolCallId: raw.agentId ? `${String(raw.agentId)}:${id}` : id, toolName: name,
        toolSource: { backend: 'copilot-sdk', agent: 'copilot' }, toolTitle: start ? string('toolTitle') || name : previous?.toolTitle,
        toolKind: toolKind(name), toolArguments: start ? data.arguments : previous?.toolArguments,
        toolNative: { ...native, ...(raw.agentId ? { agentId: raw.agentId } : {}), [type]: data }, streaming: !complete, toolStatus: complete ? 'result' : 'running',
        ...(type === 'tool.shell_output' ? { output: (previous?.output || '') + string('text'), hasStreamingOutput: true } : {}),
        ...(type === 'tool.execution_partial_result' ? { output: string('partialOutput'), hasStreamingOutput: true } : {}),
        ...(complete ? { isError: data.success === false, resultOutput: result ? copilotToolResult(result) : JSON.stringify(error ?? data, null, 2) } : {}),
      });
    } else if (type === 'session.model_change' && !raw.agentId) {
      this.configurationVersion++;
      this.model = string('newModel') || undefined;
      this.effort = typeof data.reasoningEffort === 'string' ? data.reasoningEffort : undefined;
      this.publish([]);
    } else if (type === 'session.model_deselected' && !raw.agentId) { this.configurationVersion++; this.model = undefined; this.effort = undefined; this.publish([]); }
    else if (type === 'session.usage_info' && !raw.agentId && typeof data.currentTokens === 'number' && typeof data.tokenLimit === 'number') {
      this.state = { ...this.state, metrics: `${data.currentTokens.toLocaleString()} / ${data.tokenLimit.toLocaleString()} context tokens` }; this.publish([]);
    }
    else if (type === 'session.error') {
      if (!raw.agentId) this.failed = true;
      const key = `copilot:error:${raw.id}`; this.replace(key, { key, role: 'assistant', originLabel, content: [{ type: 'text', text: string('message') || JSON.stringify(data, null, 2) }], isError: true });
      if (!this.replaying && !raw.agentId) this.endTurn();
    } else if (type === 'session.mode_changed' && !raw.agentId && !this.replaying && data.newMode !== 'interactive') {
      this.disconnect(`Copilot changed to unsupported mode "${String(data.newMode)}". Reconnect only after changing it to interactive in Copilot.`);
    } else if (type === 'session.title_changed' && !raw.agentId) { this.state = { ...this.state, sessionName: string('title') }; this.publish([]); }
    else if (type === 'session.idle' && !raw.agentId) {
      if (this.replaying) return;
      if (data.mode === 'autopilot') { this.disconnect('Copilot reported an unsupported autonomous session. No further prompt was sent.'); return; }
      this.endTurn();
    } else if (type === 'assistant.turn_start' && !raw.agentId && !this.replaying) {
      this.state = { ...this.state, busy: true, status: 'Working…' }; this.publish([]);
    }
  }
  private endTurn(): void {
    const working = this.state.busy;
    this.finish(); this.echo = undefined; this.cancelDecisions();
    this.state = { ...this.state, busy: false, status: this.stopped ? 'Stopped' : this.failed ? 'Failed' : 'Idle' };
    this.publish([]);
    if (working && !this.stopped) this.ui.completed(this.failed, this.failed ? undefined : this.response());
  }
  private message(key: string): DisplayMessage | undefined { const index = this.indices.get(key); return index === undefined ? undefined : this.state.messages[index]; }
  private replace(key: string, message: DisplayMessage): void {
    const index = this.indices.get(key), messages = this.state.messages.slice();
    if (index === undefined) { this.indices.set(key, messages.length); messages.push(message); }
    else messages[index] = message;
    this.state = { ...this.state, messages };
    if (!this.replaying) this.publish(index === undefined ? undefined : [message]);
  }
  private finish(): void {
    for (const message of this.state.messages) {
      const content = Array.isArray(message.content) ? message.content.map(block => block.type === 'thinking' && !block.thinkingComplete ? { ...block, thinkingComplete: true } : block) : message.content;
      if (message.streaming || Array.isArray(content) && content.some((block, index) => Array.isArray(message.content) && block !== message.content[index]))
        this.replace(message.key, { ...message, content, streaming: false, ...(message.toolStatus === 'running' ? { toolStatus: 'finished' as const, uiPhase: 'stopped' as const } : {}) });
    }
  }
  private response(): string | undefined {
    const message = [...this.state.messages].reverse().find(message => message.role === 'assistant' && !message.originLabel && Array.isArray(message.content) && message.content.some(block => block.type === 'text'));
    return Array.isArray(message?.content) ? message.content.map(block => block.text || '').join('') : undefined;
  }
  private cancelDecisions(): void { this.decisions.abort(); this.decisions = new AbortController(); }
  private capture(event: string, payload: Record<string, unknown>): void {
    const data = record(payload.data) ? payload.data : payload;
    if (!this.replaying && this.ui.toolCapture?.enabled) this.ui.toolCapture.append({ source: { backend: 'copilot-sdk', agent: 'copilot' }, sessionId: this.sessionId, connectionId: this.captureConnectionId, toolCallId: typeof data.toolCallId === 'string' ? data.toolCallId : undefined, event, payload });
  }
  private publish(rows?: DisplayMessage[]): void {
    if (this.replaying) return;
    const disabled = !this.canSubmit;
    const signature = JSON.stringify([disabled, this.model, this.effort, this.supports('model'), this.supports('thinking')]);
    if (signature !== this.controlsSignature) {
      this.controlsSignature = signature;
      this.state = { ...this.state, controls: [
        ...(this.supports('model') ? [{ id: 'model', label: this.model || 'Copilot default', title: 'Select Copilot model', disabled }] : []),
        ...(this.supports('thinking') ? [{ id: 'thinking', label: this.effort || 'Model default', title: 'Select Copilot reasoning effort', disabled }] : []),
      ] };
    }
    const base = this.revision++;
    this.ui.publish({ type: 'snapshot', state: this.state, transcript: { base, revision: this.revision, ...(rows ? { rows } : {}) } }); this.ui.changed();
  }
}
function toolKind(name?: string): string {
  if (['bash', 'powershell', 'shell'].includes(name || '')) return 'execute';
  if (['view', 'read_file', 'glob'].includes(name || '')) return 'read';
  if (['grep', 'web_search'].includes(name || '')) return 'search';
  if (name === 'web_fetch') return 'fetch';
  if (['edit', 'create', 'apply_patch'].includes(name || '')) return 'edit';
  return 'other';
}
