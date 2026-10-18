import type { AppearanceCapabilities, TitlebarTint } from './window-appearance';

export interface NativeAppearance {
  material?: { blur: number; dark: boolean | null };
  tint?: TitlebarTint;
}
export interface NativeAppearanceHost {
  apply(blur: number, dark: boolean | null): Promise<AppearanceCapabilities>;
  tintTitlebar?(color: TitlebarTint): Promise<void>;
  report(message?: string, cause?: string): void;
}

/** One serialized, latest-value native pipeline: appearance before title tint.
 * No-op requests allocate no work; failed stages are not replayed by broadcasts.
 */
export function installAppearanceEffects(host: NativeAppearanceHost, receiveCapabilities: (capabilities: AppearanceCapabilities) => void) {
  let disposed = false;
  let desired: NativeAppearance | undefined;
  let desiredKey = '';
  let appliedMaterial: string | undefined, failedMaterial: string | undefined;
  let appliedTint: string | undefined, failedTint: string | undefined;
  let tintRevision = 0;
  let running: Promise<void> | undefined;
  const materialKey = (value: NativeAppearance) => value.material ? JSON.stringify(value.material) : undefined;
  const tintKey = (value: NativeAppearance) => value.tint ? JSON.stringify([value.tint, value.material, tintRevision]) : undefined;
  const needed = (value: NativeAppearance | undefined) => {
    if (!value || disposed) return false;
    const material = materialKey(value), tint = tintKey(value);
    return material !== undefined && material !== appliedMaterial && material !== failedMaterial
      || !!host.tintTitlebar && tint !== undefined && tint !== appliedTint && tint !== failedTint;
  };
  async function drain() {
    while (needed(desired)) {
      const target = desired!;
      const material = materialKey(target);
      if (material !== undefined && material !== appliedMaterial && material !== failedMaterial) {
        try {
          const next = await host.apply(target.material!.blur, target.material!.dark);
          if (disposed) return;
          appliedMaterial = material; failedMaterial = undefined; appliedTint = undefined;
          host.report(undefined, 'native'); receiveCapabilities(next);
        } catch (error) {
          if (disposed) return;
          failedMaterial = material;
          host.report(`Could not update the window background: ${String(error)}`, 'native');
        }
        // Re-read the desired snapshot: a capability/theme change may supersede
        // the old tint while native appearance was being applied.
        continue;
      }
      const tint = tintKey(target);
      if (host.tintTitlebar && tint !== undefined && tint !== appliedTint && tint !== failedTint) {
        try {
          await host.tintTitlebar(target.tint!);
          if (disposed) return;
          appliedTint = tint; failedTint = undefined; host.report(undefined, 'titlebar');
        } catch (error) {
          if (disposed) return;
          failedTint = tint;
          host.report(`Could not update the title bar: ${String(error)}`, 'titlebar');
        }
      }
    }
  }
  function start() {
    if (running || !needed(desired)) return;
    running = Promise.resolve().then(drain).finally(() => { running = undefined; start(); });
  }
  return {
    request(next: NativeAppearance) {
      if (disposed) return;
      const key = JSON.stringify(next);
      if (key !== desiredKey) {
        desiredKey = key;
        desired = { material: next.material ? { ...next.material } : undefined, tint: next.tint ? [next.tint[0], next.tint[1], next.tint[2], next.tint[3]] : undefined };
      }
      start();
    },
    refreshTint() {
      // A successful prior tint can be invalidated by native frame activation.
      // Don't turn refresh into a retry of a failed identical stage.
      if (appliedTint !== undefined && desired && failedTint !== tintKey(desired)) { ++tintRevision; start(); }
    },
    async settled() { while (running) await running; },
    dispose() { disposed = true; desired = undefined; },
  };
}
