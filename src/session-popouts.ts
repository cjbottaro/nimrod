export interface PiPopoutOwner { path: string; sessionId: string; }
export interface PopoutSessionBinding { runtimeId: string; pi: PiPopoutOwner | null; }
export interface PopoutSnapshot { session: string; title: string; text: string; language: string; }

interface PopoutHost {
  sync(sessions: PopoutSessionBinding[], active: string | null): Promise<{ warnings: string[] }>;
  open(snapshot: PopoutSnapshot): Promise<void>;
  error(message: string): void;
}

// Presentation only: persistence and window ownership stay native. Coalesce queued
// selections, serialize opens behind registration, and never focus a stale session.
export function installSessionPopouts(host: PopoutHost) {
  let task = Promise.resolve();
  let revision = 0;
  let disposed = false;
  const enqueue = (action: () => Promise<void>) => {
    task = task.then(async () => { if (!disposed) await action(); }).catch(error => {
      if (!disposed) host.error(String(error));
    });
  };
  return {
    sync(sessions: PopoutSessionBinding[], active: string | null): void {
      const current = ++revision;
      enqueue(async () => {
        if (current !== revision) return;
        const result = await host.sync(sessions, active);
        if (result?.warnings.length) host.error(result.warnings.join('\n'));
      });
    },
    open(snapshot: PopoutSnapshot, stillSelected: () => boolean): void {
      enqueue(async () => { if (stillSelected()) await host.open(snapshot); });
    },
    settled(): Promise<void> { return task; },
    dispose(): void { disposed = true; },
  };
}
