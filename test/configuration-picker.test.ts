import assert from 'node:assert/strict';
import test from 'node:test';
import { pickConfiguration } from '../src/configuration-picker';
import type { ConfigurationChoice, SessionConfiguration } from '../src/session-configuration';

test('configuration picker preserves structured choices and selects by stable value', async () => {
  const choices: ConfigurationChoice[] = [
    { value: 'provider/model-a', label: 'Friendly model', detail: 'provider', keywords: 'model-a' },
    { value: 'provider/model-b', label: 'Friendly model', detail: 'other provider', keywords: 'model-b' },
  ];
  let selected: ConfigurationChoice | undefined;
  const configuration: SessionConfiguration = {
    capabilities: [{ id: 'model', label: 'Model', availability: 'ready' }],
    operations: [],
    get: () => choices[0].value,
    choices: async () => choices,
    set: (_setting, choice) => { selected = choice; },
  };

  await pickConfiguration(configuration, 'model', async (items, current) => {
    assert.deepEqual(items, choices);
    assert.equal(current, choices[0].value);
    assert.equal(items.some(item => /^\d+\.\s/.test(item.label)), false);
    return choices[1].value;
  });

  assert.equal(selected, choices[1]);
});
