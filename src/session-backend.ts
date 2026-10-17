import type { AcpSession } from './acp/session';
import type { AcpProfile } from './acp/profiles';
import type { PiSession } from './pi/session';
import { acpSessionActions } from './acp/view-policy';
import { piSessionActions } from './pi/view-policy';

/** Concrete alternatives, not a universal controller. One backend owns a live session. */
export type SessionBackend =
  | { readonly kind: 'pi'; session?: PiSession }
  | { readonly kind: 'acp'; readonly profile: AcpProfile; session?: AcpSession };
export interface SessionAction {
  id: 'mcp' | 'model' | 'thinking' | 'acp-options';
  label: string;
  detail: string;
  keywords?: string;
}
interface Owner { readonly backend: SessionBackend; }
export function piSession(owner: Owner): PiSession | undefined { return owner.backend.kind === 'pi' ? owner.backend.session : undefined; }
export function acpSession(owner: Owner): AcpSession | undefined { return owner.backend.kind === 'acp' ? owner.backend.session : undefined; }
export function acpProfile(owner: Owner): AcpProfile | undefined { return owner.backend.kind === 'acp' ? owner.backend.profile : undefined; }
export function sessionActions(owner: Owner): readonly SessionAction[] {
  return owner.backend.kind === 'pi' ? piSessionActions : acpSessionActions(owner.backend.session);
}
export function disconnectBackend(owner: Owner, reason: string): void {
  if (owner.backend.kind === 'pi') owner.backend.session?.rpc.disconnect(reason);
  else owner.backend.session?.disconnect(reason);
}
