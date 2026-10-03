import type { DOMWindow } from 'jsdom';

/** jsdom lacks native modality. Tests using this establish controller behavior, not browser focus containment. */
export function stubDialogs(window: DOMWindow): void {
  const previous = new WeakMap<HTMLDialogElement, Element | null>();
  window.HTMLDialogElement.prototype.showModal = function () {
    previous.set(this, window.document.activeElement);
    this.setAttribute('open', '');
  };
  window.HTMLDialogElement.prototype.close = function (value?: string) {
    if (value !== undefined) this.returnValue = value;
    this.removeAttribute('open');
    const target = previous.get(this);
    if (target instanceof window.HTMLElement && target.isConnected) target.focus({ preventScroll: true });
    this.dispatchEvent(new window.Event('close'));
  };
}
