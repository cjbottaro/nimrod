import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from 'esbuild';
import plugin, { argumentsRecord, httpUrl, sourceLinks, responseIds, requestDescription } from '../plugins/pi-web-access';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import { createSafeMarkdownRenderer } from '../src/pi/safe-markdown';
import { searchText, fetchedText, storedText, checkText } from './fixtures/pi-web-access';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };
function fixture() {
  const dom = new JSDOM('<body></body>', { pretendToBeVisual: true }); const doc = dom.window.document;
  const copied: string[] = []; const opened: string[] = []; const popped: { text: string; language?: string }[] = [];
  const markdown = createSafeMarkdownRenderer(dom.window as unknown as Window);
  return { dom, doc, copied, opened, popped, host: {
    markdown: (source: string) => { const node = doc.createElement('div'); node.innerHTML = markdown.render(source); return node; },
    copy: async (text: string) => { copied.push(text); }, openLink: async (href: string) => { opened.push(href); },
    popOutCode: async (text: string, language?: string) => { popped.push({ text, language }); },
  } };
}

test('external source bundles standalone and metadata matches the four default pi-web-access tools', async () => {
  const result = await build({ entryPoints: ['plugins/pi-web-access.ts'], bundle: true, platform: 'browser', format: 'esm', write: false });
  assert.ok(result.outputFiles[0].text.includes('nimrod-plugins.pi-web-access')); assert.doesNotMatch(result.outputFiles[0].text, /from.*card-plugin-api/);
  assert.deepEqual(plugin.tools, ['web_search', 'fetch_content', 'get_search_content', 'source_check']);
  assert.equal(plugin.supports({ name: 'functions.web_search' }), true); assert.equal(plugin.supports({ name: 'web_enable' }), false);
});

test('arguments preserve complete top-level generation strings without guessing nested or incomplete values', () => {
  assert.deepEqual(argumentsRecord('{"query":"completed query","provider":'), { query: 'completed query' });
  assert.deepEqual(argumentsRecord('{"nested":{"query":"not top-level"}'), {});
  assert.deepEqual(argumentsRecord('{"query":"unfinished'), {});
  assert.equal(argumentsRecord('{"query":"escaped \\" quote",').query, 'escaped " quote');
  assert.equal(requestDescription('web_search', { queries: ['one', 'two'], provider: ['exa', 'brave'] }).preview, 'one · +1 more');
  assert.ok(requestDescription('web_search', { query: 'one', proxy: 'secret' }).lines.every(line => !line.includes('secret')));
  assert.ok(requestDescription('get_search_content', { responseId: 'stored', findText: ['one', 'two'], offset: 10 }).lines.includes('offset: 10'));
});

test('source parsing reflects retained link entries and queries, not total provider counts or arbitrary fetch prose', () => {
  assert.equal(sourceLinks(searchText, 'web_search').links.length, 3);
  assert.equal(sourceLinks(searchText, 'web_search').links[2].group, 'TypeScript cache');
  assert.equal(sourceLinks(storedText, 'get_search_content').links[0].title, 'DOM lifecycle guide');
  assert.equal(sourceLinks(checkText, 'source_check').links[0].title, '[primary] Original specification');
  assert.equal(sourceLinks(storedText, 'fetch_content').links.length, 0);
  assert.equal(sourceLinks('1. clipped\nhttps://example.test/part\n\n---\n[Output truncated.]\n', 'web_search').links.length, 0);
  const many = Array.from({ length: 205 }, (_, i) => `${i + 1}. Source ${i}\nhttps://example.test/${i}`).join('\n');
  assert.equal(sourceLinks(many, 'web_search').links.length, 200); assert.equal(sourceLinks(many, 'web_search').limited, true);
  assert.deepEqual(responseIds(searchText, {}), ['search_fixture']); assert.deepEqual(responseIds(checkText, {}), ['research_fixture']);
  assert.deepEqual(responseIds(fetchedText, { responseId: 'current' }), ['current', 'fetch_fixture']);
  for (const bad of ['javascript:alert(1)', 'command:execute', 'file:///tmp/file', 'https://user:secret@example.test', 'https://example.test/a b']) assert.equal(httpUrl(bad), undefined);
});

test('search card mounts purpose-built sources/actions with stable nodes, disclosure, raw recovery and exact clipboard snapshots', async () => {
  const f = fixture();
  try {
    const data = { name: 'web_search', arguments: { queries: ['TypeScript DOM plugins', 'TypeScript cache'] }, toolStatus: 'running' as const, executionOutput: 'Searching "TypeScript DOM plugins" (0/2 complete)...' };
    const card = renderToolCard(f.doc, data, f.doc.createElement('details'), plugin, undefined, f.host); f.doc.body.append(card); card.open = true;
    const spinner = card.querySelector('.tool-card-spinner');
    updateToolCard(f.doc, card, { ...data, executionOutput: 'Completed 1/2 searches.' }); assert.equal(card.querySelector('.tool-card-spinner'), spinner);
    updateToolCard(f.doc, card, { ...data, toolStatus: 'result', resultOutput: searchText });
    assert.equal(card.open, true); assert.equal(card.querySelectorAll('[aria-label="Web access source links"] a').length, 3); assert.match(card.textContent || '', /3 links shown/);
    assert.match(card.querySelector('.tool-raw-output')?.textContent || '', /search_fixture/);
    const source = card.querySelector<HTMLAnchorElement>('[aria-label="Web access source links"] a')!;
    source.click(); await flush(); assert.deepEqual(f.opened, ['https://docs.example.test/dom']);
    const buttons = () => Array.from(card.querySelectorAll<HTMLButtonElement>('.pi-web-access button'));
    const copy = buttons().find(button => button.textContent === 'Copy returned text')!; copy.focus(); copy.click(); await flush();
    assert.equal(f.copied.at(-1), searchText); assert.equal(f.doc.activeElement, copy);
    buttons().find(button => button.textContent === 'Copy response ID')!.click(); await flush(); assert.equal(f.copied.at(-1), 'search_fixture');
    buttons().find(button => button.textContent === 'Pop out returned text')!.click(); await flush(); assert.deepEqual(f.popped, [{ text: searchText, language: 'markdown' }]);
    updateToolCard(f.doc, card, { ...data, toolStatus: 'result', resultOutput: `${searchText}\nAdded context.` });
    assert.equal(card.querySelector('[aria-label="Web access source links"] a'), source); assert.equal(card.open, true);
    disposeToolCard(card); source.click(); await flush(); assert.equal(f.opened.length, 1);
  } finally { f.dom.window.close(); }
});

test('fetch/readable and stored/source-check cards use safe Markdown, while raw mode is literal and no relative link targets the project', async () => {
  const f = fixture();
  try {
    const readable = renderToolCard(f.doc, { name: 'fetch_content', arguments: { url: 'https://docs.example.test/guide/' }, toolStatus: 'result', resultOutput: `${fetchedText}\n<script>bad</script>\n[bad](javascript:alert%281%29)` }, f.doc.createElement('details'), plugin, undefined, f.host); f.doc.body.append(readable);
    assert.equal(readable.querySelector('.pi-web-access script'), null);
    const relative = Array.from(readable.querySelectorAll<HTMLAnchorElement>('.pi-web-access a')).find(anchor => anchor.textContent === 'local guidance')!;
    assert.equal(relative.getAttribute('href'), 'https://docs.example.test/guide/next'); relative.click(); await flush(); assert.equal(f.opened.at(-1), 'https://docs.example.test/guide/next');
    const raw = renderToolCard(f.doc, { name: 'fetch_content', arguments: { url: 'https://example.test', mode: 'raw' }, toolStatus: 'result', resultOutput: '<script>literal</script>\n# Not a heading' }, f.doc.createElement('details'), plugin, undefined, f.host);
    assert.equal(raw.querySelector('.pi-web-access script, .pi-web-access h1'), null); assert.match(raw.querySelector('.pi-web-access pre')?.textContent || '', /<script>literal/);
    const stored = renderToolCard(f.doc, { name: 'get_search_content', arguments: { responseId: 'stored', findText: 'lifecycle' }, toolStatus: 'result', resultOutput: storedText }, f.doc.createElement('details'), plugin, undefined, f.host);
    assert.equal(stored.querySelectorAll('[aria-label="Web access source links"] a').length, 2); assert.match(stored.textContent || '', /findText: lifecycle/);
    const check = renderToolCard(f.doc, { name: 'source_check', arguments: { claim: 'Example claim' }, toolStatus: 'result', resultOutput: checkText }, f.doc.createElement('details'), plugin, undefined, f.host);
    assert.match(check.textContent || '', /needs_review/); assert.match(check.textContent || '', /Example claim/);
  } finally { f.dom.window.close(); }
});

test('running progress is plain and compact with no rich hidden layout or duplicate raw output', () => {
  const f = fixture();
  try {
    const data = { name: 'web_search', arguments: { query: 'fixture' }, toolStatus: 'running' as const, executionOutput: 'Searching fixture...' };
    const card = renderToolCard(f.doc, data, f.doc.createElement('details'), plugin, undefined, f.host); f.doc.body.append(card); card.open = true;
    const progress = card.querySelector<HTMLElement>('.card-plugin-body > .tool-section .tool-output')!;
    assert.equal(progress.tagName, 'PRE'); assert.equal(progress.textContent, 'Searching fixture...');
    assert.equal(card.querySelector('.pi-web-access'), null); assert.equal(card.querySelector('.tool-raw-output'), null);
    assert.equal(card.querySelectorAll('.tool-output').length, 1);
    updateToolCard(f.doc, card, { ...data, executionOutput: 'Completed 1/2 queries.' });
    assert.equal(card.querySelector('.card-plugin-body > .tool-section .tool-output'), progress); assert.equal(card.open, true);
    updateToolCard(f.doc, card, { ...data, toolStatus: 'result', resultOutput: searchText });
    assert.ok(card.querySelector('.pi-web-access')); assert.equal(card.querySelector('.card-plugin-body > .tool-section'), null);
    assert.equal(card.open, true); assert.match(card.querySelector('.tool-raw-output')?.textContent || '', /search_fixture/);
  } finally { f.dom.window.close(); }
});

test('registered source/content viewports retain independent inspection and source controls through updates', () => {
  const f = fixture();
  try {
    const data = { name: 'web_search', arguments: { query: 'fixture' }, toolStatus: 'finished' as const, executionOutput: searchText };
    const card = renderToolCard(f.doc, data, f.doc.createElement('details'), plugin, undefined, f.host); f.doc.body.append(card); card.open = true;
    const sources = card.querySelector<HTMLElement>('[aria-label="Web access source links"]')!;
    const output = card.querySelector<HTMLElement>('[aria-label="Web access returned content"]')!;
    for (const node of [sources, output]) Object.defineProperties(node, { clientHeight: { value: 100 }, scrollHeight: { value: 700 } });
    sources.scrollTop = 45; output.scrollTop = 180; const link = sources.querySelector('a');
    updateToolCard(f.doc, card, { ...data, toolStatus: 'result', resultOutput: `${searchText}\nFinal context` });
    assert.equal(sources.scrollTop, 45); assert.equal(output.scrollTop, 180); assert.equal(sources.querySelector('a'), link);
    assert.ok(sources.classList.contains('tool-output-final')); assert.ok(output.classList.contains('tool-output-final')); assert.equal(card.open, true);
  } finally { f.dom.window.close(); }
});

test('reference-control limits are visible and duplicated partial keys do not fail the renderer', () => {
  assert.equal(argumentsRecord('{"query":"first","query":"latest",').query, 'latest');
  const f = fixture();
  try {
    const text = Array.from({ length: 40 }, (_, i) => `Full search results are stored as responseId "ref_${i}".`).join('\n');
    const card = renderToolCard(f.doc, { name: 'web_search', resultOutput: text, toolStatus: 'result' }, f.doc.createElement('details'), plugin, undefined, f.host);
    assert.equal(Array.from(card.querySelectorAll('button')).filter(button => button.textContent === 'Copy response ID').length, 32);
    assert.match(card.textContent || '', /First 32 response IDs/); assert.match(card.querySelector('.tool-raw-output')?.textContent || '', /ref_39/);
  } finally { f.dom.window.close(); }
});

test('failure/empty/malformed output still has readable literal content without fabricated source/progress totals', () => {
  const f = fixture();
  try {
    const card = renderToolCard(f.doc, { name: 'web_search', arguments: '{bad', toolStatus: 'result', isError: true, resultOutput: 'Error: quota exhausted' }, f.doc.createElement('details'), plugin, undefined, f.host);
    assert.equal(card.querySelectorAll('[aria-label="Web access source links"] a').length, 0); assert.match(card.textContent || '', /quota exhausted/); assert.match(card.querySelector('summary')?.getAttribute('aria-label') || '', /failed/);
    assert.equal(card.querySelector('summary [title]'), null);
  } finally { f.dom.window.close(); }
});
