# Card plugins

**Status: implemented for bundled renderers and local declarative tool plugins.** External JavaScript, custom CSS, install/selection UI and agent-execution actions are not supported.

Pi extensions define agent capabilities; Nimrod card plugins define their transcript presentation. Tool, reasoning and parallel-tools renderers ship bundled through the same presentation-only instance contract. Core owns card identity, placement, status, disclosure, focus, output caps and scrolling; plugins supply validated content, not transcript DOM or transport access.

## Requested edit previews

Edit tool cards show **Requested edit** previews when structured inputs contain `oldText`/`newText` substitutions. Removed and added text is highlighted; raw inputs and Pi's result remain available. These are requested substitutions, **not an applied-file diff**: failed or interrupted edits do not imply any file change. Single-edit and multi-edit inputs are supported; partial/unsupported inputs keep the normal presentation.

## Install a local plugin

1. Create `card-plugins/` beside your Nimrod `settings.json` (normally `~/.config/nimrod/card-plugins/`; the configured absolute XDG config root applies).
2. Save a strict JSON package there, for example `read-preview.json`:

```json
{
  "apiVersion": 1,
  "id": "example.read-preview",
  "tools": ["read"],
  "preview": "Reading {{/arguments/path}}",
  "sections": [
    {
      "key": "request",
      "label": "Requested file",
      "template": "{{/arguments/path}}",
      "format": "text"
    }
  ]
}
```

3. Add its filename to `settings.json`:

```jsonc
{
  "cards.plugins": ["read-preview.json"],
  "cards.renderers": { "read": "example.read-preview" }
}
```

Packages are explicitly listed—there is no directory scan, network download or automatic installation. Filenames cannot include paths; symlink packages are unsupported. Limits: 50 files, 256 KiB per package, 32 sections and 16,384 characters per template. Packages are strict JSON; Nimrod settings remain JSONC. Expanded custom content is capped at 2 Mi characters per presentation; exceeding it uses raw fallback rather than duplicating large result data.

Packages load when a window starts and when `cards.plugins` or `cards.renderers` changes. Editing only a package file does not reload it: reopen the window or remove/re-add its filename in settings. A settings change affects newly mounted cards, **not already inspected cards**; explicit session restart/reset creates new shells. No prompt is sent or replayed by plugin loading.

## Matching and overrides

`tools` contains normalized exact tool names: Nimrod lowercases the name and uses its final namespace component (for example, `functions.read` matches `read`). Without an override, the first matching successfully loaded package in `cards.plugins` order wins, then the bundled renderer.

`cards.renderers` maps normalized tool names to renderer IDs. Available bundled tool choices are:

- `nimrod.tool` — normal generic tool card.
- `nimrod.edit-preview` — requested substitutions for edit tools.
- `nimrod.raw` — minimal raw presentation.

An explicitly selected missing/incompatible renderer uses raw fallback rather than silently selecting another plugin. Missing/malformed/version-incompatible package errors appear in Settings; they do not prevent ordinary cards from rendering. Duplicate package IDs reject the later package.

External packages currently customize **tool cards only**. Reasoning and parallel-tools renderers remain bundled.

## Package API v1

Required fields: `apiVersion: 1`, a namespaced `id` (the `nimrod.` prefix is reserved), nonempty `tools`, and `sections`. Optional `title` and `preview` templates customize summary content. Each section has a unique `key`, `label`, `template` and optional `format` (`text` by default, or `diff`). Diff lines starting with `-`/`+` receive removal/addition colors; this does not establish that any change was applied.

Templates substitute JSON pointers written as `{{/arguments/path}}`. Available data is the retained Pi tool-card model: `name`, `arguments`, `executionOutput`, `resultOutput`, `isError`, `toolStatus` and presentation `uiPhase`. Missing/null values become empty text; objects/arrays become JSON. JSON-pointer escapes `~0` and `~1` are supported. Partial streamed arguments may still be a string, so nested argument fields appear only once structured data is available.

Substituted content is literal text, never HTML. External Markdown is intentionally not supported in v1; bundled reasoning uses core's safe Markdown renderer. Unknown package fields, executable code, CSS, resource URLs, actions and unsupported API versions are rejected. A new version is required for incompatible schema changes.

## Recovery and limitations

Core retains raw inputs and execution/final output alongside external sections. Saved results stay readable without their plugin. Failed renderers latch the mounted card to raw fallback; loading changes do not rebuild healthy sibling cards or alter disclosure preferences.

This version is a bounded declarative presentation extension, not an arbitrary-code plugin system. There are no plugin action permissions: rendering cannot submit prompts, execute tools, write files or change harness state. Normal code/link actions remain core-owned.

Structured result metadata and non-text tool result blocks are not currently retained for plugins; `resultOutput` is text. Rich custom content from companion Pi extensions needs a separate transport/history design. Subagent, test-result and research cards remain possible follow-on work.

Offline DOM/WebKit and native filesystem unit tests do not establish packaged-app acceptance. Native macOS visuals and Linux behavior still require platform validation; Windows remains a possible future target.
