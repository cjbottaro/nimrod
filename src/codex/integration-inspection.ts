import type { PalettePage } from '../command-palette';
import { mcpReport } from './command-reports';
import { record } from './protocol';
import type { CodexSession } from './session';

export async function codexMcpPage(session: CodexSession, current: () => boolean): Promise<PalettePage | undefined> {
  const servers = await session.inspectMcp(current);
  if (!servers) return;
  return { items: servers.map(server => ({
    id: String(server.name), label: String(server.name), badge: typeof server.runtimeStatus === 'string' ? server.runtimeStatus : undefined,
    detail: `${Object.keys(record(server.tools, 'MCP tools')).length} tools · Auth: ${server.authStatus}`,
    inspection: { fields: [], text: mcpReport([server], true) }, run() {},
  })), notice: servers.length ? 'Read-only snapshot from Codex · Refresh to update.' : 'No MCP servers reported by Codex.' };
}
