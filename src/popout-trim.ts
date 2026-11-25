import type { ResponseTrim } from './response-markdown';

type Edge = keyof ResponseTrim;

interface TrimOptions {
  initial: ResponseTrim;
  full: ResponseTrim;
  preview(range: ResponseTrim, reveal: Edge): void;
  save(trim: ResponseTrim | null): Promise<void>;
  report(error: unknown): void;
}

export function createPopoutTrim({ initial, full, preview, save, report }: TrimOptions) {
  const track = document.createElement('div');
  track.className = 'popout-trim-control';
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', 'Response trim');
  const rail = document.createElement('div');
  rail.className = 'popout-trim-rail';
  rail.setAttribute('aria-hidden', 'true');
  track.append(rail);
  const createHandle = (edge: Edge, label: string) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = String(full.end); input.step = '1';
    input.className = `popout-trim-${edge}`;
    input.setAttribute('aria-label', label);
    input.title = label;
    track.append(input);
    return input;
  };
  const edges = ['start', 'end'] as const;
  const handles = { start: createHandle('start', 'Trim start'), end: createHandle('end', 'Trim end') };

  let range = initial, saved = initial, requested = initial;
  let reveal: Edge = 'start', frame: number | undefined;
  let saving = false, disposed = false;
  const same = (a: ResponseTrim, b: ResponseTrim) => a.start === b.start && a.end === b.end;
  function paint() {
    for (const edge of edges) {
      const boundary = range[edge];
      const label = boundary === full.end ? 'After last block' : `Before block ${boundary + 1} of ${full.end}`;
      handles[edge].value = String(boundary);
      handles[edge].setAttribute('aria-valuetext', range.start === range.end ? `${label}, no blocks kept` : label);
      rail.style.setProperty(`--trim-${edge}`, `${boundary / full.end * 100}%`);
    }
  }
  function update(next: ResponseTrim, edge: Edge) {
    const changed = !same(range, next);
    range = next;
    paint(); // Also restore the legal thumb position when it hit the other handle.
    if (!changed) return;
    reveal = edge;
    frame ??= requestAnimationFrame(() => { frame = undefined; preview(range, reveal); });
  }
  function move(edge: Edge, value: number) {
    const clamped = edge === 'start' ? Math.min(value, range.end) : Math.max(value, range.start);
    update({ ...range, [edge]: clamped }, edge);
  }
  async function commit() {
    requested = range;
    if (saving) return;
    saving = true;
    try {
      while (!disposed && !same(saved, requested)) {
        const pending = requested;
        try {
          await save(same(pending, full) ? null : pending);
          saved = pending;
        } catch (error) {
          if (!disposed) report(error);
          if (same(pending, requested)) break;
        }
      }
    } finally { saving = false; }
  }
  let dragListeners: AbortController | undefined;
  const endDrag = () => {
    dragListeners?.abort();
    dragListeners = undefined;
    track.removeAttribute('data-dragging');
  };
  for (const edge of edges) {
    const handle = handles[edge];
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0) return;
      handle.focus({ preventScroll: true });
      endDrag();
      track.setAttribute('data-dragging', '');
      dragListeners = new AbortController();
      const options = { capture: true, passive: true, signal: dragListeners.signal };
      const finish = (up: PointerEvent) => { if (up.pointerId === event.pointerId) endDrag(); };
      window.addEventListener('pointerup', finish, options);
      window.addEventListener('pointercancel', finish, options);
      if (event.pointerType === 'mouse') window.addEventListener('mouseup', up => { if (up.button === 0) endDrag(); }, options);
      window.addEventListener('pointermove', move => {
        // Recover if the pointer was released outside the webview.
        if (move.pointerId === event.pointerId && !move.buttons) endDrag();
      }, options);
      window.addEventListener('blur', endDrag, { signal: options.signal });
    });
    handle.addEventListener('input', () => move(edge, handle.valueAsNumber));
    handle.addEventListener('change', () => { void commit(); });
  }
  rail.addEventListener('click', event => {
    const { left, width } = rail.getBoundingClientRect();
    if (!width) return;
    const value = Math.round(Math.max(0, Math.min(1, (event.clientX - left) / width)) * full.end);
    const distanceToStart = Math.abs(value - range.start), distanceToEnd = Math.abs(value - range.end);
    const edge = distanceToStart === distanceToEnd
      ? (value <= range.start ? 'start' : 'end') : distanceToStart < distanceToEnd ? 'start' : 'end';
    handles[edge].focus({ preventScroll: true });
    move(edge, value);
    void commit();
  });
  paint();
  return { track, range: () => range, dispose: () => {
    disposed = true;
    endDrag();
    if (frame !== undefined) cancelAnimationFrame(frame);
  } };
}
