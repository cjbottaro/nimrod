import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { validatePresentation } from '../src/pi/card-renderer';
import { copilotToolResult } from '../src/copilot/tool-result';

const source = { backend: 'copilot-sdk', agent: 'Copilot' };
const running: ToolCardData = { source, kind: 'execute', name: 'bash', title: 'Running command',
  arguments: { command: 'fixture command' }, toolStatus: 'running' };
function fixture(data: ToolCardData) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const card = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(card);
  return { dom, doc, card, output: () => card.querySelector<HTMLElement>('.card-plugin-body .tool-output')!,
    close() { disposeToolCard(card); dom.window.close(); } };
}
function completed(live: string | undefined, code = 0): ToolCardData {
  const result = { content: `plain final preview\n<shellId: 9 completed with exit code ${code}>`, contents: [
    { type: 'shell_exit', shellId: '9', exitCode: code, cwd: '/fixture', outputPreview: 'plain final preview' },
  ] };
  return { ...running, executionOutput: live, toolStatus: 'result',
    native: { 'tool.execution_complete': { success: true, result } }, resultOutput: copilotToolResult(result) };
}

test('Copilot command has one unlabeled wrapped viewport and closed raw disclosures from first output', () => {
  const f = fixture({ ...running, executionOutput: 'literal <script>output</script>' });
  try {
    assert.equal(f.card.querySelectorAll('.card-plugin-body .tool-output').length, 1);
    assert.equal(f.output().textContent, 'literal <script>output</script>');
    assert.equal(f.output().getAttribute('aria-label'), 'Command output');
    assert.equal(f.card.querySelector<HTMLElement>('.tool-label')!.hidden, true);
    assert.ok(f.output().classList.contains('tool-output-wrapped'));
    assert.equal(f.card.querySelector('script'), null);
    const inputs = f.card.querySelector<HTMLDetailsElement>(':scope > .tool-raw-inputs:not(.tool-raw-output)')!;
    const raw = f.card.querySelector<HTMLDetailsElement>(':scope > .tool-raw-output')!;
    assert.equal(inputs.previousElementSibling?.className, 'card-plugin-body');
    assert.equal(raw.previousElementSibling, inputs);
    assert.equal(inputs.open, false); assert.equal(raw.open, false);
    assert.equal(raw.querySelector('pre')!.textContent, 'literal <script>output</script>');
  } finally { f.close(); }
});

test('ANSI stream, viewport, focus and raw disclosures survive final native summary without duplicate logs', () => {
  const live = '\x1b[32mcolored output\x1b[0m\n';
  const f = fixture({ ...running, executionOutput: live });
  try {
    const output = f.output(), line = output.firstChild;
    const raw = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
    const inputs = f.card.querySelector<HTMLDetailsElement>('.tool-raw-inputs:not(.tool-raw-output)')!;
    raw.open = inputs.open = f.card.open = true;
    Object.defineProperties(output, { clientHeight: { value: 40 }, scrollHeight: { value: 200 } });
    output.focus(); output.scrollTop = 23;
    assert.match(output.querySelector('span[style]')!.getAttribute('style')!, /ansiGreen/);
    const final = completed(live);
    updateToolCard(f.doc, f.card, final);
    assert.equal(f.output(), output); assert.equal(output.firstChild, line);
    assert.equal(output.textContent, 'colored output\n');
    assert.equal(f.doc.activeElement, output); assert.equal(output.scrollTop, 23);
    assert.ok(output.classList.contains('tool-output-final'));
    assert.equal(f.card.querySelectorAll('.card-plugin-body .tool-output').length, 1);
    assert.equal(f.card.querySelector('.tool-raw-output'), raw); assert.equal(raw.open, true);
    assert.equal(inputs.open, true); assert.equal(f.card.open, true);
    assert.equal(raw.querySelector('[data-output-kind="execution"] pre')!.textContent, live);
    assert.equal(raw.querySelector('[data-output-kind="result"] pre')!.textContent, final.resultOutput);
    assert.doesNotMatch(f.card.querySelector('.card-plugin-body')!.textContent!, /metadata|shellId|preview/);
    updateToolCard(f.doc, f.card, { ...final });
    assert.equal(output.firstChild, line, 'lifecycle-only update does not rebuild console');
  } finally { f.close(); }
});

test('resumed results remove only the matching SDK footer and keep reported nonzero exit codes visible', () => {
  for (const live of [undefined, 'streamed output']) {
    const data = completed(live, 7), f = fixture(data);
    try {
      assert.equal(f.output().textContent, `${live || 'plain final preview'}\n\nExit code 7`);
      assert.equal(f.card.querySelector('.tool-raw-output pre')!.textContent, live || data.resultOutput);
    } finally { f.close(); }
  }
  const result = { content: 'literal <shellId: 1 completed with exit code 0>', extra: 'preserved in raw' };
  const f = fixture({ ...running, toolStatus: 'result', resultOutput: copilotToolResult(result), native: { 'tool.execution_complete': { result } } });
  try { assert.equal(f.output().textContent, result.content); }
  finally { f.close(); }
});

test('unknown independent final output and native failures remain visible in the same viewport', () => {
  for (const data of [
    { ...running, executionOutput: 'partial log', resultOutput: 'separate diagnostic', toolStatus: 'result' as const, isError: false },
    { ...running, executionOutput: 'partial log', resultOutput: JSON.stringify({ message: 'native failure' }, null, 2),
      toolStatus: 'result' as const, isError: true, native: { 'tool.execution_complete': { error: { message: 'native failure' } } } },
  ]) {
    const f = fixture(data);
    try {
      assert.equal(f.card.querySelectorAll('.card-plugin-body .tool-output').length, 1);
      assert.equal(f.output().textContent, `partial log\n\n${data.isError ? 'native failure' : 'separate diagnostic'}`);
      if (data.isError) assert.ok(f.card.querySelector('.tool-card-failed'));
    } finally { f.close(); }
  }
});

test('history prefers detailed command output and removes a matching newline-terminated native footer', () => {
  const result = { content: 'short preview', detailedContent: 'full command output\r\n<shellId: 9 completed with exit code 0>\r\n',
    contents: [{ type: 'shell_exit', shellId: '9', exitCode: 0, outputPreview: 'short preview' }] };
  const f = fixture({ ...running, toolStatus: 'result', resultOutput: copilotToolResult(result), native: { 'tool.execution_complete': { result } } });
  try { assert.equal(f.output().textContent, 'full command output'); }
  finally { f.close(); }
});

test('metadata-only native shell exits use the supplied preview, not the serialized metadata', () => {
  const result = { contents: [{ type: 'shell_exit', shellId: '9', exitCode: 0, outputPreview: 'preview only' }] };
  const f = fixture({ ...running, toolStatus: 'result', resultOutput: copilotToolResult(result), native: { 'tool.execution_complete': { result } } });
  try {
    assert.equal(f.output().textContent, 'preview only');
    assert.equal(f.card.querySelector('.tool-raw-output pre')!.textContent, copilotToolResult(result));
  } finally { f.close(); }
});

test('partial to cumulative final output is reconciled without repeating its prefix', () => {
  const f = fixture({ ...running, executionOutput: 'first\n', resultOutput: 'first\nsecond\n', toolStatus: 'result' });
  try { assert.equal(f.output().textContent, 'first\nsecond\n'); }
  finally { f.close(); }
});

test('new presentation options are validated and do not change defaults', () => {
  const section = { key: 'result', label: 'Output', text: 'value' };
  assert.doesNotThrow(() => validatePresentation({ title: 'tool', rawOutputDisclosure: true, sections: [{ ...section, hideLabel: true, wrap: true }] }));
  for (const property of ['hideLabel', 'wrap']) {
    assert.throws(() => validatePresentation({ title: 'tool', sections: [{ ...section, [property]: 'invalid' }] }), /Invalid card section/);
  }
  assert.throws(() => validatePresentation({ title: 'tool', rawOutputDisclosure: 'invalid' as unknown as boolean, sections: [section] }), /Invalid card presentation/);
  const f = fixture({ name: 'unknown', toolStatus: 'result', resultOutput: 'literal output' });
  try {
    assert.equal(f.card.querySelector<HTMLElement>('.tool-label')!.hidden, false);
    assert.equal(f.output().classList.contains('tool-output-wrapped'), false);
    assert.equal(f.card.querySelector('.tool-raw-output'), null);
  } finally { f.close(); }
});
