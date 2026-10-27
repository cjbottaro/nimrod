import type { CodexSession } from './session';
import { ownedSessionStop, sessionConnectionState, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner } from '../session-lifecycle';
import { savedDraftScope } from '../draft-scope';
export const codexScope = (sessionId: string) => savedDraftScope('codex', sessionId);
export function codexSessionLifecycle(owner: () => SessionLifecycleOwner, backend: { session?: CodexSession; savedSessionId?: string }, host: SessionLifecycleHost): SessionLifecycle {
  return {
    label: 'Codex',
    get identity() { return backend.savedSessionId === undefined ? undefined : { kind: 'codex' as const, sessionId: backend.savedSessionId }; },
    get key() { return backend.savedSessionId === undefined ? undefined : codexScope(backend.savedSessionId); },
    get draftScope() { return this.key; },
    get connection() { return sessionConnectionState(owner(), !!backend.session && !backend.session.state.sessionUnavailable); },
    eligibility() {
      if (!this.identity) return 'unavailable';
      const gate = host.gate(); if (gate !== 'ready') return gate;
      return owner().starting || backend.session && !owner().ended ? 'connected' : 'connectable';
    },
    connect: (options = {}) => host.connect(options),
    stop: ownedSessionStop(owner, host.stop),
    disconnect: reason => backend.session?.disconnect(reason),
  };
}
