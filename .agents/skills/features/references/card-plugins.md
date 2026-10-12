# Card plugins

**Status: declarative subset implemented; executable TypeScript/DOM plugin API in progress.** User guide: [Card plugins](../../../../docs/card-plugins.md). [Historical extraction](history/card-plugins-declarative.md) records the first implementation; its five-milestone completion applied only to declarative JSON, not the intended outcome.

## Desired outcome and responsibility boundary

- Plugins are authored in TypeScript, shipped as compiled JavaScript plus a JSON manifest. They mount custom HTML/DOM, update incrementally, own local UI state and event handlers, and dispose their resources. JSON declarations may remain a convenience adapter, not the extension ceiling.
- Default tool, reasoning, parallel-tools and requested-edit presentations must exercise the same DOM-capable renderer API as external code, without privileged built-in-only host capabilities.
- Core owns invocation identity, placement, authoritative Pi lifecycle/status, outer disclosure, focus/scroll intent, output caps, renderer selection, capability routing and raw fallback. Plugins own content inside explicit summary/body slots, not the shell or conversation state.
- Rendering is not permission to submit prompts, execute tools or alter harness state. First supported actions are presentation-only: safe Markdown/code rendering, Copy, validated links/files and Pop out. Agent-affecting actions remain a separately designed follow-on.
- One call-ID-keyed shell survives placement/streaming. Manual disclosure and each output reading position survive; generation/execution/result/result-processing phases remain distinct. Pi acknowledgement remains the only draft-clearing authority. No upstream Pi/extension changes.
- Portable behavior remains macOS first, Linux next, possible Windows later. Native acceptance is not established by fixtures.

## Execution decision

The initial executable API is **explicitly trusted, in-process JavaScript** to allow direct incremental DOM rendering through the same API as bundled plugins. It is **not a sandbox**: in-process code can reach webview globals; host capabilities and controlled slots are supported API boundaries, not security confinement. Packages require explicit per-package trust in settings before entry code is loaded. JSON declarations require no executable trust. No remote package fetch, directory scan, automatic trust or arbitrary module execution during tests.

Isolated untrusted-code loading is a separate future architecture; do not describe exception containment as protection from malicious code, hangs, global listeners or arbitrary IPC. No paid providers, live sessions, user config mutation or interactive browser inspection during implementation.

## Sequential milestones

Each milestone uses its own `.worktrees/` branch, validates and merges before the next begins. No app build/launch without a new explicit request.

| Milestone | Acceptance |
| --- | --- |
| A. Correct roadmap — complete | Distinguish declarative subset from desired TypeScript/DOM outcome; record ownership, trusted execution choice and follow-ons. |
| B. DOM contract and bundled migration — implemented | Controlled mounted slots; mount/update/dispose and managed event cleanup; default tool/reasoning/parallel/edit plus declaration adapter use it. Preserve shell/status/disclosure/focus/geometry. Host output registration and content-change path preserve live follow versus history reading. Fault tests cover mount/update/action/dispose and sibling/raw recovery. |
| C. Capabilities and interactive proof — implemented | Presentation APIs for safe rendering, Copy, validated links/files and Pop out; explicit historical/read-only semantics and disposed/hidden/modal guards. Requested-edit Copy diff proves custom DOM/control/functionality with no privileged implementation path or prompt execution. |
| D. Executable external packages — pending | Versioned manifest + local self-contained ESM entry; explicit trust, bounded native reads, compatibility/matching/overrides, fixed mounted selection, stale-load ordering, missing/incompatible/failed historical fallback; exported TS API types and compilable example. Docs distinguish trust from isolation and report platform gaps. |

## DOM contract (milestone B)

- `dom-card-renderer.ts` defines `DomCardRenderer` API v2: `mount(context)` returns `update(data, state)` / `dispose`. Context exposes the owner document, plugin-owned summary/body slots, abort signal, managed `on`, pre/post-change `mutate`, safe Markdown and explicit keyed output registration. This is trusted DOM access, not confinement.
- `DomCardController` owns exactly-once instance/resource cleanup, card-local failure latching and raw fallback. It removes managed listeners on mount/update/event/rejected-event failure and disposal; late managed callbacks become inert. Arbitrary unmanaged events/timers and module-global exceptions remain plugin author/trust responsibilities.
- Tool/edit/declaration renderers use the public `presentationPlugin` DOM adapter; reasoning and parallel plugins directly mount/update their DOM through the same context. Legacy pure presentation types are internal adapter helpers, not the executable API. No bundled-only DOM or host privileges.
- Core retains summary/status/disclosure and raw inputs. Custom tool DOM that does not include the retained execution/result sections gets an independent closed Raw output disclosure outside its slots. Synchronous failures retain latest raw content without rebuilding healthy siblings.
- Registered output viewports get host lifecycle caps and per-key reading-position preservation, including terminal transition. `mutate` captures follow intent/output inspection before asynchronous content changes; after-change routing uses the existing `TranscriptScroll` owner. Plugins must use it for later layout mutations; direct DOM mutation alone cannot promise scroll preservation.
- Existing direct-child geometry is preserved by a display-contents summary slot and tool-body section selectors. View removal/reset/disposal still owns cleanup. No executable loader or host actions shipped in B.
- `test/dom-card-renderer.test.ts` covers custom mounted input/focus/local state, multiple output viewports, mount/update/managed event failures, rejected callbacks, raw recovery and disposal. Lifecycle/mutation callbacks must be synchronous; rejected async lifecycle promises are consumed and fail to raw recovery. Validation: `mise run check` passes **480 TS/Node tests**, **114 Rust tests** (two opt-in smokes ignored), docs/formatting/Clippy; offline WebKit **66 tests** pass. No app build/launch or new native acceptance.

## Presentation capabilities and interactive proof (milestone C)

- Context offers safe `markdown`/`code` rendering, `copy`, `openLink`, `popOutCode`, and capability availability flags. Calls validate bounds/links and require a connected plugin body, active view and no modal; detached/removed/disposed managed controls do not deliver actions. There is no prompt/tool/config/transport API.
- `main.ts` injects native clipboard, project-owned validated links and existing session-pop-out routing. Presentation actions remain available for historical/disconnected cards; they do not connect Pi or require a child token. `open_card_link` derives cwd from the native window's registered project and reuses existing link/editor validation. Pending pop-out requests retain existing selected-session guard/serialization.
- `editDomRenderer` mounts custom Copy requested diff buttons/status and managed handlers through this same public context. It uses current structured substitutions, keeps controls/focus through updates, catches expected clipboard failures, removes stale handlers and ignores completion after disposal. Copy never implies an applied-file diff or invokes Pi.
- Existing safe-code Copy uses injected presentation clipboard when available and retains the correlated fixture fallback otherwise; read-only Markdown links similarly use the project presentation bridge. Core sanitized content never navigates the app webview.
- Tests: `card-plugin-actions.test.ts` covers capabilities, bounds/unsafe links, historical data, active/modal/disposed guards, exact requested diff, focus and late completion. Native-view fixture tests exercise disconnected history and modal delivery suppression. Browser `card-plugin-actions.spec.ts` runs an offline synthetic edit and records clipboard IPC only; no real clipboard, provider, file edit or app is touched. The Copy control uses pending/aria-busy rather than disabling a focused button, preserving native keyboard focus.
- Validation: `mise run check` passes **484 TS/Node tests**, **114 Rust tests** (two ignored opt-in smokes), docs/formatting/Clippy; **67 offline WebKit tests** pass. An existing single-instance lock fixture failed once, passed in isolation and on subsequent full gates; no unrelated instance code was changed. Native clipboard/link/pop-out acceptance remains user/platform work.

## Current code and preserved evidence

- `src/pi/card-renderer.ts` / `tool-card.ts` / `card-shell.ts`: existing presentation controller, core shell and raw recovery, disclosure and live-output ownership.
- `src/pi/card-plugins/`: bundled tool/reasoning/parallel/edit presentation, registry, declaration schema/interpreter and catalog. `reasoning-card.ts` / `parallel-card.ts` own current shells.
- `src/pi/webview-client.ts`: per-view tool registry, article reconciliation, snapshot/focus/scroll ordering and disposal. `tool-disclosure.ts` owns scheduler; `transcript-scroll.ts` is the sole transcript-follow owner.
- `src/preferences.ts`, `src/main.ts`, `src-tauri/src/card_plugins.rs`, `preferences.rs`: local declaration configuration/loading. Executable module loading/trust is not implemented yet.
- `test/card-renderer.test.ts`, `bundled-card-renderers.test.ts`, `edit-card.test.ts`, `external-card-plugins.test.ts`, `native-view.test.ts` and browser `card-plugins.spec.ts`: existing regression base. `mise run check` passed 473 TS/Node and 114 Rust tests; offline WebKit passed 66 tests at the declarative baseline.

The user built/restarted the baseline and reported existing cards/edit previews look good. That is limited macOS visual feedback, not external executable/plugin acceptance, exhaustive native lifecycle verification or Linux parity.

## Material constraints

- Pi tool results are flattened to text; structured/non-text result metadata is not currently preserved. The requested-edit proof uses actual structured input substitutions and must not claim an applied-file diff. Rich custom Pi content remains separate transport/history work.
- Default output/caps/Raw inputs and connected indicators must remain stable through extraction. Existing CSS has direct-child assumptions: wrapper changes require offline browser geometry tests.
- Arbitrary plugin event/async exceptions require managed callbacks and disposal guards; no synchronous controller can catch arbitrary outside callbacks or halt infinite loops. Document these trust boundaries.
- Package-only reload, plugin install/selection UI, external reasoning/parallel matching, executable sandboxing, custom CSS policy, app-wide extensions and agent-execution actions are not silently added by the tool plugin API.

## Verification

Run `mise run check`; DOM/layout/scroll changes also require `npm run test:browser`. Keep test fixtures local/offline and disposable. Actual native macOS focus/scroll/actions and Linux behavior remain platform acceptance. Build/publication requires explicit authorization per [build workflow](build-cache.md#explicit-build-and-publication-workflow).
