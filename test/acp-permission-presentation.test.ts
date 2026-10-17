import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderPermissionDetails } from '../src/acp/tool-state';
import type { AcpRecord } from '../src/acp/connection';

function fixture(tool: AcpRecord) {
  const dom = new JSDOM();
  const preview = renderPermissionDetails(dom.window.document, tool);
  return { dom, preview, close: () => dom.window.close() };
}

test('command permissions use a compact summary and exact code, with duplicate metadata and IDs in closed raw details', () => {
  const command = 'git status --short && git branch --show-current && git worktree list';
  const tool = { toolCallId: 'fixture-call', kind: 'execute', title: 'Inspect checkout and task worktrees', status: 'pending',
    rawInput: { command, commands: [command] }, locations: [{ path: '/fixture/project' }], customMetadata: { retained: true } };
  const f = fixture(tool);
  try {
    assert.equal(f.preview.querySelector('.acp-permission-summary')?.textContent, 'Run command · Inspect checkout and task worktrees');
    assert.equal(f.preview.querySelector('.acp-permission-summary strong')?.textContent, 'Run command');
    assert.equal(f.preview.querySelector('.acp-permission-description')?.textContent, tool.title);
    assert.equal(f.preview.querySelectorAll('.acp-permission-command').length, 1);
    assert.equal(f.preview.querySelector('.acp-permission-command code')?.textContent, command);
    const raw = f.preview.querySelector<HTMLDetailsElement>('.acp-permission-raw')!;
    assert.equal(raw.open, false); assert.equal(raw.querySelector('summary')?.textContent, 'Raw details');
    assert.match(raw.textContent!, /Tool call: fixture-call/);
    assert.deepEqual(JSON.parse(raw.querySelector('pre')!.textContent!), tool);
    assert.equal(f.preview.querySelector('button'), null, 'the preview owns no permission choices');
  } finally { f.close(); }
});

test('multiline commands and markup-looking descriptions stay literal and complete', () => {
  const command = '  printf "<script>not executable</script>"\n\n# keep whitespace\n';
  const title = '<img src=x onerror=alert(1)> ' + 'Long operation description '.repeat(50);
  const f = fixture({ toolCallId: 'literal', kind: 'execute', title, rawInput: { command } });
  try {
    assert.equal(f.preview.querySelector('.acp-permission-description')?.textContent, title);
    assert.equal(f.preview.querySelector('.acp-permission-command code')?.textContent, command);
    assert.equal(f.preview.querySelectorAll('script, img').length, 0);
    assert.equal(f.preview.querySelector<HTMLElement>('.acp-permission-command')?.tabIndex, 0);
  } finally { f.close(); }
});

test('command lists retain distinct operations, intentional repetitions and exact order', () => {
  const commands = ['printf first', 'printf second', 'printf first'];
  const f = fixture({ kind: 'execute', rawInput: { command: commands[0], commands } });
  try {
    assert.deepEqual([...f.preview.querySelectorAll('.acp-permission-command code')].map(code => code.textContent), commands);
    assert.equal(f.preview.querySelector('.acp-permission-summary')?.textContent, 'Run command');
  } finally { f.close(); }
});

test('scalar aliases and input descriptions work without repeating a generic title', () => {
  for (const [tool, summary] of [
    [{ kind: 'execute', rawInput: { cmd: 'printf fixture', description: 'Check fixture' } }, 'Run command · Check fixture'],
    [{ kind: 'execute', title: 'Run command', rawInput: { command: 'printf fixture' } }, 'Run command'],
  ] as const) {
    const f = fixture(tool);
    try { assert.equal(f.preview.querySelector('.acp-permission-summary')?.textContent, summary); }
    finally { f.close(); }
  }
});

test('unknown, partial and malformed operations keep the existing literal permission fallback', () => {
  for (const tool of [
    { toolCallId: 'missing' },
    { toolCallId: 'edit', kind: 'edit', rawInput: { command: 'not a shell operation' } },
    { toolCallId: 'partial', kind: 'execute', rawInput: { command: { unexpected: true } } },
    { toolCallId: 'bad-list', kind: 'execute', rawInput: { command: 'printf fixture', commands: [42] } },
    { toolCallId: 'empty', kind: 'execute', rawInput: { command: '   ', commands: [] } },
  ]) {
    const f = fixture(tool);
    try {
      assert.equal(f.preview.querySelector('.acp-permission-command'), null);
      assert.equal(f.preview.querySelector('.acp-permission-raw'), null);
      assert.match(f.preview.textContent!, new RegExp(`Tool call: ${tool.toolCallId}`));
      if (tool.rawInput) assert.match(f.preview.textContent!, /Inputs/);
      else assert.match(f.preview.textContent!, /did not supply additional operation details/);
    } finally { f.close(); }
  }
});
