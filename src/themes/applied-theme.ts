/** Window-local presentation snapshot. Publishing is owned by applyTheme, not DOM mutation. */
export interface AppliedTheme {
  id: string;
  mode: 'dark' | 'light' | null;
  background?: string;
}
interface ThemeState { value: Readonly<AppliedTheme>; listeners: Set<(theme: Readonly<AppliedTheme>) => void>; }
const states = new WeakMap<HTMLElement, ThemeState>();
function state(root: HTMLElement): ThemeState {
  let entry = states.get(root);
  if (!entry) { entry = { value: { id: 'nimrod', mode: null }, listeners: new Set() }; states.set(root, entry); }
  return entry;
}
export function appliedTheme(root: HTMLElement): Readonly<AppliedTheme> { return state(root).value; }
export function subscribeAppliedTheme(root: HTMLElement, receive: (theme: Readonly<AppliedTheme>) => void): () => void {
  const listeners = state(root).listeners; listeners.add(receive);
  return () => { listeners.delete(receive); };
}
/** Called once after all managed palette properties have been applied/restored. */
export function publishAppliedTheme(root: HTMLElement, theme: AppliedTheme): void {
  const entry = state(root), previous = entry.value;
  entry.value = Object.freeze({ ...theme });
  if (previous.id === theme.id && previous.mode === theme.mode && previous.background === theme.background) return;
  for (const receive of entry.listeners) receive(entry.value);
}
