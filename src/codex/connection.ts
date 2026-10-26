import { CodexSession, type CodexSessionState, type CodexSessionUi } from './session';
import { codexScope, codexSessionLifecycle } from './session-lifecycle';
import { codexConnectionFailure } from './connection-failure';
import type { CodexTransport } from './native';
import { ownedProcessStop, type ConnectSessionOptions, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner } from '../session-lifecycle';

export interface CodexBackend { session?: CodexSession; savedSessionId?: string; continuity?: import('../session-lifecycle').CodexContinuity; }
export interface CodexConnectionHost {
  readonly project: string;
  readonly transport: CodexTransport;
  /** Shell/window availability only; attempt and protocol guards belong to this owner. */
  available(options: ConnectSessionOptions): boolean;
  current(): boolean;
  tearingDown(): boolean;
  gate: SessionLifecycleHost['gate'];
  conflicts(identity: string): boolean;
  drafts: { read(): unknown; bindScope(scope: string): void; replaceScope(previous: string, scope: string): void; };
  ui: Omit<CodexSessionUi, 'identified' | 'disconnected' | 'changed' | 'workObserved'> & { changed(state: CodexSessionState): void; };
  effects: {
    changed(): void;
    identified(): void;
    checkpoint(): Promise<void>;
    retire(): void;
    resolved(issue: 'connection' | 'cleanup'): void;
    hasConnectionOutcome(): boolean;
    failure(failure: { kind: 'connection' | 'cleanup'; message: string; details?: string; resumable: boolean }): void;
  };
}

/** Concrete app-server connection ownership. The shell binds Nimrod effects, not
 * startup sequencing, identity validation, packet routing or cleanup decisions.
 */
export function createCodexConnection(readOwner: () => SessionLifecycleOwner, backend: CodexBackend, host: CodexConnectionHost): SessionLifecycle {
  const stopToken = ownedProcessStop(token => host.transport.stop(token));
  const lifecycle = codexSessionLifecycle(readOwner, backend, { connect, stop: stopToken, gate: host.gate });
  return lifecycle;

  async function connect(options: ConnectSessionOptions): Promise<void> {
    const owner = readOwner();
    if (!host.current() || !host.available(options) || owner.starting || backend.session && !owner.ended) return;
    const previousId = backend.savedSessionId;
    // Never infer untouched from empty history, a missing catalog row or a resume error.
    const replaceUntouched = backend.continuity?.untouched === true && backend.continuity.saved === false;
    const savedId = replaceUntouched ? undefined : previousId;
    if (savedId && host.conflicts(savedId)) {
      host.effects.failure({ kind: 'connection', message: 'This Codex thread is already open in this window.', resumable: false });
      return;
    }
    owner.starting = true; host.effects.changed();
    try { await lifecycle.stop(); host.effects.resolved('cleanup'); }
    catch (error) {
      owner.starting = false;
      if (host.current()) {
        host.effects.failure({ kind: 'connection', message: `Could not stop the previous Codex process: ${String(error)}`, resumable: !!savedId });
        host.effects.changed();
      }
      return;
    }
    if (!host.current() || !host.available(options)) { owner.starting = false; if (host.current()) host.effects.changed(); return; }
    host.effects.retire(); lifecycle.disconnect('Reconnecting Codex');
    const token = crypto.randomUUID(); owner.token = token; owner.ended = false;
    const valid = () => host.current() && owner.token === token;
    let disconnectReason: string | undefined, initialized = false;
    const reportConnection = (cleanup?: unknown): void => {
      if (cleanup !== undefined) session.recordCleanupFailure(cleanup);
      if (!valid() || !disconnectReason) return;
      const failure = codexConnectionFailure(disconnectReason, !initialized, cleanup);
      if (host.effects.hasConnectionOutcome()) {
        if (cleanup !== undefined) host.effects.failure({ kind: 'cleanup',
          message: 'Could not finish Codex cleanup; owned process exit is unconfirmed.', details: failure.details, resumable: false });
        return;
      }
      host.effects.failure({ kind: 'connection', ...failure, resumable: !!lifecycle.identity });
    };
    const markWork = (): void => {
      if (!valid() || !backend.continuity?.untouched) return;
      backend.continuity = { ...backend.continuity, untouched: false }; host.effects.identified();
    };
    let checkpointed = false;
    const session = new CodexSession({ write: async packet => {
      if (['turn/start', 'turn/steer', 'thread/compact/start', 'thread/name/set', 'thread/resume'].includes(String(packet.method)) && backend.continuity?.saved === false) {
        markWork();
        // Persist uncertainty BEFORE delivery. Failure blocks wire work, never local Send feedback.
        if (!checkpointed) { await host.effects.checkpoint(); checkpointed = true; }
        if (!valid() || owner.ended || host.tearingDown()) throw new Error('Codex dispatch was retired before delivery');
      }
      return host.transport.write(token, packet);
    } }, {
      transcriptLog: host.ui.transcriptLog,
      publish: message => { if (valid()) host.ui.publish(message); },
      identified: (id, empty) => {
        if (!valid() || savedId !== undefined && savedId !== id || host.conflicts(id)) throw new Error('Codex returned a conflicting or retired identity');
        // Bind synchronously before publishing identity or applying later packets.
        if (replaceUntouched && previousId !== undefined && previousId !== id) host.drafts.replaceScope(codexScope(previousId), codexScope(id));
        else host.drafts.bindScope(codexScope(id));
        backend.savedSessionId = id;
        if (savedId === undefined) backend.continuity = { version: 1, untouched: empty === true, saved: false };
        else if (backend.continuity) backend.continuity = { version: 1, untouched: false, saved: true };
        host.effects.identified();
      },
      workObserved: markWork,
      changed: () => { if (valid()) host.ui.changed(session.state); },
      approval: (request, signal) => valid() ? host.ui.approval(request, signal) : Promise.resolve('cancel'),
      question: host.ui.question ? (request, signal) => valid() ? host.ui.question!(request, signal) : Promise.resolve(undefined) : undefined,
      asyncQuestion: host.ui.asyncQuestion ? (request, signal) => valid() ? host.ui.asyncQuestion!(request, signal) : Promise.resolve(undefined) : undefined,
      interactionFailure: host.ui.interactionFailure ? failure => { if (valid()) host.ui.interactionFailure!(failure); } : undefined,
      notice: message => { if (valid()) host.ui.notice(message); },
      disconnected: message => {
        if (!valid()) return;
        disconnectReason ??= message;
        owner.ended = true; host.effects.retire(); host.ui.publish({ type: 'sessionDisconnected' });
        reportConnection();
        // Startup has one catch/cleanup owner; established disconnects share the
        // same token-bound stop as Close/deletion, never a replacement's token.
        if (initialized && !host.tearingDown()) void stopToken(token).catch(error => reportConnection(error));
        host.effects.changed();
      },
      completed: (failed, response) => { if (valid()) host.ui.completed(failed, response); },
    });
    backend.session = session;
    host.ui.publish({ type: 'sessionReset', composerState: host.drafts.read() });
    host.ui.publish({ type: 'snapshot', state: session.state });
    try {
      const confirmed = await host.transport.start(token, packet => { if (valid()) session.receive(packet); }, message => { if (valid()) session.disconnect(message); });
      if (!valid() || confirmed !== host.project) throw new Error('Native Codex host did not confirm the project');
      await session.initialize(host.project, savedId);
      if (!valid()) throw new Error('Codex startup attempt was retired');
      initialized = true; host.effects.resolved('connection');
    } catch (error) {
      disconnectReason ??= error instanceof Error ? error.message : String(error);
      session.disconnect(error);
      try { await stopToken(token); } catch (stopError) { reportConnection(stopError); }
    } finally {
      // Old completions cannot clear a replacement's connecting state.
      if (owner.token === token) { owner.starting = false; if (valid()) host.effects.changed(); }
    }
  }
}
