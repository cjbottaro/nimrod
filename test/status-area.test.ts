import assert from 'node:assert/strict';
import test from 'node:test';
import { createPiStatusArea } from '../src/pi/status-area';
import { createCopilotStatusArea } from '../src/copilot/status-area';

test('Pi status capabilities retain native configuration, extensions and unknown metrics', () => {
  const project = createPiStatusArea();
  const connecting = project({ sessionUnavailable: true });
  assert.deepEqual(connecting.controls.map(control => control.id), ['model', 'thinking']);
  assert.ok(connecting.controls.every(control => control.disabled));
  assert.equal(connecting.metrics, undefined);
  assert.ok(connecting.capabilities.metrics);
  assert.equal(connecting.capabilities.queue, true);
  assert.equal(connecting.capabilities.information, true);
  assert.equal(connecting.capabilities.subagents, true);
  const state = { modelControls: { ready: true, changing: false, model: { provider: 'local', id: 'fixture' }, thinkingLevel: 'medium' },
    extensionStatuses: { note: 'Reported note', subagents: '2 running agents' }, extensionWidgets: { widget: { lines: ['Reported widget'] } } };
  const idle = project(state);
  const working = project({ ...state, busy: true });
  assert.equal(working, idle, 'main-agent work alone does not change status controls or extension rows');
  assert.ok(working.controls.every(control => !control.disabled));
  assert.equal(working.subagents, '2 running agents');
  assert.deepEqual(working.information, [{ label: 'note', text: 'Reported note' }, { label: 'widget', text: 'Reported widget' }]);
  const changing = project({ ...state, modelControls: { ...state.modelControls, changing: true } });
  assert.ok(changing.controls.every(control => !control.disabled), 'in-flight changes still accept replacement intent');
  assert.equal(changing.information, idle.information);
  const cleared = project({ modelControls: state.modelControls });
  assert.deepEqual(cleared.information, []);
  assert.equal(cleared.subagents, undefined);
});

test('Copilot unknown model/effort values have independent lowercase placeholders without guessed capabilities', () => {
  const project = createCopilotStatusArea();
  const unresolved = { supportsModel: true, supportsThinking: false, supportsMode: false, supportsContext: false, available: true };
  const both = project(unresolved);
  assert.deepEqual(both.controls.map(control => control.label), ['default model', 'default effort']);
  assert.equal(both.controls[0].disabled, false);
  assert.equal(both.controls[1].disabled, true, 'unknown model cannot invent selectable effort levels');
  assert.equal(project({ ...unresolved }), both);
  const effortOnly = project({ ...unresolved, effort: 'high' });
  assert.deepEqual(effortOnly.controls.map(control => control.label), ['default model', 'high']);
  const modelOnly = project({ ...unresolved, model: 'small', supportsThinking: true });
  assert.deepEqual(modelOnly.controls.map(control => control.label), ['small', 'default effort']);
  assert.equal(modelOnly.controls[1].disabled, false);
  const knownUnsupported = project({ ...unresolved, model: 'large' });
  assert.deepEqual(knownUnsupported.controls.map(control => control.label), ['large']);
});

test('Copilot status separates advertised selectors, transient availability and reported usage', () => {
  const project = createCopilotStatusArea();
  const state = { supportsModel: false, supportsThinking: false, supportsMode: false, supportsContext: false, available: false };
  const connecting = project(state);
  assert.deepEqual(connecting.controls, []);
  assert.ok(connecting.capabilities.metrics);
  assert.equal(connecting.metrics, undefined, 'supported but not reported is not zero');
  assert.equal(connecting.capabilities.queue, undefined);
  assert.equal(connecting.capabilities.information, undefined);
  assert.equal(connecting.capabilities.subagents, undefined);
  const ready = { ...state, supportsModel: true, supportsThinking: true, supportsMode: true, supportsContext: true,
    available: true, model: 'small', effort: 'high', mode: 'plan' };
  const idle = project(ready);
  assert.equal(project({ ...ready }), idle, 'retain the full status snapshot on content-only publications');
  assert.deepEqual(idle.controls.map(control => control.id), ['model', 'thinking', 'mode']);
  assert.equal(idle.controls[2].label, 'Plan');
  const busy = project({ ...ready, available: false });
  assert.deepEqual(busy.controls.map(control => control.id), ['model', 'thinking', 'mode']);
  assert.ok(busy.controls.every(control => control.disabled));
  assert.ok(project(ready).controls.every(control => !control.disabled));
  const noThinking = project({ ...ready, model: 'large', effort: undefined, supportsThinking: false });
  assert.deepEqual(noThinking.controls.map(control => control.id), ['model', 'mode']);
  const usage = { context: { currentTokens: 0, tokenLimit: 0 } };
  const reported = project({ ...ready, usage });
  assert.equal(reported.metrics, '— / —');
  assert.equal(project({ ...ready, usage }), reported);
  const disconnected = project({ ...ready, usage, available: false });
  assert.equal(disconnected.metrics, reported.metrics, 'keep the last reported usage on disconnect');
  assert.ok(disconnected.controls.every(control => control.disabled));
  const withLimit = project({ ...ready, usage: { context: { currentTokens: 31_875, tokenLimit: 125_000 } } });
  assert.equal(withLimit.metrics, '25.5% / 125k');
  assert.equal(withLimit.metricParts?.find(part => part.actionId === 'context-window')?.text, '125k');
});
