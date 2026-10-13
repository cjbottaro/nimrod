export interface PresentationHost {
  layout(): void;
  reveal(): Promise<void>;
}

/** One window lifetime and one first-reveal attempt. No hidden-window timers/rAF.
 * Feature bootstraps supply readiness; presentation owns cancellation and cleanup.
 */
export function installWindowPresentation(window: Window, host: PresentationHost) {
  let disposed = false, attempted = false;
  const cleanups: (() => void)[] = [];
  const dispose = () => {
    if (disposed) return;
    disposed = true; window.removeEventListener('unload', dispose);
    for (const cleanup of cleanups.splice(0).reverse()) cleanup();
  };
  window.addEventListener('unload', dispose, { once: true });
  return {
    get disposed() { return disposed; },
    own(cleanup: () => void) { if (disposed) cleanup(); else cleanups.push(cleanup); },
    async presentWhenPrepared(prepare: () => Promise<void>) {
      if (disposed || attempted) return;
      await prepare();
      if (disposed || attempted) return;
      host.layout(); attempted = true;
      await host.reveal();
    },
    dispose,
  };
}
