import assert from 'node:assert/strict';
import test from 'node:test';
import { isBuiltinMcpCommand, parseMcpStatus } from '../src/pi/mcp-status';
import { PiSession, type SessionUi } from '../src/pi/session';
import { PiTransport } from '../src/pi/transport';
import type { JsonRecord } from '../src/pi/types';

const builtin = { name: 'mcp', source: 'extension', sourceInfo: { path: 'builtin:mcp', source: 'builtin' } };
const report = 'ado: connected, 40 tools (codemode)\nplaywright: failed (codemode)\n    spawn ./node_modules/.bin/playwright-mcp ENOENT\n    second diagnostic line';

function fixture() {
  const sent: JsonRecord[] = [], notices: string[] = [];
  const rpc = new PiTransport(async message => { sent.push(message); });
  const ui: SessionUi = { publish() {}, changed() {}, notice: message => notices.push(message), choose: async () => undefined, input: async () => undefined, confirm: async () => false, openLink: async () => {}, copy: async () => {} };
  const session = new PiSession(rpc, ui);
  session.state.sessionUnavailable = false;
  const respond = (data: JsonRecord, success = true) => rpc.receive({ kind: 'rpc', value: { type: 'response', id: sent.at(-1)!.id, success, data, error: success ? undefined : 'Rejected' } });
  const notify = (message: string, notifyType = 'info') => rpc.receive({ kind: 'rpc', value: { type: 'extension_ui_request', id: 'notice', method: 'notify', message, notifyType } });
  return { session, rpc, sent, notices, respond, notify };
}

test('built-in MCP status preserves reported counts, exposures and multiline diagnostics', () => {
  const parsed = parseMcpStatus(report)!;
  assert.equal(parsed.raw, report);
  assert.deepEqual(parsed.servers[0], { name: 'ado', state: 'connected', exposure: 'codemode', toolCount: 40, details: '' });
  assert.equal(parsed.servers[1].toolCount, undefined, 'failed does not mean zero tools');
  assert.equal(parsed.servers[1].details, 'spawn ./node_modules/.bin/playwright-mcp ENOENT\nsecond diagnostic line');
  for (const state of ['disabled', 'starting', 'connecting', 'closed', 'disconnected, reconnects on next call', 'needs sign-in, run /mcp login demo']) {
    assert.ok(parseMcpStatus(`demo: ${state} (hidden)`));
  }
  const diagnostic = parseMcpStatus('config error: invalid config\noverridden: extension registration')!;
  assert.equal(diagnostic.diagnostics.length, 2);
  assert.equal(parseMcpStatus('No MCP servers configured. Add them to /home/user/.pi/agent/mcp.json or .pi/mcp.json.')?.servers.length, 0);
});

test('MCP adapter rejects replacement commands and unrecognized reports', () => {
  assert.equal(isBuiltinMcpCommand(builtin), true);
  assert.equal(isBuiltinMcpCommand({ ...builtin, sourceInfo: { path: '/extensions/mcp.ts' } }), false);
  assert.equal(isBuiltinMcpCommand({ ...builtin, source: 'prompt' }), false);
  for (const raw of ['', 'Other notification', 'demo: guessed (codemode)', 'demo: connected (unknown)', 'demo: connected (codemode)\ndemo: failed (codemode)', 'demo: connected (codemode)\nUnrelated notice']) {
    assert.equal(parseMcpStatus(raw), undefined);
  }
});

test('inspection consumes only recognized info reports; unrelated notices and warnings remain notices', async () => {
  const f = fixture();
  try {
    f.session.state.busy = true;
    const task = f.session.inspectMcp();
    assert.equal(f.session.inspectMcp(), task, 'in-flight refreshes share one request');
    assert.equal(f.sent[0].type, 'get_commands');
    f.respond({ commands: [builtin] }); await Promise.resolve();
    assert.equal(f.sent.at(-1)!.message, '/mcp');
    f.notify('MCP servers need attention: Playwright failed', 'warning');
    f.notify('Unrelated extension info');
    f.notify(report);
    assert.deepEqual(f.notices, ['MCP servers need attention: Playwright failed', 'Unrelated extension info']);
    f.respond({ disposition: 'handled' });
    assert.equal((await task).servers.length, 2);
    assert.equal(f.session.state.busy, true);
    assert.equal(f.session.state.messages.length, 0);
    f.notify(report);
    assert.equal(f.notices.at(-1), report.replace(/\n/g, ' '), 'outside the operation, ordinary notify routing remains unchanged');
  } finally { f.rpc.disconnect('done'); }
});

test('replacement integration is rejected before any prompt can reach the model', async () => {
  const f = fixture();
  try {
    const task = f.session.inspectMcp();
    f.respond({ commands: [{ ...builtin, sourceInfo: { path: '/extensions/mcp.ts' } }] });
    await assert.rejects(task, /built-in MCP integration/);
    assert.equal(f.sent.length, 1);
  } finally { f.rpc.disconnect('done'); }
});

test('unrecognized status does not infer success, swallow unrelated text or automatically retry', async () => {
  const f = fixture();
  try {
    const task = f.session.inspectMcp();
    f.respond({ commands: [builtin] }); await Promise.resolve();
    f.notify('Unknown future status format');
    f.respond({ disposition: 'handled' });
    await assert.rejects(task, /recognized MCP status/);
    assert.deepEqual(f.notices, ['Unknown future status format']);
    const count = f.sent.length;
    await assert.rejects(f.session.inspectMcp(), /previous MCP status request/);
    assert.equal(f.sent.length, count);
  } finally { f.rpc.disconnect('done'); }
});

test('disconnect settles an inspector request without replay or late report capture', async () => {
  const f = fixture();
  const task = f.session.inspectMcp();
  f.respond({ commands: [builtin] }); await Promise.resolve();
  f.rpc.disconnect('Disconnected during inspection');
  await assert.rejects(task, /Disconnected during inspection/);
  assert.equal(f.sent.length, 2);
});
