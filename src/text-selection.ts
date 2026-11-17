import { buttonContrast } from './button-surfaces';
import { titlebarTint } from './window-appearance';

export const SELECTION_TEXT_CONTRAST = 4.5;
export const SELECTION_SURFACE_CONTRAST = 3;
type RGB = [number, number, number];
const hex = (rgb: RGB) => '#' + rgb.map(c => Math.round(c).toString(16).padStart(2, '0')).join('');

/** Resolve source alpha against the nominal backing, then use an opaque highlight.
 * This protects selected text even over an unknown desktop. Highlight-to-desktop
 * contrast cannot be guaranteed in a transparent window without sampling it.
 */
export function textSelectionSurface(background: string, selection: string, foreground: string) {
  const backing = titlebarTint(background, 100) ?? [21, 28, 32, 255];
  const fill = titlebarTint(selection, 100) ?? backing;
  const alpha = fill[3] / 255;
  const source = fill.slice(0, 3).map((c, i) => c * alpha + backing[i] * (1 - alpha)) as RGB;
  const surface = hex(backing.slice(0, 3) as RGB);
  let highlight = hex(source);
  if (buttonContrast(highlight, surface, 1) < SELECTION_SURFACE_CONTRAST) {
    // Search both directions and retain the smallest RGB change that passes.
    // At least one neutral endpoint always contrasts with a single backing.
    let distance = Infinity;
    for (const endpoint of [0, 255]) {
      for (let step = 1; step <= 255; step++) {
        const candidate = source.map(c => c + (endpoint - c) * step / 255) as RGB;
        const color = hex(candidate);
        if (buttonContrast(color, surface, 1) < SELECTION_SURFACE_CONTRAST) continue;
        const delta = candidate.reduce((sum, c, i) => sum + (c - source[i]) ** 2, 0);
        if (delta < distance) { distance = delta; highlight = color; }
        break;
      }
    }
  }
  const preferred = titlebarTint(foreground, 100);
  const text = preferred && preferred[3] === 255 ? hex(preferred.slice(0, 3) as RGB) : undefined;
  const candidates = [text, '#000000', '#ffffff'].filter((c): c is string => !!c);
  return {
    background: highlight,
    foreground: candidates.find(c => buttonContrast(c, highlight, 1) >= SELECTION_TEXT_CONTRAST)!,
  };
}
