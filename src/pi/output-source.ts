export interface OutputSource { epoch: object; length: number; }
type OutputData = { executionOutput?: string; resultOutput?: string };
type Sources = Partial<Record<keyof OutputData, OutputSource>>;
const sources = new WeakMap<object, Sources>();

/** A lineage survives only verified appends. No previous payloads/blocks are retained. */
export function outputSources(data: OutputData): Sources {
  let value = sources.get(data);
  if (!value) {
    value = {};
    for (const key of ['executionOutput', 'resultOutput'] as const) if (data[key] !== undefined) value[key] = { epoch: {}, length: data[key].length };
    sources.set(data, value);
  }
  return value;
}
export function trackOutputSources(before: OutputData, after: OutputData): void {
  const previous = outputSources(before), next: Sources = {};
  for (const key of ['executionOutput', 'resultOutput'] as const) {
    const text = after[key]; if (text === undefined) continue;
    const old = before[key], source = previous[key];
    // Pi delivers cumulative snapshots: this is the one required prefix check,
    // performed on ingestion, not repeated by each rendering/recovery layer.
    next[key] = source && text === old ? source : source && old !== undefined && text.startsWith(old)
      ? { epoch: source.epoch, length: text.length } : { epoch: {}, length: text.length };
  }
  sources.set(after, next);
}
export function transferOutputSources(from: object, to: object): void {
  const value = sources.get(from); if (value) sources.set(to, value);
}
export function sameOutputAppend(before: OutputSource | undefined, after: OutputSource | undefined): boolean {
  return !!before && !!after && before.epoch === after.epoch && before.length <= after.length;
}
export function sectionOutputSource(data: OutputData, key: string, text: string): OutputSource | undefined {
  const field = key === 'execution' ? 'executionOutput' : key === 'result' ? data.resultOutput ? 'resultOutput' : 'executionOutput' : undefined;
  return field && data[field] === text ? outputSources(data)[field] : undefined;
}
