import { SessionConfigurationController, type ConfigurationAvailability } from '../session-configuration';

export function createCopilotConfiguration(host: {
  models(): readonly { id: string; label: string; efforts?: readonly string[] }[];
  model(): string | undefined;
  effort(): string | undefined;
  availability(): ConfigurationAvailability;
  apply(setting: string, value: string, current: () => boolean): Promise<void>;
  changed(): void;
  error(message: string): void;
}): SessionConfigurationController {
  return new SessionConfigurationController({
    capabilities: desired => {
      const models = host.models(), model = models.find(item => item.id === (desired.model ?? host.model()));
      return [
        ...(models.length ? [{ id: 'model', label: 'Model', availability: host.availability() }] : []),
        ...(model?.efforts?.length ? [{ id: 'effort', label: 'Thinking level', availability: host.availability(), dependsOn: ['model'] }] : []),
      ];
    },
    get: setting => setting === 'model' ? host.model() : setting === 'effort' ? host.effort() : undefined,
    choices: async (setting, desired) => {
      const models = host.models();
      if (setting === 'model') return models.map(model => ({ value: model.id, label: `${model.label} (${model.id})` }));
      if (setting === 'effort') return (models.find(model => model.id === (desired.model ?? host.model()))?.efforts || []).map(value => ({ value, label: value }));
      throw new Error('This Copilot setting is unsupported.');
    },
    apply: host.apply,
  }, host.changed, host.error);
}
