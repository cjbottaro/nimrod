import catalog from './catalog.json' with { type: 'json' };
import dracula from './dracula.json' with { type: 'json' };
import tokyoNight from './tokyo-night.json' with { type: 'json' };
import osakaJade from './osaka-jade.json' with { type: 'json' };
import { importTheme, type ColorTheme, type ThemeLibrary } from './theme';

// Nimrod palette adaptations, not complete upstream application themes.
// Source attribution and MIT licenses: THIRD_PARTY_NOTICES.md.
export const DRACULA = importTheme(JSON.stringify(dracula), 'dracula.json', 'dracula').theme;
export const TOKYO_NIGHT = importTheme(JSON.stringify(tokyoNight), 'tokyo-night.json', 'tokyo-night').theme;
export const OSAKA_JADE = importTheme(JSON.stringify(osakaJade), 'osaka-jade.json', 'osaka-jade').theme;
export const BUILTIN_THEMES = [DRACULA, TOKYO_NIGHT, OSAKA_JADE] as const;

export const CATALOG_THEMES = catalog.themes.map(entry => ({
  theme: importTheme(JSON.stringify(entry.theme), `${entry.id}.json`, entry.id).theme,
  author: catalog.sources[entry.source as keyof typeof catalog.sources].author,
}));

export function selectedTheme(library: ThemeLibrary): ColorTheme | undefined {
  return BUILTIN_THEMES.find(theme => theme.id === library.selected)
    ?? CATALOG_THEMES.find(entry => entry.theme.id === library.selected)?.theme
    ?? library.imports.find(theme => theme.id === library.selected);
}
