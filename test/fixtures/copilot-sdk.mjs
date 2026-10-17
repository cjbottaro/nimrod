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
  async listModels() { return [{ id: 'small', name: 'Fixture small', supportedReasoningEfforts: ['low', 'high'] }, { id: 'large', name: 'Fixture large' }]; }
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
  configured = false;
  commandCatalog = [
    { name: 'permissions', aliases: ['perms'], description: 'Manage permissions', kind: 'builtin', allowDuringAgentExecution: true,
      input: { hint: 'Permission operation', choices: [{ name: 'show', description: 'Show permissions' }, { name: 'reset', description: 'Clear approvals' }] } },
    { name: 'discover-fixture', description: 'Add a new fixture command', kind: 'builtin', allowDuringAgentExecution: false },
  ];
  rpc = {
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
        return { modelId: this.model, reasoningEffort: this.effort };
      },
    },
    mode: { get: async () => process.env.NIMROD_FIXTURE_COPILOT_MODE || 'interactive' },
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
    if (saved) { this.model = 'large'; this.effort = undefined; }
    else { this.model = config.model; this.effort = config.reasoningEffort; }
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
  async run(prompt, turn) {
    this.emit('user.message', { content: prompt }); this.emit('assistant.turn_start', {});
    if (prompt === 'url permission fixture') {
      await this.config.onPermissionRequest({ kind: 'url', url: 'https://example.test/permission' });
      this.emit('session.idle', {}); return;
    }
    if (prompt === 'input fixture') {
      const answer = await this.config.onUserInputRequest({ question: 'Fixture question', choices: ['First', 'Second'], allowFreeform: true });
      this.emit('assistant.message', { messageId: `answer-${turn}`, content: answer.answer });
      this.emit('session.idle', {}); return;
    }
    const tool = { toolCallId: `tool-${turn}`, toolName: 'bash', arguments: { command: 'printf fixture-only' } };
    this.emit('tool.execution_start', tool);
    const permission = await this.config.onPermissionRequest({ kind: 'shell', toolCallId: tool.toolCallId, fullCommandText: 'printf fixture-only' });
    if (permission.kind !== 'approved') { this.emit('session.idle', {}); return; }
    this.emit('tool.execution_partial_result', { toolCallId: tool.toolCallId, partialOutput: 'fixture output' });
    if (turn > 1) return;
    this.emit('tool.execution_complete', { toolCallId: tool.toolCallId, success: true, result: { content: 'fixture output' } });
    const content = `Offline SDK response.\n\n${Array.from({ length: 30 }, (_, i) => `Paragraph ${i + 1}: offline fixture text.`).join('\n\n')}`;
    this.emit('assistant.message_delta', { messageId: `answer-${turn}`, deltaContent: content });
    this.emit('assistant.message', { messageId: `answer-${turn}`, content }); this.emit('session.idle', {});
  }
  async abort() { this.emit('session.idle', {}); }
  async setModel(model, options) {
    this.configured = true; this.model = model; this.effort = options?.reasoningEffort;
    this.emit('session.model_change', { newModel: model, reasoningEffort: this.effort });
  }
  async disconnect() { this.disconnected = true; this.listeners = []; }
}
