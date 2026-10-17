import type { ActionId } from '../src/keybindings';

// Explicit contract, independent of the registry's current default arrays.
export const INTENTIONALLY_UNBOUND_ACTIONS = [
  'new-copilot',
  'capture-performance',
  'reload-card-plugins',
  'select-theme',
  'mcp',
  'mode',
  'context-window',
  'keybindings',
] as const satisfies readonly ActionId[];
