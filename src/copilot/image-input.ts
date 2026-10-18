import type { DisplayMessage, ContentBlock } from '../conversation-model';
import { validImageContent } from '../image-attachments';
import { DEFAULT_IMAGE_INPUT, type MessageInputCapabilities } from '../session-message-input';

export interface CopilotImageModel {
  capabilities?: {
    supports?: { vision?: boolean };
    limits?: { vision?: { supported_media_types?: string[]; max_prompt_images?: number; max_prompt_image_size?: number } };
  };
}
/** Missing model metadata does not override the SDK's blob-input support.
 * Explicit unsupported vision/limits do. The runtime still owns model acceptance.
 */
export function copilotImageCapabilities(model?: CopilotImageModel): MessageInputCapabilities {
  const vision = model?.capabilities?.limits?.vision;
  const bounded = (value: unknown, fallback: number) => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(Math.floor(value), fallback) : fallback;
  const images = {
    ...DEFAULT_IMAGE_INPUT,
    mimeTypes: Array.isArray(vision?.supported_media_types) ? DEFAULT_IMAGE_INPUT.mimeTypes.filter(mime => vision.supported_media_types!.includes(mime)) : DEFAULT_IMAGE_INPUT.mimeTypes,
    maxImages: bounded(vision?.max_prompt_images, DEFAULT_IMAGE_INPUT.maxImages),
    maxImageBytes: bounded(vision?.max_prompt_image_size, DEFAULT_IMAGE_INPUT.maxImageBytes),
  };
  if (model?.capabilities?.supports?.vision === false || !images.maxImages || !images.maxImageBytes || !images.mimeTypes.length)
    return { imageUnavailableReason: 'The selected Copilot model does not support these image attachments. Choose an image-capable model.' };
  return { images };
}

/** Project supported inline SDK blobs identically for live echoes and history.
 * No path/URL fetching or private asset-store reads; unsupported records stay literal.
 */
export function copilotUserContent(text: string, attachments: unknown): DisplayMessage['content'] {
  if (!Array.isArray(attachments) || !attachments.length) return text;
  // Match the shared optimistic block positions even for image-only messages.
  const content: ContentBlock[] = [{ type: 'text', text }];
  for (const attachment of attachments) {
    const candidate = attachment && typeof attachment === 'object' ? { ...attachment, type: 'image' } : undefined;
    if (attachment?.type === 'blob' && !attachment.omittedReason && validImageContent(candidate)) {
      content.push({ type: 'image', mimeType: candidate.mimeType, data: candidate.data });
    } else if (attachment?.type === 'blob') {
      // Do not dump invalid/oversized base64 into a raw transcript block.
      const { data: _data, ...metadata } = attachment;
      content.push({ type: 'raw', text: `[Image unavailable]\n${JSON.stringify(metadata, null, 2)}` });
    } else content.push({ type: 'raw', text: JSON.stringify({ attachment }, null, 2) });
  }
  return content;
}
