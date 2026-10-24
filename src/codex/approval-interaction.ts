import type { RetainedSelectionRequest } from '../command-palette';
import type { CodexApproval, CodexApprovalDecision } from './protocol';
export interface CodexApprovalUi {
  document: Document;
  canPresent(): boolean;
  start(dismiss: () => void): RetainedSelectionRequest | undefined;
  changed(delta: number): void;
  banner(count: number, review: () => void): void;
}
interface Pending { request: CodexApproval; preview: HTMLElement; signal: AbortSignal; finish(value: CodexApprovalDecision): void; }
/** Codex request lifetimes are independent from retained palette presentation. */
export class CodexApprovalInteraction {
  private pending: Pending[] = [];
  private page?: RetainedSelectionRequest;
  private shown?: Pending;
  private dismissed = false;
  private disposed = false;
  constructor(private ui: CodexApprovalUi) {}
  request(request: CodexApproval, signal: AbortSignal): Promise<CodexApprovalDecision> {
    if (signal.aborted || this.disposed) return Promise.resolve('cancel');
    return new Promise(resolve => {
      const preview = this.ui.document.createElement('div');
      const title = this.ui.document.createElement('h3'); title.textContent = request.kind === 'command' ? 'Codex command approval' : 'Codex file-change approval';
      const content = this.ui.document.createElement('pre'); content.textContent = JSON.stringify(request.native, null, 2); preview.append(title, content);
      let settled = false;
      const entry: Pending = { request, preview, signal, finish: value => {
        if (settled) return; settled = true; signal.removeEventListener('abort', abort);
        this.pending.splice(this.pending.indexOf(entry), 1); this.ui.changed(-1); resolve(value); this.sync();
      } };
      const abort = () => entry.finish('cancel');
      signal.addEventListener('abort', abort, { once: true });
      if (!this.pending.length) this.dismissed = false;
      this.pending.push(entry); this.ui.changed(1); this.sync();
    });
  }
  setActive(active: boolean): void { if (!active) this.suspend(); else if (!this.dismissed) this.open(); }
  review(): void { if (this.disposed || !this.ui.canPresent()) return; this.dismissed = false; this.open(); }
  private open(): void {
    if (this.disposed || this.dismissed || !this.pending.length || !this.ui.canPresent()) return;
    if (!this.page?.isCurrent()) this.page = this.ui.start(() => { this.page = undefined; this.shown = undefined; this.dismissed = true; });
    this.show();
  }
  private show(): void {
    const entry = this.pending[0], page = this.page; if (!entry || !page?.isCurrent()) return;
    page.remaining(this.pending.length > 1 ? `${this.pending.length - 1} more` : 'Last request');
    if (this.shown === entry) return; this.shown = entry;
    const choices: { id: CodexApprovalDecision; label: string; detail: string }[] = [
      { id: 'accept', label: 'Allow once', detail: 'Approve this Codex request' },
      { id: 'acceptForSession', label: 'Allow for this session', detail: 'Use Codex’s session-scoped approval semantics' },
      { id: 'decline', label: 'Decline', detail: 'Decline this requested action' },
      { id: 'cancel', label: 'Cancel', detail: 'Cancel this Codex approval request' },
    ];
    page.show({ items: choices.map(choice => ({ ...choice, run: () => {
      if (!this.disposed && !entry.signal.aborted && this.ui.canPresent() && page.isCurrent() && this.pending[0] === entry) entry.finish(choice.id);
    } })) }, entry.preview);
  }
  private suspend(): void { const dismissed = this.dismissed; this.page?.cancel(); this.page = undefined; this.shown = undefined; this.dismissed = dismissed; }
  private sync(): void {
    if (!this.pending.length) { this.suspend(); this.ui.banner(0, () => this.review()); this.dismissed = false; return; }
    this.ui.banner(this.pending.length, () => this.review());
    if (this.page?.isCurrent()) this.show(); else if (!this.dismissed) this.open();
  }
  dispose(): void { if (this.disposed) return; this.disposed = true; this.suspend(); for (const entry of [...this.pending]) entry.finish('cancel'); }
}
