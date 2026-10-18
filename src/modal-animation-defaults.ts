// Scan-style duration entries only preserve legacy decoding; scan motion uses px/s.
export const DEFAULT_MODAL_DURATIONS = { none: 500, subtle: 500, crt: 300, hologram: 300 } as const;
export type ModalAnimationStyle = keyof typeof DEFAULT_MODAL_DURATIONS;
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
  return style === 'none' ? 0 : Math.round(duration * (style === 'crt' || style === 'hologram' ? .8 : .75));
}
