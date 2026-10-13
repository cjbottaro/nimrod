import type { ImageContent } from './image-attachments';
import type { SubmissionMode, SubmissionOutcome } from './composer-state';

export type SteeringStatus = 'sending' | 'pending' | 'unknown' | 'interrupted' | 'rejected' | 'cancelled';
export interface SteeringMessage {
  key?: string;
  role?: string;
  content?: unknown;
  steeringStatus?: SteeringStatus;
  steering?: boolean;
  queued?: boolean;
  sticky?: boolean;
}
interface PendingSteering {
  key: string;
  text: string;
  images?: ImageContent[];
  submissionId?: string;
  status: SteeringStatus;
  kind: 'steering' | 'followUp';
  steering?: boolean;
}

export const steeringStatusLabel = (status: SteeringStatus): string => ({
  sending: 'Steering', pending: 'Steering', unknown: 'Acceptance unknown',
  interrupted: 'Delivery unconfirmed', rejected: 'Not sent', cancelled: 'Cancelled',
})[status];

/** Presentation only: neither queue membership nor a user event acknowledges a draft. */
export class SteeringTranscript {
  private pending: PendingSteering[] = [];
  private seen = new Set<string>();
  private aliases = new Map<string, string>();
  private nextKey = 0;

  begin(id: string, text: string, status: SteeringStatus = 'sending', images?: ImageContent[], mode: SubmissionMode = 'steer'): void {
    this.pending.push({ key: `steering:${id}`, submissionId: id, text, status, images,
      kind: mode === 'followUp' ? 'followUp' : 'steering', steering: mode === 'steer',
    });
  }

  receipt(id: string, outcome: SubmissionOutcome): void {
    const index = this.pending.findIndex(item => item.submissionId === id);
    if (index < 0) return;
    this.pending[index].status = outcome === 'accepted' ? 'pending' : outcome === 'rejected' || outcome === 'cancelled' ? outcome : 'unknown';
  }

  /** Explicit live Pi correlation; content may have been normalized by the harness. */
  reconcile(id: string, userKey: string): void {
    const index = this.pending.findIndex(item => item.submissionId === id && eligible(item) && !!item.images?.length);
    if (index < 0) return;
    const [entry] = this.pending.splice(index, 1);
    this.aliases.set(userKey, entry.key);
    this.seen.add(userKey);
  }

  disconnect(): void {
    for (const entry of this.pending) {
      if (entry.status === 'sending') entry.status = 'unknown';
      else if (entry.status === 'pending') entry.status = 'interrupted';
    }
  }

  recover(texts: string[], kind: 'steering' | 'followUp' = 'steering'): void {
    // clear_queue returns occurrences, not a set: identical steers remain distinct.
    for (const text of texts) {
      const index = this.pending.findIndex(item => eligible(item) && item.kind === kind && (kind === 'followUp' || !item.images?.length) && sameText(item.text, text));
      if (index >= 0) this.pending.splice(index, 1);
    }
  }

  /** Apply every ordered snapshot, even when DOM painting is coalesced into one frame. */
  snapshot(messages: SteeringMessage[], steering?: string[], followUp?: string[]): void {
    for (const message of messages) {
      if (!message.key || this.seen.has(message.key)) continue;
      this.seen.add(message.key);
      if (message.role !== 'user') continue;
      const text = userText(message.content);
      const images = Array.isArray(message.content) ? message.content.filter(block => block?.type === 'image').map(block => ({ type: 'image', mimeType: block.mimeType, data: block.data })) : [];
      const candidates = this.pending.filter(item => eligible(item) && sameText(item.text, text) && JSON.stringify(item.images ?? []) === JSON.stringify(images));
      // Pi consumes steering before follow-ups; duplicates within each kind are FIFO.
      const entry = candidates.find(item => item.kind === 'steering') ?? candidates[0];
      if (!entry) continue;
      this.pending.splice(this.pending.indexOf(entry), 1);
      this.aliases.set(message.key, entry.key);
    }
    for (const [kind, texts] of [['steering', steering], ['followUp', followUp]] as const) {
      if (!texts) continue;
      const matched = new Set<PendingSteering>();
      for (const text of texts) {
        let entry = this.pending.find(item => !matched.has(item) && eligible(item) && item.kind === kind && sameText(item.text, text));
        if (!entry) {
          entry = { key: `steering:queue-${++this.nextKey}`, text, status: 'pending', kind, steering: kind === 'steering' };
          this.pending.push(entry);
        }
        matched.add(entry);
      }
      // Queue removal precedes consumption on Pi's wire. Keep the preview until
      // the actual user event or explicit clear_queue recovery, never infer delivery.
    }
  }

  project<T extends SteeringMessage>(messages: T[]): Array<T | SteeringMessage> {
    return [
      ...messages.map(message => this.aliases.has(message.key || '')
        ? { ...message, key: this.aliases.get(message.key!) } : message),
      ...this.pending.map(entry => ({ key: entry.key, role: 'user', content: entry.images?.length ? [{ type: 'text', text: entry.text }, ...entry.images] : entry.text, steeringStatus: entry.status,
        ...(entry.kind === 'followUp' ? { queued: true, sticky: entry.status === 'sending' || entry.status === 'pending' } : entry.steering ? { steering: true } : {}),
      })),
    ];
  }
}

function eligible(entry: PendingSteering): boolean {
  return entry.status !== 'rejected' && entry.status !== 'cancelled';
}
function sameText(a: string, b: string): boolean { return a.trim() === b.trim(); }
function userText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.flatMap(block => block?.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('');
}
