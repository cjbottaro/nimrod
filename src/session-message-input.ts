import { MAX_IMAGES, MAX_IMAGE_BYTES, MAX_PROMPT_IMAGE_BYTES, IMAGE_MIME_TYPES, validateImageContents, type ImageContent } from './image-attachments';
/** Local delivery intent; each integration retains its supported busy-send semantics. */
export type SubmissionMode = 'normal' | 'steer' | 'followUp';

export interface ImageInputLimits {
  readonly mimeTypes: readonly string[];
  readonly maxImages: number;
  readonly maxImageBytes: number;
  readonly maxTotalBytes: number;
}
export const DEFAULT_IMAGE_INPUT: ImageInputLimits = Object.freeze({
  mimeTypes: IMAGE_MIME_TYPES, maxImages: MAX_IMAGES, maxImageBytes: MAX_IMAGE_BYTES, maxTotalBytes: MAX_PROMPT_IMAGE_BYTES,
});
export interface MessageInputCapabilities {
  /** Absent means unsupported, not an instruction to send text without the images. */
  readonly images?: ImageInputLimits;
  readonly imageUnavailableReason?: string;
}
export interface OutgoingMessage {
  id: string;
  text: string;
  images?: ImageContent[];
  mode: SubmissionMode;
}
/** Composer-facing input port, not a common harness protocol.
 * Capabilities are live. submit settles the integration's submission handler,
 * NOT delivery or turn completion; correlated receipts/events remain authoritative.
 * Never await it for local Send effects or replay on failure.
 */
export interface SessionMessageInput {
  capabilities(): MessageInputCapabilities;
  submit(message: OutgoingMessage): Promise<void>;
}
export function validateImageSelection(images: readonly { mimeType: string; size: number }[], capabilities: MessageInputCapabilities): void {
  if (!images.length) return;
  const limits = capabilities.images;
  if (!limits) throw new Error(capabilities.imageUnavailableReason || 'Images are not supported by this session.');
  if (images.length > Math.min(MAX_IMAGES, limits.maxImages)) throw new Error(`Attach at most ${Math.min(MAX_IMAGES, limits.maxImages)} images for this session.`);
  if (images.some(image => !IMAGE_MIME_TYPES.includes(image.mimeType as typeof IMAGE_MIME_TYPES[number]) || !limits.mimeTypes.includes(image.mimeType)))
    throw new Error('An attached image format is not supported by this session.');
  if (images.some(image => image.size > Math.min(MAX_IMAGE_BYTES, limits.maxImageBytes))) throw new Error('An attached image exceeds this session’s image size limit.');
  if (images.reduce((sum, image) => sum + image.size, 0) > Math.min(MAX_PROMPT_IMAGE_BYTES, limits.maxTotalBytes)) throw new Error('Attached images exceed this session’s total image size limit.');
}
export function validateMessageImages(value: unknown, capabilities: MessageInputCapabilities): ImageContent[] {
  const images = validateImageContents(value);
  validateImageSelection(images.map(image => ({ mimeType: image.mimeType,
    size: image.data.length / 4 * 3 - (image.data.endsWith('==') ? 2 : image.data.endsWith('=') ? 1 : 0) })), capabilities);
  return images;
}
