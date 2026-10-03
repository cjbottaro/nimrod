export interface ActivityPresentation {
  busy: boolean;
  text: string;
  subagents?: string;
}

interface SubagentCounts {
  running: number;
  queued: number;
  text: string;
}

/**
 * @tintinweb/pi-subagents owns this status key. Only its documented count
 * format is allowed to create a subagent activity row; unrelated extension
 * statuses remain informational rows.
 */
export function subagentCounts(value: unknown): string | undefined {
  return parseSubagentCounts(value)?.text;
}

export function presentActivity(mainBusy: boolean, mainStatus: string | undefined, extensionStatuses: Record<string, string> | undefined): ActivityPresentation {
  const subagents = parseSubagentCounts(extensionStatuses?.subagents);
  const subagentText = subagents && (subagents.running > 0 || subagents.queued > 0) ? subagents.text : undefined;
  return {
    busy: mainBusy,
    text: mainStatus === "Ready" ? "Idle — ready for your message" : mainStatus || (mainBusy ? "Working…" : "Idle"),
    ...(subagentText ? { subagents: subagentText } : {}),
  };
}

function parseSubagentCounts(value: unknown): SubagentCounts | undefined {
  if (typeof value !== "string") return undefined;
  const text = value.trim();
  // @tintinweb/pi-subagents v0.19.0 emits one of:
  // "2 running agents", "3 queued agents", or "1 running, 2 queued agents".
  const match = /^(?:(\d+)\s+running(?:,\s*(\d+)\s+queued)?|(\d+)\s+queued)\s+agents?$/.exec(text);
  if (!match) return undefined;
  const running = Number(match[1] || 0);
  const queued = Number(match[2] || match[3] || 0);
  return { running, queued, text };
}

/** Known subagent status is represented by the main activity indicator, not a stale generic row. */
export function informationalExtensionStatuses(statuses: Record<string, string> | undefined): Array<[string, string]> {
  if (!statuses) return [];
  return Object.entries(statuses).filter(([key, value]) => key !== "subagents" || subagentCounts(value) === undefined);
}
