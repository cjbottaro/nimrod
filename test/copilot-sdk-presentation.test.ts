import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { CopilotSession } from '../src/copilot/session';
import { copilotPermissionPreview } from '../src/copilot/permission-presentation';
import { copilotToolResult } from '../src/copilot/tool-result';
import { toolMessageBlock } from '../src/pi/tool-call';
import { renderToolCard, updateToolCard, disposeToolCard } from '../src/pi/tool-card';
import type { ToolCardData } from '../src/card-plugin-api';

const source = { backend: 'copilot-sdk' as const, agent: 'copilot' };
function card(data: ToolCardData) {
  const dom = new JSDOM('<body></body>');
  const details = renderToolCard(dom.window.document, data, dom.window.document.createElement('details'), undefined, undefined, { projectDirectory: '/project' });
  dom.window.document.body.append(details);
  return { dom, details, close() { disposeToolCard(details); dom.window.close(); } };
}

test('SDK read/shell/URL/MCP permission requests have compact native previews and closed complete raw details', () => {
  const dom = new JSDOM();
  try {
    for (const [request, summary, content] of [
      [{ kind: 'read', path: '/project/src/file.ts', intention: 'Read fixture', toolCallId: 'read' }, 'Read file · src/file.ts', undefined],
      [{ kind: 'read', path: '/project/test', intention: 'Search in directory: /project/test' }, 'Search directory · test', undefined],
      [{ kind: 'read', path: '/project/src/file.ts', intention: 'Search in file: /project/src/file.ts' }, 'Search file · src/file.ts', undefined],
      [{ kind: 'read', path: '/outside/file.ts' }, 'Read file · /outside/file.ts', undefined],
      [{ kind: 'shell', fullCommandText: 'printf "<script>literal</script>"\n', intention: 'Inspect fixture' }, 'Run command · Inspect fixture', 'printf "<script>literal</script>"\n'],
      [{ kind: 'url', url: 'https://example.test/docs', intention: 'Fetch content from this URL.' }, 'Fetch · example.test/docs', undefined],
      [{ kind: 'mcp', serverName: 'fixture', toolName: 'lookup', args: { query: 'value' } }, 'MCP tool · fixture · lookup', '{\n  "query": "value"\n}'],
      [{ kind: 'write', fileName: '/project/new.ts', diff: '+requested change' }, 'Edit file · new.ts', '+requested change'],
    ] as const) {
      const preview = copilotPermissionPreview(dom.window.document, request, '/project');
      assert.equal(preview.querySelector('.acp-permission-summary')?.textContent, summary);
      if (content !== undefined) assert.equal(preview.querySelector('.acp-permission-command')?.textContent, content);
      const raw = preview.querySelector<HTMLDetailsElement>('.acp-permission-raw')!;
      assert.equal(raw.open, false); assert.deepEqual(JSON.parse(raw.querySelector('pre')!.textContent!), request);
      assert.equal(preview.querySelector('button, a, script'), null, 'presentation owns no choices, execution or navigation');
    }
    const elevated = copilotPermissionPreview(dom.window.document, { kind: 'url', url: 'https://example.test/', requestSandboxBypass: true, requestSandboxBypassReason: 'Reported sandbox restriction', managedApprovalRequired: true });
    assert.match(elevated.textContent!, /Requests sandbox bypass/); assert.match(elevated.textContent!, /Reported sandbox restriction/);
    assert.match(elevated.textContent!, /Explicit approval required/);
    const unknown = copilotPermissionPreview(dom.window.document, { kind: 'future-scope', details: 'must remain prominent' });
    assert.match(unknown.querySelector('.acp-permission-command')!.textContent!, /must remain prominent/);
  } finally { dom.window.close(); }
});

test('all observed SDK tool families show native completion.error.message once and retain exact raw errors', () => {
  const error = { code: 'failure', message: 'Fixture native error <script>literal</script>' };
  for (const [name, kind, args] of [
    ['view', 'read', { path: '/project/mise.toml' }],
    ['rg', 'search', { pattern: 'fixture', paths: '/project', output_mode: 'content' }],
    ['bash', 'execute', { command: 'printf fixture' }],
    ['web_fetch', 'fetch', { url: 'https://example.test/file' }],
    ['skill', 'other', { skill: 'features' }],
  ] as const) {
    const data: ToolCardData = { source, name, kind, arguments: args, title: name, toolStatus: 'result', isError: true,
      native: { 'tool.execution_complete': { success: false, error } }, resultOutput: JSON.stringify(error, null, 2) };
    const f = card(data);
    try {
      assert.equal(f.details.querySelector('.card-plugin-body [data-output-kind="result"] .tool-label')?.textContent, 'Error');
      assert.equal(f.details.querySelector('.card-plugin-body .tool-output')?.textContent, error.message);
      assert.equal(f.details.querySelector('.tool-raw-output pre')?.textContent, data.resultOutput);
      assert.ok(f.details.querySelector('.tool-card-failed')); assert.equal(f.details.querySelector('script'), null);
      if (name === 'skill') assert.equal(f.details.querySelector('.tool-card-preview')?.textContent, 'features');
    } finally { f.close(); }
  }
});

test('GitHub MCP search uses native server/tool metadata and structured file snippets, not web/SQL query heuristics', () => {
  const result = { content: 'Output too large to read at once (116 KB). Saved to: /fixture/agent-output.txt', detailedContent: 'original full JSON', structuredContent: {
    total_count: 17, incomplete_results: true, items: [
      { name: 'file.ts', path: 'src/file.ts', text_matches: [{ fragment: '<img src=x>\nexact code snippet' }] },
      { name: 'second.ts', path: 'test/second.ts', text_matches: [] },
    ],
  } };
  const data: ToolCardData = { source, name: 'github-mcp-server-search_code', kind: 'other', title: 'Search code', arguments: { query: 'repo:owner/repo fixture', page: 1, perPage: 2 },
    toolStatus: 'result', resultOutput: copilotToolResult(result), native: { 'tool.execution_start': { mcpServerName: 'github-mcp-server', mcpToolName: 'search_code' }, 'tool.execution_complete': { success: true, result } } };
  const f = card(data);
  try {
    assert.equal(f.details.querySelector('.tool-card-title')?.textContent, 'GitHub code search');
    assert.equal(f.details.querySelector('.tool-card-preview')?.textContent, 'repo:owner/repo fixture');
    const output = f.details.querySelector('.card-plugin-body .tool-output')!;
    assert.match(output.textContent!, /2 of 17 results returned/); assert.match(output.textContent!, /Results may be incomplete/); assert.match(output.textContent!, /Agent text preview was clipped/);
    assert.match(output.textContent!, /src\/file.ts\n<img src=x>\nexact code snippet/);
    assert.equal(f.details.querySelector('img'), null);
    assert.equal(f.details.querySelector('.tool-raw-output pre')?.textContent, data.resultOutput);
  } finally { f.close(); }
  const malformed = { ...result, structuredContent: { items: [{ path: 42 }] } };
  const raw = card({ ...data, resultOutput: copilotToolResult(malformed), native: { ...(data.native as object), 'tool.execution_complete': { result: malformed } } });
  try { assert.equal(raw.details.querySelector('.card-plugin-body .tool-output')?.textContent, copilotToolResult(malformed)); }
  finally { raw.close(); }
  const remote = card({ ...data, name: 'github-mcp-server-get_file_contents', arguments: { owner: 'owner', repo: 'repo', path: 'mise.toml' },
    isError: true, resultOutput: JSON.stringify({ message: 'Remote header mismatch' }, null, 2),
    native: { 'tool.execution_start': { mcpServerName: 'github-mcp-server', mcpToolName: 'get_file_contents' }, 'tool.execution_complete': { error: { message: 'Remote header mismatch' } } } });
  try {
    assert.equal(remote.details.querySelector('.tool-card-preview')?.textContent, 'owner/repo/mise.toml');
    assert.equal(remote.details.querySelector('.card-plugin-body .tool-output')?.textContent, 'Remote header mismatch');
  } finally { remote.close(); }
});

test('SDK tool generation and late metadata update one mounted card without rewinding execution or inspected state', () => {
  const session = new CopilotSession(async () => { assert.fail('Rendering must not request agent work'); }, {
    publish() {}, changed() {}, identified() {}, disconnected() {}, completed() {}, notice(message) { assert.fail(message); }, decision: async () => undefined,
  });
  session.receive({ kind: 'connected', sessionId: 'fixture', events: [], models: [], model: {} });
  let sequence = 0;
  const emit = (type: string, data: Record<string, unknown>) => session.receive({ kind: 'event', event: { id: `event-${sequence++}`, type, data } });
  const message = () => session.state.messages.find(row => row.role === 'tool')!;
  emit('assistant.tool_call_delta', { toolCallId: 'one', inputDelta: '{"path":' });
  const f = card(toolMessageBlock(message()));
  try {
    f.details.open = true;
    const body = f.details.querySelector('.card-plugin-body');
    const inputs = f.details.querySelector<HTMLDetailsElement>('.tool-raw-inputs')!; inputs.open = true;
    assert.equal(body?.nextElementSibling, inputs);
    emit('assistant.tool_call_delta', { toolCallId: 'one', toolName: 'view', inputDelta: '"/project/src/file.ts","view_range":[2,4]}' });
    updateToolCard(f.dom.window.document, f.details, toolMessageBlock(message()));
    assert.equal(f.details.querySelector('.tool-card-title')?.textContent, 'Read file');
    assert.equal(f.details.querySelector('.tool-card-preview')?.textContent, 'src/file.ts · lines 2–4');
    assert.equal(message().uiPhase, 'thinking');
    assert.equal(f.details.querySelector('.tool-raw-inputs'), inputs); assert.equal(inputs.open, true);
    assert.equal(body?.nextElementSibling, inputs);
    const args = { path: '/project/src/file.ts', view_range: [2, 4] };
    emit('tool.execution_start', { toolCallId: 'one', toolName: 'view', arguments: args });
    updateToolCard(f.dom.window.document, f.details, toolMessageBlock(message()));
    assert.equal(message().uiPhase, undefined); assert.equal(message().toolStatus, 'running');
    const authoritative = message().toolArguments;
    emit('assistant.tool_call_delta', { toolCallId: 'one', inputDelta: 'late fragment' });
    assert.equal(message().toolArguments, authoritative);
    const result = { content: 'returned file content' };
    emit('tool.execution_complete', { toolCallId: 'one', success: true, result });
    updateToolCard(f.dom.window.document, f.details, toolMessageBlock(message()));
    const output = f.details.querySelector<HTMLElement>('.card-plugin-body .tool-output')!; output.focus();
    emit('tool.execution_start', { toolCallId: 'one', toolName: 'view', toolTitle: 'Late authoritative title', arguments: args });
    updateToolCard(f.dom.window.document, f.details, toolMessageBlock(message()));
    assert.equal(message().toolStatus, 'result'); assert.equal(message().resultOutput, copilotToolResult(result));
    assert.equal(f.details.querySelector('.card-plugin-body'), body); assert.equal(f.details.querySelector('.card-plugin-body .tool-output'), output);
    assert.equal(f.dom.window.document.activeElement, output); assert.equal(f.details.open, true);
    assert.equal(f.details.querySelector('.tool-raw-inputs:not(.tool-raw-output)'), inputs); assert.equal(inputs.open, true);
    assert.equal(Object.isFrozen((message().toolNative as Record<string, unknown>)['tool.execution_complete']), true);
    emit('assistant.tool_call_delta', { toolCallId: 'unstarted', toolName: 'bash', inputDelta: '{"command":"fixture"}' });
    emit('session.idle', {});
    assert.equal(session.state.messages.find(row => row.toolCallId === 'unstarted')?.uiPhase, 'stopped');
  } finally { f.close(); session.disconnect('fixture complete'); }
});
