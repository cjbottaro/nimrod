import { JsonRecord, NativeSessionStats } from "./types";

export type { NativeSessionStats } from "./types";

export function nativeSessionStats(stats: unknown, state: unknown): NativeSessionStats {
  const data = record(stats);
  const rpcState = record(state);
  const contextUsage = recordOrUndefined(data.contextUsage);
  const cost = nonNegativeNumber(data.cost);
  const contextWindow = contextUsage ? positiveNumber(contextUsage.contextWindow) : undefined;
  const tokens = contextUsage ? nullableNonNegativeNumber(contextUsage.tokens) : undefined;
  const percent = contextUsage ? nullableNonNegativeNumber(contextUsage.percent) : undefined;
  const autoCompactionEnabled = typeof rpcState.autoCompactionEnabled === "boolean" ? rpcState.autoCompactionEnabled : undefined;

  return {
    ...(cost === undefined ? {} : { cost }),
    ...(contextUsage ? {
      context: {
        ...(tokens === undefined ? {} : { tokens }),
        ...(contextWindow === undefined ? {} : { contextWindow }),
        ...(percent === undefined ? {} : { percent }),
      },
    } : {}),
    ...(autoCompactionEnabled === undefined ? {} : { autoCompactionEnabled }),
  };
}

/** Compact status text: this is Pi's usage estimate, not an invoice amount. */
export function formatNativeSessionStats(stats: NativeSessionStats): string {
  const cost = stats.cost === undefined ? "$???" : `$${stats.cost.toFixed(3)}`;
  const context = formatContext(stats.context);
  const autoCompact = stats.autoCompactionEnabled === true ? "Auto compact" : stats.autoCompactionEnabled === false ? "Auto compact off" : "Auto compact —";
  return `${cost} · ${context} · ${autoCompact}`;
}

function formatContext(context: NativeSessionStats["context"]): string {
  if (!context) return "— / —";
  const window = context.contextWindow === undefined ? "—" : formatTokenCount(context.contextWindow);
  const percent = context.percent === null || context.percent === undefined ? "—" : `${formatPercent(context.percent)}%`;
  return `${percent} / ${window}`;
}

function formatPercent(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${trimDecimal(value / 1_000_000)}M`;
  if (value >= 1_000) return `${trimDecimal(value / 1_000)}K`;
  return String(Math.round(value));
}

function trimDecimal(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function record(value: unknown): JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : {};
}

function recordOrUndefined(value: unknown): JsonRecord | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function positiveNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function nullableNonNegativeNumber(value: unknown): number | null | undefined {
  if (value === null) return null;
  return nonNegativeNumber(value);
}
