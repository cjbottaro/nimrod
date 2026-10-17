import type { AcpSession } from './session';
import { copilotSessionScope, type AcpProfile } from './profiles';
import { ownedSessionStop, sessionConnectionState, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner } from '../session-lifecycle';

export function acpSessionLifecycle(readOwner: () => SessionLifecycleOwner, backend: { profile: AcpProfile; session?: AcpSession; savedSessionId?: string }, host: SessionLifecycleHost): SessionLifecycle {
  return {
    label: backend.profile.name,
    get identity() {
      return backend.savedSessionId === undefined ? undefined
        : { kind: 'acp' as const, profile: 'copilot' as const, sessionId: backend.savedSessionId };
    },
    get key() { return backend.savedSessionId === undefined ? undefined : copilotSessionScope(backend.savedSessionId); },
    get draftScope() { return this.key; },
    get connection() { return sessionConnectionState(readOwner(), !!backend.session && !backend.session.state.sessionUnavailable); },
    connectOnStartup: false,
    eligibility() {
      if (!this.identity) return 'unavailable';
      const gate = host.gate();
      if (gate !== 'ready') return gate;
      const owner = readOwner();
      return owner.starting || backend.session && !owner.ended ? 'connected' : 'connectable';
    },
    connect: (options = {}) => host.connect(options),
    stop: ownedSessionStop(readOwner, host.stop),
    disconnect: reason => backend.session?.disconnect(reason),
  };
}
