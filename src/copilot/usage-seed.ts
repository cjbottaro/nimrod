/** Display-only provenance. Neither mode is a reported measurement. */
export interface CopilotUsageSeed {
  readonly credits?: 'zero' | 'unknown';
  readonly context?: 'zero' | 'unknown';
}

/** The only new/resume presentation decision. Change `zero` to `unknown` here
 * to retire the experiment without touching fetching, reconciliation or rendering. */
export function initialCopilotUsage(fresh: boolean): CopilotUsageSeed {
  const display = fresh ? 'zero' : 'unknown';
  return { credits: display, context: display };
}
