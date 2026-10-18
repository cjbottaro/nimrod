import { ConfigurationDeferred, SessionConfigurationController } from '../session-configuration';
import type { ModelIdentity, ModelThinkingController } from './model-thinking-controller';

const identity = (model: ModelIdentity | null) => model ? JSON.stringify([model.provider, model.id]) : undefined;
export function createPiConfiguration(model: ModelThinkingController, host: {
  unavailable(): boolean;
  blocked(): boolean;
  scoped(models: ModelIdentity[]): ModelIdentity[];
  changed(): void;
  error(message: string): void;
}): SessionConfigurationController {
  const availability = () => host.unavailable() || !model.current.ready ? 'unavailable' as const
    : model.current.changing || host.blocked() ? 'deferred' as const : 'ready' as const;
  return new SessionConfigurationController({
    capabilities: () => [
      { id: 'model', label: 'Model', availability: availability() },
      { id: 'effort', label: 'Thinking level', dependsOn: ['model'],
        availability: model.current.model && model.current.thinkingLevels.length ? availability() : 'unavailable',
        reason: !model.current.model ? 'Select a model before choosing a thinking level.' : !model.current.thinkingLevels.length ? 'Pi did not report supported thinking levels for this model.' : undefined },
    ],
    get: setting => setting === 'model' ? identity(model.current.model) : setting === 'effort' ? model.current.thinkingLevel : undefined,
    choices: async (setting, desired) => {
      if (setting === 'model') return host.scoped(await model.availableModels()).map(item => ({
        value: identity(item)!,
        label: item.name || item.id,
        detail: item.provider,
        keywords: item.name ? item.id : undefined,
      }));
      if (setting !== 'effort') throw new Error('This Pi setting is unsupported.');
      if (desired.model && desired.model !== identity(model.current.model)) throw new Error('Wait for the pending model change before choosing Pi thinking levels for that model.');
      return (await model.availableThinkingLevels()).map(value => ({ value, label: value }));
    },
    apply: async (setting, value, current, dispatched) => {
      if (availability() === 'deferred') throw new ConfigurationDeferred();
      if (availability() !== 'ready') throw new Error('Pi configuration is unavailable.');
      if (setting === 'model') {
        const selected = host.scoped(await model.availableModels()).find(item => identity(item) === value);
        if (!selected) throw new Error('This model is no longer in Pi’s scope.');
        if (availability() === 'deferred') throw new ConfigurationDeferred();
        if (availability() !== 'ready') throw new Error('Pi configuration is unavailable.');
        await model.setConfiguration('model', selected, () => {
          if (!host.scoped([selected]).length) throw new Error('This model is no longer in Pi’s scope.');
          return current();
        }, dispatched);
      } else if (setting === 'effort') await model.setConfiguration('thinking', value, current, dispatched);
      else throw new Error('This Pi setting is unsupported.');
    },
  }, host.changed, host.error);
}
