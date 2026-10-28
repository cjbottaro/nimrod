import type { CardPlugin, ToolCardData } from '../card-plugin-api';
import { definePresentationPlugin, rawToolPresentation, shellPresentation, argumentRecord, firstString } from '../card-plugin-ui';

/** Standards-based fallback without agent-specific schemas or installation. */
export const acpToolPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.tool', supports: data => data.source?.backend === 'acp',
  mount: () => ({ update: data => {
    const raw = rawToolPresentation(data);
    return data.kind === 'execute' ? shellPresentation({ title: raw.title,
      command: firstString(argumentRecord(data.arguments), ['command', 'cmd', 'script']), sections: raw.sections }) : raw;
  }, dispose() {} }),
});
