import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';
import { createCopilotConfiguration } from './configuration.mjs';
import { completeCommandEffect } from './command-effects.mjs';
import { permissionMode, applyPermissionChange } from './permission-configuration.mjs';
import { validPermissionDecision } from './permissions.mjs';

const [cli, cwd] = process.argv.slice(2);
if (!cli || !isAbsolute(cli) || !cwd || !isAbsolute(cwd)) throw new Error('An absolute user-installed Copilot executable and project are required.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (!(major === 20 && minor >= 19 || major === 22 && minor >= 12 || major > 22)) throw new Error('Copilot SDK requires Node 20.19+ (20.x) or 22.12+.');
const { CopilotClient, RuntimeConnection } = await import('@github/copilot-sdk');
const client = new CopilotClient({
  connection: RuntimeConnection.forStdio({ path: cli }),
  workingDirectory: cwd, useLoggedInUser: true, mode: 'copilot-cli',
  clientInfo: { applicationName: 'Nimrod', integrationName: 'nimrod-copilot-sdk' },
});
const configuration = createCopilotConfiguration(client);
let session, connecting = false, closing = false, initialized = false;
let checkingHealth = false;
let replaying = false, buffered = [];
let commandRefresh;
let usageRead;
let commandExecuting = false;
let working = false, permissionRevision = 0;
async function refreshPermissionMode(owner) {
  const revision = permissionRevision;
  try {
    const mode = await permissionMode(owner);
    if (!closing && session === owner && permissionRevision === revision) send({ kind: 'permission-mode', mode });
  } catch { /* Optional metadata leaves the current value unknown; never gate chat. */ }
}
function observeWork(value) {
  if (value.agentId) return;
  if (value.type === 'session.permissions_changed' && value.data?.mode !== undefined) permissionRevision++;
  if (value.type === 'assistant.turn_start' || value.type === 'user.message') working = true;
  if (value.type === 'session.error' || value.type === 'session.idle' && (value.data?.mode !== 'autopilot' || value.data?.aborted === true)) working = false;
}
async function refreshCommands() {
  if (!session || closing) return;
  if (commandRefresh) return commandRefresh;
  commandRefresh = (async () => {
    const { commands } = await session.rpc.commands.list();
    if (!Array.isArray(commands)) throw new Error('Copilot returned an invalid command catalog');
    send({ kind: 'commands', commands });
  })().finally(() => { commandRefresh = undefined; });
  return commandRefresh;
}
const decisions = new Map();
const send = value => process.stdout.write(`${JSON.stringify(value)}\n`);
const failure = error => error instanceof Error ? error.message : String(error);
function decision(kind, request) {
  if (closing) return Promise.reject(new Error('Copilot connection is closing'));
  const id = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    decisions.set(id, { resolve, reject, kind, request });
    send({ kind, id, request });
  });
}
const config = () => ({
  workingDirectory: cwd, streaming: true, clientName: 'Nimrod',
  onEvent: event,
  onPermissionRequest: request => decision('permission', request),
  onUserInputRequest: request => decision('input', request),
  onExitPlanModeRequest: request => decision('plan', request),
  onAutoModeSwitchRequest: () => 'no',
});
function event(value) {
  if (!value.agentId && (value.type === 'session.error'
    || value.type === 'session.idle' && (value.data?.mode !== 'autopilot' || value.data?.aborted === true))) cancelDecisions();
  if (replaying) buffered.push(value);
  else {
    observeWork(value);
    send({ kind: 'event', event: value });
    if (!value.agentId && value.type === 'commands.changed') void refreshCommands().catch(error => send({ kind: 'command-error', error: `Command discovery failed: ${failure(error)}` }));
  }
}
async function membership(id) {
  const sessions = await client.listSessions({ workingDirectory: cwd });
  if (!sessions.some(item => item.sessionId === id && !item.isRemote && item.context?.workingDirectory === cwd))
    throw new Error('This exact saved session is not listed in this project. Nothing was loaded or deleted.');
}
function promptImages(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 8) throw new Error('Invalid image attachments');
  let total = 0;
  return value.map(image => {
    if (!image || image.type !== 'image' || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(image.mimeType)
      || typeof image.data !== 'string' || !image.data.length || image.data.length > Math.ceil(4 * 1024 * 1024 / 3) * 4
      || image.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(image.data)) throw new Error('Invalid image attachment');
    const bytes = image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0);
    if (bytes > 4 * 1024 * 1024 || (total += bytes) > 8 * 1024 * 1024) throw new Error('Image attachments exceed the size limit');
    return { type: 'blob', data: image.data, mimeType: image.mimeType };
  });
}
async function dispatch(message) {
  if (!message || typeof message !== 'object' || typeof message.id !== 'string') throw new Error('Invalid bridge request');
  if (message.method === 'decision') {
    const pending = decisions.get(message.decisionId);
    if (!pending) throw new Error('This Copilot decision is no longer pending.');
    if (pending.kind === 'permission') {
      if (!validPermissionDecision(pending.request, message.value))
        throw new Error('Invalid permission decision; expected an explicit choice scoped to this request');
    } else if (pending.kind === 'input') {
      if (typeof message.value?.answer !== 'string' || typeof message.value?.wasFreeform !== 'boolean') throw new Error('Invalid input answer');
    } else if (typeof message.value?.approved !== 'boolean'
      || message.value.selectedAction !== undefined && typeof message.value.selectedAction !== 'string'
      || message.value.feedback !== undefined && typeof message.value.feedback !== 'string'
      || message.value.approved && (!Array.isArray(pending.request.actions)
        || !pending.request.actions.includes(message.value.selectedAction))
      || !message.value.approved && message.value.selectedAction !== undefined)
      throw new Error('Invalid plan-mode decision; choose an action advertised by this request.');
    decisions.delete(message.decisionId);
    pending.resolve(message.value);
    return;
  }
  if (closing) throw new Error('Copilot connection is closing');
  if (message.method === 'initialize') {
    if (initialized) throw new Error('Copilot bridge is already initialized');
    await client.start();
    const status = await client.getStatus();
    initialized = true;
    return status;
  }
  if (!initialized) throw new Error('Copilot bridge is not initialized');
  switch (message.method) {
    case 'list': return (await client.listSessions({ workingDirectory: cwd })).filter(item => !item.isRemote && item.context?.workingDirectory === cwd);
    case 'delete':
      if (session) throw new Error('Deletion requires a history-only connection');
      await membership(message.sessionId);
      await client.deleteSession(message.sessionId);
      return;
    case 'connect': {
      if (session || connecting) throw new Error('This bridge already owns or is connecting a conversation');
      connecting = true;
      try {
        if (message.sessionId !== undefined) await membership(message.sessionId);
        replaying = true;
        const defaults = message.sessionId === undefined ? await configuration.defaults() : undefined;
        if (closing) throw new Error('Copilot connection closed while reading configuration. Nothing was created.');
        session = message.sessionId === undefined
          ? await client.createSession({ ...config(), ...defaults, name: 'Copilot session' })
          : await client.resumeSession(message.sessionId, { ...config(), allowTranscriptRecovery: false, continuePendingWork: false });
        if (message.sessionId !== undefined && session.sessionId !== message.sessionId) throw new Error('Copilot resumed a different session');
        send({ kind: 'identified', sessionId: session.sessionId });
        const mode = await session.rpc.mode.get();
        const events = await session.getEvents();
        // Use honored creation inputs only while the initial SDK snapshot omits
        // them. Later root events/configuration results remain authoritative.
        const model = await configuration.snapshot(session, defaults);
        const models = await client.listModels();
        // History and streamed events share IDs. Publish replay first, synchronously
        // in this channel, before any events received while getEvents was in flight.
        send({ kind: 'connected', sessionId: session.sessionId, events, model, mode, models });
        const seen = new Set(events.map(item => item.id));
        for (const item of buffered) if (!seen.has(item.id)) eventAfterReplay(item);
        buffered = []; replaying = false;
        void refreshPermissionMode(session);
        // Command discovery is optional: failure must not disable ordinary chat.
        try { await refreshCommands(); }
        catch (error) { send({ kind: 'command-error', error: `Command discovery failed: ${failure(error)}` }); }
        return;
      } finally { connecting = false; }
    }
    case 'usage': {
      if (!session) throw new Error('No connected Copilot session');
      // Keep the SDK read single-flight even if an optional frontend read times
      // out first. A later read shares this request instead of piling up RPCs.
      if (!usageRead) usageRead = (async () => {
        const metrics = await session.rpc.usage.getMetrics();
        if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) throw new Error('Invalid Copilot usage snapshot');
        // These totals include main/subagents. Premium-request cost is not USD.
        return { totalNanoAiu: metrics.totalNanoAiu, aiCreditsStatus: metrics.aiCreditsStatus };
      })().finally(() => { usageRead = undefined; });
      return await usageRead;
    }
    case 'context': {
      if (!session) throw new Error('No connected Copilot session');
      // Zero limits ask the runtime to resolve its selected model/context tier.
      // `limit` is the display window; promptTokenLimit is a different effective
      // input budget and must not silently become the denominator.
      const { contextInfo } = await session.rpc.metadata.contextInfo({ promptTokenLimit: 0, outputTokenLimit: 0 });
      if (contextInfo === null || contextInfo === undefined) return null;
      if (typeof contextInfo !== 'object' || Array.isArray(contextInfo)) throw new Error('Invalid Copilot context snapshot');
      return { currentTokens: contextInfo.totalTokens, tokenLimit: contextInfo.limit };
    }
    case 'commands':
      if (!session) throw new Error('No connected Copilot session');
      return await refreshCommands();
    case 'command-skills': {
      if (!session) throw new Error('No connected Copilot session');
      const result = await session.rpc.skills.list();
      if (!result || !Array.isArray(result.skills)) throw new Error('Copilot returned an invalid skill catalog');
      return { skills: result.skills.map(skill => {
        if (!skill || typeof skill.name !== 'string' || !skill.name
          || typeof skill.description !== 'string' || typeof skill.enabled !== 'boolean')
          throw new Error('Copilot returned an invalid skill catalog');
        return { name: skill.name, description: skill.description, enabled: skill.enabled };
      }) };
    }
    case 'permission-change': {
      if (!session) throw new Error('No connected Copilot session');
      if (commandExecuting) throw new Error('A Copilot command is already executing. Nothing was invoked.');
      commandExecuting = true;
      permissionRevision++; // Fence an older optional read before this mutation.
      try { return await applyPermissionChange(session, message.value, () => working, commands => send({ kind: 'commands', commands })); }
      finally { commandExecuting = false; }
    }
    case 'command': {
      if (!session) throw new Error('No connected Copilot session');
      if (commandExecuting) throw new Error('A Copilot command is already executing');
      if (typeof message.name !== 'string' || !message.name || /[\s/\u0000-\u001f]/.test(message.name) || message.input !== undefined && typeof message.input !== 'string') throw new Error('Invalid Copilot command');
      commandExecuting = true;
      try {
        const { commands } = await session.rpc.commands.list();
        const command = commands.find(item => item.name.toLowerCase() === message.name.toLowerCase())
          ?? commands.find(item => item.aliases?.some(alias => alias.toLowerCase() === message.name.toLowerCase()));
        if (!command) throw new Error('This command is not advertised by Copilot. Nothing was invoked.');
        if (working && command.allowDuringAgentExecution !== true) throw new Error('Copilot started working before command dispatch. Nothing was invoked.');
        const permissions = command.kind === 'builtin' && command.name.toLowerCase() === 'permissions';
        if (permissions) permissionRevision++;
        const invoked = await session.rpc.commands.invoke({ name: command.name, ...(message.input !== undefined ? { input: message.input } : {}) });
        const result = await completeCommandEffect(session, invoked, {
          command, input: message.input, models: () => client.listModels(),
        });
        if (permissions) void refreshPermissionMode(session);
        // Refresh metadata without re-invoking the command or changing its result.
        try { await refreshCommands(); }
        catch (error) { send({ kind: 'command-error', error: `Command discovery failed: ${failure(error)}` }); }
        return result;
      } finally { commandExecuting = false; }
    }
    case 'prompt': {
      if (!session) throw new Error('No connected Copilot session');
      if (typeof message.text !== 'string' || message.text.length > 1_000_000 || message.text.trimStart().startsWith('/')) throw new Error('Invalid prompt; slash commands must use the command invocation API');
      const attachments = promptImages(message.images);
      if (!message.text.trim() && !attachments.length) throw new Error('A message or image is required');
      working = true;
      return await session.send({ prompt: message.text, ...(attachments.length ? { attachments } : {}), mode: 'immediate' });
    }
    case 'cancel':
      if (!session) throw new Error('No connected Copilot session');
      cancelDecisions();
      return await session.abort();
    case 'configure':
      if (!session) throw new Error('No connected Copilot session');
      if (!['model', 'effort', 'mode', 'context-tier'].includes(message.setting) || typeof message.value !== 'string')
        throw new Error('Invalid Copilot configuration request');
      return await configuration.apply(session, message.setting, message.value);
    default: throw new Error('Unsupported Copilot bridge operation');
  }
}
function eventAfterReplay(value) { observeWork(value); send({ kind: 'event', event: value }); }
function cancelDecisions() {
  for (const pending of decisions.values()) {
    if (pending.kind === 'permission') pending.resolve({ kind: 'user-not-available' });
    else pending.reject(new Error('Copilot input was interrupted'));
  }
  decisions.clear();
}
// This release exposes no public transport-closed event. Its public ping checks
// only the existing connection (never start/reconnect), without provider work.
const heartbeat = setInterval(async () => {
  if (!initialized || closing || checkingHealth) return;
  checkingHealth = true;
  let timer;
  try {
    await Promise.race([
      client.ping('nimrod-owned-connection'),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Copilot runtime stopped responding')), 20_000); timer.unref(); }),
    ]);
  } catch (error) {
    if (!closing) { send({ kind: 'fatal', error: `Copilot runtime connection failed: ${failure(error)}` }); void shutdown(); }
  } finally { clearTimeout(timer); checkingHealth = false; }
}, 5000);
heartbeat.unref();
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(heartbeat);
  cancelDecisions();
  try {
    if (session) await session.disconnect();
    const errors = await client.stop();
    if (errors.length) throw new AggregateError(errors, 'Copilot shutdown failed');
    send({ kind: 'stopped' });
    process.exitCode = 0;
  } catch (error) {
    process.stderr.write(`Copilot shutdown failed: ${failure(error)}\n`);
    process.exitCode = 1;
  }
  input.close();
  process.stdin.destroy();
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => {
  let message;
  try { message = JSON.parse(line); }
  catch (error) { send({ kind: 'fatal', error: failure(error) }); void shutdown(); return; }
  // Do not serialize prompt completion ahead of cancel or permission replies.
  void dispatch(message).then(
    result => send({ kind: 'result', id: message.id, result: result ?? null }),
    error => send({ kind: 'result', id: message.id, error: failure(error) }),
  );
});
input.on('close', () => { void shutdown(); });
process.on('SIGTERM', () => { void shutdown(); });
process.on('SIGINT', () => { void shutdown(); });
