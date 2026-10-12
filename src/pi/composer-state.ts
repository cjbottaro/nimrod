import type { ImageAttachment } from './image-attachments';
export type SubmissionMode = "normal" | "steer" | "followUp";
export type SubmissionOutcome = "accepted" | "rejected" | "cancelled" | "unknown";

export interface QueueState {
  steering: string[];
  followUp: string[];
  /** queue_update supplied these texts; do not synthesize them from local sends. */
  authoritative: boolean;
  /** get_state can report this count before Pi has emitted a queue_update. */
  pendingCount?: number;
}

export interface RecoveredQueueItem {
  id: string;
  text: string;
  kind: "steering" | "followUp";
}

export interface ComposerState {
  draft: string;
  attachments?: ImageAttachment[];
  lastError?: string;
  queue: QueueState;
  recovered: RecoveredQueueItem[];
}

export const initialComposerState = (draft = ""): ComposerState => ({
  draft,
  queue: { steering: [], followUp: [], authoritative: false },
  recovered: [],
});

export function updateDraft(state: ComposerState, draft: string): ComposerState {
  return { ...state, draft };
}

/** Sending consumes the editable draft, independently of transport replies. */
export function clearDraft(state: ComposerState): ComposerState {
  return { ...state, draft: "", attachments: [], lastError: undefined };
}

/** queue_update is authoritative; local prompt acknowledgements never alter this list. */
export function applyQueueUpdate(state: ComposerState, steering: string[], followUp: string[]): ComposerState {
  return {
    ...state,
    queue: { steering: [...steering], followUp: [...followUp], authoritative: true, pendingCount: steering.length + followUp.length },
  };
}

/** Use get_state's count only until Pi provides a queue_update with actual text. */
export function applyQueuePendingCount(state: ComposerState, pendingCount: number | undefined): ComposerState {
  if (state.queue.authoritative || pendingCount === undefined || pendingCount < 0) return state;
  return { ...state, queue: { ...state.queue, pendingCount } };
}

/** Preserve text returned by clear_queue before aborting; it is never silently discarded. */
export function recoverClearedQueue(state: ComposerState, steering: string[], followUp: string[]): ComposerState {
  const recovered = [...state.recovered];
  for (const [kind, texts] of [["steering", steering], ["followUp", followUp]] as const) {
    for (const text of texts) {
      if (!text.trim()) continue; // Image-only queues return no restorable text.
      let index = recovered.length;
      while (recovered.some(item => item.id === `${kind}-${index}`)) index++;
      recovered.push({ id: `${kind}-${index}`, text, kind });
    }
  }
  return { ...state, recovered };
}

/** Restoring recovered text appends it, so a newer composer edit cannot be overwritten. */
export function restoreRecoveredQueueItem(state: ComposerState, id: string): ComposerState {
  const item = state.recovered.find((candidate) => candidate.id === id);
  if (!item) return state;
  return {
    ...state,
    draft: state.draft ? `${state.draft}\n${item.text}` : item.text,
    recovered: state.recovered.filter((candidate) => candidate.id !== id),
  };
}
