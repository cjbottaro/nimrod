import type { CopilotSession } from './session';
import { ownedSessionStop, sessionConnectionState, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner } from '../session-lifecycle';
export const copilotSdkScope = (sessionId: string) => `copilot-sdk:${JSON.stringify(sessionId)}`;
export function copilotSessionLifecycle(owner: () => SessionLifecycleOwner, backend: { session?: CopilotSession; savedSessionId?: string }, host: SessionLifecycleHost): SessionLifecycle {
  return {
    label: 'Copilot',
    get identity() { return backend.savedSessionId === undefined ? undefined : { kind: 'copilot-sdk' as const, sessionId: backend.savedSessionId }; },
    get key() { return backend.savedSessionId === undefined ? undefined : copilotSdkScope(backend.savedSessionId); },
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
