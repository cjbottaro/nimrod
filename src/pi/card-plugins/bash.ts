import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { argumentRecord, firstString, fieldCountPreview } from './tool-input';
import { rawToolPresentation, toolPlugin } from './tool-shared';

export function bashInputPreview(args: unknown, complete = true): string | undefined {
  return firstString(argumentRecord(args), ['command', 'cmd', 'script']) || fieldCountPreview(args, complete);
}

export function bashPresentation(data: Readonly<ToolCardData>): CardPresentation {
  const value = rawToolPresentation(data);
  return { ...value, preview: bashInputPreview(data.arguments, data.toolStatus !== undefined),
    sections: value.sections.map(section => ({ ...section, format: 'console' as const })) };
}

export default toolPlugin('nimrod.bash', ['bash', 'shell', 'terminal'], bashPresentation);
