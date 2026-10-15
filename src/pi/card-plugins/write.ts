import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { argumentRecord, fileInputPreview } from './tool-input';
import { rawToolPresentation, toolPlugin } from './tool-shared';

export const writeInputPreview = fileInputPreview;

export function writePresentation(data: Readonly<ToolCardData>): CardPresentation {
  const value = rawToolPresentation(data);
  const args = argumentRecord(data.arguments);
  const content = args?.content;
  return { ...value, preview: writeInputPreview(args ?? data.arguments, data.toolStatus !== undefined),
    sections: typeof content === 'string'
      ? [{ key: 'requested-content', label: 'Requested content', text: content }, ...value.sections]
      : value.sections };
}

export default toolPlugin('nimrod.write', ['write'], writePresentation);
