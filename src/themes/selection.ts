import { BUILTIN_THEMES, CATALOG_THEMES } from './builtins';
import type { ColorTheme } from './theme';
import type { installThemes } from './picker';
import type { installPreferences } from '../preferences';
import type { installCommandPalette, PalettePage } from '../command-palette';

export function createThemeSelection(palette: ReturnType<typeof installCommandPalette>, preferences: Pick<Awaited<ReturnType<typeof installPreferences>>, 'theme' | 'selectTheme'>, themes: Pick<ReturnType<typeof installThemes>, 'preview' | 'restore'>) {
  let themePreviewGeneration = 0;
  return function pickTheme(): void {
    const request = palette.startPreviewSelection('Select theme', undefined, item => {
      const theme = choices.get(item?.id || '');
      if (item) themes.preview(theme);
      else themes.restore();
    }, () => themes.restore(), document.getElementById('settings-page') as HTMLDialogElement);
  
    if (!request) return;
    const previewGeneration = ++themePreviewGeneration;
    const choices = new Map<string, ColorTheme | undefined>();
    function show(): void {
      const library = preferences.theme();
      choices.clear(); choices.set('nimrod', undefined);
      const items: PalettePage['items'] = [];
      function add(id: string, label: string, detail: string, theme?: ColorTheme) {
        if (items.some(item => item.id === id)) return;
        choices.set(id, theme);
        items.push({ id, label, detail, current: id === library.selected,
          keywords: id === library.selected ? 'Current' : undefined,
          run: async () => {
            try { await preferences.selectTheme(id, id.startsWith('import-') ? theme : undefined); }
            finally { if (themePreviewGeneration === previewGeneration) themes.restore(); }
          },
        });
      }
      add('nimrod', 'Nimrod (system)', 'Built-in · follows system appearance');
      for (const theme of BUILTIN_THEMES) add(theme.id, theme.name, `Built-in · ${theme.mode}`, theme);
      for (const theme of library.imports) add(theme.id, theme.name, `${theme.source?.provider === 'gogh' ? 'Saved Gogh' : 'Imported'} · ${theme.mode}${theme.source?.author ? ` · ${theme.source.author}` : ''}`, theme);
      for (const entry of CATALOG_THEMES) add(entry.theme.id, entry.theme.name, `VS Code · ${entry.theme.mode} · ${entry.author}`, entry.theme);
      request!.show({ items, notice: 'Arrow keys or hover to preview · Enter to apply · Esc to restore' }, library.selected);
    }
    show();
  }
}
