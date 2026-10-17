# Card plugins

**Status: implemented.** Personal TypeScript plugins load automatically, using the same mounted DOM API as bundled cards. Nimrod compiles/bundles them internally and caches the result. No manual JS build, manifest or per-file settings are required for this workflow.

Pi extensions define agent capabilities; Nimrod card plugins define their transcript presentation. Core owns identity, placement, authoritative status, outer disclosure, focus, output caps, scrolling and raw recovery. Plugins own content inside summary/body slots and can provide interactive presentation controls.

[ACP POC cards](acp.md) use the same plugin runtime with separate harness/agent matching. Existing plugins remain Pi-only unless their executable export explicitly adds an ACP target. External authors can use the same public shell/presentation helpers as bundled cards; see [harness targets and shared runtime](card-plugin-api.md#harness-targets-and-shared-runtime).

## Personal TypeScript plugins

Place a `.ts` or `.tsx` file here:

```text
~/.config/nimrod/card-plugins/my-tool.ts
```

Or use a directory entry point for a multi-file plugin:

```text
~/.config/nimrod/card-plugins/my-tool/index.ts
```

The folder is next to the resolved `settings.json`; absolute XDG config roots apply. Discovery is shallow: direct TS/TSX files and immediate directories with `index.ts`/`index.tsx`. Hidden entries, `.d.ts`, `node_modules`, entry symlinks and arbitrary deeper/config-tree files are not autoloaded. Local imported helpers can live in subdirectories without an entry point.

The default export supplies its own metadata:

```ts
export default {
  apiVersion: 2,
  id: 'example.my-tool',
  tools: ['my_tool'],
  supports: () => true,
  mount(context) {
    // Build your summary/body DOM and return update/dispose hooks.
    return { update(data, state) {}, dispose() {} };
  },
};
```

The complete [command-summary example](../examples/card-plugins/command-summary/plugin.ts) adds custom HTML, a local note field and Copy. Copy it as `command-summary.ts` or `command-summary/index.ts` in the personal directory; its type-only SDK import is erased during loading. For editor/type checking, see the [authoring guide](card-plugin-api.md).

**Placing code in this dedicated personal directory installs and trusts it**, like personal Pi extensions. It executes in Nimrod's webview, **not Node and not a sandbox**. Keep module initialization side-effect-free; manage per-card resources in mount/dispose. No project-level discovery or implicit project trust is introduced. To disable all personal autoloading, set `"cards.autoLoad": false` and reload/reopen the window. Manifest packages retain their separate trust rules.

### Ready-made external plugin

[Pi Web Access cards](pi-web-access-plugin.md) is a normal personal TS plugin for `pi-web-access` search, fetch, stored content and source checking, with source links and read-only Copy/Open/Pop out controls. It is optional and not registered as a built-in.

## Startup, reload and caching

Plugins load in the background at window startup; unrelated boot, draft restoration and session controls do not wait for compilation. Before a plugin finishes loading, new cards may use bundled rendering. Those already-mounted cards keep their renderer; later cards use the refreshed catalog.

Run **Reload card plugins** in the command palette after edits/additions/removals. It is bindable in Settings → Keybindings with no default shortcut. Settings shows loading status, loaded/cache-hit counts and errors. Reload does not restart Pi, send/replay prompts, change drafts, navigate or rebuild cards you're inspecting. Start a new tool invocation/window when you need to see a refreshed renderer. File changes are not watched continuously.

First load transpiles TypeScript and bundles static local imports and already-installed browser-compatible dependencies using Nimrod's native esbuild helper. No Node daemon, npm install, package lifecycle script or download runs during loading. Node builtins, external runtime imports, extra CSS/asset outputs and implicit tsconfig/alias configuration are unsupported; output is fixed browser ESM targeting ES2022. Compilation is not type checking.

Bundles are cached under `~/.cache/nimrod/card-plugins/` (absolute `XDG_CACHE_HOME` applies; empty/relative roots fall back to home). Unchanged starts reuse the disk bundle without spawning a compiler. Validation covers entry/import contents, dependency resolution inventories, package metadata/lockfiles, compiler/options and SDK contract—not just timestamps. Conservative metadata changes may rebuild. Warm starts still validate inputs and execute module initialization; they do not restore a running plugin instance.

Corrupt/stale caches rebuild. Failed edits do not execute the old bundle as a fallback. Deleting the cache simply causes recompilation. Native reads/cache publication are bounded: 50 personal entries, 1 MiB JS bundle, 8 MiB per input, 4096 inputs, 100,000 entries per resolution tree and 20s per compiler attempt. Limit/compile errors are reported, not silently truncated. Source files are not locked against external editors.

## Matching and overrides

`tools` contains normalized exact names: Nimrod lowercases the tool name and takes its final namespace component (`functions.read` matches `read`). Explicit manifest packages retain their configured order/precedence; then personal entries use sorted relative-path order; then bundled rendering. Duplicate IDs are rejected. For personal sources, metadata is known only after evaluating trusted code, so duplicate detection does not undo module-global effects.

`cards.renderers` maps normalized tool names to renderer IDs. Each Pi built-in has its own bundled plugin:

| Tool | Renderer ID | Presentation |
| --- | --- | --- |
| `read` | `nimrod.read` | File path and requested line range, when supplied; literal result text. |
| `bash` | `nimrod.bash` | Command preview and console-style streaming/results; also matches `shell` and `terminal`. |
| `edit` | `nimrod.edit-preview` | Requested substitution diffs with Wrap/Copy. |
| `write` | `nimrod.write` | Destination and literal **Requested content**, alongside Pi's output. |
| `grep` | `nimrod.grep` | Pattern/path preview and literal matches. |
| `find` | `nimrod.find` | Glob/path preview and literal results. |
| `ls` | `nimrod.ls` | Directory preview and literal listing. |

Each invocation mounts its own plugin instance. These use the same API-v2 lifecycle and context as personal plugins; shared helpers do not own tool selection or conversation state. External matches still take precedence unless explicitly overridden.

`nimrod.tool` is the generic fallback/override (input preview and literal output); `nimrod.raw` shows literal output without an input preview. To keep console formatting, choose `nimrod.bash` rather than forcing the generic renderer. Missing/incompatible explicit choices use raw fallback rather than silently choosing another plugin. A tool-specific renderer ID only applies to its matching tool names.

New-card applicability callbacks obey current enablement/trust even while the replacement catalog is loading. Revoked or disabled plugins cannot run matching callbacks through retained old entries.

Already-mounted cards retain their renderer on reload. Disabling autoload or removing an entry on reload stops its managed callbacks/actions on the next event/update, disposing that card to raw fallback. Unmanaged/global effects or already accepted native actions cannot be undone; reopen the window for full webview teardown.

## Existing manifest packages

Compiled-JS API-v2 manifests remain supported for distribution/compatibility. Put the `.json` manifest and its self-contained `.js`/`.mjs` entry together in the personal directory and explicitly enable/trust the manifest:

```jsonc
{
  "cards.plugins": ["command-summary.json"],
  "cards.trustedPlugins": ["command-summary.json"]
}
```

```json
{
  "apiVersion": 2,
  "id": "example.command-summary",
  "tools": ["bash", "shell", "terminal"],
  "entry": "command-summary.js"
}
```

These JS files are not automatically discovered. Entry/manifest names cannot include paths or URLs; files must not be symlinks. Limits are 50 listed/trusted manifests, 256 KiB per manifest and 1 MiB per entry. Unknown versions, mismatched exports, missing files and failed imports are isolated and reported.

API-v1 declarative JSON remains an optional no-executable-code adapter: `id`, `tools`, optional title/preview templates and keyed sections using own-property JSON pointers such as `{{/arguments/path}}`. Formats are literal `text`/`diff`, not HTML. It requires `cards.plugins` but no executable trust. Limits remain 32 sections, 16,384 characters per template and 2 Mi characters per expanded presentation; code/CSS/actions and invalid pointers are rejected.

## Requested edits and recovery

### Requested file content

Read ranges describe requested inputs, not verified output line numbers. Write previews show the requested `content` verbatim, including empty content; they do not claim that the file was written successfully. Pi's running/error/final output remains visible separately. Partial arguments do not show invented placeholders or unfinished string fields. Read image/non-text results and structured Bash exit metadata are not available through the current plugin data; plugins do not infer them from the path or output text.

### Requested edits

Bundled edit cards emphasize the filename, with a muted directory path. Expanded cards show a line diff from structured `oldText`/`newText` substitutions: unchanged lines remain context, and a compact toolbar shows added/removed line counts, **Wrap** and **Copy**. Multiple substitutions also show their position (for example, **1 of 3**). Wrap is local to each preview; Copy copies the diff text, unaffected by visual wrapping.

Raw inputs sit below the preview, with the full path available there. Routine completed output is kept in a collapsed **Raw output** disclosure; running, failed and interrupted output remains in the main card body. These previews are **not applied-file diffs**: they describe the requested substitutions, not verified file contents. Rejected/interrupted calls do not establish which changes, if any, reached the file. Very large replacement regions may show a literal removal/addition rather than matching every internal unchanged line, to bound rendering work.

Core retains raw inputs and execution/final output independently of custom DOM. Missing/incompatible/failed renderers recover within the affected card without rebuilding healthy siblings. Historical results remain readable. Registered output viewports retain core caps/reading intent; later layout changes should use managed mutation.

Structured/non-text Pi result metadata, external reasoning/parallel matching, agent-affecting actions, package installation UI and continuous hot reload remain follow-ons. Controlled slots/capabilities are conventions for trusted code, not confinement from malicious/global effects or blocked JavaScript.

Offline compiler, DOM/WebKit/CSP and filesystem fixtures are not packaged-app acceptance. Native sidecar signing/execution, module loading/actions/focus and Linux behavior remain platform validation; Windows remains a possible future target.
