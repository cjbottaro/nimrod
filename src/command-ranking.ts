/** App-wide command usage, independent of the active ranking strategy.
 * Entries are newest first; array order breaks same-millisecond timestamp ties.
 */
export interface CommandUsage {
  id: string;
  lastUsedAt: number;
  useCount: number;
}
export const COMMAND_USAGE_KEY = 'nimrod.command-usage.v1';
export const COMMAND_HISTORY_LIMIT = 50;
export interface CommandRankingContext {
  query: string;
  usage: readonly CommandUsage[];
}
export interface CommandRankingStrategy {
  readonly id: string;
  /** Receives already-filtered commands. Must not mutate the input or usage. */
  rank<T extends { id: string; label: string }>(commands: readonly T[], context: CommandRankingContext): T[];
}
export interface CommandRanking {
  strategy?: CommandRankingStrategy;
  usage(): readonly CommandUsage[];
  /** Acceptance, including entry into a picker; never highlighting or dismissal. */
  record(id: string): void;
}
export function readCommandUsage(value: unknown): CommandUsage[] {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('entries' in value) || !Array.isArray(value.entries)) return [];
  const ids = new Set<string>();
  const result: CommandUsage[] = [];
  for (const entry of value.entries) {
    if (!entry || typeof entry.id !== 'string' || !entry.id || entry.id.length > 256 || ids.has(entry.id)
      || !Number.isSafeInteger(entry.lastUsedAt) || entry.lastUsedAt < 0 || !Number.isSafeInteger(entry.useCount) || entry.useCount < 1) continue;
    ids.add(entry.id); result.push({ id: entry.id, lastUsedAt: entry.lastUsedAt, useCount: entry.useCount });
    if (result.length === COMMAND_HISTORY_LIMIT) break;
  }
  return result;
}
/** VS Code-style ordering: MRU among text matches, then alphabetic unused commands.
 * Matching stays in the palette; no frequency, decay, or relevance-score blending.
 */
export const vscodeMruRanking: CommandRankingStrategy = {
  id: 'vscode-mru',
  rank(commands, { usage }) {
    const positions = new Map(usage.map((entry, index) => [entry.id, index]));
    return [...commands].sort((a, b) => {
      const first = positions.get(a.id) ?? Infinity, second = positions.get(b.id) ?? Infinity;
      if (first !== second) return first < second ? -1 : 1;
      return a.label.localeCompare(b.label) || a.id.localeCompare(b.id);
    });
  },
};
