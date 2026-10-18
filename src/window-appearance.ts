export interface WindowAppearance {
  opacity: number;
  blur: number;
}
export interface AppearanceCapabilities {
  platform: string;
  transparency: boolean;
  /** Compatibility field name: runtime support for independent native blur. */
  frost: boolean;
  reducedTransparency: boolean;
}
export const DEFAULT_WINDOW_APPEARANCE: WindowAppearance = { opacity: 100, blur: 20 };
export const APPEARANCE_KEYS = {
  opacity: 'appearance.backgroundOpacity', blur: 'appearance.backgroundBlur',
} as const;

export function readWindowAppearance(settings: Record<string, unknown>): WindowAppearance {
  const opacity = settings[APPEARANCE_KEYS.opacity] ?? DEFAULT_WINDOW_APPEARANCE.opacity;
  const legacyFrost = settings['appearance.frostedBackground'];
  if (legacyFrost !== undefined && typeof legacyFrost !== 'boolean') throw new Error('appearance.frostedBackground must be a boolean.');
  const blur = settings[APPEARANCE_KEYS.blur] ?? (legacyFrost === false ? 0 : DEFAULT_WINDOW_APPEARANCE.blur);
  // The removed translucencyArea preference is an ignored unknown field.
  // Explicit nulls are invalid too; missing keys alone use defaults.
  for (const key of Object.values(APPEARANCE_KEYS)) if (settings[key] === null) throw new Error(`${key} cannot be null.`);
  if (typeof opacity !== 'number' || !Number.isInteger(opacity) || opacity < 0 || opacity > 100) throw new Error(`${APPEARANCE_KEYS.opacity} must be an integer from 0 to 100.`);
  if (typeof blur !== 'number' || !Number.isInteger(blur) || blur < 0 || blur > 40) throw new Error(`${APPEARANCE_KEYS.blur} must be an integer from 0 to 40.`);
  return { opacity, blur };
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
    endpoint, control: blend(.10), panel, modal: blend(.72), modalBackdrop: .20 + (1 / 3 - .20) * endpoint,
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

