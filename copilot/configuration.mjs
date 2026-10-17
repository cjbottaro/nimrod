const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
function optionalValue(value, label) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || !value.length) throw new Error(`Copilot returned an invalid ${label}.`);
  return value;
}

/**
 * Concrete SDK configuration adapter behind Nimrod's session configuration port.
 * Defaults are creation inputs, never guessed selections or resume overrides.
 * Only supported session-setting values leave the settings response; no raw settings are published.
 */
export function createCopilotConfiguration(client) {
  async function snapshot(session, createdDefaults = {}) {
    const current = await session.rpc.model.getCurrent();
    if (!record(current)) throw new Error('Copilot returned an invalid configuration snapshot.');
    const model = optionalValue(current.modelId, 'model');
    const effort = optionalValue(current.reasoningEffort, 'reasoning effort');
    const contextTier = optionalValue(current.contextTier, 'context tier');
    // Once the runtime reports a different model (e.g. policy), do not attach
    // effort configured for the requested model to that authoritative selection.
    const sameModel = !model || !createdDefaults.model || model === createdDefaults.model;
    return { ...current, modelId: model ?? createdDefaults.model,
      reasoningEffort: effort ?? (sameModel ? createdDefaults.reasoningEffort : undefined),
      contextTier: contextTier ?? (sameModel ? createdDefaults.contextTier : undefined) };
  }
  return {
    async defaults() {
      const response = await client.rpc.user.settings.get();
      if (!record(response) || !record(response.settings)) throw new Error('Copilot did not return configured model/effort settings.');
      const read = key => {
        const setting = response.settings[key];
        if (setting === undefined) return undefined;
        if (!record(setting) || !Object.hasOwn(setting, 'value')) throw new Error(`Copilot returned invalid ${key} setting metadata.`);
        // `value` is the effective setting, not the registered `default` field.
        return optionalValue(setting.value, `${key} setting`);
      };
      const model = read('model'), reasoningEffort = read('effortLevel'), contextTier = read('contextTier');
      return { ...(model === undefined ? {} : { model }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(contextTier === undefined ? {} : { contextTier }) };
    },
    snapshot,
    async apply(session, setting, value) {
      if (setting === 'mode') {
        if (!['interactive', 'plan', 'autopilot'].includes(value)) throw new Error('Unknown Copilot session mode. Nothing was changed.');
        const expectedMode = await session.rpc.mode.get();
        if (!['interactive', 'plan', 'autopilot'].includes(expectedMode)) throw new Error('Copilot returned an unknown current mode. Nothing was changed.');
        const result = await session.rpc.mode.set({ mode: value, expectedMode });
        if (!record(result) || result.modeApplied === false) throw new Error('Copilot did not apply the requested mode.');
        const unsupported = [
          result.confirmation && 'model confirmation',
          result.deferImplementation && 'deferred implementation',
          result.armInteractiveContinuation && 'interactive continuation',
        ].filter(Boolean);
        if (unsupported.length)
          throw new Error(`Copilot mode transition requires unsupported ${unsupported.join(', ')}. Reconnect to read its authoritative state; nothing was replayed.`);
        const notice = [result.warning, result.message, ...(Array.isArray(result.deprecationWarnings) ? result.deprecationWarnings : [])]
          .filter(value => typeof value === 'string' && value).join('\n');
        return { model: await snapshot(session), mode: await session.rpc.mode.get(), ...(notice ? { notice } : {}) };
      }
      const current = await snapshot(session);
      const model = setting === 'model' ? value : current.modelId;
      if (!model) throw new Error('Select a model before changing this Copilot setting.');
      const reasoningEffort = setting === 'model' ? undefined : setting === 'effort' ? value : current.reasoningEffort;
      const contextTier = setting === 'model' ? undefined : setting === 'context-tier' ? value : current.contextTier;
      await session.setModel(model, {
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
        ...(contextTier === undefined ? {} : { contextTier }),
      });
      // Creation defaults must never revive a later unset/deselected value.
      return { model: await snapshot(session), mode: await session.rpc.mode.get() };
    },
  };
}
