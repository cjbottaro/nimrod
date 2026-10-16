import { AcpClient, type AcpPermissionRequest, type AcpSessionUpdate } from './client';
import { AcpConnectionError, isRecord, type AcpPacket, type AcpRecord } from './connection';
import type { ConversationState, DisplayMessage, ContentBlock } from '../pi/types';
import type { HostMessage } from '../pi/webview-client';
import { immutableSnapshot } from '../pi/immutable-snapshot';

export interface AcpSessionUi {
  publish(message: HostMessage): void;
  changed(): void;
  notice(message: string): void;
  permission(request: AcpPermissionRequest, signal: AbortSignal): Promise<string | undefined>;
  disconnected(message: string): void;
  completed(failed: boolean, response?: string): void;
}
export interface AcpOption { id: string; name: string; category?: string; current: string; options: { value: string; name: string }[]; legacy?: 'model' | 'mode'; }
const emptyControls = () => ({ ready: false, changing: false, model: null, thinkingLevels: [] });
const text = (value: unknown) => typeof value === 'string' ? value : '';
function stringify(value: unknown): string { return typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? ''; }
function contentText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map(item => {
    if (!isRecord(item)) return stringify(item);
    if (item.type === 'content' && isRecord(item.content)) return item.content.type === 'text' ? text(item.content.text) : stringify(item.content);
    if (item.type === 'diff') return `${text(item.path)}\n--- old\n${text(item.oldText)}\n+++ new\n${text(item.newText)}`;
    return stringify(item);
  }).join('\n');
}
/** ACP semantics -> shared presentation records, never synthetic Pi RPC events. */
export class AcpSession {
  readonly client: AcpClient;
  state: ConversationState = { messages: [], busy: false, status: 'Connecting ACP…', sessionUnavailable: true,
    modelControls: emptyControls(), extensionStatuses: {}, extensionWidgets: {}, queue: { steering: [], followUp: [], authoritative: false } };
  commands: { name: string; description: string }[] = [];
  options: AcpOption[] = [];
  agent?: string;
  private revision = 0;
  private sequence = 0;
  private group?: { key: string; kind: string; messageId?: string };
  private echo?: { key: string; expected: string; seen: string };
  private configuring = false;
  private ended = false;

  constructor(send: (packet: AcpPacket) => void | Promise<void>, private ui: AcpSessionUi) {
    this.client = new AcpClient(send, {
      created: configuration => { this.configure(configuration); this.state = { ...this.state, sessionUnavailable: false, status: 'Idle' }; this.publish(); },
      configured: configuration => { this.configure(configuration); this.publish([]); },
      selected: (kind, id) => { this.options = this.options.map(option => option.legacy === kind ? { ...option, current: id } : option); this.controls(); this.publish([]); },
      update: event => this.update(event),
      permission: ui.permission,
      disconnected: error => {
        this.ended = true;
        this.finishMessages();
        this.state = { ...this.state, sessionUnavailable: true, busy: false, status: 'Disconnected' };
        this.publish(); ui.disconnected(error.message);
      },
    });
  }
  get canSubmit(): boolean { return !this.configuring && !this.ended && this.client.phase === 'idle'; }
  supports(kind: 'model' | 'thinking'): boolean { return this.options.some(option => option.category === (kind === 'model' ? 'model' : 'thought_level')); }
  validatePrompt(value: string): string | undefined {
    if (!this.canSubmit) return 'This ACP session is not idle. Your draft was kept.';
    if (value.trimStart().startsWith('/')) {
      const command = value.trimStart().slice(1).split(/\s/)[0];
      if (!this.commands.some(item => item.name === command)) return 'This command was not advertised by the ACP agent. Nothing was sent; your draft was kept.';
    }
  }
  receive(packet: unknown): void { this.client.receive(packet); }
  disconnect(reason?: unknown): void { this.client.disconnect(reason); }
  async initialize(cwd: string): Promise<void> {
    await this.deadline(this.client.initialize());
    const info = this.client.initialization?.agentInfo;
    this.agent = isRecord(info) ? text(info.name) || undefined : undefined;
    await this.deadline(this.client.newSession(cwd));
  }
  private async deadline<T>(task: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => {
      const error = new AcpConnectionError('ACP startup/configuration timed out. Nothing was retried.');
      this.disconnect(error); reject(error);
    }, 20_000); });
    try { return await Promise.race([task, timeout]); } finally { clearTimeout(timer); }
  }
  async handle(message: AcpRecord): Promise<void> {
    if (message.type === 'stop') { this.client.cancel(); return; }
    if (message.type === 'renderError') { this.ui.notice(text(message.error)); return; }
    if (message.type !== 'prompt') return;
    const value = text(message.text), id = text(message.id);
    const invalid = this.validatePrompt(value);
    if (invalid || !value.trim() || message.images !== undefined) { this.receipt(id, 'rejected', invalid || 'This ACP proof of concept accepts text only.'); return; }
    this.group = undefined;
    const key = `acp:user:${++this.sequence}`;
    this.echo = { key, expected: value, seen: '' };
    this.ui.publish({ type: 'submissionMessage', id, key });
    this.state = { ...this.state, messages: [...this.state.messages, { key, role: 'user', content: value }], busy: true, status: 'Working…' };
    this.publish();
    try {
      const reason = await this.client.prompt(value);
      if (this.ended) return;
      this.finishMessages();
      this.state = { ...this.state, busy: false, status: reason === 'cancelled' ? 'Stopped' : 'Idle' };
      this.publish();
      // This is turn completion, not acceptance acknowledgement. Local Send
      // effects and user preview correlation already happened before dispatch.
      this.receipt(id, 'accepted');
      if (reason !== 'cancelled') this.ui.completed(reason === 'refusal', this.responseText());
    } catch (error) {
      const unknown = error instanceof AcpConnectionError;
      this.receipt(id, unknown ? 'unknown' : 'rejected', error instanceof Error ? error.message : String(error));
      this.finishMessages();
      this.state = { ...this.state, busy: false, status: this.ended ? 'Disconnected' : 'Idle' };
      this.publish();
      if (!unknown) this.ui.completed(true);
    } finally { this.echo = undefined; this.group = undefined; }
  }
  async selectOption(option: AcpOption, choose: (title: string, values: string[], current?: string) => Promise<string | undefined>): Promise<void> {
    if (!this.canSubmit) throw new Error('ACP configuration is available while idle.');
    const values = option.options.map((value, index) => `${index + 1}. ${value.name}`);
    const selected = await choose(option.name, values, values[option.options.findIndex(value => value.value === option.current)]);
    if (!selected) return;
    if (!this.canSubmit || !this.options.includes(option)) throw new Error('ACP configuration changed while the picker was open. Open it again.');
    const selectedOption = option.options[values.indexOf(selected)];
    if (!selectedOption) return;
    this.configuring = true;
    this.state = { ...this.state, modelControls: { ...this.state.modelControls, changing: true } }; this.publish();
    try {
      if (option.legacy === 'model') await this.deadline(this.client.setModel(selectedOption.value));
      else if (option.legacy === 'mode') await this.deadline(this.client.setMode(selectedOption.value));
      else await this.deadline(this.client.setConfigOption(option.id, selectedOption.value));
    } finally {
      this.configuring = false;
      this.state = { ...this.state, modelControls: { ...this.state.modelControls, changing: false } }; this.publish();
    }
  }
  private receipt(id: string, outcome: 'accepted' | 'rejected' | 'unknown', error?: string): void { this.ui.publish({ type: 'submissionReceipt', id, outcome, error }); }
  private publish(rows?: DisplayMessage[]): void {
    const base = this.revision++;
    this.ui.publish({ type: 'snapshot', state: this.state, commands: this.commands, transcript: { base, revision: this.revision, ...(rows ? { rows } : {}) } });
    this.ui.changed();
  }
  private replace(key: string, next: DisplayMessage): void {
    const index = this.state.messages.findIndex(message => message.key === key);
    const messages = this.state.messages.slice();
    if (index < 0) messages.push(next); else messages[index] = next;
    this.state = { ...this.state, messages };
    // New rows need full ordering; existing rows use the engine's dirty-row path.
    this.publish(index < 0 ? undefined : [next]);
  }
  private update({ update }: AcpSessionUpdate): void {
    const kind = update.sessionUpdate;
    if (['agent_message_chunk', 'agent_thought_chunk', 'user_message_chunk'].includes(kind)) {
      if (!isRecord(update.content)) throw new Error('Invalid ACP message content');
      const content = update.content;
      if (kind === 'user_message_chunk' && this.echo && content.type === 'text') {
        this.echo.seen += text(content.text);
        if (!this.echo.expected.startsWith(this.echo.seen)) this.replace(this.echo.key, { key: this.echo.key, role: 'user', content: this.echo.seen });
        return;
      }
      const groupKind = `${kind}:${text(content.type)}`;
      const messageId = text(update.messageId) || undefined;
      if (!this.group || this.group.kind !== groupKind || this.group.messageId !== messageId) this.group = { key: `acp:message:${++this.sequence}`, kind: groupKind, messageId };
      const key = this.group.key;
      const previous = this.state.messages.find(message => message.key === key);
      const thought = kind === 'agent_thought_chunk';
      if (content.type === 'text') {
        const old = Array.isArray(previous?.content) ? previous.content[0] : undefined;
        const value = (thought ? old?.thinking : old?.text) || '';
        const block: ContentBlock = thought ? { type: 'thinking', thinking: value + text(content.text), thinkingComplete: false } : { type: 'text', text: value + text(content.text) };
        this.replace(key, { key, role: kind === 'user_message_chunk' ? 'user' : 'assistant', content: [block] });
      } else this.replace(key, { key, role: kind === 'user_message_chunk' ? 'user' : 'assistant', content: stringify(content) });
      return;
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      if (typeof update.toolCallId !== 'string') throw new Error('Invalid ACP tool identity');
      this.group = undefined;
      const key = `acp:tool:${update.toolCallId}`;
      const previous = this.state.messages.find(message => message.key === key);
      const retained = previous?.toolNative;
      const native = immutableSnapshot<AcpRecord>({ ...(isRecord(retained) ? retained : {}), ...update });
      const status = text(native.status);
      const terminal = status === 'completed' || status === 'failed';
      const output = contentText(native.content) || (native.rawOutput === undefined ? '' : stringify(native.rawOutput));
      this.replace(key, { key, role: 'tool', toolCallId: update.toolCallId, toolName: text(native.kind) || 'other', toolKind: text(native.kind), toolTitle: text(native.title) || 'Tool',
        toolSource: { backend: 'acp', ...(this.agent ? { agent: this.agent } : {}) }, toolNative: native,
        toolArguments: native.rawInput, output, hasStreamingOutput: !terminal && !!output, ...(terminal ? { resultOutput: output, toolStatus: 'result' as const } : status === 'in_progress' ? { toolStatus: 'running' as const } : {}), isError: status === 'failed' });
      return;
    }
    if (kind === 'available_commands_update') {
      if (!Array.isArray(update.availableCommands)) throw new Error('Invalid ACP command list');
      this.commands = update.availableCommands.filter(isRecord).filter(item => typeof item.name === 'string' && typeof item.description === 'string').map(item => ({ name: text(item.name), description: text(item.description) }));
    } else if (kind === 'config_option_update') this.configure({ configOptions: update.configOptions });
    else if (kind === 'current_mode_update') { this.options = this.options.map(option => option.legacy === 'mode' || option.category === 'mode' ? { ...option, current: text(update.currentModeId) } : option); this.controls(); }
    else if (kind === 'session_info_update' && typeof update.title === 'string') this.state = { ...this.state, sessionName: update.title };
    else if (kind === 'plan') this.state = { ...this.state, extensionWidgets: { plan: { lines: Array.isArray(update.entries) ? update.entries.filter(isRecord).map(entry => `${text(entry.status)} · ${text(entry.content)}`) : [], placement: 'aboveEditor' } } };
    else if (kind === 'usage_update' && typeof update.used === 'number' && typeof update.size === 'number') this.state = { ...this.state, sessionStats: { context: { tokens: update.used, contextWindow: update.size, percent: update.size > 0 ? update.used / update.size * 100 : undefined } } };
    this.publish([]);
  }
  private configure(value: AcpRecord): void {
    if (Array.isArray(value.configOptions)) {
      this.options = value.configOptions.filter(isRecord).flatMap(option => {
        if (option.type !== 'select' || typeof option.id !== 'string' || typeof option.name !== 'string' || typeof option.currentValue !== 'string' || !Array.isArray(option.options)) return [];
        const available = option.options.filter(isRecord).flatMap(item => Array.isArray(item.options) ? item.options.filter(isRecord) : [item]).filter(item => typeof item.value === 'string' && typeof item.name === 'string').map(item => ({ value: text(item.value), name: text(item.name) }));
        return [{ id: option.id, name: option.name, category: text(option.category), current: option.currentValue, options: available }];
      });
    } else if (!this.options.length) {
      if (isRecord(value.models) && Array.isArray(value.models.availableModels)) this.options.push({ id: 'model', name: 'Model', category: 'model', legacy: 'model', current: text(value.models.currentModelId), options: value.models.availableModels.filter(isRecord).map(model => ({ value: text(model.modelId), name: text(model.name) })) });
      if (isRecord(value.modes) && Array.isArray(value.modes.availableModes)) this.options.push({ id: 'mode', name: 'Mode', category: 'mode', legacy: 'mode', current: text(value.modes.currentModeId), options: value.modes.availableModes.filter(isRecord).map(mode => ({ value: text(mode.id), name: text(mode.name) })) });
    }
    this.controls();
  }
  private controls(): void {
    const model = this.options.find(option => option.category === 'model'), thinking = this.options.find(option => option.category === 'thought_level');
    this.state = { ...this.state, modelControls: { ready: true, changing: this.configuring || this.state.busy, model: model ? { id: model.options.find(option => option.value === model.current)?.name || model.current, provider: 'ACP' } : null, thinkingLevel: thinking?.current, thinkingLevels: thinking?.options.map(option => option.value) || [] } };
  }
  private finishMessages(): void {
    this.state = { ...this.state, messages: this.state.messages.map(message => {
      if (message.role === 'tool' && message.toolStatus !== 'result') return { ...message, uiPhase: 'stopped' as const };
      if (Array.isArray(message.content)) return { ...message, content: message.content.map(block => block.type === 'thinking' ? { ...block, thinkingComplete: true } : block) };
      return message;
    }) };
  }
  private responseText(): string | undefined {
    return this.state.messages.filter(message => message.role === 'assistant').slice(-1).flatMap(message => Array.isArray(message.content) ? message.content.map(block => block.text || '') : [text(message.content)]).join('') || undefined;
  }
}
