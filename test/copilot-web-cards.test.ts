import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import { bundledAcpPlugin } from '../src/acp/card-plugins';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';
import { definePresentationPlugin, webUrl, displayWebUrl } from '../src/card-plugin-ui';
import { validatePresentation } from '../src/pi/card-renderer';
import type { ToolCardData, CardPlugin } from '../src/card-plugin-api';
import { copilotToolResult } from '../src/copilot/tool-result';

const source = { backend: 'acp' as const, agent: 'Copilot' };
function fixture(data: ToolCardData, plugin?: CardPlugin) {
  const dom = new JSDOM('<body></body>', { url: 'https://nimrod.test/' });
  const doc = dom.window.document, markdown = createSafeMarkdownRenderer(dom.window as unknown as Window);
  const card = renderToolCard(doc, data, doc.createElement('details'), plugin, undefined, { markdown: text => {
    const node = doc.createElement('div'); node.className = 'markdown'; node.innerHTML = markdown.render(text); return node;
  } });
  doc.body.append(card);
  return { dom, doc, card, close() { disposeToolCard(card); dom.window.close(); } };
}
function nativeData(kind: string, args: unknown, output: Record<string, unknown>, isError = false): ToolCardData {
  const text = typeof output.content === 'string' ? output.content : JSON.stringify(output, null, 2);
  return { source, kind, title: 'Agent-supplied title', arguments: args, toolStatus: 'result', resultOutput: text, isError,
    native: { rawOutput: output, ...(typeof output.content === 'string' ? { content: [{ type: 'content', content: { type: 'text', text } }] } : {}) } };
}
const firstMarker = '\u30101:1\u2020source\u3011', secondMarker = '\u30101:2\u2020source\u3011';
function searchData(value = `## Answer\n\nSee the documentation ${firstMarker} and another reference ${secondMarker}.`) {
  const first = firstMarker, second = secondMarker;
  const structuredContent = { type: 'output_text', text: { value, annotations: [
    { start_index: value.indexOf(first), end_index: value.indexOf(first) + first.length, url_citation: { title: 'Documentation', url: 'https://example.test/docs' } },
    { start_index: value.indexOf(second), end_index: value.indexOf(second) + second.length, url_citation: { title: 'Documentation again', url: 'https://example.test/docs' } },
  ] }, bing_searches: [{ text: 'actual query', url: 'https://example.test/search?q=actual' }] };
  return nativeData('search', { query: 'A complete web query' }, { structuredContent, content: JSON.stringify(structuredContent), detailedContent: 'redundant representation' });
}

test('Copilot web search renders an answer, linked numbered citations and deduplicated sources with exact raw recovery', () => {
  const data = searchData(), f = fixture(data);
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Web search');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'A complete web query');
    const answer = f.card.querySelector('[data-output-kind="result"] .tool-output')!;
    assert.equal(answer.querySelector('h2')?.textContent, 'Answer');
    assert.deepEqual([...answer.querySelectorAll('a')].map(a => [a.textContent, a.getAttribute('href')]), [['[1]', 'https://example.test/docs'], ['[1]', 'https://example.test/docs']]);
    assert.equal(f.card.querySelector('[data-output-kind="web-sources"] .tool-label')?.textContent, 'Sources · 1');
    assert.equal(f.card.querySelector('[data-output-kind="web-sources"] a')?.textContent, 'Documentation');
    assert.equal(f.card.querySelector('.tool-raw-output [data-output-kind="result"] pre')?.textContent, data.resultOutput);
    assert.equal(f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')?.open, false);
  } finally { f.close(); }
});

test('SDK web cards consume original SDK results with citations and exact literal recovery', () => {
  const acp = searchData();
  const output = (acp.native as { rawOutput: Record<string, unknown> }).rawOutput;
  const data: ToolCardData = { ...acp, source: { backend: 'copilot-sdk', agent: 'copilot' }, native: { 'tool.execution_complete': { result: output, success: true } }, resultOutput: copilotToolResult(output) };
  const f = fixture(data);
  try {
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Web search');
    assert.equal(f.card.querySelector('[data-output-kind="result"] h2')?.textContent, 'Answer');
    assert.equal(f.card.querySelector('[data-output-kind="web-sources"] a')?.textContent, 'Documentation');
    assert.equal(f.card.querySelector('.tool-raw-output [data-output-kind="result"] pre')?.textContent, data.resultOutput);
  } finally { f.close(); }
});

test('invalid citations stay literal, unsafe links remain inert, and Unicode offsets do not corrupt the answer', () => {
  const value = `😀 See the documentation ${firstMarker} and another reference ${secondMarker}.`;
  const data = searchData(value);
  const raw = (data.native as { rawOutput: { structuredContent: { text: { annotations: { start_index: number; end_index: number; url_citation: { title: string; url: string } }[] } }; content: string } }).rawOutput;
  for (const annotation of raw.structuredContent.text.annotations) { annotation.start_index--; annotation.end_index--; }
  raw.structuredContent.text.annotations.push({ start_index: 99999, end_index: 100000, url_citation: { title: 'Unsafe', url: 'javascript:alert(1)' } });
  raw.content = JSON.stringify(raw.structuredContent); data.resultOutput = raw.content;
  const f = fixture(data);
  try {
    const answer = f.card.querySelector('.card-plugin-body [data-output-kind="result"]')!;
    assert.match(answer.textContent!, /😀 See the documentation/);
    assert.equal(answer.querySelectorAll('a[href="https://example.test/docs"]').length, 2);
    assert.equal(f.card.querySelector('a[href^="javascript:"]'), null);
  } finally { f.close(); }
  const broken = searchData();
  const output = (broken.native as { rawOutput: { structuredContent: { text: { annotations: unknown[] } }; content: string } }).rawOutput;
  output.structuredContent.text.annotations = [{ start_index: 0, end_index: 5, url_citation: { title: 'Known source', url: 'https://example.test/source' } }];
  output.content = JSON.stringify(output.structuredContent); broken.resultOutput = output.content;
  const literal = fixture(broken);
  try { assert.ok(literal.card.querySelector('.card-plugin-body [data-output-kind="result"]')!.textContent!.includes(firstMarker)); }
  finally { literal.close(); }
});

test('fetch renders Markdown with web-relative links, reported redirects and visible partial-content notices', () => {
  const requested = 'https://example.test/old', final = 'https://example.test/docs/page';
  const content = `Contents of ${final} (redirected from ${requested}):\n# Page\n\n[Next](next) [Root](/reference) [Local](file:///tmp/not-a-web-link)\n\n<note>Content truncated. Call the fetch tool with a start_index of 4000 to get more content.</note>`;
  const data = nativeData('fetch', { url: requested, start_index: 2000 }, { content, detailedContent: content });
  const f = fixture(data);
  try {
    assert.equal(bundledAcpPlugin(data).id, 'nimrod.acp.copilot-fetch');
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Fetch');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'example.test/old · from character 2000');
    const body = f.card.querySelector('.card-plugin-body [data-output-kind="result"]')!;
    assert.equal(body.querySelector('h1')?.textContent, 'Page');
    assert.deepEqual([...body.querySelectorAll('a')].map(a => a.getAttribute('href')), ['https://example.test/docs/next', 'https://example.test/reference', null]);
    assert.equal(f.card.querySelector('[data-output-kind="fetch-redirect"] a')?.getAttribute('href'), final);
    assert.match(f.card.querySelector('[data-output-kind="fetch-partial"]')!.textContent!, /Partial content.*start_index of 4000/);
    assert.equal(f.card.querySelector('.tool-raw-output [data-output-kind="result"] pre')?.textContent, content);
  } finally { f.close(); }
});

test('raw fetched source stays literal, failures are readable, and unrecognized content stays unchanged', () => {
  const url = 'https://example.test/source.ts', code = '<script>literal code</script>\n[not a link](https://example.test)';
  const content = `Content type text/plain; charset=utf-8 cannot be simplified to markdown. Here is the raw content:\nContents of ${url}:\n${code}`;
  const plain = fixture(nativeData('fetch', { url }, { content, detailedContent: content }));
  try {
    assert.equal(plain.card.querySelector('.card-plugin-body .tool-output')?.textContent, code);
    assert.equal(plain.card.querySelector('.card-plugin-body script, .card-plugin-body a'), null);
    assert.equal(plain.card.querySelector('.card-plugin-body .tool-label')?.textContent, 'Raw content');
  } finally { plain.close(); }
  const failed = fixture(nativeData('fetch', { url }, { code: 'failure', message: 'Failed to fetch — status code 404' }, true));
  try {
    assert.equal(failed.card.querySelector('.card-plugin-body .tool-label')?.textContent, 'Error');
    assert.equal(failed.card.querySelector('.card-plugin-body .tool-output')?.textContent, 'Failed to fetch — status code 404');
    assert.ok(failed.card.querySelector('.tool-card-failed'));
    assert.match(failed.card.querySelector('.tool-raw-output pre')!.textContent!, /"code": "failure"/);
  } finally { failed.close(); }
  const unknown = fixture(nativeData('fetch', { url }, { content: '<script>unknown shape</script>', detailedContent: 'keep all metadata' }));
  try { assert.equal(unknown.card.querySelector('.card-plugin-body .tool-output')?.textContent, '<script>unknown shape</script>'); }
  finally { unknown.close(); }
});

test('malformed/foreign searches and fetches retain generic output instead of guessing a web schema', () => {
  const sql = fixture({ source, kind: 'other', title: 'SQL query', arguments: { query: 'SELECT 1', database: 'fixture' }, resultOutput: 'one row', toolStatus: 'result' });
  try { assert.equal(sql.card.querySelector('.tool-card-title')?.textContent, 'SQL query'); }
  finally { sql.close(); }
  const invalid = fixture({ source, kind: 'fetch', title: 'Unknown fetch', arguments: { url: 'javascript:alert(1)' } });
  try { assert.equal(invalid.card.querySelector('.tool-card-title')?.textContent, 'Unknown fetch'); }
  finally { invalid.close(); }
  assert.equal(bundledAcpPlugin({ source: { backend: 'acp', agent: 'another-agent' }, kind: 'fetch' }).id, 'nimrod.acp.tool');
  const data = nativeData('search', { query: 'query' }, { structuredContent: { unexpected: true }, content: 'unknown response' });
  const malformed = fixture(data);
  try { assert.equal(malformed.card.querySelector('.card-plugin-body .tool-output')?.textContent, 'unknown response'); }
  finally { malformed.close(); }
});

test('web link policy changes invalidate only the rendered content while preserving keyed output and focus', () => {
  const plugin = definePresentationPlugin<ToolCardData>({ id: 'fixture.web', supports: () => true, mount: () => ({ update: data => ({ title: 'Fixture', sections: [{ key: 'result', label: 'Body', text: '[Next](next)', format: 'markdown', webLinks: data.name !== 'local', ...(data.name !== 'local' ? { baseUrl: String(data.arguments) } : {}) }] }), dispose() {} }) });
  const data: ToolCardData = { arguments: 'https://example.test/one/', resultOutput: 'raw', toolStatus: 'result' };
  const f = fixture(data, plugin);
  try {
    f.card.open = true;
    const output = f.card.querySelector<HTMLElement>('.card-plugin-body .tool-output')!; output.focus();
    updateToolCard(f.doc, f.card, { ...data, arguments: 'https://example.test/two/' });
    assert.equal(f.card.querySelector('.card-plugin-body .tool-output'), output);
    assert.equal(f.doc.activeElement, output);
    assert.equal(output.querySelector('a')?.getAttribute('href'), 'https://example.test/two/next');
    const anchor = output.querySelector('a'); updateToolCard(f.doc, f.card, { ...data, arguments: 'https://example.test/two/' });
    assert.equal(output.querySelector('a'), anchor, 'lifecycle-only updates do not rebuild Markdown');
    updateToolCard(f.doc, f.card, { ...data, name: 'local' });
    assert.equal(output.querySelector('a')?.getAttribute('href'), 'next', 'ordinary local Markdown keeps its existing relative-link semantics');
    assert.equal(output.classList.contains('tool-output-web-markdown'), false, 'ordinary Markdown styling is unchanged');
  } finally { f.close(); }
});

test('public web components bundle externally and reject unsafe link policies', async () => {
  assert.equal(webUrl('javascript:alert(1)'), undefined);
  assert.equal(webUrl('https://user:password@example.test/'), undefined);
  assert.equal(displayWebUrl('http://example.test/path'), 'http://example.test/path');
  assert.throws(() => validatePresentation({ title: 'bad', sections: [{ key: 'x', label: 'x', text: 'x', format: 'text', webLinks: true }] }));
  const bundle = await build({ stdin: { contents: `export { webSearchPresentation, webFetchPresentation } from './src/card-plugin-ui';`, resolveDir: process.cwd() }, bundle: true, platform: 'browser', format: 'esm', write: false });
  const external = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  assert.equal(external.webFetchPresentation({ url: 'https://example.test/path', sections: [] }).preview, 'example.test/path');
  assert.equal(external.webSearchPresentation({ query: 'fixture', sections: [] }).title, 'Web search');
});
