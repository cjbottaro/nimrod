import { mcpConnectionLabel, type McpSnapshot } from '../mcp-inspector';
import type { PiSession } from './session';

export async function piMcpPage(session: PiSession, current: () => boolean, detail: 'summary' | 'full'): Promise<McpSnapshot | undefined> {
  if (!current() || detail === 'summary' && !session.advertisesMcpStatus) return;
  const report = await session.inspectMcp();
  const attention = new Set(['failed', 'needs sign-in', 'disconnected']);
  return { count: report.servers.length, items: [
    ...[...report.servers].sort((a, b) => Number(attention.has(b.state)) - Number(attention.has(a.state))).map(server => ({
      id: server.name, label: server.name, badge: mcpConnectionLabel(server.state),
      detail: `${server.toolCount === undefined ? 'Tool count unavailable' : `${server.toolCount} tools`} · ${server.exposure}`, keywords: server.details,
      inspection: { fields: [['Connection', mcpConnectionLabel(server.state)], ['Exposure', server.exposure], ['Tools', server.toolCount === undefined ? 'Not reported' : String(server.toolCount)]] as [string, string][],
        text: server.details || (server.state === 'disconnected' ? 'Pi reconnects this server on its next call.' : server.state === 'needs sign-in' ? 'Sign in from the Pi TUI.' : undefined) }, run() {},
    })),
    ...(report.diagnostics.length ? [{ id: ':diagnostics', label: 'Configuration diagnostics', detail: `${report.diagnostics.length} reported entries`, inspection: { fields: [] as [string, string][], text: report.diagnostics.join('\n\n') }, run() {} }] : []),
  ], notice: report.servers.length || report.diagnostics.length ? undefined : 'No MCP servers reported by Pi.' };
}
