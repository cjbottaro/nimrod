import { clearModalMotion } from './modal-motion';
import { DEFAULT_MODAL_DURATIONS, DEFAULT_SCAN_SPEEDS, isScanStyle, modalExitDuration, normalizeModalDuration, normalizeScanSpeed, type ModalAnimationStyle } from './modal-animation-defaults';

export type { ModalAnimationStyle } from './modal-animation-defaults';
export interface ModalAnimation { style: ModalAnimationStyle; duration: number; scanSpeed?: number }
export const MODAL_ANIMATION_KEYS = {
  style: 'appearance.modalAnimation',
  duration: 'appearance.modalAnimationDuration',
  scanSpeed: 'appearance.modalScanSpeed',
} as const;

export function readModalAnimation(settings: Record<string, unknown>): ModalAnimation {
  const style = settings[MODAL_ANIMATION_KEYS.style] === undefined ? 'subtle' : settings[MODAL_ANIMATION_KEYS.style];
  if (style !== 'none' && style !== 'subtle' && style !== 'crt' && style !== 'hologram' && style !== 'pixel') throw new Error('appearance.modalAnimation must be none, subtle, crt, hologram or pixel.');
  const duration = settings[MODAL_ANIMATION_KEYS.duration] === undefined ? DEFAULT_MODAL_DURATIONS[style] : settings[MODAL_ANIMATION_KEYS.duration];
  if (typeof duration !== 'number' || !Number.isInteger(duration) || duration < 0 || duration > 2000) {
    throw new Error('appearance.modalAnimationDuration must be an integer from 0 to 2000 milliseconds.');
  }
  const scanSpeed = settings[MODAL_ANIMATION_KEYS.scanSpeed];
  if (scanSpeed !== undefined && (typeof scanSpeed !== 'number' || !Number.isInteger(scanSpeed) || scanSpeed < 100 || scanSpeed > 1500)) {
    throw new Error('appearance.modalScanSpeed must be an integer from 100 to 1500 pixels per second.');
  }
  // Duration remains readable for old files, but scan styles never reinterpret it as speed.
  return { style, duration: normalizeModalDuration(duration), ...(isScanStyle(style) || scanSpeed !== undefined
    ? { scanSpeed: normalizeScanSpeed(typeof scanSpeed === 'number' ? scanSpeed : isScanStyle(style) ? DEFAULT_SCAN_SPEEDS[style] : 1000) } : {}) };
}

/** Presentation only: never delay dialog.close(), focus, input or request settlement. */
export function applyModalAnimation(root: HTMLElement, animation: ModalAnimation): void {
  const duration = normalizeModalDuration(animation.duration);
  const scanSpeed = normalizeScanSpeed(animation.scanSpeed ?? (isScanStyle(animation.style) ? DEFAULT_SCAN_SPEEDS[animation.style] : 1000));
  const changed = isScanStyle(animation.style)
    ? root.style.getPropertyValue('--modal-scan-speed') !== String(scanSpeed)
    : root.style.getPropertyValue('--modal-enter-duration') !== `${animation.style === 'none' ? 0 : duration}ms`;
  if (root.dataset.modalAnimation !== animation.style || changed) clearModalMotion(root.ownerDocument);
  root.dataset.modalAnimation = animation.style;
  root.style.setProperty('--modal-scan-speed', String(scanSpeed));
  // Scan timing comes from geometry; these tokens only time its scrim.
  root.style.setProperty('--modal-enter-duration', `${animation.style === 'none' ? 0 : isScanStyle(animation.style) ? 150 : duration}ms`);
  root.style.setProperty('--modal-exit-duration', `${isScanStyle(animation.style) ? 150 : modalExitDuration(animation.style, duration)}ms`);
}
