import { record } from './connection';

export interface CopilotContextUsage { readonly currentTokens: number; readonly tokenLimit: number; }
export interface CopilotCreditUsage {
  readonly nanoAiu?: number;
  readonly status: 'complete' | 'partial' | 'unavailable' | 'unknown';
}
/** Concrete reported usage, not a universal billing or token-accounting schema. */
export interface CopilotUsage {
  readonly context?: CopilotContextUsage;
  readonly credits?: CopilotCreditUsage;
}
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;
function creditUsage(value: unknown): CopilotCreditUsage {
  if (!record(value)) return { status: 'unavailable' };
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
  constructor(private read: () => Promise<unknown>, private changed: () => void, private readContext?: () => Promise<unknown>) {}
  get snapshot(): CopilotUsage { return this.state; }
  context(value: CopilotContextUsage): void {
    if (this.disposed || !nonnegative(value.currentTokens) || !nonnegative(value.tokenLimit)) return;
    // A live observation fences an older metadata result even when its values
    // match the currently mounted snapshot.
    this.contextRevision++;
    const previous = this.state.context;
    if (previous && previous.currentTokens === value.currentTokens && previous.tokenLimit === value.tokenLimit) return;
    this.state = { ...this.state, context: { ...value } }; this.changed();
  }
  clearContext(): void {
    if (this.disposed) return;
    this.contextRevision++;
    if (!this.state.context) return;
    this.state = { ...this.state, context: undefined }; this.changed();
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
  dispose(): void { this.disposed = true; this.revision++; this.contextRevision++; }
  private async requestContext(): Promise<void> {
    this.contextInFlight = true;
    const revision = this.contextRevision, requested = this.contextRequestRevision;
    try {
      const value = await this.readContext!();
      if (!this.disposed && revision === this.contextRevision && requested === this.contextRequestRevision
        && record(value) && nonnegative(value.currentTokens) && nonnegative(value.tokenLimit))
        this.context({ currentTokens: value.currentTokens, tokenLimit: value.tokenLimit });
    } catch {
      // Optional context can be uninitialized/unavailable on cold resume. Never
      // replace a newer live observation, discard credit totals or send a prompt.
    } finally {
      this.contextInFlight = false;
      if (!this.disposed && requested !== this.contextRequestRevision) void this.requestContext();
    }
  }
  private async request(): Promise<void> {
    this.inFlight = true;
    const revision = this.revision;
    let credits: CopilotCreditUsage;
    try { credits = creditUsage(await this.read()); }
    catch { credits = { status: 'unavailable' }; }
    if (!this.disposed && revision === this.revision && (!this.state.credits || this.state.credits.nanoAiu !== credits.nanoAiu || this.state.credits.status !== credits.status)) {
      this.state = { ...this.state, credits }; this.changed();
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
      parts.push('cost unavailable');
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
  }
  if (usage.context && nonnegative(usage.context.currentTokens) && nonnegative(usage.context.tokenLimit)) {
    const { currentTokens, tokenLimit } = usage.context;
    const percent = tokenLimit > 0 ? currentTokens / tokenLimit * 100 : NaN;
    parts.push(`${Number.isFinite(percent) ? `${percent.toFixed(1).replace(/\.0$/, '')}%` : '—'} / ${tokenLimit > 0 ? compact(tokenLimit) : '—'}`);
    details.push(`Context: ${currentTokens.toLocaleString('en-US', { maximumFractionDigits: 20 })} / ${tokenLimit > 0 ? tokenLimit.toLocaleString('en-US', { maximumFractionDigits: 20 }) : 'unknown limit'} tokens reported by Copilot.`);
  } else if (usage.credits) {
    parts.push('— / —');
    details.push('Context usage/window is not reported yet; no percentage or window size is inferred.');
  }
  return parts.length ? { metrics: parts.join(' · '), metricsTitle: details.join('\n') } : {};
}
