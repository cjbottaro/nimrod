import { nonempty, record } from './protocol';
import { mcpConnectionLabel } from '../mcp-inspector';
import type { RpcRecord } from '../json-rpc-connection';

const string = (value: unknown, label: string) => {
  if (typeof value !== 'string') throw new Error(`Invalid Codex ${label}`);
  return value;
};
const array = (value: unknown, label: string): unknown[] => {
  if (!Array.isArray(value)) throw new Error(`Invalid Codex ${label}`);
  return value;
};
/** Validate only the concrete report fields consumed; never turn prose into actions. */
export function mcpServer(value: unknown): RpcRecord {
  const server = record(value, 'MCP server'); nonempty(server.name, 'MCP server name');
  record(server.tools, 'MCP tools'); string(server.authStatus, 'MCP authentication status');
  if (server.runtimeStatus != null) string(server.runtimeStatus, 'MCP runtime status');
  array(server.resources, 'MCP resources'); array(server.resourceTemplates, 'MCP resource templates');
  return server;
}
export function mcpReport(servers: readonly RpcRecord[], verbose: boolean): string {
  if (!servers.length) return 'No MCP servers reported by Codex.';
  return servers.map(server => {
    const tools = Object.entries(record(server.tools, 'MCP tools')).map(([name, value]) => {
      const tool = record(value, 'MCP tool');
      return verbose && typeof tool.description === 'string' ? `  ${name}: ${tool.description}` : `  ${name}`;
    });
    const resources = verbose ? array(server.resources, 'MCP resources').map(value => {
      const resource = record(value, 'MCP resource'); return `  ${string(resource.name, 'resource name')} — ${string(resource.uri, 'resource URI')}`;
    }) : [];
    return [`${server.name} · ${mcpConnectionLabel(server.runtimeStatus)} · Auth: ${server.authStatus}`,
      ...(server.toolsError ? [`Tool discovery: ${string(server.toolsError, 'MCP tool error')}`] : []),
      `Tools (${tools.length}):`, ...tools, ...(verbose ? [`Resources (${resources.length}):`, ...resources,
        `Resource templates: ${array(server.resourceTemplates, 'MCP resource templates').length}`] : [])].join('\n');
  }).join('\n\n');
}
export function terminal(value: unknown): RpcRecord {
  const result = record(value, 'background terminal');
  for (const field of ['itemId', 'processId', 'command', 'cwd']) nonempty(result[field], `terminal ${field}`);
  return result;
}
export function terminalReport(terminals: readonly RpcRecord[]): string {
  return terminals.length ? terminals.map(entry => `${entry.processId} · ${entry.command}\n  ${entry.cwd}`).join('\n\n')
    : 'No background terminals reported for this Codex thread.';
}
export function projectEntry(value: unknown, cwd: string, field: 'skills' | 'hooks'): RpcRecord {
  const result = record(value, `${field} response`), data = array(result.data, `${field} entries`);
  if (data.length !== 1) throw new Error(`Codex did not return exactly one project-scoped ${field} entry`);
  const entry = record(data[0], `${field} entry`);
  if (entry.cwd !== cwd) throw new Error(`Codex returned ${field} for a different project`);
  array(entry[field], field); array(entry.errors, `${field} errors`);
  if (field === 'hooks') array(entry.warnings, 'hook warnings');
  return entry;
}
function errors(entry: RpcRecord): string[] {
  return array(entry.errors, 'catalog errors').map(value => {
    const error = record(value, 'catalog error'); return `Error: ${string(error.path, 'error path')} — ${string(error.message, 'error message')}`;
  });
}
export function skillReport(entry: RpcRecord): string {
  const skills = array(entry.skills, 'skills').map(value => {
    const skill = record(value, 'skill');
    if (typeof skill.enabled !== 'boolean') throw new Error('Invalid Codex skill enabled state');
    return `${nonempty(skill.name, 'skill name')} · ${skill.enabled ? 'enabled' : 'disabled'}\n  ${string(skill.description, 'skill description')}\n  ${nonempty(skill.path, 'skill path')}`;
  });
  return ['Read-only Codex skill catalog. Invocation and enable/disable are not implemented here.',
    ...(skills.length ? skills : ['No skills reported.']), ...errors(entry)].join('\n\n');
}
export function hookReport(entry: RpcRecord): string {
  const hooks = array(entry.hooks, 'hooks').map(value => {
    const hook = record(value, 'hook');
    if (typeof hook.enabled !== 'boolean') throw new Error('Invalid Codex hook enabled state');
    const details = hook.handlerType === 'command' ? string(hook.command, 'hook command')
      : hook.handlerType === 'mcpTool' ? `${nonempty(hook.server, 'hook server')} / ${nonempty(hook.tool, 'hook tool')}` : string(hook.handlerType, 'hook handler');
    return `${nonempty(hook.eventName, 'hook event')} · ${hook.enabled ? 'enabled' : 'disabled'} · ${string(hook.trustStatus, 'hook trust')}\n  ${details}\n  ${nonempty(hook.sourcePath, 'hook source')}`;
  });
  return ['Read-only Codex hook catalog. Editing and trust changes are not implemented here.',
    ...(hooks.length ? hooks : ['No hooks reported.']), ...array(entry.warnings, 'hook warnings').map(value => `Warning: ${string(value, 'hook warning')}`), ...errors(entry)].join('\n\n');
}
