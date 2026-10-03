import dracula from './dracula.json';
import { importTheme } from './theme';

// Nimrod adaptation of Dracula's official palette, not the complete VS Code theme.
// Attribution and MIT license: THIRD_PARTY_NOTICES.md.
export const DRACULA = importTheme(JSON.stringify(dracula), 'dracula.json', 'dracula').theme;
