import { DRACULA } from './builtins';
import { applyTheme, importTheme, MAX_IMPORTED_THEMES, MAX_THEME_BYTES, readLibrary, type ThemeLibrary } from './theme';

interface ThemeHost {
  read(): unknown;
  save(library: ThemeLibrary): void | Promise<void>;
  newId(): string;
}
interface ThemeElements {
  root: HTMLElement;
  select: HTMLSelectElement;
  file: HTMLInputElement;
  notice: HTMLElement;
  noticeText: HTMLElement;
  dismiss: HTMLButtonElement;
}

export function installThemes(elements: ThemeElements, host: ThemeHost): {
  importFile(file: Pick<File, 'name' | 'size' | 'text'>): Promise<void>;
  reload(): void;
  dispose(): void;
} {
  const { root, select, file, notice, noticeText, dismiss } = elements;
  let state: ThemeLibrary = { version: 1, selected: 'nimrod', imports: [] };
  let disposed = false;
  let generation = 0;
  const tell = (text: string) => { noticeText.textContent = text; notice.hidden = false; };
  try { state = readLibrary(host.read()); }
  catch (error) { tell(`Could not restore themes: ${String(error)}`); }

  function options(): void {
    const document = select.ownerDocument;
    const option = (value: string, label: string) => {
      const node = document.createElement('option'); node.value = value; node.textContent = label; return node;
    };
    const builtins = document.createElement('optgroup'); builtins.label = 'Built-in';
    builtins.append(option('nimrod', 'Nimrod (system)'), option('dracula', 'Dracula'));
    const imported = document.createElement('optgroup'); imported.label = 'Imported';
    imported.append(...state.imports.map(theme => option(theme.id, theme.name)));
    const actions = document.createElement('optgroup'); actions.label = 'Themes';
    actions.append(option('$import', 'Import color theme…'));
    if (state.imports.some(theme => theme.id === state.selected)) actions.append(option('$remove', 'Remove current imported theme'));
    select.replaceChildren(builtins, ...(state.imports.length ? [imported] : []), actions);
    select.value = state.selected;
    select.title = `Color theme: ${state.selected === 'nimrod' ? 'Nimrod scheme (follows system appearance)' : state.selected === 'dracula' ? 'Dracula' : state.imports.find(theme => theme.id === state.selected)?.name}`;
    select.disabled = false;
  }
  function apply(): void {
    applyTheme(root, state.selected === 'dracula' ? DRACULA : state.imports.find(theme => theme.id === state.selected));
  }
  async function commit(next: ThemeLibrary): Promise<void> {
    // Persist first; quota/privacy failures must not pretend the choice survives relaunch.
    const saving = host.save(next);
    if (saving) await saving;
    state = next; apply(); options(); notice.hidden = true;
  }
  apply(); options();

  async function importFile(input: Pick<File, 'name' | 'size' | 'text'>): Promise<void> {
    if (disposed) return;
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
      const names = new Set(['Nimrod', 'Nimrod (system)', 'Dracula', ...state.imports.map(t => t.name)]);
      let suffix = 2;
      while (names.has(theme.name)) theme.name = `${base.slice(0, 70)} (${suffix++})`;
      await commit({ ...state, selected: theme.id, imports: [...state.imports, theme] });
      tell(`Imported ${theme.name}. ${warnings.join(' ')}`.trim());
    } catch (error) {
      if (!disposed && request === generation) { options(); tell(`Theme not imported: ${String(error)}`); }
    } finally { if (!disposed && request === generation) select.disabled = false; }
  }
  const onSelect = async () => {
    ++generation;
    const selected = select.value;
    select.value = state.selected;
    notice.hidden = true;
    if (selected === '$import') { file.value = ''; file.click(); return; }
    try {
      if (selected === '$remove') await commit({ ...state, selected: 'nimrod', imports: state.imports.filter(theme => theme.id !== state.selected) });
      else if (['nimrod', 'dracula', ...state.imports.map(theme => theme.id)].includes(selected)) await commit({ ...state, selected });
    } catch (error) { options(); tell(`Could not save theme settings: ${String(error)}`); }
  };
  const onFile = () => { const input = file.files?.[0]; file.value = ''; if (input) void importFile(input); };
  const onDismiss = () => { notice.hidden = true; };
  select.addEventListener('change', onSelect);
  file.addEventListener('change', onFile);
  dismiss.addEventListener('click', onDismiss);
  return { importFile, reload() {
    const next = readLibrary(host.read());
    if (JSON.stringify(next) === JSON.stringify(state)) return;
    ++generation; state = next; apply(); options();
  }, dispose() {
    disposed = true; ++generation;
    select.removeEventListener('change', onSelect);
    file.removeEventListener('change', onFile);
    dismiss.removeEventListener('click', onDismiss);
  } };
}
