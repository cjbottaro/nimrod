import type { CardPresentation, ToolCardData } from '../../card-plugin-api';
import { argumentRecord, firstString, fieldCountPreview, rawToolPresentation, defineToolPlugin, shellPresentation } from '../../card-plugin-ui';

export function bashInputPreview(args: unknown, complete = true): string | undefined {
  return firstString(argumentRecord(args), ['command', 'cmd', 'script']) || fieldCountPreview(args, complete);
}

export function bashPresentation(data: Readonly<ToolCardData>): CardPresentation {
  const value = rawToolPresentation(data);
  return shellPresentation({ title: value.title, command: bashInputPreview(data.arguments, data.toolStatus !== undefined), sections: value.sections });
}

export default defineToolPlugin('nimrod.bash', ['bash', 'shell', 'terminal'], bashPresentation);
