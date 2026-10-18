import type { OperationCard } from '../operation-card';
import type { ImageContent } from '../image-attachments';
import type { SubmissionMode, SubmissionOutcome } from './composer-state';

export type SteeringStatus = 'sending' | 'pending' | 'unknown' | 'interrupted' | 'rejected' | 'cancelled';
export interface SteeringMessage {
  operation?: OperationCard;
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
  details?: string;
  anchor?: string;
  anchored?: boolean;
  connectionLost?: boolean;
}

/** Presentation only: neither queue membership nor a user event acknowledges a draft. */
export class SteeringTranscript {
  private pending: PendingSteering[] = [];
  private seen = new Set<string>();
  private aliases = new Map<string, { key: string; operation?: OperationCard }>();
  private tail?: string;
  private nextKey = 0;
  get hasConnectionOutcome(): boolean { return this.pending.some(entry => entry.connectionLost); }

  begin(id: string, text: string, status: SteeringStatus = 'sending', images?: ImageContent[], mode: SubmissionMode = 'steer'): void {
    this.pending.push({ key: `steering:${id}`, submissionId: id, text, status, images,
      kind: mode === 'followUp' ? 'followUp' : 'steering', steering: mode === 'steer',
    });
  }

  /** Returns whether the existing card owns this result (and its error details). */
  receipt(id: string, outcome: SubmissionOutcome, details?: string): boolean {
    const index = this.pending.findIndex(item => item.submissionId === id);
    if (index < 0) return false;
    if (outcome === 'cancelled') { this.pending.splice(index, 1); return true; }
    const entry = this.pending[index];
    // A late enqueue acknowledgement cannot revive a terminal/uncertain card.
    // Only an actual user event can establish delivery after uncertainty.
    if (outcome === 'accepted' && entry.anchored) return true;
    entry.status = outcome === 'accepted' ? 'pending' : outcome === 'rejected' ? 'rejected' : 'unknown';
    if (details) entry.details = details;
    if (outcome !== 'accepted') this.settle(entry);
    return true;
  }

  private settle(entry: PendingSteering): void {
    if (entry.anchored) return;
    entry.anchor = this.tail; entry.anchored = true;
  }
  private adopt(entry: PendingSteering, key: string): void {
    this.aliases.set(key, { key: entry.key, operation: operation(entry, 'succeeded') });
  }

  /** Explicit integration-owned live correlation; content may have been normalized. */
  reconcile(id: string, userKey: string): void {
    const index = this.pending.findIndex(item => item.submissionId === id && eligible(item) && !!item.images?.length);
    if (index < 0) return;
    const [entry] = this.pending.splice(index, 1);
    this.adopt(entry, userKey);
    this.seen.add(userKey);
  }

  disconnect(): void {
    for (const entry of this.pending) {
      if (entry.status === 'unknown' || entry.status === 'interrupted') entry.connectionLost = true;
      if (entry.status === 'sending' || entry.status === 'pending') {
        entry.connectionLost = true;
        entry.status = entry.status === 'sending' ? 'unknown' : 'interrupted';
        entry.details ||= 'The connection ended before the agent confirmed delivery. Nothing was replayed.';
        this.settle(entry);
      }
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
    this.tail = messages.at(-1)?.key;
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
      this.adopt(entry, message.key);
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
    const keys = new Set(messages.map(message => message.key));
    const settled = new Map<string | undefined, SteeringMessage[]>(), pending: SteeringMessage[] = [];
    for (const entry of this.pending) {
      const card = operation(entry);
      const row: SteeringMessage = { key: entry.key, role: 'user',
        content: entry.images?.length ? [{ type: 'text', text: entry.text }, ...entry.images] : entry.text,
        steeringStatus: entry.status, operation: card,
        ...(entry.kind === 'followUp' ? { queued: true } : entry.steering ? { steering: true } : {}),
        sticky: card?.state === 'pending',
      };
      if (!entry.anchored) { pending.push(row); continue; }
      if (entry.anchor !== undefined && !keys.has(entry.anchor)) entry.anchor = messages.at(-1)?.key;
      const rows = settled.get(entry.anchor) || []; rows.push(row); settled.set(entry.anchor, rows);
    }
    const result: Array<T | SteeringMessage> = [...(settled.get(undefined) || [])];
    settled.delete(undefined);
    for (const message of messages) {
      const alias = this.aliases.get(message.key || '');
      result.push(alias ? { ...message, ...alias } : message);
      if (settled.has(message.key)) { result.push(...settled.get(message.key)!); settled.delete(message.key); }
    }
    return [...result, ...pending];
  }
}

function operation(entry: PendingSteering, state?: OperationCard['state']): OperationCard | undefined {
  const pending = entry.status === 'sending' || entry.status === 'pending';
  if (entry.kind !== 'followUp' && !entry.steering && (pending || state === 'succeeded')) return undefined;
  return { title: entry.kind === 'followUp' ? 'Queued' : entry.steering ? 'Steering' : 'Message',
    state: state ?? (pending ? 'pending' : entry.status === 'rejected' ? 'failed' : entry.status === 'cancelled' ? 'not-applied' : 'unknown'),
    details: state === 'succeeded' ? undefined : entry.details };
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
