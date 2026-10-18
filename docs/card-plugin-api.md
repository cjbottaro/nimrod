# Authoring TypeScript card plugins

Executable plugins use **API v2**. Personal `.ts`/`.tsx` entries export their own ID/tool metadata and are automatically bundled/cached by Nimrod; a separate compiled-JS manifest is optional for compatibility/distribution. The standalone type contract is [`src/card-plugin-api.ts`](../src/card-plugin-api.ts); import its types from your Nimrod checkout or copy that file into your plugin project. Optional public runtime helpers live in [`src/card-plugin-ui.ts`](../src/card-plugin-ui.ts). There is no separately published SDK package yet.

See [installation and trust](card-plugins.md#personal-typescript-plugins). Bundling instructions live in [Contributing](../CONTRIBUTING.md#card-plugin-examples). The complete [command-summary example](../examples/card-plugins/command-summary/plugin.ts) demonstrates custom DOM, a local input, incremental output and Copy through the supported host API.

## Entry point

Default-export a renderer object; personal sources also supply `tools` and/or ACP `kinds` in that export (manifest packages may keep matching in their manifest):

```ts
import type { CardPlugin, ToolCardData } from '../path/to/card-plugin-api';

const plugin: CardPlugin<ToolCardData> = {
  apiVersion: 2,
  id: 'example.my-tool',
  tools: ['my_tool'],
  supports: () => true,
  mount(context) {
    const title = context.document.createElement('span');
    title.textContent = 'My tool';
    context.summary.append(title);
    const content = context.document.createElement('pre');
    context.body.append(content);
    const unregister = context.registerOutput('result', content);
    return {
      update(data) {
        content.textContent = data.resultOutput || data.executionOutput || '';
      },
      dispose() { unregister(); },
    };
  },
};
export default plugin;
```

Nimrod automatically bundles personal TypeScript sources, static local imports and already-installed browser-compatible dependencies. No runtime npm install/download, Node builtins, external module fetch or additional CSS/asset output is supported. Compiler target/options are fixed (browser ESM/ES2022, no implicit tsconfig/aliases), and it does not type-check. Compiled manifest packages must still supply self-contained JS.

Use type-only imports for the type contract: they are erased before runtime resolution, so the command-summary example works without installing a runtime SDK package. Runtime helper imports are real browser-compatible local imports and must be bundled along with their dependency graph; copying only the type file does not supply those implementations. For editor checking, you can copy `src/card-plugin-api.ts` into a local `.d.ts` file (declarations are not autoloaded) and adjust the type import. Keep module initialization side-effect-free; acquire per-card resources in `mount` and release them in `dispose`.

## Lifecycle and ownership

- Optional `matches(data)` is mount-time applicability after metadata matching: false or a thrown exception skips to the next candidate. It receives an immutable snapshot and runs only while the plugin is currently enabled/trusted, even if a reload still retains the old catalog. It is not rerun on streaming updates; do not depend on incomplete arguments or later metadata to select a renderer.
- `supports(data)` establishes compatibility, **not input completeness**. Returning false latches that mounted card to raw fallback. Handle partial streamed arguments in `update` instead.
- `mount(context)` runs once per mounted card and returns `update(data, state)` / `dispose()`.
- Presentation updates can be coalesced. Hidden sessions retain mounted instances and catch up with the latest data on reveal, without replaying intermediate updates. Removal cleanup waits for that catch-up; explicit session reset/view disposal still cleans up immediately. Plugin-owned timers/async work are not automatically suspended while hidden.
- `matches`, `supports`, `mount`, `update`, `dispose` and `mutate` callbacks are synchronous. Managed event handlers may be async. Rejected async lifecycle promises are errors, not a delayed rendering mechanism.
- Update existing nodes. Keep local fields, disclosure inside your body, focused controls and reading positions intact. Local state is not automatically persisted across reset/window restart.
- Core owns the outer card, authoritative status/indicator, disclosure, placement and transcript scroll. Modify only your summary/body content. Do not set outer `open`, recreate the shell, focus the composer or implement your own transcript following.
- Use `context.signal` and `dispose` for timers/requests/resources. Mount/update/managed-callback failures release owned resources and recover only that card. Unmanaged callbacks, module globals and infinite loops are outside this containment guarantee.

Updates receive detached, deeply frozen data snapshots and frozen lifecycle state; retain your own mutable UI state rather than modifying these values. Unchanged immutable subtrees such as arguments may be shared across updates, so do not assume every nested object gets a new identity. `ToolCardData` supplies the existing tool presentation fields: `name`, `arguments`, `executionOutput`, `resultOutput`, `isError`, `toolStatus` and presentation `uiPhase`. Arguments can be partial JSON text or structured data; narrow their shape before use. `state.streaming` controls host-owned output caps and is not authority to infer agent activity or execution success. Pi's structured/non-text result metadata is not available yet. ACP cards additionally supply `source`, human-readable `title`, protocol `kind` and retained `native` metadata; they do not pretend to have Pi's native payload shape.

## Context API

| API | Behavior |
| --- | --- |
| `document`, `summary`, `body` | Owner document and plugin-owned content slots. Build custom HTML with DOM APIs; use `textContent` for agent-provided strings. |
| `markdown(source)`, `code(source, language?)` | Existing safe Markdown/highlighting and code controls. Rendering is local; no provider request. |
| `renderPresentation(value)` | Optional incremental helper for title/preview, keyed text/Markdown/diff/console sections and keyed member labels. Custom DOM is not limited to this helper. |
| `registerOutput(key, element)` | Register a stable independently scrolling viewport inside your body. Core applies live/final caps and preserves its reading position. Returns an unregister function. |
| `mutate(change)` | Capture transcript/output intent **before** a later synchronous DOM/layout change, then reconcile through core. Use it inside async completion handlers; direct async mutations cannot promise scroll preservation. |
| `on(target, type, handler)` | Managed handler with active/modal/disposal guards and exception/rejection containment. Returns an unsubscribe function. |
| `capabilities` | Availability flags for Copy, links and Pop out; not a security permission object. |
| `copy(text)` | Copy exact text via the host. Also available for historical/disconnected cards. |
| `openLink(href)` | Existing validated HTTP(S)/file/editor handoff, relative to the owning project. Never navigate the app webview. |
| `popOutCode(text, language?)` | Existing immutable session-owned pop-out request. Queued opens retain selected-session guards; stale requests may be suppressed. |

Sections may set `format: 'console'` to render ANSI colors/styles and common command-log progress controls. It uses the same keyed viewport, lifecycle caps and reading-position ownership as text sections. It is not an interactive/full-screen terminal. Exact source is retained in the core **Raw output** disclosure when the rendered text differs. See [console-style command output](reading-conversations.md#console-style-command-output) for supported behavior and limits.

Presentation actions require a mounted active card and no modal. Handle expected operation failures in your UI, and check `signal.aborted` after awaiting before changing it. No prompt submission, tool execution, filesystem access, configuration mutation or unrestricted IPC is provided by this API.

Core always retains raw inputs. `renderPresentation` accepts optional `rawInputsPlacement: 'after'` to request those core-owned inputs below the plugin body; omission or `'before'` retains their usual position. Reordering preserves the mounted disclosure and its open state. A custom tool presentation that omits literal execution/result sections gets an independent **Raw output** disclosure, so historical results remain accessible without depending on your renderer. This also applies when your synchronous `update` customizes the text of a helper-rendered section: calling `renderPresentation` does not waive raw recovery.

## Harness targets and shared runtime

Official SDK Copilot has an explicit target
`{ backend: 'copilot-sdk', agent: 'copilot' }`; `{ backend: 'copilot-sdk' }`
matches any SDK source. It is not an ACP alias. Unspecified targets and Pi
tool overrides remain Pi-only. SDK tool `native` metadata contains original SDK
event payloads; shell/read/search components remain shared. Categories (`kinds`)
may select SDK tools, but `defineKindPlugin` is still the ACP-specific helper;
use explicit SDK targets with `definePresentationPlugin`/native name matching.
New SDK fixtures and native packaging acceptance are pending.

This surface is new in the experimental [ACP POC](acp.md). Public-helper/scoping and the latest matching/extraction fixtures pass offline; native app acceptance remains pending.

Executable plugin exports may declare `targets`:

```ts
const targets = [{ backend: 'acp' as const, agent: 'copilot' }];
```

Omitting `targets` keeps existing plugins **Pi-only**. `{ backend: 'acp' }` matches any ACP agent; an optional `agent` matches the exact negotiated `agentInfo.name`, not the user's profile label. Put `targets` on the default-exported plugin object, not in a legacy manifest (its schema is unchanged). Declarative packages remain Pi-only. Pi's existing tool-name overrides do not carry over to ACP.

For ACP, `data.name` is the optional native programmatic tool name; `data.kind` is its independent protocol category (`execute`, `read`, etc.). `tools` matches normalized names, as with Pi; `kinds` matches ACP categories. Either selector can qualify a card. Category-only personal plugins may omit `tools`, but must declare an ACP target. `data.title` retains the human title, `data.arguments` carries `rawInput`, and `data.native` retains patched metadata. Null/omitted optional update fields do not erase earlier values.

**Early POC migration:** change `tools: ['execute']` to `kinds: ['execute']` when you mean the category, or use `defineKindPlugin`. Pi plugin matching and legacy manifest schemas are unchanged; `kinds`/`targets`/`matches` belong on the executable export.

Automatic ACP selection considers matching external plugins before bundled fallbacks: exact agent targets before generic ACP targets, then name matches before category-only matches, then existing catalog order. `matches` can decline a candidate so multiple specialized cards can share a category. Pi keeps its existing catalog order and explicit overrides; an explicit override does not perform candidate search. After selection, `supports` failure still latches to raw fallback rather than remounting another plugin. Selection stays fixed even if later tool metadata changes. Generic ACP cards remain available without any custom plugin.

The [external ACP shell example](../examples/card-plugins/acp-shell/plugin.ts) imports the **same public runtime** as bundled Pi Bash and optional Copilot shell cards:

```ts
import { defineKindPlugin, rawToolPresentation, shellPresentation }
  from '../path/to/nimrod/src/card-plugin-ui';

const plugin = defineKindPlugin('example.shell', ['execute'], data => {
  const raw = rawToolPresentation(data);
  return shellPresentation({ title: raw.title, sections: raw.sections });
});
export default Object.assign(plugin, { targets: [{ backend: 'acp' as const }] });
```

`defineToolPlugin` (names), `defineKindPlugin` (ACP categories) and `definePresentationPlugin` adapt pure presentation callbacks to the normal mount/update/dispose API. `rawToolPresentation` retains live/result sections; `shellPresentation` adds an optional `command` preview and console formatting through the shared keyed-output component. `fileReadPresentation({ path, projectDirectory?, range?, sections })` supplies a **Read file** summary with a project-relative path (or outside absolute path), then the optional requested range. `searchPresentation({ title?, query, scope?, projectDirectory?, glob?, sections })` supplies a query-first search summary; `scope` accepts a string or array and formats each path with the same rule. `displayFilePath(path, projectDirectory?)` is also public. Pass `context.projectDirectory`, the optional owning-project display context available to normal plugin mounts and `definePresentationPlugin`'s `mount(context)` callback. This is lexical display formatting, not filesystem resolution or file-access authority; raw data is unchanged. Without project context, a relative path is retained rather than resolving it against an invented cwd. Both retain the supplied literal sections and place core-owned Raw inputs after the output; neither parses native tool schemas or search results. Bundled Copilot read/search adapters use these same public components. Argument/preview helpers are also public. All use `context.renderPresentation`, so output caps, raw recovery and scroll ownership are the same supported host behavior as custom DOM plugins. Using these helpers is optional.

`questionAnswerPresentation({ question, answer, sections })` supplies a read-only exchange: the question becomes the title, with a speech-bubble icon and inset reply in the collapsed summary. The underlying optional `CardPresentation.questionAnswer: { answer: string }` field requests this layout in place of the usual preview; normal text wrapping and literal multiline replies replace the usual single-line monospace tool summary. Supplied sections remain behind the existing disclosure, with Raw inputs after the body and independent Raw output recovery. It adds no decision controls or harness actions. The helper supplies an accessible summary label that the tool shell combines with its authoritative lifecycle state. Bundled Copilot completed-question cards use this same public component.

Additional display-only helpers are public: `namedToolPresentation({title, preview?, sections})` provides a compact summary with Raw inputs after the result; `codeSearchText({files, totalCount?, incomplete?, notice?})` formats literal paths/snippets and supplied result counts without inventing file line numbers. `operationPreview(document, {title, description?, content?, notes?, raw})` builds a compact operation preview and collapsed raw disclosure, but owns no buttons, permission callbacks or agent actions. Bundled SDK adapters use these same helpers. Concrete native parsing and core permission ownership remain separate.

Web helpers are also public: `webSearchPresentation({ query, sections, sources? })` adds a query summary and numbered source list; `webFetchPresentation({ url, startIndex?, sections })` adds a URL/offset summary. Adapters interpret native schemas and supply citation mappings. `webUrl`, `displayWebUrl` and `markdownWebLink` support HTTP(S)-only presentation.

Markdown sections may opt into `{ format: 'markdown', webLinks: true, baseUrl?: string }`. Only HTTP(S) links survive; a valid base resolves relative web links, while relative links without one and file/unsafe URLs become inert. `constrainWebLinks` exposes the same post-sanitization helper for custom DOM renderers. Default local/Pi Markdown link behavior is unchanged. Opt-in web Markdown sections use regular text typography and existing keyed output viewports/caps; changing text or link policy may replace inner Markdown, while unchanged lifecycle updates retain it. Original flattened tool output remains available through raw recovery when transformed.

Bundled and external plugins have the same capabilities, not a private built-in-only shell renderer. A separately bundled helper copy may use conservative raw-output inspection rather than the host's pure-adapter bookkeeping optimization; it does not lose rendering/action capabilities. These are local source-module imports, not a hypothetical `@nimrod/card-ui` npm package.

## Styling and trust

Plugins execute as explicitly trusted code in the same webview as Nimrod. Controlled slots and capabilities are supported ownership conventions, **not isolation**: code can reach webview globals. There is no sandbox, CSS isolation or protection from malicious/global effects or a blocked event loop.

Use local classes/styles inside your slots and inherited Nimrod theme variables. There is no package stylesheet/resource loader or supported app-wide styling API. Do not modify unrelated DOM or global styles. Existing bundled classes can change except the output behavior supplied by `registerOutput`; own your custom presentation styling.

Card content plugins do not contribute session commands, permission decisions, configuration controls or transport methods. Those belong to Nimrod's concrete harness integrations; the internal contribution boundary is not a public app-plugin SDK.

External matching currently targets tool cards. Bundled reasoning/parallel renderers use the same DOM API but are not externally selectable yet. Native macOS module loading/actions/focus and Linux behavior still need platform validation; offline WebKit CSP tests are not native Tauri acceptance.
