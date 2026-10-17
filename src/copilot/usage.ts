import { record } from './connection';
import type { CopilotUsageSeed } from './usage-seed';

export interface CopilotContextUsage { readonly currentTokens: number; readonly tokenLimit: number; }
export interface CopilotCreditUsage {
  readonly nanoAiu?: number;
  readonly status: 'complete' | 'partial' | 'unavailable' | 'unknown';
}
/** Concrete reported usage, not a universal billing or token-accounting schema. */
export interface CopilotUsage {
  readonly context?: CopilotContextUsage;
  readonly credits?: CopilotCreditUsage;
  /** Initial display values only, separate from authoritative measurements. */
  readonly provisional?: CopilotUsageSeed;
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function creditUsage(value: unknown): CopilotCreditUsage {
  if (value === null || value === undefined) return { status: 'unavailable' };
  if (!record(value)) throw new Error('Invalid Copilot usage metadata');
  if (value.totalNanoAiu !== null && value.totalNanoAiu !== undefined && !nonnegative(value.totalNanoAiu)) throw new Error('Invalid Copilot credit amount');
  const status = value.aiCreditsStatus === 'complete' || value.aiCreditsStatus === 'partial' || value.aiCreditsStatus === 'unavailable' ? value.aiCreditsStatus : 'unknown';
  const nanoAiu = nonnegative(value.totalNanoAiu) ? value.totalNanoAiu : undefined;
  // A missing amount, unavailable coverage, or an unqualified numeric zero is
  // not evidence of a free session. Old runtimes may omit the coverage field.
  if (status === 'unavailable' || nanoAiu === undefined || status === 'unknown' && nanoAiu === 0) return { status: 'unavailable' };
  return { status, nanoAiu };
}

/** Session-bound metadata consumer. Independent single-flight credit/context reads; no polling. */
export class CopilotUsageController {
  private state: CopilotUsage = {};
  private revision = 0;
  private inFlight = false;
  private disposed = false;
  private contextRevision = 0;
  private contextRequestRevision = 0;
  private contextInFlight = false;
  private seeded = false;
  private workObserved = false;
  constructor(private read: () => Promise<unknown>, private changed: () => void, private readContext?: () => Promise<unknown>) {}
  get snapshot(): CopilotUsage { return this.state; }
  seed(initial?: CopilotUsageSeed): void {
    if (this.disposed || this.seeded) return;
    this.seeded = true;
    if (!initial) return;
    const display = (mode: CopilotUsageSeed['credits']): CopilotUsageSeed['credits'] => this.workObserved && mode === 'zero' ? 'unknown' : mode;
    const provisional: CopilotUsageSeed = {
      credits: this.state.credits ? undefined : display(initial.credits),
      context: this.state.context ? undefined : display(initial.context),
    };
    if (!provisional.credits && !provisional.context) return;
    this.state = { ...this.state, provisional }; this.changed();
  }
  /** Local accepted Send or live SDK work, never an RPC receipt or replayed history. */
  workStarted(): void {
    if (this.disposed || this.workObserved) return;
    this.workObserved = true;
    // Fence pre-work snapshots, including explicit zero results that arrive late.
    this.revision++; this.contextRevision++; this.contextRequestRevision++;
    const previous = this.state.provisional;
    if (!previous || previous.credits !== 'zero' && previous.context !== 'zero') return;
    this.state = { ...this.state, provisional: {
      credits: previous.credits ? 'unknown' : undefined,
      context: previous.context ? 'unknown' : undefined,
    } };
    this.changed();
  }
  private keepUnreportedSeed(field: keyof CopilotUsageSeed): boolean {
    return !this.workObserved && this.state.provisional?.[field] === 'zero';
  }
  private withoutSeed(field: keyof CopilotUsageSeed): CopilotUsageSeed | undefined {
    const previous = this.state.provisional;
    if (!previous?.[field]) return previous;
    const next = { ...previous, [field]: undefined };
    return next.credits || next.context ? next : undefined;
  }
  private retireSeed(field: keyof CopilotUsageSeed): void {
    const provisional = this.withoutSeed(field);
    if (provisional === this.state.provisional) return;
    this.state = { ...this.state, provisional }; this.changed();
  }
  context(value: CopilotContextUsage): void {
    if (this.disposed || !nonnegative(value.currentTokens) || !nonnegative(value.tokenLimit)) return;
    // A live observation fences an older metadata result even when its values
    // match the currently mounted snapshot.
    this.contextRevision++;
    if (value.currentTokens === 0 && value.tokenLimit === 0 && this.keepUnreportedSeed('context')) return;
    const previous = this.state.context;
    const provisional = this.withoutSeed('context');
    if (previous && previous.currentTokens === value.currentTokens && previous.tokenLimit === value.tokenLimit && provisional === this.state.provisional) return;
    this.state = { ...this.state, context: { ...value }, provisional }; this.changed();
  }
  clearContext(): void {
    if (this.disposed) return;
    this.contextRevision++;
    // A windowless untouched seed belongs to no model yet. Drop measured context
    // on a model change, but do not turn startup model resolution into work.
    const provisional = this.keepUnreportedSeed('context') ? this.state.provisional : this.withoutSeed('context');
    if (!this.state.context && provisional === this.state.provisional) return;
    this.state = { ...this.state, context: undefined, provisional }; this.changed();
  }
  refresh(): void {
    if (this.disposed) return;
    this.revision++;
    if (!this.inFlight) void this.request();
  }
  refreshContext(): void {
    if (this.disposed || !this.readContext) return;
    this.contextRequestRevision++;
    if (!this.contextInFlight) void this.requestContext();
  }
  dispose(): void {
    this.disposed = true; this.revision++; this.contextRevision++;
    if (this.state.provisional) { this.state = { ...this.state, provisional: undefined }; this.changed(); }
  }
  private async requestContext(): Promise<void> {
    this.contextInFlight = true;
    const revision = this.contextRevision, requested = this.contextRequestRevision;
    const current = () => !this.disposed && revision === this.contextRevision && requested === this.contextRequestRevision;
    try {
      const value = await this.readContext!();
      if (current()) {
        if (record(value) && nonnegative(value.currentTokens) && nonnegative(value.tokenLimit))
          this.context({ currentTokens: value.currentTokens, tokenLimit: value.tokenLimit });
        else {
          const empty = value === null || value === undefined || record(value)
            && (value.currentTokens == null || value.currentTokens === 0) && (value.tokenLimit == null || value.tokenLimit === 0);
          if (!empty || !this.keepUnreportedSeed('context')) this.retireSeed('context');
        }
      }
    } catch {
      // A failed first read retires only its provisional display, never newer
      // live context, credit totals, drafts or conversation readiness.
      if (current()) this.retireSeed('context');
    } finally {
      this.contextInFlight = false;
      if (!this.disposed && requested !== this.contextRequestRevision) void this.requestContext();
    }
  }
  private async request(): Promise<void> {
    this.inFlight = true;
    const revision = this.revision;
    let credits: CopilotCreditUsage, value: unknown = undefined;
    let failed = false;
    try { value = await this.read(); credits = creditUsage(value); }
    catch { failed = true; credits = { status: 'unavailable' }; }
    // A successful uninitialized read is not evidence that an untouched session
    // has lost its seed. Never retain zero over reported positive usage or errors.
    const positive = record(value) && nonnegative(value.totalNanoAiu) && value.totalNanoAiu > 0;
    const keep = !failed && !positive && credits.status === 'unavailable' && this.keepUnreportedSeed('credits');
    const provisional = this.withoutSeed('credits');
    if (!this.disposed && revision === this.revision && !keep && (!this.state.credits || this.state.credits.nanoAiu !== credits.nanoAiu || this.state.credits.status !== credits.status || provisional !== this.state.provisional)) {
      this.state = { ...this.state, credits, provisional }; this.changed();
    }
    this.inFlight = false;
    // A usage event received during the read may describe newer accounting.
    // Discard that older result and coalesce all invalidations into one read.
    if (!this.disposed && revision !== this.revision) void this.request();
  }
}

// GitHub's published credit conversion, not model token rates or premium-request
// multipliers: 1 AIC = 10^9 nano-AIU and $0.01 USD equivalent (not an invoice).
const NANO_AIU_PER_CREDIT = 1_000_000_000;
const USD_PER_CREDIT = 0.01;
const compact = (tokens: number) => tokens >= 1_000_000 ? `${(tokens / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  : tokens >= 1_000 ? `${(tokens / 1_000).toFixed(1).replace(/\.0$/, '')}k` : String(Math.round(tokens));

export function presentCopilotUsage(usage?: CopilotUsage): { metrics?: string; metricsTitle?: string } {
  if (!usage) return {};
  const parts: string[] = [], details: string[] = [];
  if (usage.credits) {
    const { nanoAiu, status } = usage.credits;
    if (status === 'unavailable' || !nonnegative(nanoAiu) || status === 'unknown' && nanoAiu === 0) {
      parts.push('—');
      details.push('Copilot AI-credit accounting is unavailable; no zero-cost claim is implied.');
    } else {
      const credits = nanoAiu / NANO_AIU_PER_CREDIT, usd = credits * USD_PER_CREDIT;
      const partial = status !== 'complete';
      // Round a subtotal down so the displayed lower bound never exceeds it.
      const displayed = partial ? Math.floor(nanoAiu / 100_000_000) / 1000 : usd;
      parts.push(`${partial ? '≥' : '~'}$${displayed.toFixed(3)}`);
      details.push(`${credits.toLocaleString('en-US', { maximumFractionDigits: 9 })} AIC${partial ? ' reported subtotal' : ''}. ${status === 'partial' ? 'Partial accounting; total may be higher.' : status === 'unknown' ? 'Accounting coverage was not reported; total may be higher.' : 'Complete reported AI-credit accounting.'}`);
      details.push('USD equivalent at $0.01 per AIC; not necessarily an additional charge against your subscription allowance.');
    }
  } else if (usage.provisional?.credits) {
    parts.push(usage.provisional.credits === 'zero' ? '~$0.000' : '—');
    details.push(usage.provisional.credits === 'zero'
      ? 'Provisional new-session cost display; no AI-credit usage has been reported yet.'
      : 'AI-credit usage has not been reported yet.');
  }
  if (usage.context && nonnegative(usage.context.currentTokens) && nonnegative(usage.context.tokenLimit)) {
    const { currentTokens, tokenLimit } = usage.context;
    const percent = tokenLimit > 0 ? currentTokens / tokenLimit * 100 : NaN;
    parts.push(`${Number.isFinite(percent) ? `${percent.toFixed(1).replace(/\.0$/, '')}%` : '—'} / ${tokenLimit > 0 ? compact(tokenLimit) : '—'}`);
    details.push(`Context: ${currentTokens.toLocaleString('en-US', { maximumFractionDigits: 20 })} / ${tokenLimit > 0 ? tokenLimit.toLocaleString('en-US', { maximumFractionDigits: 20 }) : 'unknown limit'} tokens reported by Copilot.`);
  } else if (usage.provisional?.context) {
    parts.push(usage.provisional.context === 'zero' ? '0% / —' : '— / —');
    details.push(usage.provisional.context === 'zero'
      ? 'Provisional new-session context display; actual usage and window have not been reported yet.'
      : 'Context usage/window has not been reported yet.');
  } else if (usage.credits || usage.provisional?.credits) {
    parts.push('— / —');
    details.push('Context usage/window is not reported yet; no percentage or window size is inferred.');
  }
  return parts.length ? { metrics: parts.join(' · '), metricsTitle: details.join('\n') } : {};
}
