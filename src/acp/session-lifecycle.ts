import type { AcpSession } from './session';
import type { AcpProfile } from './profiles';
import { ownedSessionStop, sessionConnectionState, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner } from '../session-lifecycle';

/** Custom ACP sessions are runtime-only; the agent's ID is not a saved Nimrod identity. */
export function acpSessionLifecycle(readOwner: () => SessionLifecycleOwner, backend: { profile: AcpProfile; session?: AcpSession }, host: SessionLifecycleHost): SessionLifecycle {
  return {
    label: backend.profile.name,
    identity: undefined,
    key: undefined,
    draftScope: undefined,
    get connection() { return sessionConnectionState(readOwner(), !!backend.session && !backend.session.state.sessionUnavailable); },
    eligibility() { return 'unavailable'; },
    connect: (options = {}) => host.connect(options),
    stop: ownedSessionStop(readOwner, host.stop),
    disconnect: reason => backend.session?.disconnect(reason),
  };
}
