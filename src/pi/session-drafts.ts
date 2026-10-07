import { restoreComposerState } from './webview-state';

export const SESSION_STORAGE_KEY = 'nimrod.sessions.v1';
export interface LastSession { path: string; cwd: string; sessionId: string; }
const record = (v: unknown): Record<string, unknown> => v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const ephemeral = (key: string): boolean => key.startsWith('temporary:') || key.startsWith('demo:');

/** Purge confirmed-success file scopes, including closed project libraries. */
export function purgeDeletedDrafts(storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'setItem'>, files: string[]): void {
  const deleted = new Set(files);
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index)).filter((key): key is string => !!key && (key === SESSION_STORAGE_KEY || key.startsWith(`${SESSION_STORAGE_KEY}:`)));
  for (const key of keys) {
    const text = storage.getItem(key);
    if (!text) continue;
    let library: Record<string, unknown>;
    try { library = record(JSON.parse(text)); } catch { continue; }
    const drafts = record(library.drafts); let changed = false;
    for (const file of deleted) if (Object.hasOwn(drafts, `file:${file}`)) { delete drafts[`file:${file}`]; changed = true; }
    if (typeof record(library.last).path === 'string' && deleted.has(record(library.last).path as string)) { delete library.last; changed = true; }
    if (changed) storage.setItem(key, JSON.stringify(library));
  }
}

/** Only local composer state and a resume pointer, never Pi history. */
export class SessionDrafts {
  private drafts: Record<string, unknown>;
  private active = 'legacy';
  private discarded = false;
  private metadata: { last?: LastSession } = {};
  get last(): LastSession | undefined { return this.metadata.last; }
  set last(value: LastSession | undefined) { this.metadata.last = value; }
  constructor(value: unknown, legacy: unknown, private persist: (value: unknown) => void) {
    const raw = record(value);
    // Older builds persisted temporary/demo drafts; they are no longer recoverable.
    this.drafts = Object.fromEntries(Object.entries(record(raw.drafts)).filter(([key]) => !ephemeral(key)));
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
  read(): unknown { return this.discarded ? undefined : this.drafts[this.active]; }
  write(value: unknown): void {
    if (this.discarded) return;
    this.drafts[this.active] = value;
    this.flush();
  }
  /** Retire runtime-only state after the owned child has stopped and the view is disposed. */
  discardTemporary(): void {
    if (!ephemeral(this.active)) return;
    this.discarded = true;
    delete this.drafts[this.active];
    this.flush();
  }
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
  deleteFile(path: string): void {
    delete this.drafts[`file:${path}`];
    if (this.last?.path === path) this.last = undefined;
    this.flush();
  }
  recoverable(): { key: string; label: string }[] {
    return Object.entries(this.drafts).flatMap(([key, value]) => {
      if (key !== 'legacy' && !key.startsWith('unassigned:')) return [];
      const state = restoreComposerState(value);
      const text = state.draft || state.submission?.text || state.recovered[0]?.text;
      const label = key === 'legacy' ? 'Previous PoC draft' : 'Unassigned session draft';
      return text ? [{ key, label: `${label}: ${text.slice(0, 100)}` }] : [];
    });
  }
  private flush(): void {
    // Sibling saved-session writes must never serialize a live temporary draft.
    const drafts = Object.fromEntries(Object.entries(this.drafts).filter(([key]) => !ephemeral(key)));
    this.persist({ version: 1, drafts, last: this.last });
  }
}
