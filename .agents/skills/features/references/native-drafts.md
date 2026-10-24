# Native drafts

Persistence-error routing and wording follow the [error presentation policy](error-presentation.md). The existing bottom storage banner is a consolidation target, not a feature-specific exception.

## Code map

- `src/draft-scope.ts`: shared namespaced-key grammar and constructors, with frontend/native fixture vectors.
- `src/native-drafts.ts`: ordered per-record staging IPC, restored revisions, failed-stage retention/retry and explicit flush; scope validation is cached per key, not repeated on typing.
- `src/session-drafts.ts`: shared in-memory project library and independent mounted-session selection; native callback emits only changed scopes. Provisional promotion emits saved scope (when present) plus null old scope. `bind` preserves Pi file semantics; `bindScope` accepts structurally valid namespaced saved identities without copying sibling drafts. Temporary/demo/custom-ACP records never stage.
- `src/main.ts`: loads native project drafts before restoring mounted sessions; ignores old localStorage drafts; stages composer changes; flushes cleared drafts/recovery/attachments asynchronously without gating prompt dispatch; transport requests and send-local image reads remain independent of stored drafts. Close flushes before/after disconnect. Pagehide/close requests best-effort IPC flush without replacing native window ownership.
- `src-tauri/src/drafts.rs`: XDG app-state sibling `drafts/<sha256 project>/<sha256 scope>.json`; versioned identity envelope, revision checks, null tombstones, 16 MiB bound, window/project-authorized commands, pending map, 100ms worker tick, 300ms debounce/2s max wait, atomic tempfile+sync+replace. Blocking I/O is off the webview thread. The store mutex currently serializes file I/O across projects; no claim of per-project parallel I/O.
- `src-tauri/src/main.rs`: store setup, command registration, shutdown/window flushes while preserving owned-child shutdown.
- `src-tauri/src/session_deletion.rs`: only confirmed successful session files tombstone draft scopes across closed projects as well as open ones.
- `src/attachment-store.ts`: native persisted+staged image-reference query replaces localStorage scanning; failed queries disable GC. 24h grace and transactional IndexedDB quota remain.
- `src/pi/composer-dom.ts`, `transcript.css`, `webview-client.ts`: feature-detected native field-sizing; fallback preserves shell-height hold and coalesced pre-paint geometry; immutable draft-only updates skip status/control rebuilds.

## Contract and limitations

Built-in [Copilot SDK](copilot-sdk.md) and [Codex](../../codex-integration/SKILL.md) use `copilot-sdk:<JSON ID>` and `codex:<JSON ID>` scopes in the same native store/dirty-record writer. Frontend promotion, confirmed deletion and native staging use the structural [draft-scope contract](#draft-scope-contract), not a harness whitelist. Lifecycle-interface conformance alone does not prove that binding works: Codex's initial frontend whitelist omission broke startup despite successful native thread creation. See [startup binding](../../codex-integration/references/startup.md) and its real-draft-store fixture. Draft files from the removed integration
remain on disk but have no current binding/staging path; SDK deletion never purges them.
New SDK identities promote only their own unassigned draft; existing scopes
must be resumed explicitly. Source/fixtures are authored **unrun**.

No migration: legacy `nimrod.sessions.v1*` and `nimrod.poc.composer` are neither read nor deleted by the product draft path. Settings/layout migration remains separate. Legacy pending submissions are not reconstructed or replayed. Pi files are unaffected. Legacy image references no longer protect orphans from 24h collection.

Frontend state/eligibility is immediate. Each edit stages only its scope asynchronously; Rust debounces *disk* writes, not IPC. Native restored revisions prevent delayed older stages from overwriting newer state; equal-identical stages are idempotent, equal-different stages fail. A failed stage is retained by scope for retry before flush; a later successful stage for that scope supersedes it. Atomic write failures retain pending state and emit `nimrod-draft-error`; explicit flush reports storage failure. Draft persistence does not gate prompt dispatch or establish Pi acceptance.

Saved/provisional records include editable draft text/images and authoritative recovered queue text, never submission snapshots. Send clears the editable draft immediately and stages/requests a best-effort flush without awaiting it before prompt dispatch. There is no composer submission record or durability callback. `ViewHost.promptSubmitted` is only synchronous local UI intent for sidebar recency/scroll, not a storage gate or submission snapshot; see the [optimistic interaction policy](architecture.md#optimistic-interaction-policy). The renderer starts every image read before clearing temporary draft references; its local promises retain captured bytes only through payload preparation. The transport's existing pending request map supplies lifecycle/compaction/model guards; prompt dispatch does not wait for an earlier prompt's acknowledgement. Receipts never change the next draft. Failures/uncertainty report a notice, not recovery or a new-message gate. Retired submission/imageRecovery/unsent entries are ignored and removed on the next draft write, and do not protect IndexedDB blobs even in unopened scopes. Only editable draft attachment references protect persisted cached bytes; the 24h grace remains. Persistence cannot acknowledge Pi or replay messages. Close waits for explicit flush, whereas native window/Quit flush only changes already delivered to Rust. Pagehide is best effort. Abrupt crash/reload can lose undelivered or debounced typing; do not claim guaranteed unload durability.

Pi file scope is still canonical session pathname, not a new identity migration. Copilot uses `copilot-sdk:<JSON-encoded session ID>`; Codex uses `codex:<JSON-encoded thread ID>`. A newly created session promotes only its own provisional draft; Close retains it. Custom ACP remains memory-only. Namespace syntax is not integration registration: no current integration supplies the removed Copilot identity, and loading keeps old draft files readable without automatically binding, copying, staging or purging them during SDK/Pi deletion. See [SDK identity policy](copilot-sdk.md#identity-history-and-drafts). One project per window prevents normal concurrent frontend writers; Rust rejects revision conflicts. Null tombstones retain revision continuity. Native deletion clears Pi file scopes across projects. Storage corruption fails loading explicitly rather than silently replacing the project library with empty state. No runtime external draft-file editing/synchronization support is promised.

Native CSS sizing is selected with `CSS.supports('field-sizing','content')` and a matching `@supports` rule after base textarea styles. Unsupported engines keep manual measurement. Automated WebKit supports CSS sizing; runtime macOS and Linux engine coverage remains unverified. No browser interaction, upstream Pi modification or model calls are used.

## Draft-scope contract

`SessionPersistence.draftScope` is an app-owned storage identity, not filesystem
authority or a harness history path. Concrete adapters create namespaced keys
with `savedDraftScope(integration, identity)`. The encoding is
`<integration>:<JSON string ID>`; names are lowercase ASCII letters/digits/hyphens,
beginning with a letter. Nonempty Unicode-scalar IDs and at most 32768 UTF-8 key
bytes are required. Pi retains nonempty `file:<canonical pathname>` keys.
`unassigned:<nonempty local ID>` is persistent provisional state, never a saved
binding/deletion target. `file`, `unassigned`, `temporary`, `demo` and `legacy`
are reserved namespace names; temporary/demo drafts never stage.

Shared consumers validate key structure, not known harness names.
`test/fixtures/draft-scopes.json` supplies the same vectors to frontend and Rust
fixtures. Native keys remain hashed under the exact window-authorized project;
accepting a namespace grants no path access, process control or history deletion.
There is no storage migration: existing Pi/Copilot/Codex keys are unchanged.
Promotion stays provisional-only and synchronous before identity publication,
refuses sibling-draft collisions, and emits only the changed saved record and old
provisional tombstone. Confirmed deletion clears only the supplied saved key.

## Tests

Rust fixtures: read/stage without disk writes, debounced vs forced flush, maximum wait via controlled timestamps, project isolation/restart, revision conflicts/stale stages, disk failure retains state, tombstones/references and confirmed deletion across closed projects.

`test/draft-scope.test.ts` adds an unknown integration through the actual connection coordinator, shared draft library and native writer, including promotion/restore/removal and unchanged sibling drafts. Rust adds unknown-namespace staging/restore/tombstones and the shared grammar vectors. [Verification](verification.md#integration-consumer-boundaries) owns their execution status.

`test/native-drafts.test.ts`: ordering, restore revisions, explicit flush waits for staging, failed-stage/flush error reporting independent of prompt dispatch. `test/native-draft-storage.test.ts`: promotion/recovery and deletion callback. Native reference fixtures retain only editable draft images, excluding retired submissions/backups. Shell fixtures now seed native records explicitly, retain legacy sources untouched, and cover acknowledgement/newer drafts and lifecycle behavior.

`test/browser/native-drafts.spec.ts`: actual app bundle + offline child verifies immediate clearing and draft-only persistence without submission recovery. Shell fixtures cover dispatch despite failed/deferred storage flush, Stop without delayed replay, transport-derived lifecycle guards and restored-state sanitization. Typing fixtures cover empty/160-message transcript/200 retained drafts/combined/temporary with no localStorage writes, manual geometry reads or status mutations on supported WebKit; timings remain coarse handler diagnostics, not input-to-paint/native latency. Existing fractional-zoom, shrink/cap, reading/follow, image, sidebar and focus suites remain required.

Run `mise run test` and the offline WebKit suite for composer/layout regressions. Fixture evidence does not establish native send/typing acceptance; no build/package or user-app launch is implied.

User guide: [Drafts](../../../../docs/drafts.md). Verification results: [verification](verification.md). No app build unless explicitly requested.
