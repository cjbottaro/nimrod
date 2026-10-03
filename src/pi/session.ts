import { PiTransport, RpcResponseError } from './transport';
import { initialConversationState, messagesToDisplay, reduceRpcEvent, sanitizeExtensionUiText, setExtensionStatus, setExtensionWidget } from './reducer';
import { ModelThinkingController, type ModelIdentity } from './model-thinking-controller';
import { SessionStatsController } from './session-stats-controller';
import { MODEL_SCOPE_STATUS, parseModelScope, scopedModels, type ModelReference } from './pi-model-scope';
import { projectToolTimeline } from './tool-progress';
import type { AgentMessage, ConversationState, JsonRecord } from './types';
import type { HostMessage } from './webview-client';

export interface PreferencePicker {
  choose(title: string, options: string[], current?: string): Promise<string | undefined>;
  error(message: string): void;
}

export interface SessionUi {
  publish(message: HostMessage): void;
  choose(title: string, options: string[]): Promise<string | undefined>;
  input(title: string, prefill?: string): Promise<string | undefined>;
  confirm(title: string, message: string): Promise<boolean>;
  openLink(href: string): Promise<void>;
  copy(text: string): Promise<void>;
  changed(state: ConversationState): void;
  disconnected?(): void;
  identity?(file: string | undefined, id: string | undefined): Promise<void>;
}
const record = (v: unknown): JsonRecord => v && typeof v === 'object' && !Array.isArray(v) ? v as JsonRecord : {};
const strings = (v: unknown): string[] => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

/** Pi semantics live here, deliberately not in a made-up universal harness interface. */
export class PiSession {
  state: ConversationState = { ...initialConversationState(), sessionUnavailable: true, temporary: true };
  private commands: unknown[] = [];
  private scope?: ModelReference[];
  private submission?: string;
  private compactionRequest = false;
  private disconnected = false;
  private initialized = false;
  private contextRefreshNeeded = false;
  private contextRefreshing = false;
  private dialogQueue = Promise.resolve();
  private model: ModelThinkingController;
  private stats: SessionStatsController;

  constructor(readonly rpc: PiTransport, private ui: SessionUi, temporary = true) {
    this.state.temporary = temporary;
    rpc.onEvent = event => this.event(event);
    this.model = new ModelThinkingController(rpc, {
      isMainAgentBusy: () => this.state.busy || !!this.state.compacting || !!this.state.sessionUnavailable || !!this.submission || this.compactionRequest,
      onRpcState: data => this.applyState(data),
      onState: modelControls => { this.state = { ...this.state, modelControls }; this.publish(); },
      chooseModel: (models, current) => this.chooseModel(models, current, (title, options) => ui.choose(title, options)),
      chooseThinkingLevel: levels => ui.choose('Thinking level', levels),
      showError: e => this.notice(errorText(e)),
    });
    this.stats = new SessionStatsController(rpc, {
      onIdentity: data => {
        if (this.initialized && !this.state.temporary) void this.identify(record(data)).catch(error => this.rpc.disconnect(`Session identity unavailable: ${errorText(error)}`));
      },
      onStats: sessionStats => {
        if (!this.disconnected) { this.state = { ...this.state, sessionStats }; this.publish(); }
      },
    });
  }

  private async chooseModel(models: ModelIdentity[], current: ModelIdentity | null, choose: PreferencePicker['choose']): Promise<ModelIdentity | undefined> {
    const available = scopedModels(models, this.scope);
    if (!available.length) throw new Error('No scoped models are available. Check Pi’s provider configuration.');
    const labels = available.map(m => `${m.provider}/${m.id}`);
    const selected = await choose('Select model', labels, current ? `${current.provider}/${current.id}` : undefined);
    return available.find((_, i) => labels[i] === selected);
  }

  /** Each picker invocation is bound to this session, including cancellation and errors. */
  async selectPreference(kind: 'model' | 'thinking', picker: PreferencePicker): Promise<void> {
    const showError = (error: unknown) => { this.notice(errorText(error)); picker.error(errorText(error)); };
    if (kind === 'model') await this.model.selectModel({
      chooseModel: (models, current) => this.chooseModel(models, current, picker.choose), showError,
    });
    else await this.model.selectThinkingLevel({
      chooseThinkingLevel: (levels, current) => picker.choose('Select thinking level', levels, current), showError,
    });
  }

  async initialize(expectedName?: string): Promise<void> {
    this.publish();
    try {
      const state = await this.rpc.request('get_state', {}, 20_000, response => this.applyState(record(response.data)));
      await this.rpc.request('get_messages', {}, 20_000, response => {
        const messages = record(response.data).messages;
        if (!Array.isArray(messages)) throw new Error('Pi returned invalid conversation history');
        this.state = { ...this.state, messages: messagesToDisplay(messages.filter((m): m is AgentMessage => typeof m?.role === 'string')) };
      });
      await this.identify(record(state.data));
      if (this.disconnected) return;
      if (expectedName !== undefined && this.state.sessionName !== expectedName) throw new Error('Pi did not confirm the selected session name');
      this.initialized = true;
      this.state = { ...this.state, sessionUnavailable: false };
      this.publish();
      try { await this.model.initialize(record(state.data)); }
      catch (error) { this.notice(`Model controls unavailable: ${errorText(error)}`); }
      if (this.disconnected) return;
      this.stats.refresh();
      const result = await this.rpc.request('get_commands');
      // Explicitly deferred native operations must not masquerade as working commands.
      this.commands = Array.isArray(record(result.data).commands) ? (record(result.data).commands as JsonRecord[])
        .filter(c => !/^(resume|delete|new|fork|clone|tree|reload|quit)$/.test(String(c.name))) : [];
      this.publish();
    } catch (error) {
      this.rpc.disconnect(`Startup failed: ${errorText(error)}`);
      throw error;
    }
  }

  publish(): void {
    this.ui.publish({ type: 'snapshot', build: 'Nimrod PoC', commands: this.commands,
      state: { ...this.state, messages: projectToolTimeline(this.state.messages, this.state.toolProgress) } });
    this.ui.changed(this.state);
  }

  private async identify(data: JsonRecord): Promise<void> {
    if (this.disconnected || this.state.temporary) return;
    const file = typeof data.sessionFile === 'string' && data.sessionFile ? data.sessionFile : undefined;
    const id = typeof data.sessionId === 'string' && data.sessionId ? data.sessionId : undefined;
    await this.ui.identity?.(file, id);
    if (!this.disconnected && file) this.state = { ...this.state, sessionFile: file };
  }

  private applyState(data: JsonRecord): void {
    if (this.disconnected) return;
    this.state = { ...this.state,
      busy: data.isStreaming === true || data.isCompacting === true,
      compacting: data.isCompacting === true,
      status: data.isCompacting === true ? 'Compacting context…' : data.isStreaming === true ? 'Working…' : 'Ready',
      sessionName: typeof data.sessionName === 'string' ? data.sessionName : undefined,
    };
  }

  private event(event: JsonRecord): void {
    if (event.type === 'extension_ui_request') { this.extensionUi(event); return; }
    if (event.type === 'process_error') {
      this.disconnected = true;
      this.ui.disconnected?.();
      this.stats.dispose();
      this.model.disconnect();
      this.state = { ...this.state, sessionUnavailable: true, extensionStatuses: {}, extensionWidgets: {} };
    }
    this.state = reduceRpcEvent(this.state, event);
    this.publish();
    if (event.type === 'agent_settled' || event.type === 'compaction_end' || (!this.state.temporary && event.type === 'message_end')) this.stats.refresh();
    if (event.type === 'compaction_end' && event.result) this.contextRefreshNeeded = true;
    if (this.contextRefreshNeeded && !this.state.busy && !this.state.compacting) void this.refreshContext();
  }

  private async refreshContext(): Promise<void> {
    if (this.contextRefreshing || this.disconnected) return;
    this.contextRefreshing = true;
    try {
      await this.rpc.request('get_messages', {}, 20_000, response => {
        if (this.state.busy || this.state.compacting) return;
        const messages = record(response.data).messages;
        if (!Array.isArray(messages)) throw new Error('Invalid post-compaction history');
        this.state = { ...this.state, messages: messagesToDisplay(messages), toolProgress: undefined };
        this.contextRefreshNeeded = false;
        this.publish();
      });
    } catch (e) { this.notice(`Could not refresh compacted context: ${errorText(e)}`); }
    finally { this.contextRefreshing = false; }
  }

  async handle(message: JsonRecord): Promise<void> {
    try {
      switch (message.type) {
        case 'ready': this.publish(); break;
        case 'prompt': await this.submit(message); break;
        case 'compact': await this.compact(message); break;
        case 'stop':
          if (!this.state.compacting) {
            const response = await this.rpc.request('clear_queue');
            const data = record(response.data);
            this.ui.publish({ type: 'queueRecovery', steering: strings(data.steering), followUp: strings(data.followUp) });
          }
          await this.rpc.request('abort', {}, 0);
          break;
        case 'selectModel': await this.model.selectModel(); break;
        case 'selectThinking': await this.model.selectThinkingLevel(); break;
        case 'openLink': if (typeof message.href === 'string') await this.ui.openLink(message.href); break;
        case 'copyCode':
          if (typeof message.id === 'string' && typeof message.text === 'string') {
            try { await this.ui.copy(message.text); this.ui.publish({ type: 'copyResult', id: message.id, success: true }); }
            catch { this.ui.publish({ type: 'copyResult', id: message.id, success: false }); }
          }
          break;
        case 'renderError': this.notice('A rendering error occurred; see the developer console.'); console.error(message.error); break;
      }
    } catch (error) { this.notice(errorText(error)); }
  }

  private async submit(message: JsonRecord): Promise<void> {
    const id = typeof message.id === 'string' ? message.id : '';
    const text = typeof message.text === 'string' ? message.text : '';
    const receipt = (outcome: 'accepted' | 'rejected' | 'cancelled' | 'unknown', error?: string) => this.ui.publish({ type: 'submissionReceipt', id, outcome, error });
    if (!id || !text.trim() || text.length > 1_000_000 || this.submission || this.state.sessionUnavailable || this.state.compacting || this.state.modelControls.changing) {
      receipt('rejected', 'Pi is not ready for this submission. Your draft was kept.'); return;
    }
    if (/^\/(?:resume|delete|new|fork|clone|tree|reload|quit)(?:\s|$)/.test(text.trim())) {
      receipt('rejected', 'That operation is not implemented in this PoC.'); return;
    }
    this.submission = id;
    try {
      const rename = /^\/name(?:\s+([\s\S]*))?$/.exec(text.trim());
      if (rename) {
        const name = rename[1] ?? await this.ui.input('Session name (blank clears it)', this.state.sessionName);
        if (name === undefined) { receipt('cancelled'); return; }
        if (/[\r\n]/.test(name)) { receipt('rejected', 'Session names must be a single line.'); return; }
        if (this.disconnected) { receipt('rejected', 'Pi disconnected before renaming.'); return; }
        await this.rename(name);
      } else {
        // Always include fallback steering, even when our last snapshot said idle.
        await this.rpc.request('prompt', { message: text, streamingBehavior: 'steer' });
      }
      receipt('accepted');
    } catch (error) { receipt(error instanceof RpcResponseError ? 'rejected' : 'unknown', errorText(error)); }
    finally { this.submission = undefined; }
  }

  private async rename(name: string): Promise<void> {
    if (/[\r\n]/.test(name)) throw new Error('Session names must be a single line.');
    if (this.disconnected) throw new Error('Pi disconnected before renaming.');
    await this.rpc.request('set_session_name', { name: name.trim() });
    if (this.disconnected) return;
    this.state = { ...this.state, sessionName: name.trim() || undefined }; this.publish();
  }

  private async compact(message: JsonRecord): Promise<void> {
    const id = typeof message.id === 'string' ? message.id : '';
    const customInstructions = typeof message.customInstructions === 'string' ? message.customInstructions.trim() : undefined;
    const receipt = (outcome: 'accepted' | 'rejected' | 'unknown', error?: string) => this.ui.publish({ type: 'submissionReceipt', id, outcome, error });
    if (!id || (message.customInstructions !== undefined && typeof message.customInstructions !== 'string') || (customInstructions?.length ?? 0) > 1_000_000 || this.compactionRequest || this.submission || this.state.sessionUnavailable || this.state.busy || this.state.compacting) {
      receipt('rejected', 'Manual compaction is available only while Pi is idle. Your draft was kept.'); return;
    }
    this.compactionRequest = true;
    this.state = { ...this.state, busy: true, compacting: true, status: 'Compacting context…' };
    this.publish();
    try {
      // Compaction can require a provider round-trip; only Pi's explicit response resolves its acceptance.
      await this.rpc.request('compact', customInstructions ? { customInstructions } : {}, 0);
      this.contextRefreshNeeded = true;
      receipt('accepted');
      if (!this.state.busy && !this.state.compacting) void this.refreshContext();
    } catch (error) {
      if (this.state.compacting) this.state = { ...this.state, busy: false, compacting: false };
      receipt(error instanceof RpcResponseError ? 'rejected' : 'unknown', errorText(error));
      this.notice(errorText(error));
    } finally { this.compactionRequest = false; }
  }

  private notice(text: string): void {
    this.state = { ...this.state, status: text }; this.publish();
  }

  private extensionUi(event: JsonRecord): void {
    const method = event.method, id = event.id;
    if (typeof id !== 'string') return;
    if (method === 'setStatus' && event.statusKey === MODEL_SCOPE_STATUS) { this.scope = parseModelScope(event.statusText); return; }
    if (method === 'setStatus' && typeof event.statusKey === 'string') {
      this.state = setExtensionStatus(this.state, sanitizeExtensionUiText(event.statusKey).slice(0, 128), typeof event.statusText === 'string' ? sanitizeExtensionUiText(event.statusText).slice(0, 2000) : undefined);
      this.publish(); return;
    }
    if (method === 'setWidget' && typeof event.widgetKey === 'string') {
      this.state = setExtensionWidget(this.state, event.widgetKey, event.widgetLines === undefined ? undefined : { lines: strings(event.widgetLines).slice(0, 50).map(sanitizeExtensionUiText) });
      this.publish(); return;
    }
    if (method === 'notify') { this.notice(sanitizeExtensionUiText(String(event.message || 'Pi notification'))); return; }
    if (method === 'set_editor_text') { this.ui.publish({ type: 'setEditorText', text: event.text }); return; }
    if (method === 'setTitle') return;
    if (!['select', 'confirm', 'input', 'editor'].includes(String(method))) return;
    this.dialogQueue = this.dialogQueue.then(async () => {
      if (this.disconnected) return;
      const title = typeof event.title === 'string' ? event.title : 'Pi request';
      let fields: JsonRecord = { cancelled: true };
      if (method === 'confirm') fields = { confirmed: await this.ui.confirm(title, String(event.message || '')) };
      else {
        const value = method === 'select' ? await this.ui.choose(title, strings(event.options))
          : await this.ui.input(title, typeof event.prefill === 'string' ? event.prefill : '');
        if (value !== undefined) fields = { value };
      }
      if (!this.disconnected) await this.rpc.respond({ id, ...fields });
    }).catch(error => { if (!this.disconnected) { void this.rpc.respond({ id, cancelled: true }).catch(() => {}); this.notice(errorText(error)); } });
  }
}
