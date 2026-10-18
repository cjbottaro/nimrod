import type { RetainedSelectionRequest } from '../command-palette';

export interface CopilotAnswer { answer: string; wasFreeform: boolean; }
export interface CopilotQuestionUi {
  document: Document;
  canPresent(): boolean;
  start(dismiss: () => void): RetainedSelectionRequest | undefined;
  input(question: string): Promise<string | undefined>;
  cancelInput(): void;
  changed(delta: number): void;
  banner(count: number, review: () => void): void;
  error(message: string): void;
}
interface Pending {
  question: string;
  preview: HTMLElement;
  choices: string[];
  freeform: boolean;
  signal: AbortSignal;
  finish(value?: CopilotAnswer): void;
}
/** Copilot input callbacks outlive their presentation, just like permission callbacks.
 * The shared palette and Dialogs own modality; this owner retains question semantics.
 */
export class CopilotQuestionInteraction {
  private pending: Pending[] = [];
  private page?: RetainedSelectionRequest;
  private shown?: Pending;
  private dismissed = false;
  private disposed = false;
  private inputGeneration = 0;
  private inputActive = false;
  constructor(private ui: CopilotQuestionUi) {}
  get pendingCount(): number { return this.pending.length; }

  request(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<CopilotAnswer | undefined> {
    if (signal.aborted || this.disposed) return Promise.resolve(undefined);
    return new Promise(resolve => {
      let settled = false;
      const question = typeof request.question === 'string' ? request.question : 'Copilot requests input';
      const preview = this.ui.document.createElement('div');
      preview.textContent = question;
      const entry: Pending = {
        question, preview, choices: Array.isArray(request.choices) ? request.choices.filter((value): value is string => typeof value === 'string') : [],
        freeform: request.allowFreeform !== false, signal,
        finish: value => {
          if (settled) return;
          settled = true; signal.removeEventListener('abort', abort);
          if (entry === this.shown) this.cancelInput();
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
        this.page = undefined; this.shown = undefined; this.dismissed = true; this.cancelInput();
      });
      if (!page) return;
      this.page = page;
    }
    this.show();
  }
  private canChoose(entry: Pending): boolean {
    return !this.disposed && !entry.signal.aborted && !this.inputActive && this.ui.canPresent()
      && this.page?.isCurrent() === true && this.pending[0] === entry;
  }
  private show(): void {
    const entry = this.pending[0], page = this.page;
    if (!entry || !page?.isCurrent()) return;
    page.remaining(this.pending.length > 1 ? `${this.pending.length - 1} more` : 'Last question');
    if (this.shown === entry) return;
    this.shown = entry;
    page.show({ items: [
      ...entry.choices.map((answer, index) => ({ id: String(index), label: answer,
        run: () => { if (this.canChoose(entry)) entry.finish({ answer, wasFreeform: false }); } })),
      ...(entry.freeform ? [{ id: 'freeform', label: 'Enter your own answer…', run: () => this.enterAnswer(entry) }] : []),
    ] }, entry.preview);
  }
  private async enterAnswer(entry: Pending): Promise<void> {
    if (!this.canChoose(entry)) return;
    this.inputActive = true;
    const generation = ++this.inputGeneration;
    try {
      const answer = await this.ui.input(entry.question);
      if (generation !== this.inputGeneration) return;
      this.inputActive = false;
      if (!this.canChoose(entry)) return;
      if (answer === undefined) { this.page?.focus(); return; }
      if (!answer.trim()) {
        this.ui.error('Enter a non-empty answer. The question is still waiting.');
        this.page?.focus(); return;
      }
      entry.finish({ answer, wasFreeform: true });
    } catch (error) {
      if (generation === this.inputGeneration) {
        this.inputActive = false; this.ui.error(String(error)); this.page?.focus();
      }
    }
  }
  private cancelInput(): void {
    this.inputGeneration++; this.inputActive = false; this.ui.cancelInput();
  }
  private suspend(): void {
    const dismissed = this.dismissed;
    this.cancelInput(); this.page?.cancel(); this.page = undefined; this.shown = undefined;
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
