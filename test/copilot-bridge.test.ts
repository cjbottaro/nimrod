import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import test from 'node:test';
import { CopilotSession } from '../src/copilot/session';
import { createTranscriptLog } from '../src/transcript-logs';

function bridge(mode = 'interactive', receive?: (packet: Record<string, any>) => void, modelState = 'resolved', defaults: Record<string, unknown> = { model: 'small', effortLevel: 'low' }, usageState = 'complete', contextState = 'default') {
  const child = spawn(process.execPath, ['--import', './test/fixtures/copilot-sdk-register.mjs', 'copilot/bridge.mjs', '/fixture/copilot', '/fixture/project'], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, NIMROD_FIXTURE_COPILOT_MODE: mode, NIMROD_FIXTURE_COPILOT_MODEL_STATE: modelState, NIMROD_FIXTURE_COPILOT_DEFAULTS: JSON.stringify(defaults), NIMROD_FIXTURE_COPILOT_USAGE_STATE: usageState, NIMROD_FIXTURE_COPILOT_CONTEXT_STATE: contextState } });
  const packets: Record<string, any>[] = [], pending = new Map<string, { resolve(value: any): void; reject(error: Error): void }>();
  const waiting = new Set<{ predicate(packet: Record<string, any>): boolean; resolve(packet: Record<string, any>): void; reject(error: Error): void }>();
  let stderr = '', sequence = 0;
  child.stderr.on('data', chunk => { stderr += chunk; });
  createInterface({ input: child.stdout }).on('line', line => {
    const packet = JSON.parse(line); packets.push(packet); receive?.(packet);
    for (const waiter of waiting) if (waiter.predicate(packet)) { waiting.delete(waiter); waiter.resolve(packet); }
    if (packet.kind !== 'result') return;
    const request = pending.get(packet.id); pending.delete(packet.id);
    if (packet.error) request?.reject(new Error(packet.error)); else request?.resolve(packet.result);
  });
  child.on('error', error => { for (const request of pending.values()) request.reject(error); pending.clear(); });
  const exited = new Promise<number | null>(resolve => child.once('exit', code => {
    for (const request of pending.values()) request.reject(new Error(`Offline bridge exited: ${stderr}`));
    pending.clear();
    for (const waiter of waiting) waiter.reject(new Error(`Offline bridge exited: ${stderr}`)); waiting.clear();
    resolve(code);
  }));
  return {
    packets,
    waitFor(predicate: (packet: Record<string, any>) => boolean): Promise<Record<string, any>> {
      const existing = packets.find(predicate);
      return existing ? Promise.resolve(existing) : new Promise((resolve, reject) => waiting.add({ predicate, resolve, reject }));
    },
    send(message: object) { child.stdin.write(`${JSON.stringify(message)}\n`); },
    request(method: string, parameters: Record<string, unknown> = {}): Promise<any> {
      const id = String(++sequence);
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ ...parameters, id, method })}\n`);
      });
    },
    async close() {
      child.stdin.end();
      const deadline = setTimeout(() => { child.kill('SIGKILL'); }, 2000);
      try { assert.equal(await exited, 0, stderr); } finally { clearTimeout(deadline); }
    },
  };
}
for (const text of ['', 'Image caption']) test(`SDK bridge maps inline images to blob attachments (${text || 'image only'})`, { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize'); await f.request('connect');
    const images = [{ type: 'image', mimeType: 'image/png', data: 'YWJj' }];
    await f.request('prompt', { text, images });
    const echo = await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'user.message');
    assert.equal(echo.event.data.content, text);
    assert.deepEqual(echo.event.data.attachments, [{ type: 'blob', mimeType: 'image/png', data: 'YWJj' }]);
    await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'session.idle');
    assert.equal(f.packets.filter(packet => packet.kind === 'event' && packet.event.type === 'user.message').length, 1);
  } finally { await f.close(); }
});

for (const sessionId of [undefined, 'fixture-sdk']) {
  test(`SDK bridge delegates configuration discovery to Copilot on ${sessionId ? 'Resume' : 'creation'}`, { timeout: 5000 }, async () => {
    const f = bridge();
    try {
      await f.request('initialize');
      // The SDK fixture asserts discovery is enabled without host-supplied roots.
      await f.request('connect', sessionId ? { sessionId } : {});
      assert.deepEqual(await f.request('command-skills'), { skills: [
        { name: 'fixture-skill', description: 'Fixture skill details', enabled: true },
        { name: 'disabled-skill', description: 'Disabled fixture skill', enabled: false },
      ] });
      assert.equal(f.packets.some(packet => ['event', 'permission', 'input'].includes(packet.kind)), false, 'discovery does not send prompts or resume pending work');
    } finally { await f.close(); }
  });
}

test('SDK bridge rejects malformed and oversized images before invoking send', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize'); await f.request('connect');
    const image = { type: 'image', mimeType: 'image/png', data: 'YWJj' };
    for (const images of [null, {}, Array(9).fill(image), [{ ...image, mimeType: 'image/svg+xml' }], [{ ...image, data: 'javascript:evil' }], [{ ...image, data: 'AAAA'.repeat(1_400_000) }]])
      await assert.rejects(f.request('prompt', { text: '', images }), /image|size/i);
    await assert.rejects(f.request('prompt', { text: '/permissions show', images: [image] }), /slash commands/);
    assert.equal(f.packets.some(packet => packet.kind === 'event' && packet.event.type === 'user.message'), false);
  } finally { await f.close(); }
});

test('SDK getEvents returns image history through the same controller projection', { timeout: 5000 }, async () => {
  let session: CopilotSession | undefined;
  const f = bridge('interactive', packet => session?.receive(packet), 'image-history');
  session = new CopilotSession(async message => f.send(message), { publish() {}, changed() {}, identified() {}, disconnected() {}, completed() {}, notice() {}, decision: async () => undefined });
  try {
    await session.initialize('fixture-sdk');
    assert.deepEqual(session.state.messages.find(message => message.role === 'user')?.content, [
      { type: 'text', text: 'Saved SDK question' }, { type: 'image', mimeType: 'image/png', data: 'YWJj' },
    ]);
    assert.equal(f.packets.some(packet => packet.kind === 'event' && packet.event.type === 'user.message'), false, 'Resume does not send prompts');
  } finally { session.disconnect('fixture complete'); await f.close(); }
});

test('production SDK bridge loads only exact project members and disconnects without deleting', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    assert.equal((await f.request('initialize')).version, '1.0.98');
    assert.deepEqual((await f.request('list')).map((session: { sessionId: string }) => session.sessionId), ['fixture-sdk']);
    await assert.rejects(f.request('connect', { sessionId: 'outside' }), /Nothing was loaded or deleted/);
    await f.request('connect', { sessionId: 'fixture-sdk' });
    const connected = f.packets.find(packet => packet.kind === 'connected')!;
    assert.equal(connected.sessionId, 'fixture-sdk');
    assert.equal(connected.events[1].data.content, 'Saved SDK answer');
    assert.equal(connected.model.modelId, 'large', 'new-session defaults must never override a resumed selection');
    assert.equal(connected.model.reasoningEffort, undefined);
    assert.ok(f.packets.findIndex(packet => packet.kind === 'identified') < f.packets.indexOf(connected));
    assert.equal(f.packets.some(packet => packet.kind === 'permission' || packet.kind === 'input'), false);
    const configured = await f.request('configure', { setting: 'effort', value: 'high' });
    assert.equal(configured.model.reasoningEffort, 'high');
    const context = await f.request('configure', { setting: 'context-tier', value: 'long_context' });
    assert.equal(context.model.contextTier, 'long_context');
    const mode = await f.request('configure', { setting: 'mode', value: 'plan' });
    assert.equal(mode.mode, 'plan');
    await assert.rejects(f.request('delete', { sessionId: 'fixture-sdk' }), /history-only/);
  } finally { await f.close(); }
});

for (const scenario of ['accepted', 'rejected', 'new-work', 'child', 'intermediate']) {
  test(`production bridge and controller agree on sticky Autopilot completion (${scenario})`, { timeout: 5000 }, async () => {
    let session: CopilotSession | undefined;
    const completed: boolean[] = [], responses: (string | undefined)[] = [];
    const f = bridge('autopilot', packet => session?.receive(packet));
    session = new CopilotSession(async message => f.send(message), {
      publish() {}, changed() {}, identified() {}, disconnected() {},
      completed(failed, response) { completed.push(failed); responses.push(response); },
      notice(message) { assert.fail(message); }, decision: async () => undefined,
    });
    try {
      await session.initialize('fixture-sdk');
      await session.handle({ type: 'prompt', id: 'autonomous', text: `autopilot completion fixture:${scenario}` });
      await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'session.idle');
      assert.equal(session.state.busy, scenario !== 'accepted');
      assert.equal(session.canSubmit, scenario === 'accepted');
      assert.equal(session.configuration.get('mode'), 'autopilot');
      assert.deepEqual(completed, scenario === 'accepted' ? [false] : []);
      assert.deepEqual(responses, scenario === 'accepted' ? ['Created the requested change.'] : []);
      if (scenario === 'accepted') {
        // This idle-only command proves the production bridge released its own
        // working gate too, not just the frontend's Working projection.
        await f.request('command', { name: 'discover-fixture' });
        await session.handle({ type: 'prompt', id: 'next-autonomous', text: 'autopilot completion fixture:intermediate' });
        await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'user.message'
          && packet.event.data.content === 'autopilot completion fixture:intermediate');
        await assert.rejects(f.request('command', { name: 'new-fixture' }), /started working/);
        assert.equal(session.state.busy, true);
        assert.deepEqual(completed, [false]);
      } else {
        await assert.rejects(f.request('command', { name: 'discover-fixture' }), /started working/);
      }
      assert.equal(f.packets.filter(packet => packet.kind === 'event' && packet.event.type === 'user.message').length, scenario === 'accepted' ? 2 : 1);
    } finally { session.disconnect('offline completion fixture complete'); await f.close(); }
  });
}

for (const selectedAction of ['interactive', 'autopilot', 'exit_only', 'revise', undefined]) {
  test(`plan decisions remain scoped and survive intermediate idle (${selectedAction ?? 'cancel'})`, { timeout: 5000 }, async () => {
    const f = bridge('plan');
    try {
      await f.request('initialize');
      await f.request('connect', { sessionId: 'fixture-sdk' });
      await f.request('prompt', { text: 'plan mode fixture' });
      const plan = await f.waitFor(packet => packet.kind === 'plan');
      await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'session.idle' && packet.event.data.mode === 'autopilot');
      for (const value of [
        { approved: true },
        { approved: true, selectedAction: 'invented-action' },
        { approved: false, selectedAction: 'autopilot' },
      ]) await assert.rejects(f.request('decision', { decisionId: plan.id, value }), /Invalid plan-mode decision/);
      const value = selectedAction === undefined ? { approved: false } : selectedAction === 'revise'
        ? { approved: false, feedback: 'Preserve the existing API before implementing.' } : { approved: true, selectedAction };
      await f.request('decision', { decisionId: plan.id, value });
      const response = await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'assistant.message');
      assert.deepEqual(JSON.parse(response.event.data.content), value);
      await assert.rejects(f.request('decision', { decisionId: plan.id, value }), /no longer pending/);
    } finally { await f.close(); }
  });
}
for (const modelState of ['resolved', 'model-only', 'unresolved']) {
  test(`new SDK sessions honor configured creation defaults before any prompt (${modelState})`, { timeout: 5000 }, async () => {
    let session: CopilotSession | undefined;
    const f = bridge('interactive', packet => session?.receive(packet), modelState);
    session = new CopilotSession(async message => f.send(message), {
      publish() {}, changed() {}, identified() {}, disconnected() {},
      notice(message) { assert.fail(message); }, completed() { assert.fail('Startup must not complete a turn'); },
      decision: async () => { assert.fail('Startup must not request permission or input'); },
    });
    try {
      await session.initialize();
      const status = session.state.statusArea!;
      assert.equal(status.controls.find(control => control.id === 'model')?.label, 'small');
      const effort = status.controls.find(control => control.id === 'thinking');
      assert.equal(effort?.label, 'low');
      assert.ok(status.controls.every(control => !control.disabled));
      assert.equal(session.state.messages.length, 0);
      assert.deepEqual(f.packets.filter(packet => ['event', 'permission', 'input'].includes(packet.kind)), [], 'initialization must not send a prompt or explicitly switch models');
    } finally { session.disconnect('offline startup fixture complete'); await f.close(); }
  });
}

for (const scenario of [
  { defaults: { model: null, effortLevel: null }, model: 'default model', effort: 'default effort', disabled: true },
  { defaults: {}, model: 'default model', effort: 'default effort', disabled: true },
  { defaults: { model: 'small', effortLevel: null }, model: 'small', effort: 'default effort', disabled: false },
  { defaults: { model: null, effortLevel: 'high' }, model: 'default model', effort: 'high', disabled: true },
  { defaults: { model: 'small', effortLevel: 'high', unrelatedSecret: 'must-not-be-published' }, model: 'small', effort: 'high', disabled: false },
]) {
  test(`SDK defaults are independent creation inputs and lowercase unknown labels (${JSON.stringify(scenario.defaults)})`, { timeout: 5000 }, async () => {
    let session: CopilotSession | undefined;
    const f = bridge('interactive', packet => session?.receive(packet), 'unresolved', scenario.defaults);
    session = new CopilotSession(async message => f.send(message), {
      publish() {}, changed() {}, identified() {}, disconnected() {}, notice(message) { assert.fail(message); },
      completed() { assert.fail('No startup turn'); }, decision: async () => { assert.fail('No startup decision'); },
    });
    try {
      await session.initialize();
      const controls = session.state.statusArea!.controls;
      assert.equal(controls.find(control => control.id === 'model')?.label, scenario.model);
      assert.equal(controls.find(control => control.id === 'thinking')?.label, scenario.effort);
      assert.equal(controls.find(control => control.id === 'thinking')?.disabled, scenario.disabled);
      assert.equal(session.configuration.get('model'), scenario.defaults.model ?? undefined);
      assert.equal(session.configuration.get('effort'), scenario.defaults.effortLevel ?? undefined);
      assert.equal(JSON.stringify(f.packets).includes('must-not-be-published'), false);
      assert.equal(session.state.messages.length, 0);
      assert.equal(f.packets.some(packet => ['permission', 'input', 'event'].includes(packet.kind)), false);
    } finally { session.disconnect('offline defaults fixture complete'); await f.close(); }
  });
}

for (const modelState of ['native-override', 'native-effort']) {
  test(`SDK initial authoritative state outranks configured defaults (${modelState})`, { timeout: 5000 }, async () => {
    const f = bridge('interactive', undefined, modelState);
    try {
      await f.request('initialize'); await f.request('connect');
      const model = f.packets.find(packet => packet.kind === 'connected')!.model;
      assert.equal(model.modelId, modelState === 'native-override' ? 'large' : 'small');
      assert.equal(model.reasoningEffort, modelState === 'native-override' ? undefined : 'high');
    } finally { await f.close(); }
  });
}

test('SDK creation defaults never revive an omitted value in a later configuration result', { timeout: 5000 }, async () => {
  const f = bridge('interactive', undefined, 'unresolved', { model: 'small', effortLevel: 'high' });
  try {
    await f.request('initialize'); await f.request('connect');
    assert.equal(f.packets.find(packet => packet.kind === 'connected')!.model.reasoningEffort, 'high');
    const changed = await f.request('configure', { setting: 'model', value: 'large' });
    assert.equal(changed.model.modelId, 'large');
    assert.equal(changed.model.reasoningEffort, undefined);
  } finally { await f.close(); }
});

for (const defaults of [{ model: 42, effortLevel: null }, { model: 'small', effortLevel: {} }]) {
  test(`malformed configured defaults fail before session creation (${JSON.stringify(defaults)})`, { timeout: 5000 }, async () => {
    const f = bridge('interactive', undefined, 'resolved', defaults);
    try {
      await f.request('initialize'); await assert.rejects(f.request('connect'), /invalid .* setting/);
      assert.equal(f.packets.some(packet => packet.kind === 'identified'), false);
    } finally { await f.close(); }
  });
}

test('SDK concurrent connect requests cannot duplicate creation while defaults are being read', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize');
    const [first, second] = await Promise.allSettled([f.request('connect'), f.request('connect')]);
    assert.equal(first.status, 'fulfilled');
    assert.equal(second.status, 'rejected');
    if (second.status === 'rejected') assert.match(String(second.reason), /already owns or is connecting/);
    assert.equal(f.packets.filter(packet => packet.kind === 'identified').length, 1);
  } finally { await f.close(); }
});

test('SDK settings failure prevents creation, but never affects exact-ID Resume', { timeout: 5000 }, async () => {
  const f = bridge('interactive', undefined, 'settings-error');
  try {
    await f.request('initialize'); await assert.rejects(f.request('connect'), /settings read failed/);
    assert.equal(f.packets.some(packet => packet.kind === 'identified' || packet.kind === 'connected'), false);
  } finally { await f.close(); }
  const resumed = bridge('interactive', undefined, 'settings-error');
  try {
    await resumed.request('initialize'); await resumed.request('connect', { sessionId: 'fixture-sdk' });
    assert.equal(resumed.packets.find(packet => packet.kind === 'connected')!.model.modelId, 'large');
  } finally { await resumed.close(); }
});

test('production SDK bridge reads aggregate session accounting without leaking model maps or request multipliers', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize'); await f.request('connect', { sessionId: 'fixture-sdk' });
    const metrics = await f.request('usage');
    assert.deepEqual(metrics, { totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' });
    assert.equal(JSON.stringify(metrics).includes('must-not-leave-metadata-boundary'), false);
    assert.equal(f.packets.some(packet => packet.kind === 'event' && packet.event.type === 'user.message'), false);
  } finally { await f.close(); }
});

test('production SDK context read restores a resumed window without a prompt or a live usage event', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize'); await f.request('connect', { sessionId: 'fixture-sdk' });
    assert.deepEqual(await f.request('context'), { currentTokens: 31875, tokenLimit: 125000 }, 'use SDK limit, not the smaller effective prompt budget');
    assert.equal(f.packets.some(packet => packet.kind === 'event' && ['user.message', 'session.usage_info'].includes(packet.event.type)), false);
  } finally { await f.close(); }
});

for (const contextState of ['null', 'error']) {
  test(`uninitialized/failed SDK context does not prevent restored credit accounting (${contextState})`, { timeout: 5000 }, async () => {
    const f = bridge('interactive', undefined, 'resolved', { model: 'small', effortLevel: 'low' }, 'complete', contextState);
    try {
      await f.request('initialize'); await f.request('connect', { sessionId: 'fixture-sdk' });
      if (contextState === 'null') assert.equal(await f.request('context'), null);
      else await assert.rejects(f.request('context'), /context metadata unavailable/);
      assert.deepEqual(await f.request('usage'), { totalNanoAiu: 12_300_000_000, aiCreditsStatus: 'complete' });
      assert.equal(f.packets.some(packet => packet.kind === 'fatal'), false);
    } finally { await f.close(); }
  });
}

test('optional SDK accounting failures leave the connected conversation usable', { timeout: 5000 }, async () => {
  const f = bridge('interactive', undefined, 'resolved', { model: 'small', effortLevel: 'low' }, 'error');
  try {
    await f.request('initialize'); await f.request('connect');
    await assert.rejects(f.request('usage'), /usage metadata unavailable/);
    await f.request('commands');
    assert.equal(f.packets.some(packet => packet.kind === 'fatal'), false);
  } finally { await f.close(); }
});

test('production SDK bridge tool and permission packets reach the JSONL capture sink unchanged', { timeout: 5000 }, async () => {
  const lines: string[] = [], errors: string[] = [];
  const capture = createTranscriptLog({ write: async batch => { lines.push(...batch); }, failure: message => errors.push(message), recovered() {} });
  capture.setEnabled(true);
  let completed!: () => void;
  const finished = new Promise<void>(resolve => { completed = resolve; });
  let session: CopilotSession | undefined;
  const f = bridge('interactive', packet => session?.receive(packet));
  session = new CopilotSession(async message => f.send(message), {
    publish() {}, changed() {}, identified() {}, disconnected() {}, notice: message => errors.push(message),
    completed: () => completed(), decision: async () => ({ kind: 'approve-once', approvedInteractively: true } as const), transcriptLog: capture,
  });
  try {
    await session.initialize();
    await session.handle({ type: 'prompt', id: 'offline-capture', text: 'Offline fake SDK only; no command is executed' });
    await finished; await capture.flush();
    const records = lines.map(line => JSON.parse(line));
    const tools = records.filter(record => record.event.startsWith('tool.') || record.event === 'permission.request');
    assert.deepEqual(tools.map(record => record.event), ['tool.execution_start', 'permission.request', 'tool.execution_partial_result', 'tool.execution_complete']);
    const native = f.packets.filter(packet => packet.kind === 'event' && packet.event.type.startsWith('tool.') || packet.kind === 'permission')
      .map(packet => packet.kind === 'permission' ? packet : packet.event);
    assert.deepEqual(tools.map(record => record.payload), native);
    assert.ok(tools.every(record => record.sessionId === 'fixture-sdk' && record.source.backend === 'copilot-sdk' && record.source.version === '1.0.98'));
    assert.ok(records.some(record => record.event === 'request.prompt' && record.payload.text.includes('Offline fake SDK')));
    assert.ok(records.some(record => record.event === 'session.idle'));
    assert.deepEqual(errors, []);
  } finally { session.disconnect('offline capture fixture complete'); capture.dispose(); await f.close(); }
});

for (const choice of [{ kind: 'approve-once', approvedInteractively: true }, { kind: 'reject' }, { kind: 'user-not-available' }]) {
  test(`SDK permissions send live CLI decision variants, not legacy outcomes (${choice.kind})`, { timeout: 5000 }, async () => {
    const f = bridge();
    try {
      await f.request('initialize'); await f.request('connect');
      await f.request('prompt', { text: 'Offline permission fixture only' });
      const permission = await f.waitFor(packet => packet.kind === 'permission');
      for (const invalid of [{ kind: 'approved' }, { kind: 'denied-interactively-by-user' }, { kind: 'approve-once' }, { kind: 'approve-for-session' }, { kind: 'approve-once', approvedInteractively: true, approval: { scope: 'permanent' } }]) {
        await assert.rejects(f.request('decision', { decisionId: permission.id, value: invalid }), /Invalid permission decision/);
      }
      assert.equal(f.packets.some(packet => packet.kind === 'event' && packet.event.type === 'tool.execution_partial_result'), false);
      await f.request('decision', { decisionId: permission.id, value: choice });
      await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'session.idle');
      assert.equal(f.packets.some(packet => packet.kind === 'event' && packet.event.type === 'tool.execution_partial_result'), choice.kind === 'approve-once');
    } finally { await f.close(); }
  });
}

for (const [request, choice] of [
  [{ kind: 'read', path: '/fixture/project/test' }, { kind: 'approve-for-session', approval: { kind: 'read' } }],
  [{ kind: 'write', fileName: '/fixture/project/file', canOfferSessionApproval: true }, { kind: 'approve-for-session', approval: { kind: 'write' } }],
  [{ kind: 'shell', canOfferSessionApproval: true, fullCommandText: 'git status', commands: [{ identifier: 'git', readOnly: true }] },
    { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: ['git'] } }],
  [{ kind: 'shell', canOfferSessionApproval: true, fullCommandText: 'git worktree add /fixture/tree',
    commands: [{ identifier: 'git worktree add /fixture/tree' }], commandSegments: [{ identifier: 'git worktree' }] },
    { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: ['git worktree add /fixture/tree'] } }],
  [{ kind: 'mcp', serverName: 'fixture', toolName: 'lookup' },
    { kind: 'approve-for-session', approval: { kind: 'mcp', serverName: 'fixture', toolName: 'lookup' } }],
  [{ kind: 'url', url: 'https://example.test/docs' }, { kind: 'approve-for-session', domain: 'example.test' }],
  [{ kind: 'url', url: 'https://example.test/docs' }, { kind: 'approve-permanently', domain: 'example.test' }],
  [{ kind: 'read', path: '/fixture/project/test' }, { kind: 'reject', feedback: 'Use another approach' }],
] as const) {
  test(`bridge forwards exact scoped permission decisions (${request.kind}/${choice.kind})`, { timeout: 5000 }, async () => {
    const f = bridge();
    try {
      await f.request('initialize'); await f.request('connect');
      await f.request('prompt', { text: `scoped permission fixture:${JSON.stringify(request)}` });
      const permission = await f.waitFor(packet => packet.kind === 'permission');
      for (const value of [
        { ...choice, unexpected: true }, { kind: 'approve-for-session' },
        { kind: 'approve-for-session', approval: { kind: 'commands', commandIdentifiers: ['git worktree'] } },
        { kind: 'approve-for-session', approval: { kind: 'mcp', serverName: 'fixture', toolName: null } },
        { kind: 'approve-permanently', domain: 'other.test' },
      ]) await assert.rejects(f.request('decision', { decisionId: permission.id, value }), /Invalid permission decision/);
      await f.request('decision', { decisionId: permission.id, value: choice });
      const result = await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'assistant.message');
      assert.deepEqual(JSON.parse(result.event.data.content), choice);
    } finally { await f.close(); }
  });
}

for (const capability of [false, undefined, 'true']) {
  for (const kind of ['shell', 'write']) {
    test(`bridge refuses ${kind} session grants without an explicit capability (${String(capability)})`, { timeout: 5000 }, async () => {
      const f = bridge();
      try {
        const request = kind === 'shell' ? { kind, fullCommandText: 'git status', commands: [{ identifier: 'git status' }],
          commandSegments: [{ identifier: 'git', fullCommandText: 'git status' }], canOfferSessionApproval: capability }
          : { kind, fileName: '/fixture/file', canOfferSessionApproval: capability };
        await f.request('initialize'); await f.request('connect');
        await f.request('prompt', { text: `scoped permission fixture:${JSON.stringify(request)}` });
        const permission = await f.waitFor(packet => packet.kind === 'permission');
        const approval = kind === 'shell' ? { kind: 'commands', commandIdentifiers: ['git status'] } : { kind: 'write' };
        await assert.rejects(f.request('decision', { decisionId: permission.id, value: { kind: 'approve-for-session', approval } }), /Invalid permission decision/);
        await f.request('decision', { decisionId: permission.id, value: { kind: 'reject' } });
        await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'session.idle');
      } finally { await f.close(); }
    });
  }
}

for (const flag of ['managedApprovalRequired', 'requestSandboxBypass']) {
  test(`bridge refuses standing approvals for ${flag}`, { timeout: 5000 }, async () => {
    const f = bridge();
    try {
      await f.request('initialize'); await f.request('connect');
      await f.request('prompt', { text: `scoped permission fixture:${JSON.stringify({ kind: 'url', url: 'https://example.test/', [flag]: true })}` });
      const permission = await f.waitFor(packet => packet.kind === 'permission');
      for (const kind of ['approve-for-session', 'approve-permanently'])
        await assert.rejects(f.request('decision', { decisionId: permission.id, value: { kind, domain: 'example.test' } }), /Invalid permission decision/);
      await f.request('decision', { decisionId: permission.id, value: { kind: 'user-not-available' } });
      await f.waitFor(packet => packet.kind === 'event' && packet.event.type === 'session.idle');
    } finally { await f.close(); }
  });
}

test('SDK reconnects the exact identity in its authoritative mode without prompting', { timeout: 5000 }, async () => {
  const f = bridge('plan');
  try {
    await f.request('initialize');
    await f.request('connect', { sessionId: 'fixture-sdk' });
    assert.equal(f.packets.find(packet => packet.kind === 'identified')?.sessionId, 'fixture-sdk');
    assert.equal(f.packets.find(packet => packet.kind === 'connected')?.mode, 'plan');
    assert.equal(f.packets.some(packet => packet.kind === 'event'), false);
  } finally { await f.close(); }
});
test('SDK commands use discovery/invocation, retain arguments and choices, and never fall through to prompts', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize'); await f.request('connect', { sessionId: 'fixture-sdk' });
    assert.equal(f.packets.find(packet => packet.kind === 'commands')?.commands[0].input.choices[0].name, 'show');
    const menu = await f.request('command', { name: 'permissions' });
    assert.equal(menu.kind, 'text'); assert.equal(menu.text, 'Fixture permission report: show');
    const report = await f.request('command', { name: 'perms', input: 'show  literal\nrest' });
    assert.equal(report.kind, 'text'); assert.equal(report.text, 'Fixture permission report: show  literal\nrest');
    assert.deepEqual(await f.request('command-skills'), { skills: [
      { name: 'fixture-skill', description: 'Fixture skill details', enabled: true },
      { name: 'disabled-skill', description: 'Disabled fixture skill', enabled: false },
    ] });
    await assert.rejects(f.request('command', { name: 'missing' }), /not advertised/);
    await assert.rejects(f.request('prompt', { text: '/permissions show' }), /invocation API/);
    await f.request('command', { name: 'discover-fixture' });
    assert.ok(f.packets.filter(packet => packet.kind === 'commands').at(-1)?.commands.some((command: { name: string }) => command.name === 'new-fixture'));
    assert.equal((await f.request('command', { name: 'new-fixture' })).message, 'New command works');
    assert.equal(f.packets.some(packet => packet.kind === 'event' && packet.event.type === 'user.message'), false);
  } finally { await f.close(); }
});

test('production SDK discovery deletes only through the supported API and never recreates a missing ID', { timeout: 5000 }, async () => {
  const f = bridge();
  try {
    await f.request('initialize');
    await assert.rejects(f.request('delete', { sessionId: 'outside' }), /Nothing was loaded or deleted/);
    await f.request('delete', { sessionId: 'fixture-sdk' });
    assert.deepEqual(await f.request('list'), []);
    await assert.rejects(f.request('connect', { sessionId: 'fixture-sdk' }), /Nothing was loaded or deleted/);
    assert.equal(f.packets.some(packet => packet.kind === 'connected'), false);
  } finally { await f.close(); }
});
