const record = value => !!value && typeof value === 'object' && !Array.isArray(value);
function optionalValue(value, label) {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string' || !value.length) throw new Error(`Copilot returned an invalid ${label}.`);
  return value;
}

/**
 * Concrete SDK configuration adapter behind Nimrod's session configuration port.
 * Defaults are creation inputs, never guessed selections or resume overrides.
 * Only model/effort leave the settings response; no raw settings are published.
 */
export function createCopilotConfiguration(client) {
  async function snapshot(session, createdDefaults = {}) {
    const current = await session.rpc.model.getCurrent();
    if (!record(current)) throw new Error('Copilot returned an invalid configuration snapshot.');
    const model = optionalValue(current.modelId, 'model');
    const effort = optionalValue(current.reasoningEffort, 'reasoning effort');
    // Once the runtime reports a different model (e.g. policy), do not attach
    // effort configured for the requested model to that authoritative selection.
    const sameModel = !model || !createdDefaults.model || model === createdDefaults.model;
    return { ...current, modelId: model ?? createdDefaults.model,
      reasoningEffort: effort ?? (sameModel ? createdDefaults.reasoningEffort : undefined) };
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
      const model = read('model'), reasoningEffort = read('effortLevel');
      return { ...(model === undefined ? {} : { model }), ...(reasoningEffort === undefined ? {} : { reasoningEffort }) };
    },
    snapshot,
    async apply(session, model, effort) {
      await session.setModel(model, effort === undefined ? undefined : { reasoningEffort: effort });
      // Creation defaults must never revive a later unset/deselected value.
      return snapshot(session);
    },
  };
}
