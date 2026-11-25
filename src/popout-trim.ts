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
  track.dir = 'ltr';
  track.setAttribute('role', 'group');
  track.setAttribute('aria-label', 'Response trim');
  const rail = document.createElement('div');
  rail.className = 'popout-trim-rail';
  rail.setAttribute('aria-hidden', 'true');
  const overlay = document.createElement('div');
  overlay.className = 'popout-trim-handles';
  track.append(rail, overlay);
  const createHandle = (edge: Edge, label: string) => {
    const handle = document.createElement('div');
    handle.className = `popout-trim-handle popout-trim-${edge}`;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = String(full.end); input.step = '1';
    input.setAttribute('aria-label', label);
    // Keep native keyboard/AT behavior, but own the pointer target outside the native thumb's shadow DOM.
    const thumb = document.createElement('span');
    thumb.className = 'popout-trim-thumb';
    thumb.setAttribute('aria-hidden', 'true');
    thumb.title = label;
    handle.append(input, thumb);
    overlay.append(handle);
    return { input, thumb };
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
      const { input } = handles[edge];
      input.value = String(boundary);
      input.setAttribute('aria-valuetext', range.start === range.end ? `${label}, no blocks kept` : label);
      track.style.setProperty(`--trim-${edge}`, `${boundary / full.end * 100}%`);
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
    const clamped = edge === 'start' ? Math.max(0, Math.min(value, range.end)) : Math.min(full.end, Math.max(value, range.start));
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
  let drag: { edge: Edge; pointer: number; x: number; boundary: number; width: number } | undefined;
  function endDrag() {
    if (!drag) return;
    const { edge, pointer } = drag;
    drag = undefined;
    track.removeAttribute('data-dragging');
    const { thumb } = handles[edge];
    if (thumb.hasPointerCapture(pointer)) thumb.releasePointerCapture(pointer);
    if (!disposed) void commit();
  }
  window.addEventListener('blur', endDrag);
  for (const edge of edges) {
    const { input, thumb } = handles[edge];
    const focus = () => input.focus({ preventScroll: true });
    const owns = (event: PointerEvent) => drag?.pointer === event.pointerId && drag.edge === edge;
    thumb.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || drag) return;
      event.preventDefault(); // Suppress pointer focus default so the range keeps focus on release.
      focus();
      const { width } = rail.getBoundingClientRect();
      if (!width) return;
      thumb.setPointerCapture(event.pointerId);
      drag = { edge, pointer: event.pointerId, x: event.clientX, boundary: range[edge], width };
      track.setAttribute('data-dragging', '');
    });
    thumb.addEventListener('pointermove', event => {
      if (!owns(event) || !drag) return;
      if (event.pointerType === 'mouse' && !(event.buttons & 1)) { endDrag(); return; }
      move(edge, drag.boundary + Math.round((event.clientX - drag.x) / drag.width * full.end));
    });
    for (const event of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
      thumb.addEventListener(event, event => { if (owns(event)) endDrag(); });
    }
    thumb.addEventListener('click', focus);
    input.addEventListener('input', () => move(edge, input.valueAsNumber));
    input.addEventListener('change', () => { void commit(); });
  }
  rail.addEventListener('click', event => {
    const { left, width } = rail.getBoundingClientRect();
    if (!width) return;
    const value = Math.round(Math.max(0, Math.min(1, (event.clientX - left) / width)) * full.end);
    const distanceToStart = Math.abs(value - range.start), distanceToEnd = Math.abs(value - range.end);
    const edge = distanceToStart === distanceToEnd
      ? (value <= range.start ? 'start' : 'end') : distanceToStart < distanceToEnd ? 'start' : 'end';
    handles[edge].input.focus({ preventScroll: true });
    move(edge, value);
    void commit();
  });
  paint();
  return { track, range: () => range, dispose: () => {
    disposed = true;
    window.removeEventListener('blur', endDrag);
    endDrag();
    if (frame !== undefined) cancelAnimationFrame(frame);
  } };
}
