export const KEYBINDINGS_SETTING = 'keybindings';
export const ACTIONS = [
  { id: 'open-recent-project', label: 'Open recent project…', scope: 'project', defaults: ['primary+shift+o'] },
  { id: 'new', label: 'New session', scope: 'project', defaults: ['primary+n'] },
  { id: 'temporary', label: 'New temporary session', scope: 'project', defaults: ['primary+shift+n'] },
  { id: 'delete', label: 'Delete session tree…', scope: 'project', defaults: ['primary+backspace'] },
  { id: 'model', label: 'Select model…', scope: 'project', defaults: ['primary+m'] },
  { id: 'thinking', label: 'Select thinking level…', keywords: 'effort reasoning', scope: 'project', defaults: ['primary+e'] },
  { id: 'palette', label: 'Command palette', scope: 'project', defaults: ['primary+shift+p'] },
  { id: 'close', label: 'Close session', scope: 'project', defaults: ['primary+w'] },
  { id: 'sidebar', label: 'Toggle session sidebar', scope: 'project', defaults: ['primary+b'] },
  { id: 'previous', label: 'Previous open session', scope: 'project', defaults: ['primary+shift+['] },
  { id: 'next', label: 'Next open session', scope: 'project', defaults: ['primary+shift+]'] },
  { id: 'settings', label: 'Settings', scope: 'app', defaults: ['primary+,'] },
  { id: 'keybindings', label: 'Edit keybindings…', scope: 'project', defaults: ['primary+shift+,'] },
  { id: 'zoom-in', label: 'Zoom in', scope: 'app', defaults: ['primary+plus'] },
  { id: 'zoom-out', label: 'Zoom out', scope: 'app', defaults: ['primary+-'] },
  { id: 'zoom-reset', label: 'Reset zoom to 100%', scope: 'app', defaults: ['primary+0'] },
  { id: 'resume', label: 'Resume session…', scope: 'project', defaults: ['primary+k'] },
  { id: 'switch-session', label: 'Switch session…', scope: 'project', defaults: ['primary+t'] },
  { id: 'new-named', label: 'New named session…', scope: 'project', defaults: ['primary+alt+n'] },
  { id: 'restart', label: 'Restart session', scope: 'project', defaults: ['primary+r'] },
] as const;
export type ActionId = typeof ACTIONS[number]['id'];
export type KeyOverrides = Record<string, string[]>;
export type KeyChanges = Record<string, string[] | undefined>;
const modifiers = ['primary', 'cmd', 'ctrl', 'alt', 'shift'];
const named = ['backspace', 'delete', 'enter', 'tab', 'space', 'escape', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'home', 'end', 'pageup', 'pagedown', 'plus', '-'];
const reserved = new Set(['q', 'h', 'a', 'c', 'v', 'x', 'z', 'tab']);

/** Stable, layout-aware single keystrokes. Chords and native editing/menu bindings are not editable. */
export function validateBinding(binding: unknown): string {
  if (typeof binding !== 'string' || binding.length > 80 || binding !== binding.toLowerCase()) throw new Error('Use a lowercase shortcut such as primary+shift+n.');
  const parts = binding.split('+'), key = parts.pop()!;
  if (!key || !(key.length === 1 && !/[\s\u0000-\u001f\u007f]/.test(key) || named.includes(key) || /^f([1-9]|1[0-9]|2[0-4])$/.test(key))) throw new Error('Unsupported shortcut key.');
  if (parts.some(part => !modifiers.includes(part)) || new Set(parts).size !== parts.length || parts.join('+') !== modifiers.filter(modifier => parts.includes(modifier)).join('+')) throw new Error('Modifiers must be primary, cmd, ctrl, alt, shift in that order.');
  if (parts.includes('primary') && (parts.includes('cmd') || parts.includes('ctrl'))) throw new Error('Use primary or explicit cmd/ctrl, not both.');
  if (!parts.some(part => ['primary', 'cmd', 'ctrl'].includes(part)) && !/^f\d+$/.test(key)) throw new Error('Use Cmd/Ctrl for application shortcuts; plain typing and Option/Alt text entry are reserved.');
  if (key === '=' || key === 'plus' && parts.includes('shift')) throw new Error('Use plus without Shift for the + / = key.');
  if (reserved.has(key) || key === 'o' && !parts.includes('shift')) throw new Error('This key is reserved for native menus or text editing.');
  return binding;
}
export function readKeyOverrides(value: unknown): KeyOverrides {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('keybindings must be an object mapping action IDs to shortcut arrays.');
  const result: KeyOverrides = {};
  if (Object.keys(value).length > 256) throw new Error('Too many keybinding actions.');
  for (const [id, bindings] of Object.entries(value)) {
    if (!/^[a-z][a-z0-9-]{0,79}$/.test(id) || !Array.isArray(bindings) || bindings.length > 8) throw new Error('Each action needs an array of up to eight shortcuts.');
    result[id] = bindings.map(validateBinding);
    if (new Set(result[id]).size !== bindings.length) throw new Error(`Duplicate shortcut for ${id}.`);
  }
  return result;
}
export function bindingsFor(id: ActionId, overrides: KeyOverrides): readonly string[] {
  return overrides[id] ?? ACTIONS.find(action => action.id === id)!.defaults;
}
export function isMac(window: Window): boolean { return /Mac|iPhone|iPad/i.test(window.navigator.platform); }
export function shortcutLabel(binding: string, mac: boolean): string {
  return binding.split('+').map(part => ({ primary: mac ? '⌘' : 'Ctrl', cmd: '⌘', ctrl: 'Ctrl', alt: mac ? 'Option' : 'Alt', shift: mac ? '⇧' : 'Shift', backspace: 'Backspace', plus: '+', arrowup: '↑', arrowdown: '↓', arrowleft: '←', arrowright: '→' }[part] ?? (part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1)))).join('+');
}
function optionBaseKey(event: KeyboardEvent, mac?: boolean): string | undefined {
  // macOS Option changes event.key (Option-N commonly reports Dead/˜), even
  // with Command held. Use the letter/digit code only for that transformed
  // Command-Option case; retain readable layout characters and plain typing.
  if (mac === false || !event.metaKey || !event.altKey || !(event.key === 'Dead' || event.key.length === 1 && !/^[a-z0-9]$/i.test(event.key))) return;
  const code = /^(?:Key([A-Z])|Digit([0-9]))$/.exec(event.code);
  return code ? (code[1] ?? code[2]).toLowerCase() : undefined;
}
function eventKey(event: KeyboardEvent, mac?: boolean): string {
  const optionKey = optionBaseKey(event, mac);
  if (optionKey) return optionKey;
  if (event.code === 'BracketLeft') return '[';
  if (event.code === 'BracketRight') return ']';
  if (event.key === '+' || event.key === '=') return 'plus';
  return event.key === ' ' ? 'space' : event.key.toLowerCase();
}
export function matchesBinding(event: KeyboardEvent, binding: string, mac?: boolean): boolean {
  const parts = binding.split('+'), key = parts.pop()!;
  if (eventKey(event, mac) !== key) return false;
  const primary = parts.includes('primary');
  const primaryMatches = mac === undefined ? event.metaKey !== event.ctrlKey : mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  if (primary ? !primaryMatches : event.metaKey !== parts.includes('cmd') || event.ctrlKey !== parts.includes('ctrl')) return false;
  // '+' and '=' are the same zoom key, regardless of the Shift used by the layout.
  return event.altKey === parts.includes('alt') && (key === 'plus' || event.shiftKey === parts.includes('shift'));
}
export function recordBinding(event: KeyboardEvent, mac: boolean): string | undefined {
  if (event.isComposing || event.keyCode === 229 || event.repeat || ['Meta', 'Control', 'Shift', 'Alt', 'Unidentified'].includes(event.key)) return;
  if (event.key === 'Dead' && !optionBaseKey(event, mac)) return;
  const parts: string[] = [];
  if (mac ? event.metaKey : event.ctrlKey) parts.push('primary');
  if (!mac && event.metaKey) parts.push('cmd');
  if (mac && event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey && eventKey(event, mac) !== 'plus') parts.push('shift');
  parts.push(eventKey(event, mac));
  return validateBinding(parts.join('+'));
}
function equivalent(a: string, b: string, mac: boolean): boolean {
  const normalize = (value: string) => value.replace('primary', mac ? 'cmd' : 'ctrl');
  return normalize(a) === normalize(b);
}
export function bindingConflicts(id: ActionId, bindings: readonly string[], overrides: KeyOverrides, mac: boolean): { id: ActionId; binding: string }[] {
  return ACTIONS.filter(action => action.id !== id).flatMap(action => bindingsFor(action.id, overrides).filter(binding => bindings.some(candidate => equivalent(candidate, binding, mac))).map(binding => ({ id: action.id, binding })));
}
export function changeBinding(overrides: KeyOverrides, id: ActionId, bindings: readonly string[] | undefined, reassign: boolean, mac: boolean): KeyChanges {
  const next = bindings ?? ACTIONS.find(action => action.id === id)!.defaults;
  const conflicts = bindingConflicts(id, next, overrides, mac);
  if (conflicts.length && !reassign) throw new Error(`Conflicts with ${[...new Set(conflicts.map(conflict => ACTIONS.find(action => action.id === conflict.id)!.label))].join(', ')}. Choose Reassign to remove the competing bindings.`);
  const changes: KeyChanges = { [id]: bindings === undefined ? undefined : [...bindings] };
  for (const conflict of conflicts) changes[conflict.id] = bindingsFor(conflict.id, overrides).filter(binding => !next.some(candidate => equivalent(candidate, binding, mac)));
  return changes;
}

export function installKeybindingDispatch(window: Window, host: {
  read(): KeyOverrides;
  enabled(id: ActionId): boolean;
  run(id: ActionId): void | Promise<unknown>;
  error(error: unknown): void;
}) {
  const mac = window.navigator.platform ? isMac(window) : undefined;
  const keydown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229) return;
    if (!event.metaKey && !event.ctrlKey && !/^f\d+$/i.test(event.key)) return;
    const overrides = host.read();
    const dialogs = [...window.document.querySelectorAll('dialog[open], #dialog.open')];
    const candidates = ACTIONS.filter(action => (!dialogs.length || action.scope === 'app' && dialogs.every(dialog => dialog.id === 'settings-page')) && bindingsFor(action.id, overrides).some(binding => matchesBinding(event, binding, mac)));
    if (!candidates.length) return;
    // Consume a configured shortcut even when unavailable/repeated; never fall
    // through to a destructive native editing default such as Cmd-Backspace.
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.repeat) return;
    if (candidates.length > 1) { host.error(new Error('Conflicting keybindings. Review Settings → Keybindings.')); return; }
    const action = candidates[0];
    if (host.enabled(action.id)) {
      try { void Promise.resolve(host.run(action.id)).catch(host.error); } catch (error) { host.error(error); }
    }
  };
  window.addEventListener('keydown', keydown, true);
  return { dispose() { window.removeEventListener('keydown', keydown, true); } };
}
