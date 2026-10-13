export interface McpServerStatus {
  name: string;
  state: string;
  exposure: string;
  toolCount?: number;
  details: string;
}
export interface McpStatusReport {
  servers: McpServerStatus[];
  diagnostics: string[];
  raw: string;
  empty?: string;
}

/** Deliberately narrow adapter for built-in Pi /mcp's RPC status format.
 * Never classify arbitrary extension notices as MCP status. Preserve the original
 * report and fail closed when the format changes rather than inventing state.
 */
export function parseMcpStatus(raw: string): McpStatusReport | undefined {
  if (/^No MCP servers configured\. Add them to [^\n]+ or \.pi\/mcp\.json\.$/.test(raw)) {
    return { servers: [], diagnostics: [], raw, empty: raw };
  }
  const servers: McpServerStatus[] = [], diagnostics: string[] = [];
  let current: McpServerStatus | undefined;
  for (const line of raw.split('\n')) {
    if (line.startsWith('    ')) {
      if (current) current.details += `${current.details ? '\n' : ''}${line.slice(4)}`;
      else if (diagnostics.length) diagnostics[diagnostics.length - 1] += `\n${line.slice(4)}`;
      else return undefined;
      continue;
    }
    const match = /^([a-zA-Z0-9_-]+): (connected|disabled|starting|connecting|closed|failed|disconnected, reconnects on next call|needs sign-in, run \/mcp login [a-zA-Z0-9_-]+)(?:, (\d+) tools)? \((codemode|codemode-deferred|deferred|direct|hidden)\)$/.exec(line);
    if (match) {
      if (servers.some(server => server.name === match[1])) return undefined;
      current = { name: match[1], state: match[2].startsWith('needs sign-in') ? 'needs sign-in' : match[2].startsWith('disconnected') ? 'disconnected' : match[2], exposure: match[4], toolCount: match[3] === undefined ? undefined : Number(match[3]), details: match[2].startsWith('needs sign-in') ? match[2] : '' };
      servers.push(current); continue;
    }
    if (/^(config error|overridden): /.test(line)) { diagnostics.push(line); current = undefined; continue; }
    return undefined;
  }
  return servers.length || diagnostics.length ? { servers, diagnostics, raw } : undefined;
}

export function isBuiltinMcpCommand(command: unknown): boolean {
  if (!command || typeof command !== 'object') return false;
  const value = command as { name?: unknown; source?: unknown; sourceInfo?: { path?: unknown; source?: unknown } };
  return value.name === 'mcp' && value.source === 'extension' &&
    value.sourceInfo?.path === 'builtin:mcp';
}
