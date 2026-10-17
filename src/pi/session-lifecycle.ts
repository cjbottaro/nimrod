import type { PiSession } from './session';
import { ownedSessionStop, sessionConnectionState, type SessionLifecycle, type SessionLifecycleHost, type SessionLifecycleOwner } from '../session-lifecycle';

export function piSessionLifecycle(readOwner: () => SessionLifecycleOwner, backend: { session?: PiSession }, host: SessionLifecycleHost): SessionLifecycle {
  return {
    label: 'Pi',
    get identity() {
      const owner = readOwner();
      return owner.mode !== 'temporary' && owner.file?.exists
        ? { path: owner.file.path, sessionId: owner.file.sessionId } : undefined;
    },
    get key() { const owner = readOwner(); return owner.mode !== 'temporary' && owner.file?.exists ? owner.file.path : undefined; },
    get draftScope() { return this.key === undefined ? undefined : `file:${this.key}`; },
    get connection() { return sessionConnectionState(readOwner(), backend.session); },
    connectOnStartup: true,
    eligibility() {
      if (!this.identity) return 'unavailable';
      const gate = host.gate();
      if (gate === 'unavailable') return 'unavailable';
      const owner = readOwner();
      if (owner.starting || backend.session && !owner.ended) return 'connected';
      return gate === 'blocked' ? 'blocked' : 'connectable';
    },
    connect: (options = {}) => host.connect(options),
    stop: ownedSessionStop(readOwner, host.stop),
    disconnect: reason => backend.session?.rpc.disconnect(reason),
  };
}
