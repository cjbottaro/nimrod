import { parse, printParseErrorCode, type ParseError } from 'jsonc-parser';

export const MAX_THEME_BYTES = 512 * 1024;
export const THEME_STORAGE_KEY = 'nimrod.themes.v1';
export const MAX_IMPORTED_THEMES = 50;
export type ThemeMode = 'dark' | 'light';

// Only color-valued keys actually used by Nimrod (plus inputs used to derive fallbacks).
export const COLOR_KEYS = [
  'foreground', 'descriptionForeground', 'focusBorder', 'errorForeground',
  'editor.background', 'editor.foreground', 'editor.selectionBackground', 'selection.background',
  'editorWidget.background', 'editorGroupHeader.tabsBackground', 'editorCodeLens.foreground',
  'editorIndentGuide.background1', 'editorWarning.foreground', 'editorError.foreground',
  'input.background', 'input.foreground', 'input.border',
  'button.background', 'button.foreground', 'button.hoverBackground',
  'button.secondaryBackground', 'button.secondaryForeground', 'button.secondaryHoverBackground',
  'panel.border', 'widget.border', 'widget.shadow', 'progressBar.background',
  'textLink.foreground', 'textLink.activeForeground', 'textBlockQuote.background',
  'textBlockQuote.border', 'textCodeBlock.background', 'toolbar.hoverBackground',
  'list.hoverBackground', 'list.focusBackground', 'list.focusForeground', 'list.focusOutline',
  'list.activeSelectionBackground', 'list.activeSelectionForeground',
  'quickInput.background', 'quickInput.foreground', 'quickInputList.focusBackground',
  'quickInputList.focusForeground', 'quickInputList.focusOutline',
  'editorSuggestWidget.background', 'editorSuggestWidget.foreground', 'editorSuggestWidget.border',
  'editorSuggestWidget.selectedBackground', 'editorSuggestWidget.selectedForeground',
  'symbolIcon.keywordForeground', 'symbolIcon.stringForeground', 'symbolIcon.numberForeground',
  'symbolIcon.functionForeground', 'symbolIcon.classForeground', 'symbolIcon.regexpForeground',
  'testing.iconPassed', 'testing.iconFailed', 'terminal.ansiGreen', 'terminal.ansiRed', 'terminal.ansiYellow',
] as const;
const allowedColors = new Set<string>(COLOR_KEYS);

export const SYNTAX_SCOPES = {
  comment: ['comment'], keyword: ['keyword', 'storage', 'keyword.control'],
  string: ['string', 'string.quoted'], number: ['constant.numeric', 'constant.language'],
  function: ['entity.name.function', 'support.function'],
  type: ['entity.name.type', 'support.type', 'support.class'], regexp: ['string.regexp'],
} as const;
export type SyntaxKey = keyof typeof SYNTAX_SCOPES;
export interface ColorTheme {
  id: string;
  name: string;
  mode: ThemeMode;
  colors: Record<string, string>;
  syntax: Partial<Record<SyntaxKey, string>>;
}
export interface ThemeLibrary { version: 1; selected: string; imports: ColorTheme[]; }

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}
export function isColor(value: unknown): value is string {
  return typeof value === 'string' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value);
}
function rgb(hex: string): number[] {
  const value = hex.length <= 5 ? [...hex.slice(1)].map(c => c + c).join('') : hex.slice(1);
  return [0, 2, 4].map(i => parseInt(value.slice(i, i + 2), 16));
}
function opaque(hex: string): boolean {
  return hex.length === 4 || hex.length === 7 || (hex.length === 5 ? /f$/i.test(hex) : /ff$/i.test(hex));
}
function mix(background: string, foreground: string, amount: number): string {
  const bg = rgb(background), fg = rgb(foreground);
  return '#' + bg.map((v, i) => Math.round(v * (1 - amount) + fg[i] * amount).toString(16).padStart(2, '0')).join('');
}
function cleanName(value: unknown, fallback: string): string {
  const text = typeof value === 'string' ? value : fallback;
  return text.replace(/[\u0000-\u001f\u007f-\u009f]/g, '').trim().slice(0, 80) || 'Imported theme';
}
function colorEntries(raw: Record<string, unknown>): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!allowedColors.has(key) || value === null) continue;
    if (!isColor(value)) throw new Error(`Invalid color for ${key}; use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`);
    colors[key] = value;
  }
  const background = colors['editor.background'];
  if (!background || !opaque(background)) throw new Error('A standalone theme needs an opaque colors["editor.background"]. Export a resolved color theme from VS Code.');
  return colors;
}

/** Deliberately a small color importer, not a VS Code extension/TextMate engine. */
export function importTheme(text: string, filename: string, id: string): { theme: ColorTheme; warnings: string[] } {
  if (new TextEncoder().encode(text).length > MAX_THEME_BYTES) throw new Error('Theme files must be 512 KiB or smaller.');
  if (!/\.jsonc?$/i.test(filename)) throw new Error('Choose a VS Code color-theme .json or .jsonc file, not a .vsix or terminal theme.');
  const errors: ParseError[] = [];
  const raw: unknown = parse(text.replace(/^\uFEFF/, ''), errors, { allowTrailingComma: true, disallowComments: false });
  if (errors.length) throw new Error(`Invalid theme JSON: ${printParseErrorCode(errors[0].error)} at character ${errors[0].offset}.`);
  if (!record(raw)) throw new Error('A theme must be a JSON object.');
  if (raw.include !== undefined || typeof raw.tokenColors === 'string') throw new Error('This theme references other files. In VS Code, run “Developer: Generate Color Theme From Current Settings” and import the saved JSON instead.');
  if (!record(raw.colors)) throw new Error('Expected a VS Code color-theme file with a colors object. Terminal palettes and extension package.json files are not supported.');
  const colors = colorEntries(raw.colors);
  const [r, g, b] = rgb(colors['editor.background']);
  let mode: ThemeMode = r * .299 + g * .587 + b * .114 >= 128 ? 'light' : 'dark';
  if (raw.type !== undefined) {
    if (!['dark', 'light', 'hc', 'hcLight'].includes(String(raw.type))) throw new Error('Theme type must be dark, light, hc, or hcLight.');
    mode = raw.type === 'light' || raw.type === 'hcLight' ? 'light' : 'dark';
  }
  const syntax: ColorTheme['syntax'] = {};
  const specificity: Partial<Record<SyntaxKey, number>> = {};
  if (raw.tokenColors !== undefined && !Array.isArray(raw.tokenColors)) throw new Error('tokenColors must be an array of color rules.');
  for (const rule of (raw.tokenColors as unknown[] | undefined) || []) {
    if (!record(rule) || !record(rule.settings) || rule.settings.foreground == null) continue;
    if (!isColor(rule.settings.foreground)) throw new Error('Invalid tokenColors foreground; only hex colors are supported.');
    if (!rule.scope) { colors['editor.foreground'] ??= rule.settings.foreground; continue; }
    const scopes = (Array.isArray(rule.scope) ? rule.scope : [rule.scope]).flatMap(scope => typeof scope === 'string' ? scope.split(',').map(s => s.trim()) : []);
    for (const [key, targets] of Object.entries(SYNTAX_SCOPES) as [SyntaxKey, readonly string[]][]) {
      for (const scope of scopes) {
        // General foreground scopes only. Context selectors/language grammars are not simulated.
        if (!/^[\w.-]+$/.test(scope) || !targets.some(target => target === scope || target.startsWith(scope + '.'))) continue;
        const score = scope.split('.').length;
        if (score >= (specificity[key] ?? 0)) { syntax[key] = rule.settings.foreground; specificity[key] = score; }
      }
    }
  }
  return {
    theme: { id, name: cleanName(raw.name, filename.replace(/\.jsonc?$/i, '')), mode, colors, syntax },
    warnings: raw.semanticTokenColors ? ['Semantic token colors are not supported; general tokenColors rules are used.'] : [],
  };
}

/** Fill absent UI roles from the imported palette, rather than leaking the previous theme. */
export function themeProperties(theme: ColorTheme): Record<string, string> {
  const c = theme.colors, bg = c['editor.background'];
  const fg = c['editor.foreground'] || c.foreground || (theme.mode === 'dark' ? '#f8f8f2' : '#23343d');
  const border = c['panel.border'] || c['widget.border'] || mix(bg, fg, .2);
  const accent = c.focusBorder || c['textLink.foreground'] || fg;
  const muted = c.descriptionForeground || mix(bg, fg, .65);
  const surface = c['editorWidget.background'] || mix(bg, fg, .035);
  const selection = c['list.focusBackground'] || c['editor.selectionBackground'] || c['selection.background'] || mix(bg, fg, .18);
  const button = c['button.background'] || selection;
  const error = c.errorForeground || c['editorError.foreground'] || c['terminal.ansiRed'] || (theme.mode === 'dark' ? '#ff9d9d' : '#a32d38');
  const success = c['testing.iconPassed'] || c['terminal.ansiGreen'] || (theme.mode === 'dark' ? '#77d8bd' : '#287c69');
  const warning = c['editorWarning.foreground'] || c['terminal.ansiYellow'] || (theme.mode === 'dark' ? '#e8bc79' : '#805316');
  const defaults: Record<string, string> = {
    foreground: fg, descriptionForeground: muted, focusBorder: accent, errorForeground: error,
    'editor.background': bg, 'editor.foreground': fg, 'editor.selectionBackground': selection, 'selection.background': selection,
    'editorWidget.background': surface, 'editorGroupHeader.tabsBackground': surface,
    'editorCodeLens.foreground': muted, 'editorIndentGuide.background1': border,
    'editorWarning.foreground': warning, 'editorError.foreground': error,
    'input.background': bg, 'input.foreground': fg, 'input.border': border,
    'button.background': button, 'button.foreground': fg, 'button.hoverBackground': mix(button, fg, .12),
    'button.secondaryBackground': surface, 'button.secondaryForeground': fg, 'button.secondaryHoverBackground': selection,
    'panel.border': border, 'widget.border': border, 'widget.shadow': theme.mode === 'dark' ? '#0007' : '#0002',
    'progressBar.background': accent, 'textLink.foreground': accent, 'textLink.activeForeground': accent,
    'textBlockQuote.background': surface, 'textBlockQuote.border': border, 'textCodeBlock.background': surface,
    'toolbar.hoverBackground': selection, 'list.hoverBackground': selection,
    'list.focusBackground': selection, 'list.focusForeground': fg, 'list.focusOutline': accent,
    'list.activeSelectionBackground': selection, 'list.activeSelectionForeground': fg,
    'quickInput.background': surface, 'quickInput.foreground': fg,
    'quickInputList.focusBackground': selection, 'quickInputList.focusForeground': fg, 'quickInputList.focusOutline': accent,
    'editorSuggestWidget.background': surface, 'editorSuggestWidget.foreground': fg, 'editorSuggestWidget.border': border,
    'editorSuggestWidget.selectedBackground': selection, 'editorSuggestWidget.selectedForeground': fg,
    'symbolIcon.keywordForeground': fg, 'symbolIcon.stringForeground': fg, 'symbolIcon.numberForeground': fg,
    'symbolIcon.functionForeground': fg, 'symbolIcon.classForeground': fg, 'symbolIcon.regexpForeground': fg,
    'testing.iconPassed': success, 'testing.iconFailed': error,
    'terminal.ansiGreen': success, 'terminal.ansiRed': error, 'terminal.ansiYellow': warning,
  };
  const properties = Object.fromEntries(Object.entries({ ...defaults, ...c }).map(([key, value]) => [cssColorKey(key), value]));
  for (const key of Object.keys(SYNTAX_SCOPES) as SyntaxKey[]) {
    properties[`--nimrod-syntax-${key}`] = theme.syntax[key] || (key === 'comment' ? muted : fg);
  }
  properties['--nimrod-brand-accent'] = warning;
  return properties;
}
export const cssColorKey = (key: string): string => `--vscode-${key.replaceAll('.', '-')}`;
export const MANAGED_PROPERTIES = [...COLOR_KEYS.map(cssColorKey), ...Object.keys(SYNTAX_SCOPES).map(key => `--nimrod-syntax-${key}`), '--nimrod-brand-accent'];

export function applyTheme(root: HTMLElement, theme?: ColorTheme): void {
  for (const key of MANAGED_PROPERTIES) root.style.removeProperty(key);
  if (!theme) {
    root.style.removeProperty('color-scheme');
    delete root.dataset.themeMode;
    root.dataset.theme = 'nimrod';
    return;
  }
  root.dataset.theme = theme.id;
  root.dataset.themeMode = theme.mode;
  root.style.colorScheme = theme.mode;
  for (const [key, color] of Object.entries(themeProperties(theme))) root.style.setProperty(key, color);
}

export function readLibrary(raw: unknown): ThemeLibrary {
  if (raw == null) return { version: 1, selected: 'nimrod', imports: [] };
  if (!record(raw) || raw.version !== 1 || !Array.isArray(raw.imports) || raw.imports.length > MAX_IMPORTED_THEMES || typeof raw.selected !== 'string') throw new Error('Saved theme settings are invalid. Nimrod is active; import your themes again.');
  const ids = new Set<string>();
  const imports = raw.imports.map((item): ColorTheme => {
    if (!record(item) || typeof item.id !== 'string' || !/^import-[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id) || !['dark', 'light'].includes(String(item.mode)) || !record(item.colors) || !record(item.syntax)) throw new Error('An imported theme in local storage is invalid.');
    ids.add(item.id);
    const colors = colorEntries(item.colors);
    const syntax: ColorTheme['syntax'] = {};
    for (const key of Object.keys(SYNTAX_SCOPES) as SyntaxKey[]) {
      if (item.syntax[key] === undefined) continue;
      if (!isColor(item.syntax[key])) throw new Error('Invalid saved syntax color.');
      syntax[key] = item.syntax[key];
    }
    return { id: item.id, name: cleanName(item.name, 'Imported theme'), mode: item.mode as ThemeMode, colors, syntax };
  });
  const selected = ['nimrod', 'dracula', ...ids].includes(raw.selected) ? raw.selected : 'nimrod';
  return { version: 1, selected, imports };
}
