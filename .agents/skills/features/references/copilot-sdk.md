# Built-in Copilot: official SDK

**Status: implemented source, authored offline fixtures unrun.** No tests, checks,
builds, app launches, real session loads/deletions or paid prompts were performed
for this migration. Native macOS acceptance, Linux acceptance, packaging/signing
and installed-CLI behavioral compatibility remain pending. Source/package
compatibility evidence is not native acceptance.

## Decision and released evidence

Curated harnesses use their best supported bespoke interface: Pi native RPC and
Copilot SDK. Generic ACP is a separate capability-driven fallback, not the
mandatory internal protocol. Built-in creation is **New Copilot session**;
**New session** and its shortcuts remain Pi-default. No universal controller,
duplicated transcript/composer/navigation engine, or SDK-to-ACP/Pi event adapter.

The exact npm dependency is `@github/copilot-sdk@1.0.22`. Its released
`package.json` declares `copilotCliVersion` and `copilotRuntime.version` **1.0.98**,
matching the installed CLI version previously inspected. Its engine range is
`^20.19.0 || >=22.12.0` (Node 21 is unsupported); mise pins Node 25.9.0.
The released SDK speaks protocol 3, minimum 3; this is **not ACP protocol 1**.

Evidence: [released package](https://www.npmjs.com/package/@github/copilot-sdk/v/1.0.22),
[npm tarball](https://registry.npmjs.org/@github/copilot-sdk/-/copilot-sdk-1.0.22.tgz).
Inspect that release's `dist/types.d.ts`, `client.js`, `session.js`,
`generated/rpc.d.ts` and `generated/session-events.d.ts` when changing this
boundary; repository main documentation can describe unreleased interfaces.

`CopilotClient({connection: RuntimeConnection.forStdio({path: absoluteUserCli}),
workingDirectory, useLoggedInUser:true, mode:'copilot-cli'})` is the released
explicit executable API. SDK default transport otherwise selects its bundled
runtime. Nimrod does not use that fallback, older `cliPath/useStdio` examples,
in-process execution, an existing user's server or a user-installed SDK.
The SDK launches the selected CLI with `--headless --no-auto-update --stdio`.
Nimrod leaves authentication to the installed CLI; no tokens enter settings.

## Distribution and native ownership

- `copilot/bridge.mjs` imports the bundled official SDK, its concrete
  `copilot/configuration.mjs` adapter and the shared UI/bridge decision-scope
  validator `copilot/permissions.mjs`. Those modules are staged
  checkout-locally, watched by `build.rs` and required by the bundle verifier.
  The bridge's JSON-line
  records are private Nimrod IPC, **not another harness protocol**.
- `scripts/prepare-copilot.mjs`, called by `src-tauri/build.rs`, stages the bridge,
  SDK dist/package metadata and required dependency packages into ignored
  `src-tauri/resources/copilot/`. It excludes every optional SDK CLI runtime
  package. User installation/authentication of CLI 1.0.98 and a supported Node
  remain prerequisites. SDK upgrades require deliberate source/API review.
- SDK imports `koffi` eagerly even for stdio; ship it and its matching
  `@koromix/koffi-<platform>-<arch>` native dependency, plus zod/vscode-jsonrpc.
  Native files are signed during requested macOS staging.
  Staging requires a native same-platform/architecture build and rejects an
  incompatible target rather than shipping the host native package. The bundle verifier
  checks SDK resources, absence of CLI packages and nested native signatures.
  [Build cache](build-cache.md) owns publication; no app build occurred here.
- `src-tauri/src/copilot.rs` owns one bridge per window/token, with a dedicated
  Unix process group inherited by the SDK-created CLI. It resolves Node and
  Copilot paths before spawn, supplies the exact project, prepends their
  directories to PATH and reserves the token before another start can race.
- Stop drains stdout/stderr while the writer runs, requests scoped termination,
  escalates only that owned group, and observes exit. Failed exit retains the
  reservation and child for an explicit later stop retry; supervision failure
  without retained ownership remains blocked rather than claiming success.
  No OS-wide scans, external-writer exclusion claims or name-based kills.
- Reload rotates a native window generation before cleanup, and individual Stop
  retires its window/token before a delayed launch can spawn. No one window's
  teardown holds the global start gate while waiting for children. EOF asks the
  bridge to disconnect/stop the SDK; a physical `stopped` record acknowledges
  clean SDK teardown. Bounded fallback signals only the inherited owned group.
  The leader remains unreaped until the last signal, preventing PGID reuse.
  After reaping, failed-stop retries only observe exit and never re-signal a
  potentially recycled group ID. Periodic public SDK `ping` detects CLI failure
  without creating/reconnecting a runtime or issuing provider work.
- macOS/Linux share the Unix design; neither was exercised for SDK acceptance.
  Windows SDK launch is explicitly unavailable pending process-tree ownership.
  Startup/reload cleanup failures disable SDK creation, not Pi or generic ACP.

## Identity, history and drafts

SDK persistence is `{kind:'copilot-sdk',sessionId}` and the project-scoped key
and native draft scope are `copilot-sdk:<JSON-encoded opaque ID>`.
The SDK owns conversation files. Nimrod stores only sidebar membership, title,
recency/selection and its separate draft. Discovery association is
`nimrod.history.copilot-sdk.v1:<canonical cwd>`; it survives closing all rows.

Opening/restoring a project never prompts a conversation. Its restored selected
Copilot row reconnects automatically; restored background rows remain disconnected.
Associated projects can also start one **discovery-only** SDK client. `listSessions`
does not load history; exact `context.workingDirectory` and nonremote membership
are checked independently of the server filter. Dates are serialized SDK Dates,
not invented user-message timestamps. Pi/Copilot sources publish independently
through the existing shared history picker; Refresh is explicit.

Selecting a saved ID, including startup restoration of the last selection,
mounts/activates its existing shell and draft immediately,
then verifies fresh project membership and calls `resumeSession` on that **exact
ID**, with `allowTranscriptRecovery:false` and `continuePendingWork:false`.
There is no automatic repair, pending-work continuation, new-session fallback,
prompt replay, replay alert or selection/result-driven recency update.
Creation uses `createSession({name:'Copilot session',...})`, making the identity
durable without sending a paid prompt.
The bridge publishes the authoritative identity before reading mode, transcript
or model metadata, so later setup failure cannot lose an already-created ID.

### Removed earlier integration

Copilot's ACP preset, saved identity variant, history/deletion sources and shell
routing are removed. Old `{kind:'acp',profile:'copilot',sessionId}` records and
history associations are ignored, never reinterpreted as SDK identities.
Old native draft files remain readable by the storage layer but are not bound,
staged, migrated or deleted by current Copilot sessions. Normal layout saves
contain only current supported identities. Agent-owned history is untouched.

Visible harness labels are **Copilot** in the Project bar, sidebar and history;
transport tags remain `copilot-sdk` for storage/API compatibility.
**New Copilot session** has the concise hint **Start a Copilot session**.
Generic ACP protocol/adapters are retained internally without a Copilot preset,
creation/options actions or keybinding entries.

## Send, events, controls and decisions

`src/copilot/session.ts` projects real SDK semantic events directly to existing
presentation records. Stable SDK message/reasoning IDs and namespaced agent/tool
IDs retain mounted cards; event IDs deduplicate replay/live overlap.
The controller replaces the shared view's permissive `messages` field with
`DisplayMessage[]`, retaining required stable keys through immutable updates.
Final content supersedes deltas. Tool-input deltas create one agent/tool-ID-keyed generation row, accumulating only raw input text; complete execution arguments supersede them and late fragments cannot rewind execution. Late start metadata may fill inputs/names without rewinding a terminal result. Idle/Stop finalizes unstarted generation as interrupted. Tool-native snapshots and authoritative input subtrees use the existing detached immutable branding so later output/model updates do not recopy or reparse unchanged rich results. Tool partial results are replacement snapshots,
shell-output events append with monotonic sequence deduplication, and terminal
results cannot rewind to progress.
Rich result metadata and unsupported saved attachments remain literal JSON. Supported inline image blobs render as images in live and restored user turns; unavailable/omitted blobs have explicit metadata fallback. The [message-input contract](image-paste.md#message-input-interface) owns capabilities, local draft/preview behavior and evidence.
History replay finalizes interrupted reasoning/tools without capturing or alerting.

Text/image Send clears/previews immediately through shared submission receipts (images after local byte preparation);
the SDK user echo adopts that key. `send({prompt,mode:'immediate'})` acceptance is
not turn completion: `session.idle` ends work. Busy Enter keeps the newer draft,
with no invented steer/queue. Stop calls `abort`; it is not Close/Delete.
Ambiguous writes/timeouts/results disconnect and retain identity/newer drafts;
there is no automatic replay or restoring the submitted text.

New sessions read `client.rpc.user.settings.get()` through the concrete bridge
configuration adapter (`copilot/configuration.mjs`). Its `settings.model.value`
and `settings.effortLevel.value` are effective Copilot user preferences, not the
metadata's registered `default` fields. Non-null strings are passed independently
to `createSession` as `model` / `reasoningEffort`; null or missing values omit the
corresponding key. No Nimrod preference, hard-coded model/effort, catalog-order
inference, settings write, prompt or post-creation model switch is introduced.
Malformed settings/read failure fail before creating a session through the existing
owned startup notice path, rather than silently choosing a different default.

Exact-ID Resume never probes or applies current user defaults. The first new-session
configuration snapshot prefers concrete `getCurrent()` values, filling only
unreported values with inputs accepted by successful creation. If the runtime
reports a different model, effort configured for the requested model is not
attached to it. Subsequent configuration results/root events fully replace this
initial state, including deselection/unset values; creation defaults are never
reapplied. Buffered event/history ordering remains unchanged. The shared
`SessionConfiguration` getters and Status-area projection consume those values;
the shell/renderer do not query the SDK or interpret its settings.

Unknown values use independent lowercase **`default model`** / **`default effort`**
labels. When the model is unresolved, show the effort value/placeholder disabled
until actual supported effort choices are known. A known non-reasoning model
still omits the unsupported effort control. Reported values retain their exact
SDK IDs/effort strings, without case coercion.

User-authorized metadata probes against SDK 1.0.22 / CLI 1.0.98 established that
user settings can return a concrete model with null effort, model metadata can
omit `defaultReasoningEffort`, and a fresh session's `getCurrent()` can stay `{}`
both before and after `session.model.list()`. Probe sessions used custom isolated
filesystem storage and no prompts, model selections or settings writes. Listing
models must not be treated as resolving a selection; the old fixture assumption
has been removed, along with the redundant startup session-catalog read. These
probes establish API/data-shape evidence, not acceptance of the new app behavior.
New/updated default-reading, null-label, authoritative-override and Resume fixtures
are **unrun**; native macOS/Linux/new-session acceptance remains pending.

Models come from client `listModels`; disabled-policy models are excluded. Thinking
efforts come only from the selected or pending target model's catalog. The
session-bound [configuration port](model-thinking.md) accepts latest-wins intent
during work/configuration/commands, publishes one local shimmering transcript
entry and defers mutation until real root idle. The Status area stays on
confirmed selections, without pending indicators. The native `write_copilot`
validator accepts the same private `{method:'configure', setting, value}` shape
as the controller and Node bridge: setting is one of `model`, `effort`, `mode`,
`context-tier`, and value is a string. It rejects the obsolete top-level `model`
payload and malformed/unsupported settings before writing. Regression fixtures
in `src-tauri/src/copilot_tests.rs` cover all four settings and invalid shapes;
these new fixtures are authored but unrun. This corrects native rejection that
previously disconnected idle sessions before configuration reached Copilot.
Disconnection cancels intent;
there is no durable queue or replay. Idle-only `setModel` and
the pinned release's experimental `session.rpc.model.getCurrent()` read actual
model/effort state; later native events outrank older results. Failed configuration
disconnects instead of continuing with unconfirmed settings. No synthetic Pi
slash aliases to Nimrod actions, ACP mode selectors, Restart,
MCP inspector or other unsupported controls. [Copilot slash commands](copilot-commands.md)
use the released SDK's public experimental command discovery/invocation APIs,
argument metadata and typed results; authored fixtures are unrun. Returned choices
reuse the shared modal lifecycle, not app-action dispatch. Model and Plan-model
effects use the public experimental finalizer after their typed host work;
mutation or finalization uncertainty disconnects for authoritative recovery.
Scoped model-picker metadata is returned to the originating command, while model
enabling and non-model dialog kinds remain unsupported.
The bridge reads and changes the pinned SDK session mode through
`session.rpc.mode.get/set`, supporting **Interactive**, **Plan** and
**Autopilot** without replacing the session or sending a prompt. Plan exit
requests use the owning conversation’s decision surface; background requests do
not navigate or focus. Mode changes reconcile through native events and the
configuration snapshot. A mode result requiring unsupported model confirmation,
deferred implementation or automatic continuation disconnects explicitly after
the mutation rather than guessing or replaying follow-on work. Root
error/idle/configuration events cannot be inferred
from a child-agent event. Child transcript rows carry an explicit origin label.
[Usage metrics](#usage-metrics) expose reported context and SDK aggregate AI-credit
accounting with an estimated USD equivalent; no invented costs/queue capabilities.

The same configuration snapshot retains the SDK `contextTier`. Supported models
offer Default/Long context through **Select context window…**; the reported
context limit is the Status-area action target. Default-tier choice details use
observations keyed to the target model; Long context uses that model's advertised
catalog maximum, never a transient usage budget learned under a new tier.
Configuration dispatch fences prior context reads and clears measured context.
During mutation, root usage observations are ignored and metadata RPCs are
suppressed: native model events can precede the runtime's committed context
budget. Settlement invalidates again and requests fresh metadata even when a
native event outranked the configuration result. Unknown context remains unknown
until reported; the catalog maximum is picker detail, never a Status-area guess.

`onEvent` is registered before SDK create/resume so early events are buffered.
Permission and user-input callbacks await explicit choices inside their owning
conversation. Permissions and questions use concrete FIFO interactions in the
shared modal system, with separate SDK response semantics. Plan continuations
retain the shared mounted decision surface and their existing native choices/cancellation.

### Questions and custom answers

Agent questions implement the shared [dismiss-and-resume workflow](dismiss-and-resume.md), with SDK user-input semantics retained below.

`src/copilot/question-interaction.ts` owns a session/connection-bound FIFO of SDK
user-input callbacks. The **Question picker** uses `startRetainedSelection`, the
same shared palette lifecycle as permissions, not an inline form above the
composer. The question is the context above searchable literal SDK choices;
choosing one returns `{answer: choice, wasFreeform:false}` without rewriting it.
When `allowFreeform !== false`, **Enter your own answer…** opens `Dialogs.input`
above the unchanged picker, with the question as title and **Submit answer**.
Submitting non-whitespace text returns the exact input with `wasFreeform:true`.
Blank input reports a session-owned notice and keeps the question pending.
Cancel/Escape in the child returns to the same picker/filter without answering.

The queue follows permission presentation rules: oldest first, **N more** or
**Last question**, one shell through sequential answers, and count-only updates
on arrivals that retain query/selection/context and any child input. Escape/native
parent dismissal does not answer or cancel the SDK turn. A non-dismissable neutral
**Waiting for input · N questions** session banner with **Answer question** reopens
it. New arrivals do not reopen explicit dismissal. Existing dialogs keep priority;
background sessions never summon a modal or navigate. Explicit session navigation
suspends/reveals undismissed work, never answers. Permissions and questions have
separate queues/banners; neither replaces the other's active picker.

Stop/Close/disconnect retire the owning AbortSignal and close owned picker/child
input; there is no ambiguous **Cancel request** question choice. Generation,
entry, active-presentation and abort guards reject stale replies. No composer
mutation, prompt submission, transcript entry, replay or follow change is involved.
Plan review is unchanged. `test/copilot-questions.test.ts` and the question fixture
in `test/shell.test.ts` cover literal/custom answers, freeform capability, FIFO,
dismiss/review, nested cancel/empty input, retained draft/focus, background/modal
priority, navigation, abort/disposal and stale input. These fixtures are authored
but unrun; native macOS/Linux stacking, focus and visual acceptance remain pending.

### Permission choices and interaction

Permission requests implement the shared [dismiss-and-resume workflow](dismiss-and-resume.md), with Copilot approval/denial semantics retained below.

`copilot/permissions.mjs` owns the exact options and bridge validation for the
concrete `CopilotDecision` permission union (declared in `permissions.d.mts`).
**Allow once** returns `{kind:'approve-once', approvedInteractively:true}`;
**Deny** returns `{kind:'reject'}`, optionally with literal feedback.
Stop/Close/disconnect never approves; bridge teardown resolves callbacks with
`{kind:'user-not-available'}`. There is no ordinary **Cancel request** permission
button: use Deny for rejection or Stop for cancelling the turn. Input/plan
cancellation remains separate.

Permission rows are searchable choices in one retained command-palette interaction,
not application commands/MRU entries or an on-change select. Only an explicit
selection approves:

- Read: `approve-for-session` with `approval:{kind:'read'}`, labelled **Allow all
  file reads this session**. This is deliberately not described as directory-
  or project-confined.
- Write: the same variant with `approval:{kind:'write'}`, labelled **Allow all
  file writes this session**, only with native `canOfferSessionApproval:true`.
- Shell: only with native `canOfferSessionApproval:true` and a nonempty valid
  `commands` catalog; false, absent or malformed capability values offer only
  one-time approval/denial. Exact de-duplicated `commands[].identifier` values
  form `approval:{kind:'commands',commandIdentifiers:[…]}`. The primary label is
  **Allow for this session**, with searchable, wrapping secondary scope details.
  `commandSegments[].identifier` supplies parsed **Commands** context when valid
  and distinct from the approval identifiers; missing/malformed segments fall
  back to the exact scope. **Approval scope(s)** always retains the literal rule
  identifiers, listed individually for multiple rules. Never parse command text,
  substitute shorter segment identifiers into the grant, or imply **any arguments**
  merely because a command is allowed for a session. Some real `commands` entries
  contain the complete invocation, not an executable name.
- MCP: `approval:{kind:'mcp',serverName,toolName}` for this exact tool, never all
  tools on a server.
- HTTP(S) URL: session approval with the parsed hostname in `domain`, or
  `approve-permanently` with the same domain. The latter explicitly says **saved
  across sessions**. Paths are not represented as the permission scope;
  credential-bearing/malformed URLs have no remembered choices.
- Managed-approval and sandbox-bypass requests offer only one-time approval or
  rejection, retaining prominent policy/escalation notes. Unknown or incomplete
  scopes retain literal details and one-time approval/rejection.

The [Set permissions command shortcut](live-permissions.md) and composer slash
commands use the same generic command queue and advertised live-use metadata.
Neither is a host decision or substitute approval policy; existing callback
promises remain independently owned. Generic model configuration remains
idle-only.

Every decision is checked against the bridge's retained original request using
the same option builder; unrelated domains, broader MCP scopes, mismatched
approval kinds, capability-disabled shell/write grants, injected fields and legacy outcome values are rejected. No
Nimrod-side remembered permission policy, bulk approval of queued requests,
automatic replay, or local settings writes. Copilot owns remembered rules and
their lifetime. Each already-pending callback remains an independent choice
unless its owning connection cancels it. Native
`permission.completed.result.kind:'approved'` remains a valid reported outcome,
not a supported decision input.

Compatibility boundary: CLI 1.0.98's captured malformed-reply diagnostic lists
`approve-once`, `approve-for-session`, `approve-permanently`, `reject`,
`user-not-available`. Generated SDK types additionally describe directory-only
session grants and persisted project-location grants; those are **not exposed**
until installed-CLI support is verified. The added session/domain decision
payloads have source/schema evidence and authored unrun fixtures, not live
runtime acceptance.

`src/copilot/permission-interaction.ts` retains each session's FIFO independently
of modal visibility. The selected, eligible session can open the shared palette
through `startRetainedSelection`; existing dialogs keep priority and background
requests never summon/replace a modal or navigate. A persistent, non-dismissable
`pending-action` session notice reads **Waiting for permission · N requests**,
with **Review requests**. It is neutral unresolved state, not an error, and stays
first above the independently scrolling error banners. Review is presentation
only, not an SDK decision, reconnect or replay. See [notice policy](error-presentation.md).

The oldest request alone supplies choices. Accepted choices synchronously advance
the same open shell without closing/reopening it. The header shows **N more**
(excluding the current request), or **Last request**. New arrivals update only
the count/banner: keep the current filter, selection, preview/raw disclosure and
any nested feedback input. Advancing resets the filter for the next request.
Long scope labels and secondary details wrap instead of truncating away important grant information. Shell permission options carry their secondary `detail` from the shared scope builder through the existing palette item metadata; filtering includes both parsed context and exact grant scope.

Escape/native cancellation dismisses the presentation **without answering**;
pending SDK callbacks, waiting status and the banner remain. New arrivals do not
reopen an explicitly dismissed interaction. Review reopens it. Explicit navigation
may show undismissed pending work, but never overrides another modal. Switching
away suspends the UI without answering; returning preserves explicit dismissal.
No transcript following, draft mutation or harness persistence comes from opening,
closing or advancing this interaction. Last settlement closes once and restores
the original still-visible focus target through the shared palette lifecycle.

**Deny with feedback…** opens the shared host input dialog above the retained
palette on the z-axis. Its title asks for a reason/suggested alternative and its
submit label is **Send denial**. Native modality owns topmost focus containment;
the parent remains mounted at its existing size. Escape/Cancel returns to the
same picker/filter without answering. Submit sends `reject` plus trimmed optional
feedback and advances the parent. Generation/entry/AbortSignal/presentation guards
reject stale replies. Stop, owner disposal and disconnect close owned child and
parent UI and retire the banner without approval; ordinary dismissal does not.
The pending queue/options are touched only at existing request/choice/cancellation
or explicit navigation boundaries, not per streaming update. No animation changes
or universal modal manager are introduced.

`CopilotSession` tracks outstanding decision IDs at existing receive/settle/cancel
boundaries. Presentation snapshots override activity text with **Waiting for
permission…** (or **Waiting for input…**) until all decisions settle, while keeping
underlying busy/Stop/configuration semantics intact. Dirty-row publications and
stable Status-area contributions remain on the existing shared view/scroll path;
streaming never rebuilds the picker, scans the pending queue to recalculate status, or clears its waiting text. The busy composer hint is simply **Stop to cancel · Shift+Enter for newline**, avoiding a contradictory Working label while waiting.

SDK 1.0.98 logs established actual read/shell/fetch failures when the old host returned `approved`, despite the SDK's permissive generated union and old fake accepting it. The production SDK forwards the handler result directly to `permissions.handlePendingPermissionRequest`; no legacy-to-modern conversion is assumed. The offline fake now validates decision forms for shell and URL callbacks and requires the explicit native capability for shell/write session grants, and new bridge fixtures reject the old forms before accepting an explicit single-use choice. Those new fixtures are authored but unrun for this follow-up. No live prompts are replayed or reissued to validate the fix.

Compact permission previews are SDK-owned parsing through `src/copilot/permission-presentation.ts`, with a shared public display-only `operationPreview` helper. Commands/intention, owning-project paths, URL/MCP scope and supplied diffs/arguments are visible; raw details stays initially closed in the operation context above the choice list. Sandbox-bypass reasons and managed-approval requirements remain prominent. Read-kind requests with native `Search in directory:` / `Search in file:` intentions use **Search directory** / **Search file**, not misleading **Read file** titles. Other read intentions remain visible. Unknown scopes remain literal rather than being hidden or auto-approved. The helper cannot make decisions or invoke tools.

Authored **unrun** follow-up fixtures: `test/copilot-permissions.test.ts` covers option/validator parity, exact scope restrictions, one retained modal with remaining counts, Escape/review without answering, nested feedback cancellation/submit, draft/focus/disclosure retention, background isolation and stale-entry cancellation; `test/copilot-sdk-presentation.test.ts` covers search intentions; `test/copilot-bridge.test.ts` forwards modern scoped decisions and rejects policy/mismatched/injected scopes; `test/copilot-sdk.test.ts` covers overlapping waiting states/streaming/cancellation; `test/shell.test.ts` covers mounted routing, banner reopen, scoped replies and draft/status retention. `test/command-palette.test.ts` covers retained-shell selection/close counts and stale callbacks. Offline `test/browser/copilot-sdk.spec.ts`, `copilot-web-cards.spec.ts`, `application-notices.spec.ts` and `translucency.spec.ts` target native-dialog-like nesting/focus, banner order/overflow and per-row styling. These additions are unrun. Staging, native build watch and macOS resource verification include `permissions.mjs`. No requested tests/build/app launch or live permission probes were performed; mandatory post-merge compile checking is tracked separately. Native UI, remembered-rule lifetime and macOS/Linux acceptance remain pending.
Background requests do not navigate/focus or approve. Stop, disconnect and Close
retire exact connection-bound AbortSignals and settle/reject callbacks safely.
Notifications reuse shared preference/focus/token checks; replay never alerts.
[Transcript logging](transcript-logs.md#copilot-sdk) owns the SDK diagnostic event mapping, including replay and pre-deduplication capture.

Plugin source/target is **`copilot-sdk`**, distinct from ACP. Existing Pi-only
defaults/overrides remain Pi-only; exact-agent plugins rank above generic SDK
targets. Bundled Copilot shell/read/search/web helpers accept both explicit sources;
raw results/inputs remain recoverable. Actual native `completion.error.message` failures are rendered literally across supported card families, while exact original error JSON remains recoverable. GitHub MCP cards use actual server/tool metadata for query/count/path/snippet or owner/repo/path previews; skills use their real names. Unknown shapes remain generic. See [observed payloads](card-plugins.md#observed-sdk-tool-payloads). Plugins never decide permissions.
`tool-result.ts` retains distinct content/detailed content and rich metadata;
shared web adapters read the original SDK result directly, with no ACP envelope.
Indexed row lookup, dirty-row publications, stable unchanged controls and the
shell-signature guard prevent transcript scans/layout persistence per delta.

## Plan and Autopilot lifecycle

### Verified mode API behavior and remaining handoff limits

To resume the unfinished work, load the
[Copilot mode acceptance skill](../../copilot-mode-acceptance/SKILL.md). It owns
the controlled acceptance plan, authorization gates and remaining investigation
sequence; this reference owns implemented behavior and evidence.

User-authorized no-prompt probes on 2026-10-17 used SDK 1.0.22, CLI 1.0.98,
protocol 3 and custom in-memory `SessionFs` providers. Each session had separate
memory storage; no user conversations were loaded/deleted, no prompts or
compaction were sent, and no plan selection was persisted. All owned sessions
were disconnected and clients stopped.

Observed transitions: Interactive -> Plan -> Interactive -> Autopilot ->
Interactive, both with ordinary parameters and explicit
`planModelConfigured:false, restorePlanModel:true`. Every transition emitted
`session.mode_changed` and returned
`{status:"unchanged",modelChanged:false,modeApplied:true}`; `mode.get()` confirmed
the target. The `status` string is not evidence that a mode was unchanged.
No confirmation/defer/continuation flag was returned.

An additional empty session created with catalog model `auto`, requesting a
distinct advertised plan model with `planModelConfigured:true`,
`restorePlanModel:true` and `persistPlanSelection:false`, likewise returned no
follow-up flags and retained the base model. Entering Plan exposed
`planBaseModelId:"auto"`; leaving removed it. This does NOT verify a distinct
planning model actually running or being restored. Do not generalize these
empty-session observations to conversations with context or active objectives.

The public RPC schema exposes `compactionDecision`, `restorePlanModel` and
`planExitAction` on `mode.set`; compaction confirmation reports target model,
current tokens and target limit. An upstream serialization fixture uses
`compactionDecision:"compact"` on `model.switchTo`, but does not establish
runtime decision values, rejection semantics or ordering for `mode.set`.

The low-level `ui.handlePendingExitPlanMode({requestId,response})` supports
`response.deferImplementation`; the high-level `ExitPlanModeResult` does not
declare that field. The low-level event includes a request ID and plan-authoring
model omitted by the high-level callback. A future implementation must choose
one response owner and verify event-interest registration versus callback
dispatch; never answer both routes. The schema describes deferral as ending
planning before restoring configuration and submitting a fresh implementation
turn. No canonical continuation payload or proven sequencing was found for
`armInteractiveContinuation`. Do not invent them or cast extra callback fields
past the SDK type.

Known limits: compaction confirmation, distinct-model execution handoff,
deferred implementation and interactive continuation remain unsupported when
their result flags are returned. Their existing explicit-error/disconnect
fallback remains. Further acceptance needs isolated model-backed evidence or
upstream clarification; no model-backed probe is authorized by the no-prompt
probe. Native GUI, Linux, active-task Stop and sticky-mode completion are
unverified. These probes establish only metadata/configuration behavior.

Plan review now offers optional feedback and **Request changes** using the
existing high-level callback's supported `{approved:false,feedback}` response.
Approval may also carry feedback; Cancel discards it and returns only
`{approved:false}`. UI-local choice IDs are separate from native action IDs, so
future SDK action names cannot collide with Request changes. Feedback never
uses Send, modifies the composer or creates synthetic transcript history.
Authored, unrun shell/bridge fixtures cover these responses and draft/focus
preservation; the configuration fixture records the observed `unchanged`
model-status result.

Upstream evidence:
- [Plan callback support](https://github.com/github/copilot-sdk/issues/1053)
- [Mode callback end-to-end example](https://github.com/github/copilot-sdk/blob/main/python/e2e/test_mode_handlers_e2e.py)
- [Model RPC serialization fixture](https://github.com/github/copilot-sdk/blob/main/dotnet/test/Unit/RpcModelCompatibilityTests.cs)

### Runtime and presentation ownership

Mode selection reuses `SessionConfiguration` with opaque choices. Copilot owns
planning and continuation; shared transcript, navigation and notification code
consume semantic Working/completion state only. No universal Plan/Autopilot
interface or host-generated continuation prompt is introduced.

The pinned SDK's response waiter ignores root `session.idle` with
`data.mode === 'autopilot'`. Nimrod follows that exact boundary in both the
controller and bridge: intermediate idle neither completes/notifies nor cancels
pending decisions, finalizes cards, or releases deferred configuration. The
event's mode is not a new confirmed selection: sticky session mode continues to
come from `mode.get`/`session.mode_changed`. Missing mode retains the SDK waiter's
legacy terminal behavior. Unknown snapshot/event modes fail explicitly.

A non-Autopilot root idle ends active work once. An explicitly
`aborted: true` idle is terminal even in Autopilot, reports Stopped and does not
notify success. Stop still calls SDK abort and waits for terminal evidence, not
the mere cancellation request. Root errors terminate as failures. Duplicate
terminal idle does not repeat completion refreshes. Late turn-start after
Stop/failure cannot revive work; a new explicit prompt resets those flags.
Child events and replay never complete the root run.

`session.task_complete` is completion-review metadata, not independently
quiescence: its `success` may be false. Objective updates can describe active,
paused, cap-reached or completed objectives. Neither event is used to invent a
terminal boundary or resume work. They remain available in native debug capture.
The SDK waiter is source evidence; native final-event ordering, sticky-mode
completion, limit exhaustion and abort behavior still require acceptance.
Do not infer acceptance from synthetic fixtures.

Exit-plan choices remain scoped to their request/connection. The UI rejects
missing/malformed action lists; the bridge rejects approval without an advertised
action, unadvertised actions and a selected action on rejection. Cancellation is
`{approved:false}`. A successful decision returns the exact action once, never
a synthetic implementation prompt. Permissions retain their separately
documented scoped approval semantics; Autopilot never grants permissions.

Mode mutation uses a fresh expected mode. Unsupported `confirmation`,
`deferImplementation` or `armInteractiveContinuation` results name the missing
operation and disconnect rather than guessing follow-up work. There is no
supported host continuation implementation for those effects in this integration.
The unrelated `onAutoModeSwitchRequest` callback is model fallback after rate
limits, not Autopilot. Resume retains `continuePendingWork:false`.

Authored, unrun regressions: `test/copilot-modes.test.ts`,
`test/copilot-sdk.test.ts` and `test/copilot-bridge.test.ts` cover mutation
preconditions/effects, intermediate/terminal idle, abort, root/child separation,
replay, retained cards/decisions, deferred configuration and request-scoped plan
choices. No app launch, paid prompt, browser test or native acceptance was
performed for this change.

## Usage metrics

**Status: source-implemented; new/updated fixtures unrun.** `src/copilot/usage.ts`
provides the narrow concrete `CopilotUsage` snapshot and session-bound metadata
consumer, separate from model configuration. The shared Status area only consumes
`StatusAreaSnapshot.metrics` / `metricsTitle`, not SDK billing fields.

- Initial display is data, not a separate new/resume pipeline. `initialCopilotUsage`
  in `src/copilot/usage-seed.ts` is the sole policy: fresh sessions seed provisional
  zero cost/utilization (`~$0.000 · 0% / —`), Resume seeds unknowns (`— · — / —`).
  Change the factory's `zero` mode to `unknown` to retire the experiment. New versus
  saved identity comes from the existing initialize argument, never transcript
  length or an assumed empty history. Both modes then use identical reads,
  reconciliation, rendering, ownership and disposal.
- Seeds live only in `CopilotUsage.provisional`, not `credits`/`context`, persisted
  state or harness settings. Apply once after initial configuration/history binding;
  never replace already reported values. Successful-but-empty initial reads retain
  a zero seed while that field is still provisional and no locally accepted Send or
  live SDK work has occurred. This includes null/missing context, zero context
  without a usable window (0/0), and unreported AIC amounts; it does not hide
  malformed payloads or contradictory positive amounts.
  Genuine values replace their field immediately; errors retire its seed to `—`.
  This changes display provenance only, not RPC ordering or measurement values.
- The first locally valid Send (prompt or command, before any RPC result), or live
  root/child assistant/tool/usage activity, ends the untouched lifetime exactly once.
  Remaining zero modes become unknown immediately, and in-flight pre-work snapshots
  are fenced so late explicit zeros cannot revive them. Already reported values
  remain authoritative. Rejected drafts, replayed history and startup idle events
  do not count as work; a command submitted then cancelled does not re-seed zeros.
  Later empty reads use `—` through the same reconciliation pipeline as Resume.
  Live context replaces its seed immediately. Model invalidation fences prior reads
  and drops measured context but retains an untouched windowless zero seed, so
  startup model resolution is not mistaken for work. Disposal retires all remaining
  seeds. No dwell, retry or polling timer.
  Confirmed fields retain their existing error/lifetime semantics. Tooltip detail
  explicitly identifies provisional values, not a measured empty context or zero
  AI credits. No model-window capacity or Auto compact setting is seeded.
- The private bridge `usage` read calls `session.rpc.usage.getMetrics()` and returns
  only `totalNanoAiu` and `aiCreditsStatus`. SDK totals include the main agent and
  subagents and restore accumulated usage on Resume; never sum ephemeral
  `assistant.usage` events or add snapshot totals together. The premium-request
  multiplier (`assistant.usage.cost` / `totalPremiumRequestCost`) is not currency.
- Refresh after connection, any live root/child `assistant.usage` event, root idle/error
  settlement and completed command invocation/context clear. Replay never issues
  per-event reads. No token-chunk polling, quota queries or new provider/model work.
  Frontend reads coalesce single-flight, discard results predating a newer usage
  trigger and make one owed follow-up read. The bridge also shares its SDK promise
  so an optional frontend timeout cannot pile up underlying metadata RPCs.
- Usage and context metadata reads use the connection's `reject` timeout policy:
  remove their pending ID after 20 seconds without disconnecting chat. A usage
  failure marks credit accounting unavailable; a context failure cannot erase
  credit totals or a newer live context observation. Late results are ignored. SDK method errors likewise affect
  only optional metrics; actual transport/write failures retain existing teardown.
  Every mutation retains the original uncertain-outcome disconnect/no-replay policy.
- Normalize finite nonnegative amounts. `complete` plus an explicit numeric amount
  displays `~$0.123`; an explicit complete zero is `~$0.000`. `partial` or unknown
  coverage with a positive subtotal displays a conservatively rounded-down lower
  bound such as `≥$0.123`. Explicit partial zero remains qualified by `≥`. Missing
  amounts, unavailable status, invalid numbers or zero without reported coverage
  display `—`, never a fabricated reported zero. The explicit display-only fresh
  seed above is separate from that authoritative accounting state.
- Conversion is `AIC = totalNanoAiu / 1e9`, `USD equivalent = AIC * 0.01`, based on
  the published [SDK usage guide](https://docs.github.com/en/copilot/how-tos/copilot-sdk/features/usage-and-billing)
  and [GitHub credit pricing](https://docs.github.com/en/copilot/reference/copilot-billing/models-and-pricing).
  This is usage value, not an invoice or necessarily additional charges against
  an included subscription allowance. No per-model token-rate reconstruction.
  Tooltip/accessibility detail retains AIC (up to nano-unit precision), coverage,
  conversion meaning and unrounded context counters; display rounding is separate.
- Root `session.usage_info` supplies live context. Reconnect does not necessarily
  emit that event: a separate optional private `context` read calls
  `session.rpc.metadata.contextInfo({promptTokenLimit:0,outputTokenLimit:0})` on
  connection, idle/command settlement, model changes, context clear and compaction
  completion. This asks the runtime to resolve the current model/tier; it does not
  send a prompt, select a model, replay history or gate ordinary interaction.
  The bridge returns only `{currentTokens:contextInfo.totalTokens, tokenLimit:contextInfo.limit}`.
  Use **`limit`**, the advertised display window, not the distinct effective
  `promptTokenLimit` input budget. No catalog capacity/last-call-token guesses.
- Configuration settlement owns the post-mutation context refresh described above;
  no mid-mutation observation is attributed to the new model/tier. Regression
  fixtures in `test/copilot-sdk.test.ts` cover early native model events, stale
  reads/live usage and both tier directions. `test/copilot-session-configuration.test.ts`
  covers catalog maximum stability and pending-target model details. These fixtures
  are authored but unrun; native/installed-CLI acceptance remains pending.
- Context and credit reads are independent and individually coalesced. Context
  callbacks are fenced by model/invalidation revision, request revision, disposal
  and every newer live observation (even one with unchanged values). A late read
  cannot resurrect the previous model's window or overwrite live counts. Newer
  context requests coalesce into one owed follow-up; no polling/retry timer.
- `contextInfo` can be null on a cold reconnect before system-prompt/tool metadata
  is cached. Keep unknown context visibly `— / —` next to known cost, not omitted
  or fabricated as zero. Context null/error/timeout does not withhold a successful
  credit read. Later live usage or supported metadata updates fill the slot.
  Percentage is `currentTokens / tokenLimit * 100`, denominator uses decimal
  compact notation (`125k`, `1.1M`). These are current root context counters,
  never cumulative billed or child-agent tokens. Ignore invalid/negative updates
  and never clamp reported percentages above 100. Model change/deselection/context
  clear invalidates old context without resetting spending. No Auto compact state
  is inferred from events.
- Normalized snapshots and unchanged control arrays retain references. Tooltip-only
  changes invalidate the metrics section even when rounded text is unchanged,
  without replacing that text node. Existing paint suspension/hidden catch-up,
  draft/focus/scroll owners and sidebar bookkeeping remain unchanged. Disposal
  suppresses late results; disconnected views keep only their last reported data.

Code: `src/copilot/usage-seed.ts`, `usage.ts`, `status-area.ts`, `session.ts`, the private bridge
read and native method allowlist, plus the generic `metricsTitle` field/render
dependency. `test/copilot-usage-seed.test.ts` and the SDK controller fixture cover
new/resume initialization with identical request sequences, independent seed
retirement, retained empty startup reads, real/malformed errors, pre-work result
fencing, local prompt/command Send before acknowledgement, root/child activity,
no inferred window, known-data precedence, late results and disposal;
these additions are unrun and visual flicker acceptance remains a user check.
Fixtures: `test/copilot-usage.test.ts` covers formatting, partial/missing
coverage, coalescing/stale responses, reconnect snapshot reads, null cold context,
independent metadata errors/disposal and optional timeout isolation;
SDK/production-bridge/native allowlist fixtures cover integration and aggregate
filtering. The context fixture deliberately gives different `limit` and
`promptTokenLimit` values, and covers Resume without a live usage event or prompt.
Renderer/offline browser fixtures cover exact detail, hidden catch-up,
retained nodes and the displayed `~$0.123 · 25.5% / 125k` example. **They have not
been run**; real CLI accounting, resumed totals and macOS/Linux visuals remain
unverified. Source documentation is API/rate evidence, not runtime acceptance.

## Close and Delete

Close awaits owned stop and SDK `session.disconnect()`/`client.stop()`; it never
calls `deleteSession`, and keeps history/draft. Resume can reopen it explicitly.

SDK deletion uses `client.deleteSession(id)`, which permanently removes history
and artifacts. The shared target-bound operation requires review, fresh exact
project membership, locks, observed owned writer shutdown and another fresh
membership check in the discovery-only bridge. It never resumes, creates,
prompts, deletes a private directory or replaces Pi's native tree transaction.
Aborted/failed stop, stale membership or an unknown deletion
outcome retain identity/draft/references; confirmed success alone cleans the
SDK scope. No automatic retry; Refresh may inform a later explicit attempt.
External applications remain uncoordinated.

## Code map and authored verification

- `src/copilot/session-configuration.ts`: concrete capabilities/choices/readiness behind the shared configuration port; `session.ts` retains SDK mutation/version ordering. Deferred configuration fixtures and the offline browser scenario are authored but **unrun**.
- `src/copilot/{connection,session,session-lifecycle,view-policy}.ts`: correlation,
  SDK events, persistence/connectivity and interaction contributions.
- `src/copilot/{session-history,session-deletion}.ts`: discovery and supported
  permanent-removal operation.
- `src/main.ts`, shared session/backend/draft/card interfaces: composition only.
- `src-tauri/src/copilot.rs`, `copilot/bridge.mjs`: owned native/official SDK boundary.
- `test/copilot-sdk.test.ts`, `test/copilot-bridge.test.ts`: authored **unrun**
  semantic, uncertainty, draft-isolation, deletion and configured startup-default fixtures.
  The fake SDK accepts configured creation values, exercises empty `getCurrent()`
  snapshots without catalog side effects, covers independently null/missing defaults,
  native overrides/read failures/malformed values and preserves different resumed
  selections without reading current user defaults. The production bridge imports
  that offline fake SDK through a test-only ESM loader.
- `src-tauri/src/copilot_tests.rs`: authored **unrun** private-record validation,
  window-generation/token retirement and real-pipe/owned-group shutdown against
  the offline SDK fixture. It never starts an installed CLI.
- `test/shell.test.ts`, `test/browser/copilot-sdk.spec.ts`: authored/updated
  **unrun** shell and isolated-browser fixtures for creation, exact resume,
  decision ownership, newer drafts, tools and model controls. The harness-availability
  browser fixture asserts that ACP actions/restored rows remain absent.

Next authorized verification must run the normal offline checks/browser fixtures
before any native acceptance request. Installed version metadata and released
source evidence do not validate real tools, permissions, history, destructive
API behavior, signed distribution or macOS/Linux native lifecycle.
