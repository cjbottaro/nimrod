import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import type { ToolCardData } from '../src/card-plugin-api';
import { createPatchPresentation } from '../src/copilot/patch-card';
import { copilotToolResult } from '../src/copilot/tool-result';
import { validatePresentation } from '../src/pi/card-renderer';
import { namedToolPresentation } from '../src/card-plugin-ui';
import { CardPluginCatalog } from '../src/pi/card-plugins/catalog';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';

// Scrubbed/minimized native shapes observed in local CLI 1.0.98 transcript logs:
// arguments is a patch STRING, not { patch: ... }; result has summary + Git diff.
const patch = '*** Begin Patch\n*** Update File: /fixture/src/example.ts\n@@\n-old\n+new\n*** End Patch\n';
const diff = '\ndiff --git a/fixture/src/example.ts b/fixture/src/example.ts\nindex 0000000..0000000 100644\n--- a/fixture/src/example.ts\n+++ b/fixture/src/example.ts\n@@ -1 +1 @@\n-old\n+new\n';
const result = { content: 'Modified 1 file(s): /fixture/src/example.ts', detailedContent: diff };
function completed(): ToolCardData {
  return { source: { backend: 'copilot-sdk', agent: 'Copilot' }, name: 'apply_patch', title: 'Applying patch', kind: 'edit',
    arguments: patch, toolStatus: 'result', resultOutput: copilotToolResult(result), native: {
      'tool.execution_start': { toolName: 'apply_patch', toolTitle: 'Applying patch', arguments: patch },
      'tool.execution_complete': { success: true, result, fileEdits: [{ kind: 'edit', path: '/fixture/src/example.ts' }] },
    } };
}
function fixture(data = completed()) {
  const dom = new JSDOM('<body></body>'), doc = dom.window.document;
  const card = renderToolCard(doc, data, doc.createElement('details'), undefined, undefined, { projectDirectory: '/fixture' }); doc.body.append(card);
  return { doc, card, close() { disposeToolCard(card); dom.window.close(); } };
}
const output = (card: HTMLElement) => card.querySelector<HTMLElement>('.card-plugin-body [data-output-kind="patch"] .tool-output');
const body = (card: HTMLElement) => card.querySelector<HTMLElement>('.card-plugin-body')!;

test('native apply_patch shows project-relative summary, reported diff and concise result with exact raw recovery', () => {
  const data = completed(), f = fixture(data);
  try {
    assert.equal(new CardPluginCatalog().select(data).id, 'nimrod.copilot.tool');
    assert.equal(f.card.querySelector('.tool-card-title')?.textContent, 'Apply patch');
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, 'src/example.ts');
    assert.equal(f.card.querySelector('.tool-card-diff-stats .hljs-addition')?.textContent, '+1');
    assert.equal(f.card.querySelector('.tool-card-diff-stats .hljs-deletion')?.textContent, '−1');
    assert.match(f.card.querySelector('summary')!.getAttribute('aria-label')!, /1 line added, 1 line removed/);
    assert.match(body(f.card).textContent!, /Applied patch/);
    assert.equal(output(f.card)?.textContent, diff + '\n');
    assert.equal(body(f.card).querySelector('[data-output-kind="result"] .tool-output')?.textContent, result.content);
    assert.equal(f.card.querySelector('.tool-raw-output pre')?.textContent, data.resultOutput);
    assert.equal(f.card.querySelector('.tool-raw-inputs pre')!.textContent, patch);
    assert.ok(f.card.querySelector('.card-plugin-body + .tool-raw-inputs'));
    assert.equal(f.card.querySelector('[title]'), null);
  } finally { f.close(); }
});

test('requested → reported patch retains shell, viewport, focus and raw disclosure', () => {
  const data = completed(), f = fixture({ ...data, name: undefined, arguments: '*** Begin Patch\n', native: undefined, resultOutput: undefined, toolStatus: 'running', uiPhase: 'thinking' });
  try {
    const retainedBody = body(f.card), raw = f.card.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!;
    f.card.open = true; raw.open = true;
    const running: ToolCardData = { ...data, toolStatus: 'running', resultOutput: undefined, native: { 'tool.execution_start': { arguments: patch } } };
    updateToolCard(f.doc, f.card, running);
    const viewport = output(f.card)!, stats = f.card.querySelector('.tool-card-diff-stats')!;
    assert.equal(viewport.textContent, patch + '\n'); assert.match(body(f.card).textContent!, /Requested patch/);
    viewport.focus(); viewport.scrollTop = 12;
    updateToolCard(f.doc, f.card, data);
    assert.equal(body(f.card), retainedBody); assert.equal(output(f.card), viewport);
    assert.equal(f.card.querySelector('.tool-card-diff-stats'), stats);
    assert.equal(f.doc.activeElement, viewport); assert.equal(viewport.textContent, diff + '\n');
    assert.equal(f.card.querySelector('.tool-raw-inputs'), raw); assert.equal(raw.open, true); assert.equal(f.card.open, true);
    const rawOutput = f.card.querySelector<HTMLDetailsElement>('.tool-raw-output')!; rawOutput.open = true;
    const diffNode = viewport.firstChild;
    updateToolCard(f.doc, f.card, { ...data, title: 'late native title' });
    assert.equal(viewport.firstChild, diffNode); assert.equal(f.card.querySelector('.tool-raw-output'), rawOutput); assert.equal(rawOutput.open, true);
  } finally { f.close(); }
});

test('failed, stopped, running, mismatched and unconfirmed results never claim an applied patch', () => {
  const base = completed();
  const error = { message: 'Failed to find expected lines', code: 'PATCH_FAILED' };
  for (const data of [
    { ...base, isError: true, resultOutput: JSON.stringify(error, null, 2), native: { 'tool.execution_complete': { success: false, error } } },
    { ...base, uiPhase: 'stopped' as const },
    { ...base, uiPhase: 'thinking' as const },
    { ...base, toolStatus: 'running' as const },
    { ...base, resultOutput: 'independent output' },
    { ...base, native: undefined },
    { ...base, native: { 'tool.execution_complete': { success: false, result } } },
  ]) {
    const f = fixture(data);
    try {
      assert.doesNotMatch(body(f.card).textContent!, /Applied patch/);
      assert.equal(output(f.card)?.textContent, patch + '\n');
      if (data.isError) {
        assert.match(body(f.card).textContent!, /Failed to find expected lines/);
        assert.equal(f.card.querySelector('.tool-raw-output pre')?.textContent, data.resultOutput);
      }
    } finally { f.close(); }
  }
});

test('add/delete/move and multiple-file summaries stay literal; incomplete/unknown envelopes stay raw', () => {
  const present = createPatchPresentation();
  const request = '*** Begin Patch\n*** Add File: /fixture/new.txt\n+<script>literal</script>\n*** Delete File: /outside/old.txt\n*** Update File: /fixture/before.txt\n*** Move to: /fixture/after.txt\n@@\n-a\n+b\n*** End Patch\n';
  const value = present({ arguments: request }, '/fixture', []);
  assert.equal(value.preview, '3 files');
  assert.equal(value.diffStats, undefined, 'delete requests do not include the removed contents');
  assert.equal(value.sections[0].text, request); assert.equal(value.sections[0].format, 'diff');
  for (const arguments_ of ['*** Begin Patch\n*** Add File: /fixture/new.txt\n+partial', {}, { patch }, 'not a patch', '*** Begin Patch\n*** Unknown: file\n*** End Patch', '*** Begin Patch\n*** End Patch']) {
    assert.deepEqual(present({ arguments: arguments_ }, '/fixture', []).sections, []);
  }
  assert.equal(present({ arguments: patch.replace('/fixture/src/example.ts', '/outside/file.ts') }, '/fixture', []).preview, '/outside/file.ts');
  const f = fixture({ ...completed(), arguments: request, native: undefined });
  try { assert.equal(output(f.card)?.textContent, request + '\n'); assert.equal(f.card.querySelector('script'), null); }
  finally { f.close(); }
});

test('success without a recognized detailed diff keeps requested preview and literal native output', () => {
  for (const nativeResult of [{ content: 'Modified file' }, { content: 'Modified file', detailedContent: 'unrecognized details' }]) {
    const data = { ...completed(), resultOutput: copilotToolResult(nativeResult), native: { 'tool.execution_complete': { success: true, result: nativeResult } } };
    const f = fixture(data);
    try { assert.equal(output(f.card)?.textContent, patch + '\n'); assert.doesNotMatch(body(f.card).textContent!, /Applied patch/); assert.ok(body(f.card).textContent!.includes(data.resultOutput)); }
    finally { f.close(); }
  }
});

test('reported diffs preserve independent live output and do not duplicate details when a summary is absent', () => {
  const onlyDiff = { detailedContent: diff };
  const data = { ...completed(), executionOutput: 'independent live output', resultOutput: copilotToolResult(onlyDiff),
    native: { 'tool.execution_complete': { success: true, result: onlyDiff } } };
  const f = fixture(data);
  try {
    assert.equal(output(f.card)?.textContent, diff + '\n');
    assert.equal(body(f.card).querySelector('[data-output-kind="execution"] .tool-output')?.textContent, data.executionOutput);
    assert.equal(body(f.card).querySelector('[data-output-kind="result"]'), null);
  } finally { f.close(); }
  const other = createPatchPresentation();
  assert.deepEqual(other({}, '/fixture', []).sections, [], 'new mounts do not inherit another request');
});

test('multi-file requests show only a file count, with separate colored line stats', () => {
  const request = '*** Begin Patch\n' + Array.from({ length: 6 }, (_, index) => `*** Update File: /fixture/file${index}.ts\n@@\n-old\n+new\n`).join('') + '*** End Patch\n';
  const f = fixture({ ...completed(), arguments: request, toolStatus: 'running', native: undefined, resultOutput: undefined });
  try {
    assert.equal(f.card.querySelector('.tool-card-preview')?.textContent, '6 files');
    assert.equal(f.card.querySelector('.tool-card-diff-stats .hljs-addition')?.textContent, '+6');
    assert.equal(f.card.querySelector('.tool-card-diff-stats .hljs-deletion')?.textContent, '−6');
    assert.doesNotMatch(f.card.querySelector('.card-plugin-summary')!.textContent!, /file0|paths/);
    const stats = f.card.querySelector('.tool-card-diff-stats')!;
    updateToolCard(f.doc, f.card, { ...completed(), arguments: request, toolStatus: 'running', native: undefined, resultOutput: undefined });
    assert.equal(f.card.querySelector('.tool-card-diff-stats'), stats);
    updateToolCard(f.doc, f.card, { ...completed(), name: 'unknown', native: undefined });
    assert.equal(f.card.querySelector('.tool-card-diff-stats'), null);
  } finally { f.close(); }
});

test('line counts distinguish requested edits from reported hunks, excluding headers/context/newline markers', () => {
  const present = createPatchPresentation();
  assert.deepEqual(present({ arguments: patch }, '/fixture', []).diffStats, { added: 1, removed: 1 });
  const detailed = 'diff --git a/old b/new\n--- a/old\n+++ b/new\n@@ -1,2 +1,3 @@\n context\n-old\n+++new\n+another\n\\ No newline at end of file\n';
  assert.deepEqual(present({ arguments: patch }, '/fixture', [], detailed).diffStats, { added: 2, removed: 1 });
  const deletion = '*** Begin Patch\n*** Delete File: /fixture/old.txt\n*** End Patch\n';
  assert.equal(present({ arguments: deletion }, '/fixture', []).diffStats, undefined);
  assert.deepEqual(present({ arguments: deletion }, '/fixture', [], 'diff --git a/old b/old\n--- a/old\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-old\n-another\n').diffStats, { added: 0, removed: 2 });
  const moved = '*** Begin Patch\n*** Update File: /fixture/before.ts\n*** Move to: /fixture/after.ts\n@@\n-old\n+new\n*** End Patch\n';
  assert.equal(present({ arguments: moved }, '/fixture', []).preview, 'after.ts');
  assert.equal(present({ arguments: patch }, '/fixture', [], detailed.replace('+another\n', '')).diffStats, undefined, 'incomplete hunks do not fall back to requested counts');
  assert.equal(present({ arguments: patch }, '/fixture', [], 'diff --git a/old b/old\nBinary files a/old and b/old differ\n').diffStats, undefined);
  const binary = fixture({ ...completed(), resultOutput: 'unknown', native: undefined, arguments: deletion });
  try { assert.equal(binary.card.querySelector('.tool-card-diff-stats'), null); }
  finally { binary.close(); }
});

test('public line stats validate safe counts, including zero, and reject malformed values', () => {
  assert.deepEqual(validatePresentation(namedToolPresentation({ title: 'Edit', diffStats: { added: 0, removed: 2 }, sections: [] })).diffStats, { added: 0, removed: 2 });
  for (const diffStats of [null, {}, { added: -1, removed: 0 }, { added: 1.5, removed: 0 }, { added: '1', removed: 0 }, { added: 0, removed: Infinity }, { added: 0, removed: Number.MAX_SAFE_INTEGER + 1 }]) {
    assert.throws(() => validatePresentation({ title: 'Edit', diffStats, sections: [] } as never), /Invalid card presentation/);
  }
});

test('SDK-only exact tool recognition excludes MCP names and unknown agents', () => {
  const base = completed();
  for (const data of [
    { ...base, source: undefined },
    { ...base, source: { backend: 'acp' as const, agent: 'Copilot' } },
    { ...base, source: { backend: 'copilot-sdk' as const, agent: 'unknown' } },
    { ...base, name: 'custom_apply_patch' },
    { ...base, native: { 'tool.execution_start': { mcpServerName: 'fixture', mcpToolName: 'apply_patch' } } },
    { ...base, native: { 'tool.execution_start': { mcpToolName: 'apply_patch' } } },
  ]) {
    const f = fixture(data);
    try { assert.equal(output(f.card), null); assert.notEqual(f.card.querySelector('.tool-card-title')?.textContent, 'Apply patch'); }
    finally { f.close(); }
  }
});
