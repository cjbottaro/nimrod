import { createInterface } from 'node:readline';
import { isAbsolute } from 'node:path';

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
let session, closing = false, initialized = false;
let checkingHealth = false;
let replaying = false, buffered = [];
let commandRefresh;
let commandExecuting = false;
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
    decisions.set(id, { resolve, reject, kind });
    send({ kind, id, request });
  });
}
const config = () => ({
  workingDirectory: cwd, streaming: true, clientName: 'Nimrod',
  onEvent: event,
  onPermissionRequest: request => decision('permission', request),
  onUserInputRequest: request => decision('input', request),
});
function event(value) {
  if (!value.agentId && ['session.idle', 'session.error'].includes(value.type)) cancelDecisions();
  if (replaying) buffered.push(value);
  else {
    send({ kind: 'event', event: value });
    if (!value.agentId && value.type === 'commands.changed') void refreshCommands().catch(error => send({ kind: 'command-error', error: `Command discovery failed: ${failure(error)}` }));
  }
}
async function membership(id) {
  const sessions = await client.listSessions({ workingDirectory: cwd });
  if (!sessions.some(item => item.sessionId === id && !item.isRemote && item.context?.workingDirectory === cwd))
    throw new Error('This exact saved session is not listed in this project. Nothing was loaded or deleted.');
}
async function dispatch(message) {
  if (!message || typeof message !== 'object' || typeof message.id !== 'string') throw new Error('Invalid bridge request');
  if (message.method === 'decision') {
    const pending = decisions.get(message.decisionId);
    if (!pending) throw new Error('This Copilot decision is no longer pending.');
    if (pending.kind === 'permission') {
      if (!['approved', 'denied-interactively-by-user'].includes(message.value?.kind)) throw new Error('Invalid permission choice');
    } else if (typeof message.value?.answer !== 'string' || typeof message.value?.wasFreeform !== 'boolean') throw new Error('Invalid input answer');
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
      if (session) throw new Error('This bridge already owns a conversation');
      if (message.sessionId !== undefined) await membership(message.sessionId);
      replaying = true;
      session = message.sessionId === undefined
        ? await client.createSession({ ...config(), name: 'Copilot session' })
        : await client.resumeSession(message.sessionId, { ...config(), allowTranscriptRecovery: false, continuePendingWork: false });
      if (message.sessionId !== undefined && session.sessionId !== message.sessionId) throw new Error('Copilot resumed a different session');
      send({ kind: 'identified', sessionId: session.sessionId });
      const mode = await session.rpc.mode.get();
      if (mode !== 'interactive') throw new Error(`Copilot session mode "${mode}" is not supported by this integration. Change it to interactive in Copilot before reconnecting; no mode was changed or prompt sent.`);
      const events = await session.getEvents();
      const model = await session.rpc.model.getCurrent();
      const models = await client.listModels();
      // History and streamed events share IDs. Publish replay first, synchronously
      // in this channel, before any events received while getEvents was in flight.
      send({ kind: 'connected', sessionId: session.sessionId, events, model, models });
      const seen = new Set(events.map(item => item.id));
      for (const item of buffered) if (!seen.has(item.id)) eventAfterReplay(item);
      buffered = []; replaying = false;
      // Command discovery is optional: failure must not disable ordinary chat.
      try { await refreshCommands(); }
      catch (error) { send({ kind: 'command-error', error: `Command discovery failed: ${failure(error)}` }); }
      return;
    }
    case 'commands':
      if (!session) throw new Error('No connected Copilot session');
      return await refreshCommands();
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
        const result = await session.rpc.commands.invoke({ name: command.name, ...(message.input !== undefined ? { input: message.input } : {}) });
        const mode = await session.rpc.mode.get();
        if (mode !== 'interactive') {
          send({ kind: 'fatal', error: `Copilot command changed to unsupported mode "${mode}". No follow-on prompt was sent.` });
          throw new Error('Copilot is no longer in interactive mode');
        }
        // Refresh metadata without re-invoking the command or changing its result.
        try { await refreshCommands(); }
        catch (error) { send({ kind: 'command-error', error: `Command discovery failed: ${failure(error)}` }); }
        return result;
      } finally { commandExecuting = false; }
    }
    case 'prompt':
      if (!session) throw new Error('No connected Copilot session');
      if (typeof message.text !== 'string' || message.text.trimStart().startsWith('/')) throw new Error('Slash commands must use the command invocation API');
      return await session.send({ prompt: message.text, mode: 'immediate' });
    case 'cancel':
      if (!session) throw new Error('No connected Copilot session');
      cancelDecisions();
      return await session.abort();
    case 'configure':
      if (!session) throw new Error('No connected Copilot session');
      await session.setModel(message.model, message.effort === undefined ? undefined : { reasoningEffort: message.effort });
      return await session.rpc.model.getCurrent();
    default: throw new Error('Unsupported Copilot bridge operation');
  }
}
function eventAfterReplay(value) { send({ kind: 'event', event: value }); }
function cancelDecisions() {
  for (const pending of decisions.values()) {
    if (pending.kind === 'permission') pending.resolve({ kind: 'denied-interactively-by-user' });
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
