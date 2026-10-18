import { SessionConfigurationController, type ConfigurationAvailability } from '../session-configuration';
import { findCopilotCommand, parseCopilotCommand, type CopilotCommand } from './commands';

/** Only the concrete, advertised Copilot mutation is exposed; no allow-all emulation. */
export function permissionCommand(commands: readonly CopilotCommand[]): CopilotCommand | undefined {
  return commands.find(command => command.kind === 'builtin' && command.name.toLowerCase() === 'permissions'
    && command.input?.choices?.some(choice => choice.name === 'allow-any'));
}
export function isPermissionChange(commands: readonly CopilotCommand[], text: string): boolean {
  const invocation = parseCopilotCommand(text);
  const command = invocation && findCopilotCommand(commands, invocation.name);
  return command?.kind === 'builtin' && command.name.toLowerCase() === 'permissions' && invocation?.input?.trim() === 'allow-any';
}
export function createCopilotPermissionConfiguration(host: {
  commands(): readonly CopilotCommand[];
  mode(): string | undefined;
  availability(command: CopilotCommand): ConfigurationAvailability;
  apply(value: string, current: () => boolean, dispatched: () => void): Promise<void>;
  changed(): void;
}): SessionConfigurationController {
  return new SessionConfigurationController({
    operationTitle: 'Permission change',
    capabilities: () => {
      const command = permissionCommand(host.commands());
      return command ? [{ id: 'permissions', label: 'Permissions', availability: host.availability(command) }] : [];
    },
    // Native mode is confirmation, not a claim that other permission flags are equivalent.
    get: () => host.mode() === 'allow-all' ? 'allow-any' : host.mode(),
    choices: async () => {
      const command = permissionCommand(host.commands());
      if (!command) throw new Error('Copilot no longer advertises /permissions allow-any.');
      return [{ value: 'allow-any', label: 'Allow all', detail: command.input?.choices?.find(choice => choice.name === 'allow-any')?.description || '/permissions allow-any' }];
    },
    apply: (_setting, value, current, dispatched) => host.apply(value, current, dispatched),
  }, host.changed);
}
