// Scan-style duration entries only preserve legacy decoding; scan motion uses px/s.
export const DEFAULT_MODAL_DURATIONS = { none: 500, subtle: 500, crt: 300, hologram: 300, pixel: 500 } as const;
export type ModalAnimationStyle = keyof typeof DEFAULT_MODAL_DURATIONS;
export const DEFAULT_PIXEL_OPTIONS = { pixelSize: 48, pixelBlur: 6, pixelFade: true } as const;
export const normalizePixelSize = (size: number) => Math.round(Math.min(120, Math.max(24, size)) / 8) * 8;
export const normalizePixelBlur = (blur: number) => Math.round(Math.min(12, Math.max(0, blur)));
export type ScanStyle = 'crt' | 'hologram';
export const DEFAULT_SCAN_SPEEDS = { crt: 500, hologram: 1000 } as const;
export const isScanStyle = (style: ModalAnimationStyle): style is ScanStyle => style === 'crt' || style === 'hologram';

export function normalizeScanSpeed(speed: number): number {
  return Math.round(Math.min(1500, Math.max(100, speed)) / 50) * 50;
}

export function normalizeModalDuration(duration: number): number {
  return Math.round(Math.min(1500, Math.max(100, duration)) / 10) * 10;
}

export function modalExitDuration(style: ModalAnimationStyle, duration: number): number {
  return style === 'none' ? 0 : Math.round(duration * (style === 'crt' || style === 'hologram' || style === 'pixel' ? .8 : .75));
}
