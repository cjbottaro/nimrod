import type { CardPlugin, ToolCardData } from '../card-plugin-api';
import { definePresentationPlugin, rawToolPresentation } from '../card-plugin-ui';

/** Standards-based fallback without agent-specific schemas or installation. */
export const acpToolPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.tool', supports: data => data.source?.backend === 'acp',
  mount: () => ({ update: data => rawToolPresentation(data), dispose() {} }),
});
