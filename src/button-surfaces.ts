import { titlebarTint } from './window-appearance';

type RGB = [number, number, number];
export const BUTTON_CONTRAST = 4.5;
export const BUTTON_TINT_DISCOUNT = .05;
const black: RGB = [0, 0, 0], white: RGB = [255, 255, 255];
function rgb(hex: string): RGB | undefined {
  const color = titlebarTint(hex, 100);
  if (color) return [color[0], color[1], color[2]];
}
const hex = (color: RGB) => '#' + color.map(channel => channel.toString(16).padStart(2, '0')).join('');
function luminance(color: RGB) {
  const linear = color.map(channel => { const value = channel / 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; });
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function contrast(a: number, b: number) { return (Math.max(a, b) + .05) / (Math.min(a, b) + .05); }

/** Bound contrast over any desktop colour, not just the current theme background.
 * A fill's composited luminance lies between its black/white underlay bounds.
 * If the foreground lies inside that interval, an underlay can give contrast 1.
 */
export function buttonContrast(foreground: string, background: string, alpha: number, underlay?: { color: string; opacity: number }): number {
  const text = rgb(foreground), fill = rgb(background);
  if (!text || !fill) return 1;
  const foregroundLuminance = luminance(text);
  const parent = underlay && titlebarTint(underlay.color, 100);
  const parentAlpha = parent ? underlay!.opacity * parent[3] / 255 : 0;
  const composite = (desktop: RGB): RGB => fill.map((channel, index) => {
    const below = parent ? parent[index] * parentAlpha + desktop[index] * (1 - parentAlpha) : desktop[index];
    return channel * alpha + below * (1 - alpha);
  }) as RGB;
  const low = luminance(composite(black)), high = luminance(composite(white));
  if (foregroundLuminance >= low && foregroundLuminance <= high) return 1;
  return Math.min(contrast(foregroundLuminance, low), contrast(foregroundLuminance, high));
}

/** Preserve a readable palette foreground, otherwise choose a neutral fallback.
 * Keep that text colour stable; increase only fill density as needed. Never
 * interpolate opposite foregrounds through a low-contrast middle colour.
 * Button-specific solid colour roles leave the original palette tokens intact.
 */
export function buttonSurface(foreground: string, background: string) {
  const fill = rgb(background);
  if (!fill) return undefined;
  const backgroundColor = hex(fill);
  const preferred = rgb(foreground);
  const candidates = [preferred, black, white].filter((color): color is RGB => !!color);
  const text = candidates.find(color => buttonContrast(hex(color), backgroundColor, 1) >= BUTTON_CONTRAST)!;
  const foregroundColor = hex(text);
  let low = 0, high = 1;
  for (let i = 0; i < 24; i++) {
    const middle = (low + high) / 2;
    if (buttonContrast(foregroundColor, backgroundColor, middle) >= BUTTON_CONTRAST) high = middle; else low = middle;
  }
  // Round upward: CSS percentage serialization must not drop below the bound.
  const minimum = Math.min(1, Math.ceil(high * 1_000_000) / 1_000_000);
  return { foreground: foregroundColor, background: backgroundColor, minimum };
}

export function primaryButtonSurfaces(foreground: string, background: string, hoverBackground: string) {
  const normal = buttonSurface(foreground, background);
  let hover = normal && buttonSurface(normal.foreground, hoverBackground);
  // Keep one text colour across states. Incompatible hover hues use the normal
  // hue with stronger hover density, rather than making its label unreadable.
  if (hover && hover.foreground !== normal?.foreground) hover = normal;
  return { normal, hover };
}

/** Credit only tint that is actually beneath a control. Channel-wise bounds
 * conservatively replace part of the fill's black/white-underlay protection;
 * arbitrary hues and palette alpha remain safe without sampling the desktop.
 */
export function buttonUnderlayCredit(surface: ReturnType<typeof buttonSurface>, underlay: string): number {
  const parent = titlebarTint(underlay, 100);
  if (!surface || !parent) return 0;
  const fill = rgb(surface.background)!, text = rgb(surface.foreground)!;
  const darkText = luminance(text) < luminance(fill);
  const ratios = fill.map((channel, index) => {
    const distance = darkText ? channel : 255 - channel;
    const contribution = darkText ? parent[index] : 255 - parent[index];
    return distance === 0 ? 1 : contribution / distance;
  });
  return Math.max(0, Math.min(1, ...ratios)) * parent[3] / 255;
}

/** Overlay alpha may decrease as its parent gains tint, but the composited
 * density p + (1-p)*a remains monotonic. Keep the role floor, opaque endpoint
 * and the existing 4.5:1 bound; never credit an unknown/untinted parent.
 */
export function tintedButtonDensity(density: number, opacity: number, credit: number, roleMinimum: number, endpoint = opacity ** 8): number {
  if (opacity >= 1) return 1;
  const contribution = opacity * credit;
  const safe = (density - contribution) / (1 - contribution);
  const discounted = Math.max(safe, density - BUTTON_TINT_DISCOUNT * (1 - endpoint));
  const role = buttonDensity(0, endpoint, roleMinimum);
  return Math.min(1, Math.ceil(Math.max(role, discounted) * 1_000_000) / 1_000_000);
}

export function buttonDensity(minimum: number, endpoint: number, roleMinimum: number) {
  const floor = Math.max(minimum, roleMinimum);
  return floor + (1 - floor) * endpoint;
}
