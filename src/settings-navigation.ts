export type SettingsCategory = 'appearance' | 'notifications' | 'keybindings' | 'runtime';

/** Mounted category panels retain dirty controls, searches and independent scroll offsets. */
export function installSettingsNavigation(page: HTMLDialogElement) {
  const document = page.ownerDocument;
  const list = page.querySelector<HTMLElement>('#settings-categories')!;
  const tabs = [...list.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const panels = [...page.querySelectorAll<HTMLElement>('.settings-panel')];
  let selected: SettingsCategory = 'appearance';
  const blocked = () => !page.open || [...document.querySelectorAll('dialog[open], #dialog.open')].some(dialog => dialog !== page);
  const select = (category: SettingsCategory) => {
    if (blocked()) return false;
    const tab = tabs.find(tab => tab.dataset.category === category);
    if (!tab) return false;
    selected = category;
    for (const item of tabs) { const active = item === tab; item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1; }
    for (const panel of panels) panel.hidden = panel.dataset.category !== category;
    return true;
  };
  const click = (event: Event) => {
    const tab = (event.target as Element).closest<HTMLButtonElement>('[role=tab]');
    if (tab && tabs.includes(tab)) select(tab.dataset.category as SettingsCategory);
  };
  const key = (event: KeyboardEvent) => {
    if (blocked() || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
    const index = tabs.indexOf(event.target as HTMLButtonElement);
    if (index < 0) return;
    const next = event.key === 'ArrowDown' ? (index + 1) % tabs.length : event.key === 'ArrowUp' ? (index + tabs.length - 1) % tabs.length
      : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined;
    if (next === undefined) return;
    event.preventDefault(); select(tabs[next].dataset.category as SettingsCategory); tabs[next].focus({ preventScroll: true });
  };
  list.addEventListener('click', click); list.addEventListener('keydown', key);
  return { select, get selected() { return selected; }, dispose() { list.removeEventListener('click', click); list.removeEventListener('keydown', key); } };
}
