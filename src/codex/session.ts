import { CodexAsyncQuestions, codexAsyncReplies, type CodexAsyncQuestion } from './async-questions';
import type { QuestionAnswer } from '../question-interaction';
import type { OutgoingMessage } from '../session-message-input';
import { CodexClient, type CodexClientHooks, type CodexWriter } from './client';
import { item, nonempty, record, type CodexEvent, type CodexItem } from './protocol';
import { isRecord, RpcConnectionError, type RpcRecord } from '../json-rpc-connection';
import type { DisplayMessage } from '../conversation-model';
import type { ConversationViewMessage, ConversationViewState } from '../conversation-view-host';
import { DEFAULT_IMAGE_INPUT, validateMessageImages, type SessionMessageInput } from '../session-message-input';
import { ConfigurationDeferred, ConfigurationSuperseded, SessionConfigurationController } from '../session-configuration';
import { immutableSnapshot } from '../pi/immutable-snapshot';
import type { TranscriptLogSink } from '../transcript-logs';

export interface CodexSessionUi {
  publish(message: ConversationViewMessage): void;
  changed(): void; notice(message: string): void;
  identified(id: string): void;
  approval: NonNullable<CodexClientHooks['approval']>;
  question?: CodexClientHooks['question'];
  asyncQuestion?(question: CodexAsyncQuestion, signal: AbortSignal): Promise<QuestionAnswer | undefined>;
  interactionFailure?: CodexClientHooks['interactionFailure'];
  disconnected(message: string): void;
  completed(failed: boolean, response?: string): void;
  transcriptLog?: TranscriptLogSink;
}
export interface CodexSessionState extends ConversationViewState { messages: DisplayMessage[]; busy: boolean; status: string; sessionName?: string; }
const string = (value: unknown) => typeof value === 'string' ? value : '';
const json = (value: unknown) => typeof value === 'string' ? value : JSON.stringify(value, null, 2) ?? '';
/** Native Codex items project directly into the shared mounted conversation engine. */
export class CodexSession {
  readonly client: CodexClient;
  readonly configuration: SessionConfigurationController;
  state: CodexSessionState = { messages: [], busy: false, status: 'Connecting Codex…', sessionUnavailable: true,
    statusArea: { capabilities: { metrics: { label: 'Codex-reported tokens and context' }, information: true }, controlsLabel: 'Codex session configuration', controls: [] } };
  private cwd = '';
  private ended = false;
  private hydrating = true;
  private submitting = 0;
  private configuring = false;
  private revision = 0;
  private models: RpcRecord[] = [];
  private selected: Record<string, string | undefined> = {};
  private settingsRevision = 0;
  private positions = new Map<string, number>();
  private native = new Map<string, CodexItem>();
  private live = new Set<string>();
  private aliases = new Map<string, string>();
  private readonly connectionId = crypto.randomUUID();
  private readonly asyncQuestions: CodexAsyncQuestions;
  private readonly deferredAsyncItems = new Map<string, CodexItem>();
  constructor(writer: CodexWriter, private ui: CodexSessionUi) {
    this.asyncQuestions = new CodexAsyncQuestions({
      request: (question, signal) => ui.asyncQuestion ? ui.asyncQuestion(question, signal) : Promise.resolve(undefined),
      send: text => this.submitMessage({ id: `codex-answer:${crypto.randomUUID()}`, text, mode: 'normal' }, true),
      error: message => ui.notice(message),
    });
    this.client = new CodexClient({ write: packet => { this.capture(typeof packet.method === 'string' ? 'request' : 'response', packet); return writer.write(packet); } }, {
      identified: (thread, settings) => {
        ui.identified(thread.id); this.applySettings(settings);
        this.state = { ...this.state, sessionName: string(thread.name) || undefined };
      },
      event: event => this.event(event), approval: ui.approval, question: ui.question,
      interactionFailure: failure => {
        this.capture('interaction.rejected', failure);
        if (ui.interactionFailure) ui.interactionFailure(failure);
        else ui.notice(`Codex interaction ${failure.method} could not be handled: ${failure.reason}. No answer or approval was supplied.`);
      },
      disconnected: error => {
        this.capture('connection.disconnected', { error: error.message });
        this.ended = true; this.asyncQuestions.clear(); this.deferredAsyncItems.clear(); this.configuration?.dispose(error.message);
        this.finishRows(); this.state = { ...this.state, busy: false, sessionUnavailable: true, status: 'Disconnected' };
        this.publish(); ui.disconnected(error.message);
      },
    });
    this.configuration = new SessionConfigurationController({
      capabilities: desired => {
        const availability = this.ended || this.state.sessionUnavailable ? 'unavailable' as const : this.idle ? 'ready' as const : 'deferred' as const;
        const model = this.models.find(model => model.model === (desired.model ?? this.selected.model));
        return [...(this.models.length ? [{ id: 'model', label: 'Model', availability }] : []),
          ...(model && Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length ? [{ id: 'effort', label: 'Thinking level', availability, dependsOn: ['model'] }] : [])];
      },
      get: setting => this.selected[setting],
      choices: async (setting, desired) => {
        await this.refreshModels();
        if (setting === 'model') return this.models.map(model => ({ value: string(model.model), label: string(model.displayName), detail: string(model.model) }));
        const model = this.models.find(model => model.model === (desired.model ?? this.selected.model));
        return Array.isArray(model?.supportedReasoningEfforts) ? model.supportedReasoningEfforts.filter(isRecord).map(effort => ({ value: nonempty(effort.reasoningEffort, 'reasoning effort'), label: string(effort.reasoningEffort), detail: string(effort.description) })) : [];
      },
      apply: async (setting, value, current, dispatched) => {
        if (!this.idle) throw new ConfigurationDeferred();
        await this.refreshModels();
        if (!this.idle) throw new ConfigurationDeferred();
        if (!current()) throw new ConfigurationSuperseded();
        const model = this.models.find(model => model.model === (setting === 'model' ? value : this.selected.model));
        if (!model || setting === 'effort' && !(Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.some(effort => isRecord(effort) && effort.reasoningEffort === value))) throw new Error('This Codex choice is no longer advertised');
        if (setting !== 'model' && setting !== 'effort') throw new Error('Unsupported Codex configuration');
        this.configuring = true;
        const revision = this.settingsRevision;
        try { dispatched(); const result = await this.client.configure(this.cwd, setting, value); if (!this.ended && revision === this.settingsRevision) { this.applySettings(result); this.publish([]); } }
        finally { this.configuring = false; this.publish([]); }
      },
    }, () => this.publish([]));
  }
  get idle(): boolean { return !this.ended && !this.hydrating && !this.submitting && !this.configuring && this.client.phase === 'idle'; }
  validatePrompt(text: string): string | undefined {
    if (this.ended || this.hydrating || this.configuring || this.state.sessionUnavailable) return 'Codex is not ready. Your draft was kept.';
    if (text.trimStart().startsWith('/')) return 'Codex app-server does not advertise CLI slash commands. Nothing was sent; your draft was kept.';
    if (this.state.busy && !this.client.activeTurnId) return 'Codex has not identified the active turn yet. Your draft was kept.';
  }
  readonly messageInput: SessionMessageInput = {
    capabilities: () => {
      const model = this.models.find(model => model.model === this.selected.model);
      return !this.ended && !this.hydrating && Array.isArray(model?.inputModalities) && model.inputModalities.includes('image')
        ? { images: DEFAULT_IMAGE_INPUT } : { imageUnavailableReason: 'The connected Codex model has not advertised image input.' };
    },
    submit: message => this.submitMessage(message),
  };
  private async submitMessage(message: OutgoingMessage, questionAnswer = false): Promise<void> {
    const invalid = this.validatePrompt(message.text);
    let images;
    try { images = validateMessageImages(message.images ?? [], this.messageInput.capabilities()); }
    catch (error) { this.receipt(message.id, 'rejected', String(error)); return; }
    if (invalid || !message.text.trim() && !images.length || message.mode === 'followUp' || this.state.busy && images.length) {
      this.receipt(message.id, 'rejected', invalid || 'Codex supports text steering, not a follow-up queue or image steering.'); return;
    }
    // Ordinary follow-ups supersede optional questions; answering one preserves the others.
    if (!questionAnswer) { this.asyncQuestions.clear(); this.deferredAsyncItems.clear(); }
    const key = `codex:local:${message.id}`; this.aliases.set(message.id, key);
    this.ui.publish({ type: 'submissionMessage', id: message.id, key });
    this.replace({ key, role: 'user', content: images.length ? [...(message.text ? [{ type: 'text', text: message.text }] : []), ...images] : message.text });
    this.submitting++; this.state = { ...this.state, busy: true, status: 'Working…' }; this.publish([]);
    try {
      if (this.client.phase === 'working') await this.client.steer(message.text, message.id);
      else await this.client.startTurn(message.text, message.id, images);
      this.receipt(message.id, 'accepted');
    } catch (error) { this.receipt(message.id, error instanceof RpcConnectionError ? 'unknown' : 'rejected', String(error)); }
    finally {
      this.submitting--;
      if (!this.ended) { this.state = { ...this.state, busy: this.client.phase === 'working', status: this.client.phase === 'working' ? 'Working…' : this.state.status === 'Stopped' ? 'Stopped' : 'Idle' }; this.publish([]); }
    }
  }
  async handle(message: RpcRecord): Promise<void> {
    if (message.type === 'stop') { this.asyncQuestions.clear(); this.deferredAsyncItems.clear(); await this.client.interrupt(); }
    else if (message.type === 'renderError') this.ui.notice(string(message.error));
  }
  receive(packet: unknown): void { this.capture('receive', packet); this.client.receive(packet); }
  disconnect(reason: unknown): void {
    this.capture('connection.disconnect_requested', { error: reason instanceof Error ? reason.message : String(reason) });
    this.client.disconnect(reason);
  }
  recordCleanupFailure(error: unknown): void { this.capture('connection.cleanup_failed', { error: error instanceof Error ? error.message : String(error) }); }
  async initialize(cwd: string, savedId?: string): Promise<void> {
    this.cwd = cwd;
    await this.client.initialize(); await this.client.open(cwd, savedId);
    const history: DisplayMessage[] = [];
    if (savedId) {
      const cursors = new Set<string>(); let cursor: string | undefined;
      do {
        const page = await this.client.listTurns(cursor);
        for (const turn of page.data) {
          this.client.recoverActiveTurn(turn);
          let items = turn.items;
          if (turn.itemsView !== 'full') {
            items = []; const seen = new Set<string>(); let next: string | undefined;
            do {
              const page = await this.client.listItems(turn.id, next); items.push(...page.data.map(entry => entry.item)); next = page.nextCursor ?? undefined;
              if (next && seen.has(next)) throw new Error('Codex item history repeated a cursor'); if (next) seen.add(next);
            } while (next);
          }
          for (const entry of items) history.push(this.project(entry, turn.id, turn.status !== 'inProgress', true));
        }
        cursor = page.nextCursor ?? undefined;
        if (cursor && cursors.has(cursor)) throw new Error('Codex turn history repeated a cursor'); if (cursor) cursors.add(cursor);
      } while (cursor);
    }
    if (this.ended) throw new Error('Codex connection ended while loading history');
    // Live rows win over older snapshots; history establishes ordering only.
    const current = new Map(this.state.messages.map(row => [row.key, row]));
    const merged = new Map(history.map(row => [row.key, this.live.has(row.key) ? current.get(row.key)! : row]));
    for (const row of this.state.messages) if (!merged.has(row.key)) merged.set(row.key, row);
    this.state = { ...this.state, messages: [...merged.values()], busy: this.client.phase === 'working', sessionUnavailable: false, status: this.client.phase === 'working' ? 'Working…' : 'Idle' };
    this.reindex();
    // A stale page can still contain in-progress items after a terminal event
    // arrived during hydration. An idle owner cannot leave those spinners live
    // or infer success for items without a terminal native snapshot.
    if (this.client.phase === 'idle') this.finishRows(true);
    this.hydrating = false;
    // Catalog failure must not make an otherwise valid conversation unavailable.
    try { await this.refreshModels(); } catch (error) { if (!this.ended) this.ui.notice(`Codex model catalog unavailable: ${String(error)}`); }
    if (this.ended) throw new Error('Codex initialization was disconnected');
    for (const native of this.deferredAsyncItems.values()) this.asyncQuestions.offer(native);
    this.deferredAsyncItems.clear();
    this.publish();
  }
  private async refreshModels(): Promise<void> {
    const models: RpcRecord[] = []; const seen = new Set<string>(); let cursor: string | undefined;
    do { const page = await this.client.models(cursor); models.push(...page.data.filter(model => model.hidden !== true)); cursor = page.nextCursor ?? undefined;
      if (cursor && seen.has(cursor)) throw new Error('Codex model catalog repeated a cursor'); if (cursor) seen.add(cursor);
    } while (cursor);
    if (!this.ended) { this.models = models; this.controls(); }
  }
  private applySettings(settings: RpcRecord): void {
    if (typeof settings.model === 'string') this.selected.model = settings.model;
    const effort = settings.reasoningEffort ?? settings.effort;
    this.selected.effort = typeof effort === 'string' ? effort : undefined;
    this.controls();
  }
  private controls(): void {
    if (!this.state.statusArea) return;
    const controls = [
      ...(this.models.length ? [{ id: 'model', label: this.selected.model || 'Default model', title: 'Select model', disabled: this.ended }] : []),
      ...(this.models.some(model => model.model === this.selected.model && Array.isArray(model.supportedReasoningEfforts) && model.supportedReasoningEfforts.length) ? [{ id: 'thinking', label: this.selected.effort || 'Default effort', title: 'Select thinking level', disabled: this.ended }] : []),
    ];
    if (JSON.stringify(controls) !== JSON.stringify(this.state.statusArea.controls)) this.state = { ...this.state, statusArea: { ...this.state.statusArea, controls } };
  }
  private event({ method, params }: CodexEvent): void {
    if (method === 'item/started' || method === 'item/completed') {
      const native = item(params.item); const turnId = nonempty(params.turnId, 'item turn ID');
      this.replace(this.project(native, turnId, method === 'item/completed'));
      if (method === 'item/completed') this.offerAsyncQuestions(native);
      if (native.type === 'userMessage' && Array.isArray(native.content)) for (const input of native.content) {
        if (isRecord(input) && input.type === 'text' && typeof input.text === 'string') {
          if (codexAsyncReplies(input.text)) this.asyncQuestions.reconcile(input.text);
          else { this.asyncQuestions.clear(); this.deferredAsyncItems.clear(); }
        }
      }
      return;
    }
    if (method.startsWith('item/') && typeof params.delta === 'string' && typeof params.itemId === 'string') {
      const key = `codex:${nonempty(params.turnId, 'delta turn ID')}:${params.itemId}`;
      const previous = this.native.get(key);
      if (!previous) throw new Error('Codex delta arrived before its item');
      const native = { ...previous };
      if (method === 'item/agentMessage/delta' || method === 'item/plan/delta') native.text = string(native.text) + params.delta;
      else if (method === 'item/commandExecution/outputDelta') native.aggregatedOutput = string(native.aggregatedOutput) + params.delta;
      else if (method === 'item/reasoning/summaryTextDelta' || method === 'item/reasoning/textDelta') {
        const field = method.includes('summary') ? 'summary' : 'content'; const parts = Array.isArray(native[field]) ? [...native[field] as string[]] : [];
        const index = typeof params.summaryIndex === 'number' ? params.summaryIndex : typeof params.contentIndex === 'number' ? params.contentIndex : 0;
        if (!Number.isSafeInteger(index) || index < 0 || index > 1024) throw new Error('Invalid Codex reasoning part index');
        parts[index] = (parts[index] || '') + params.delta; native[field] = parts;
      } else return;
      this.replace(this.project(native, string(params.turnId), false)); return;
    }
    if (method === 'thread/name/updated') this.state = { ...this.state, sessionName: string(params.threadName) || undefined };
    else if (method === 'thread/settings/updated') { this.settingsRevision++; this.applySettings(record(params.threadSettings, 'thread settings')); }
    else if (method === 'thread/tokenUsage/updated') {
      const usage = record(params.tokenUsage, 'usage'), last = record(usage.last, 'last usage'), total = record(usage.total, 'total usage');
      const tokens = Number(last.totalTokens), window = Number(usage.modelContextWindow), lifetime = Number(total.totalTokens);
      const metrics = [Number.isFinite(lifetime) ? `${lifetime.toLocaleString()} tokens` : '', Number.isFinite(tokens) && window > 0 ? `${tokens.toLocaleString()} last turn / ${window.toLocaleString()} window` : ''].filter(Boolean).join(' · ');
      if (metrics !== this.state.statusArea?.metrics) this.state = { ...this.state, statusArea: { ...this.state.statusArea!, metrics } };
    } else if (method === 'turn/started') this.state = { ...this.state, busy: true, status: 'Working…' };
    else if (method === 'turn/completed') {
      const turn = record(params.turn, 'completed turn');
      // Terminal item snapshots settle tool/reasoning lifecycle without replacing newer content mid-stream.
      if (Array.isArray(turn.items)) for (const entry of turn.items) {
        const native = item(entry); this.replace(this.project(native, string(turn.id), true));
        if (turn.status === 'completed') this.offerAsyncQuestions(native);
      }
      if (turn.status !== 'completed') { this.asyncQuestions.clear(); this.deferredAsyncItems.clear(); }
      this.finishRows(turn.status === 'interrupted' || turn.status === 'failed');
      if (turn.error) this.replace({ key: `codex:error:${string(turn.id)}`, role: 'error', content: [{ type: 'raw', text: json(turn.error) }], isError: true });
      this.state = { ...this.state, busy: false, status: turn.status === 'interrupted' ? 'Stopped' : 'Idle' };
      if (turn.status !== 'interrupted') this.ui.completed(turn.status === 'failed', this.response());
      this.publish(); return;
    } else if (method === 'error' && params.willRetry !== true) {
      this.replace({ key: `codex:error:${string(params.turnId)}`, role: 'error', content: [{ type: 'raw', text: json(params.error) }], isError: true }); return;
    }
    this.publish([]);
  }
  private offerAsyncQuestions(native: CodexItem): void {
    if (!this.ui.asyncQuestion || native.type !== 'agentMessage' || native.delivery !== 'async' || native.questions == null) return;
    // Only live events reach this path. Do not prompt while Resume is still hydrating.
    if (this.hydrating) this.deferredAsyncItems.set(native.id, native);
    else this.asyncQuestions.offer(native);
  }
  private project(value: CodexItem, turnId: string, completed: boolean, history = false): DisplayMessage {
    const identity = `codex:${turnId}:${value.id}`;
    const key = value.type === 'userMessage' && typeof value.clientId === 'string' ? this.aliases.get(value.clientId) || identity : identity;
    const position = this.positions.get(key), previousRow = position === undefined ? undefined : this.state.messages[position];
    if (history && this.live.has(key) && previousRow) return previousRow;
    const previous = this.native.get(identity);
    this.native.set(identity, value);
    const base = { key, streaming: !completed };
    if (value.type === 'userMessage') {
      if (history && Array.isArray(value.content)) for (const input of value.content) {
        if (isRecord(input) && input.type === 'text' && typeof input.text === 'string') this.asyncQuestions.reconcile(input.text);
      }
      const content = Array.isArray(value.content) ? value.content.filter(isRecord).map(input => input.type === 'text' ? { type: 'text', text: string(input.text) } : input.type === 'image' && typeof input.url === 'string' && /^data:image\/(png|jpeg|webp|gif);base64,/.test(input.url) ? { type: 'image', mimeType: input.url.slice(5, input.url.indexOf(';')), data: input.url.slice(input.url.indexOf(',') + 1) } : { type: 'raw', text: json(input) }) : [];
      return { ...base, role: 'user', content };
    }
    if (value.type === 'agentMessage' || value.type === 'plan') return { ...base, role: 'assistant', content: [{ type: 'text', text: string(value.text) }] };
    if (value.type === 'reasoning') return { ...base, role: 'assistant', content: [{ type: 'thinking', thinking: [...(Array.isArray(value.summary) ? value.summary : []), ...(Array.isArray(value.content) ? value.content : [])].filter(entry => typeof entry === 'string').join('\n\n'), thinkingComplete: completed }] };
    const status = string(value.status); const terminal = completed || ['completed', 'failed', 'declined'].includes(status);
    const output = value.type === 'commandExecution' ? string(value.aggregatedOutput) : value.type === 'fileChange' ? json(value.changes) : json(value.result ?? value.error ?? value);
    return { ...base, ...(completed && status === 'inProgress' ? { uiPhase: 'stopped' as const } : {}), role: 'tool', toolCallId: identity, toolName: value.type, toolSource: { backend: 'codex', agent: 'codex' }, toolTitle: string(value.command) || (value.type === 'mcpToolCall' ? `${string(value.server)} · ${string(value.tool)}` : value.type),
      toolArguments: previousRow && previous && previous.command === value.command && previous.cwd === value.cwd && previous.arguments === value.arguments && previous.changes === value.changes
        ? previousRow.toolArguments : immutableSnapshot(value.type === 'commandExecution' ? { command: value.command, cwd: value.cwd } : value.arguments ?? value.changes ?? {}), toolNative: immutableSnapshot(value),
      output, hasStreamingOutput: !terminal && !!output, ...(terminal ? { resultOutput: output, toolStatus: 'result' as const } : { toolStatus: 'running' as const }), isError: status === 'failed' || status === 'declined' || typeof value.exitCode === 'number' && value.exitCode !== 0 || !!value.error || value.success === false };
  }
  private replace(row: DisplayMessage): void {
    this.live.add(row.key); const index = this.positions.get(row.key); const messages = this.state.messages.slice();
    if (index === undefined) { this.positions.set(row.key, messages.length); messages.push(row); } else messages[index] = row;
    this.state = { ...this.state, messages }; this.publish(index === undefined ? undefined : [row]);
  }
  private reindex(): void { this.positions = new Map(this.state.messages.map((row, index) => [row.key, index])); }
  private finishRows(stopped = this.ended): void {
    this.state = { ...this.state, messages: this.state.messages.map(row => row.streaming ? { ...row, streaming: false, ...(stopped || row.role === 'tool' && row.toolStatus !== 'result' ? { uiPhase: 'stopped' as const } : {}), ...(Array.isArray(row.content) ? { content: row.content.map(block => block.type === 'thinking' ? { ...block, thinkingComplete: true, ...(stopped ? { uiPhase: 'stopped' as const } : {}) } : block) } : {}), ...(row.role === 'tool' ? { hasStreamingOutput: false, toolStatus: 'result' as const, resultOutput: row.output } : {}) } : row) };
  }
  private response(): string | undefined { for (let i = this.state.messages.length - 1; i >= 0; i--) { const row = this.state.messages[i]; if (row.role === 'assistant' && Array.isArray(row.content)) { const text = row.content.map(block => block.text || '').join(''); if (text) return text; } } }
  private receipt(id: string, outcome: 'accepted' | 'rejected' | 'unknown', error?: string): void { this.ui.publish({ type: 'submissionReceipt', id, outcome, error }); }
  private publish(rows?: DisplayMessage[]): void {
    this.state = { ...this.state, configurationOperations: this.configuration?.operations };
    const base = this.revision++; this.ui.publish({ type: 'snapshot', state: this.state, commands: [], transcript: { base, revision: this.revision, ...(rows ? { rows } : {}) } });
    this.ui.changed(); this.configuration?.update();
  }
  private capture(event: string, payload: unknown): void { if (this.ui.transcriptLog?.enabled) this.ui.transcriptLog.append({ source: { backend: 'codex', agent: 'codex' }, sessionId: this.client?.threadId || `connecting:${this.connectionId}`, connectionId: this.connectionId, event, payload }); }
}
