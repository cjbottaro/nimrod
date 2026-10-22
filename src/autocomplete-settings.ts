export const AUTOCOMPLETE_ACCEPT_SETTING = 'interaction.autocompleteAccept';
export type AutocompleteAccept = 'tab' | 'tabOrEnter';
export const DEFAULT_AUTOCOMPLETE_ACCEPT: AutocompleteAccept = 'tab';

export function readAutocompleteAccept(settings: Record<string, unknown>): AutocompleteAccept {
  const value = settings[AUTOCOMPLETE_ACCEPT_SETTING];
  if (value === undefined) return DEFAULT_AUTOCOMPLETE_ACCEPT;
  if (value !== 'tab' && value !== 'tabOrEnter') throw new Error(`${AUTOCOMPLETE_ACCEPT_SETTING} must be tab or tabOrEnter.`);
  return value;
}
