import { BUILTIN_THEMES, CATALOG_THEMES, selectedTheme } from './builtins';
import { applyTheme, importTheme, MAX_IMPORTED_THEMES, MAX_THEME_BYTES, readLibrary, type ColorTheme, type ThemeLibrary } from './theme';

interface ThemeHost {
  read(): unknown;
  save(library: ThemeLibrary): void | Promise<void>;
  newId(): string;
  libraryEdits?: boolean;
  selectTheme(): void;
  error?(message?: string): void;
}
interface ThemeElements {
  root: HTMLElement;
  select: HTMLButtonElement;
  current: HTMLElement;
  importButton: HTMLButtonElement;
  removeButton: HTMLButtonElement;
  file: HTMLInputElement;
  notice: HTMLElement;
  noticeText: HTMLElement;
  dismiss: HTMLButtonElement;
}

export function installThemes(elements: ThemeElements, host: ThemeHost): {
  importFile(file: Pick<File, 'name' | 'size' | 'text'>): Promise<void>;
  reload(): void;
  preview(theme?: ColorTheme): void;
  restore(): void;
  dispose(): void;
} {
  const { root, select, current, importButton, removeButton, file, notice, noticeText, dismiss } = elements;
  let state: ThemeLibrary = { version: 1, selected: 'nimrod', imports: [] };
  let disposed = false;
  let generation = 0;
  let previewing = false;
  const tell = (text: string, failed = false) => {
    if (failed && host.error) { host.error(text); notice.hidden = true; }
    else { noticeText.textContent = text; notice.hidden = false; }
  };
  try { state = readLibrary(host.read()); }
  catch (error) { tell(`Could not restore themes: ${String(error)}`, true); }

  function options(): void {
    const name = state.selected === 'nimrod' ? 'Nimrod (system)' : selectedTheme(state)?.name ?? state.selected;
    select.title = `Color theme: ${state.selected === 'nimrod' ? 'Nimrod scheme (follows system appearance)' : name}`;
    select.dataset.theme = state.selected;
    current.textContent = name;
    importButton.hidden = host.libraryEdits === false;
    removeButton.hidden = host.libraryEdits === false || !state.imports.some(theme => theme.id === state.selected);
    select.disabled = false;
  }
  function apply(): void {
    applyTheme(root, selectedTheme(state));
  }
  async function commit(next: ThemeLibrary): Promise<void> {
    // Persist first; quota/privacy failures must not pretend the choice survives relaunch.
    const saving = host.save(next);
    if (saving) await saving;
    state = next; apply(); options(); notice.hidden = true; host.error?.();
  }
  apply(); options();

  async function importFile(input: Pick<File, 'name' | 'size' | 'text'>): Promise<void> {
    if (disposed || host.libraryEdits === false) return;
    const request = ++generation;
    select.disabled = true;
    try {
      if (state.imports.length >= MAX_IMPORTED_THEMES) throw new Error(`At most ${MAX_IMPORTED_THEMES} imported themes can be saved. Select an imported theme and remove it first.`);
      if (input.size > MAX_THEME_BYTES) throw new Error('Theme files must be 512 KiB or smaller.');
      const text = await input.text();
      if (disposed || request !== generation) return;
      const { theme, warnings } = importTheme(text, input.name, host.newId());
      // Distinguish repeated imports without overwriting a saved theme or colliding with built-ins.
      const base = theme.name;
      const names = new Set(['Nimrod', 'Nimrod (system)', ...BUILTIN_THEMES.map(theme => theme.name), ...CATALOG_THEMES.map(entry => entry.theme.name), ...state.imports.map(t => t.name)]);
      let suffix = 2;
      while (names.has(theme.name)) theme.name = `${base.slice(0, 70)} (${suffix++})`;
      await commit({ ...state, selected: theme.id, imports: [...state.imports, theme] });
      tell(`Imported ${theme.name}. ${warnings.join(' ')}`.trim());
    } catch (error) {
      if (!disposed && request === generation) { options(); tell(`Theme not imported: ${String(error)}`, true); }
    } finally { if (!disposed && request === generation) select.disabled = false; }
  }
  const onSelect = () => { ++generation; host.selectTheme(); };
  const onImport = () => { if (disposed || host.libraryEdits === false) return; file.value = ''; file.click(); };
  const onRemove = async () => {
    if (disposed || host.libraryEdits === false || !state.imports.some(theme => theme.id === state.selected)) return;
    ++generation;
    try { await commit({ ...state, selected: 'nimrod', imports: state.imports.filter(theme => theme.id !== state.selected) }); }
    catch (error) { options(); tell(`Could not save theme settings: ${String(error)}`, true); }
  };
  const onFile = () => { const input = file.files?.[0]; file.value = ''; if (input) void importFile(input); };
  const onDismiss = () => { notice.hidden = true; };
  select.addEventListener('click', onSelect);
  importButton.addEventListener('click', onImport);
  removeButton.addEventListener('click', onRemove);
  file.addEventListener('change', onFile);
  dismiss.addEventListener('click', onDismiss);
  return { importFile,
    preview(theme) { if (!disposed) { previewing = true; applyTheme(root, theme); } },
    restore() { if (!disposed) { previewing = false; state = readLibrary(host.read()); apply(); options(); } },
    reload() {
    const next = readLibrary(host.read());
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    ++generation; state = next; if (!previewing) apply(); options();
  }, dispose() {
    disposed = true; ++generation;
    select.removeEventListener('click', onSelect);
    importButton.removeEventListener('click', onImport);
    removeButton.removeEventListener('click', onRemove);
    file.removeEventListener('change', onFile);
    dismiss.removeEventListener('click', onDismiss);
  } };
}
