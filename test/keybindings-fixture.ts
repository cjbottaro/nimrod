import type { ActionId } from '../src/keybindings';

// Explicit contract, independent of the registry's current default arrays.
export const INTENTIONALLY_UNBOUND_ACTIONS = [
  'new-acp',
  'acp-options',
  'capture-performance',
  'reload-card-plugins',
  'select-theme',
  'mcp',
  'keybindings',
] as const satisfies readonly ActionId[];
