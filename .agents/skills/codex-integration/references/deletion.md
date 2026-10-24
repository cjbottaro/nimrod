# Codex tree deletion

**Status: source-implemented, offline fixtures authored but unrun. No real thread was listed, resumed or deleted during implementation.** [Shared deletion contracts](../../features/references/session-deletion.md) own the coordinator/modal/effects. [Verification](../../features/references/verification.md#codex-tree-deletion) owns executed evidence. This page owns Codex-specific semantics, policies, limitations and fixture locations.

## Decision and supported evidence

Use the existing `SessionDeletionSource` / `SessionDeletionOperation` / `SessionDeletionContext`, not `SessionLifecycle` and not a separate tree-review UI. `src/codex/session-deletion.ts` depends on the narrow `CodexDeletionHistory` port; the project-owned history connection implements it without binding a conversation, sending a prompt, editing rollout files or invoking private CLI commands.

The reviewed CLI remains **0.162.0**. Its generated stable `Thread` contains `parentThreadId`, `forkedFromId`, cwd and ephemeral state; `ThreadSourceKind` enumerates ten source kinds. Official [app-server docs](https://developers.openai.com/codex/app-server/) say `thread/delete` permanently removes the persisted active/archived root and spawned descendants, existing rollout files and associated metadata, returns `{}` on success and emits `thread/deleted` per removed thread. Missing rollout files count as already deleted; ephemeral roots cannot be deleted.

This is **spawned ancestry**, not Pi's file lineage, `forkedFromId`, or Codex's tree-wide `sessionId`. We do not treat a history fork as deletion ancestry without evidence. The experimental `ancestorThreadId`/`parentThreadId` request filters described in current docs are not enabled: stable returned parent metadata plus an exhaustive source/archive inventory is sufficient for the implemented policy. Runtime compatibility of that metadata still needs installed-CLI acceptance.

## Inventory and policy boundaries

- Deletion inventories **all ten reviewed sources**, all providers, both non-archived and archived partitions, exhausting pagination. It does not filter by cwd before computing ancestry, which would hide cross-project descendants. This is a metadata scan through supported APIs, not private-directory parsing.
- `src/codex/deletion-tree.ts` validates stable nullable parent/fork fields, complete parent chains, duplicates/conflicts, persisted root, exact project, cycles, cross-project descendants and ambiguous forks. Local/native planners both fail closed when scope cannot be established.
- **Cross-project trees are refused**, as are affected owners belonging to another window. Supporting those would require distributed review/lock/draft reconciliation like Pi's native transaction; it is not implied by sharing the renderer.
- **Ambiguous forks are refused** when a thread outside spawned ancestry points into the subtree through `forkedFromId`. Docs do not establish their deletion behavior. This is a real limitation, not a claim that forks are or are not recursively deleted.
- Bounds are explicit errors: 100,000 inventory records/identities, 10,000 affected threads, 32 shutdown/discovery rounds; cursors cannot repeat. No sampling, hidden truncation or repeated delete request.
- Ordinary Resume/Delete-picker discovery explicitly includes `cli`, `vscode`, **`appServer`** roots. The server's omitted-source default is only CLI/VS Code and would otherwise hide Nimrod-created app-server history after Close. Exec/archived roots remain outside ordinary discovery; descendants from those sources still belong in deletion review.

## Review and execution

1. Discover/validate the spawned tree. Lock exact mounted cleanup targets through the shared context and publish a native reservation owned by project window, catalog token and a fresh operation ID. Native validates the supplied tree against metadata actually observed on that catalog, not merely caller-supplied IDs.
2. Render the existing retained tree-review dialog with opaque `key` / `parentKey` nodes. Description explicitly authorizes the root's current spawned descendants, including those created during review/shutdown. Cancelling releases the reservation/locks without deliberately stopping established agents or deleting history/drafts. A pending attachment or late mutation may be rejected while a scope is reserved.
3. After confirmation, use the shared stopping progress, await all mounted participant stops, then await native observed exit for any remaining affected owned processes. Tokens stopped natively are retired before waiting, preventing delayed replacement starts. No ownership/transition lock is held while waiting for child exit.
4. Rescan both archive/source inventories after shutdown. Expand the monotonically guarded scope and repeat stop/rescan when new descendants appear. Scope shrink/change is an explicit error, not permission to silently delete a different tree. There is no second review for newly spawned descendants; the original confirmation covers them, as with Pi.
5. Issue **one** `thread/delete` for the root, from the unbound catalog only. The native writer revalidates exact observed tree/project, reservation and stopped-scope proof at the actual write boundary. Direct conversation deletion or an unreserved/wrong-root catalog deletion is rejected.
6. Each known `thread/deleted` notification is authoritative for that exact cleanup target, even before the final response. A valid empty success response confirms the final known subtree. Shared reconciliation deduplicates success effects and removes only confirmed sidebar/draft/reference targets. Errors/loss retain unconfirmed identities/drafts; no automatic retry or replacement session. Unexpected deleted IDs beyond final inventory produce a diagnostic and do not purge unverified local references.
7. Before releasing a reservation after an unconfirmed mutation, disconnect and observe the catalog process exit. Native refuses release while a delete RPC is still in flight on an owned catalog. Failed cleanup retains native ownership/reservations and disables further deletion; resolve cleanup/reload explicitly rather than claiming safe reuse. Window reload/close releases its reservation only after successful owned shutdown.

## Native and transport boundaries

`src-tauri/src/codex_deletion.rs` owns Codex's scope gate and reservation/stop/release IPC. `codex.rs` distinguishes catalog from conversation processes, records native conversation bindings, captures validated catalog lineage and enforces the gate again when queued records reach the pipe. A scoped read lease covers each bounded write; reservation changes wait for prior writes, while unrelated records can use concurrent read leases. The reservation itself does not hold a global native lock through review or process teardown.

Normal reads, already-bound cancellation and permission responses remain possible while reviewed mutation/resume writes are blocked. A native-proven pre-write refusal returns a distinct private IPC result, mapped to `RpcWriteRejected`; shared RPC rejects only that request as locally not-written. It does **not** disconnect a working agent merely because review started, fabricate a Codex response/event, or replay work. Unknown writes still disconnect conservatively. ACP does not emit this marker and retains its existing behavior.

The reservation is Codex-specific native safety machinery, not another UI deletion coordinator. No universal harness session state, native filesystem deletion, archive-as-delete or protocol conversion was introduced.

## Remaining limitations and decisions

- No external-writer exclusion, OS-wide process discovery, atomic catalog snapshot, atomic multi-thread deletion or rollback is promised. External changes between inventory and server deletion can still add unobserved descendants; unexpected acknowledgements are reported conservatively.
- Codex owns the precise meaning of rollout/associated-metadata removal. Nimrod does not claim all external artifacts or project worktrees/files are removed, and performs no broad directory cleanup.
- There is no Pi-style persisted file quarantine for Codex. Known individual deletion notifications allow partial reconciliation; missing/uncertain notifications leave identity/drafts intact for explicit history refresh/verification. Reload's observed server exit retires in-flight work, not a claim that an uncertain deletion failed.
- Native checks use the reviewed stable parent metadata and all known source kinds. There is no runtime semver gate. Re-review schema/source kinds for CLI upgrades; do not promise unknown versions produce a complete inventory.
- Cross-project descendants and fork semantics remain future policy/runtime acceptance questions. Do not weaken checks or enable experimental APIs silently to broaden support.

## Fixtures

`test/codex-tree-deletion.test.ts`: opaque tree keys, nested/deep ancestry, incomplete/cyclic/cross-project/fork/conflicting inventories, cancel, stop failure, post-review expansion, shrink, single mutation, partial notifications/unknown acknowledgement, retained cleanup failure and exhaustive read-only discovery.

`src-tauri/src/codex_deletion.rs` tests: native affected-only gates, exact metadata/project/tree validation, catalog/root/observed-stop requirements. `test/json-rpc-connection.test.ts`: local proven-not-written request rejection without transport loss/replay. `test/deletion-review.test.ts`: opaque key/parentKey, duplicate/empty-key refusal and existing retained-modal behavior. Pi native event/browser fixtures keep `file`/`parent` wire fields and exercise their adapter into the shared model unchanged.

These fixtures are authored **unrun**. On explicit validation authorization use `mise run test`; requested layout/scroll validation also needs offline browser tests. Actual CLI recursive removal, partial failure, archived-descendant behavior, native multi-window/process shutdown and macOS/Linux presentation remain acceptance gaps. No app build/launch or user-session operation is authorized by fixture authorship.
