import type { CardPlugin, ToolCardData } from '../card-plugin-api';
import { definePresentationPlugin, rawToolPresentation, shellPresentation, argumentRecord, firstString } from '../card-plugin-ui';

/** Standards-based fallback needs no agent-specific installation or tool schema. */
export const acpToolPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.tool', supports: data => data.source?.backend === 'acp',
  mount: () => ({ update: data => rawToolPresentation(data), dispose() {} }),
});
/** Optional Copilot adapter. Parsing is deliberately separate from Pi's Bash plugin. */
export const copilotShellPlugin: CardPlugin = definePresentationPlugin<ToolCardData>({
  id: 'nimrod.acp.copilot-shell',
  supports: data => data.source?.backend === 'acp' && ['copilot', 'copilot-cli'].includes(data.source.agent || '') && data.kind === 'execute',
  mount: () => ({ update(data) {
    const raw = rawToolPresentation(data);
    return shellPresentation({ title: raw.title, command: firstString(argumentRecord(data.arguments), ['command', 'cmd']), sections: raw.sections });
  }, dispose() {} }),
});
export function bundledAcpPlugin(data: Readonly<ToolCardData>): CardPlugin {
  return copilotShellPlugin.supports(data) ? copilotShellPlugin : acpToolPlugin;
}
