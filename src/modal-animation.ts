import { clearModalMotion } from './modal-motion';
import { DEFAULT_MODAL_DURATIONS, modalExitDuration, type ModalAnimationStyle } from './modal-animation-defaults';

export type { ModalAnimationStyle } from './modal-animation-defaults';
export interface ModalAnimation { style: ModalAnimationStyle; duration: number }
export const MODAL_ANIMATION_KEYS = {
  style: 'appearance.modalAnimation',
  duration: 'appearance.modalAnimationDuration',
} as const;

export function readModalAnimation(settings: Record<string, unknown>): ModalAnimation {
  const style = settings[MODAL_ANIMATION_KEYS.style] === undefined ? 'subtle' : settings[MODAL_ANIMATION_KEYS.style];
  if (style !== 'none' && style !== 'subtle' && style !== 'crt' && style !== 'hologram') throw new Error('appearance.modalAnimation must be none, subtle, crt or hologram.');
  const duration = settings[MODAL_ANIMATION_KEYS.duration] === undefined ? DEFAULT_MODAL_DURATIONS[style] : settings[MODAL_ANIMATION_KEYS.duration];
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 2000) {
    throw new Error('appearance.modalAnimationDuration must be an integer from 0 to 2000 milliseconds.');
  }
  return { style, duration };
}

/** Presentation only: never delay dialog.close(), focus, input or request settlement. */
export function applyModalAnimation(root: HTMLElement, animation: ModalAnimation): void {
  if (root.dataset.modalAnimation !== animation.style || root.style.getPropertyValue('--modal-enter-duration') !== `${animation.style === 'none' ? 0 : animation.duration}ms`) clearModalMotion(root.ownerDocument);
  root.dataset.modalAnimation = animation.style;
  root.style.setProperty('--modal-enter-duration', `${animation.style === 'none' ? 0 : animation.duration}ms`);
  root.style.setProperty('--modal-exit-duration', `${modalExitDuration(animation.style, animation.duration)}ms`);
}
