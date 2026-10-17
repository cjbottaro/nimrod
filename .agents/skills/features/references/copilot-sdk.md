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

- `copilot/bridge.mjs` imports the bundled official SDK. The bridge's JSON-line
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

Opening/restoring a project never creates, resumes or prompts a conversation.
Associated projects can start one **discovery-only** SDK client. `listSessions`
does not load history; exact `context.workingDirectory` and nonremote membership
are checked independently of the server filter. Dates are serialized SDK Dates,
not invented user-message timestamps. Pi/Copilot sources publish independently
through the existing shared history picker; Refresh is explicit.

Selecting a saved ID mounts/activates its existing shell and draft immediately,
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
Final content supersedes deltas. Tool partial results are replacement snapshots,
shell-output events append with monotonic sequence deduplication, and terminal
results cannot rewind to progress.
Rich result metadata and unsupported saved attachments remain literal JSON.
History replay finalizes interrupted reasoning/tools without capturing or alerting.

Text-only Send clears/previews immediately through shared submission receipts;
the SDK user echo adopts that key. `send({prompt,mode:'immediate'})` acceptance is
not turn completion: `session.idle` ends work. Busy Enter keeps the newer draft,
with no invented steer/queue. Stop calls `abort`; it is not Close/Delete.
Ambiguous writes/timeouts/results disconnect and retain identity/newer drafts;
there is no automatic replay or restoring the submitted text.

Models come from `listModels`; disabled-policy models are excluded. Thinking
efforts come only from the selected model's catalog. Idle-only `setModel` and
the pinned release's experimental `session.rpc.model.getCurrent()` read actual
model/effort state; later native events outrank older results. Failed configuration
disconnects instead of continuing with unconfirmed settings. No synthetic Pi
slash aliases to Nimrod actions, ACP mode selectors, image sending, Restart,
MCP inspector or other unsupported controls. [Copilot slash commands](copilot-commands.md)
use the released SDK's public experimental command discovery/invocation APIs,
argument metadata and typed results; authored fixtures are unrun. Returned choices
reuse the shared modal lifecycle, not app-action dispatch. Model invocation-effect
finalization and richer dialog/scoped-setting effects remain unsupported.
The bridge checks pinned `session.rpc.mode.get()` and accepts **interactive**
sessions only. Plan/autopilot selection fails explicitly without changing mode,
creating a replacement or prompting; live mode changes outside that supported
boundary disconnect. Root error/idle/configuration events cannot be inferred
from a child-agent event. Child transcript rows carry an explicit origin label.
Reported context-token usage can be shown; no
invented costs/queue capabilities.

`onEvent` is registered before SDK create/resume so early events are buffered.
Permission and user-input callbacks await explicit choices inside their owning
conversation, using the shared mounted decision surface. Permissions offer Allow
once/Deny/Cancel; input presents native choices and optional freeform text.
Background requests do not navigate/focus or approve. Stop, disconnect and Close
retire exact connection-bound AbortSignals and settle/reject callbacks safely.
Notifications reuse shared preference/focus/token checks; replay never alerts.
Capture logs native `tool.*`, streamed tool-input deltas and permission request/completion payloads without SDK-to-Pi conversion. [Tool capture](tool-capture.md#copilot-sdk) owns the concrete mapping, early-identity handling, version metadata, backend-specific paths and capture-specific offline evidence; this does not establish installed-CLI/native acceptance.

Plugin source/target is **`copilot-sdk`**, distinct from ACP. Existing Pi-only
defaults/overrides remain Pi-only; exact-agent plugins rank above generic SDK
targets. Bundled Copilot shell/read/search/web helpers accept both explicit sources;
raw results/inputs remain recoverable. Plugins never decide permissions.
`tool-result.ts` retains distinct content/detailed content and rich metadata;
shared web adapters read the original SDK result directly, with no ACP envelope.
Indexed row lookup, dirty-row publications, stable unchanged controls and the
shell-signature guard prevent transcript scans/layout persistence per delta.

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

- `src/copilot/{connection,session,session-lifecycle,view-policy}.ts`: correlation,
  SDK events, persistence/connectivity and interaction contributions.
- `src/copilot/{session-history,session-deletion}.ts`: discovery and supported
  permanent-removal operation.
- `src/main.ts`, shared session/backend/draft/card interfaces: composition only.
- `src-tauri/src/copilot.rs`, `copilot/bridge.mjs`: owned native/official SDK boundary.
- `test/copilot-sdk.test.ts`, `test/copilot-bridge.test.ts`: authored **unrun**
  semantic, uncertainty, draft-isolation and deletion fixtures; the production
  bridge imports an offline fake SDK through a test-only ESM loader.
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
