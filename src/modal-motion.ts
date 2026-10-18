import { DEFAULT_MODAL_DURATIONS, DEFAULT_SCAN_SPEEDS, isScanStyle, modalExitDuration, normalizeScanSpeed, type ModalAnimationStyle, type ScanStyle } from './modal-animation-defaults';
import { initialScanEdges, planScan, sampleScan, scanOffsets, scanClip, edgesFromClip, type ScanPlan } from './modal-scan';

interface Motion { style: ModalAnimationStyle; duration: number; scanSpeed: number }
interface Snapshot { shell: HTMLElement; rect: DOMRect; zoom: number; backdrop: string; backdropFilter: string; motion: Motion; opacity: string; clip: string; restoreScroll(): void }
interface Layer { source: HTMLElement; node: HTMLElement; animations: Animation[]; revision: number; frame?: number; observer?: ResizeObserver }
interface NativeDismissal { event: Event; generation?: number; epoch: number; snapshot?: Snapshot }
const owners = new WeakMap<Document, ReturnType<typeof createModalMotion>>();
const styles = new WeakMap<CSSStyleSheet, { count: number; text: string }>();
const depthBlurAttribute = 'data-modal-depth-blur';
function hasPresentedModal(document: Document, source: HTMLElement): boolean {
  return [...document.querySelectorAll<HTMLElement>('dialog[open], .modal-overlay.open')].some(candidate => candidate !== source);
}
function prepareModalDepth(source: HTMLElement): void {
  source.toggleAttribute(depthBlurAttribute, hasPresentedModal(source.ownerDocument, source));
}
function clearModalDepth(source: HTMLElement): void {
  source.removeAttribute(depthBlurAttribute);
}
function applyBackdropFilter(element: HTMLElement, value: string): void {
  if (!value || value === 'none') return;
  element.style.setProperty('backdrop-filter', value);
  element.style.setProperty('-webkit-backdrop-filter', value);
}
function motion(document: Document, exit = false): Motion {
  const root = document.documentElement, view = document.defaultView!;
  const style = root.dataset.modalAnimation as ModalAnimationStyle || 'subtle';
  const reduced = document.visibilityState === 'hidden' || view.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const duration = parseFloat(view.getComputedStyle(root).getPropertyValue(exit ? '--modal-exit-duration' : '--modal-enter-duration'));
  const fallback = DEFAULT_MODAL_DURATIONS[style] ?? DEFAULT_MODAL_DURATIONS.subtle;
  const rawSpeed = Number(view.getComputedStyle(root).getPropertyValue('--modal-scan-speed'));
  const scanSpeed = normalizeScanSpeed(rawSpeed || (isScanStyle(style) ? DEFAULT_SCAN_SPEEDS[style] : 1000));
  return { style, duration: reduced || style === 'none' ? 0 : Number.isFinite(duration) ? duration : exit ? modalExitDuration(style, fallback) : fallback,
    scanSpeed: reduced || style === 'none' ? 0 : scanSpeed * (exit ? 1.25 : 1) };
}

/** Preserve ID-based styling without duplicating live DOM IDs, even across shadow queries. */
function snapshotRule(rule: CSSRule): string {
  if (rule.type === 1) {
    const style = rule as CSSStyleRule;
    return `${style.selectorText.replace(/#([\w-]+)/g, ':is(#nimrod-modal-snapshot-unused, [data-modal-snapshot-id="$1"])')} { ${style.style.cssText} }`;
  }
  if ('cssRules' in rule && rule.type !== 7) {
    const group = rule as CSSGroupingRule;
    return rule.cssText.slice(0, rule.cssText.indexOf('{') + 1) + [...group.cssRules].map(snapshotRule).join('\n') + '}';
  }
  return rule.cssText;
}
function snapshotStyles(document: Document): string {
  return [...document.styleSheets, ...(document.adoptedStyleSheets ?? [])].map(sheet => {
    try {
      const rules = sheet.cssRules, cached = styles.get(sheet);
      if (cached?.count === rules.length) return cached.text;
      const text = [...rules].map(snapshotRule).join('\n');
      styles.set(sheet, { count: rules.length, text }); return text;
    } catch { return ''; } // Cross-origin sheets are not used by Nimrod's modal UI.
  }).join('\n');
}

function createModalMotion(document: Document) {
  const view = document.defaultView!;
  const layers = new Set<Layer>();
  const generations = new WeakMap<HTMLElement, number>();
  const preparing = new WeakSet<HTMLElement>();
  let pending = new WeakMap<HTMLElement, NativeDismissal>();
  const pendingCleanup = new Set<number>();
  let disposed = false, epoch = 0;
  const bump = (source: HTMLElement) => { const next = (generations.get(source) ?? 0) + 1; generations.set(source, next); return next; };
  function remove(layer: Layer) {
    if (!layers.delete(layer)) return;
    if (layer.frame !== undefined) view.cancelAnimationFrame(layer.frame);
    layer.observer?.disconnect();
    layer.animations.forEach(animation => animation.cancel());
    layer.node.remove();
  }
  const clear = () => {
    epoch++; for (const layer of [...layers]) remove(layer);
    pending = new WeakMap();
    for (const timer of pendingCleanup) view.clearTimeout(timer);
    pendingCleanup.clear();
  };
  function mount(source: HTMLElement, kind: 'enter' | 'exit') {
    const node = document.createElement('div');
    node.dataset.modalMotion = kind; node.setAttribute('aria-hidden', 'true'); node.inert = true;
    node.style.cssText = 'position:fixed;inset:0;margin:0;padding:0;border:0;width:100vw;height:100vh;max-width:none;max-height:none;background:transparent;overflow:visible;pointer-events:none;z-index:2147483647;';
    document.body.append(node);
    // A manual popover is non-modal: no focus transfer or inerting of the page.
    // This does not require CSS overlay-retention/discrete-transition support.
    let topLayer = false;
    if (typeof node.showPopover === 'function') {
      node.setAttribute('popover', 'manual');
      try { node.showPopover(); topLayer = true; } catch { node.removeAttribute('popover'); }
    }
    if (!topLayer) {
      // Older engines still animate; portal above the remaining parent dialog.
      const dialogs = [...document.querySelectorAll<HTMLDialogElement>('dialog[open]')];
      (dialogs.at(-1) ?? document.body).append(node);
    }
    const layer: Layer = { source, node, animations: [], revision: 0 };
    layers.add(layer); return layer;
  }
  function animate(layer: ReturnType<typeof mount>, element: HTMLElement, frames: Keyframe[], duration: number, easing = 'linear', direction: PlaybackDirection = 'normal') {
    const animation = element.animate(frames, { duration, easing, direction, fill: 'both' });
    layer.animations.push(animation); return animation;
  }
  function startTogether(layer: Layer, defer = true) {
    // Freeze frame zero while geometry/styles are prepared. All segment effects
    // then start on the same rendered frame, even after a busy task.
    layer.animations.forEach(animation => { animation.pause(); animation.currentTime = 0; });
    const start = (timestamp: number) => {
      layer.frame = undefined;
      if (!layers.has(layer)) return;
      try {
        const time = document.timeline?.currentTime ?? timestamp;
        layer.animations.forEach(animation => { animation.play(); animation.startTime = time; });
      } catch { remove(layer); }
    };
    if (defer) layer.frame = view.requestAnimationFrame(start); else start(view.performance.now());
  }
  function finish(layer: Layer) {
    // Never cut a running effect short with a wall-clock deadline: rendering
    // may start late or be throttled. Hidden windows and disposal clear it.
    const revision = layer.revision;
    const done = () => { if (layer.revision === revision) remove(layer); };
    void Promise.all(layer.animations.map(animation => animation.finished)).then(done, done);
  }
  function geometry(shell: HTMLElement) {
    const rect = shell.getBoundingClientRect(), root = document.documentElement;
    const zoom = root.offsetWidth ? root.getBoundingClientRect().width / root.offsetWidth : 1;
    return { rect, zoom: zoom || 1 };
  }
  function line(layer: ReturnType<typeof mount>, rect: DOMRect, zoom: number, style: ScanStyle = 'crt') {
    const node = document.createElement('div');
    if (style === 'hologram') node.dataset.modalHologramLine = ''; else node.dataset.modalCrtLine = '';
    const accent = view.getComputedStyle(document.documentElement).getPropertyValue('--modal-beam-accent').trim() || 'currentColor';
    const top = rect.top;
    node.style.cssText = `position:absolute;left:${rect.left / zoom}px;top:${top / zoom}px;width:${rect.width / zoom}px;height:2px;transform:translateY(-50%);pointer-events:none;`;
    node.style.background = accent; node.style.boxShadow = `0 0 12px ${accent}`;
    if (style === 'hologram') {
      const trail = document.createElement('div'); trail.dataset.modalHologramTrail = '';
      trail.style.cssText = 'position:absolute;inset:auto 0 100%;height:16px;opacity:.25;pointer-events:none;';
      trail.style.background = `linear-gradient(to bottom, transparent, ${accent})`;
      node.append(trail);
    }
    layer.node.append(node); return node;
  }
  function scan(layer: Layer, shell: HTMLElement, style: ScanStyle, speed: number, closing = false, clip = 'none', backdrop?: HTMLElement, fixed?: { rect: DOMRect; zoom: number }) {
    const initial = fixed ?? geometry(shell);
    const beams = style === 'crt' ? [line(layer, initial.rect, initial.zoom, style), line(layer, initial.rect, initial.zoom, style)] : [line(layer, initial.rect, initial.zoom, style)];
    let plan: ScanPlan | undefined, clock: Animation | undefined, signature = '';
    const retarget = () => {
      if (!layers.has(layer)) return;
      const box = fixed ?? geometry(shell), nextSignature = JSON.stringify([box.rect.top, box.rect.left, box.rect.width, box.rect.height, box.zoom]);
      if (nextSignature === signature) return;
      signature = nextSignature;
      const bounds = { top: box.rect.top / box.zoom, bottom: (box.rect.top + box.rect.height) / box.zoom };
      const elapsed = typeof clock?.currentTime === 'number' ? clock.currentTime : 0;
      const from = plan && layer.frame === undefined ? sampleScan(plan, elapsed) : closing ? edgesFromClip(style, bounds, clip) : initialScanEdges(style, bounds);
      const defer = !plan || layer.frame !== undefined;
      // Retiring one segment must not let its rejected finished Promise remove
      // the successor. Preserve edge positions, not normalized time/height.
      layer.revision++;
      if (layer.frame !== undefined) { view.cancelAnimationFrame(layer.frame); layer.frame = undefined; }
      layer.animations.forEach(animation => animation.cancel()); layer.animations = [];
      plan = planScan(style, bounds, from, speed, closing);
      if (plan.duration < .01) { remove(layer); return; }
      const segment = plan, offsets = scanOffsets(segment);
      clock = animate(layer, shell, offsets.map(offset => ({ offset, clipPath: scanClip(bounds, sampleScan(segment, offset * segment.duration)) })), segment.duration);
      beams.forEach((beam, index) => {
        beam.style.left = `${box.rect.left / box.zoom}px`; beam.style.top = `${bounds.top}px`; beam.style.width = `${box.rect.width / box.zoom}px`;
        const edge = style === 'crt' && index === 0 ? 'top' : 'bottom';
        beam.dataset.modalScanEdge = edge;
        animate(layer, beam, offsets.map(offset => {
          const y = sampleScan(segment, offset * segment.duration)[edge];
          return { offset, transform: `translateY(${y - bounds.top}px) translateY(-50%)`, opacity: y < bounds.top || y > bounds.bottom ? 0 : 1 };
        }), segment.duration);
      });
      if (backdrop) animate(layer, backdrop, [{ opacity: 1 }, { opacity: 0 }], Math.min(150, segment.duration), 'ease-in');
      startTogether(layer, defer); finish(layer);
    };
    retarget();
    if (!closing && layers.has(layer) && typeof view.ResizeObserver === 'function') {
      layer.observer = new view.ResizeObserver(() => { try { retarget(); } catch { remove(layer); } });
      layer.observer.observe(shell);
    }
  }
  function capture(source: HTMLElement): Snapshot | undefined {
    const shell = source.matches('.nimrod-modal') ? source : source.querySelector<HTMLElement>('.nimrod-modal');
    const settings = motion(document, true);
    if (disposed || !shell || !settings.duration || typeof shell.animate !== 'function' || (isScanStyle(settings.style) && preparing.has(source))) return;
    const { rect, zoom } = geometry(shell);
    if (!rect.width || !rect.height) return;
    const computed = view.getComputedStyle(shell);
    const opacity = computed.opacity || '1', clip = computed.clipPath || 'none';
    const backdropStyle = view.getComputedStyle(source, source.localName === 'dialog' ? '::backdrop' : '::before');
    const backdrop = backdropStyle.backgroundColor;
    const backdropFilter = backdropStyle.getPropertyValue('backdrop-filter') || backdropStyle.getPropertyValue('-webkit-backdrop-filter');
    // A detached clone has no listeners and never owns an interaction.
    const clone = shell.cloneNode(true) as HTMLElement;
    for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('*')]) {
      node.removeAttribute('autofocus');
      if (node.matches('a, button, input, select, textarea, [tabindex], [contenteditable]')) node.tabIndex = -1;
      node.removeAttribute('contenteditable');
      for (const attribute of [...node.attributes]) if (attribute.name.startsWith('on')) node.removeAttribute(attribute.name);
    }
    // cloneNode does not retain edited textarea/select state or scroll offsets.
    const originals = [shell, ...shell.querySelectorAll<HTMLElement>('*')];
    const copies = [clone, ...clone.querySelectorAll<HTMLElement>('*')];
    const positions: { copy: HTMLElement; top: number; left: number }[] = [];
    const fields = shell.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    const clonedFields = clone.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input, textarea, select');
    fields.forEach((field, index) => {
      const copy = clonedFields[index]; if (!copy) return;
      if (!(field instanceof view.HTMLInputElement && field.type === 'file')) copy.value = field.value;
      if (field instanceof view.HTMLInputElement && copy instanceof view.HTMLInputElement) copy.checked = field.checked;
    });
    // Save scroll offsets separately: set them only once the shadow snapshot is mounted.
    for (let index = 0; index < originals.length; index++) {
      const original = originals[index], copy = copies[index];
      if (copy && (original.scrollTop || original.scrollLeft)) positions.push({ copy, top: original.scrollTop, left: original.scrollLeft });
    }
    clone.querySelectorAll('script, iframe, object, embed, #application-notices, #application-notice-slot').forEach(node => node.remove());
    for (const node of [clone, ...clone.querySelectorAll<HTMLElement>('[id]')]) {
      if (node.id) { node.dataset.modalSnapshotId = node.id; node.removeAttribute('id'); }
    }
    clone.style.cssText += `;position:absolute!important;inset:0 auto auto 0!important;margin:0!important;width:${rect.width / zoom}px!important;height:${rect.height / zoom}px!important;max-width:none!important;max-height:none!important;transform:none!important;opacity:1!important;clip-path:none!important;`;
    // Freeze inherited per-window theme tokens and typography, not live notices.
    for (const property of Array.from(computed)) if (property.startsWith('--')) clone.style.setProperty(property, computed.getPropertyValue(property));
    for (const property of ['font', 'color', 'line-height']) clone.style.setProperty(property, computed.getPropertyValue(property));
    const host = document.createElement('div');
    host.style.cssText = `position:absolute;left:${rect.left / zoom}px;top:${rect.top / zoom}px;width:${rect.width / zoom}px;height:${rect.height / zoom}px;transform-origin:center top;pointer-events:none;`;
    const shadow = host.attachShadow({ mode: 'open' }), css = document.createElement('style');
    css.textContent = snapshotStyles(document) + '\n*, *::before, *::after { animation:none!important;transition:none!important;caret-color:transparent!important;pointer-events:none!important; }';
    shadow.append(css, clone);
    return { shell: host, rect, zoom, backdrop, backdropFilter, motion: settings, opacity, clip,
      restoreScroll: () => positions.forEach(({ copy, top, left }) => { copy.scrollTop = top; copy.scrollLeft = left; }),
    };
  }
  // Decorative failures must never prevent an actual close or leak modality.
  function safeCapture(source: HTMLElement): Snapshot | undefined {
    try { return capture(source); } catch { return undefined; }
  }
  function present(source: HTMLElement, snapshot?: Snapshot) {
    try { presentSnapshot(source, snapshot); } catch { for (const layer of [...layers]) if (layer.source === source) remove(layer); }
  }
  function presentSnapshot(source: HTMLElement, snapshot?: Snapshot) {
    if (!snapshot || disposed || !source.isConnected || !motion(document, true).duration) return;
    for (const layer of [...layers]) if (layer.source === source) remove(layer);
    const layer = mount(source, 'exit'), { duration, style } = snapshot.motion;
    layer.node.append(snapshot.shell);
    snapshot.restoreScroll();
    if (isScanStyle(style)) {
      const backdrop = document.createElement('div'); backdrop.dataset.modalMotionBackdrop = '';
      backdrop.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      backdrop.style.background = snapshot.backdrop; layer.node.prepend(backdrop);
      applyBackdropFilter(backdrop, snapshot.backdropFilter);
      scan(layer, snapshot.shell, style, snapshot.motion.scanSpeed, true, snapshot.clip, backdrop, { rect: snapshot.rect, zoom: snapshot.zoom });
      return;
    } else {
      layer.node.style.background = snapshot.backdrop;
      applyBackdropFilter(layer.node, snapshot.backdropFilter);
      animate(layer, layer.node, [{ opacity: 1 }, { opacity: 0 }], duration);
      animate(layer, snapshot.shell, [{ opacity: snapshot.opacity, transform: 'none' }, { opacity: 0, transform: 'translateY(4px) scale(.98)' }], duration, 'ease-in');
    }
    finish(layer);
  }
  function opening(source: HTMLElement) {
    clear(); preparing.add(source); const generation = bump(source), openingEpoch = epoch;
    queueMicrotask(() => {
      preparing.delete(source);
      try {
        if (disposed || epoch !== openingEpoch || generations.get(source) !== generation || !source.isConnected) return;
        const settings = motion(document);
        const shell = source.matches('.nimrod-modal') ? source : source.querySelector<HTMLElement>('.nimrod-modal');
        if (!isScanStyle(settings.style) || !settings.scanSpeed || !shell || typeof shell.animate !== 'function') return;
        if (source.localName === 'dialog' ? !(source as HTMLDialogElement).open : !source.classList.contains('open')) return;
        const { rect } = geometry(shell); if (!rect.width || !rect.height) return;
        scan(mount(source, 'enter'), shell, settings.style, settings.scanSpeed);
      } catch { for (const layer of [...layers]) if (layer.source === source) remove(layer); }
    });
  }
  function closing(source: HTMLElement, close: () => void) {
    const snapshot = pending.has(source) ? pending.get(source)!.snapshot : safeCapture(source);
    pending.delete(source); bump(source);
    close(); present(source, snapshot);
  }
  const nativeDismissal = (event: Event) => {
    const target = event.target;
    const dialog = target instanceof view.HTMLDialogElement ? target : target instanceof view.HTMLFormElement && target.method === 'dialog' ? target.closest('dialog') : null;
    if (!dialog?.matches('.nimrod-modal') || !dialog.open) return;
    const record: NativeDismissal = { event, generation: generations.get(dialog), epoch, snapshot: safeCapture(dialog) };
    pending.set(dialog, record);
    // Trusted input can checkpoint microtasks between event listeners, before
    // the form/cancel default closes the dialog. Keep the capture for the real
    // close event instead of assuming a microtask runs after that default.
    const timer = view.setTimeout(() => {
      pendingCleanup.delete(timer);
      if (pending.get(dialog) === record && (event.defaultPrevented || dialog.open)) pending.delete(dialog);
    }, 0);
    pendingCleanup.add(timer);
  };
  const nativeClosed = (event: Event) => {
    const dialog = event.target;
    if (!(dialog instanceof view.HTMLDialogElement)) return;
    const record = pending.get(dialog); pending.delete(dialog);
    clearModalDepth(dialog);
    if (record && !record.event.defaultPrevented && !dialog.open && epoch === record.epoch && generations.get(dialog) === record.generation) {
      bump(dialog); present(dialog, record.snapshot);
    }
  };
  document.addEventListener('cancel', nativeDismissal, true);
  document.addEventListener('submit', nativeDismissal, true);
  document.addEventListener('close', nativeClosed, true);
  const reduced = view.matchMedia?.('(prefers-reduced-motion: reduce)');
  reduced?.addEventListener('change', clear);
  const visibility = () => { if (document.visibilityState === 'hidden') clear(); };
  document.addEventListener('visibilitychange', visibility);
  view.addEventListener('resize', clear); view.addEventListener('pagehide', clear);
  return { opening, closing, clear, dispose() {
    disposed = true; clear(); owners.delete(document);
    document.removeEventListener('cancel', nativeDismissal, true); document.removeEventListener('submit', nativeDismissal, true);
    document.removeEventListener('close', nativeClosed, true);
    document.removeEventListener('visibilitychange', visibility);
    reduced?.removeEventListener('change', clear);
    view.removeEventListener('resize', clear); view.removeEventListener('pagehide', clear);
  } };
}

export function installModalMotion(document: Document) {
  let owner = owners.get(document);
  if (!owner) { owner = createModalMotion(document); owners.set(document, owner); }
  return owner;
}
export function clearModalMotion(document: Document): void { owners.get(document)?.clear(); }
export function showModal(dialog: HTMLDialogElement): void {
  prepareModalDepth(dialog);
  try { dialog.showModal(); } catch (error) { clearModalDepth(dialog); throw error; }
  installModalMotion(dialog.ownerDocument).opening(dialog);
}
export function closeModal(dialog: HTMLDialogElement, result?: string): void {
  if (!dialog.open) return;
  installModalMotion(dialog.ownerDocument).closing(dialog, () => { if (result === undefined) dialog.close(); else dialog.close(result); });
}
export function showModalOverlay(overlay: HTMLElement): void {
  prepareModalDepth(overlay); overlay.classList.add('open'); installModalMotion(overlay.ownerDocument).opening(overlay);
}
export function closeModalOverlay(overlay: HTMLElement): void {
  if (!overlay.classList.contains('open')) return;
  installModalMotion(overlay.ownerDocument).closing(overlay, () => { overlay.classList.remove('open'); clearModalDepth(overlay); });
}
