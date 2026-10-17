import { permissionOptions, type PermissionDecision } from '../../copilot/permissions.mjs';
import { copilotPermissionPreview } from './permission-presentation';

interface Pending {
  body: HTMLElement;
  label: string;
  finish(value?: PermissionDecision): void;
}
/** One FIFO panel per owning conversation; arrival never moves focus or the transcript. */
export class CopilotPermissionPanel {
  private pending: Pending[] = [];
  private root: HTMLElement;
  private count: HTMLElement;
  private queue: HTMLDetailsElement;
  private list: HTMLElement;
  constructor(private document: Document, private host: HTMLElement, private project: string | undefined,
    private canDecide: () => boolean, private changed: (delta: number) => void, private releaseFocus: () => void) {
    this.root = document.createElement('section'); this.root.className = 'copilot-permission-panel';
    this.root.setAttribute('role', 'group'); this.root.setAttribute('aria-label', 'Copilot permission requests');
    const header = document.createElement('div'); header.className = 'copilot-permission-header';
    const title = document.createElement('strong'); title.textContent = 'Permission required';
    this.count = document.createElement('span'); header.append(title, this.count); this.root.append(header);
    this.queue = document.createElement('details'); this.queue.className = 'copilot-permission-queue';
    const summary = document.createElement('summary'); summary.textContent = 'Other pending requests';
    this.list = document.createElement('ul'); this.queue.append(summary, this.list); this.root.append(this.queue);
  }
  request(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<PermissionDecision | undefined> {
    if (signal.aborted) return Promise.resolve(undefined);
    return new Promise(resolve => {
      const body = this.document.createElement('div'); body.className = 'copilot-permission-body';
      const preview = copilotPermissionPreview(this.document, request, this.project);
      const summary = preview.querySelector('.acp-permission-summary');
      const label = summary?.textContent || 'Permission request';
      for (const node of summary?.childNodes || []) if (node.nodeType === 3) node.textContent = '';
      const raw = preview.querySelector('.acp-permission-raw');
      body.append(preview);
      const actions = this.document.createElement('div'); actions.className = 'acp-permission-actions'; body.append(actions);
      let settled = false;
      const entry: Pending = { body, label,
        finish: value => {
          if (settled) return;
          settled = true; signal.removeEventListener('abort', abort);
          const focused = body.contains(this.document.activeElement);
          this.pending.splice(this.pending.indexOf(entry), 1); body.remove(); this.render();
          this.changed(-1); resolve(value);
          if (focused && this.canDecide()) {
            const next = this.pending[0]?.body.querySelector<HTMLButtonElement>('button');
            if (next) next.focus({ preventScroll: true }); else this.releaseFocus();
          }
        },
      };
      const choose = (value: PermissionDecision) => {
        if (!signal.aborted && this.canDecide() && this.pending[0] === entry) entry.finish(value);
      };
      const button = (label: string, value: PermissionDecision, primary = false) => {
        const control = this.document.createElement('button'); control.type = 'button'; control.textContent = label;
        control.className = primary ? 'permission-primary' : 'secondary';
        control.addEventListener('click', () => choose(value)); return control;
      };
      const [once, ...scoped] = permissionOptions(request);
      actions.append(button(once.label, once.decision, true));
      if (scoped.length) {
        const more = this.document.createElement('details'); more.className = 'copilot-permission-scopes';
        const summary = this.document.createElement('summary'); summary.textContent = 'More approval options…'; more.append(summary);
        for (const option of scoped) more.append(button(option.label, option.decision));
        actions.append(more);
      }
      actions.append(button('Deny', { kind: 'reject' }));
      const feedback = this.document.createElement('details'); feedback.className = 'copilot-permission-feedback';
      const feedbackLabel = this.document.createElement('summary'); feedbackLabel.textContent = 'Deny with feedback…';
      const input = this.document.createElement('textarea'); input.rows = 2; input.setAttribute('aria-label', 'Reason for denying permission');
      const reject = this.document.createElement('button'); reject.type = 'button'; reject.className = 'secondary'; reject.textContent = 'Send denial';
      reject.addEventListener('click', () => choose({ kind: 'reject', ...(input.value.trim() ? { feedback: input.value.trim() } : {}) }));
      feedback.append(feedbackLabel, input, reject); body.append(feedback);
      if (raw) body.append(raw);
      const abort = () => entry.finish();
      signal.addEventListener('abort', abort, { once: true });
      this.pending.push(entry); this.root.insertBefore(body, this.queue); this.render(); this.changed(1);
    });
  }
  private render(): void {
    if (!this.pending.length) { this.root.remove(); this.queue.open = false; return; }
    if (!this.root.parentNode) this.host.prepend(this.root);
    this.count.textContent = `${this.pending.length} pending`;
    this.pending.forEach((entry, index) => { entry.body.hidden = index !== 0; });
    this.queue.hidden = this.pending.length < 2;
    this.list.replaceChildren(...this.pending.slice(1).map(entry => {
      const item = this.document.createElement('li'); item.textContent = entry.label; return item;
    }));
  }
}
