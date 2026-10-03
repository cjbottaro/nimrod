import { ComposerState, initialComposerState, markPendingSubmissionUnknownAfterReload } from "./composer-state";

export function restoreComposerState(value: unknown): ComposerState {
  if (!isRecord(value)) return initialComposerState();
  const restored = initialComposerState(string(value.draft));
  if (Array.isArray(value.recovered)) {
    restored.recovered = value.recovered.flatMap((item, index) => {
      if (!isRecord(item)) return [];
      return typeof item.text === "string" && (item.kind === "steering" || item.kind === "followUp" || item.kind === "unsent")
        ? [{ id: typeof item.id === "string" ? item.id : `restored-${index}`, text: item.text, kind: item.kind }]
        : [];
    });
  }
  if (isRecord(value.submission)) {
    const pending = value.submission;
    if (typeof pending.id === "string" && typeof pending.text === "string" && (pending.mode === "normal" || pending.mode === "steer" || pending.mode === "followUp") && (pending.status === "pending" || pending.status === "unknown")) {
      restored.submission = { id: pending.id, text: pending.text, mode: pending.mode, status: pending.status, error: string(pending.error) || undefined };
    }
  }
  return markPendingSubmissionUnknownAfterReload(restored);
}

/** Keeps host-owned recovery metadata and future state fields across composer writes. */
export function persistWebviewState(previous: unknown, composer: ComposerState): Record<string, unknown> {
  const retained = isRecord(previous) ? previous : {};
  return { ...retained, draft: composer.draft, submission: composer.submission, recovered: composer.recovered };
}

function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
