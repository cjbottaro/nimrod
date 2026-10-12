# Card plugins

**Status: implemented for bundled renderers, trusted TypeScript/JavaScript tool plugins, and optional declarative JSON plugins.** External executable plugins use the same mounted DOM API as bundled cards; JSON is their manifest, not a renderer limitation.

Pi extensions define agent capabilities; Nimrod card plugins define their transcript presentation. Core owns identity, placement, authoritative status, outer disclosure, focus, output caps, scrolling and raw recovery. Plugins own content inside explicit summary/body slots and can provide interactive presentation controls.

## Requested edit previews

Edit cards show **Requested edit** previews from structured `oldText`/`newText` substitutions. Removed and added text is highlighted; **Copy requested diff** copies substitutions without executing anything. These are **not applied-file diffs**: rejected/interrupted edits do not imply any file change. Raw inputs and Pi results remain readable.

## Install an executable plugin

1. Review its compiled JavaScript. The initial execution model is **trusted and in-process, not sandboxed**; installed code can reach webview globals.
2. Put the JSON manifest and its self-contained `.js`/`.mjs` entry beside each other under `card-plugins/` next to `settings.json` (normally `~/.config/nimrod/card-plugins/`; absolute XDG config roots apply).
3. List the manifest in settings **and explicitly trust it**:

```jsonc
{
  "cards.plugins": ["command-summary.json"],
  "cards.trustedPlugins": ["command-summary.json"],
  "cards.renderers": { "bash": "example.command-summary" }
}
```

The [command-summary example](../examples/card-plugins/command-summary/plugin.ts) mounts custom HTML, retains a local note through streaming and provides Copy. Its manifest is:

```json
{
  "apiVersion": 2,
  "id": "example.command-summary",
  "tools": ["bash", "shell", "terminal"],
  "entry": "command-summary.js"
}
```

Use the [authoring API guide](card-plugin-api.md) and [example bundling instructions](../CONTRIBUTING.md#card-plugin-examples). Nimrod loads compiled browser ESM; it does not compile TypeScript or resolve npm imports at runtime.

Packages are explicitly listed: no directory scan, remote download, automatic install or automatic trust. Entry names and manifest names cannot include paths/URLs. Symlink files are unsupported. Limits are 50 listed/trusted manifests, 256 KiB per manifest and 1 MiB per executable entry. Unsupported versions, mismatched module IDs/exports, failed imports and missing files appear in Settings without blocking ordinary cards.

There is no sandbox or enforced CSS/resource isolation. Supported APIs provide safe Markdown/code, Copy, validated links/files, Pop out, managed events, output registration and layout mutation—not agent execution. Exception recovery cannot prevent malicious/global effects or infinite loops. Trust applies to that manifest filename's code on future loads, including local file edits; it is not a signature/hash approval.

## Matching, updates and trust removal

`tools` contains normalized exact names: Nimrod lowercases a tool name and takes its final namespace component (`functions.read` matches `read`). Without an override, the first matching successfully loaded package in `cards.plugins` order wins, then the bundled renderer. Later duplicate IDs are rejected before their code is loaded.

`cards.renderers` maps normalized tool names to renderer IDs. Bundled tool choices are `nimrod.tool` (generic), `nimrod.edit-preview` (edit substitutions) and `nimrod.raw` (raw fallback). An explicitly selected missing/incompatible renderer uses raw fallback instead of silently selecting another plugin.

Packages load at window startup and when any of `cards.plugins`, `cards.trustedPlugins` or `cards.renderers` changes. Package-only file edits are not watched: reopen the window or remove/re-add the manifest in settings. Already mounted cards keep their selected renderer; new shells use the current catalog. No loading/configuration operation connects Pi, submits a prompt or replays one.

Removing an executable package from the enabled/trusted list prevents new code loads and stops its existing **managed** callbacks/actions on the next event/update, disposing that card to raw fallback. It cannot undo module-global effects or forcibly cancel arbitrary code. Reopen the window for full webview teardown. Renderer-override changes alone do not rebuild inspected cards.

External matching currently targets tool cards; reasoning/parallel customization, installation UI, package-only hot reload and agent-affecting actions remain follow-ons.

## Optional declarative plugins

API v1 declarations remain a no-executable-code convenience adapter, using the same DOM lifecycle internally. They require no `cards.trustedPlugins` entry:

```json
{
  "apiVersion": 1,
  "id": "example.read-preview",
  "tools": ["read"],
  "preview": "Reading {{/arguments/path}}",
  "sections": [
    { "key": "request", "label": "Requested file", "template": "{{/arguments/path}}", "format": "text" }
  ]
}
```

List its manifest filename in `cards.plugins`. Templates use own-property JSON pointers (`~0`/`~1` escapes supported); missing/null fields become empty text, objects/arrays become JSON. Arguments may still be streamed text until structured inputs arrive. Formats are literal `text` or `diff` (`+`/`-` colors), not HTML or external Markdown. Limits: 32 sections, 16,384 characters per template and 2 Mi characters per expanded presentation. Unknown fields, code/CSS/actions, invalid pointers and incompatible versions are rejected.

## Recovery and verification boundaries

Core retains raw inputs and execution/final output independently of custom DOM. Missing, incompatible or failed renderers recover within the affected card without rebuilding healthy siblings. Historical results remain readable without their plugin. Registered output viewports retain core scrolling/caps; plugins must use the managed mutation API for later layout changes.

Pi result metadata and non-text blocks are not currently retained for plugins; `resultOutput` is text. Rich custom Pi content still needs a separate transport/history design.

Offline DOM/WebKit/CSP and native filesystem fixtures do not establish packaged-app acceptance. Native macOS executable loading/actions/focus and Linux behavior remain to be validated; Windows is a possible future target.
