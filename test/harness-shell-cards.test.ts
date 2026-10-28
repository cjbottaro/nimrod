import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { consoleOutputSuffix, rawToolPresentation, shellPresentation } from '../src/card-plugin-ui';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';

const harnesses: { name: string; data: ToolCardData }[] = [
  { name: 'Pi', data: { name: 'functions.bash', arguments: { command: 'fixture command' } } },
  { name: 'Codex', data: { source: { backend: 'codex', agent: 'codex' }, name: 'commandExecution',
    arguments: { command: 'fixture command', cwd: '/fixture' }, native: { type: 'commandExecution', command: 'fixture command', status: 'inProgress' } } },
  { name: 'ACP', data: { source: { backend: 'acp', agent: 'fixture-agent' }, name: 'run_shell', kind: 'execute',
    title: 'Run command', arguments: { command: 'fixture command' } } },
];
function fixture(data: ToolCardData) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const card = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(card); card.open = true;
  return { dom, doc, card, output: () => card.querySelector<HTMLElement>('.card-plugin-body .tool-output')!,
    close() { disposeToolCard(card); dom.window.close(); } };
}

for (const harness of harnesses) {
  test(`${harness.name} shell layout retains one wrapped unlabeled console, raw disclosures and reader intent`, () => {
    const live = '\x1b[32mfirst\x1b[0m\n';
    const start: ToolCardData = { ...harness.data, toolStatus: 'running', executionOutput: live };
    const f = fixture(start);
    try {
      const output = f.output(), line = output.firstChild;
      const inputs = f.card.querySelector<HTMLDetailsElement>(':scope > .tool-raw-inputs:not(.tool-raw-output)')!;
      const raw = f.card.querySelector<HTMLDetailsElement>(':scope > .tool-raw-output')!;
      assert.equal(f.card.querySelectorAll('.card-plugin-body .tool-output').length, 1);
      assert.equal(output.textContent, 'first\n');
      assert.equal(f.card.querySelector<HTMLElement>('.tool-label')!.hidden, true);
      assert.ok(output.getAttribute('aria-label'));
      assert.ok(output.classList.contains('tool-output-wrapped'));
      assert.match(output.querySelector('span[style]')!.getAttribute('style')!, /ansiGreen/);
      assert.equal(f.card.querySelector('.tool-card-preview')!.textContent, 'fixture command');
      assert.equal(inputs.previousElementSibling?.className, 'card-plugin-body');
      assert.equal(raw.previousElementSibling, inputs);
      assert.equal(raw.open, false); assert.equal(inputs.open, false);
      assert.equal(raw.querySelector('pre')!.textContent, live);
      inputs.open = raw.open = true;
      Object.defineProperties(output, { clientHeight: { value: 40 }, scrollHeight: { value: 200 } });
      output.scrollTop = 30; output.focus();
      updateToolCard(f.doc, f.card, { ...start, executionOutput: `${live}second\n` });
      assert.equal(f.output(), output); assert.equal(output.firstChild, line);
      assert.equal(output.scrollTop, 30); assert.equal(f.doc.activeElement, output);
      // A colorless cumulative final result may extend, but not duplicate or decolor, the stream.
      const final = { ...start, toolStatus: 'result' as const, resultOutput: 'first\nsecond\n' };
      updateToolCard(f.doc, f.card, final);
      assert.equal(f.output(), output); assert.equal(output.firstChild, line);
      assert.equal(output.textContent, 'first\nsecond\n');
      assert.equal(output.scrollTop, 30); assert.equal(f.doc.activeElement, output);
      assert.ok(output.classList.contains('tool-output-final'));
      assert.equal(f.card.querySelectorAll('.card-plugin-body .tool-output').length, 1);
      assert.equal(f.card.querySelector('.tool-raw-output'), raw); assert.equal(raw.open, true);
      assert.equal(f.card.querySelector('.tool-raw-inputs:not(.tool-raw-output)'), inputs); assert.equal(inputs.open, true);
      assert.equal(raw.querySelector('[data-output-kind="execution"] pre')!.textContent, live);
      assert.equal(raw.querySelector('[data-output-kind="result"] pre')!.textContent, final.resultOutput);
      // Replacement/truncated results remain authoritative; old output stays only in raw recovery.
      updateToolCard(f.doc, f.card, { ...final, resultOutput: 'authoritative replacement', isError: true });
      assert.equal(f.output(), output); assert.equal(output.textContent, 'authoritative replacement');
      assert.ok(f.card.querySelector('.tool-card-failed'));
      assert.equal(output.scrollTop, 30); assert.equal(f.doc.activeElement, output);
    } finally { f.close(); }
  });

  test(`${harness.name} plain history and stopped output use the same shell presentation`, () => {
    const f = fixture({ ...harness.data, toolStatus: 'result', resultOutput: '<script>literal</script>' });
    try {
      assert.equal(f.output().textContent, '<script>literal</script>'); assert.equal(f.card.querySelector('script'), null);
      assert.ok(f.card.querySelector('.tool-raw-output'));
      updateToolCard(f.doc, f.card, { ...harness.data, toolStatus: 'running', uiPhase: 'stopped', executionOutput: 'partial' });
      assert.match(f.card.querySelector('.tool-phase')!.textContent!, /interrupted/);
      assert.equal(f.output().textContent, 'partial');
      assert.ok(f.output().classList.contains('tool-output-final'));
    } finally { f.close(); }
  });
}

test('Codex reports native nonzero exit codes without parsing command output or altering raw source', () => {
  const data = harnesses[1].data;
  for (const exitCode of [0, 7, undefined, '7', 1.5]) {
    const final = '\x1b[31mfailed\x1b[0m';
    const f = fixture({ ...data, toolStatus: 'result', resultOutput: final, isError: exitCode === 7,
      native: { type: 'commandExecution', command: 'fixture command', status: 'completed', exitCode } });
    try {
      assert.equal(f.output().textContent, exitCode === 7 ? 'failed\n\nExit code 7' : 'failed');
      assert.equal(f.card.querySelector('.tool-raw-output pre')!.textContent, final);
    } finally { f.close(); }
  }
});

test('ACP uses its explicit execute category, never agent identity or a shell-looking tool name', () => {
  const f = fixture({ source: { backend: 'acp', agent: 'copilot' }, name: 'bash', kind: 'other',
    arguments: { command: 'fixture command' }, toolStatus: 'result', resultOutput: '\x1b[32mliteral' });
  try {
    assert.equal(f.output().textContent, '\x1b[32mliteral');
    assert.equal(f.output().classList.contains('tool-output-wrapped'), false);
    assert.equal(f.card.querySelector<HTMLElement>('.tool-label')!.hidden, false);
    assert.equal(f.card.querySelector('.tool-raw-output'), null);
  } finally { f.close(); }
});

test('public shell helper shares the layout while preserving authoritative replacement snapshots', () => {
  const presentation = shellPresentation({ title: 'Command', sections: rawToolPresentation({ executionOutput: 'old', resultOutput: 'new' }).sections });
  assert.equal(presentation.rawInputsPlacement, 'after'); assert.equal(presentation.rawOutputDisclosure, true);
  assert.deepEqual(presentation.sections, [{ key: 'result', label: 'Result', text: 'new', hideLabel: true, wrap: true, format: 'console' }]);
  assert.equal(consoleOutputSuffix('\x1b[32mfirst\x1b[0m', 'first\nsecond'), '\nsecond');
  assert.equal(consoleOutputSuffix('old', 'replacement'), undefined);
  assert.equal(consoleOutputSuffix('progress\r\x1b[2Kdone', 'done'), undefined);
  assert.equal(consoleOutputSuffix('\x1b[32m', ''), undefined);
  const untouched = { startsWith() { assert.fail('live-only output must not compare accumulated prefixes'); }, replace() { assert.fail('live-only output must not scan accumulated text'); } };
  assert.equal(consoleOutputSuffix(untouched as unknown as string, ''), undefined);
  const literal = shellPresentation({ title: 'Error', sections: [{ key: 'result', label: 'Error', text: '\x1b[31mliteral' }], format: 'text' });
  assert.equal(literal.sections[0].format, 'text'); assert.equal(literal.sections[0].text, '\x1b[31mliteral');
});
