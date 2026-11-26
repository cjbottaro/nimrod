import type { PalettePage } from './command-palette';
import type { HarnessSessionHost } from './harness-host';

export const mcpAction = { id: 'mcp', label: 'MCP servers…', detail: 'Inspect this session’s MCP servers' } as const;
export const mcpSlashUnavailable = 'MCP slash commands are unavailable in Nimrod. Your draft was kept.';

export function mcpConnectionLabel(status: unknown): string {
  switch (status) {
    case 'connected': return 'Live';
    case 'closed': case 'stopped': case 'disconnected': return 'Disconnected';
    case 'starting': case 'connecting': case 'pending': return 'Connecting';
    case 'needs sign-in': case 'needs-auth': case 'authenticationRequired': return 'Auth required';
    case 'failed': return 'Failed';
    case 'disabled': return 'Disabled';
    default: return 'Unknown';
  }
}

export interface SessionMcpInspector {
  readonly count: number | undefined;
  prime(): void;
  run(): Promise<void>;
}
export interface McpSnapshot extends PalettePage { readonly count: number; }

/** Shared consumer lifecycle; concrete adapters own discovery, validation and reported fields. */
export function createMcpInspector<Session extends object>(host: HarnessSessionHost, read: () => Session | undefined,
  load: (session: Session, current: () => boolean, detail: 'summary' | 'full') => Promise<McpSnapshot | undefined>): SessionMcpInspector & { cancel(): void } {
  let cancelPage: (() => void) | undefined;
  let countOwner: Session | undefined, count: number | undefined;
  let initialOwner: Session | undefined, generation = 0;
  const cancel = () => { cancelPage?.(); cancelPage = undefined; };
  const available = (session: Session, token: string | undefined) => host.lifetime.current() && read() === session && host.ownership.token === token
    && !host.ownership.starting && !host.ownership.ended && !host.lifetime.closing() && !host.lifetime.reloading() && !host.lifetime.deleting();
  const publish = (session: Session, snapshot: McpSnapshot | undefined, request: number) => {
    if (request !== generation || countOwner === session && count === snapshot?.count) return;
    countOwner = session; count = snapshot?.count;
    host.effects.changed();
  };
  function prime(): void {
    const session = read(), token = host.ownership.token;
    if (!session || initialOwner === session || !available(session, token)) return;
    initialOwner = session;
    const request = ++generation;
    const current = () => request === generation && available(session, token);
    void load(session, current, 'summary').then(snapshot => {
      if (current()) publish(session, snapshot, request);
    }).catch(() => { /* Unknown count stays hidden; the explicit action reports read failures. */ });
  }
  async function run(): Promise<void> {
    const session = read(), token = host.ownership.token;
    const valid = () => !!session && available(session, token) && host.ui.canPresent();
    if (!session || !valid()) return;
    const page = host.ui.palette.startInspection('MCP servers');
    if (!page) return;
    cancel(); cancelPage = page.cancel;
    initialOwner = session;
    const request = ++generation;
    try {
      const snapshot = await load(session, () => page.isCurrent() && valid(), 'full');
      if (!page.isCurrent()) return;
      if (!snapshot || !valid()) { page.cancel(); return; }
      publish(session, snapshot, request);
      host.effects.resolve('mcp-inspection'); page.show(snapshot);
    } catch (error) {
      if (!page.isCurrent()) return;
      page.cancel();
      if (valid()) { publish(session, undefined, request); host.effects.notice({ id: 'mcp-inspection', operation: 'Inspect MCP servers', message: String(error) }); }
    }
  }
  return { run, cancel, prime, get count() { return countOwner === read() ? count : undefined; } };
}
