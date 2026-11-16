import type { HarnessSession } from './harness-contract';

/** Mounted presentation only: navigation selection and connection policy stay in the shell. */
export interface PresentedSession {
  title: string;
  root: HTMLElement;
  row: HTMLElement;
  focus?: HTMLElement;
  closing: boolean;
  reloading: boolean;
  deleting: boolean;
  view: { setActive(active: boolean): void };
  notices: { setActive(active: boolean): void };
  integration: Pick<HarnessSession, 'interactions' | 'presentation'>;
}

interface SessionPresenterOptions<T> {
  sessions(): readonly T[];
  conversation: HTMLElement;
  identityChanged(identity: { present: boolean; title: string; badge: string; badgeTitle: string; harness: string }): void;
  emptyFocus(): HTMLElement;
  switched(): void;
  controlsChanged(): void;
}

/** Sole owner of the presented pointer and its dependent shell/view DOM. */
export class SessionPresenter<T extends PresentedSession> {
  #current: T | undefined;
  constructor(private readonly options: SessionPresenterOptions<T>) {}
  get current(): T | undefined { return this.#current; }

  show(session: T | undefined, focus = false): void {
    const { conversation } = this.options;
    const changed = this.#current !== session;
    if (changed) {
      const previous = this.#current;
      if (previous) {
        previous.integration.interactions.setActive(false);
        const document = conversation.ownerDocument, focused = document.activeElement;
        if (focused instanceof document.defaultView!.HTMLElement && previous.root.contains(focused)) {
          previous.focus = focused;
          if (!session && !document.querySelector('dialog[open]')) this.options.emptyFocus().focus({ preventScroll: true });
        }
        previous.notices.setActive(false);
        previous.view.setActive(false);
        previous.root.hidden = true;
        previous.root.inert = true;
        previous.row.setAttribute('aria-current', 'false');
      }
      this.#current = session;
      conversation.hidden = !session;
      if (session) {
        session.root.hidden = false;
        session.view.setActive(true);
        session.notices.setActive(true);
      }
      this.options.switched();
    }
    // Reconcile even an unchanged/empty presentation; no caller patches these separately.
    conversation.hidden = !session;
    for (const item of this.options.sessions()) this.refreshRow(item);
    this.refreshIdentity();
    // Reveal/catch up and clear inactive inert state before a pending picker
    // captures the navigation focus target; existing dialogs retain priority.
    const document = conversation.ownerDocument;
    if (focus && session && !document.querySelector('dialog[open]')) {
      (session.focus?.isConnected ? session.focus : session.root.querySelector<HTMLElement>('[data-pi-id="prompt"]'))?.focus({ preventScroll: true });
    }
    if (changed && session) session.integration.interactions.setActive(true);
  }

  /** Lifecycle/content updates don't constitute selection or reactivate mounted views. */
  refresh(session: T): void {
    this.refreshRow(session);
    if (session === this.#current) this.refreshIdentity();
  }

  /** Deactivate before disposal, without choosing a replacement or changing navigation. */
  remove(session: T): void {
    if (session === this.#current) this.show(undefined);
  }

  private refreshRow(session: T): void {
    session.root.inert = session.closing || session.reloading || session.deleting || session !== this.#current;
    session.row.setAttribute('aria-current', String(session === this.#current));
  }

  private refreshIdentity(): void {
    const session = this.#current, title = session?.title || '';
    const projection = session?.integration.presentation.snapshot();
    this.options.identityChanged({ present: !!session, title, badge: projection?.badge ?? '',
      badgeTitle: projection?.badgeTitle ?? '', harness: projection?.harnessLabel ?? '' });
    this.options.controlsChanged();
  }
}
