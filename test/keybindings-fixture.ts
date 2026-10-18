import type { ActionId } from '../src/keybindings';

// Explicit contract, independent of the registry's current default arrays.
export const INTENTIONALLY_UNBOUND_ACTIONS = [
  'new-copilot',
  'pin',
  'capture-performance',
  'reload-card-plugins',
  'select-theme',
  'mcp',
  'mode',
  'context-window',
  'cancel-configuration',
  'permissions',
  'keybindings',
] as const satisfies readonly ActionId[];
