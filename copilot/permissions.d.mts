export type PermissionDecision =
  | { kind: 'approve-once'; approvedInteractively: true }
  | { kind: 'approve-for-session'; approval: { kind: 'read' | 'write' } | { kind: 'commands'; commandIdentifiers: string[] } | { kind: 'mcp'; serverName: string; toolName: string } }
  | { kind: 'approve-for-session'; domain: string }
  | { kind: 'approve-permanently'; domain: string }
  | { kind: 'reject'; feedback?: string }
  | { kind: 'user-not-available' };
export interface PermissionOption { id: string; label: string; detail?: string; decision: PermissionDecision }
export function permissionOptions(request: Readonly<Record<string, unknown>>): PermissionOption[];
export function validPermissionDecision(request: Readonly<Record<string, unknown>>, value: unknown): value is PermissionDecision;
