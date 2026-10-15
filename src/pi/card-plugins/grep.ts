import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { searchInputPreview } from './tool-input';
import { rawToolPresentation, toolPlugin } from './tool-shared';

export const grepInputPreview = searchInputPreview;

export function grepPresentation(data: Readonly<ToolCardData>): CardPresentation {
  return { ...rawToolPresentation(data), preview: grepInputPreview(data.arguments, data.toolStatus !== undefined) };
}

export default toolPlugin('nimrod.grep', ['grep'], grepPresentation);
