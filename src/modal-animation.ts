import { clearModalMotion } from './modal-motion';
import { DEFAULT_MODAL_DURATIONS, DEFAULT_PIXEL_OPTIONS, DEFAULT_SCAN_SPEEDS, isScanStyle, modalExitDuration, normalizeModalDuration, normalizePixelSize, normalizePixelBlur, normalizeScanSpeed, type ModalAnimationStyle } from './modal-animation-defaults';

export type { ModalAnimationStyle } from './modal-animation-defaults';
export interface ModalAnimation { style: ModalAnimationStyle; duration: number; scanSpeed?: number; pixelSize?: number; pixelBlur?: number; pixelFade?: boolean }
export const MODAL_ANIMATION_KEYS = {
  style: 'appearance.modalAnimation',
  duration: 'appearance.modalAnimationDuration',
  scanSpeed: 'appearance.modalScanSpeed',
  pixelSize: 'appearance.modalPixelSize',
  pixelBlur: 'appearance.modalPixelBlur',
  pixelFade: 'appearance.modalPixelFade',
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
  const pixelSize = settings[MODAL_ANIMATION_KEYS.pixelSize], pixelBlur = settings[MODAL_ANIMATION_KEYS.pixelBlur], pixelFade = settings[MODAL_ANIMATION_KEYS.pixelFade];
  if (pixelSize !== undefined && (typeof pixelSize !== 'number' || !Number.isInteger(pixelSize) || pixelSize < 24 || pixelSize > 120)) throw new Error('appearance.modalPixelSize must be an integer from 24 to 120 pixels.');
  if (pixelBlur !== undefined && (typeof pixelBlur !== 'number' || !Number.isInteger(pixelBlur) || pixelBlur < 0 || pixelBlur > 12)) throw new Error('appearance.modalPixelBlur must be an integer from 0 to 12 pixels.');
  if (pixelFade !== undefined && typeof pixelFade !== 'boolean') throw new Error('appearance.modalPixelFade must be a boolean.');
  const pixel = style === 'pixel' || pixelSize !== undefined || pixelBlur !== undefined || pixelFade !== undefined ? {
    pixelSize: typeof pixelSize === 'number' ? normalizePixelSize(pixelSize) : DEFAULT_PIXEL_OPTIONS.pixelSize,
    pixelBlur: typeof pixelBlur === 'number' ? normalizePixelBlur(pixelBlur) : DEFAULT_PIXEL_OPTIONS.pixelBlur,
    pixelFade: typeof pixelFade === 'boolean' ? pixelFade : DEFAULT_PIXEL_OPTIONS.pixelFade,
  } : {};
  // Duration remains readable for old files, but scan styles never reinterpret it as speed.
  return { style, duration: normalizeModalDuration(duration), ...pixel, ...(isScanStyle(style) || scanSpeed !== undefined
    ? { scanSpeed: normalizeScanSpeed(typeof scanSpeed === 'number' ? scanSpeed : isScanStyle(style) ? DEFAULT_SCAN_SPEEDS[style] : 1000) } : {}) };
}

/** Presentation only: never delay dialog.close(), focus, input or request settlement. */
export function applyModalAnimation(root: HTMLElement, animation: ModalAnimation): void {
  const duration = normalizeModalDuration(animation.duration);
  const scanSpeed = normalizeScanSpeed(animation.scanSpeed ?? (isScanStyle(animation.style) ? DEFAULT_SCAN_SPEEDS[animation.style] : 1000));
  const changed = isScanStyle(animation.style)
    ? root.style.getPropertyValue('--modal-scan-speed') !== String(scanSpeed)
    : root.style.getPropertyValue('--modal-enter-duration') !== `${animation.style === 'none' ? 0 : duration}ms`;
  const pixel = { pixelSize: normalizePixelSize(animation.pixelSize ?? DEFAULT_PIXEL_OPTIONS.pixelSize), pixelBlur: normalizePixelBlur(animation.pixelBlur ?? DEFAULT_PIXEL_OPTIONS.pixelBlur), pixelFade: animation.pixelFade ?? DEFAULT_PIXEL_OPTIONS.pixelFade };
  const pixelChanged = animation.style === 'pixel' && Object.entries(pixel).some(([key, value]) => root.style.getPropertyValue('--modal-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase())) !== String(value));
  if (root.dataset.modalAnimation !== animation.style || changed || pixelChanged) clearModalMotion(root.ownerDocument);
  for (const [key, value] of Object.entries(pixel)) root.style.setProperty('--modal-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), String(value));
  root.dataset.modalAnimation = animation.style;
  root.style.setProperty('--modal-scan-speed', String(scanSpeed));
  // Scan timing comes from geometry; these tokens only time its scrim.
  root.style.setProperty('--modal-enter-duration', `${animation.style === 'none' ? 0 : isScanStyle(animation.style) ? 150 : duration}ms`);
  root.style.setProperty('--modal-exit-duration', `${isScanStyle(animation.style) ? 150 : modalExitDuration(animation.style, duration)}ms`);
}
