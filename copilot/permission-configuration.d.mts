export interface PermissionCommand {
  name: string;
  kind: string;
  allowDuringAgentExecution?: boolean;
  input?: { choices?: { name: string }[] };
}
export const permissionArgument: 'allow-all';
export function advertisedPermissionCommand<T extends PermissionCommand>(commands: readonly T[]): T | undefined;
export interface PermissionConfigurationSession {
  rpc: {
    permissions: { getMode(): Promise<{ mode: string }> };
    commands: {
      list(): Promise<{ commands: PermissionCommand[] }>;
      invoke(params: { name: string; input: string }): Promise<unknown>;
    };
  };
}
export type PermissionChangeResult =
  | { outcome: 'deferred' }
  | { outcome: 'applied'; mode: 'allow-all' }
  | { outcome: 'unknown'; mode?: string; details: string };
export function permissionMode(session: PermissionConfigurationSession): Promise<string>;
export function applyPermissionChange(session: PermissionConfigurationSession, value: string, working: () => boolean,
  publishCommands?: (commands: PermissionCommand[]) => void): Promise<PermissionChangeResult>;
