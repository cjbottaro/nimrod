export const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
export const MAX_PROMPT_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGES = 8;
export const MAX_IMAGE_PIXELS = 32 * 1024 * 1024;
const MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

/** Drafts contain references only. Encoded image bytes live in the attachment store. */
export interface ImageAttachment { id: string; name: string; mimeType: string; size: number; }
export interface ImageContent { type: 'image'; mimeType: string; data: string; }
export interface AttachmentHost {
  put(blob: Blob, name: string): Promise<ImageAttachment>;
  get(image: ImageAttachment): Promise<Blob>;
  readClipboard?(): Promise<Blob | undefined>;
}

export function isAttachment(value: unknown): value is ImageAttachment {
  if (!value || typeof value !== 'object') return false;
  const image = value as ImageAttachment;
  return typeof image.id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(image.id)
    && typeof image.name === 'string' && image.name.length <= 200 && MIME_TYPES.has(image.mimeType)
    && Number.isInteger(image.size) && image.size > 0 && image.size <= MAX_IMAGE_BYTES;
}
export function attachmentArray(value: unknown): ImageAttachment[] {
  if (!Array.isArray(value)) return [];
  const images = value.filter(isAttachment);
  try { validateAttachments(images); return images; } catch { return []; }
}
export function validateAttachments(images: ImageAttachment[]): void {
  if (images.length > MAX_IMAGES) throw new Error(`Attach at most ${MAX_IMAGES} images per message.`);
  if (images.reduce((sum, image) => sum + image.size, 0) > MAX_PROMPT_IMAGE_BYTES) throw new Error('Images must total at most 8 MiB per message.');
}
export function validateImageBlob(blob: Blob): void {
  if (!MIME_TYPES.has(blob.type)) throw new Error('Paste a PNG, JPEG, WebP or GIF image.');
  if (!blob.size || blob.size > MAX_IMAGE_BYTES) throw new Error('Each image must be nonempty and at most 4 MiB.');
}
export function validImageContent(value: unknown): value is ImageContent {
  if (!value || typeof value !== 'object') return false;
  const image = value as ImageContent;
  return image.type === 'image' && MIME_TYPES.has(image.mimeType) && typeof image.data === 'string'
    && image.data.length > 0 && image.data.length <= Math.ceil(MAX_IMAGE_BYTES / 3) * 4
    && image.data.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(image.data);
}
export function validateImageContents(value: unknown): ImageContent[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_IMAGES || !value.every(validImageContent)) throw new Error('Invalid or oversized image attachments.');
  const bytes = value.reduce((sum, image) => sum + image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0), 0);
  if (bytes > MAX_PROMPT_IMAGE_BYTES) throw new Error('Images must total at most 8 MiB per message.');
  return value;
}
export async function imageContent(blob: Blob): Promise<ImageContent> {
  validateImageBlob(blob);
  const data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1]);
    reader.onerror = () => reject(new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
  return { type: 'image', mimeType: blob.type, data };
}

/** Prefer the synchronous paste payload; never ingest both it and the native fallback. */
export function clipboardImages(data: DataTransfer | null): File[] {
  return Array.from(data?.items ?? []).flatMap(item => {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) return [];
    const file = item.getAsFile(); return file ? [file] : [];
  });
}

/** Decode for validation only. Preserve the original encoding, transparency and resolution. */
export async function validateImageDimensions(blob: Blob): Promise<void> {
  validateImageBlob(blob);
  const url = URL.createObjectURL(blob);
  try {
    await new Promise<void>((resolve, reject) => {
      const image = new Image();
      image.onload = () => image.naturalWidth * image.naturalHeight <= MAX_IMAGE_PIXELS
        ? resolve() : reject(new Error('Image exceeds the 32-megapixel limit.'));
      image.onerror = () => reject(new Error('Clipboard image could not be decoded.'));
      image.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

export function referencedAttachments(value: unknown): Set<string> {
  const ids = new Set<string>();
  const visit = (node: unknown): void => {
    if (isAttachment(node)) { ids.add(node.id); return; }
    if (Array.isArray(node)) node.forEach(visit);
    else if (node && typeof node === 'object') Object.values(node).forEach(visit);
  };
  visit(value); return ids;
}
