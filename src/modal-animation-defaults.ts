export const DEFAULT_MODAL_DURATIONS = { none: 500, subtle: 500, crt: 300, hologram: 300 } as const;
export type ModalAnimationStyle = keyof typeof DEFAULT_MODAL_DURATIONS;

export function normalizeModalDuration(duration: number): number {
  return Math.round(Math.min(1500, Math.max(100, duration)) / 10) * 10;
}

export function modalExitDuration(style: ModalAnimationStyle, duration: number): number {
  return style === 'none' ? 0 : Math.round(duration * (style === 'crt' || style === 'hologram' ? .8 : .75));
}
