import type { HarnessSessionHost } from '../harness-host';
import type { PiSession } from './session';

export function piInspection(host: HarnessSessionHost, read: () => PiSession | undefined) {
  let cancel: (() => void) | undefined;
  async function run(): Promise<void> {
    const request = host.ui.palette.startInspection('MCP servers', () => { void run(); });
    if (!request) return;
    cancel = request.cancel;
    const session = read();
    const valid = () => host.lifetime.current() && read() === session && !host.ownership.ended && !host.lifetime.closing() && !host.lifetime.restarting() && !host.lifetime.deleting();
    if (!session || !valid()) {
      request.cancel();
      if (host.lifetime.current() && !host.lifetime.closing()) host.effects.notice({ id: 'mcp-inspection', operation: 'Inspect MCP servers', message: 'Connect this session before inspecting MCP servers.' });
      return;
    }
    try {
      const report = await session.inspectMcp();
      if (!request.isCurrent()) return;
      if (!valid()) { request.cancel(); return; }
      host.effects.resolve('mcp-inspection');
      const attention = new Set(['failed', 'needs sign-in', 'disconnected']);
      request.show({ items: [
        ...[...report.servers].sort((a, b) => Number(attention.has(b.state)) - Number(attention.has(a.state))).map(server => ({
          id: server.name, label: server.name, badge: server.state,
          detail: `${server.toolCount === undefined ? 'Tool count unavailable' : `${server.toolCount} tools`} · ${server.exposure}`, keywords: server.details,
          inspection: { fields: [['Connection', server.state], ['Exposure', server.exposure], ['Tools', server.toolCount === undefined ? 'Not reported' : String(server.toolCount)]] as [string, string][],
            text: server.details || (server.state === 'disconnected' ? 'Pi reconnects this server on its next call.' : undefined) }, run() {},
        })),
        ...(report.diagnostics.length ? [{ id: ':diagnostics', label: 'Configuration diagnostics', detail: `${report.diagnostics.length} reported entries`, inspection: { fields: [] as [string, string][], text: report.diagnostics.join('\n\n') }, run() {} }] : []),
      ], notice: report.empty || 'Read-only snapshot from Pi · Refresh to update. Tool details and configuration sources are not exposed by this status API.' });
    } catch (error) { if (request.isCurrent()) { request.cancel(); if (valid()) host.effects.notice({ id: 'mcp-inspection', operation: 'Inspect MCP servers', message: String(error) }); } }
  }
  return { run, cancel: () => cancel?.() };
}
