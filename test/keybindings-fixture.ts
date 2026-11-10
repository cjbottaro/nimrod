import type { ActionId } from '../src/keybindings';

// Explicit contract, independent of the registry's current default arrays.
export const INTENTIONALLY_UNBOUND_ACTIONS = [
  'minimize-window',
  'toggle-maximize-window',
  'close-window',
  'about',
  'new-with-harness',
  'new-named-with-harness',
  'temporary-with-harness',
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
