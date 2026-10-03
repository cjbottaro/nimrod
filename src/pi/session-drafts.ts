import { restoreComposerState } from './webview-state';

export const SESSION_STORAGE_KEY = 'nimrod.sessions.v1';
export interface LastSession { path: string; cwd: string; sessionId: string; }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};

/** Only local composer state and a resume pointer, never Pi history. */
export class SessionDrafts {
  private drafts: Record<string, unknown>;
  private active = 'legacy';
  private metadata: { last?: LastSession } = {};
  get last(): LastSession | undefined { return this.metadata.last; }
  set last(value: LastSession | undefined) { this.metadata.last = value; }
  constructor(value: unknown, legacy: unknown, private persist: (value: unknown) => void) {
    const raw = record(value);
    this.drafts = { ...record(raw.drafts) };
    if (!Object.hasOwn(this.drafts, 'legacy') && legacy) this.drafts.legacy = legacy;
    const last = record(raw.last);
    if (typeof last.path === 'string' && typeof last.cwd === 'string' && typeof last.sessionId === 'string') {
      this.last = { path: last.path, cwd: last.cwd, sessionId: last.sessionId };
    }
  }
  /** Separate tab selection, shared window-local library; no stale whole-library writes. */
  fork(): SessionDrafts {
    const fork = new SessionDrafts(undefined, undefined, this.persist);
    fork.drafts = this.drafts;
    fork.metadata = this.metadata;
    return fork;
  }
  read(): unknown { return this.drafts[this.active]; }
  write(value: unknown): void { this.drafts[this.active] = value; this.flush(); }
  select(key: string, copyFrom?: string): unknown {
    this.active = key;
    if (copyFrom) this.drafts[key] = this.drafts[copyFrom];
    return this.read();
  }
  bind(path: string): void {
    const key = `file:${path}`;
    if (this.active === key) return;
    // Only promote a fresh session's provisional identity, never another session's draft.
    if (!this.active.startsWith('unassigned:')) throw new Error('Unexpected session file change');
    if (Object.hasOwn(this.drafts, key)) throw new Error('Session already has a local draft; resume it explicitly');
    this.drafts[key] = this.read();
    delete this.drafts[this.active];
    this.active = key;
    this.flush();
  }
  remember(last: LastSession): void { this.last = last; this.flush(); }
  recoverable(): { key: string; label: string }[] {
    return Object.entries(this.drafts).flatMap(([key, value]) => {
      if (key !== 'legacy' && !key.startsWith('unassigned:') && !key.startsWith('temporary:') && !key.startsWith('demo:')) return [];
      const state = restoreComposerState(value);
      const text = state.draft || state.submission?.text || state.recovered[0]?.text;
      const label = key === 'legacy' ? 'Previous PoC draft' : key.startsWith('temporary:') ? 'Temporary-session draft' : key.startsWith('demo:') ? 'Offline-demo draft' : 'Unassigned session draft';
      return text ? [{ key, label: `${label}: ${text.slice(0, 100)}` }] : [];
    });
  }
  private flush(): void { this.persist({ version: 1, drafts: this.drafts, last: this.last }); }
}
