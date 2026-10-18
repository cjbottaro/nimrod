export interface PixelTile { x: number; y: number; width: number; height: number; delay: number }
export interface PixelGrid { width: number; height: number; tiles: PixelTile[] }
export const MAX_PIXEL_TILES = 96;

/** A bounded grid and deterministic shuffle: no per-tile DOM or random flicker. */
export function pixelGrid(width: number, height: number): PixelGrid {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return { width, height, tiles: [] };
  const size = Math.max(48, Math.sqrt(width * height / MAX_PIXEL_TILES));
  const columns = Math.max(1, Math.min(16, Math.floor(width / size)));
  const rows = Math.max(1, Math.min(Math.floor(MAX_PIXEL_TILES / columns), Math.floor(height / size)));
  const hash = (index: number) => {
    let value = Math.imul(index + 1, 0x9e3779b1);
    value = Math.imul(value ^ value >>> 16, 0x7feb352d);
    return (value ^ value >>> 15) >>> 0;
  };
  const order = Array.from({ length: columns * rows }, (_, index) => index).sort((a, b) => hash(a) - hash(b) || a - b);
  const ranks = new Map(order.map((index, rank) => [index, rank]));
  const tiles = Array.from({ length: columns * rows }, (_, index) => ({
    x: index % columns * width / columns, y: Math.floor(index / columns) * height / rows,
    width: width / columns, height: height / rows,
    delay: order.length === 1 ? 0 : ranks.get(index)! / (order.length - 1) * .65,
  }));
  return { width, height, tiles };
}

/** Each frame has identical path commands, so the native animation engine can
 * interpolate tile growth rather than swapping image URLs or running JS frames.
 */
export function pixelClip(grid: PixelGrid, progress: number): string {
  if (!grid.tiles.length) return 'none';
  const number = (value: number) => Number(value.toFixed(3));
  const paths = grid.tiles.map(tile => {
    const t = Math.max(0, Math.min(1, (progress - tile.delay) / (grid.tiles.length === 1 ? 1 : .35)));
    const scale = t * (2 - t);
    const w = tile.width * scale, h = tile.height * scale;
    const x = tile.x + (tile.width - w) / 2, y = tile.y + (tile.height - h) / 2;
    return `M${number(x)} ${number(y)}L${number(x + w)} ${number(y)}L${number(x + w)} ${number(y + h)}L${number(x)} ${number(y + h)}Z`;
  });
  return `path('${paths.join('')}')`;
}

export function pixelFrames(grid: PixelGrid, endProgress = 1): Keyframe[] {
  const end = Math.max(0, Math.min(1, endProgress));
  return Array.from({ length: 13 }, (_, index) => ({ offset: index / 12, clipPath: pixelClip(grid, index / 12 * end) }));
}
