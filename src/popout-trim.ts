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
  const toggle = document.createElement('button');
  const reset = document.createElement('button');
  for (const button of [toggle, reset]) { button.type = 'button'; button.className = 'utility-button'; }
  toggle.textContent = 'Trim';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'popout-trim');
  reset.textContent = 'Reset trim';
  const panel = document.createElement('div');
  panel.id = 'popout-trim';
  panel.className = 'popout-trim';
  panel.hidden = true;
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Response trim');
  const summary = document.createElement('span');
  const track = document.createElement('div');
  track.className = 'popout-trim-control';
  const rail = document.createElement('div');
  rail.className = 'popout-trim-rail';
  rail.setAttribute('aria-hidden', 'true');
  track.append(rail);
  const createHandle = (edge: Edge, label: string) => {
    const input = document.createElement('input');
    input.type = 'range';
    input.min = '0'; input.max = String(full.last); input.step = '1';
    input.className = `popout-trim-${edge}`;
    input.setAttribute('aria-label', label);
    input.title = label;
    track.append(input);
    return input;
  };
  const handles = { first: createHandle('first', 'First block to keep'), last: createHandle('last', 'Last block to keep') };
  panel.append(track, summary, reset);

  let range = initial, saved = initial, requested = initial;
  let reveal: Edge = 'first', frame: number | undefined;
  let saving = false, disposed = false;
  const same = (a: ResponseTrim, b: ResponseTrim) => a.first === b.first && a.last === b.last;
  function paint() {
    for (const edge of ['first', 'last'] as const) {
      handles[edge].value = String(range[edge]);
      handles[edge].setAttribute('aria-valuetext', `Block ${range[edge] + 1} of ${full.last + 1}`);
      rail.style.setProperty(`--trim-${edge}`, `${range[edge] / full.last * 100}%`);
    }
    summary.textContent = range.first === range.last
      ? `Block ${range.first + 1} of ${full.last + 1}`
      : `Blocks ${range.first + 1}–${range.last + 1} of ${full.last + 1}`;
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
    const clamped = edge === 'first' ? Math.min(value, range.last) : Math.max(value, range.first);
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
  for (const edge of ['first', 'last'] as const) {
    handles[edge].addEventListener('input', () => move(edge, handles[edge].valueAsNumber));
    handles[edge].addEventListener('change', () => { void commit(); });
  }
  rail.addEventListener('click', event => {
    const { left, width } = rail.getBoundingClientRect();
    if (!width) return;
    const value = Math.round(Math.max(0, Math.min(1, (event.clientX - left) / width)) * full.last);
    const distanceToFirst = Math.abs(value - range.first), distanceToLast = Math.abs(value - range.last);
    const edge = distanceToFirst === distanceToLast
      ? (value <= range.first ? 'first' : 'last') : distanceToFirst < distanceToLast ? 'first' : 'last';
    handles[edge].focus({ preventScroll: true });
    move(edge, value);
    void commit();
  });
  toggle.addEventListener('click', () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute('aria-expanded', String(!panel.hidden));
  });
  reset.addEventListener('click', () => { update(full, 'first'); void commit(); });
  paint();
  return { toggle, panel, range: () => range, dispose: () => {
    disposed = true;
    if (frame !== undefined) cancelAnimationFrame(frame);
  } };
}
