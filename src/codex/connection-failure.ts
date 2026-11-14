/** Preserve native diagnostics without presenting a runtime ID as saved history. */
export function codexConnectionFailure(primary: string, connecting: boolean, cleanup?: unknown): { message: string; details: string } {
  const missing = /\bno rollout found for thread id \S+/.test(primary);
  const details = [`Connection failure: ${primary}`];
  if (missing) details.push('Codex could not find saved history for the requested thread. Codex may not persist a session before its first message; missing history can also have other causes. Nothing was replaced, renamed or replayed. Your local draft remains. Use New session with harness… and choose Codex for a separate session if needed.');
  if (cleanup !== undefined) details.push(`Owned-process cleanup also failed: ${cleanup instanceof Error ? cleanup.message : String(cleanup)}\nNative ownership remains reserved until exit is observed. Nothing was retried or treated as successfully stopped.`);
  return {
    message: missing ? 'Codex could not reopen this session: no saved history was found. Your draft is kept.'
      : `${connecting ? 'Codex startup failed' : 'Codex disconnected'}. Your draft is kept; nothing was replayed.`,
    details: details.join('\n\n'),
  };
}
