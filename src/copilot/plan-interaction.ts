import type { RetainedSelectionRequest } from '../command-palette';
import { createSafeMarkdownRenderer, type SafeMarkdownRenderer } from '../pi/safe-markdown';

export interface CopilotPlanDecision { approved: boolean; selectedAction?: string; feedback?: string; }
export interface CopilotPlanUi {
  document: Document;
  canPresent(): boolean;
  start(dismiss: () => void): RetainedSelectionRequest | undefined;
  feedback(revision: boolean, current: string): Promise<string | undefined>;
  cancelFeedback(): void;
  openLink(href: string): Promise<unknown>;
  changed(delta: number): void;
  banner(count: number, review: () => void): void;
  error(message: string): void;
}
interface Pending {
  actions: string[];
  recommended?: string;
  preview: HTMLElement;
  feedback: string;
  feedbackPreview: HTMLElement;
  signal: AbortSignal;
  finish(value?: CopilotPlanDecision): void;
}
export function copilotPlanActionLabel(action: string): string {
  return action === 'interactive' ? 'Continue interactively' : action === 'autopilot' ? 'Continue with Autopilot'
    : action === 'exit_only' ? 'Finish planning' : action;
}
/** Retain the SDK plan callback independently of its picker. No continuation prompts or mode mutations. */
export class CopilotPlanInteraction {
  private pending: Pending[] = [];
  private page?: RetainedSelectionRequest;
  private shown?: Pending;
  private dismissed = false;
  private disposed = false;
  private feedbackGeneration = 0;
  private feedbackActive = false;
  private markdown: SafeMarkdownRenderer;
  constructor(private ui: CopilotPlanUi) {
    this.markdown = createSafeMarkdownRenderer(ui.document.defaultView!);
  }
  get pendingCount(): number { return this.pending.length; }

  request(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<CopilotPlanDecision | undefined> {
    if (signal.aborted || this.disposed) return Promise.resolve(undefined);
    if (!Array.isArray(request.actions) || !request.actions.length
      || !request.actions.every(action => typeof action === 'string' && action.length > 0))
      return Promise.reject(new Error('Copilot did not supply valid plan continuation choices.'));
    const actions = [...request.actions] as string[];
    return new Promise(resolve => {
      let settled = false;
      const preview = this.ui.document.createElement('div'); preview.className = 'copilot-plan-preview typography-prose';
      preview.tabIndex = 0; preview.setAttribute('aria-label', 'Copilot plan');
      const plan = this.ui.document.createElement('div'); plan.className = 'markdown';
      plan.innerHTML = this.markdown.render(typeof request.planContent === 'string' && request.planContent
        ? request.planContent : typeof request.summary === 'string' ? request.summary : 'Copilot finished planning.');
      // This is a review preview, not a second transcript/code-action owner.
      for (const toolbar of plan.querySelectorAll('.code-block-header')) toolbar.remove();
      const feedbackPreview = this.ui.document.createElement('p'); feedbackPreview.hidden = true;
      preview.append(plan, feedbackPreview);
      const entry: Pending = {
        actions, preview, feedbackPreview, feedback: '', signal,
        recommended: typeof request.recommendedAction === 'string' && actions.includes(request.recommendedAction) ? request.recommendedAction : undefined,
        finish: value => {
          if (settled) return;
          settled = true; signal.removeEventListener('abort', abort);
          if (entry === this.shown) this.cancelFeedback();
          this.pending.splice(this.pending.indexOf(entry), 1);
          this.ui.changed(-1); resolve(value); this.sync();
        },
      };
      preview.addEventListener('click', event => {
        const link = (event.target as Element).closest<HTMLAnchorElement>('a[href]');
        if (!link) return;
        event.preventDefault();
        if (this.canChoose(entry)) void this.ui.openLink(link.getAttribute('href')!).catch(error => this.ui.error(String(error)));
      });
      const abort = () => entry.finish();
      signal.addEventListener('abort', abort, { once: true });
      if (!this.pending.length) this.dismissed = false;
      this.pending.push(entry); this.ui.changed(1); this.sync();
    });
  }
  setActive(active: boolean): void {
    if (!active) this.suspend();
    else if (!this.dismissed) this.open();
  }
  review(): void {
    if (this.disposed || !this.pending.length || !this.ui.canPresent()) return;
    this.dismissed = false; this.open();
  }
  private open(): void {
    if (this.disposed || !this.pending.length || this.dismissed || !this.ui.canPresent()) return;
    if (!this.page?.isCurrent()) {
      const page = this.ui.start(() => {
        this.page = undefined; this.shown = undefined; this.dismissed = true; this.cancelFeedback();
      });
      if (!page) return;
      this.page = page;
    }
    this.show();
  }
  private canChoose(entry: Pending): boolean {
    return !this.disposed && !entry.signal.aborted && !this.feedbackActive && this.ui.canPresent()
      && this.page?.isCurrent() === true && this.pending[0] === entry;
  }
  private show(): void {
    const entry = this.pending[0], page = this.page;
    if (!entry || !page?.isCurrent()) return;
    page.remaining(this.pending.length > 1 ? `${this.pending.length - 1} more` : 'Plan review');
    if (this.shown === entry) return;
    this.shown = entry;
    page.show({ items: [
      ...entry.actions.map((action, index) => ({ id: `action:${index}`, label: copilotPlanActionLabel(action),
        badge: action === entry.recommended ? 'Recommended' : undefined,
        run: () => { if (this.canChoose(entry)) entry.finish({ approved: true, selectedAction: action, ...(entry.feedback ? { feedback: entry.feedback } : {}) }); } })),
      { id: 'feedback', label: entry.feedback ? 'Edit feedback…' : 'Add feedback…', detail: 'Optional feedback to accompany approval', run: () => this.enterFeedback(entry, false) },
      { id: 'revise', label: 'Request changes…', detail: 'Return feedback without approving implementation', run: () => this.enterFeedback(entry, true) },
      { id: 'decline', label: 'Decline plan', detail: 'Decline this request without submitting feedback',
        run: () => { if (this.canChoose(entry)) entry.finish({ approved: false }); } },
    ] }, entry.preview);
  }
  private async enterFeedback(entry: Pending, revision: boolean): Promise<void> {
    if (!this.canChoose(entry)) return;
    this.feedbackActive = true;
    const generation = ++this.feedbackGeneration;
    try {
      const value = await this.ui.feedback(revision, entry.feedback);
      if (generation !== this.feedbackGeneration) return;
      this.feedbackActive = false;
      if (!this.canChoose(entry)) return;
      if (value === undefined) { this.page?.focus(); return; }
      const feedback = value.trim();
      if (revision) {
        if (!feedback) { this.ui.error('Enter the requested changes. The plan is still waiting for review.'); this.page?.focus(); return; }
        entry.finish({ approved: false, feedback });
      } else {
        entry.feedback = feedback;
        entry.feedbackPreview.textContent = feedback ? `Feedback: ${feedback}` : '';
        entry.feedbackPreview.hidden = !feedback;
        this.shown = undefined; this.show(); this.page?.focus();
      }
    } catch (error) {
      if (generation === this.feedbackGeneration) {
        this.feedbackActive = false; this.ui.error(String(error)); this.page?.focus();
      }
    }
  }
  private cancelFeedback(): void {
    this.feedbackGeneration++; this.feedbackActive = false; this.ui.cancelFeedback();
  }
  private suspend(): void {
    const dismissed = this.dismissed;
    this.cancelFeedback(); this.page?.cancel(); this.page = undefined; this.shown = undefined;
    this.dismissed = dismissed;
  }
  private sync(): void {
    if (!this.pending.length) {
      this.suspend(); this.ui.banner(0, () => this.review()); this.dismissed = false; return;
    }
    this.ui.banner(this.pending.length, () => this.review());
    if (this.page?.isCurrent()) this.show();
    else if (!this.dismissed) this.open();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.suspend();
    for (const entry of [...this.pending]) entry.finish();
  }
}
