import assert from 'node:assert/strict';
export const RuntimeConnection = { forStdio: ({ path }) => ({ path }) };
export class CopilotClient {
  constructor(options) {
    assert.equal(options.connection.path, '/fixture/copilot');
    assert.equal(options.mode, 'copilot-cli');
    assert.equal(options.useLoggedInUser, true);
    this.cwd = options.workingDirectory;
  }
  defaultsReads = 0;
  rpc = { user: { settings: { get: async () => {
    this.defaultsReads++;
    if (process.env.NIMROD_FIXTURE_COPILOT_MODEL_STATE === 'settings-error') throw new Error('Fixture settings read failed');
    const defaults = JSON.parse(process.env.NIMROD_FIXTURE_COPILOT_DEFAULTS || '{"model":"small","effortLevel":"low"}');
    return { settings: Object.fromEntries(Object.entries(defaults).map(([key, value]) => [key, { value, default: null, isDefault: value === null }])) };
  } } } };
  async start() {}
  async getStatus() { return { version: '1.0.98', protocolVersion: 3 }; }
  async ping() { return { timestamp: Date.now() }; }
  async stop() { if (this.session) assert.equal(this.session.disconnected, true); return []; }
  async listModels() {
    return [
      { id: 'small', name: 'Fixture small', supportedReasoningEfforts: ['low', 'high'],
        capabilities: { supports: { reasoningEffort: true }, limits: { max_context_window_tokens: 1_000_000 } } },
      { id: 'large', name: 'Fixture large',
        capabilities: { supports: { reasoningEffort: false }, limits: { max_context_window_tokens: 1_000_000 } } },
    ];
  }
  async listSessions() {
    return [
      { sessionId: 'fixture-sdk', summary: 'Saved SDK conversation', isRemote: false, context: { workingDirectory: this.cwd }, startTime: new Date(1000), modifiedTime: new Date(2000) },
      { sessionId: 'outside', summary: 'Outside project fixture', isRemote: false, context: { workingDirectory: '/elsewhere' }, startTime: new Date(1000), modifiedTime: new Date(2000) },
    ].filter(session => session.sessionId !== this.deleted);
  }
  async createSession(config) {
    assert.equal(config.name, 'Copilot session');
    assert.equal(this.defaultsReads, 1, 'read configured defaults before creating a session');
    const defaults = JSON.parse(process.env.NIMROD_FIXTURE_COPILOT_DEFAULTS || '{"model":"small","effortLevel":"low"}');
    for (const [key, source] of [['model', 'model'], ['reasoningEffort', 'effortLevel']]) {
      if (defaults[source] === null || defaults[source] === undefined) assert.equal(Object.hasOwn(config, key), false, `omit unset ${key}`);
      else assert.equal(config[key], defaults[source], `honor the configured ${key}`);
    }
    return this.session = new Session(config, false);
  }
  async resumeSession(id, config) {
    assert.equal(id, 'fixture-sdk'); assert.equal(config.allowTranscriptRecovery, false); assert.equal(config.continuePendingWork, false);
    assert.equal(this.defaultsReads, 0, 'resume never probes current user defaults');
    assert.equal(Object.hasOwn(config, 'model'), false); assert.equal(Object.hasOwn(config, 'reasoningEffort'), false);
    return this.session = new Session(config, true);
  }
  async deleteSession(id) { assert.equal(id, 'fixture-sdk'); assert.equal(this.session, undefined); this.deleted = id; }
}
class Session {
  sessionId = 'fixture-sdk';
  listeners = [];
  sequence = 0;
  turns = 0;
  model;
  effort;
  contextTier;
  mode = process.env.NIMROD_FIXTURE_COPILOT_MODE || 'interactive';
  configured = false;
  totalNanoAiu = 0;
  commandCatalog = [
    { name: 'permissions', aliases: ['perms'], description: 'Manage permissions', kind: 'builtin', allowDuringAgentExecution: true,
      input: { hint: 'Permission operation', choices: [{ name: 'show', description: 'Show permissions' }, { name: 'reset', description: 'Clear approvals' }] } },
    { name: 'discover-fixture', description: 'Add a new fixture command', kind: 'builtin', allowDuringAgentExecution: false },
  ];
  rpc = {
    metadata: { contextInfo: async parameters => {
      assert.deepEqual(parameters, { promptTokenLimit: 0, outputTokenLimit: 0 }, 'the runtime resolves the current model/tier');
      const state = process.env.NIMROD_FIXTURE_COPILOT_CONTEXT_STATE;
      if (state === 'error') throw new Error('Fixture context metadata unavailable');
      if (state === 'null' || !this.saved && !this.turns) return { contextInfo: null };
      const limit = this.contextTier === 'long_context' ? 1_000_000 : 125_000;
      return { contextInfo: { totalTokens: 31875, limit, promptTokenLimit: 100000,
        systemTokens: 1000, conversationTokens: 30000, toolDefinitionsTokens: 875 } };
    } },
    usage: { getMetrics: async () => {
      if (process.env.NIMROD_FIXTURE_COPILOT_USAGE_STATE === 'error') throw new Error('Fixture usage metadata unavailable');
      return { totalNanoAiu: this.totalNanoAiu, aiCreditsStatus: 'complete', totalPremiumRequestCost: 999,
        modelMetrics: { fixture: { arbitraryPrivateDetail: 'must-not-leave-metadata-boundary' } } };
    } },
    model: {
      // Listing metadata must not manufacture a selection: real CLI probes
      // returned an empty getCurrent snapshot both before and after this call.
      list: async () => ({ list: [{ id: 'small', name: 'Fixture small' }, { id: 'large', name: 'Fixture large' }] }),
      getCurrent: async () => {
        const state = process.env.NIMROD_FIXTURE_COPILOT_MODEL_STATE;
        if (!this.saved && !this.configured) {
          if (state === 'unresolved') return {};
          if (state === 'model-only') return { modelId: this.model };
          if (state === 'native-override') return { modelId: 'large' };
          if (state === 'native-effort') return { modelId: this.model, reasoningEffort: 'high' };
        }
        return { modelId: this.model, reasoningEffort: this.effort, contextTier: this.contextTier };
      },
    },
    mode: {
      get: async () => this.mode,
      set: async ({ mode, expectedMode }) => {
        if (expectedMode !== this.mode) return { status: 'stale', modelChanged: false, modeApplied: false };
        this.mode = mode; this.emit('session.mode_changed', { newMode: mode });
        return { status: 'applied', modelChanged: false, modeApplied: true };
      },
    },
    commands: {
      list: async () => ({ commands: this.commandCatalog }),
      invoke: async ({ name, input }) => {
        // The CLI can own its picker even when SDK invocation defaults to text.
        if (name === 'permissions') return { kind: 'text', text: `Fixture permission report: ${input ?? 'show'}`, markdown: false };
        if (name === 'discover-fixture') {
          this.commandCatalog.push({ name: 'new-fixture', kind: 'builtin', description: 'Newly advertised command', allowDuringAgentExecution: false });
          this.emit('commands.changed', { commands: [] }); return { kind: 'completed' };
        }
        assert.equal(name, 'new-fixture'); return { kind: 'completed', message: 'New command works' };
      },
    },
  };
  constructor(config, saved) {
    this.config = config; this.saved = saved; this.listeners = [config.onEvent];
    if (saved) { this.model = 'large'; this.effort = undefined; this.totalNanoAiu = 12_300_000_000; }
    else { this.model = config.model; this.effort = config.reasoningEffort; this.contextTier = config.contextTier; }
  }
  on(listener) { this.listeners.push(listener); return () => { this.listeners = this.listeners.filter(item => item !== listener); }; }
  emit(type, data) { const event = { id: `fixture-${this.sequence++}`, type, data }; this.listeners.forEach(listener => listener(event)); }
  async getEvents() { return this.saved ? [
    { id: 'saved-user', type: 'user.message', data: { content: 'Saved SDK question' } },
    { id: 'saved-answer', type: 'assistant.message', data: { messageId: 'saved', content: 'Saved SDK answer' } },
  ] : []; }
  async send({ prompt, mode }) {
    assert.equal(mode, 'immediate');
    const turn = ++this.turns;
    queueMicrotask(() => { void this.run(prompt, turn).catch(error => { this.emit('session.error', { message: String(error) }); this.emit('session.idle', {}); }); });
    return { messageId: `turn-${turn}` };
  }
  async permission(request) {
    const decision = await this.config.onPermissionRequest(request);
    assert.ok(['approve-once', 'approve-for-session', 'approve-permanently', 'reject', 'user-not-available'].includes(decision.kind), 'The live CLI accepts decisions, not legacy permission outcomes');
    if (decision.kind === 'approve-once') assert.equal(decision.approvedInteractively, true, 'Only an explicit UI choice may approve');
    if (decision.kind === 'approve-for-session' && ['shell', 'write'].includes(request.kind))
      assert.equal(request.canOfferSessionApproval, true, 'This request must explicitly allow session approval');
    return decision;
  }
  async run(prompt, turn) {
    this.emit('user.message', { content: prompt }); this.emit('assistant.turn_start', {});
    if (prompt === 'plan mode fixture') {
      const result = this.config.onExitPlanModeRequest({
        summary: 'Fixture plan', planContent: 'Read, change, review.',
        actions: ['interactive', 'autopilot', 'exit_only'],
      });
      this.emit('session.idle', { mode: 'autopilot' });
      const choice = await result;
      this.emit('assistant.message', { messageId: `plan-${turn}`, content: JSON.stringify(choice) });
      this.emit('session.idle', { mode: 'interactive' }); return;
    }
    if (prompt === 'parallel permission fixture') {
      const results = await Promise.all(['one', 'two', 'three'].map(name =>
        this.permission({ kind: 'read', path: `/fixture/project/${name}`, intention: `Search in directory: /fixture/project/${name}` })));
      this.emit('assistant.message', { messageId: `permissions-${turn}`, content: JSON.stringify(results) });
      this.emit('session.idle', {}); return;
    }
    if (prompt.startsWith('scoped permission fixture:')) {
      const request = JSON.parse(prompt.slice('scoped permission fixture:'.length));
      const result = await this.permission(request);
      this.emit('assistant.message', { messageId: `permission-${turn}`, content: JSON.stringify(result) });
      this.emit('session.idle', {}); return;
    }
    if (prompt === 'url permission fixture') {
      await this.permission({ kind: 'url', url: 'https://example.test/permission' });
      this.emit('session.idle', {}); return;
    }
    if (prompt === 'input fixture') {
      const answer = await this.config.onUserInputRequest({ question: 'Fixture question', choices: ['First', 'Second'], allowFreeform: true });
      this.emit('assistant.message', { messageId: `answer-${turn}`, content: answer.answer });
      this.emit('session.idle', {}); return;
    }
    const tool = { toolCallId: `tool-${turn}`, toolName: 'bash', arguments: { command: 'printf fixture-only' } };
    this.emit('tool.execution_start', tool);
    const permission = await this.permission({ kind: 'shell', toolCallId: tool.toolCallId, fullCommandText: 'printf fixture-only' });
    if (permission.kind !== 'approve-once') { this.emit('session.idle', {}); return; }
    this.emit('tool.execution_partial_result', { toolCallId: tool.toolCallId, partialOutput: 'fixture output' });
    if (turn > 1) return;
    this.emit('tool.execution_complete', { toolCallId: tool.toolCallId, success: true, result: { content: 'fixture output' } });
    const content = `Offline SDK response.\n\n${Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: offline fixture text.`).join('\n\n')}`;
    this.emit('assistant.message_delta', { messageId: `answer-${turn}`, deltaContent: content });
    this.emit('assistant.message', { messageId: `answer-${turn}`, content });
    this.totalNanoAiu += 12_300_000_000;
    this.emit('assistant.usage', { model: this.model || 'fixture', cost: 999, inputTokens: 50000, outputTokens: 10000 });
    this.emit('session.usage_info', { currentTokens: 31875, tokenLimit: 125000, messagesLength: this.sequence });
    this.emit('session.idle', {});
  }
  async abort() { this.emit('session.idle', {}); }
  async setModel(model, options) {
    this.configured = true; this.model = model; this.effort = options?.reasoningEffort; this.contextTier = options?.contextTier;
    this.emit('session.model_change', { newModel: model, reasoningEffort: this.effort, contextTier: this.contextTier });
  }
  async disconnect() { this.disconnected = true; this.listeners = []; }
}
