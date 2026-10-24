import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { bundledCopilotPlugin } from '../src/copilot/card-plugins';
import type { ToolCardData } from '../src/card-plugin-api';
import { copilotToolResult } from '../src/copilot/tool-result';

const source = { backend: 'copilot-sdk' as const, agent: 'Copilot' };
function fixture(data: ToolCardData, projectDirectory = '/fixture') {
  const dom = new JSDOM('<body></body>');
  const doc = dom.window.document;
  const card = renderToolCard(doc, data, doc.createElement('details'), undefined, undefined, { projectDirectory }); doc.body.append(card);
  return { dom, card, close() { disposeToolCard(card); dom.window.close(); } };
}
function readData(arguments_: unknown = { path: '/fixture/src/client.ts', view_range: [20, 40] }): ToolCardData {
  const rawOutput = { content: 'const example = "<script>literal</script>";\n', detailedContent: 'redundant diff representation' };
  return { source, kind: 'read', title: 'Viewing .../client.ts', arguments: arguments_, native: { 'tool.execution_complete': { result: rawOutput } },
    toolStatus: 'result', resultOutput: copilotToolResult(rawOutput) };
}

test('captured Copilot reads show project-relative paths then requested ranges and content without JSON/diff duplication', () => {
  const data = readData(), f = fixture(data);
  try {
    assert.equal(bundledCopilotPlugin(data).id, 'nimrod.copilot.read');
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Read file');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'src/client.ts · lines 20–40');
    assert.equal(f.card.querySelector('.card-plugin-body .tool-output')?.textContent, 'const example = "<script>literal</script>";\n');
    assert.equal(f.card.querySelector('script'), null);
    assert.ok(f.card.querySelector('.card-plugin-body + .tool-raw-inputs'));
    assert.equal(f.card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')?.open, false);
    const raw = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
    assert.equal(raw.open, false); assert.equal(raw.querySelector('pre')?.textContent, data.resultOutput);
    assert.match(f.card.querySelector('summary')!.getAttribute('aria-label')!, /Viewing.*succeeded/);
    assert.equal(f.card.querySelector('[title]'), null);
  } finally { f.close(); }
});

test('project context is per mounted view; outside paths and raw inputs stay unambiguous', () => {
  const data = readData();
  const first = fixture(data, '/fixture'), second = fixture(data, '/fixture/src'), outside = fixture(data, '/fixture-other');
  try {
    assert.equal(first.card.querySelector('.tool-card-preview')?.textContent, 'src/client.ts · lines 20–40');
    assert.equal(second.card.querySelector('.tool-card-preview')?.textContent, 'client.ts · lines 20–40');
    assert.equal(outside.card.querySelector('.tool-card-preview')?.textContent, '/fixture/src/client.ts · lines 20–40');
    assert.deepEqual(JSON.parse(first.card.querySelector('.tool-raw-inputs pre')!.textContent!), data.arguments);
    assert.deepEqual(data.arguments, { path: '/fixture/src/client.ts', view_range: [20, 40] });
  } finally { first.close(); second.close(); outside.close(); }
});

test('Copilot requested ranges handle EOF, single lines and malformed values without fabricated ranges', () => {
  for (const [range, expected] of [
    [[3, -1], 'src/client.ts · from line 3'],
    [[3, 3], 'src/client.ts · line 3'],
    [[0, 10], 'src/client.ts'],
    [[20, 10], 'src/client.ts'],
    [['1', 10], 'src/client.ts'],
    [[1, Number.MAX_SAFE_INTEGER + 1], 'src/client.ts'],
  ] as const) {
    const f = fixture(readData({ path: '/fixture/src/client.ts', view_range: range }));
    try { assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, expected); }
    finally { f.close(); }
  }
  const f = fixture(readData({ path: 'C:\\fixture\\client.ts' }));
  try { assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'C:\\fixture\\client.ts'); }
  finally { f.close(); }
});

test('Copilot grep uses the complete pattern, scope and file filter despite being categorized other', () => {
  const data: ToolCardData = { source, kind: 'other', title: "Searching for 'deleteSession...'", toolStatus: 'result',
    arguments: { pattern: 'deleteSession|session/delete', paths: '/fixture/src', output_mode: 'content', glob: '*.ts', '-n': true },
    resultOutput: '<img src=x>\nclient.ts:10: deleteSession\n' };
  const f = fixture(data);
  try {
    assert.equal(bundledCopilotPlugin(data).id, 'nimrod.copilot.search');
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Search');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'deleteSession|session/delete · in src · files *.ts');
    assert.equal(f.card.querySelector('.card-plugin-body .tool-output')?.textContent, data.resultOutput);
    assert.equal(f.card.querySelector('img'), null);
  } finally { f.close(); }
});

test('file-pattern searches are not confused with reads, and unknown Copilot operations remain generic', () => {
  const found = fixture({ source, kind: 'read', arguments: { pattern: '**/*schema*', paths: ['/fixture/src', '/fixture/test'] }, toolStatus: 'result', resultOutput: 'No files found' });
  try {
    assert.equal(found.card.querySelector('.tool-card-title')?.textContent, 'Find files');
    assert.equal(found.card.querySelector('.tool-card-preview')?.textContent, '**/*schema* · in src · test');
  } finally { found.close(); }
  for (const data of [
    { source, kind: 'read', title: 'Unknown read', arguments: { custom: true } },
    { source, kind: 'other', title: 'Using skill: fixture', arguments: { skill: 'fixture' } },
    { source, kind: 'search', title: 'Web search', arguments: { query: 'fixture' } },
  ]) {
    const f = fixture(data);
    try { assert.equal(f.card.querySelector('.tool-card-title')?.textContent, data.title); }
    finally { f.close(); }
  }
  const catalog = new CardPluginCatalog();
  assert.equal(catalog.select({ ...readData(), source: { backend: 'acp', agent: 'unknown-agent' } }).id, 'nimrod.acp.tool');
  assert.equal(catalog.select({ name: 'read' }).id, 'nimrod.read');
  assert.equal(catalog.select({ source, kind: 'execute', arguments: { command: 'fixture' } }).id, 'nimrod.copilot.shell', 'captured capitalized identity also selects the existing shell adapter');
});

test('partial inputs enhance the same mounted card; output patches retain nodes, raw disclosure and reader focus', () => {
  const initial: ToolCardData = { source, kind: 'read', title: 'Reading', toolStatus: 'running' };
  const f = fixture(initial);
  try {
    const body = f.card.querySelector('.card-plugin-body');
    const data = { ...readData(), toolStatus: 'running' as const };
    updateToolCard(f.dom.window.document, f.card, data);
    assert.equal(f.card.querySelector('.card-plugin-body'), body);
    const output = f.card.querySelector<HTMLElement>('.card-plugin-body .tool-output')!;
    const raw = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
    f.card.open = true; raw.open = true; output.focus();
    const rawOutput = { content: 'const example = "<script>literal</script>";\nmore\n', detailedContent: 'different redundant diff' };
    updateToolCard(f.dom.window.document, f.card, { ...data, toolStatus: 'result', native: { 'tool.execution_complete': { result: rawOutput } }, resultOutput: copilotToolResult(rawOutput) });
    assert.equal(f.card.querySelector('.card-plugin-body .tool-output'), output);
    assert.equal(f.card.querySelector('.tool-raw-output'), raw); assert.equal(raw.open, true);
    assert.equal(f.dom.window.document.activeElement, output); assert.equal(f.card.open, true);
    assert.equal(output.textContent, rawOutput.content);
  } finally { f.close(); }
});

test('unrelated output and structured errors are not replaced by a Copilot content shortcut', () => {
  const original = readData();
  const rawError = { code: 'failure', content: 'fixture error details', detailedContent: 'additional error metadata' };
  for (const data of [
    { ...original, native: { ...(original.native as object), content: [{ type: 'content', content: { type: 'text', text: 'standard content' } }] }, resultOutput: 'standard content' },
    { ...original, native: { 'tool.execution_complete': { result: { code: 'failure', message: 'fixture file missing' } } }, isError: true, resultOutput: '{"code":"failure","message":"fixture file missing"}' },
    { ...original, native: { 'tool.execution_complete': { result: rawError } }, isError: true, resultOutput: copilotToolResult(rawError) },
  ]) {
    const f = fixture(data);
    try { assert.equal(f.card.querySelector('.card-plugin-body .tool-output')?.textContent, data.resultOutput); }
    finally { f.close(); }
  }
});

test('external authors can bundle the same path-first and query-first public components', async () => {
  const bundle = await build({ stdin: { contents: `import { fileReadPresentation, searchPresentation } from './src/card-plugin-ui'; export { fileReadPresentation, searchPresentation };`, resolveDir: process.cwd() }, bundle: true, format: 'esm', platform: 'browser', write: false });
  const external = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.equal(external.fileReadPresentation({ path: '/fixture/example.ts', sections: [] }).preview, '/fixture/example.ts');
  assert.equal(external.searchPresentation({ query: 'fixture', scope: 'src', sections: [] }).preview, 'fixture · in src');
});
