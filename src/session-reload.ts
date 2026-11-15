/** Project-bar, command-palette and shortcut port. Required on every session:
 * integrations must implement exact-identity reload or explain a concrete
 * unavailable state (for example, temporary/no saved identity).
 *
 * The shell owns confirmation, the reloading guard, mounted view and focus.
 * run() must revalidate identity, await integration-owned teardown before reconnecting,
 * retire pending local operations, and reopen the same identity. Process-backed adapters
 * replace their owned runtime; shared-server adapters replace only their client connection.
 * Preserve drafts and membership; never replay prompts/queues, create a fallback
 * conversation, reload the webview, or affect another session. A failed teardown
 * must not reconnect; failed resume keeps the saved identity for explicit retry.
 * Guarded connect completion is not readiness: observe lifecycle.connection.
 */
export interface SessionReload {
  available(): boolean;
  reason(): string;
  readonly detail: string;
  readonly confirmation: string;
  needsConfirmation(inputPending: boolean): boolean;
  run(): Promise<void>;
}
