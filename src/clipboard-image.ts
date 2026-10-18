import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { MAX_IMAGE_PIXELS } from './image-attachments';

/** User-triggered fallback for native screenshot/TIFF clipboard representations. */
export async function readClipboardImage(): Promise<Blob | undefined> {
  let image;
  try { image = await readImage(); } catch { return undefined; } // Empty/non-image clipboard.
  try {
    const { width, height } = await image.size();
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) throw new Error('Clipboard image exceeds the 32-megapixel limit.');
    const rgba = await image.rgba();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Could not encode clipboard image.');
    context.putImageData(new ImageData(new Uint8ClampedArray(rgba), width, height), 0, 0);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Could not encode clipboard image.')), 'image/png'));
  } finally { await image.close(); }
}
