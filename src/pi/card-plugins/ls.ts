import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { fileInputPreview } from './tool-input';
import { rawToolPresentation, toolPlugin } from './tool-shared';

export const lsInputPreview = fileInputPreview;

export function lsPresentation(data: Readonly<ToolCardData>): CardPresentation {
  return { ...rawToolPresentation(data), preview: lsInputPreview(data.arguments, data.toolStatus !== undefined) };
}

export default toolPlugin('nimrod.ls', ['ls'], lsPresentation);
