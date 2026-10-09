export const ZOOM_LEVELS = [75, 90, 100, 110, 125, 150, 175, 200] as const;
export const DEFAULT_ZOOM = 125;
export const ZOOM_STORAGE_KEY = 'nimrod.zoomPercent';

export function savedZoom(value: unknown): number {
  return typeof value === 'number' && ZOOM_LEVELS.some(level => level === value) ? value : DEFAULT_ZOOM;
}

export function zoomShortcut(event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'isComposing' | 'defaultPrevented'>): 'in' | 'out' | 'reset' | undefined {
  if (event.defaultPrevented || event.isComposing || event.altKey || !(event.metaKey || event.ctrlKey)) return;
  if (event.key === '+' || event.key === '=') return 'in';
  if (event.key === '-') return 'out';
  if (event.key === '0') return 'reset';
}

interface ZoomHost {
  read(): unknown;
  save(percent: number): void | Promise<void>;
  apply(scale: number): Promise<void>;
}

/** Native page zoom, not font-size or CSS transform. Serialize IPC so older changes cannot win. */
export function installZoom(window: Window, select: HTMLSelectElement, notice: HTMLElement, host: ZoomHost, shortcuts = true): { ready: Promise<void>; run(action: 'in' | 'out' | 'reset'): void; reload(): Promise<void>; dispose(): void } {
  let applied = 100;
  let requested = DEFAULT_ZOOM;
  let work = Promise.resolve();
  let disposed = false;
  select.replaceChildren(...ZOOM_LEVELS.map(percent => {
    const option = select.ownerDocument.createElement('option');
    option.value = String(percent); option.textContent = `${percent}%`;
    return option;
  }));
  select.disabled = true;
  select.value = String(applied);

  const change = (percent: number, persist = true): Promise<void> => {
    requested = percent;
    work = work.then(async () => {
      if (disposed) return;
      try {
        await host.apply(percent / 100);
        if (disposed) return;
        applied = percent;
        select.value = String(applied);
        notice.hidden = true;
        try { if (persist) await host.save(percent); }
        catch { notice.textContent = 'Zoom changed, but could not be saved for next launch.'; notice.hidden = false; }
      } catch (error) {
        if (disposed) return;
        if (requested === percent) requested = applied;
        select.value = String(applied);
        notice.textContent = `Could not change zoom: ${String(error)}`;
        notice.hidden = false;
      } finally { if (!disposed) select.disabled = false; }
    });
    return work;
  };
  const onChange = () => {
    const percent = Number(select.value);
    if (ZOOM_LEVELS.some(level => level === percent)) void change(percent);
  };
  const run = (action: 'in' | 'out' | 'reset') => {
    const index = ZOOM_LEVELS.findIndex(level => level === requested);
    const percent = action === 'reset' ? 100 : ZOOM_LEVELS[Math.max(0, Math.min(ZOOM_LEVELS.length - 1, index + (action === 'in' ? 1 : -1)))];
    void change(percent);
  };
  const onKey = (event: KeyboardEvent) => {
    const action = zoomShortcut(event);
    if (!action) return;
    event.preventDefault(); run(action);
  };
  select.addEventListener('change', onChange);
  if (shortcuts) window.addEventListener('keydown', onKey);
  let initial: unknown;
  try { initial = host.read(); } catch { /* use the personal default */ }
  const ready = change(savedZoom(initial), false);
  return { ready, run, reload() {
    const percent = savedZoom(host.read());
    return percent === requested ? work : change(percent, false);
  }, dispose() {
    disposed = true;
    select.removeEventListener('change', onChange);
    window.removeEventListener('keydown', onKey);
  } };
}
