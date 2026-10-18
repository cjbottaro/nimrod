import { SessionConfigurationController, type ConfigurationAvailability } from '../session-configuration';
import { compactTokenCount } from './usage';

export function createCopilotConfiguration(host: {
  models(): readonly { id: string; label: string; efforts?: readonly string[]; maxContextTokens?: number }[];
  model(): string | undefined;
  effort(): string | undefined;
  mode(): string | undefined;
  contextTier(): string | undefined;
  contextLimit(model: string, tier: string): number | undefined;
  availability(): ConfigurationAvailability;
  apply(setting: string, value: string, current: () => boolean, dispatched: () => void): Promise<void>;
  changed(): void;
  error(message: string): void;
}): SessionConfigurationController {
  return new SessionConfigurationController({
    capabilities: desired => {
      const models = host.models(), model = models.find(item => item.id === (desired.model ?? host.model()));
      return [
        ...(models.length ? [{ id: 'model', label: 'Model', availability: host.availability() }] : []),
        ...(model?.efforts?.length ? [{ id: 'effort', label: 'Thinking level', availability: host.availability(), dependsOn: ['model'] }]
          : !desired.model && !host.model() && models.length ? [{ id: 'effort', label: 'Thinking level', availability: 'unavailable' as const,
            reason: 'Select a model before choosing Copilot reasoning effort.', dependsOn: ['model'] }] : []),
        { id: 'mode', label: 'Mode', availability: host.availability() },
        ...(model?.maxContextTokens ? [{ id: 'context-tier', label: 'Context window', availability: host.availability(), dependsOn: ['model'] }] : []),
      ];
    },
    get: setting => setting === 'model' ? host.model() : setting === 'effort' ? host.effort()
      : setting === 'mode' ? host.mode() : setting === 'context-tier' ? host.contextTier() || 'default' : undefined,
    choices: async (setting, desired) => {
      const models = host.models();
      if (setting === 'model') return models.map(model => ({ value: model.id, label: model.label, detail: model.id }));
      if (setting === 'effort') return (models.find(model => model.id === (desired.model ?? host.model()))?.efforts || []).map(value => ({ value, label: value }));
      if (setting === 'mode') return [
        { value: 'interactive', label: 'Interactive' },
        { value: 'plan', label: 'Plan' },
        { value: 'autopilot', label: 'Autopilot' },
      ];
      if (setting === 'context-tier') {
        const model = models.find(item => item.id === (desired.model ?? host.model()));
        const defaultLimit = model && host.contextLimit(model.id, 'default');
        // The catalog advertises the maximum, not an intermediate usage budget
        // observed while the runtime is switching tiers.
        const longLimit = model?.maxContextTokens;
        return [
          { value: 'default', label: 'Default context', ...(defaultLimit ? { detail: compactTokenCount(defaultLimit) } : {}) },
          { value: 'long_context', label: 'Long context', ...(longLimit ? { detail: compactTokenCount(longLimit) } : {}) },
        ];
      }
      throw new Error('This Copilot setting is unsupported.');
    },
    apply: host.apply,
  }, host.changed, host.error);
}
