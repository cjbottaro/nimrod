export interface OutputSource { text: string; }
type OutputData = { executionOutput?: string; resultOutput?: string };
type Sources = Partial<Record<keyof OutputData, OutputSource>>;
const sources = new WeakMap<object, Sources>();
const appends = new WeakMap<OutputSource, WeakMap<OutputSource, boolean>>();

/** Snapshot tokens share source strings, never backward links to old blocks. */
export function outputSources(data: OutputData): Sources {
  let value = sources.get(data);
  if (!value) {
    value = {};
    for (const key of ['executionOutput', 'resultOutput'] as const) if (data[key] !== undefined) value[key] = { text: data[key] };
    sources.set(data, value);
  }
  return value;
}
export function trackOutputSources(before: OutputData, after: OutputData): void {
  const previous = outputSources(before), next: Sources = {};
  for (const key of ['executionOutput', 'resultOutput'] as const) {
    const text = after[key]; if (text === undefined) continue;
    next[key] = previous[key]?.text === text ? previous[key] : { text };
  }
  sources.set(after, next);
}
export function transferOutputSources(from: object, to: object): void {
  const value = sources.get(from); if (value) sources.set(to, value);
}
export function sameOutputAppend(before: OutputSource | undefined, after: OutputSource | undefined): boolean {
  if (!before || !after) return false;
  if (before === after) return true;
  let comparisons = appends.get(after);
  if (!comparisons) { comparisons = new WeakMap(); appends.set(after, comparisons); }
  const cached = comparisons.get(before); if (cached !== undefined) return cached;
  // Only compare rendered endpoints, once across presentation and raw recovery.
  // Validating every cumulative event would undo frame-coalescing's benefit.
  const append = after.text.startsWith(before.text);
  comparisons.set(before, append); return append;
}
export function sectionOutputSource(data: OutputData, key: string, text: string): OutputSource | undefined {
  const field = key === 'execution' ? 'executionOutput' : key === 'result' ? data.resultOutput ? 'resultOutput' : 'executionOutput' : undefined;
  return field && data[field] === text ? outputSources(data)[field] : undefined;
}
