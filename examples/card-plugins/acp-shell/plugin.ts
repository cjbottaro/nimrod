import type { CardPlugin, ToolCardData } from '../../../src/card-plugin-api';
import { defineToolPlugin, rawToolPresentation, shellPresentation, argumentRecord, firstString } from '../../../src/card-plugin-ui';

// This external example imports the exact runtime used by bundled Pi/Copilot cards.
const plugin: CardPlugin<ToolCardData> = defineToolPlugin('example.acp-shell', ['execute'], data => {
  const raw = rawToolPresentation(data);
  return shellPresentation({ title: raw.title, command: firstString(argumentRecord(data.arguments), ['command']), sections: raw.sections });
});
export default Object.assign(plugin, { targets: [{ backend: 'acp' as const }] });
