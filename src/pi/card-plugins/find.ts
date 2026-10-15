import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { searchInputPreview } from './tool-input';
import { rawToolPresentation, toolPlugin } from './tool-shared';

export const findInputPreview = searchInputPreview;

export function findPresentation(data: Readonly<ToolCardData>): CardPresentation {
  return { ...rawToolPresentation(data), preview: findInputPreview(data.arguments, data.toolStatus !== undefined) };
}

export default toolPlugin('nimrod.find', ['find'], findPresentation);
