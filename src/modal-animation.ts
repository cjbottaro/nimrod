export type ModalAnimationStyle = 'none' | 'subtle' | 'crt';
export interface ModalAnimation { style: ModalAnimationStyle; duration: number }
export const MODAL_ANIMATION_KEYS = {
  style: 'appearance.modalAnimation',
  duration: 'appearance.modalAnimationDuration',
} as const;

export function readModalAnimation(settings: Record<string, unknown>): ModalAnimation {
  const style = settings[MODAL_ANIMATION_KEYS.style] === undefined ? 'subtle' : settings[MODAL_ANIMATION_KEYS.style];
  const duration = settings[MODAL_ANIMATION_KEYS.duration] === undefined ? 160 : settings[MODAL_ANIMATION_KEYS.duration];
  if (style !== 'none' && style !== 'subtle' && style !== 'crt') throw new Error('appearance.modalAnimation must be none, subtle or crt.');
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 2000) {
    throw new Error('appearance.modalAnimationDuration must be an integer from 0 to 2000 milliseconds.');
  }
  return { style, duration };
}

/** Presentation only: never delay dialog.close(), focus, input or request settlement. */
export function applyModalAnimation(root: HTMLElement, animation: ModalAnimation): void {
  root.dataset.modalAnimation = animation.style;
  root.style.setProperty('--modal-enter-duration', `${animation.style === 'none' ? 0 : animation.duration}ms`);
  root.style.setProperty('--modal-exit-duration', `${animation.style === 'none' ? 0 : Math.round(animation.duration * .75)}ms`);
}
