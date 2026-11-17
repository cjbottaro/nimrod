# Verification status

This is the current evidence/acceptance map, not a chronological test log. Feature references own current specifications and test maps. [Historical records](history/verification.md) preserve prior runs, native observations and superseded implementation steps; never follow their old acceptance instructions as current UI.

## Text-selection contrast

The shared [text-selection policy](themes.md#text-selection-contrast) has authored pure fixtures covering all bundled/catalog palettes, alpha/missing/imported colors, foreground repair, backing visibility and list/text-selection separation. Controller fixtures cover same-ID preview/rollback/reset, opacity independence and retained draft/focus/range; offline WebKit fixtures cover computed selection roles across four backings, dark/light system schemes, multiple palettes and opacity endpoints. These new fixtures have not been run. Native macOS/Linux active/inactive-selection paint, forced-colors behavior, transparent desktop surroundings and custom/plugin backings remain unverified; palette math/computed styles are not platform acceptance.

## Customize Nimrod

Source implementation adds the session-scoped action/modal, installed authoring context and canonical packaged guides/defaults/types/examples, ordinary separate-input view submission, and versioned user-turn disclosure. Authored, unrun fixtures cover exact framing/Unicode/delimiters, lazy retained/raw presentation, an unrelated project with absolute installed paths, resource mappings/missing files, modal cancel/IME/local rejection/stale guidance, four shared interaction policies, busy modes, unchanged draft/selection, echo adoption/lifetime fencing, real-shell palette/shortcut sending and an offline browser scenario.

No tests, live model requests, user customization edits, app builds or app launches were performed. Native macOS/Linux focus/accessibility, packaged reference resolution and installed-harness acceptance remain pending; mocks/jsdom are not native acceptance. Mandatory post-merge `mise run check` passed on primary `main` (TypeScript with the harness-boundary gate and Rust compilation). This is compile evidence only. See [request contract](customize-nimrod.md).

## CLI customization reload

Source implementation adds an allowlisted pre-runtime CLI client, separate per-user request/reply socket, existing-project/readiness routing, window-bound results and cleanup, and actual template/card outcomes from the shared reload. Authored, unrun fixtures cover exact argument forwarding on macOS/Linux, parser rejection/canonicalization, private endpoint ownership, bounded/lost replies, exact/ambiguous targets, wrong-window and expired completion, partial diagnostics, loader result identity and real-shell coalesced receipts without harness traffic.

No tests, live endpoint probes, app builds or app launches were performed. macOS/Linux CLI-to-window and installed-artifact acceptance remain pending; Windows transport is unsupported. Mandatory post-merge `mise run check` passed on primary `main` (TypeScript with the harness-boundary gate and Rust compilation). A follow-up native-close readiness fence has an authored, unrun regression fixture; compilation is not native/behavioral acceptance. See [contract](cli-actions.md) and [user guide](../../../../docs/cli-actions.md).

## UI templates

Initial declarative layout and Project bar source implementation uses the same public HTML/CSS pipeline for bundled defaults and user files. Authored, unrun fixtures cover default/custom rendering, retained nodes/focus, literal values, omitted actions, invalid input and I/O-error recovery, real shell identity/Settings consumers, side-aware resize direction and an offline browser right-sidebar/draft scenario. Native file fixtures cover optional files, size limits and escaping symlinks. Follow-up reload fixtures cover retained layout/content/action identity, repeated reloads, selection/focus/scroll, cached bindings, invalid-input rollback and IME/dialog guards; shell coverage exercises palette/rebound-shortcut routes without harness traffic. These additions remain unrun. Consolidated Reload customizations fixtures cover registry/default/override/unbinding and shell/browser updates; shell assertions verify both subsystems refresh and invalid UI input does not suppress the card rescan. These follow-up fixtures are also unrun.

No tests, browser checks, app builds or native app launch were performed for this work. Native macOS/Linux appearance, accessibility, focus and actual user-file loading acceptance remain pending. Mandatory post-merge `mise run check` passed on primary `main` (TypeScript with the harness-boundary gate and Rust compilation). Compilation is not behavioral acceptance. See [contract](ui-templates.md) and [user guide](../../../../docs/ui-templates.md).

## Codex host/Distrobox project cwd

The user-requested provider-free metadata investigation against the existing
managed Codex 0.169.0 daemon reproduced disagreement between cwd-filtered
listings and unfiltered/exact metadata. [Protocol evidence](../../codex-integration/references/protocol-evidence.md#distrobox-cwd-filter-disagreement-01690)
owns the observed shapes and limits. Lifecycle reported `alreadyRunning`;
only initialize/list/metadata-read were sent, with no thread Resume, prompt,
configuration change, interrupt, deletion or daemon restart/stop.

Source changes preserve exact saved-project partitioning while admitting only
native-verified runtime aliases after exact metadata preflight. Authored
fixtures: `test/codex-project-cwd.test.ts`, client/replay/connection/shell fixture
updates, `src-tauri/src/codex_project_tests.rs` and a native socket-bound Resume
preflight guard. Tests remain unrun. Native Nimrod Resume/Delete/new-session
acceptance across host/Distrobox and macOS remains pending; metadata reproduction
is not end-to-end acceptance. No app build/launch is part of this fix. Post-merge
`mise run check` on primary `main` passed in Distrobox (TypeScript plus Rust).
An initial fixture status-literal typing error was fixed in the task worktree
and merged before the passing run; the existing unused `Arc` import warning
remains. This is compile evidence only, not test or native-runtime acceptance.

## Session presentation boundary

Source-implemented: private presented-session ownership through `SessionPresenter`,
shared transition/refresh/removal paths and deactivation before Close/deletion
port disposal. Authored fixtures cover identity/badge/visibility/row state,
active-port ordering, same-target refresh, background/final removal, modal-aware
focus capture, filter-hidden selection and replacement identity. These fixtures
remain unrun; no build, browser or native app acceptance was performed.
Mandatory post-merge TypeScript/Rust compile results are reported separately.

## Session retention cleanup

Source-implemented: required saved/absent/unknown retention port, shared mounted
Close/Delete routing, exact draft/attachment/local-pointer cleanup after owned
stop, and conservative retention on discovery failures. Pi, Copilot, Codex and
runtime-only ACP supply concrete policies; an unrelated fixture harness exercises
the same shell path. New regression fixtures are authored but unrun. No build,
app launch, user-session deletion or installed-runtime probe was performed.
The reported follow-up `Unsupported Copilot SDK bridge operation` exposed a
missing Rust IPC allowlist entry for `retention`; that entry is now source-fixed.
Authored native fixtures cover valid/malformed exact IDs and gate the production
bridge's saved/absent/saved-but-unlisted lookups through `validate_message` before
real-pipe delivery to the offline SDK fixture. These additions remain unrun.
Mandatory post-merge TypeScript/Rust compile results are reported separately;
macOS/Linux native behavior remains unverified.

## Startup harness availability

Source-implemented: once-only executable discovery, omission of unavailable
harness actions/history and preservation of restored session/draft state. Authored
fixtures cover the immutable snapshot/restart boundary, silent missing optional
history, missing Pi, restored Codex actions and configured native resolver paths.
Tests/browser fixtures and installed-runtime/native macOS/Linux acceptance have
not been run for this change. Post-merge TypeScript/Rust compile results are
reported separately; compilation is not native acceptance. The separate reported
notice flash during deletion-confirmation transitions has not been reproduced or
fixed here; missing-at-startup harness notices are no longer produced.

## Codex native untouched-session probe

User-authorized, provider-free installed-runtime probe on macOS with
`codex-cli 0.164.0`. Native TUI ran in a controlled PTY with disposable HOME,
CODEX_HOME and project directories, a credential-free fixture provider, and an
inherited macOS sandbox denying outbound TCP/UDP. A loopback check confirmed
EPERM for both protocols. No prompts, turns, compaction, user-session reads/writes,
user-daemon attachment, service installation or Nimrod build/launch occurred.

| Native CLI scenario | Native exact-ID Resume | Fresh stdio app-server | Discovery |
| --- | --- | --- | --- |
| `--no-daemon`, create then `/quit` without Send | Exit 1: no saved session | `thread/resume` rejects with `no rollout found` | No rollout, no SQLite thread row, empty `thread/list` |
| `--no-daemon`, `/rename offline-empty-probe`, then `/quit` without Send | Successful reconnect, graceful exit 0 | Exact-ID Resume and empty turns page succeed after process restart | Rollout and named SQLite row exist, but ordinary `thread/list` and native Resume picker still omit it |
| Native `--remote unix://<fixture socket>`, create then `/quit` without Send; server stays alive | Reconnect to that same server exits 1 with `no rollout found` | Separate server also rejects Resume | Same server's `thread/loaded/list` includes the ID and metadata-only `thread/read` succeeds; ordinary `thread/list` is empty |

The persistent shared-server case used an owned `codex app-server --listen
unix://<fixture socket>`, not the user's daemon or managed daemon auto-start/
launchd integration. The native CLI printed a reconnect command at quit, but that
exact reconnect failed. Thus daemon visibility alone does not establish empty-
thread Resume support. The fixture background servers exited successfully after
scoped SIGTERM; no process scans or unrelated signals were used.

The named empty case was checked with unfiltered/source/cwd/name-search and
`useStateDbOnly` list variants, all empty. Read-only fixture database inspection
confirmed its name and zero user messages; native picker also showed zero
sessions. Its post-Resume rollout contained session metadata and settings events,
not a user turn. Captured probe RPCs were limited to initialize/initialized,
thread list/loaded-list/read/resume/turns-list.

Raw PTY, protocol, SQLite fixture homes and helper scripts are retained locally
under `/tmp/nimrod-codex-probe-jtxl4_2k/`; `matrix.stdout` records embedded cases,
`shared-untouched-v2/result.json` records the successful shared-server probe,
and `embedded-named/list-variants-result.json` records discovery. An initial PTY
warm-up was force-stopped and is excluded from graceful-exit results; an attempted
raw stdio proxy against the WebSocket Unix endpoint timed out, so the final
same-server probe used a validated WebSocket handshake over the private Unix
socket. These harness limitations are not product acceptance or Codex failures.

This verifies the narrow installed-runtime behaviors above, not Nimrod integration,
paid-model work, managed-daemon lifecycle, Linux or general native/platform
acceptance. [Protocol implications](../../codex-integration/references/protocol-evidence.md#untouched-native-session-interoperability-01640)
own the source mapping and next integration constraints.

## Codex command audit

Source-only audit of existing official `rust-v0.164.0` source/generated types
inventoried 65 built-ins and 178 app-server methods. The source-only extractor was
executed to create the pinned metadata/fingerprint snapshot; it did not launch
Codex. This is catalog/protocol evidence, not executed command acceptance.
Native-backed compaction and read-only report adapters are source implemented;
new report, lifecycle/order/error/pagination, audit-extractor and native
ownership/deletion-gate fixtures are authored **unrun**. The mandatory post-merge
`mise run check` passed: architectural dependency gate, TypeScript (including
negative registration assertions) and Rust compilation. This is not behavioral
or native acceptance. No tests, builds, app launches,
app-server probes, user-session/configuration mutation, live compaction or model
requests were run. Installed-runtime and macOS/Linux focus/scroll/Stop/usage
acceptance remain pending. The [compatibility matrix](../../slash-commands/references/codex.md)
and [audit procedure/inventory](../../slash-commands/references/codex-audit.md)
own behavior, scope and future audit triggers.

## Session command port

Required `HarnessSession.commands` registration/registry forwarding, shared
composer validation/invocation/card cancellation, retained command output and
Pi/Copilot/Codex/retained-ACP adapters are source-implemented. Codex's bounded
native-API-backed catalog is recorded in its compatibility matrix; the command
audit above extends the initial model/name baseline without claiming full CLI parity. New/updated shared, composer, type/registry, Pi, Codex and Copilot offline
fixtures are authored **unrun**. The mandatory post-merge `mise run check` passed:
architectural dependency gate, TypeScript (including required-port/negative type
assertions) and Rust compilation. This is compile evidence, not behavioral acceptance.
No tests, builds, app launches, installed-CLI probes, live compaction or model
requests were run for this task. Native model override confirmation and
macOS/Linux interaction/focus/scroll acceptance remain outstanding.
[Session commands](session-commands.md) owns the contract/code/fixture map.

## Registered harness application contract

**Unified Codex Delete follow-up:** the same deletion operation handles exact native absence as reviewed local removal, using a local-only native writer fence, mounted/native owned stop and post-stop absence recheck. A saved root hidden by listing still receives native review; history appearing during shutdown upgrades to guarded native deletion, and native-to-local downgrade is forbidden. Added client/catalog, adapter, native guard/metadata and shared-shell fixtures cover absent/saved-hidden/error/cancel/stop/upgrade paths and draft cleanup; these changes are authored **unrun**. No live native session or user data was queried/deleted, no provider work, build, app launch or native visual acceptance was performed. Only the required post-merge compile check is automatic. [Product Delete semantics](session-deletion.md#product-delete-semantics) and [Codex local removal](../../codex-integration/references/deletion.md#native-absence-and-local-removal) own the contract.

**Disconnected Close/Delete and owned-group follow-up:** required lifecycle/deletion port documentation now explicitly separates teardown, catalog-validated removal and conversation/Reload readiness. Codex no longer suppresses its deletion candidate when local history confirmation is absent. Shared shell regressions cover disconnected shortcut Close, catalog-only Delete/review/cancel, missing-root handling (superseded by the unified local-removal follow-up above) and failed-stop retry without Resume; native fixtures cover exited-leader reaping after group EPERM, live denial retention and remaining members without re-signaling. All new fixtures are authored **unrun**. Apple's kernel source supports the zombie-only group mechanism; no live reproduction, app build/launch, user-session deletion, model request or native/platform acceptance was performed for this change. Only the mandatory post-merge TypeScript/Rust compile check is automatic. [Session contracts](consumer-interfaces.md#lifecycle-guarantees), [Codex deletion](../../codex-integration/references/deletion.md#disconnected-session-contract) and [owned teardown](../../codex-integration/references/startup.md#owned-group-teardown-after-graceful-exit) own behavior.

**Codex native-contract revision and notice clipping:** the earlier Nimrod-private untouched-thread replacement/checkpoint/scope-move workaround is removed. Exact-ID reconnect, ignored retired markers with retained layout/draft scopes, runtime-only native history confirmation for Reload and concise missing-history diagnostics are source-implemented; the disconnected-deletion follow-up above removes its initially over-broad removal gate. New/updated connection/session fixtures cover no replacement even with old untouched markers, unavailable optional history reads, saved zero-turn reads, exact Resume, native rename/terminal confirmation and no replay. CSS keeps a lone banner's border on its scroll viewport; short/tall offline-browser regression assertions are authored. These changed fixtures are **unrun**; no new native/model probe, build, app launch or native visual acceptance was performed for this revision. The isolated Codex probe above remains narrow runtime evidence, not proof of the new Nimrod paths. Authenticated read-only `gh` issue searches found the existing reports linked in [protocol evidence](../../codex-integration/references/protocol-evidence.md#existing-upstream-issues); no GitHub content was posted. Only the required post-merge TypeScript/Rust compile check is automatic. [Codex contract](../../codex-integration/SKILL.md#untouched-session-persistence-anomaly) and [notice layout](error-presentation.md) own behavior.

**Rename session follow-up:** required `SessionNaming` port, palette/configurable shortcut/native row menu, Pi/Copilot/Codex native mutations and explicit ACP rejection are source-implemented. New normalization, registry/type, shell, native-operation/order/error, offline bridge and Rust validation/deletion-gate fixtures are authored **unrun**. The mandatory post-merge compile check is the only automatic validation; no build, app launch, live session mutation or native/platform acceptance is implied. [Session naming](session-naming.md) owns the behavior and fixture map.

**Reload session follow-up:** the required `SessionReload` port replaces the optional-support Restart contract; Pi, Copilot and Codex implement exact-identity fresh-runtime reload. New/updated offline registry, shell, shortcut-compatibility and MRU fixtures are authored **unrun**. Only the mandatory post-merge TypeScript/Rust compile check is automatic for this task; compilation is not behavioral evidence. No build, app launch, installed-runtime probe or native acceptance was performed. Copilot/Codex owned-process reload and macOS/Linux focus/decision cancellation remain native acceptance work. [Reload lifecycle](projects-and-sessions.md#reload-session-lifecycle) owns the contract.

The review-branch migration is source-implemented: required typed registration/
project/session factories, explicit unsupported/generic feature implementations,
all shared shell consumers routed through those ports, concrete Pi/SDK/Codex/
retained-ACP ownership, registered action/card presentation and generic tagged
identity/recency handling. Normal typechecking now includes the architectural
dependency gate and negative contract assertions.

The migration is merged locally into `main`; `refactor/harness-contract` and its
worktree are retained for review and incremental follow-ups. The required
post-merge `mise run check` passed: the architectural dependency gate,
TypeScript (including negative contract assertions) and Rust compilation.

User-authorized offline validation compared the migration to `c7573e6`:
- Docs checks pass (107 Markdown files); the architectural gate and TypeScript,
  including required/negative contract assertions, pass.
- Baseline Node run: **1,373 passed / 45 failed**. Initial migration run:
  **1,429 passed / 45 failed**, with 44 shared failure names and one new
  quarantine-Resume regression. The baseline-only applicability failure was a
  stale error-wording assertion, now aligned with generic target validation.
- After fixes, the full Node rerun has **1,438 passed / 44 failed**; every
  remaining failure name also occurs on the baseline. The aggregate
  `mise run test` remains red and stops at Node; it is not a whole-suite pass.
- Independent review found four P2 issues: existing-row Resume bypassing
  preparation/recovery, a false connection notice from local mount `ready`,
  missing owning sources on retained standalone/embedded tool updates, and
  project-action metadata without an execution port. All four have source fixes
  and targeted regressions; the original eight regression cases fail before
  fixes and pass afterward. A follow-up read-only review confirmed all four
  causal fixes and found no concrete follow-up regression within the inspected
  patches. The expanded targeted group has nine passing cases,
  and the focused registry/view/dependency group passes 33 tests.
- Rust stages were run separately despite the aggregate's early stop. A stale
  `Output` callback fixture prevented test compilation; a shutdown fixture also
  read an empty PID marker before its contents were published. Test-only repairs
  permit **195 Rust tests passed / 2 explicit installed-Pi smokes ignored**.
  No real provider/installed-agent smoke was enabled.
- Formatting remains red in the same 14 source files as the baseline; the
  migration's new draft-fixture formatting delta was fixed. Clippy remains red
  on three unchanged baseline diagnostics (`result_large_err` in SDK/Codex
  supervision and `too_many_arguments` in Codex supervision). No unrelated
  production refactor or warning suppression was made to claim a green gate.

User-led installed-runtime testing remains incremental. No app build/restart,
interactive browser, live CLI/provider request or user-session operation was
performed. Node/jsdom and fixture-process Rust results do not establish wire
compatibility, full feature parity or macOS/Linux native acceptance. [Consumer interfaces](consumer-interfaces.md#enforcement-and-acceptance)
owns the contracts and enforcement scope.

## Integration consumer boundaries

Codex connection startup/identity/cleanup now resides in its concrete owner,
consumed through the existing lifecycle port. Shared frontend/native draft
consumers accept a structural namespaced-key contract rather than enumerating
harnesses. New consumer-path fixtures use the real draft library and dirty-record
writer, an unknown fixture integration through the connection coordinator,
frontend/Rust grammar vectors, Codex startup/failure/retired-token cleanup and
dependency enforcement. These fixtures are authored **unrun**. The required
post-merge `mise run check` passed on `main` after narrowing the optional project
capture in a dedicated fix worktree (TypeScript and Rust compilation only). This
is not behavioral evidence.

This records the earlier first extraction slice, not registration-only integration acceptance. The subsequent registered-consumer migration above supersedes its remaining shell-owner debt; [consumer interfaces](consumer-interfaces.md#implemented-extraction-and-registration-boundary) owns the current source boundary.
No tests, builds, browser/app launch, live CLI handshake/model request or
user-session operations were performed for this slice. Codex native startup,
original EPERM diagnosis, replacement/Close races and macOS/Linux acceptance
remain unverified.

## Codex startup draft binding

The user's 2026-10-24 Codex log (CLI 0.164.0) shows two successful handshake
and thread-creation responses, followed by thread/MCP-startup notifications,
with no model-catalog request. Source inspection identifies the synchronous
frontend draft whitelist rejecting `codex:` scopes before bound identity
publication. The screenshot's bare EPERM could replace this primary error
through cleanup reporting; the trace does not establish which native signal
or exit probe failed. The frontend binding/deletion whitelist is fixed, original
errors and cleanup details are separate, and native group failures now identify
phase/group without weakening observed-exit/reservation semantics.

New real-draft-store/startup/error-correlation fixtures are authored **unrun**.
The required post-merge `mise run check` passed on `main` (TypeScript and Rust
compilation only). Only the existing log and CLI version were inspected; no server connection, prompt, user-session mutation,
build, app launch or actual shutdown was performed for this task. Post-fix
startup and the native EPERM mechanism remain unverified. See [startup contract](../../codex-integration/references/startup.md).

## Codex questions

Experimental protocol opt-in, reviewed non-secret question batches, shared
Copilot/Codex retained question presentation, explicit unsupported-request
notices and raw question/response/error capture are source-implemented. New
parser/client/actual-palette/session-log fixtures are authored **unrun**;
existing Copilot question fixtures were preserved but not rerun. The required
post-merge `mise run check` passed on `main` after the extracted question UI's
source-root import was corrected in a dedicated fix worktree. This checks
TypeScript/Rust compilation only. No tests, app builds/launches, runtime
feature-flag writes, mode changes or live prompts
were performed. Installed-CLI question schema/default-versus-Plan availability,
actual native focus/layout, cancellation timing and persisted capture remain
unverified. The user plans to trigger and share their own interaction traces;
that intent is not acceptance evidence. [Codex questions](../../codex-integration/references/questions.md)
owns capture instructions, scope and policies.

### Async question follow-up extension

Existing user-driven captures from Codex 0.164.0 show completed `agentMessage` async questions followed by normal turn completion. Read-only installed version/help/experimental type generation and matching official source review establish native-client identity/envelope and ordinary-input delivery semantics, not acceptance of Nimrod's new implementation. See [protocol evidence](../../codex-integration/references/protocol-evidence.md#async-question-source-review-01640).

The retained optional picker, Ignore, post-completion answer delivery, ordinary-follow-up retirement and pretty reply projection are source-implemented. New `codex-async-questions`, actual-palette and session fixtures are authored **unrun** for this extension. No tests, live prompts, user-session mutation, app launch or build were performed for the extension. Native macOS/Linux presentation, answer delivery and completion/dismissal timing remain unverified; pre-existing registered-harness fixture results do not cover these new cases.

## Codex answer card presentation

Codex async-answer envelopes now retain native user-message semantics and use the same shared speech-bubble/inset-reply summary primitive as Copilot. Exact raw message disclosure, native-echo/history rendering and retained nodes are source-implemented. New `codex-question-cards` and mounted `conversation-view` assertions are authored **unrun**; existing Copilot card fixtures were preserved but not rerun for the extraction. No tests, app build, browser validation, launch or live prompt was performed. Native visual/focus/scroll acceptance remains pending. [Card contract](card-plugins.md#codex-async-questionanswer-messages) owns scope and invariants.

## Shared question picker presentation

Shared choice bullets, custom-answer pencil, optional Ignore circle-slash and filtered group spacing are source-implemented for Copilot and Codex. New actual-palette assertions in `copilot-questions` and `codex-questions` are authored **unrun** for this presentation change. No tests, browser validation, app build or launch were performed. Native visual/accessibility acceptance on macOS/Linux remains pending; DOM assertions alone would not establish it. [Question row presentation](command-interactions.md#question-row-presentation) owns the contract.

## Codex tree deletion

The shared review now consumes opaque key/parentKey nodes; Pi's native wire
shape stays behind its adapter. The Codex deletion source, exhaustive
source/archive inventory, native affected-writer reservations, post-stop
scope revalidation, one recursive API call and confirmed-only reconciliation
are source-implemented. New planner/operation/client/native-gate and local
not-written RPC fixtures are authored **unrun**; existing review/Pi/Copilot
fixtures were updated but not rerun. The required post-merge TypeScript/Rust
compile check (`mise run check`) passed on `main` for this task. No tests, browser validation, builds,
app launches, real catalog operations or user-session deletion occurred.
Installed-CLI recursive/archived/fork/partial-failure and actual native
window/process acceptance remain pending. See the [Codex deletion contract](../../codex-integration/references/deletion.md).

## Codex integration

The native app-server host, shared consumer adapters, explicit create/Resume,
history/drafts, streaming, text steering/Stop, image input, retained approvals
and result-confirmed model/effort source paths are implemented. New RPC/client,
session/approval and native-record fixtures are authored **unrun**; existing
shell/runtime/draft/Copilot regressions have not been rerun. The required
post-merge `mise run check` passed on `main` for the native integration
(TypeScript and Rust compilation only). This does not establish the new
integration's behavior; no test suite or native acceptance has been run.

Only local CLI 0.162.0 version/help/schema generation and public documentation
were inspected. No app-server connection, authentication change, real session
catalog/load/delete, model request, compaction, app build/launch or native
acceptance was performed. Installed-CLI loaded-thread configuration overrides,
image/history acceptance, approval scope, process-group shutdown/reload and
macOS/Linux native presentation remain unverified; Windows launch is unavailable.
The [Codex integration skill](../../codex-integration/SKILL.md) owns the current
capability matrix, limitations, policy questions and fixture locations.

### Codex shared-daemon connections

Managed local daemon attachment is source-implemented against reviewed Codex 0.169.0 lifecycle/control-socket source. Native fixture CLI/WebSocket tests cover lifecycle decoding, scoped ingress/replies and client-only detach; frontend fixtures cover pending-decision replay/resolution/bounds, catalog setup cancellation and stale-token isolation. Existing shell reload fixtures now qualify Codex's continuing shared work. These fixtures are authored **unrun**; no live daemon/thread probes, provider work, builds or app launch were performed for this implementation. The earlier read-only conflict investigation and user-confirmed idle-unload recovery are not acceptance of the new transport.

Required post-merge `mise run check` **passed on Linux/main** after correcting a new fixture's use of an unsupported TypeScript library method. This includes the harness-boundary gate, `tsc --noEmit` and `cargo check`; Rust reported the existing unused `Arc` import in `src/main.rs`. Rust test modules were not compiled/executed by this command. Installed-runtime and native macOS/Linux attachment, active-stream/history reconciliation, approvals across clients, Close/Reload/window quit, daemon restarts and deletion/unknown-outcome acceptance remain pending. Nimrod's Windows transport remains unavailable. [Daemon contract](../../codex-integration/references/daemon.md) owns behavior and protocol evidence.

### Codex new-session model changes

The model/effort path now uses live `thread/settings/update` rather than saved-rollout Resume, based on targeted experimental schema generation from installed CLI 0.169.0. Client fixtures cover acknowledgement/notification ordering, exact thread/project/value, unsupported methods, disconnect and confirmation timeout; session fixtures cover changing a new thread with missing rollout history and the `/model` path; native fixtures constrain settings to one model/effort field. These new fixtures are authored **unrun**. No live app-server connection, user-session mutation, model request, app build or launch was performed. Installed-runtime notification/application and native macOS/Linux acceptance remain pending.

## Skill disclosures

Pi and Copilot now share the lazy skill renderer and presentation interface.
New/updated parser, shared-renderer, mounted-view and Copilot command fixtures
are authored **unrun**. They cover string/block history, arguments, disclosure
identity/hidden catch-up, echo adoption and command outcome retention. The
user's screenshot establishes Copilot's expanded invocation presentation; local
pinned-runtime strings additionally establish its explicit preamble,
`<skill-context>` wrapper and `ARGUMENTS: ` separator, not native acceptance of
the new renderer. No app
build/launch, model request or user-session operation was performed. Actual
macOS/Linux appearance, interaction and installed-CLI acceptance remain pending.
See the [skill disclosure contract](transcript-cards.md#skill-disclosures).

## Evidence boundaries

**Linux title-bar seam:** the user reports a thin dark line between the native title bar and Project bar. The window-scoped GTK stylesheet now suppresses bottom borders on both the titlebar host and nested HeaderBar, alongside the existing shadow reset. A pure stylesheet regression fixture is authored **unrun**. Native visual confirmation remains pending for focused/backdrop windows, dark/light themes, opaque/translucent backgrounds and Settings/pop-outs. No build or app launch was performed; the mandatory post-merge compile check is separate. [Native title bars](translucency.md#native-title-bars-and-first-presentation) owns the styling boundary.

**Linux shifted punctuation shortcuts:** the user reports Ctrl+Shift+] does not switch sessions. Source inspection found that brace/comma normalization depended on physical key codes; a shared matching/recording fallback now accepts `{`/`}`/`<` only with Ctrl/Cmd+Shift, no Alt, and an empty/Unidentified code. New matcher/recorder/dispatch and real-shell mock-transport fixtures are authored **unrun**, covering canonical aliases, guards/overrides, session cycling, mounted draft retention and unchanged order. No native key event trace was obtained, so this does not establish the user's exact event shape or exclude earlier toolkit/compositor interception. Native GNOME/Wayland shortcut acceptance remains pending; no tests, build or app launch were performed for this task. [Keybindings](keybindings.md) owns the normalization contract.

**Linux disclosure arrows:** the user's screenshot shows transient thin vertical lines beside several closed tool-card arrows. A WebKitGTK clipping/paint artifact is suspected, not reproduced or established as the root cause. Card summaries now paint inline SVG triangles instead of clipping filled squares. New DOM fixtures for all affected shells and retained arrow identity are authored **unrun**; no build or app launch was performed. Native Linux visual confirmation, including streaming, disclosure toggles and zoom, remains pending. See [transcript cards](transcript-cards.md).

**Linux app-menu removal:** Linux skips app-menu construction rather than hiding the bar/retaining accelerators. Registry-backed Open project/Quit/window/About actions replace the removed routes; Ctrl+O/Ctrl+Q work through the shared dispatcher in project/welcome, Settings and reference windows, with normal modal/IME/repeat/conflict/unbinding guards. The native action command binds window actions/chooser parenting to its caller and Quit to existing whole-app shutdown. New registry/dispatch/shell/native allowlist fixtures are authored **unrun**. No build, app launch, native editing/clipboard test or live-agent quit was performed. Native acceptance remains pending for menu absence, palette/shortcut discovery, chooser parenting, About, window lifecycle, Ctrl+A/C/V/X/Z and Ctrl+Shift+Z editing, and multi-window Quit with draft flush/owned-agent shutdown. macOS menu/accelerator regression acceptance remains pending. [Keybindings](keybindings.md#linux-app-menu-replacement) owns the contract.

**Linux native chrome:** the user reports a fully clear menu bar on GNOME/Wayland, followed by a desktop-grey menu bar and title bar after the initial opaque-menu workaround. The replacement feeds window-local theme/opacity and opaque foreground into GTK's existing menu bar and client-side titlebar through the shared tint pipeline; no DE-specific code or new controls. New controller/pipeline/shell and pure Rust stylesheet fixtures are authored **unrun**. The user reports that the theme/opacity change works on GNOME/Wayland: limited native appearance acceptance, not verification of all theme/opacity/window combinations. The user next reported that none of the native titlebar buttons worked, including Settings Close; after the input-routing fix the user confirmed that it works (limited native control acceptance). Tao 0.35.3 configures its titlebar EventBox with `above_child(true)`; the follow-up restores child-first routing only for the expected EventBox/HeaderBar shape during main-thread capabilities preparation, independently of tint success. An isolated-display GTK fixture for routing state, hierarchy preservation, idempotence and unrelated-wrapper isolation is authored **unrun** and ignored by default; it does not exercise real pointer delivery. Native acceptance remains pending for Close/Minimize/Maximize, drag/double-click/resize, dark/light and inherited themes, preview/cancel, opacity 0/50/100, different project-window themes, Settings/pop-outs, focused/backdrop/maximized/fullscreen and provider cleanup. Server-drawn decoration tint and compositor blur are not implemented. No app build/launch or tests were performed for this task; mandatory post-merge compilation is separate. See [native title bars](translucency.md#native-title-bars-and-first-presentation).

**Local Linux build:** `mise run build` succeeded in the Fedora 42 `devbox` distrobox on the Bazzite host, including frontend compilation, optimized Rust executable, Copilot resource staging and adjacent esbuild staging. This is build evidence only; no app/window was launched and native UI, notifications, installed CLI/model integration and direct host execution remain unverified. See [build workflow](build-cache.md).

**Pixel dissolve:** shared-owner mosaic with configurable target size, live per-tile content blur and alpha fading; hard edges remain. Soft rendering uses bounded backdrop-filter tiles plus an inline SVG alpha mask, not form copies. Pure planner, soft-surface cleanup/capability, controller/config/native and offline browser option/alpha/filter/partial-close fixtures are authored **unrun**. Earlier user feedback accepted the sharp dissolve; the soft renderer was then reported to appear smaller until completion. The geometry follow-up normalizes the SVG alpha mask to object-bounding-box units and uses inset-constrained decorative layers; unit coverage and offline browser geometry/edge-pixel regressions at 100/125/150% CSS zoom are authored unrun. This has not yet been reproduced/accepted in native WKWebView. Actual WKWebView/GTK mask rendering, blur appearance, frame cost on large pickers, native zoom, keyboard/focus and accessibility remain unverified. No build/app launch or platform acceptance is claimed. The [modal motion contract](modal-layout.md#modal-motion) owns behavior/schema and fixture locations.

**Idle image Send auto-follow:** the user reports no autoscroll while Pi is idle despite the first image-load source fix. A follow-up preserves settled bottom intent across delayed native scroll delivery after image growth, including when Send's follow frames have already flushed. Requested red/green verification now passes 31 scroll unit tests, 20 focused mounted-view tests and five focused offline WebKit image cases with the patch. Unchanged `f0949e4` fails six of seven Node race checks and the WebKit bottom-follow case with a 293px gap; reader cancellation remains passing. The full Node suite has the same 28 failing test names on patched and unchanged sources (1,144 versus 1,135 passes); `mise run test` therefore stops before Rust formatting/Clippy/tests. The broad browser run reached 108 tests with failures before its 600-second command timeout; no whole-suite pass is claimed. Native macOS/Linux acceptance remains open. No app build/launch or live prompt was performed for this follow-up. See [scroll contract](transcript-interaction.md#scroll-invariants).

**Copilot image input:** the shared `SessionMessageInput` port and SDK inline-blob delivery/live/history presentation are source-implemented. New neutral/controller/production-bridge/native validation, capability-race and offline WebKit isolation/adoption/follow fixtures are authored **unrun**. Installed CLI image-only/model acceptance, live/history attachment-byte resolution, native macOS/Linux clipboard and actual-app scroll behavior remain unverified. No app build/launch, paid prompt, user-session load or deletion was performed. See [image-input contract](image-paste.md#message-input-interface).

**Material-backed blur replacement:** production now uses a cleaned NSVisualEffectView with copied/replaced Gaussian filters, rather than the enable-flashing WindowServer radius setter. The isolated native probe links the production Objective-C helper directly. macOS 27.0.1 runs (basic 782 frames, resize 774, dark/light 754, combined lifecycle 655) captured no grey activation frame; frame/title-bar coverage, 7/20 strengths, sharp removal, single-view ownership, unchanged content/first-responder identity, non-hit-testing, invalid-input rejection and closing-while-blurred cleanup were exercised. Capture can miss frames. The user subsequently directly observed both final standalone AppKit/WKWebView surfaces without flicker toward the end of the probe runs; this is limited fixture visual confirmation, not packaged-app acceptance. The [case study](history/macos-blur-enablement.md) preserves the investigation and implementation record. New JS/native source regression fixtures are authored unrun. Packaged Nimrod fullscreen, all opacity/theme/accessibility combinations, native input/scroll and performance acceptance remain pending; no app build/launch/restart or session access occurred. [Translucency](translucency.md#native-enable-flash-investigation-and-replacement-evidence) owns the current native boundary and evidence.

**Session pinning/native row menus:** saved open-session pins, pinned-first projections, hover/focus Pin/Close controls and OS-rendered row menus are source-implemented. New/updated policy, decoder, shell, native routing and offline WebKit fixtures are authored **unrun**; browser fixtures record native popup intent only. Pin/startup sidebar positioning now prefers list top, otherwise minimum full-row reveal from that origin; unpinning retains ordinary anchoring. New geometry/shell/CSS-zoom browser regressions are authored **unrun**. Actual macOS/Linux menu appearance, right-click/keyboard delivery, dismissal, accessibility, sidebar reveal and DPI/webview-zoom positioning remain unverified. No app build/launch or user-session operation was performed. See [sidebar pinning/menu contract](sidebar-attention.md#pinning-and-native-row-menus).

**Settings slider initial fill:** the user reports missing accent fill until first interaction. Shared authored tracks and `updateRangeFill` now initialize opacity, blur and duration at value load and keep fill synchronized on preview/reload. New helper/controller and offline WebKit pixel fixtures are authored **unrun**. No synthetic input/save/native preview is used to prime the controls. Native WKWebView initial paint, Linux/WebKitGTK and forced-colors/accessibility acceptance remain pending; no build or app launch was performed. See [Range inputs](settings-layout.md#range-inputs).

**Configurable modal motion:** Subtle remains duration-based; CRT/Hologram now use an independent CSS-pixel scan-speed preference with geometry-derived timing. A ResizeObserver retargets from current pixel edges on filter/size changes; revisions prevent retired segments canceling successors. Existing native default/controlled close, inert snapshots, early-microtask capture, focus, None/reduced motion and lifetime handling remain. Pure geometry, controller/config/native and offline browser fixtures for size-dependent time, constant velocity, grow/shrink continuity, asymmetric CRT edges, contextual slider units and live filtering are authored **unrun**. The user previously confirmed actual-app Subtle dismissal and slider fill; this does not validate the new speed/retarget implementation. Native macOS/Linux pixel speed, live-resize smoothness, CSS/native zoom, keyboard/focus and accessibility acceptance remain pending. No build/app launch was performed. See [Modal motion](modal-layout.md#modal-motion).

**Built-in Copilot SDK lacks broad installed-CLI/native acceptance.** SDK 1.0.28 package/source declares CLI 1.0.105 and protocol 3 compatibility; that is source evidence only. Earlier installed-runtime observations below used SDK 1.0.22 / CLI 1.0.98 and have not been repeated for the upgraded pair. SDK browser scenarios and real CLI/history/decisions/tools, owned process-group shutdown, signed packaging and macOS/Linux acceptance remain gaps. Windows SDK launch is unavailable. Earlier ACP/Pi results do not establish SDK acceptance; logging evidence is scoped in [Transcript logging](#transcript-logging).

[Copilot command discovery/invocation](copilot-commands.md) additionally has
unrun metadata/argument, production-bridge, modal/cancellation and shell-output
fixtures. The user reports bare `/permissions` produces the same report as
`/permissions show` in Nimrod, unlike the TUI's bare-command picker. The follow-up
uses advertised argument choices before invocation; revised fixtures model a text
default and cover zero-invocation cancellation. Those fixtures are unrun, and
post-fix installed catalog/command behavior, modal focus and macOS/Linux acceptance
remain unverified. Host-side model and Plan-model effect application/finalization
is source-implemented against the pinned SDK's public experimental transaction;
its new offline fixtures are unrun, and installed-CLI effect completion remains
unverified.

User-observed CLI 1.0.98 traces established that builtin canonical `/model`
(alias `/models`) advertises only a free-form `model` hint; bare invocation and
an exact `gpt-6.1-sol` invocation both returned `completed` without
choices/dialog/effect. The exact invocation emitted no `session.model_change`
and left the Status area on `gpt-5.6-sol`. This is protocol-shape evidence for
the narrow catalog-picker/live-switch adapter, not acceptance of the adapter
itself; its offline fixtures and native focus/effect behavior are unrun.

An isolated provider-free command audit used CLI 1.0.98 with a disposable custom
session filesystem, fail-closed permissions, no prompts and no external/model
work. `/usage`, `/env`, `/list-dirs`, `/permissions show`, `/session info`,
`/session files`, `/session plan` and `/mcp list` returned typed text and emitted
no state events. Sanitized result-shape fixtures are authored and unrun. This is
SDK/CLI protocol evidence, not native rendering/focus/busy acceptance.

A second isolated read-only batch confirmed generic text/Markdown results for
`/session checkpoints`, `/skills list`, `/plugin list`, `/memory show`, `/remote
show`, `/sandbox status`, `/sandbox policy` and no-server `/mcp show`, with no
command-caused state events. `/skills info` instead returned a usage error
requiring `<skill-name>` despite metadata exposing only the `info` choice. The
public `session.skills.list()` adapter and sanitized fixtures are source-authored
and unrun; native nested-picker acceptance remains pending.

An explicitly authorized isolated local-state audit used disposable Copilot
home, project and SessionFS storage. `/rename`, `/memory on/off`, `/skills
reload`, `/permissions default`, `/allow-all on/off`, `/reset-allowed-tools`,
`/sandbox enable/disable` and `/init suppress` used generic results plus
authoritative events/settings where applicable. Bare `/init` returned
`agent-prompt` and was not submitted. `/session rename` exposed a missing
free-form-name interaction; its shared-input adapter and sanitized fixtures are
source-authored and unrun. No user settings/project/session or provider request
was touched.

CLI 1.0.98 evidence shows `/config` is absent from SDK command discovery and
direct invocation returns unknown-command. Public `user.settings.get/set`
provides values/defaults and writes but not the terminal client's structured
path/type/description registry. The source-implemented adapter uses dynamic SDK
keys, a pinned path-only nested supplement, curated public agent-default choices
and confirmed writes. Offline command/bridge/inline-completion fixtures are
authored unrun; native picker, persistence and restart/default acceptance remain
pending.

The `/config` failure follow-up inspected released SDK 1.0.28 source: public
`client.rpc.user.settings` exposes `get/set`, while `validate` is internal.
The adapter now uses only public writes with authoritative readback. Unit and
production-bridge fixtures no longer invent a public validator; new coverage
includes model/provider writes, write rejection, mismatched readback and failed
confirmation without retry. These fixtures are authored **unrun**. The SDK pin,
lockfile and staging guard now target 1.0.28 / CLI 1.0.105. Installed-runtime
command re-audit, native acceptance and packaging remain pending; no app build,
launch, real settings write or provider request was performed.

- TypeScript/jsdom shell tests use mocked native IPC.
- Rust fixture tests use actual pipes, owned subprocesses and generated disposable session files; deletion tests unlink only those fixtures.
- Automated Playwright WebKit exercises real browser layout/events with an offline child fixture and mock Tauri operations. Its CSS zoom is not native WKWebView zoom.
- macOS bundles have been produced and signature-verified historically. Building/signing is not native delivery, focus or lifecycle acceptance.
- No Linux build/native parity or Windows acceptance is established by macOS checks. Windows remains a possible future target.
- Installed-Pi metadata smokes isolate config/projects/history and make no provider requests; they don't establish provider-generated first-save or queue behavior.

## Shared shell-card layout

Pi, Codex and retained ACP shell-card parity adds `test/harness-shell-cards.test.ts` and updates the shared console, external ACP helper and offline console browser fixtures. Coverage includes unlabeled wrapping layout/raw ordering, ANSI cumulative extension, authoritative replacement/history, native Codex exit codes, category isolation, retained nodes/focus/inspection/disclosures and narrow/resize geometry. These fixtures are authored **unrun**. No live harness/provider request, user-session mutation, browser debugging, app build or launch was performed. Native macOS/Linux appearance, output-follow, trackpad and resize acceptance remains pending; compile-only checks are not fixture/native evidence. [Console shell layout](transcript-cards.md#console-style-command-output) owns behavior.

## Copilot running-command cards

The single-view, unlabeled, wrapping command presentation adds `test/copilot-shell-cards.test.ts` and updates the SDK mounted-card and offline browser fixtures. These fixtures are authored **unrun**. No app build/launch, browser debugging, live provider request, command execution or user-session mutation was performed for this task. Native macOS/Linux visual, resize, color and independent-scroll acceptance remains pending. Mandatory post-merge compilation is separate from fixture/native evidence. [Running-command cards](card-plugins.md#copilot-running-command-cards) owns the behavior and code map.

## Copilot command colors

Read-only inspection of existing October 27, 2026 Copilot transcript logs (`copilot-sdk/copilot/2026-10-27.000009.jsonl` and adjacent segments) confirmed ExUnit dots arrive as `tool.shell_output.text` containing `ESC[32m.` while interleaved deprecated `tool.execution_partial_result.partialOutput` snapshots contain plain dots without SGR codes. Across three inspected calls, shell chunks contained 220, 121 and 72 green SGR sequences respectively; their replacement snapshots contained none. The previous reducer merged both sources into one field, repeatedly erasing ANSI state and changing raw-recovery coverage. This is native payload evidence, not visual acceptance of the correction.

The installed pinned SDK's `dist/generated/session-events.d.ts` explicitly deprecates merged partial snapshots in favor of append-only shell chunks; sequence is global across output streams per call, and shell chunks are ephemeral/not replayed to late subscribers. Source now prefers shell output per agent/tool invocation while retaining snapshot-only fallback and independent final results. Synthetic SDK/controller and mounted-card fixtures in `test/copilot-sdk.test.ts` and `test/copilot-sdk-presentation.test.ts` cover both source orders, split ANSI, green dots, duplicate/stale sequences, stdout/stderr ordering, subagent isolation, fallback and terminal precedence. These fixtures are authored **unrun**. No live command/provider request, user-session/log mutation, app build, browser or native visual validation was performed. Mandatory post-merge compilation is separate from tests/native acceptance.

## Copilot patch cards

`test/copilot-patch-cards.test.ts`, including the multi-file-summary/colored-line-count follow-up, is authored but unrun. Payload inspection used existing local October 19 CLI 1.0.98 transcript logs only; no tools/providers were invoked and no user sessions/logs were changed. Native macOS/Linux visual/scroll acceptance remains pending; no app build or launch was performed. The mandatory post-merge `mise run check` is compilation evidence only, not fixture/native acceptance.

## Copilot SQL cards

SQL card visual polish adds compact write-report and sanitized highlighted-query fixtures, including embedded backtick/HTML recovery and retained query/result DOM. These fixtures are authored **unrun**; native visual acceptance remains pending. No app build/launch or live SQL execution was performed.

Read-only, user-authorized inspection of the October 18, 2026 CLI 1.0.98 transcript logs found the screenshot's built-in `sql` start/completion pair and surrounding task creation/final SELECT. This verifies the input/result/telemetry shapes and task bookkeeping in that conversation, not the new UI. A scrubbed pair is retained in `test/fixtures/copilot/sql/`; new `test/copilot-sql-cards.test.ts` DOM fixtures are authored **unrun**. No test suite, live prompt, SQL execution, app build/launch or session/log mutation was performed for this implementation. The mandatory post-merge TypeScript/Rust compile check is separate from automated-test/native acceptance. The [cookbook](../../../../docs/builtin-card-cookbook.md) supplies manual recipes; none was executed here. Native macOS/Linux visual/focus/scroll acceptance and recipe/tool availability remain unverified. [SQL contract](card-plugins.md#copilot-sql-cards).

## Current automated validation

Copilot usage seed experiment: the user reported all dashes after empty startup reads. Untouched fresh sessions now retain display-only zeros across successful empty reads, but not actual errors. Locally valid prompt/command Send or live SDK activity retires remaining zeros before any operation result and fences old metadata; Resume retains the same fetching/reconciliation/rendering path. Window size and Auto compact remain unseeded. Updated pure/controller/offline-browser fixtures are authored **unrun**; no app build/launch, paid request or native visual acceptance was performed for this correction. [Usage policy](copilot-sdk.md#usage-metrics) owns lifetime and the one-point reversal to unknown seeds.

Copilot reconnect context: the user observed restored USD with the context portion missing. The source now requests an independent optional SDK context snapshot on reconnect and preserves `— / —` beside known cost if the runtime reports null/uninitialized context. Fixtures cover no-event Resume, the actual display-window denominator, independent errors, stale/model/live races and retained totals; they are **unrun**. No paid request or live session operation was performed for this correction, and actual cold-reconnect reporting/native acceptance remains unverified. [Usage contract](copilot-sdk.md#usage-metrics) owns the limitation.

**Observed SDK card/permission follow-up:** SDK 1.0.98 captures showed successful GitHub MCP code-search schemas and real failures from legacy `approved` permission replies, plus independent MCP header/rate-limit and missing-skill errors. These establish payload/compatibility evidence, not native acceptance of the fix. The decision-contract correction, compact SDK scopes, native errors, GitHub/skill cards and generation-to-execution identity changes have authored unit/production-bridge/offline-browser fixtures **not run** for this task. Native UI, successful shell behavior and external MCP interoperability remain unverified. A later read-only inspection of the user's transcript logs found 32 `approve-once` decisions with 32 `approved` outcomes in the Plan and Autopilot conversation, including successful tools matching the screenshot. This is observed approval-path evidence, not verification of Deny/Cancel or broader grants.

**Copilot permission interaction/scopes:** a retained sequential command-palette-style picker and nested denial-feedback input replace the previous inline panel. Escape dismisses presentation without answering; a non-dismissable session banner reopens pending choices and stays above separate, non-collapsing deduplicated error banners. Header-only count updates retain selection/operation context and child input. Grant payloads retain exact runtime-reported identifiers. Follow-up inspection of the user's captured shell request found `canOfferSessionApproval:false`, a full invocation in `commands[].identifier`, and shorter parsed `commandSegments` identifiers. Shell/write session grants now require an explicit true capability in both UI options and bridge validation. Shell choices use a short primary label plus parsed-context/exact-scope secondary details, without the unsupported any-arguments claim. Updated pure/retained-picker/production-bridge/offline-browser fixtures are authored **unrun** for this correction; native appearance/capability acceptance remains pending. Managed/sandbox escalation stays one-time only. Generated directory-only and project-location variants are withheld because the captured CLI error lists a narrower accepted decision set. Pure/jsdom, controller, production-bridge and shell fixtures are authored **unrun**. No live permission probes, tests, build or app launch were performed for this task; the mandatory post-merge compile check is separate. Remembered-rule runtime behavior/lifetime, nested-modal focus/close ordering, session/application banner stacking/overflow and translucency in the native app, and macOS/Linux acceptance remain pending. [Permission contract](copilot-sdk.md#permission-choices-and-interaction) owns the scope and lifecycle details.

Copilot usage presentation: aggregate SDK AIC totals/coverage now produce estimated USD with exact credit detail, alongside compact root context utilization. Optional accounting failures/timeouts do not gate chat; no Auto compact state is inferred. New pure/controller/production-bridge/native allowlist, renderer and offline-browser fixtures are **unrun**. Published SDK types/docs and GitHub's $0.01/AIC rate establish source evidence only; actual CLI totals, Resume accounting and native macOS/Linux visuals remain unverified. [Copilot usage](copilot-sdk.md#usage-metrics) owns the contract.

Copilot configured defaults: user-authorized SDK 1.0.22 / CLI 1.0.98 metadata probes verified readable user model/effort preferences, nullable defaults, absent model default-effort metadata and unresolved new-session snapshots before/after catalog reads. Probe session files were isolated through custom filesystem providers; no prompts, settings writes or model switches were performed. New-session honoring of non-null values, lowercase placeholders, Resume isolation and updated resource staging are source-implemented with authored fixtures **unrun**. This is metadata-API evidence, not packaged-app/native behavior acceptance; [Copilot SDK](copilot-sdk.md#send-events-controls-and-decisions) owns the contract.

Session configuration interface/deferred changes: Pi, Copilot SDK and dormant ACP now expose one consumer port for advertised settings, confirmed getters and latest-wins intent. Configuration progress uses one local queued-style shimmering transcript entry and no pending Status-area indicator. New generic/Pi/SDK/ACP/controller, renderer and offline WebKit fixtures are **unrun**; no checks, builds, app launches or live configuration acceptance were performed. [Model/thinking](model-thinking.md#authored-verification-and-remaining-gaps) owns the fixture map and remaining native macOS/Linux gaps.

ACP product-entry-point removal: generic transport/native/session/card adapters
remain internal; creation/options actions, keybinding entries and shell factories
are removed. Regression fixtures assert absent ACP palette/sidebar entries,
concise Copilot labels and inert retired shortcuts. These follow-up changes are
**unrun**: no checks, tests, builds, app launch or user-session mutation.

Copilot shell compilation follow-up: reproduced `npm run build` failing with
TS7022/TS7023 and a downstream TS7006 from the self-referential command-choice
initializer. Explicitly typing the local `CopilotSession` breaks the inference
cycle; `mise exec -- npm run build` now passes TypeScript and Vite production
bundling. Vite reports nonfatal chunk-size/mixed-import warnings. No full
`mise run test`, Rust/native packaging, bundle verification or app launch was
performed for this follow-up; it establishes frontend compilation, not native or
command-behavior acceptance.

Copilot ACP removal and naming cleanup: source/fixtures/docs updated, **no tests,
checks, builds or app launch run**. Copilot now routes only through the SDK;
generic ACP remains runtime-only. Updated shell/card/browser fixtures require
explicitly authorized validation; prior results below do not cover this cleanup.

**Shared deletion coordinator follow-up is unvalidated.** Added fixtures cover a third registered deletion source using unchanged consumer wiring, scoped review ownership, common pending/stop/error/confirmed-success handling, recovery deduplication and unsupported-control explanations. A local initialize-only probe identified installed Copilot **1.0.98** with list/load/close but no deletion capability; local CLI help exposes only `sessions import`, not `sessions delete`. This was an ACP-only capability blocker, not successful history/deletion interoperability. That Copilot ACP path is now removed; the probe does not constrain SDK deletion. No conversation was created/loaded/listed/deleted, no prompt was sent and no app was launched. See [deletion](session-deletion.md#consumer-interface-and-copilot-deletion).

**Latest plugin-revocation/permission-order fixes, Copilot sidebar restoration, saved-history discovery and deletion lack fixture/native acceptance.** New fixtures cover selection during suspended revoking reloads, batched request/update ordering, same-batch cancellation, synchronous request errors, [Copilot sidebar persistence/exact loading](copilot-sdk.md#identity-history-and-drafts), [shared session-list/status plus Pi/Copilot discovery](session-history.md#fixtures-and-remaining-evidence) and [shared deletion operations/Copilot single-session deletion](session-deletion.md#consumer-interface-and-copilot-deletion). These fixtures have not been run; the prior gate results below do not cover them. Packaging/typechecking is separate from behavioral and native acceptance.

Full validation of the shared-view extraction from **`337ff7c`**, with the fixture expectation/Rust-formatting follow-up: `mise run test` passes **798 TS/Node tests**, **154 Rust tests** (2 installed-Pi smokes intentionally ignored), TypeScript compilation, **82-document** link/anchor validation, Rust formatting and Clippy. Full `npm run test:browser` passes **123 offline WebKit tests**. This includes shared-view policy/projection, mode controls, scoped plugin applicability, partial permissions, null patches, rich-content retention, busy configuration and full-duplex/blocked-stdin fixtures. See [harness presentation](harness-presentation.md#regression-guardrails-and-evidence).

The new projection test initially expected a shortened subagent label; its assertion now preserves Pi's unchanged `2 running agents` text. One full browser run failed the external TypeScript plugin local-input assertion after the card collapsed; three focused repetitions and the full rerun passed without changes to that test or production code. This remains an intermittent disclosure/timing caveat, not a claimed fix.

[ACP POC](acp-harnesses.md#current-foundation) coverage includes protocol/session ordering, cancellation/permissions, target-scoped plugins/public shell-helper bundling, independent native pipe ownership and mixed Pi/ACP shell/browser behavior. Browser ACP launches execute the real offline fixture subprocess through mocked Tauri IPC; this does not establish native Tauri window/IPC or installed-agent compatibility. The ACP command's description no longer shadows Pi Resume searches; ranking and Pi lifecycle semantics are unchanged. Five stale Pi browser expectations were independently reproduced on `a3e1919` and corrected to their current contracts (settled result-processing, retained deletion review and no-Send-jump reader intent). Settings-window closing also tolerates the expected WebKit post-close keyup error only after confirmed page closure. No app launch, real Copilot/second-agent startup, paid model work or native/platform acceptance occurred.

Whole-window translucency is now the only translucent mode; the area selector and sidebar-only rendering path are removed. Legacy area values are ignored without settings rewrites. Updated unit/native/shell/offline-browser fixtures are authored but unrun; the restored theme-led primary buttons and this simplification still need packaged macOS visual review, and Linux remains unverified. Earlier both-area fixture results below predate this change. See [Translucency](translucency.md).

Appearance-regression follow-up: TypeScript compilation and Rust formatting/Clippy pass; 71 targeted appearance/presentation/theme/preferences tests, 8 offline WebKit translucency/theme/Settings/pop-out tests and 144 Rust tests pass (2 installed-Pi smokes intentionally ignored). Browser evidence uses mock native material, title and Settings ownership—not a native app launch, macOS visual acceptance or Linux verification.

90%-density follow-up: TypeScript compilation, 20 focused button/appearance tests and 8 offline WebKit modal-layout/translucency tests pass. Contrast is now a lower bound on the eased role curve, not the base of a second ramp; dark Nimrod's normal fill at 90% is ~65% rather than ~80%. Independent legacy-fill comparison covers dark/light system schemes, multiple palettes, both areas and normal/hover states. This covers all palette contrast bounds with known parent tint, composited density, all six shared shells and opaque/sidebar-only/simulated reduced-transparency fallbacks. No native app acceptance/build/launch is implied.

## Native observations retained

| Area | Evidence | Boundary |
| --- | --- | --- |
| Performance, packaged macOS aarch64 | User reported snappy input/scrolling under high CPU load after unchanged bookkeeping-write suppression; supplied reports show ~59 callbacks/sec after focus and 5 ms median keyboard-event delay | Limited observational comparison, not controlled A/B, actual compositor FPS or a proven sole root cause; see [performance observation](#performance-observation) |
| Translucency hierarchy, macOS user trial | User reported “Much better” after continuous surface-density changes; supplied screenshot shows remaining cold-Settings flash and brown-looking native title bar | Limited visual feedback, not full slider/theme/native-material acceptance. The new first-reveal/title-tint fixes are not yet accepted. |
| Zoom | User confirmed the initial zoom improvement | Not every resize/5K/native input case |
| Card plugins, macOS declarative baseline | User restarted the built baseline and reported existing cards/requested-edit previews look good | Not the full executable API/action acceptance matrix |
| Pi Web Access external plugin, macOS | User reloaded the fixed personal TS source and confirmed a fresh code-heavy live web search stays visible; native trace plus offline regression identified escaped absolute Copy-status overflow | Limited reload/rendering/containment acceptance; not all host actions, cache performance or Linux/possible Windows parity |
| Images, idle Send | User reported an ordinary idle text/image submission appearing twice, with a trailing preview following assistant output | Normalization mismatch reproduced locally; started-preflight correlation is fixture-verified, not yet native-accepted |
| Deletion review | User accepted tree presentation and fast-preview transition | Not external-writer, partial-failure or cross-window acceptance |
| macOS notifications, 27.0.1 | Signed tests reached Notification Center; Persistent style made foreground test alerts visible | Temporary presentation inconsistent; cause unproven; not all event types or click routing |

Detailed provenance is retained in [history](history/verification.md#evidence-boundaries), [deletion acceptance](history/verification.md#native-deletion-integration-with-current-main) and [notification acceptance](history/verification.md#native-macos-foreground-presentation-acceptance).

## Performance observation

The user supplied five local reports from the release app on macOS aarch64, with native webview runtime `22625.1.29.11.28`, 125% zoom and reported device pixel ratio 2.5. After unchanged bookkeeping-write suppression (implementation commit `683f890`), the user reported CPU usage still near saturation while typing and scrolling felt snappy. A later capture recorded milder sluggishness with much more background presentation activity.

| Report context | Callback cadence | Keyboard-event delay, median / p95 | Input to next callback, median / p95 |
| --- | --- | --- | --- |
| Two initial sluggish captures under reported load | ~21–22/sec | 32–46 / 60–227 ms | 41–45 / 50–54 ms |
| Snappy baseline after restart with fewer connected sessions | ~57/sec overall; ~60/sec once settled | 5 / 21 ms | 9 / 15 ms |
| Post-change snappy capture under reported load | ~57/sec overall; ~59/sec in fully post-focus intervals | 5 / 19 ms | 14 / 16 ms |
| Subsequent mildly sluggish capture | ~51/sec over retained samples | 13 / 57 ms | 6 / 37 ms |

The post-change snappy capture contains 507 keyboard-event samples and 482 composer-input samples, all after its focus marker. Earlier severe frame/timer delays cluster just before focus; background throttling is plausible, not independently established. The subsequent mildly sluggish capture retained ~45 seconds after reaching its sample cap, with 451 hidden transcript paints (~1.3 seconds of measured render work), versus one hidden paint in the prior snappy capture. Keyboard-event delay peaked at 108 ms. This motivates further work on background presentation but does not prove that hidden painting caused the delay.

Captures measure JavaScript callback/event timings, not actual screen presentation or complete OS input latency. CPU utilization is user-reported, not sampled by the diagnostics; no CPU level was independently established for the later mild-slowdown capture. Session/restart state and snapshot traffic also differ, so the reports support improvement plus remaining opportunities without proving the persistence change was the sole cause or fixed every workload. Reports lack a unique source-build revision; association with the change comes from the user's trial context.

Source report basenames (local files, not checked into this repository; retention can remove them): `performance-1791845785765-20e63c54-c498-4306-92c8-e4be79df7a7d.json`, `performance-1791846158357-09285147-3967-4310-8d11-f8bea3c20c57.json`, `performance-1791847944819-41ce150a-166d-4ceb-9b87-7bd041cbdff9.json`, `performance-1791851420259-c11186de-3d45-4b70-a48c-cd5e3bd5837e.json`, and `performance-1791854360847-b76ded30-bc5e-4ee5-b69e-bcbc12619c08.json`.

[Preferences](preferences.md#unchanged-bookkeeping-writes) owns the implemented optimization and avoided-work fixtures. [Performance diagnostics](performance-diagnostics.md) owns timing semantics/privacy; the [performance optimizations catalogue](../../performance-optimizations/SKILL.md) records completed work and deferred candidates. Instrumentation overhead, broader session/history scaling, native engine/scheduler attribution and Linux/possible Windows behavior remain unverified. These captures predate hidden-paint suppression and do not measure its effect. Hidden-paint suppression is now implemented with regression coverage added but not run; native responsiveness/reveal-latency acceptance is pending. See the [optimization reference](../../performance-optimizations/references/hidden-session-painting.md). No priority, worker or separate-webview change was made.

Incremental streaming now adds indexed tool updates, dirty-row presentation, append-only text/ANSI rendering and affected-output scroll batching. Its new unit/DOM/shell/offline-browser fixtures, including the review-fix differential lifecycle and mixed-helper/custom-DOM raw-recovery cases, have not been run; there is no native before/after responsiveness claim. Existing reports do not establish its effect. Remaining cumulative Pi-JSON/rendered-prefix costs, immutable array pointer copies and fallback/Markdown work are detailed in the [incremental rendering reference](../../performance-optimizations/references/incremental-transcript.md).

## Copilot Plan and Autopilot

On October 19, 2026 (macOS, local CDT), the user reported selecting **Continue
with Autopilot**, seeing **Autopilot** in Nimrod's Status area, and apparent
ongoing execution. Read-only inspection of the existing CLI **1.0.100** trace
(`2026-10-20.jsonl`, UTC date) corroborated an approved `autopilot` decision at
04:59:40.964Z, `exit_plan_mode.completed` with `approved:true`, an authoritative
Plan → Autopilot `session.mode_changed`, and successful exit-plan tool completion.
This is native user-observed acceptance of the ordinary approval/mode-display
handoff and initial continuation, not completed-task acceptance. No new agent
prompt, session mutation, build or launch was performed by this investigation.

A later user report showed **Task complete** while Nimrod remained Working.
Read-only inspection of `2026-10-20.000001.jsonl` found successful `task_complete`,
root `session.task_complete` with `success:true` (native 05:16:59.794Z),
`assistant.turn_end`, `assistant.idle`, then root `session.idle` with
`mode:"autopilot"` (native 05:16:59.870Z). No later model/tool work appeared in that
capture. The old controller and bridge ignored this final idle solely because
of the sticky mode. A scrubbed sequence is retained in
`test/fixtures/copilot/autopilot-completion.json`. The correction pairs live-root
accepted completion with subsequent idle in both layers and uses its summary
when no final assistant response follows. Updated `test/copilot-sdk.test.ts`,
`test/copilot-bridge.test.ts` and the offline SDK fixture cover this sequence,
intermediate/rejected/stale completion, duplicate IDs/events, new work/prompts,
child/replay isolation, deferred configuration, idle-only bridge commands, Stop,
errors and notification deduplication/content. These new regressions are authored
**unrun**; native acceptance of the correction remains pending. No paid request,
live session mutation, app launch or build was performed for the fix.

The retained Plan review picker/banner and compact completed card are subsequent
source changes, not the UI the user accepted. `test/copilot-plans.test.ts`,
`test/copilot-plan-cards.test.ts` and revised shell coverage are authored **unrun**.
Their native visual/keyboard/feedback/dismissal acceptance on macOS and Linux
remains pending. The mandatory post-merge compile check is compilation evidence
only. Distinct planning/execution models, restoration/compaction confirmation,
Interactive handoff, revision loops, sticky-mode terminal ordering, limits and
Stop remain unaccepted. Continue using the
[mode acceptance skill](../../copilot-mode-acceptance/SKILL.md) for the remaining
matrix; do not treat this handoff as full Plan/Autopilot support.

## Pi codemode groups

Grouped Pi codemode cards are source-implemented. Authored fixtures in `test/codemode-groups.test.ts`, `test/native-view.test.ts`, `test/builtin-tool-plugins.test.ts`, `test/tool-card.test.ts` and `test/browser/codemode-groups.spec.ts` cover explicit relationships, adoption/history, bounded/missing records, independent parent/child output, child failures, dynamic progress, coalesced/hidden/gapped delivery, reset and retained DOM/disclosures/focus. Follow-up authored fixtures additionally cover normal saved-child cards/themed dots, absent-data silence, personal overrides, unchanged-record renderer suppression, saved-to-live shell adoption and plugin disposal. These fixtures have **not been run** for this change. Native visual/disclosure/scroll acceptance on macOS/Linux remains pending; no platform acceptance follows from authored jsdom/browser fixtures.

## Transcript logging

Before this correction, the CLI 1.0.100 trace above showed native completion at
05:16:59.794Z reaching frontend capture at 05:25:00.499Z—about eight minutes later.
Receipt spacing through the drained tail was often around 20–40 ms per record.
Source inspection identified per-packet log-flush/acknowledgement flow control as
a serialization point; this did not separately measure disk, IPC or rendering
cost. The former warning observed individual native writes waiting at least one
second rather than accumulated delivery age, so many shorter waits could escape
that signal.

The best-effort correction removes diagnostic delivery barriers/pre-send flushes
from Pi/SDK/ACP and history connections, uses bounded timed frontend batching and
nonblocking native MPSC admission, and reports whole-record loss/asynchronous
writer failures without affecting sessions. Authored **unrun** regressions cover
blocked logging with independent Pi event/request delivery and SDK Send/decision/
Stop/settlement, frontend/native overflow, sequence gaps and loss counts, active
byte accounting, accepted FIFO order/no retry, and stale capture error isolation.
Existing storage/rotation/privacy and setting-migration fixtures remain separate.
No tests, build, app launch or live provider/session operation was performed for
this correction; mandatory post-merge compilation is not native acceptance.

Remaining macOS/Linux acceptance: actual high-rate native traffic without the old
lag; overflow warning/counts and unchanged session behavior during slow/failed
storage; asynchronous window/segment-scoped error delivery; global setting
synchronization; large-event/replay snapshot overhead; multi-window/process
writes; recovery and shutdown tails. Windows behavior is unverified.
[Transcript logging](transcript-logs.md#queue-best-effort-delivery-and-failures)
owns the current contract and fixture locations.

## Inline argument completion

The configurable global/project acceptance preference is source-implemented with
Tab only as the default. New/updated frontend, native validation, keyboard and
scoped Settings fixtures are authored but unrun; no app build, launch, paid
prompt or native acceptance was performed. Existing pane/draft/session ownership
is retained; native Settings synchronization and keyboard acceptance remain
pending. [Settings](settings-layout.md) and [composer](composer.md#shared-slash-completion)
own the current contracts.

Inline argument hints and prefix/Tab completions are source-implemented using
harness metadata; no native app launch, build, paid prompt or test execution was
performed for this task. New jsdom fixtures cover keyboard/lifecycle guards,
non-draft ghost content, mirror scrolling and observer cleanup. An authored
offline WebKit fixture covers proportional typography, wrapped/scrolling prefix
alignment and no command/provider invocation. These fixtures are **unrun**.
Native macOS visual/keyboard/accessibility acceptance and Linux/WebKitGTK
acceptance remain pending. The [composer contract](composer.md#shared-slash-completion)
owns implementation details and the fixture map.

## Remaining acceptance by area

| Area | User/platform checks still needed |
| --- | --- |
| ACP POC | Compact command-permission previews and their new unit/shell/browser fixtures are source-implemented but unvalidated; native wrapping, code viewport, raw disclosure, button/focus and cancellation acceptance remain pending. Installed Copilot and second-agent interoperability, list/load/delete capability/schema and cross-process history discovery/pagination, exact saved-sidebar loading/replay/draft recovery across process restarts, packaged Tauri IPC/window/permission/focus/shutdown behavior, platform-specific launch discovery; offline fixtures are not native app acceptance. Copilot Resume discovery and advertised single-session deletion are source-implemented but unvalidated; custom history/attachments/login/client services remain unimplemented. |
| Projects/startup | Finder runtime discovery, rapid cold/warm CLI forwarding, minimized-window focus, native window cycling and pop-out ownership |
| Drafts | Native typing feel, Close/Quit flush and crash/reload limits; [storage specification](native-drafts.md) |
| Sessions | Real first-save/exact-file resume, Close/Reload cancellation and failure, independent multi-window shutdown, no replay |
| Deletion | Working-session deletion and retained stopping/removal modal are implemented with new/updated fixtures, not yet run. User reported needing two deletion attempts; review-time fingerprint/report rejection paths were removed, but that live case is not reproduced or native-accepted. Native multi-window shutdown/expanding descendant locks, partial filesystem failure recovery and external mutation limits remain unverified. [Specification](session-deletion.md) |
| Transcript/sidebar | Native zoom/trackpad/keyboard, follow/pause, disclosure animation, narrow/ultrawide geometry and view selection |
| Executable card plugins | The user reports Copilot cards look much better (limited visual feedback, not comprehensive native acceptance). Project-relative/path-then-line-range previews, cited web-search/fetch cards, compact fetch permissions and their new unit/offline-browser fixtures remain unvalidated; native boundary/outside-path display, raw recovery, focus/reader positions and output rendering await acceptance. Broader compiler packaging/cold-warm cache, trust/load failure, custom DOM/focus/reading and host-action matrices; Linux delivery. User-confirmed macOS Pi Web Access reload/rendering/containment is limited evidence, not general plugin/platform parity. |
| Error presentation | Native macOS scoped-notice visuals, reader/focus preservation, announcements, dialog layering and page zoom; Linux/WebKitGTK remains unverified. Offline fixtures are not native acceptance. |
| Transcript debug logs | See [Transcript logging](#transcript-logging) for current evidence and acceptance gaps; [specification](transcript-logs.md). |
| MCP inspector | Native macOS appearance/focus, installed-Pi status compatibility, busy-session inspection and cancellation; fixtures added but not run. Linux behavior unverified. [Inspector specification](mcp-inspector.md) |
| Settings/keybindings/themes | Native menus, alternative keyboard layouts, file chooser, live import/preview focus and cross-window preferences |
| Translucency | Material-backed adjustable macOS blur replaces the grey-flashing WindowServer setter; zero removes the owned effect, and CSS/title tint remain independent. Production-helper native fixture runs cover activation, numeric strength/removal, full-frame/title-bar placement, resize, dark/light changes and close cleanup without a captured grey flash. New window/request-scoped async-failure and source fixtures are unrun. Packaged app opacity/theme/accessibility, fullscreen/minimization, input/scroll and streaming acceptance remain pending. Earlier user acceptance of surface hierarchy/corners is limited evidence, not blanket acceptance of the replacement. Linux native/compositor behavior remains unverified. [Specification](translucency.md) |
| Images | Native macOS screenshot paste, Linux/Wayland clipboard, reload/quota and real Pi image normalization |
| Pop-outs/window state | Quit/relaunch persistence, automatic versus explicit focus, own-window Close, minimization and multi-display/DPI geometry |
| Notifications | Native macOS session click, real input/failure delivery, Linux compilation/delivery/action/Wayland focus; Windows delivery remains unverified |

Use current [user guides](../../../../docs/README.md) for available actions. There is no app demo launcher or arbitrary session-file picker. Native testing with live Pi/models, notifications, user-session mutation or the user's app requires explicit authorization; offline fixtures remain automated tests only.

## Recording evidence

Repository-required merge validation is owned by `AGENTS.md`. Requested broader validation uses `mise run test`; scrolling validation also includes offline `npm run test:browser`. Build only when explicitly requested, following [publication policy](build-cache.md). Do not launch/quit/restart the user's app automatically.

Keep current test coverage and outstanding acceptance in the relevant feature reference. Update this matrix only when native evidence changes. Significant regression investigations may be archived under `history/` with source revision/platform, actual scope and explicit supersession; avoid adding every intermediate run/test count to living specifications.

## Translucent Subtle motion feedback

Linux user feedback on the steady-blur experiment (`b0ca96a`): opening became smooth, but closing appeared worse. The follow-up preserves the entrance CSS and restores the previous exit opacity fade instead of fading backdrop color with full-strength blur until cleanup. Follow-up native closing acceptance remains pending; this is user visual feedback, not measured renderer attribution or macOS acceptance.
