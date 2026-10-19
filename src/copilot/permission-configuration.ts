import { advertisedPermissionCommand, permissionArgument } from '../../copilot/permission-configuration.mjs';
import { SessionConfigurationController, type ConfigurationAvailability } from '../session-configuration';
import type { CopilotCommand } from './commands';
export { permissionArgument };

/** Only the concrete, advertised Copilot mutation is exposed; no allow-all emulation. */
export function permissionCommand(commands: readonly CopilotCommand[]): CopilotCommand | undefined {
  return advertisedPermissionCommand(commands);
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
    get: () => host.mode(),
    choices: async () => {
      const command = permissionCommand(host.commands());
      if (!command) throw new Error('Copilot no longer advertises /permissions allow-all.');
      return [{ value: permissionArgument, label: 'Allow all', detail: command.input?.choices?.find(choice => choice.name === permissionArgument)?.description || '/permissions allow-all' }];
    },
    apply: (_setting, value, current, dispatched) => host.apply(value, current, dispatched),
  }, host.changed);
}
