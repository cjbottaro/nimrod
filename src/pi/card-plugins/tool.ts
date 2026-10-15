import type { CardRenderer } from '../card-renderer';
import type { ToolCardBlock } from '../tool-card';
import { toolInputPreview } from './input-preview';
import { rawToolPresentation } from './tool-shared';

export { toolInputPreview } from './input-preview';
export { rawToolPresentation } from './tool-shared';

/** Generic fallback/explicit override. Tool-specific output formats live in their plugins. */
export const defaultToolRenderer: CardRenderer<ToolCardBlock> = {
  id: 'nimrod.tool',
  supports: () => true,
  mount: () => ({
    update: block => ({
      ...rawToolPresentation(block),
      preview: toolInputPreview(typeof block.name === 'string' ? block.name : 'tool', block.arguments, block.toolStatus !== undefined),
    }),
    dispose() {},
  }),
};
