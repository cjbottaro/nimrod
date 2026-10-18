import { pixelTileScale, pixelTileProgress, type PixelGrid } from './modal-pixels';

export interface PixelSurfaceOptions { blur: number; fade: boolean }
export function pixelCapabilities(css?: { supports(property: string, value: string): boolean }) {
  return {
    blur: css?.supports('backdrop-filter', 'blur(1px)') ? 'backdropFilter' : css?.supports('-webkit-backdrop-filter', 'blur(1px)') ? 'webkitBackdropFilter' : undefined,
    fade: !!(css?.supports('mask-image', 'url("#pixel-mask")') || css?.supports('-webkit-mask-image', 'url("#pixel-mask")')),
  };
}
let maskSequence = 0;

/** Filters sample the live panel behind each tile; an SVG alpha mask fades the
 * actual content. No panel copies, external images, screen capture or JS frame loop.
 */
export function installPixelSurface(layer: HTMLElement, shell: HTMLElement, grid: PixelGrid, options: PixelSurfaceOptions,
  progress: number, position: { left: number; top: number }, animate: (element: Element, frames: Keyframe[]) => void): () => void {
  const document = shell.ownerDocument, capabilities = pixelCapabilities(document.defaultView?.CSS);
  const owned: Element[] = [], masks = ['mask-image', '-webkit-mask-image'];
  const previous = masks.map(property => ({ property, value: shell.style.getPropertyValue(property), priority: shell.style.getPropertyPriority(property) }));
  let maskId = '';
  const cleanup = () => {
    if (maskId) for (const { property, value, priority } of previous) {
      if (!shell.style.getPropertyValue(property).includes('#' + maskId)) continue;
      if (value) shell.style.setProperty(property, value, priority); else shell.style.removeProperty(property);
    }
    owned.forEach(node => node.remove());
  };
  const frames = (tile: PixelGrid['tiles'][number], build: (t: number, scale: number) => Keyframe) =>
    Array.from({ length: 13 }, (_, index) => {
      const p = index / 12 * progress;
      return { offset: index / 12, ...build(pixelTileProgress(grid, tile, p), pixelTileScale(grid, tile, p)) };
    });
  try {
    if (options.fade && capabilities.fade) {
      do { maskId = 'nimrod-pixel-mask-' + ++maskSequence; } while (document.getElementById(maskId));
      const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
      svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.setAttribute('aria-hidden', 'true');
      svg.style.cssText = 'position:absolute;pointer-events:none;forced-color-adjust:none;'; svg.dataset.modalPixelMask = '';
      const defs = document.createElementNS(ns, 'defs'), mask = document.createElementNS(ns, 'mask');
      mask.id = maskId; mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('maskContentUnits', 'userSpaceOnUse');
      mask.setAttribute('x', '0'); mask.setAttribute('y', '0'); mask.setAttribute('width', String(grid.width)); mask.setAttribute('height', String(grid.height));
      mask.style.maskType = 'alpha'; defs.append(mask); svg.append(defs); layer.append(svg); owned.push(svg);
      for (const tile of grid.tiles) {
        const rect = document.createElementNS(ns, 'rect');
        // Overlap mask cells slightly to avoid antialiased seams at full alpha;
        // the separate hard clipping path still defines the tile's exact edge.
        rect.setAttribute('x', String(tile.x - .5)); rect.setAttribute('y', String(tile.y - .5));
        rect.setAttribute('width', String(tile.width + 1)); rect.setAttribute('height', String(tile.height + 1));
        rect.setAttribute('fill', 'white'); mask.append(rect);
        animate(rect, frames(tile, t => ({ opacity: t })));
      }
      for (const property of masks) shell.style.setProperty(property, `url("#${maskId}")`);
    }
    if (options.blur > 0 && capabilities.blur) for (const tile of grid.tiles) {
      const surface = document.createElement('div'); surface.dataset.modalPixelBlurTile = '';
      surface.style.cssText = `position:absolute;left:${position.left + tile.x}px;top:${position.top + tile.y}px;width:${tile.width}px;height:${tile.height}px;pointer-events:none;background:transparent;`;
      // Keep filters as direct layer children: a clipped/transparent ancestor
      // would create a backdrop root and prevent sampling the live panel.
      layer.append(surface); owned.push(surface);
      animate(surface, frames(tile, (t, scale) => ({
        clipPath: `inset(${tile.height * (1 - scale) / 2}px ${tile.width * (1 - scale) / 2}px)`,
        [capabilities.blur!]: `blur(${Number((options.blur * (1 - t)).toFixed(3))}px)`,
      })));
    }
    return cleanup;
  } catch (error) { cleanup(); throw error; }
}
