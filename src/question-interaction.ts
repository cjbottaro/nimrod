import type { RetainedSelectionRequest } from './command-palette';

export interface QuestionAnswer { answer: string; wasFreeform: boolean; }
export interface QuestionUi {
  document: Document;
  canPresent(): boolean;
  start(dismiss: () => void): RetainedSelectionRequest | undefined;
  input(question: string): Promise<string | undefined>;
  cancelInput(): void;
  changed(delta: number): void;
  banner(count: number, review: () => void): void;
  error(message: string): void;
}
/** Consumer-facing question presentation, not a harness request/response protocol. */
export interface QuestionPrompt {
  question: string;
  header?: string;
  choices: readonly { label: string; detail?: string }[];
  freeform: boolean;
  maxAnswerLength?: number;
}
interface Pending {
  maxAnswerLength?: number;
  question: string;
  preview: HTMLElement;
  choices: readonly { label: string; detail?: string }[];
  freeform: boolean;
  signal: AbortSignal;
  finish(value?: QuestionAnswer): void;
}
/** Retained question presentation shared by concrete adapters; payload meaning stays with them. */
export class QuestionInteraction {
  private pending: Pending[] = [];
  private page?: RetainedSelectionRequest;
  private shown?: Pending;
  private dismissed = false;
  private disposed = false;
  private inputGeneration = 0;
  private inputActive = false;
  constructor(private ui: QuestionUi) {}
  get pendingCount(): number { return this.pending.length; }

  request(request: QuestionPrompt, signal: AbortSignal): Promise<QuestionAnswer | undefined> {
    if (signal.aborted || this.disposed) return Promise.resolve(undefined);
    return new Promise(resolve => {
      let settled = false;
      const question = request.question;
      const preview = this.ui.document.createElement('div');
      preview.textContent = question;
      if (request.header) { const heading = this.ui.document.createElement('h3'); heading.textContent = request.header; preview.prepend(heading); }
      const entry: Pending = {
        question, preview, choices: request.choices,
        freeform: request.freeform, maxAnswerLength: request.maxAnswerLength, signal,
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
      ...entry.choices.map((choice, index) => ({ id: String(index), label: choice.label, ...(choice.detail === undefined ? {} : { detail: choice.detail }),
        run: () => { if (this.canChoose(entry)) entry.finish({ answer: choice.label, wasFreeform: false }); } })),
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
      if (!answer.trim() || entry.maxAnswerLength !== undefined && answer.length > entry.maxAnswerLength) {
        this.ui.error(!answer.trim() ? 'Enter a non-empty answer. The question is still waiting.' : `Use at most ${entry.maxAnswerLength} characters. The question is still waiting.`);
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
