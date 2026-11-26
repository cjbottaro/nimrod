import { mcpConnectionLabel, type McpSnapshot } from '../mcp-inspector';
import { record } from './connection';
import type { CopilotSession } from './session';

export async function copilotMcpPage(session: CopilotSession, current: () => boolean): Promise<McpSnapshot | undefined> {
  const catalog = await session.inspectMcp();
  if (!current()) return;
  if (!record(catalog) || !Array.isArray(catalog.servers)) throw new Error('Copilot returned an invalid MCP server catalog');
  const names = new Set<string>();
  const items = catalog.servers.map(value => {
    if (!record(value) || typeof value.name !== 'string' || !value.name.trim() || typeof value.enabled !== 'boolean' || names.has(value.name))
      throw new Error('Copilot returned an invalid or duplicate MCP server');
    names.add(value.name);
    // This row already came from effective configuration. The runtime sentinel
    // does not establish a live connection state for that configured server.
    const state = mcpConnectionLabel(value.status);
    return { id: value.name, label: typeof value.displayName === 'string' && value.displayName.trim() ? value.displayName : value.name,
      badge: value.enabled ? state : 'Disabled', keywords: value.name,
      inspection: { fields: [['Server', value.name], ['Configuration', value.enabled ? 'Enabled' : 'Disabled'],
        ['Connection', state], ['Source', typeof value.source === 'string' ? value.source : 'Not reported']] as [string, string][],
        text: typeof value.error === 'string' ? value.error : undefined }, run() {} };
  });
  return { count: items.length, items, notice: items.length ? undefined : 'No MCP servers reported by Copilot.' };
}
