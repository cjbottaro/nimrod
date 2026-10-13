export interface WindowAppearance {
  opacity: number;
  frosted: boolean;
  area: 'chrome' | 'window';
}
export interface AppearanceCapabilities {
  platform: string;
  transparency: boolean;
  frost: boolean;
  reducedTransparency: boolean;
}
export const DEFAULT_WINDOW_APPEARANCE: WindowAppearance = { opacity: 100, frosted: true, area: 'window' };
export const APPEARANCE_KEYS = {
  opacity: 'appearance.backgroundOpacity', frosted: 'appearance.frostedBackground', area: 'appearance.translucencyArea',
} as const;

export function readWindowAppearance(settings: Record<string, unknown>): WindowAppearance {
  const opacity = settings[APPEARANCE_KEYS.opacity] ?? DEFAULT_WINDOW_APPEARANCE.opacity;
  const frosted = settings[APPEARANCE_KEYS.frosted] ?? DEFAULT_WINDOW_APPEARANCE.frosted;
  const area = settings[APPEARANCE_KEYS.area] ?? DEFAULT_WINDOW_APPEARANCE.area;
  // Explicit nulls are invalid too; missing keys alone use defaults.
  for (const key of Object.values(APPEARANCE_KEYS)) if (settings[key] === null) throw new Error(`${key} cannot be null.`);
  if (typeof opacity !== 'number' || !Number.isInteger(opacity) || opacity < 0 || opacity > 100) throw new Error(`${APPEARANCE_KEYS.opacity} must be an integer from 0 to 100.`);
  if (typeof frosted !== 'boolean') throw new Error(`${APPEARANCE_KEYS.frosted} must be a boolean.`);
  if (area !== 'chrome' && area !== 'window') throw new Error(`${APPEARANCE_KEYS.area} must be chrome or window.`);
  return { opacity, frosted, area };
}

/** Preserve surface hierarchy and converge to the opaque palette, not a 99% style switch.
 * Overlays are composited over an already-tinted parent. Keep modest role-specific
 * density at low opacity, then ease their color contribution to 100% near opaque.
 */
export function windowSurfaceOpacities(opacity: number) {
  const base = opacity / 100;
  const endpoint = base ** 8;
  const blend = (minimum: number) => minimum + (1 - minimum) * endpoint;
  const panel = blend(.25);
  return {
    endpoint, control: blend(.10), panel,
    button: blend(.35), buttonHover: blend(.45), state: blend(.30),
    selection: blend(.45), danger: blend(.45),
    // A fixed-position application strip has no tinted parent beneath it.
    notice: base + (1 - base) * panel,
  };
}

export type TitlebarTint = [number, number, number, number];

/** Theme imports are hex-only; keep the native title bar on the Project-bar recipe. */
export function titlebarTint(color: string, opacity: number): TitlebarTint | undefined {
  if (!/^#[\da-f]{3,4}$|^#[\da-f]{6}([\da-f]{2})?$/i.test(color.trim())) return;
  let hex = color.trim().slice(1);
  if (hex.length <= 4) hex = [...hex].map(channel => channel + channel).join('');
  const channels = [0, 2, 4].map(offset => parseInt(hex.slice(offset, offset + 2), 16));
  const alpha = hex.length === 8 ? parseInt(hex.slice(6), 16) : 255;
  return [channels[0], channels[1], channels[2], Math.round(alpha * opacity / 100)];
}

