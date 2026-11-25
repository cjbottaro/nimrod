import type { PalettePage } from './command-palette';
import type { HarnessSessionHost } from './harness-host';

export const mcpAction = { id: 'mcp', label: 'MCP servers…', detail: 'Inspect this session’s MCP servers' } as const;
export const mcpSlashUnavailable = 'MCP slash commands are unavailable in Nimrod. Your draft was kept.';

/** Shared action lifecycle; concrete adapters own discovery, validation and reported fields. */
export function createMcpInspector<Session>(host: HarnessSessionHost, read: () => Session | undefined,
  load: (session: Session, current: () => boolean) => Promise<PalettePage | undefined>) {
  let cancelPage: (() => void) | undefined;
  const cancel = () => { cancelPage?.(); cancelPage = undefined; };
  async function run(): Promise<void> {
    const session = read(), token = host.ownership.token;
    const valid = () => host.ui.canPresent() && read() === session && host.ownership.token === token && !host.ownership.starting;
    if (!session || !valid()) return;
    const request = host.ui.palette.startInspection('MCP servers', () => { void run(); });
    if (!request) return;
    cancel(); cancelPage = request.cancel;
    try {
      const page = await load(session, () => request.isCurrent() && valid());
      if (!request.isCurrent()) return;
      if (!page || !valid()) { request.cancel(); return; }
      host.effects.resolve('mcp-inspection'); request.show(page);
    } catch (error) {
      if (!request.isCurrent()) return;
      request.cancel();
      if (valid()) host.effects.notice({ id: 'mcp-inspection', operation: 'Inspect MCP servers', message: String(error) });
    }
  }
  return { run, cancel };
}
