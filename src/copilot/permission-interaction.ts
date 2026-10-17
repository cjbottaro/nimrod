import { permissionOptions, type PermissionDecision, type PermissionOption } from '../../copilot/permissions.mjs';
import type { RetainedSelectionRequest } from '../command-palette';
import { copilotPermissionPreview } from './permission-presentation';

export interface CopilotPermissionUi {
  document: Document;
  project?: string;
  canPresent(): boolean;
  start(dismiss: () => void): RetainedSelectionRequest | undefined;
  feedback(): Promise<string | undefined>;
  cancelFeedback(): void;
  changed(delta: number): void;
  banner(count: number, review: () => void): void;
  error(message: string): void;
}
interface Pending {
  preview: HTMLElement;
  options: PermissionOption[];
  signal: AbortSignal;
  finish(value?: PermissionDecision): void;
}
/** Connection-bound FIFO decisions outlive dismissal of their presentation.
 * A shared palette page owns modality/keys; this concrete owner retains SDK meaning.
 */
export class CopilotPermissionInteraction {
  private pending: Pending[] = [];
  private page?: RetainedSelectionRequest;
  private shown?: Pending;
  private dismissed = false;
  private disposed = false;
  private feedbackGeneration = 0;
  private feedbackActive = false;
  constructor(private ui: CopilotPermissionUi) {}
  get pendingCount(): number { return this.pending.length; }

  request(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<PermissionDecision | undefined> {
    if (signal.aborted || this.disposed) return Promise.resolve(undefined);
    return new Promise(resolve => {
      let settled = false;
      const entry: Pending = {
        preview: copilotPermissionPreview(this.ui.document, request, this.ui.project),
        options: permissionOptions(request), signal,
        finish: value => {
          if (settled) return;
          settled = true; signal.removeEventListener('abort', abort);
          if (entry === this.shown) this.cancelFeedback();
          this.pending.splice(this.pending.indexOf(entry), 1);
          this.ui.changed(-1); resolve(value); this.sync();
        },
      };
      const abort = () => entry.finish();
      signal.addEventListener('abort', abort, { once: true });
      if (!this.pending.length) this.dismissed = false;
      this.pending.push(entry); this.ui.changed(1); this.sync();
    });
  }
  /** Explicit navigation may reveal undismissed work; routine streaming never calls this. */
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
      if (!page) return; // Existing dialogs retain priority; the banner is already actionable.
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
    page.remaining(this.pending.length > 1 ? `${this.pending.length - 1} more` : 'Last request');
    if (this.shown === entry) return; // Arrival retains query, selection, preview/disclosures and child input.
    this.shown = entry;
    page.show({ items: [
      ...entry.options.map(option => ({ id: option.id, label: option.label,
        run: () => { if (this.canChoose(entry)) entry.finish(option.decision); } })),
      { id: 'deny', label: 'Deny', run: () => { if (this.canChoose(entry)) entry.finish({ kind: 'reject' }); } },
      { id: 'feedback', label: 'Deny with feedback…', detail: 'Give a reason or suggest what to do instead',
        run: () => this.denyWithFeedback(entry) },
    ] }, entry.preview);
  }
  private async denyWithFeedback(entry: Pending): Promise<void> {
    if (!this.canChoose(entry)) return;
    this.feedbackActive = true;
    const generation = ++this.feedbackGeneration;
    try {
      const feedback = await this.ui.feedback();
      if (generation !== this.feedbackGeneration) return;
      this.feedbackActive = false;
      if (!this.canChoose(entry)) return;
      if (feedback === undefined) { this.page?.focus(); return; }
      entry.finish({ kind: 'reject', ...(feedback.trim() ? { feedback: feedback.trim() } : {}) });
    } catch (error) {
      if (generation === this.feedbackGeneration) {
        this.feedbackActive = false; this.ui.error(String(error));
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
      // Close while the Review opener still exists; notice removal can then
      // restore its previous session control rather than leaving focus on body.
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
