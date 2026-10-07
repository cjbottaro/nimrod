import createDOMPurify, { type WindowLike } from 'dompurify';
import { marked } from 'marked';

export type AttentionKind = 'completed' | 'input' | 'failed';
export interface NotificationTarget {
  valid(): boolean;
  selected(): boolean;
  session: string;
  preview?: string;
}
export type NotificationDispatch = 'submitted' | 'suppressed';
export interface NotificationHost {
  focused(): Promise<boolean>;
  prepare?(): Promise<void>;
  send(kind: AttentionKind, target: NotificationTarget): Promise<NotificationDispatch | void>;
}

/** Plain text only: no Markdown chrome, live HTML, remote images or link destinations. */
export function notificationPreview(window: Window) {
  const purifier = createDOMPurify(window as unknown as WindowLike);
  return (response: string | undefined): string | undefined => {
    if (!response?.trim()) return undefined;
    try {
      const root = window.document.createElement('div');
      root.innerHTML = purifier.sanitize(marked.parse(response.slice(0, 16_384), { async: false, breaks: true, gfm: true }), {
        ALLOWED_TAGS: ['br'], ALLOWED_ATTR: [], ALLOW_DATA_ATTR: false,
      });
      for (const br of root.querySelectorAll('br')) br.replaceWith(window.document.createTextNode(' '));
      const text = (root.textContent || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '').replace(/\s+/gu, ' ').trim();
      const characters = Array.from(text);
      return characters.length > 1000 ? `${characters.slice(0, 999).join('')}…` : text || undefined;
    } catch {
      // Preview conversion must never disrupt Pi event delivery or acknowledgements.
      return undefined;
    }
  };
}

/** Eligibility is checked again after native focus lookup; never replay suppressed alerts. */
export function sessionNotifications(host: NotificationHost, enabled: () => boolean, report: (message: string) => void, status: (message: string) => void = () => {}) {
  return async (kind: AttentionKind, target: NotificationTarget): Promise<void> => {
    const eligible = (focused = false) => {
      const reason = !enabled() ? 'notifications are off' : !target.valid() ? 'session is no longer eligible'
        : focused && target.selected() ? 'session is visible in its focused project window' : undefined;
      if (reason) status(`Last ${kind} alert: quiet — ${reason}.`);
      return !reason;
    };
    if (!eligible()) return;
    try {
      if (!eligible(await host.focused())) return;
      if (host.prepare) {
        status(`Last ${kind} alert: checking OS authorization…`);
        await host.prepare();
        // An OS permission prompt can outlive a session or change focus/selection.
        if (!eligible(await host.focused())) return;
      }
      status(`Last ${kind} alert: submitting to the OS…`);
      const outcome = await host.send(kind, target);
      if (target.valid()) status(outcome === 'suppressed' ? `Last ${kind} alert: suppressed at the native dispatch boundary.`
        : `Last ${kind} alert: submitted to the OS. Visible presentation depends on system settings.`);
    } catch (error) { if (target.valid()) report(`Notifications: ${String(error)}`); }
  };
}
