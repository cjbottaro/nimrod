import type { SubmissionOutcome } from './composer-state';

export type SteeringStatus = 'sending' | 'pending' | 'unknown' | 'interrupted' | 'rejected' | 'cancelled';
export interface SteeringMessage {
  key?: string;
  role?: string;
  content?: unknown;
  steeringStatus?: SteeringStatus;
}
interface PendingSteering {
  key: string;
  text: string;
  submissionId?: string;
  status: SteeringStatus;
}

export const steeringStatusLabel = (status: SteeringStatus): string => ({
  sending: 'Sending…', pending: 'Pending steering', unknown: 'Acceptance unknown',
  interrupted: 'Delivery unconfirmed', rejected: 'Not sent', cancelled: 'Cancelled',
})[status];

/** Presentation only: neither queue membership nor a user event acknowledges a draft. */
export class SteeringTranscript {
  private pending: PendingSteering[] = [];
  private seen = new Set<string>();
  private aliases = new Map<string, string>();
  private nextKey = 0;

  begin(id: string, text: string, status: SteeringStatus = 'sending'): void {
    this.pending.push({ key: `steering:${id}`, submissionId: id, text, status });
  }

  receipt(id: string, outcome: SubmissionOutcome): void {
    const entry = this.pending.find(item => item.submissionId === id);
    if (entry) entry.status = outcome === 'accepted' ? 'pending' : outcome;
  }

  disconnect(): void {
    for (const entry of this.pending) {
      if (entry.status === 'sending') entry.status = 'unknown';
      else if (entry.status === 'pending') entry.status = 'interrupted';
    }
  }

  recover(texts: string[]): void {
    // clear_queue returns occurrences, not a set: identical steers remain distinct.
    for (const text of texts) {
      const index = this.pending.findIndex(item => eligible(item) && sameText(item.text, text));
      if (index >= 0) this.pending.splice(index, 1);
    }
  }

  /** Apply every ordered snapshot, even when DOM painting is coalesced into one frame. */
  snapshot(messages: SteeringMessage[], steering?: string[]): void {
    for (const message of messages) {
      if (!message.key || this.seen.has(message.key)) continue;
      this.seen.add(message.key);
      if (message.role !== 'user') continue;
      const text = userText(message.content);
      const index = this.pending.findIndex(item => eligible(item) && sameText(item.text, text));
      if (index < 0) continue;
      const [entry] = this.pending.splice(index, 1);
      this.aliases.set(message.key, entry.key);
    }
    if (steering) {
      const matched = new Set<PendingSteering>();
      for (const text of steering) {
        let entry = this.pending.find(item => !matched.has(item) && eligible(item) && sameText(item.text, text));
        if (!entry) {
          entry = { key: `steering:queue-${++this.nextKey}`, text, status: 'pending' };
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
      ...this.pending.map(entry => ({ key: entry.key, role: 'user', content: entry.text, steeringStatus: entry.status })),
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
