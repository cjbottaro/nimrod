# Color themes

## Built-in themes

Open **Settings** using the project-bar gear or **⌘/Ctrl ,**, then use the **theme picker** under **Appearance**:

- **Nimrod (system)** — the app's custom Nimrod scheme; follows macOS/Windows/Linux light/dark appearance. This remains the default.
- **Dracula** — a dark adaptation of [Dracula's official palette](https://draculatheme.com/), including purple accents, pink keywords, yellow strings, and green functions. It stays dark even when the OS is light. Attribution and license are in [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md).

Changes apply immediately and are remembered between launches. They do not change zoom, layout, fonts, draft text, or the conversation. Switching colors does not rebuild transcript DOM or restart Pi. Native window decorations and OS file choosers still follow platform appearance settings.

## Import a theme

1. Obtain a **standalone VS Code color-theme JSON or JSONC file**.
2. Open **Settings → Appearance**, then choose **Import color theme…** from the theme picker.
3. Select the file. A valid theme is added to the picker, applied, and saved locally.

To remove an imported theme, select it, then choose **Remove current imported theme**. This removes Nimrod's saved copy and returns to the Nimrod scheme. It never changes/deletes the original file. Duplicate names get a numeric suffix rather than silently replacing another theme.

### Where to get themes

There is no universal theme-file format. Terminal palettes usually contain just foreground/background and 16 ANSI colors; application themes also describe inputs, buttons, lists, editor surfaces, and syntax colors. Nimrod currently imports the **VS Code format**, not iTerm/Windows Terminal/Alacritty theme files.

Browse themes at [VS Code Themes](https://vscodethemes.com/) or their authors' repositories. Look for a theme `.json` file, often in a `themes/` directory. Download the **raw file**, not the GitHub HTML page, extension `package.json`, or a `.vsix` package. Nimrod doesn't install extensions or download themes itself.

The most reliable route for a theme already installed in VS Code:

1. Activate it in VS Code.
2. Run **Developer: Generate Color Theme From Current Settings** from the Command Palette.
3. Save the generated JSON, then import it into Nimrod.

This is also the workaround for themes whose source files use `include` or an external TextMate token file: Nimrod requires a resolved, standalone file. The built-in example at [`src/themes/dracula.json`](../src/themes/dracula.json) is itself importable.

## Supported format and limits

- JSON and JSONC (comments and trailing commas), up to **512 KiB per file**.
- A `colors` object with an **opaque `editor.background`** is required. Optional `name`; otherwise use the filename.
- Color values must be hexadecimal `#RGB`, `#RGBA`, `#RRGGBB`, or `#RRGGBBAA`. Alpha is allowed for non-background roles. `null` means leave that role unspecified.
- `type` may be `dark`, `light`, `hc`, or `hcLight`; when absent, infer light/dark from the editor background. High-contrast types select the corresponding base appearance, not a separate certified accessibility mode.
- Recognized workbench colors map to Nimrod's surfaces. Missing roles are derived from the imported background/foreground/accent and standard status colors, rather than retaining leftovers from the previously selected theme.
- Broad `tokenColors` foreground rules map to seven syntax categories: comments, keywords/storage, strings, numbers/constants, functions, types, and regular expressions.
- **Not a full VS Code renderer:** language-specific/contextual TextMate selectors, semantic token coloring, token backgrounds, font styling, icons, fonts, spacing, and other extension settings are not imported. Syntax matching remains Highlight.js. Expect an adaptation, not pixel-identical VS Code output.
- `include` and string-valued `tokenColors` external references are rejected with export instructions. No neighboring files, URLs, extensions, scripts, or CSS are loaded.
- Up to **50 imported themes**. Theme selection and imported colors/names are stored in `appearance.theme` and `appearance.importedThemes` in Nimrod's JSONC settings file, separately from drafts and app-managed state. Legacy webview theme storage is migrated once. Valid external edits synchronize across windows; see [settings.md](settings.md). The original file is not needed after import. There is no cloud sync.
- Invalid files, canceled file picking, and persistence failures leave the active theme unchanged and show a dismissible notice. If saved settings are corrupt, startup falls back to Nimrod with a notice. A successful change is persisted before being applied.

## Deferred: in-app theme catalog

A searchable, offline-friendly catalog backed by public palette collections is recorded in [theme-catalog-plan.md](theme-catalog-plan.md). The user explicitly deferred implementation; keep the existing picker/importer unchanged until requested. The Nimrod scheme remains the default and the user's preferred theme.

## Implementation

- `src/theme.css`: Nimrod palette and application layout; internal `--vscode-*` compatibility tokens remain.
- `src/themes/theme.ts`: JSONC parsing, allowlisted hex colors, palette fallbacks, broad syntax mapping, saved-state validation, and CSS-variable-only application.
- `src/themes/dracula.json`: built-in Dracula adaptation.
- `src/themes/picker.ts`: selection, local file import/removal, notices, persistence, and stale-import protection.
- `test/themes.test.ts`: parser, lifecycle, persistence, and DOM-state regressions.
- `scripts/check-themes.mjs`: optional actual Chromium color checks under both light/dark CSS branches, plus import/restore and state preservation. Run with `CHROMIUM=/path/to/chrome-headless-shell node scripts/check-themes.mjs`. This does not establish native WebKit/file-dialog acceptance.
