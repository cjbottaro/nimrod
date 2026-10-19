import { validateMessageImages, type SessionMessageInput } from '../session-message-input';
import type { ImageContent } from '../image-attachments';
import { copilotImageCapabilities, copilotUserContent, type CopilotImageModel } from './image-input';
import { CopilotConnection, CopilotResponseError, record, type BridgeRequest } from './connection';
import { immutableSnapshot } from '../pi/immutable-snapshot';
import type { DisplayMessage } from '../conversation-model';
import type { ConversationViewMessage, ConversationViewState } from '../conversation-view-host';
import type { TranscriptLogSink } from '../transcript-logs';
import { copilotToolResult } from './tool-result';
import { createCopilotStatusArea } from './status-area';
import { CopilotUsageController } from './usage';
import { initialCopilotUsage, type CopilotUsageSeed } from './usage-seed';
import { createCopilotConfiguration } from './session-configuration';
import { createCopilotPermissionConfiguration, isPermissionChange, permissionCommand, permissionArgument } from './permission-configuration';
import { SessionConfigurationSet } from '../session-configuration-set';
import { ConfigurationDeferred, ConfigurationSuperseded, ConfigurationUncertain, type SessionConfigurationController } from '../session-configuration';
import { pickConfiguration } from '../configuration-picker';
import { commandChoices, copilotCommands, findCopilotCommand, parseCopilotCommand, type CommandChoice, type CopilotCommand } from './commands';

interface Model extends CopilotImageModel {
  id: string;
  name: string;
  supportedReasoningEfforts?: string[];
  capabilities?: { supports?: { reasoningEffort?: boolean; vision?: boolean }; limits?: { max_context_window_tokens?: number; vision?: { supported_media_types?: string[]; max_prompt_images?: number; max_prompt_image_size?: number } } };
  policy?: { state: string };
}
const usageWorkEvents = new Set(['user.message', 'assistant.turn_start', 'assistant.turn_end', 'assistant.message_delta', 'assistant.message',
  'assistant.reasoning_delta', 'assistant.reasoning', 'assistant.tool_call_delta', 'assistant.usage', 'tool.execution_start',
  'tool.execution_partial_result', 'tool.execution_progress', 'tool.execution_complete', 'tool.shell_output', 'session.error']);
/** Supported host decisions, distinct from the SDK's reported PermissionResult outcomes. */
export type CopilotDecision = import('../../copilot/permissions.mjs').PermissionDecision
  | { answer: string; wasFreeform: boolean } | { approved: boolean; selectedAction?: string; feedback?: string };
export interface CopilotSessionUi {
  publish(message: ConversationViewMessage): void;
  changed(): void;
  identified(id: string): void;
  disconnected(reason: string): void;
  completed(failed: boolean, response?: string): void;
  notice(message: string): void;
  decision(kind: 'permission' | 'input' | 'plan', request: Record<string, unknown>, signal: AbortSignal): Promise<CopilotDecision | undefined>;
  commandChoice?(title: string, choices: readonly CommandChoice[], signal: AbortSignal): Promise<string | undefined>;
  transcriptLog?: TranscriptLogSink;
}
/** SDK semantic events project directly to shared presentation, never Pi/ACP events. */
export class CopilotSession {
  readonly connection: CopilotConnection;
  readonly configuration: SessionConfigurationSet;
  private readonly modelConfiguration: SessionConfigurationController;
  private readonly permissionConfiguration: SessionConfigurationController;
  private permissionMode?: string;
  private permissionVersion = 0;
  private permissionChanging = false;
  state: Omit<ConversationViewState, 'messages'> & { messages: DisplayMessage[]; sessionName?: string } = {
    messages: [], sessionUnavailable: true, busy: false, status: 'Connecting Copilot…',
  };
  commands: CopilotCommand[] = [];
  private commandOperation?: AbortController;
  private revision = 0;
  private indices = new Map<string, number>();
  private events = new Set<string>();
  private shellSequences = new Map<string, number>();
  private models: Model[] = [];
  private model?: string;
  private effort?: string;
  private mode?: string;
  private contextTier?: string;
  private contextLimits = new Map<string, number>();
  private configuring = false;
  private configurationVersion = 0;
  private projectStatus = createCopilotStatusArea();
  private usage: CopilotUsageController;
  private initialUsage?: CopilotUsageSeed;
  private ended = false;
  private replaying = false;
  private failed = false;
  private stopped = false;
  private sessionId = '';
  private echo?: { key: string };
  private decisions = new AbortController();
  private pendingDecisions = new Map<string, 'permission' | 'input' | 'plan'>();
  private waitingStatus?: string;
  private captureConnectionId = crypto.randomUUID();
  private runtimeVersion?: string;
  constructor(send: (message: BridgeRequest) => Promise<void>, private ui: CopilotSessionUi) {
    this.connection = new CopilotConnection(async message => {
      this.capture(`request.${message.method}`, message);
      if (this.ui.transcriptLog?.enabled && this.ui.transcriptLog.flush) await this.ui.transcriptLog.flush();
      return send(message);
    }, packet => this.packet(packet), reason => {
      this.capture('bridge.disconnected', { reason });
      this.ended = true; this.cancelDecisions(); this.commandOperation?.abort(); this.configuration?.dispose(reason); this.usage?.dispose(); this.finish();
      this.state = { ...this.state, sessionUnavailable: true, busy: false, status: 'Disconnected' };
      this.publish(); ui.disconnected(reason);
    });
    this.modelConfiguration = createCopilotConfiguration({
      models: () => this.models.map(model => ({ id: model.id, label: model.name,
        efforts: model.capabilities?.supports?.reasoningEffort === false ? undefined : model.supportedReasoningEfforts,
        maxContextTokens: model.capabilities?.limits?.max_context_window_tokens })),
      model: () => this.model, effort: () => this.effort,
      mode: () => this.mode, contextTier: () => this.contextTier,
      contextLimit: (model, tier) => this.contextLimits.get(`${model}:${tier}`),
      availability: () => this.ended || this.state.sessionUnavailable ? 'unavailable' : this.canSubmit ? 'ready' : 'deferred',
      apply: (setting, value, current, dispatched) => this.applyPreference(setting, value, current, dispatched), changed: () => this.publish([]),
      error: message => this.ui.notice(`Configuration change failed: ${message}`),
    });
    this.permissionConfiguration = createCopilotPermissionConfiguration({
      commands: () => this.commands, mode: () => this.permissionMode,
      availability: command => this.ended || this.state.sessionUnavailable ? 'unavailable'
        : this.permissionChanging || this.commandOperation || this.state.busy && !command.allowDuringAgentExecution ? 'deferred' : 'ready',
      apply: (value, current, dispatched) => this.applyPermissions(value, current, dispatched), changed: () => this.publish([]),
    });
    this.configuration = new SessionConfigurationSet([this.modelConfiguration, this.permissionConfiguration]);
    this.usage = new CopilotUsageController(() => this.connection.request('usage', {}, 'reject'), () => this.publish([]),
      () => this.configuring ? Promise.resolve(null) : this.connection.request('context', {}, 'reject'));
    this.updateStatusArea();
  }
  get canSubmit(): boolean { return !this.ended && !this.state.sessionUnavailable && !this.state.busy && !this.configuring && !this.permissionChanging && !this.commandOperation; }
  supports(kind: 'model' | 'thinking' | 'mode' | 'context'): boolean {
    const model = this.models.find(model => model.id === this.model);
    return kind === 'model' ? this.models.length > 0 : kind === 'thinking'
      ? model?.capabilities?.supports?.reasoningEffort !== false && !!model?.supportedReasoningEfforts?.length
      : kind === 'mode' ? !!this.mode : !!model?.capabilities?.limits?.max_context_window_tokens;
  }
  validatePrompt(text: string): string | undefined {
    if (isPermissionChange(this.commands, text)) {
      if (this.ended || this.state.sessionUnavailable) return 'Connect Copilot before changing permissions. Your draft was kept.';
      if (!permissionCommand(this.commands)) return 'Copilot did not advertise /permissions allow-all. Nothing was invoked; your draft was kept.';
      return;
    }
    if (!this.canSubmit) return 'Copilot is not idle or is still connecting. Your draft was kept.';
    if (text.trimStart().startsWith('/')) {
      const invocation = parseCopilotCommand(text);
      const command = invocation && findCopilotCommand(this.commands, invocation.name);
      if (!command) return 'This command is not advertised by Copilot. Nothing was invoked; your draft was kept.';
      if (command.input?.required && !command.input.choices?.length && !invocation?.input?.trim()) return `/${command.name} requires input: ${command.input.hint}. Your draft was kept.`;
    }
  }
  cancelCommands(): void { this.commandOperation?.abort(); }
  receive(packet: unknown): void {
    if (record(packet) && !['event', 'connected', 'permission', 'input', 'plan'].includes(String(packet.kind)))
      this.capture(`bridge.${String(packet.kind)}`, packet);
    this.connection.receive(packet);
  }
  disconnect(reason: string): void { this.connection.disconnect(reason); }
  async initialize(sessionId?: string): Promise<void> {
    this.initialUsage = initialCopilotUsage(sessionId === undefined);
    const status = await this.connection.request('initialize');
    if (record(status) && typeof status.version === 'string') this.runtimeVersion = status.version;
    await this.connection.request('connect', sessionId === undefined ? {} : { sessionId });
    if (this.state.sessionUnavailable) throw new Error('Copilot did not publish a connected session');
  }
  readonly messageInput: SessionMessageInput = {
    capabilities: () => copilotImageCapabilities(this.models.find(model => model.id === this.model)),
    submit: message => this.handle({ ...message, type: 'prompt' }),
  };

  async handle(message: Record<string, unknown>): Promise<void> {
    this.capture('ui.action', message);
    if (message.type === 'renderError') { this.ui.notice(String(message.error)); return; }
    if (message.type === 'stop') {
      this.commandOperation?.abort();
      if (this.state.busy) { this.stopped = true; this.cancelDecisions(); await this.connection.request('cancel'); }
      return;
    }
    if (message.type !== 'prompt' && message.type !== 'command') return;
    const id = String(message.id ?? ''), text = typeof message.text === 'string' ? message.text : '';
    const invalid = !this.canSubmit && !isPermissionChange(this.commands, text)
      ? 'Copilot is not idle or is still connecting. Nothing was sent.' : this.validatePrompt(text);
    let images: ImageContent[];
    try { images = validateMessageImages(message.images, this.messageInput.capabilities()); }
    catch (error) { this.ui.publish({ type: 'submissionReceipt', id, outcome: 'rejected', error: String(error) }); return; }
    if (invalid || !id || text.length > 1_000_000 || !text.trim() && !images.length || images.length && text.trimStart().startsWith('/')) {
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'rejected', error: invalid || 'Invalid Copilot message. Images require a message, not a slash command.' }); return;
    }
    if (isPermissionChange(this.commands, text)) { await this.acceptPermissionIntent(id); return; }
    if (text.trimStart().startsWith('/')) { await this.runCommand(id, text); return; }
    if (message.type === 'command') {
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'rejected', error: 'Invalid Copilot slash command. Nothing was invoked.' }); return;
    }
    await this.sendPrompt(id, text, text, images);
  }
  private async acceptPermissionIntent(id: string): Promise<void> {
    try {
      const choices = await this.configuration.choices('permissions');
      const choice = choices.find(choice => choice.value === permissionArgument);
      if (!choice) throw new Error('Copilot did not advertise a supported permission change.');
      this.configuration.set('permissions', choice);
      // Local intent accepted; operation publications own authoritative completion.
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'accepted' });
    } catch (error) { this.ui.publish({ type: 'submissionReceipt', id, outcome: 'rejected', error: String(error) }); }
  }
  private async sendPrompt(id: string, text: string, display = text, images: ImageContent[] = []): Promise<void> {
    const key = `copilot:user:pending:${id}`;
    this.echo = { key };
    this.ui.publish({ type: 'submissionMessage', id, key });
    this.failed = false; this.stopped = false;
    this.state = { ...this.state, busy: true, status: 'Working…' };
    this.replace(key, { key, role: 'user', content: images.length ? [{ type: 'text', text: display }, ...images] : display });
    this.usage.workStarted();
    try {
      await this.connection.request('prompt', { text, ...(images.length ? { images } : {}) });
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'accepted' });
    } catch (error) {
      // An SDK error after dispatch is not proof the runtime rejected delivery.
      this.ui.publish({ type: 'submissionReceipt', id, outcome: 'unknown', error: `Copilot delivery was not confirmed: ${String(error)}. Nothing was replayed.` });
      this.disconnect(`Copilot delivery was not confirmed: ${String(error)}`);
    }
  }
  private commandOutput(text: string, command: string, markdown = false, error = false): void {
    const key = `copilot:command:${crypto.randomUUID()}`;
    this.replace(key, { key, role: 'command', originLabel: `Copilot command · /${command}`, isError: error,
      content: [{ type: markdown ? 'text' : 'raw', text }] });
  }
  private async runCommand(id: string, text: string): Promise<void> {
    const invocation = parseCopilotCommand(text)!;
    const operation = new AbortController();
    let invoked = false;
    this.commandOperation = operation;
    this.state = { ...this.state, status: `Running /${invocation.name}…` };
    this.publish([]);
    try {
      let name = invocation.name, input = invocation.input;
      const command = findCopilotCommand(this.commands, name);
      // Some SDK commands default to text output when invoked bare, even though
      // their TUI presents argument choices. Use advertised metadata before any
      // invocation; do not execute a default action just to discover its menu.
      if (!input?.trim() && command?.input?.choices?.length) {
        if (!this.ui.commandChoice) throw new Error('This Copilot command requires an argument picker that is unavailable.');
        const choices = commandChoices(command.input.choices);
        const selected = await this.ui.commandChoice(`Copilot /${command.name}`, choices, operation.signal);
        if (operation.signal.aborted || this.ended || selected === undefined) {
          if (!this.ended) this.ui.publish({ type: 'submissionReceipt', id, outcome: 'cancelled' });
          return;
        }
        if (!choices.some(choice => choice.id === selected)) throw new Error('The Copilot command argument is no longer valid.');
        const current = findCopilotCommand(this.commands, name);
        if (!current || current.name !== command.name || !current.input?.choices?.some(choice => choice.name === selected)) throw new Error('Copilot command choices changed. Open the picker again.');
        input = selected;
      }
      // Each iteration requires a fresh user choice; never retry an invocation.
      while (!operation.signal.aborted && !this.ended) {
        if (isPermissionChange(this.commands, `/${name} ${input ?? ''}`)) { await this.acceptPermissionIntent(id); return; }
        if (this.state.busy) throw new Error('Copilot started working before the command could be invoked. Nothing was invoked again.');
        invoked = true; this.usage.workStarted();
        const result = await this.connection.request('command', { name, ...(input !== undefined ? { input } : {}) });
        if (operation.signal.aborted || this.ended) return;
        if (!record(result) || typeof result.kind !== 'string') throw new Error('Copilot returned an invalid command result.');
        if (result.mode !== undefined && !['interactive', 'plan', 'autopilot'].includes(String(result.mode)))
          throw new Error(`Copilot requested unknown mode "${String(result.mode)}". No follow-on prompt was sent.`);
        if (result.kind === 'select-subcommand') {
          if (typeof result.command !== 'string' || !result.command || typeof result.title !== 'string') throw new Error('Copilot returned an invalid command selection.');
          const choices = commandChoices(result.options);
          if (!choices.length || !this.ui.commandChoice) throw new Error('This Copilot command requires a selection that is unavailable.');
          const selected = await this.ui.commandChoice(result.title, choices, operation.signal);
          if (operation.signal.aborted || this.ended || selected === undefined) {
            if (!this.ended) this.ui.publish({ type: 'submissionReceipt', id, outcome: 'cancelled' });
            return;
          }
          if (!choices.some(choice => choice.id === selected)) throw new Error('The Copilot command choice is no longer valid.');
          name = result.command; input = selected;
          continue;
        }
        if (result.kind === 'show-dialog') {
          if (!record(result.dialog) || result.dialog.kind !== 'model-picker'
            || result.dialog.scope !== undefined && typeof result.dialog.scope !== 'string'
            || result.dialog.target !== undefined && typeof result.dialog.target !== 'string'
            || result.dialog.modelToEnable !== undefined
            || !this.ui.commandChoice)
            throw new Error('This Copilot command requires an invalid or unsupported dialog.');
          const choices = this.models.map(model => ({ id: model.id, label: model.name, detail: model.id }));
          if (!choices.length) throw new Error('Copilot did not advertise models for this command dialog.');
          const selected = await this.ui.commandChoice('Copilot model', choices, operation.signal);
          if (operation.signal.aborted || this.ended || selected === undefined) {
            if (!this.ended) this.ui.publish({ type: 'submissionReceipt', id, outcome: 'cancelled' });
            return;
          }
          if (!choices.some(choice => choice.id === selected)) throw new Error('The Copilot model choice is no longer valid.');
          // Ask the command to interpret the selected argument; this is not the
          // Nimrod Select model action or a speculative prompt fallback.
          input = selected;
          continue;
        }
        if (result.kind === 'text') {
          if (typeof result.text !== 'string') throw new Error('Copilot returned invalid command text.');
          this.commandOutput(result.text, name, result.markdown === true);
        } else if (result.kind === 'add-timeline-entry') {
          if (!record(result.entry) || typeof result.entry.text !== 'string') throw new Error('Copilot returned an invalid timeline entry.');
          this.commandOutput(result.entry.text + (typeof result.entry.url === 'string' ? `\n${result.entry.url}` : ''), name);
          if (result.prefillInput !== undefined) this.ui.notice('Copilot supplied a suggested draft. Nimrod did not replace your newer draft.');
        } else if (result.kind === 'completed') {
          if (typeof result.message === 'string' && result.message) this.commandOutput(result.message, name);
        } else if (result.kind === 'agent-prompt') {
          if (typeof result.prompt !== 'string' || !result.prompt.trim() || typeof result.displayPrompt !== 'string') throw new Error('Copilot returned an invalid agent prompt.');
          if (typeof result.notice === 'string' && result.notice) this.commandOutput(result.notice, name);
          if (this.state.busy) throw new Error('Copilot started working before the command prompt could be submitted. Nothing was replayed.');
          await this.sendPrompt(id, result.prompt, result.displayPrompt);
          return;
        } else if (result.kind === 'set-model') {
          if (result.effectFinalized !== true || !record(result.model)) throw new Error('Copilot returned an incomplete finalized model effect.');
          this.applyConfigurationSnapshot(result.model);
          if (typeof result.warning === 'string' && result.warning) this.ui.notice(result.warning);
        } else if (result.kind === 'set-plan-model') {
          if (result.effectFinalized !== true || typeof result.message !== 'string') throw new Error('Copilot returned an incomplete finalized plan-model effect.');
          if (result.message) this.commandOutput(result.message, name);
        } else if (result.kind === 'command-effect-failed') {
          const error = typeof result.error === 'string' && result.error ? result.error : 'Copilot did not complete its command effect.';
          this.ui.publish({ type: 'submissionReceipt', id, outcome: result.outcome === 'cancelled' ? 'rejected' : 'unknown',
            operation: 'Run Copilot command', error });
          if (result.outcome !== 'cancelled') this.disconnect(`${error} Reconnect explicitly to read Copilot’s authoritative configuration.`);
          return;
        } else throw new Error(`Unsupported Copilot command result "${result.kind}". No fallback prompt was sent.`);
        this.ui.publish({ type: 'submissionReceipt', id, outcome: 'accepted' });
        return;
      }
    } catch (error) {
      if (!this.ended && !operation.signal.aborted) {
        this.ui.publish({ type: 'submissionReceipt', id, outcome: 'rejected', operation: 'Run Copilot command', error: `Copilot command did not finish: ${String(error)} Nothing was retried or sent as a fallback prompt.` });
      }
    } finally {
      if (this.commandOperation === operation) this.commandOperation = undefined;
      if (!this.ended && !this.state.busy) this.state = { ...this.state, status: 'Idle' };
      this.publish([]);
      if (!this.ended && invoked) { this.usage.refresh(); this.usage.refreshContext(); }
    }
  }
  async selectPreference(kind: 'model' | 'thinking' | 'mode' | 'context-window', choose: (values: string[], current?: string) => Promise<string | undefined>): Promise<void> {
    const setting = kind === 'model' ? 'model' : kind === 'thinking' ? 'effort' : kind === 'context-window' ? 'context-tier' : 'mode';
    await pickConfiguration(this.configuration, setting, async (options, current) => {
      const labels = options.map(option => option.detail ? `${option.label} — ${option.detail}` : option.label);
      const selected = await choose(labels, labels[options.findIndex(option => option.value === current)]);
      return options[labels.indexOf(selected || '')]?.value;
    });
  }
  private async applyPreference(setting: string, value: string, current: () => boolean, dispatched: () => void): Promise<void> {
    if (this.ended || this.state.sessionUnavailable) throw new Error('Copilot configuration is unavailable.');
    if (!this.canSubmit) throw new ConfigurationDeferred();
    if (!['model', 'effort', 'mode', 'context-tier'].includes(setting)) throw new Error('This Copilot setting is unsupported.');
    if (!current()) throw new ConfigurationSuperseded();
    this.configuring = true;
    // Fence reads started before this mutation. Native model events may precede
    // the runtime's committed context budget; refresh only after settlement.
    this.usage.clearContext(); this.publish([]);
    try {
      const version = this.configurationVersion;
      dispatched();
      const result = await this.connection.request('configure', { setting, value });
      if (version === this.configurationVersion) this.applyConfigurationSnapshot(result);
    } catch (error) {
      const reason = `Copilot configuration was not confirmed: ${String(error)}. Reconnect explicitly to read the authoritative configuration.`;
      this.modelConfiguration.dispose(reason, error instanceof CopilotResponseError ? 'failed' : undefined);
      this.disconnect(reason);
      throw error;
    } finally {
      this.configuring = false;
      this.invalidateContext(); this.publish([]);
    }
  }
  private async applyPermissions(value: string, current: () => boolean, dispatched: () => void): Promise<void> {
    const command = permissionCommand(this.commands);
    if (this.ended || this.state.sessionUnavailable || !command) throw new Error('Copilot permission configuration is unavailable.');
    if (this.commandOperation || this.permissionChanging || this.state.busy && !command.allowDuringAgentExecution) throw new ConfigurationDeferred();
    if (!current()) throw new ConfigurationSuperseded();
    this.permissionChanging = true; this.publish([]);
    try {
      const version = this.permissionVersion;
      dispatched();
      const result = await this.connection.request('permission-change', { value });
      if (!record(result)) throw new ConfigurationUncertain('Copilot returned an invalid permission result. Nothing was retried.');
      if (result.outcome === 'deferred') throw new ConfigurationDeferred();
      if (version === this.permissionVersion && ['manual', 'assisted', 'allow-all'].includes(String(result.mode))) this.permissionMode = String(result.mode);
      if (result.outcome !== 'applied' || result.mode !== 'allow-all') throw new ConfigurationUncertain(typeof result.details === 'string' ? result.details : 'Copilot did not confirm the permission change. Nothing was retried.');
      // Existing permission callbacks belong to the user/runtime. Do not answer,
      // cancel or hide them here, and do not refresh usage or alter agent activity.
    } finally { this.permissionChanging = false; this.publish([]); }
  }
  private applyConfigurationSnapshot(value: unknown): void {
    if (!record(value)) throw new Error('Invalid Copilot configuration snapshot');
    if (value.mode !== undefined && !['interactive', 'plan', 'autopilot'].includes(String(value.mode)))
      throw new Error('Copilot returned an unknown session mode.');
    const snapshot = record(value.model) ? value.model : value;
    const model = typeof snapshot.modelId === 'string' ? snapshot.modelId : undefined;
    const changed = this.model !== model;
    this.model = model;
    this.effort = typeof snapshot.reasoningEffort === 'string' ? snapshot.reasoningEffort : undefined;
    const contextTier = typeof snapshot.contextTier === 'string' ? snapshot.contextTier : undefined;
    const contextChanged = this.contextTier !== contextTier;
    this.contextTier = contextTier;
    if (typeof value.mode === 'string') this.mode = value.mode;
    if (typeof value.notice === 'string' && value.notice) this.ui.notice(value.notice);
    if (changed || contextChanged) this.invalidateContext();
  }
  private invalidateContext(): void {
    this.usage.clearContext();
    if (!this.ended && !this.replaying && !this.configuring && !this.state.sessionUnavailable) this.usage.refreshContext();
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
      if (this.ui.transcriptLog?.enabled) {
        const { events: _events, ...connection } = packet;
        this.capture('bridge.connected', connection);
      }
      this.replaying = true;
      try { for (const event of packet.events) this.event(event); this.finish(); }
      finally { this.replaying = false; }
      this.applyConfigurationSnapshot({ model: packet.model, mode: packet.mode });
      this.usage.seed(this.initialUsage);
      this.state = { ...this.state, sessionUnavailable: false, busy: false, status: 'Idle' }; this.publish();
      this.usage.refresh(); this.usage.refreshContext();
    } else if (packet.kind === 'permission-mode') {
      if (!['manual', 'assisted', 'allow-all'].includes(String(packet.mode))) throw new Error('Invalid Copilot permission mode');
      // The bridge fences its optional read against native events and mutations.
      this.permissionMode = String(packet.mode); this.publish([]);
    } else if (packet.kind === 'commands') {
      if (!Array.isArray(packet.commands)) throw new Error('Invalid Copilot command catalog');
      this.commands = copilotCommands(packet.commands); this.publish([]);
    } else if (packet.kind === 'command-error') {
      this.commands = []; this.publish([]); this.ui.notice(String(packet.error));
    } else if (packet.kind === 'event') this.event(packet.event);
    else if (packet.kind === 'permission' || packet.kind === 'input' || packet.kind === 'plan') {
      if (typeof packet.id !== 'string' || !record(packet.request)) throw new Error('Invalid Copilot decision request');
      const id = packet.id;
      const signal = this.decisions.signal;
      this.capture(`${packet.kind}.request`, packet);
      this.pendingDecisions.set(id, packet.kind); this.updateWaitingStatus();
      void this.ui.decision(packet.kind, packet.request, signal).then(async choice => {
        if (signal.aborted) return;
        this.pendingDecisions.delete(id); this.updateWaitingStatus(); this.publish([]);
        if (!choice && packet.kind === 'input') {
          this.stopped = true;
          await this.connection.request('cancel');
          return;
        }
        const fallback = packet.kind === 'plan' ? { approved: false } : { kind: 'user-not-available' };
        await this.connection.request('decision', { decisionId: id, value: choice ?? fallback });
      }).catch(error => { if (!signal.aborted) { this.ui.notice(`Copilot decision failed: ${String(error)}`); this.disconnect(String(error)); } });
      this.publish([]);
    } else throw new Error('Unknown Copilot bridge record');
  }
  private event(raw: unknown): void {
    if (!record(raw) || typeof raw.type !== 'string' || typeof raw.id !== 'string' || !raw.id || !record(raw.data)) throw new Error('Invalid Copilot SDK event');
    this.capture(`${this.replaying ? 'history.' : ''}${raw.type}`, raw);
    if (this.events.has(raw.id)) return;
    this.events.add(raw.id);
    const data = raw.data, type = raw.type;
    if (type === 'assistant.usage' && !this.replaying && !this.state.sessionUnavailable) { this.usage.workStarted(); this.usage.refresh(); }
    if (type === 'session.context_cleared' && !raw.agentId) { this.invalidateContext(); if (!this.replaying && !this.state.sessionUnavailable) this.usage.refresh(); }
    if (type === 'session.compaction_complete' && !raw.agentId && !this.replaying && !this.state.sessionUnavailable) this.usage.refreshContext();
    const originLabel = typeof raw.agentId === 'string' && raw.agentId ? `Copilot agent ${raw.agentId}` : undefined;
    const string = (key: string) => typeof data[key] === 'string' ? data[key] as string : '';
    if (type === 'assistant.tool_call_delta') {
      const id = string('toolCallId'); if (!id || typeof data.inputDelta !== 'string') throw new Error('Invalid Copilot tool input identity or fragment');
      const key = `copilot:tool:${raw.agentId || 'main'}:${id}`, previous = this.message(key);
      // Input fragments are generation, never permission to rewind authoritative execution.
      if (previous?.toolStatus !== undefined) return;
      const name = string('toolName') || previous?.toolName;
      this.replace(key, { ...previous, key, role: 'tool', originLabel, toolCallId: raw.agentId ? `${String(raw.agentId)}:${id}` : id,
        toolName: name, toolTitle: previous?.toolTitle || name, toolKind: toolKind(name), toolSource: { backend: 'copilot-sdk', agent: 'copilot' },
        toolArguments: (typeof previous?.toolArguments === 'string' ? previous.toolArguments : '') + string('inputDelta'),
        toolNative: immutableSnapshot({ ...(record(previous?.toolNative) ? previous.toolNative : {}), ...(raw.agentId ? { agentId: raw.agentId } : {}), [type]: data }), streaming: true, uiPhase: 'thinking' });
    } else if (type === 'user.message') {
      const content = string('content'), echo = this.echo;
      const key = echo && !raw.agentId ? echo.key : `copilot:user:${raw.id}`;
      this.replace(key, { key, role: 'user', originLabel, content: copilotUserContent(content, data.attachments) });
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
      if ((previous?.toolStatus === 'result' || previous?.toolStatus === 'finished') && !complete) {
        if (start) {
          const name = string('toolName') || previous.toolName;
          const retained: Readonly<Record<string, unknown>> = immutableSnapshot({ ...native, [type]: data });
          this.replace(key, { ...previous, toolName: name, toolTitle: string('toolTitle') || previous.toolTitle || name,
            toolKind: toolKind(name), toolArguments: Object.hasOwn(data, 'arguments') ? (retained[type] as Record<string, unknown>).arguments : previous.toolArguments, toolNative: retained });
        }
        return;
      }
      if (type === 'tool.shell_output' && typeof data.sequence === 'number') {
        const sequence = this.shellSequences.get(key);
        if (sequence !== undefined && data.sequence <= sequence) return;
        this.shellSequences.set(key, data.sequence);
      }
      const result = record(data.result) ? data.result : undefined;
      const error = record(data.error) ? data.error : undefined;
      const name = start ? string('toolName') || previous?.toolName : previous?.toolName;
      const retained: Readonly<Record<string, unknown>> = immutableSnapshot({ ...native, ...(raw.agentId ? { agentId: raw.agentId } : {}), [type]: data });
      this.replace(key, { ...previous, key, role: 'tool', originLabel, toolCallId: raw.agentId ? `${String(raw.agentId)}:${id}` : id, toolName: name,
        toolSource: { backend: 'copilot-sdk', agent: 'copilot' }, toolTitle: start ? string('toolTitle') || name : previous?.toolTitle,
        toolKind: toolKind(name), toolArguments: start && Object.hasOwn(data, 'arguments') ? (retained[type] as Record<string, unknown>).arguments : previous?.toolArguments,
        toolNative: retained, streaming: !complete, uiPhase: undefined, toolStatus: complete ? 'result' : 'running',
        ...(type === 'tool.shell_output' ? { output: (previous?.output || '') + string('text'), hasStreamingOutput: true } : {}),
        ...(type === 'tool.execution_partial_result' ? { output: string('partialOutput'), hasStreamingOutput: true } : {}),
        ...(complete ? { isError: data.success === false, resultOutput: result ? copilotToolResult(result) : JSON.stringify(error ?? data, null, 2) } : {}),
      });
    } else if (type === 'session.permissions_changed' && !raw.agentId) {
      if (data.mode !== undefined) {
        this.permissionVersion++;
        this.permissionMode = ['manual', 'assisted', 'allow-all'].includes(String(data.mode)) ? String(data.mode) : undefined;
        this.publish([]);
      }
    } else if (type === 'session.model_change' && !raw.agentId) {
      this.configurationVersion++;
      const model = string('newModel') || undefined;
      const changed = this.model !== model;
      this.model = model;
      this.effort = typeof data.reasoningEffort === 'string' ? data.reasoningEffort : undefined;
      const contextTier = typeof data.contextTier === 'string' ? data.contextTier : this.contextTier;
      const contextChanged = this.contextTier !== contextTier;
      this.contextTier = contextTier;
      if (changed || contextChanged) this.invalidateContext();
      this.publish([]);
    } else if (type === 'session.model_deselected' && !raw.agentId) {
      this.configurationVersion++; this.model = undefined; this.effort = undefined; this.contextTier = undefined; this.invalidateContext(); this.publish([]);
    }
    else if (type === 'session.usage_info' && !raw.agentId && !this.configuring && typeof data.currentTokens === 'number' && typeof data.tokenLimit === 'number') {
      this.usage.context({ currentTokens: data.currentTokens, tokenLimit: data.tokenLimit });
    }
    else if (type === 'session.error') {
      if (!raw.agentId) this.failed = true;
      const key = `copilot:error:${raw.id}`; this.replace(key, { key, role: 'assistant', originLabel, content: [{ type: 'text', text: string('message') || JSON.stringify(data, null, 2) }], isError: true });
      if (!this.replaying && !raw.agentId) this.endTurn();
    } else if (type === 'session.mode_changed' && !raw.agentId) {
      const mode = string('newMode');
      if (!['interactive', 'plan', 'autopilot'].includes(mode)) { this.disconnect(`Copilot changed to unknown mode "${mode}".`); return; }
      this.mode = mode; this.configurationVersion++; this.publish([]);
    } else if (type === 'session.title_changed' && !raw.agentId) { this.state = { ...this.state, sessionName: string('title') }; this.publish([]); }
    else if (type === 'session.idle' && !raw.agentId) {
      if (this.replaying) return;
      if (data.mode !== undefined && !['interactive', 'plan', 'autopilot'].includes(String(data.mode)))
        throw new Error('Copilot returned an unknown idle mode.');
      if (data.aborted !== undefined && typeof data.aborted !== 'boolean')
        throw new Error('Copilot returned an invalid idle abort flag.');
      if (data.aborted === true) this.stopped = true;
      // Match the SDK response waiter: an Autopilot idle is between continuations,
      // not completion. An explicitly aborted loop is terminal in every mode.
      if (data.mode === 'autopilot' && data.aborted !== true) return;
      this.endTurn();
    } else if (type === 'assistant.turn_start' && !raw.agentId && !this.replaying) {
      if (this.stopped || this.failed) return;
      this.state = { ...this.state, busy: true, status: 'Working…' }; this.publish([]);
    }
    if (!this.replaying && usageWorkEvents.has(type)) this.usage.workStarted();
  }
  private endTurn(): void {
    const working = this.state.busy;
    if (!working) {
      if (this.pendingDecisions.size) { this.cancelDecisions(); this.publish([]); }
      return;
    }
    this.finish(); this.echo = undefined; this.cancelDecisions();
    this.state = { ...this.state, busy: false, status: this.stopped ? 'Stopped' : this.failed ? 'Failed' : 'Idle' };
    this.publish([]);
    if (!this.ended && !this.state.sessionUnavailable) { this.usage.refresh(); this.usage.refreshContext(); }
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
        this.replace(message.key, { ...message, content, streaming: false, ...(message.toolStatus === 'running' || message.role === 'tool' && message.uiPhase === 'thinking' ? { toolStatus: 'finished' as const, uiPhase: 'stopped' as const } : {}) });
    }
  }
  private response(): string | undefined {
    const message = [...this.state.messages].reverse().find(message => message.role === 'assistant' && !message.originLabel && Array.isArray(message.content) && message.content.some(block => block.type === 'text'));
    return Array.isArray(message?.content) ? message.content.map(block => block.text || '').join('') : undefined;
  }
  private updateWaitingStatus(): void {
    this.waitingStatus = this.pendingDecisions.size
      ? [...this.pendingDecisions.values()].some(kind => kind === 'permission') ? 'Waiting for permission…' : 'Waiting for input…'
      : undefined;
  }
  private cancelDecisions(): void { this.pendingDecisions.clear(); this.waitingStatus = undefined; this.decisions.abort(); this.decisions = new AbortController(); }
  private capture(event: string, payload: Record<string, unknown>): void {
    if (!this.ui.transcriptLog?.enabled) return;
    const data = record(payload.data) ? payload.data : record(payload.request) ? payload.request : payload;
    const permission = record(data.permissionRequest) ? data.permissionRequest : undefined;
    const toolCallId = typeof data.toolCallId === 'string' ? data.toolCallId : typeof permission?.toolCallId === 'string' ? permission.toolCallId : undefined;
    this.ui.transcriptLog.append({ source: { backend: 'copilot-sdk', agent: 'copilot', ...(this.runtimeVersion ? { version: this.runtimeVersion } : {}) },
      // SDK callbacks can arrive before create/resume publishes its authoritative identity.
      sessionId: this.sessionId || `connecting:${this.captureConnectionId}`, connectionId: this.captureConnectionId, toolCallId, event, payload });
  }
  private updateStatusArea(): void {
    const context = this.usage.snapshot.context;
    if (this.model && context?.tokenLimit && context.tokenLimit > 0)
      this.contextLimits.set(`${this.model}:${this.contextTier || 'default'}`, context.tokenLimit);
    const statusArea = this.projectStatus({ model: this.model, effort: this.effort, mode: this.mode, supportsModel: this.supports('model'),
      supportsThinking: this.supports('thinking'), supportsMode: this.supports('mode'), supportsContext: this.supports('context'),
      available: !this.ended && !this.state.sessionUnavailable, usage: this.usage.snapshot });
    if (this.state.statusArea !== statusArea) this.state = { ...this.state, statusArea };
  }
  private publish(rows?: DisplayMessage[]): void {
    if (this.replaying) return;
    this.updateStatusArea();
    if (this.configuration && this.state.configurationOperations !== this.configuration.operations) {
      this.capture('ui.configuration', { operations: this.configuration.operations });
      this.state = { ...this.state, configurationOperations: this.configuration.operations };
    }
    const base = this.revision++;
    const state = this.waitingStatus ? { ...this.state, status: this.waitingStatus } : this.state;
    this.ui.publish({ type: 'snapshot', state, commands: this.commands, transcript: { base, revision: this.revision, ...(rows ? { rows } : {}) } }); this.ui.changed();
    this.configuration?.update();
  }
}
function toolKind(name?: string): string {
  if (['bash', 'powershell', 'shell'].includes(name || '')) return 'execute';
  if (['view', 'read_file', 'glob'].includes(name || '')) return 'read';
  if (['grep', 'rg', 'web_search'].includes(name || '')) return 'search';
  if (name === 'web_fetch') return 'fetch';
  if (['edit', 'create', 'apply_patch'].includes(name || '')) return 'edit';
  return 'other';
}
