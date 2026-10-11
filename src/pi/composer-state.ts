import type { ImageAttachment } from './image-attachments';
export type SubmissionMode = "normal" | "steer" | "followUp";
export type SubmissionStatus = "pending" | "unknown";
export type SubmissionOutcome = "accepted" | "rejected" | "cancelled" | "unknown";

export interface Submission {
  id: string;
  text: string;
  attachments?: ImageAttachment[];
  mode: SubmissionMode;
  status: SubmissionStatus;
  error?: string;
}

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
  kind: "steering" | "followUp" | "unsent";
  attachments?: ImageAttachment[];
}

export interface ComposerState {
  draft: string;
  attachments?: ImageAttachment[];
  /** Accepted images retained conservatively because Pi queue recovery is text-only. */
  imageRecovery?: RecoveredQueueItem[];
  submission?: Submission;
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

/** A reload interrupts the RPC request. Keep the text visible, block sending, and never retry it. */
export function markPendingSubmissionUnknownAfterReload(state: ComposerState): ComposerState {
  if (state.submission?.status !== "pending") return state;
  const submission = state.submission;
  return {
    ...state,
    draft: state.draft || submission.text,
    submission: { ...submission, status: "unknown", error: "Reload interrupted this send. Pi may have accepted it; it will not be sent again automatically." },
    lastError: "Reload interrupted this send. Check the conversation or queue before allowing another send.",
  };
}

/** Returns the same state when a prior prompt has not reached a definitive outcome. */
export function beginSubmission(state: ComposerState, id: string, mode: SubmissionMode): ComposerState {
  if (state.submission || (!state.draft.trim() && !state.attachments?.length)) return state;
  return {
    ...state,
    lastError: undefined,
    submission: { id, text: state.draft, attachments: state.attachments?.length ? [...state.attachments] : undefined, mode, status: "pending" },
  };
}

/**
 * A successful RPC response is the only acceptance acknowledgement. A changed
 * draft belongs to the user and must survive acknowledgement of its predecessor.
 */
export function settleSubmission(state: ComposerState, id: string, outcome: SubmissionOutcome, error?: string): ComposerState {
  if (!state.submission || state.submission.id !== id) return state;
  const submitted = state.submission;
  if (outcome === "accepted") {
    return {
      ...state,
      draft: state.draft === submitted.text ? "" : state.draft,
      attachments: state.attachments?.filter(image => !submitted.attachments?.some(sent => sent.id === image.id)),
      imageRecovery: submitted.attachments?.length ? [...(state.imageRecovery ?? []), { id: `images-${submitted.id}`, text: submitted.text, attachments: submitted.attachments, kind: submitted.mode === 'followUp' ? 'followUp' : 'steering' }] : state.imageRecovery,
      submission: undefined,
      lastError: undefined,
    };
  }
  if (outcome === "unknown") {
    return {
      ...state,
      submission: { ...submitted, status: "unknown", error: error || "Pi did not confirm whether this message was accepted." },
      lastError: error || "Acceptance is unknown; Pi may already have received this message.",
    };
  }
  return {
    ...state,
    submission: undefined,
    recovered: state.draft !== submitted.text || submitted.attachments?.some(image => !state.attachments?.some(current => current.id === image.id))
      ? [...state.recovered, { id: `unsent-${submitted.id}`, text: submitted.text, attachments: submitted.attachments, kind: "unsent" }]
      : state.recovered,
    lastError: error || (outcome === "cancelled" ? "Session rename cancelled." : "Pi rejected this message."),
  };
}

/** An explicit user action is required before another message can be sent after an unknown outcome. */
export function dismissUnknownSubmission(state: ComposerState): ComposerState {
  if (state.submission?.status !== "unknown") return state;
  const submitted = state.submission;
  const missingImages = submitted.attachments?.some(image => !state.attachments?.some(current => current.id === image.id));
  return { ...state, submission: undefined, recovered: missingImages
    ? [...state.recovered, { id: `unknown-${submitted.id}`, text: submitted.text, attachments: submitted.attachments, kind: 'unsent' }]
    : state.recovered };
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
    attachments: [...(state.attachments ?? []), ...(item.attachments ?? []).filter(image => !state.attachments?.some(current => current.id === image.id))],
    recovered: state.recovered.filter((candidate) => candidate.id !== id),
  };
}
