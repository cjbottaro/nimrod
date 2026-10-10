import { SessionAttention } from './session-attention';
import { nextLastUsed, recentSessions } from './session-recency';

export const SESSION_VIEWS = ['all', 'unread', 'working'] as const;
export type SessionView = typeof SESSION_VIEWS[number];
export type SelectionIntent = 'explicit' | 'row' | 'restore' | 'cleanup' | 'notification';
export interface NavigationSession { id: string; lastUsed: number; }
export interface NavigationPolicy<T> {
  needsAttention(session: T): boolean;
  isWorking(session: T): boolean;
  isConnected(session: T): boolean;
}
export interface NavigationSnapshot<T> {
  all: readonly T[];
  visible: readonly T[];
  view: SessionView;
  selected?: T;
}
export interface SelectionPlan<T> {
  target: T;
  view: SessionView;
  focus: boolean;
  reveal: boolean;
  connect: boolean;
}

/** Project-local navigation policy. No DOM, harness requests, persistence or focus effects.
 * The shell applies plans to mounted conversations; consumers never own ordering.
 */
export class SessionNavigation<T extends NavigationSession> {
  private sessions: T[] = [];
  private unread = new SessionAttention();
  private working = new SessionAttention();

  constructor(private policy: NavigationPolicy<T>) {}

  /** Stable insertion order is only for lifecycle/storage and canonical-order ties. */
  open(): readonly T[] { return this.sessions; }
  has(session: T): boolean { return this.sessions.includes(session); }
  add(session: T): void {
    if (this.sessions.some(item => item.id === session.id)) throw new Error(`Session already open: ${session.id}`);
    this.sessions.push(session);
  }
  remove(session: T): void {
    const index = this.sessions.indexOf(session);
    if (index >= 0) this.sessions.splice(index, 1);
  }
  all(): readonly T[] { return recentSessions(this.sessions); }
  nextRecency(now = Date.now()): number { return nextLastUsed(this.sessions, now); }

  snapshot(view: SessionView, presented?: T, selected?: T): NavigationSnapshot<T> {
    const all = this.all();
    const unread = this.unread.reconcile(this.sessions.map(session => ({ id: session.id, needsAttention: this.policy.needsAttention(session) })), presented?.id);
    const working = new Set(this.working.reconcile(this.sessions.map(session => ({ id: session.id, needsAttention: this.policy.isWorking(session) })), view === 'working' ? presented?.id : undefined));
    const byId = new Map(this.sessions.map(session => [session.id, session]));
    const visible = view === 'unread' ? unread.map(id => byId.get(id)!) : all.filter(session => view === 'all' || working.has(session.id));
    return { all, visible, view, selected };
  }
  counts(): Record<SessionView, number> {
    return { all: this.sessions.length, unread: this.sessions.filter(session => this.policy.needsAttention(session)).length, working: this.sessions.filter(session => this.policy.isWorking(session)).length };
  }
  presented(snapshot: NavigationSnapshot<T>, selected = snapshot.selected): T | undefined {
    return selected && snapshot.visible.includes(selected) ? selected : undefined;
  }
  /** All-open cycling and visible-row focus navigation use the same projections. */
  adjacent(current: T | undefined, direction: 1 | -1, order: readonly T[] = this.all()): T | undefined {
    if (!order.length) return;
    const index = current ? order.indexOf(current) : -1;
    if (index < 0) return direction === 1 ? order[0] : order[order.length - 1];
    return order[(index + direction + order.length) % order.length];
  }
  selection(target: T, snapshot: NavigationSnapshot<T>, intent: SelectionIntent): SelectionPlan<T> | undefined {
    if (!this.has(target)) return;
    const explicit = intent === 'explicit' || intent === 'row' || intent === 'notification';
    return {
      target, view: explicit && !snapshot.visible.includes(target) ? 'all' : snapshot.view,
      focus: intent !== 'restore', reveal: intent === 'explicit' || intent === 'notification',
      connect: intent !== 'cleanup' && intent !== 'notification',
    };
  }
  /** Capture before removal; resolve once after the whole batch is removed. */
  replacement(before: NavigationSnapshot<T>, after: NavigationSnapshot<T>): { target?: T; view: SessionView } {
    if (before.selected && this.has(before.selected)) return { target: before.selected, view: after.view };
    const visible = new Set(after.visible);
    let target = after.all.find(session => visible.has(session) && this.policy.isConnected(session));
    if (target) return { target, view: after.view };
    target = after.all.find(session => this.policy.isConnected(session));
    if (target) return { target, view: 'all' };
    const positional = (order: readonly T[], candidates: readonly T[]) => {
      const index = before.selected ? order.indexOf(before.selected) : -1, allowed = new Set(candidates);
      return order.slice(index + 1).find(session => allowed.has(session)) || order.slice(0, Math.max(0, index)).reverse().find(session => allowed.has(session)) || candidates[0];
    };
    target = positional(before.visible, after.visible);
    if (target || after.view === 'all') return { target, view: after.view };
    return { target: positional(before.all, after.all), view: 'all' };
  }
}
