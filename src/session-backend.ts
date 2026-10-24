import type { CodexSession } from './codex/session';
import { codexSessionActions } from './codex/view-policy';
import type { AcpSession } from './acp/session';
import type { AcpProfile } from './acp/profiles';
import type { PiSession } from './pi/session';
import type { CopilotSession } from './copilot/session';
import { copilotSessionActions } from './copilot/view-policy';
import { acpSessionActions } from './acp/view-policy';
import { piSessionActions } from './pi/view-policy';
import type { ActionId } from './keybindings';

/** Concrete alternatives, not a universal controller. One backend owns a live session. */
export type SessionBackend =
  | { readonly kind: 'codex'; session?: CodexSession; savedSessionId?: string }
  | { readonly kind: 'pi'; session?: PiSession }
  | { readonly kind: 'copilot-sdk'; session?: CopilotSession; savedSessionId?: string }
  | { readonly kind: 'acp'; readonly profile: AcpProfile; session?: AcpSession };
export interface SessionAction {
  id: Extract<ActionId, 'mcp' | 'model' | 'thinking' | 'mode' | 'context-window' | 'permissions' | 'cancel-configuration'> | 'acp-options';
  label: string;
  detail: string;
  keywords?: string;
  /** Session-bound harness operation, revalidated by sessionActions before dispatch. */
  run?: () => Promise<void>;
  /** Opaque setting routed through the shared configuration picker. */
  configurationSetting?: string;
}
interface Owner { readonly backend: SessionBackend; }
export function codexSession(owner: Owner): CodexSession | undefined { return owner.backend.kind === 'codex' ? owner.backend.session : undefined; }
export function piSession(owner: Owner): PiSession | undefined { return owner.backend.kind === 'pi' ? owner.backend.session : undefined; }
export function acpSession(owner: Owner): AcpSession | undefined { return owner.backend.kind === 'acp' ? owner.backend.session : undefined; }
export function acpProfile(owner: Owner): AcpProfile | undefined { return owner.backend.kind === 'acp' ? owner.backend.profile : undefined; }
export function copilotSession(owner: Owner): CopilotSession | undefined { return owner.backend.kind === 'copilot-sdk' ? owner.backend.session : undefined; }
export function sessionConfiguration(owner: Owner): import('./session-configuration').SessionConfiguration | undefined { return owner.backend.session?.configuration; }
export function sessionActions(owner: Owner): readonly SessionAction[] {
  const actions = owner.backend.kind === 'codex' ? codexSessionActions(owner.backend.session) : owner.backend.kind === 'pi' ? piSessionActions : owner.backend.kind === 'copilot-sdk' ? copilotSessionActions(owner.backend.session) : acpSessionActions(owner.backend.session);
  const configuration = sessionConfiguration(owner);
  return configuration?.cancel && configuration.operations.some(operation => operation.cancellable)
    ? [...actions, { id: 'cancel-configuration', label: 'Cancel pending configuration change', detail: 'Withdraw configuration that has not been dispatched' }] : actions;
}
