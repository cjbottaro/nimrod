export const TYPOGRAPHY_KEYS = {
  conversationFont: 'appearance.conversationFont',
  conversationSize: 'appearance.conversationFontSize',
  monospaceFont: 'appearance.monospaceFont',
  monospaceSize: 'appearance.monospaceFontSize',
} as const;
export interface Typography {
  conversationFont: string;
  conversationSize: number;
  monospaceFont: string;
  monospaceSize: number;
}
export const DEFAULT_TYPOGRAPHY: Readonly<Typography> = {
  conversationFont: '', conversationSize: 14, monospaceFont: '', monospaceSize: 14,
};
export const MIN_FONT_SIZE = 10;
export const MAX_FONT_SIZE = 32;
export const SYSTEM_CONVERSATION_FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
export const SYSTEM_MONOSPACE_FONT = "'SFMono-Regular', Consolas, 'Liberation Mono', monospace";

export function validFontFamily(value: unknown): value is string {
  return typeof value === 'string' && [...value].length <= 200
    && !/[\u0000-\u001f\u007f-\u009f]/.test(value)
    && (value === '' || value.trim() === value && value.length > 0);
}

export function readTypography(settings: Record<string, unknown>): Typography {
  const result = { ...DEFAULT_TYPOGRAPHY };
  for (const field of ['conversationFont', 'monospaceFont'] as const) {
    const value = settings[TYPOGRAPHY_KEYS[field]];
    if (value === undefined) continue;
    if (!validFontFamily(value)) throw new Error(`${TYPOGRAPHY_KEYS[field]} must be a single font family (at most 200 characters), or an empty string for System default.`);
    result[field] = value;
  }
  for (const field of ['conversationSize', 'monospaceSize'] as const) {
    const value = settings[TYPOGRAPHY_KEYS[field]];
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_FONT_SIZE || value > MAX_FONT_SIZE) {
      throw new Error(`${TYPOGRAPHY_KEYS[field]} must be an integer from ${MIN_FONT_SIZE} to ${MAX_FONT_SIZE} pixels.`);
    }
    result[field] = value;
  }
  return result;
}

/** Quote a single family, never interpret a saved name as a CSS font stack. */
export function fontStack(family: string, monospace = false): string {
  const fallback = monospace ? SYSTEM_MONOSPACE_FONT : SYSTEM_CONVERSATION_FONT;
  return family ? `"${family.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}", ${fallback}` : fallback;
}

const applied = new WeakMap<HTMLElement, string>();
export function applyTypography(root: HTMLElement, value: Typography): void {
  const signature = JSON.stringify(value);
  if (applied.get(root) === signature) return;
  const win = root.ownerDocument.defaultView;
  // Mounted views capture their own transcript/output intent before geometry changes.
  const realm = win as (Window & typeof globalThis) | null;
  if (realm) root.ownerDocument.dispatchEvent(new realm.Event('nimrod-typography-will-change'));
  root.style.setProperty('--nimrod-conversation-font', fontStack(value.conversationFont));
  root.style.setProperty('--nimrod-conversation-size', `${value.conversationSize}px`);
  root.style.setProperty('--vscode-editor-font-family', fontStack(value.monospaceFont, true));
  root.style.setProperty('--nimrod-monospace-size', `${value.monospaceSize}px`);
  applied.set(root, signature);
  if (realm) root.ownerDocument.dispatchEvent(new realm.Event('nimrod-typography-changed'));
}
