export const MIN_SIDEBAR_WIDTH = 180;
export const MAX_SIDEBAR_WIDTH = 520;
export const sidebarWidthKey = (project: string): string => `nimrod.sidebar.width:${project}`;

export function savedSidebarWidth(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(Math.max(MIN_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, value))) : undefined;
}

interface SidebarResizeHost {
  read(): unknown;
  save(width: number | null): void;
}
export interface SidebarResizeOptions {
  widthProperty?: string;
  minWidth?: number;
  maxWidth?: number;
  defaultWidth?: () => number;
  maxAvailableWidth?: (available: number) => number;
  active?: () => boolean;
  allowedDialog?: HTMLDialogElement;
}
interface SidebarResizeNodes {
  layout: HTMLElement;
  sidebar: HTMLElement;
  handle: HTMLElement;
  toggle: HTMLElement;
}

/** Layout-only resizing. Width is in unzoomed CSS pixels; no harness/session effects. */
export function installSidebarResize(window: Window, nodes: SidebarResizeNodes, host: SidebarResizeHost, options: SidebarResizeOptions = {}) {
  const { layout, sidebar, handle, toggle } = nodes, document = layout.ownerDocument;
  const minWidth = options.minWidth ?? MIN_SIDEBAR_WIDTH, maxWidth = options.maxWidth ?? MAX_SIDEBAR_WIDTH;
  const widthProperty = options.widthProperty ?? '--session-sidebar-width';
  const savedWidth = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(Math.max(minWidth, Math.min(maxWidth, value))) : undefined;
  const active = () => !sidebar.hidden && (options.active?.() ?? true);
  let preferred = savedWidth(host.read());
  let width = 260, disposed = false;
  let drag: { id: number; x: number; width: number; preferred: number | undefined; scale: number } | undefined;
  const media = (query: string) => window.matchMedia?.(query).matches ?? false;
  const limits = () => {
    const available = layout.clientWidth || window.innerWidth;
    const availableMax = options.maxAvailableWidth?.(available) ?? (media('(max-width:600px)') ? available - 48 : available * .6);
    const max = Math.max(0, Math.floor(Math.min(maxWidth, availableMax)));
    return { min: Math.min(minWidth, max), max };
  };
  const defaultWidth = options.defaultWidth ?? (() => media('(max-width:600px)') ? 250 : media('(max-width:760px)') ? 210 : 260);
  const clamp = (value: number) => { const { min, max } = limits(); return Math.round(Math.max(min, Math.min(max, value))); };
  const modal = () => [...document.querySelectorAll('dialog[open], #dialog.open')].some(dialog => dialog !== options.allowedDialog);
  const apply = () => {
    width = clamp(preferred ?? defaultWidth());
    const value = `${width}px`;
    if (layout.style.getPropertyValue(widthProperty) !== value) layout.style.setProperty(widthProperty, value);
    const { min, max } = limits();
    handle.setAttribute('aria-valuemin', String(min)); handle.setAttribute('aria-valuemax', String(max));
    handle.setAttribute('aria-valuenow', String(width)); handle.setAttribute('aria-valuetext', `${width} pixels`);
  };
  const finish = (commit: boolean) => {
    const previous = drag;
    if (!previous) return;
    drag = undefined; document.body.classList.remove('resizing-sidebar'); layout.classList.remove('resizing-sidebar');
    try { if (handle.hasPointerCapture?.(previous.id)) handle.releasePointerCapture(previous.id); } catch { /* capture already ended */ }
    if (!commit || width === previous.width) preferred = previous.preferred;
    apply();
    if (commit && width !== previous.width) host.save(preferred ?? null);
  };
  const refresh = () => {
    if (disposed) return;
    if (!active() || modal()) {
      finish(false);
      if (sidebar.hidden && document.activeElement === handle && !modal()) toggle.focus({ preventScroll: true });
    }
    handle.hidden = !active();
    apply();
  };
  const down = (event: PointerEvent) => {
    if (disposed || !active() || modal() || event.button !== 0 || event.isPrimary === false || drag) return;
    event.preventDefault(); // Pointer resizing must not steal the composer's focus.
    const scale = layout.offsetWidth ? layout.getBoundingClientRect().width / layout.offsetWidth || 1 : 1;
    drag = { id: event.pointerId, x: event.clientX, width, preferred, scale };
    document.body.classList.add('resizing-sidebar'); layout.classList.add('resizing-sidebar');
    try { handle.setPointerCapture?.(event.pointerId); } catch { /* window listeners still terminate the drag */ }
  };
  const move = (event: PointerEvent) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!active() || modal()) { finish(false); return; }
    event.preventDefault();
    preferred = clamp(drag.width + (event.clientX - drag.x) / drag.scale);
    apply();
  };
  const up = (event: PointerEvent) => { if (drag?.id === event.pointerId) finish(active() && !modal()); };
  const cancel = (event: PointerEvent) => { if (drag?.id === event.pointerId) finish(false); };
  const blur = () => finish(false);
  const escape = (event: KeyboardEvent) => {
    if (drag && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); finish(false); }
  };
  const key = (event: KeyboardEvent) => {
    if (!active() || modal() || event.isComposing || event.altKey || event.metaKey || event.ctrlKey) return;
    const { min, max } = limits(), step = event.shiftKey ? 50 : 10;
    const next = event.key === 'ArrowLeft' ? width - step : event.key === 'ArrowRight' ? width + step : event.key === 'Home' ? min : event.key === 'End' ? max : undefined;
    if (next === undefined) return;
    event.preventDefault(); finish(false);
    const value = clamp(next);
    if (value === width) return;
    preferred = value; apply(); host.save(preferred);
  };
  const reset = (event: MouseEvent) => {
    if (!active() || modal() || event.button !== 0) return;
    event.preventDefault(); finish(false); preferred = undefined; apply(); host.save(null);
  };
  let available = layout.clientWidth;
  const resize = () => { finish(false); available = layout.clientWidth; refresh(); };
  const Observer = (window as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
  const observer = Observer ? new Observer(() => {
    // Observe the layout, not the sidebar: resizing it must not cancel its own drag.
    if (layout.clientWidth !== available) resize();
  }) : undefined;
  observer?.observe(layout);
  // Closing the owner page or opening a higher-priority dialog cancels immediately.
  const Mutation = (window as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver;
  const modalityObserver = Mutation ? new Mutation(refresh) : undefined;
  modalityObserver?.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
  handle.addEventListener('pointerdown', down); handle.addEventListener('lostpointercapture', cancel);
  handle.addEventListener('keydown', key); handle.addEventListener('dblclick', reset);
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  window.addEventListener('blur', blur); window.addEventListener('resize', resize); window.addEventListener('keydown', escape, true);
  refresh();
  return {
    refresh,
    reload() { if (!disposed) { finish(false); preferred = savedWidth(host.read()); refresh(); } },
    dispose() {
      finish(false); disposed = true; observer?.disconnect(); modalityObserver?.disconnect();
      handle.removeEventListener('pointerdown', down); handle.removeEventListener('lostpointercapture', cancel);
      handle.removeEventListener('keydown', key); handle.removeEventListener('dblclick', reset);
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('blur', blur); window.removeEventListener('resize', resize); window.removeEventListener('keydown', escape, true);
    },
  };
}
