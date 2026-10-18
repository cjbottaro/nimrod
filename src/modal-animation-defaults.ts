export const DEFAULT_MODAL_DURATIONS = { none: 500, subtle: 500, crt: 300 } as const;
export type ModalAnimationStyle = keyof typeof DEFAULT_MODAL_DURATIONS;

export function modalExitDuration(style: ModalAnimationStyle, duration: number): number {
  return style === 'none' ? 0 : Math.round(duration * (style === 'crt' ? .8 : .75));
}
