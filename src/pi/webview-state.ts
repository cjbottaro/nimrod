import { attachmentArray } from '../image-attachments';
import { ComposerState, initialComposerState } from "./composer-state";

export function restoreComposerState(value: unknown): ComposerState {
  if (!isRecord(value)) return initialComposerState();
  const restored = initialComposerState(string(value.draft));
  restored.attachments = attachmentArray(value.attachments);
  if (Array.isArray(value.recovered)) {
    restored.recovered = value.recovered.flatMap((item, index) => {
      if (!isRecord(item)) return [];
      return typeof item.text === "string" && item.text.trim() && (item.kind === "steering" || item.kind === "followUp")
        ? [{ id: typeof item.id === "string" ? item.id : `restored-${index}`, text: item.text, kind: item.kind }]
        : [];
    });
  }
  // Old unresolved attempts are not drafts and must never be restored or replayed.
  return restored;
}

/** Keeps host-owned recovery metadata and future state fields across composer writes. */
export function persistWebviewState(previous: unknown, composer: ComposerState): Record<string, unknown> {
  const retained = isRecord(previous) ? { ...previous } : {};
  // Submission tracking is runtime-only, not draft persistence or recovery.
  delete retained.imageRecovery;
  delete retained.submission;
  return { ...retained, draft: composer.draft, attachments: composer.attachments, recovered: composer.recovered };
}

function string(value: unknown): string { return typeof value === "string" ? value : ""; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
