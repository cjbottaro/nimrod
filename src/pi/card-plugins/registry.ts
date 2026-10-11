import { presentationPlugin, type DomCardRenderer } from '../dom-card-renderer';
import type { ToolCardBlock } from '../tool-card';
import { defaultToolRenderer } from './tool';
import { editPreviewRenderer } from './edit';

/** Initial explicit matching; selection stays fixed for the mounted shell. */
export function bundledToolRenderer(data: Readonly<ToolCardBlock>): DomCardRenderer<ToolCardBlock> {
  const name = typeof data.name === 'string' ? data.name.trim().toLowerCase().split(/[.:/]/).pop() : '';
  return presentationPlugin(name === 'edit' ? editPreviewRenderer : defaultToolRenderer);
}
