/** Preserve the initiating failure when owned-process shutdown also fails. */
export function codexConnectionFailure(primary: string, connecting: boolean, cleanup?: unknown): { message: string; details?: string } {
  return {
    message: `${connecting ? 'Codex startup failed' : 'Codex disconnected'}: ${primary}. Saved history and any local draft remain; nothing was replayed.`,
    ...(cleanup === undefined ? {} : {
      details: `Connection failure: ${primary}\n\nOwned-process cleanup also failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}\nNative ownership remains reserved until exit is observed. Nothing was retried or treated as successfully stopped.`,
    }),
  };
}
