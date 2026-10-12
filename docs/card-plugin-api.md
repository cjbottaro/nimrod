# Authoring TypeScript card plugins

Executable plugins use **API v2**. Personal `.ts`/`.tsx` entries export their own ID/tool metadata and are automatically bundled/cached by Nimrod; a separate compiled-JS manifest is optional for compatibility/distribution. The standalone type-only SDK is [`src/card-plugin-api.ts`](../src/card-plugin-api.ts); import its types from your Nimrod checkout or copy that file into your plugin project. There is no separately published SDK package yet.

See [installation and trust](card-plugins.md#personal-typescript-plugins). Bundling instructions live in [Contributing](../CONTRIBUTING.md#card-plugin-examples). The complete [command-summary example](../examples/card-plugins/command-summary/plugin.ts) demonstrates custom DOM, a local input, incremental output and Copy through the supported host API.

## Entry point

Default-export a renderer object; personal sources also supply `tools` in that export (manifest packages may keep matching in their manifest):

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

Use type-only SDK imports: they are erased before runtime resolution, so copying the complete example works without installing a runtime SDK package. For editor checking, you can copy `src/card-plugin-api.ts` into a local `.d.ts` file (declarations are not autoloaded) and adjust the type import. Keep module initialization side-effect-free; acquire per-card resources in `mount` and release them in `dispose`.

## Lifecycle and ownership

- `supports(data)` establishes compatibility, **not input completeness**. Returning false latches that mounted card to raw fallback. Handle partial streamed arguments in `update` instead.
- `mount(context)` runs once per mounted card and returns `update(data, state)` / `dispose()`.
- `supports`, `mount`, `update`, `dispose` and `mutate` callbacks are synchronous. Managed event handlers may be async. Rejected async lifecycle promises are errors, not a delayed rendering mechanism.
- Update existing nodes. Keep local fields, disclosure inside your body, focused controls and reading positions intact. Local state is not automatically persisted across reset/window restart.
- Core owns the outer card, authoritative status/indicator, disclosure, placement and transcript scroll. Modify only your summary/body content. Do not set outer `open`, recreate the shell, focus the composer or implement your own transcript following.
- Use `context.signal` and `dispose` for timers/requests/resources. Mount/update/managed-callback failures release owned resources and recover only that card. Unmanaged callbacks, module globals and infinite loops are outside this containment guarantee.

Updates receive cloned, deeply frozen data snapshots and frozen lifecycle state; retain your own mutable UI state rather than modifying these values. `ToolCardData` supplies retained Pi tool fields: `name`, `arguments`, `executionOutput`, `resultOutput`, `isError`, `toolStatus` and presentation `uiPhase`. Arguments can be partial JSON text or structured data; narrow their shape before use. `state.streaming` controls host-owned output caps and is not authority to infer agent activity or execution success. Structured/non-text result metadata is not available yet.

## Context API

| API | Behavior |
| --- | --- |
| `document`, `summary`, `body` | Owner document and plugin-owned content slots. Build custom HTML with DOM APIs; use `textContent` for agent-provided strings. |
| `markdown(source)`, `code(source, language?)` | Existing safe Markdown/highlighting and code controls. Rendering is local; no provider request. |
| `renderPresentation(value)` | Optional incremental helper for title/preview, keyed text/Markdown/diff sections and keyed member labels. Custom DOM is not limited to this helper. |
| `registerOutput(key, element)` | Register a stable independently scrolling viewport inside your body. Core applies live/final caps and preserves its reading position. Returns an unregister function. |
| `mutate(change)` | Capture transcript/output intent **before** a later synchronous DOM/layout change, then reconcile through core. Use it inside async completion handlers; direct async mutations cannot promise scroll preservation. |
| `on(target, type, handler)` | Managed handler with active/modal/disposal guards and exception/rejection containment. Returns an unsubscribe function. |
| `capabilities` | Availability flags for Copy, links and Pop out; not a security permission object. |
| `copy(text)` | Copy exact text via the host. Also available for historical/disconnected cards. |
| `openLink(href)` | Existing validated HTTP(S)/file/editor handoff, relative to the owning project. Never navigate the app webview. |
| `popOutCode(text, language?)` | Existing immutable session-owned pop-out request. Queued opens retain selected-session guards; stale requests may be suppressed. |

Presentation actions require a mounted active card and no modal. Handle expected operation failures in your UI, and check `signal.aborted` after awaiting before changing it. No prompt submission, tool execution, filesystem access, configuration mutation or unrestricted IPC is provided by this API.

Core always retains raw inputs. A custom tool presentation that omits literal execution/result sections gets an independent **Raw output** disclosure, so historical results remain accessible without depending on your renderer.

## Styling and trust

Plugins execute as explicitly trusted code in the same webview as Nimrod. Controlled slots and capabilities are supported ownership conventions, **not isolation**: code can reach webview globals. There is no sandbox, CSS isolation or protection from malicious/global effects or a blocked event loop.

Use local classes/styles inside your slots and inherited Nimrod theme variables. There is no package stylesheet/resource loader or supported app-wide styling API. Do not modify unrelated DOM or global styles. Existing bundled classes can change except the output behavior supplied by `registerOutput`; own your custom presentation styling.

External matching currently targets tool cards. Bundled reasoning/parallel renderers use the same DOM API but are not externally selectable yet. Native macOS module loading/actions/focus and Linux behavior still need platform validation; offline WebKit CSP tests are not native Tauri acceptance.
