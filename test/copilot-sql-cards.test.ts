import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { copilotToolResult } from '../src/copilot/tool-result';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';

interface Capture {
  start: { data: { toolName: string; arguments: { description: string; query: string } } };
  complete: { data: { success: boolean; result: Record<string, unknown>; toolTelemetry: { metrics: Record<string, unknown> } } };
}
function captured(): Capture {
  return JSON.parse(readFileSync(new URL('./fixtures/copilot/sql/task-progress.json', import.meta.url), 'utf8'));
}
function sqlData(capture = captured()): ToolCardData {
  return { source: { backend: 'copilot-sdk', agent: 'Copilot' }, name: capture.start.data.toolName, kind: 'other',
    arguments: capture.start.data.arguments, toolStatus: 'result', resultOutput: copilotToolResult(capture.complete.data.result),
    native: { 'tool.execution_start': capture.start.data, 'tool.execution_complete': capture.complete.data } };
}
function fixture(data: ToolCardData) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const card = renderToolCard(doc, data, doc.createElement('details')); doc.body.append(card);
  return { dom, doc, card, close() { disposeToolCard(card); dom.window.close(); } };
}
const bodyOutput = (card: HTMLElement) => card.querySelector<HTMLElement>('.card-plugin-body .tool-output');
const bodyLabel = (card: HTMLElement) => card.querySelector('.card-plugin-body')?.textContent || '';

test('captured SQL uses its description, reported counts and concise literal output with exact raw recovery', () => {
  const capture = captured(), data = sqlData(capture), f = fixture(data);
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'SQL');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'Advance depth blur todos');
    assert.match(bodyLabel(f.card), /Results · 2 statements · 3 rows affected · 0 rows returned/);
    assert.equal(bodyOutput(f.card)?.textContent, capture.complete.data.result.content);
    assert.doesNotMatch(bodyOutput(f.card)!.textContent!, /UPDATE todos|Copilot result metadata/);
    const raw = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
    assert.equal(raw.open, false); assert.equal(raw.querySelector('pre')?.textContent, data.resultOutput);
    assert.deepEqual(JSON.parse(f.card.querySelector('.tool-raw-inputs pre')!.textContent!), data.arguments);
    assert.ok(f.card.querySelector('.card-plugin-body + .tool-raw-inputs'));
    assert.equal(f.card.querySelector('[title]'), null);
    assert.equal(capture.complete.data.toolTelemetry.metrics.rowsAffected, 3, 'native fixture is unchanged');
  } finally { f.close(); }
});

test('SQL counts are optional nonnegative safe integers; zero and singular labels are not guessed', () => {
  for (const [metrics, expected] of [
    [{}, 'Results'],
    [{ statementCount: 1, rowsAffected: 0, rowsReturned: 1 }, 'Results · 1 statement · 0 rows affected · 1 row returned'],
    [{ statementCount: '2', rowsAffected: -1, rowsReturned: 1.5 }, 'Results'],
    [{ statementCount: Number.MAX_SAFE_INTEGER + 1, rowsAffected: null, rowsReturned: Infinity }, 'Results'],
  ] as const) {
    const capture = captured(); capture.complete.data.toolTelemetry.metrics = { ...metrics };
    const f = fixture(sqlData(capture));
    try {
      assert.ok(bodyLabel(f.card).startsWith(expected));
      assert.equal(bodyOutput(f.card)?.textContent, capture.complete.data.result.content);
      if (expected === 'Results') assert.doesNotMatch(bodyLabel(f.card), /statements ·|rows affected|rows returned/);
    } finally { f.close(); }
  }
  const capture = captured(); delete (capture.complete.data as Partial<Capture['complete']['data']>).toolTelemetry;
  const f = fixture(sqlData(capture));
  try { assert.ok(bodyLabel(f.card).startsWith('Results')); assert.equal(bodyOutput(f.card)?.textContent, capture.complete.data.result.content); }
  finally { f.close(); }
});

test('SELECT output stays literal, descriptions are not markup, and no task state is inferred', () => {
  const capture = captured();
  capture.start.data.arguments = { description: '<img src=x> **Task status**', query: "SELECT id, status FROM todos;" };
  capture.complete.data.result = { content: '| id | status |\n| --- | --- |\n| example | done |\n<script>literal</script>', detailedContent: 'SQL: SELECT id, status FROM todos;\nfull details', extra: { preserved: true } };
  capture.complete.data.toolTelemetry.metrics = { statementCount: 1, rowsAffected: 0, rowsReturned: 1 };
  const data = sqlData(capture), f = fixture(data);
  try {
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, capture.start.data.arguments.description);
    assert.equal(bodyOutput(f.card)?.textContent, capture.complete.data.result.content);
    assert.equal(f.card.querySelector('script, img, table'), null);
    assert.match(f.card.querySelector('.tool-raw-output pre')!.textContent!, /"preserved": true/);
    assert.match(bodyLabel(f.card), /1 row returned/);
  } finally { f.close(); }
});

test('native results must exactly match current output; missing content and unsupported result shapes stay recoverable', () => {
  const original = sqlData();
  for (const data of [
    { ...original, resultOutput: 'independent standard output' },
    { ...original, native: undefined },
    { ...original, uiPhase: 'stopped' as const },
    { ...original, toolStatus: 'running' as const },
    { ...original, native: { 'tool.execution_complete': { success: false, result: captured().complete.data.result } } },
  ]) {
    const f = fixture(data);
    try { assert.equal(bodyOutput(f.card)?.textContent, data.resultOutput); assert.doesNotMatch(bodyLabel(f.card), /Results ·/); }
    finally { f.close(); }
  }
  for (const result of [{ detailedContent: 'SQL details only' }, { rows: [{ id: 1 }] }]) {
    const capture = captured(); capture.complete.data.result = result;
    const data = sqlData(capture), f = fixture(data);
    try {
      assert.equal(bodyOutput(f.card)?.textContent, typeof result.detailedContent === 'string' ? result.detailedContent : data.resultOutput);
      if (!('detailedContent' in result)) assert.doesNotMatch(bodyLabel(f.card), /Results ·/);
    } finally { f.close(); }
  }
});

test('SQL keeps independent live output and works without description or telemetry', () => {
  const capture = captured();
  delete (capture.start.data.arguments as Partial<Capture['start']['data']['arguments']>).description;
  delete (capture.complete.data as Partial<Capture['complete']['data']>).toolTelemetry;
  const data = { ...sqlData(capture), executionOutput: 'independent live output' }, f = fixture(data);
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'SQL');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent || '', '');
    const outputs = f.card.querySelectorAll('.card-plugin-body .tool-output');
    assert.equal(outputs[0]?.textContent, data.executionOutput);
    assert.equal(outputs[1]?.textContent, capture.complete.data.result.content);
    assert.equal(f.card.querySelector('.tool-raw-output [data-output-kind="result"] pre')?.textContent, data.resultOutput);
  } finally { f.close(); }
});

test('native SQL failures show exact errors, retain original JSON and never show success metrics', () => {
  const error = { code: 'SQL_ERROR', message: 'no such table: fixture' };
  const data: ToolCardData = { ...sqlData(), isError: true, resultOutput: JSON.stringify(error, null, 2), native: {
    'tool.execution_complete': { success: false, error, toolTelemetry: { metrics: { statementCount: 1, rowsAffected: 42 } } },
  } };
  const f = fixture(data);
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'SQL');
    assert.equal(bodyOutput(f.card)?.textContent, error.message);
    assert.ok(bodyLabel(f.card).startsWith('Error'));
    assert.doesNotMatch(bodyLabel(f.card), /rows affected/);
    assert.equal(f.card.querySelector('.tool-raw-output pre')?.textContent, data.resultOutput);
    assert.ok(f.card.querySelector('.tool-card-failed'));
  } finally { f.close(); }
});

test('SQL recognition is exact, SDK-scoped and never steals MCP or arbitrary query tools', () => {
  const original = sqlData(), catalog = new CardPluginCatalog();
  assert.equal(catalog.select(original).id, 'nimrod.copilot.search', 'enhancement stays inside the mounted SDK router');
  assert.equal(catalog.select({ ...original, source: undefined }).id, 'nimrod.tool');
  assert.equal(catalog.select({ ...original, source: { backend: 'acp', agent: 'Copilot' } }).id, 'nimrod.acp.tool');
  for (const data of [
    { ...original, name: 'custom_query' },
    { ...original, arguments: { description: 'query only', query: 123 } },
    { ...original, arguments: { description: 'empty query', query: ' ' } },
    { ...original, source: { backend: 'copilot-sdk' as const, agent: 'unknown' } },
    { ...original, native: { 'tool.execution_start': { mcpServerName: 'fixture-db', mcpToolName: 'sql' } } },
    { ...original, native: { 'tool.execution_start': { mcpServerName: 'fixture-db' } } },
    { ...original, native: { 'tool.execution_start': { mcpToolName: 'sql' } } },
  ]) {
    const f = fixture(data);
    try {
      assert.notEqual(f.card.querySelector('.tool-card-title')?.textContent, 'SQL');
      assert.equal(bodyOutput(f.card)?.textContent, data.resultOutput);
    } finally { f.close(); }
  }
});

test('generation, execution, result and late metadata enhance the same shell with retained raw inputs and output focus', () => {
  const complete = sqlData();
  const initial: ToolCardData = { source: complete.source, kind: 'other', uiPhase: 'thinking', toolStatus: 'running', arguments: '{"description":"Advance depth blur todos","query":"UPDATE' };
  const f = fixture(initial);
  try {
    const body = f.card.querySelector('.card-plugin-body'), rawInputs = f.card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!;
    f.card.open = true; rawInputs.open = true;
    const running: ToolCardData = { ...complete, native: { 'tool.execution_start': captured().start.data }, toolStatus: 'running', resultOutput: undefined, executionOutput: 'working\n' };
    updateToolCard(f.doc, f.card, running);
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'SQL');
    const output = bodyOutput(f.card)!;
    output.focus();
    updateToolCard(f.doc, f.card, complete);
    assert.equal(f.card.querySelector('.card-plugin-body'), body);
    assert.equal(bodyOutput(f.card), output); assert.equal(f.doc.activeElement, output);
    assert.equal(f.card.querySelector('.tool-raw-inputs'), rawInputs); assert.equal(rawInputs.open, true);
    const rawOutput = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!; rawOutput.open = true;
    updateToolCard(f.doc, f.card, { ...complete, title: 'late native title' });
    assert.equal(f.card.querySelector('.tool-raw-output'), rawOutput); assert.equal(rawOutput.open, true);
    assert.equal(bodyOutput(f.card), output); assert.equal(f.card.open, true);
  } finally { f.close(); }
});
