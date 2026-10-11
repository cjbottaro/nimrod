import type { CardRenderer } from '../card-renderer';
import type { ToolCardBlock } from '../tool-card';
import { defaultToolRenderer } from './tool';
import { editPreviewRenderer } from './edit';

/** Initial explicit matching; selection stays fixed for the mounted shell. */
export function bundledToolRenderer(data: Readonly<ToolCardBlock>): CardRenderer<ToolCardBlock> {
  const name = typeof data.name === 'string' ? data.name.trim().toLowerCase().split(/[.:/]/).pop() : '';
  return name === 'edit' ? editPreviewRenderer : defaultToolRenderer;
}
