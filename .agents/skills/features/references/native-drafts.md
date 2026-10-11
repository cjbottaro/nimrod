# Native drafts

## Code map

- `src/native-drafts.ts`: ordered per-record staging IPC, restored revisions, failed-stage retention/retry and explicit flush.
- `src/pi/session-drafts.ts`: shared in-memory project library and independent mounted-session selection; native callback emits only changed scopes. Provisional promotion emits saved scope plus null old scope. Temporary/demo records never stage.
- `src/main.ts`: loads native project drafts before restoring mounted sessions; ignores old localStorage drafts; stages composer changes; flushes recovery/attachments and gates saved prompts on successful flush with session/lifecycle revalidation. Close flushes before/after disconnect. Pagehide/close requests best-effort IPC flush without replacing native window ownership.
- `src-tauri/src/drafts.rs`: XDG app-state sibling `drafts/<sha256 project>/<sha256 scope>.json`; versioned identity envelope, revision checks, null tombstones, 16 MiB bound, window/project-authorized commands, pending map, 100ms worker tick, 300ms debounce/2s max wait, atomic tempfile+sync+replace. Blocking I/O is off the webview thread. The store mutex currently serializes file I/O across projects; no claim of per-project parallel I/O.
- `src-tauri/src/main.rs`: store setup, command registration, shutdown/window flushes while preserving owned-child shutdown.
- `src-tauri/src/session_deletion.rs`: only confirmed successful session files tombstone draft scopes across closed projects as well as open ones.
- `src/attachment-store.ts`: native persisted+staged image-reference query replaces localStorage scanning; failed queries disable GC. 24h grace and transactional IndexedDB quota remain.
- `src/pi/composer-dom.ts`, `transcript.css`, `webview-client.ts`: feature-detected native field-sizing; fallback preserves shell-height hold and coalesced pre-paint geometry; immutable draft-only updates skip status/control rebuilds.

## Contract and limitations

No migration: legacy `nimrod.sessions.v1*` and `nimrod.poc.composer` are neither read nor deleted by the product draft path. Settings/layout migration remains separate. Legacy pending submissions are not reconstructed or replayed. Pi files are unaffected. Legacy image references no longer protect orphans from 24h collection.

Frontend state/eligibility is immediate. Each edit stages only its scope asynchronously; Rust debounces *disk* writes, not IPC. Native restored revisions prevent delayed older stages from overwriting newer state; equal-identical stages are idempotent, equal-different stages fail. A failed stage is retained by scope for retry before flush; a later successful stage for that scope supersedes it. Atomic write failures retain pending state and emit `nimrod-draft-error`; explicit flush fails rather than permitting a prompt without durable submission recovery.

Saved/provisional records include draft, submission, recovered items, imageRecovery and attachment references. Submission snapshot is staged before host prompt dispatch; explicit flush finishes before Pi receives it. Acknowledgements apply synchronously in renderer state and request persistence; persistence cannot acknowledge Pi or replay messages. Close waits for explicit flush, whereas native window/Quit flush only changes already delivered to Rust. Pagehide is best effort. Abrupt crash/reload can lose undelivered or debounced typing; do not claim guaranteed unload durability.

File scope is still canonical session pathname, not a new identity migration. One project per window prevents normal concurrent frontend writers; Rust rejects revision conflicts. Null tombstones retain revision continuity. Native deletion clears scopes across projects. Storage corruption fails loading explicitly rather than silently replacing the project library with empty state. No runtime external draft-file editing/synchronization support is promised.

Native CSS sizing is selected with `CSS.supports('field-sizing','content')` and a matching `@supports` rule after base textarea styles. Unsupported engines keep manual measurement. Automated WebKit supports CSS sizing; runtime macOS and Linux engine coverage remains unverified. No browser interaction, upstream Pi modification or model calls are used.

## Tests

Rust fixtures: read/stage without disk writes, debounced vs forced flush, maximum wait via controlled timestamps, project isolation/restart, revision conflicts/stale stages, disk failure retains state, tombstones/references and confirmed deletion across closed projects.

`test/native-drafts.test.ts`: ordering, restore revisions, explicit flush waits for staging, failure prevents pre-send durability. `test/native-draft-storage.test.ts`: promotion/recovery and deletion callback. Shell fixtures now seed native records explicitly, retain legacy sources untouched, and cover acknowledgement/newer drafts and lifecycle behavior.

`test/browser/native-drafts.spec.ts`: actual app bundle + offline child verifies submission stage→flush→Pi prompt ordering. Typing fixtures cover empty/160-message transcript/200 retained drafts/combined/temporary with no localStorage writes, manual geometry reads or status mutations on supported WebKit; timings remain coarse handler diagnostics, not input-to-paint/native latency. Existing fractional-zoom, shrink/cap, reading/follow, image, sidebar and focus suites remain required.

Final validation: `mise run check` passed 453 TS/Node tests, formatting/Clippy and 111 Rust tests (two live-Pi smokes ignored); all 64 offline WebKit tests passed. A concurrent check/browser run hit the unchanged single-instance lock-holder timing test; standalone full check passed. Tests also assert Stop cannot release a queued pre-persistence steer later. No build/package or user-app launch performed.

User guide: [Drafts](../../../../docs/drafts.md). Verification results: [verification](../../../../docs/verification.md). No app build unless explicitly requested.
