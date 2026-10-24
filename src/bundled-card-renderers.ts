import { registerCardRenderer } from './card-renderers';
import { bundledToolRenderer } from './pi/card-plugins/registry';
import { bundledCopilotPlugin } from './copilot/card-plugins';
import { codexToolPlugin } from './codex/card-plugins';
import { acpToolPlugin } from './acp/card-plugins';

/** Standalone presentation fixtures/legacy entry points can install the bundled
 * renderers without constructing projects, native transports or session owners.
 * Production installs renderers from HarnessRegistration.cards instead.
 */
registerCardRenderer('pi', bundledToolRenderer);
registerCardRenderer('copilot-sdk', bundledCopilotPlugin);
registerCardRenderer('codex', () => codexToolPlugin);
registerCardRenderer('acp', () => acpToolPlugin);
