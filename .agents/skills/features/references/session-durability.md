# Session durability and untouched-session continuity

**Status: native-compatible durability contract; Codex exact-ID reconnect source-implemented, with upstream untouched-session persistence/discovery limitations.**
This reference owns the distinction between local session continuity, runtime
identity and saved harness history. It applies to future integrations and reviews
of existing ones. The required mounted-session retention port implements the
Close/local-cleanup boundary below; native acceptance remains pending.
[Projects and sessions](projects-and-sessions.md) owns lifecycle mechanics,
[native drafts](native-drafts.md) owns draft storage, and
[consumer interfaces](consumer-interfaces.md) owns interface extraction.

## Product decision

Nimrod should feel uniform across harnesses without pretending their native
persistence semantics are identical. Native CLI interoperability is required:
a persistence solution must not work only because Nimrod originally created the
session. Preserve local membership and drafts independently from saved history,
but promise post-restart conversation continuity only when the harness supports
it. A local placeholder or a newly substituted native ID is not equivalent to
resuming the original conversation. Explicit Temporary sessions retain their
disposable lifetime.

Uniformity belongs in the application contract and concrete adapters, not in a
universal harness protocol, fabricated saved history or automatic prompt replay.
Differences in optional capabilities remain explicit.

## Distinct identities and evidence

Keep these concepts separate, even when a harness happens to assign them together:

- **Local session identity:** Nimrod's stable project-local owner for open-session
  membership, draft/attachment scope and presentation continuity. It can exist
  before any native thread or saved history exists.
- **Runtime identity:** the harness's currently assigned thread/session ID. It
  identifies a live conversation, but is not by itself proof that another process
  can resume it.
- **Saved-history reference:** an exact harness identity with authoritative,
  harness-specific evidence of durable resumability. Neither a returned ID,
  `ephemeral: false`, a prospective history pathname nor a local Send action alone
  establishes that evidence. Integrations must document the actual boundary.

Draft durability is independent of harness-history durability. Promotion must
preserve the same local owner and only its drafts/attachments; do not copy sibling
state or create duplicate sidebar entries. Use existing scoped storage and
promotion mechanics where suitable. Any interface/storage changes need an
explicit compatibility design, not an undocumented reinterpretation of saved IDs.
Saved-history discovery must not advertise a local placeholder as harness history.

## Close and local removal

Every `HarnessSession` supplies the required `SessionRetention` port in
`src/session-retention.ts`, forwarded live by the registry. `check()` returns
`saved`, `absent` or `unknown`; it never resumes/creates a conversation or sends
work. The adapter owns native evidence, not the shell. Failed discovery, malformed
responses, a missing filtered list entry and connection errors are unknown, not
absence. `forget()` retires integration-owned local pointers after local removal;
it never deletes native history.

After observed integration-owned teardown, Close checks again. Codex detaches only its daemon client; it does not shut down shared work ([daemon lifecycle](../../codex-integration/references/daemon.md)). Confirmed absence discards exact
sidebar/layout membership, draft/attachments, recency and local pointers, including
provisional unassigned drafts. Retired draft owners reject late writes. Saved or
unknown history preserves drafts; unknown lookup must not trap a row in the
sidebar. Cancel/failed stop preserves everything. These checks occur only during
explicit removal, never on typing or routine sidebar updates.

Mounted Delete uses the same port to route absent targets through local Close
cleanup, regardless of harness. Recheck after shutdown; if it saves history, use
the native deletion review rather than silently abandoning it. Native deletion
failures/uncertain acknowledgements never fall back to local cleanup. Ordinary
Close never deletes native history and needs no destructive tombstone.

Concrete evidence: Pi uses a window-project-bound exact file/ID check independent
of a live token; temporary Pi and runtime-only ACP are explicitly absent.
Copilot uses public SDK `getSessionMetadata(id)`, validating exact ID, local status
and cwd (undefined alone means absent). Codex reuses the exhaustive validated
deletion inventory and exact native lookup, including named saved-but-unlisted
threads, without entering a deletion transaction. Missing/unavailable runtimes
remain unknown. External writers are not coordinated by local Close.

Fixtures: `test/session-retention.test.ts`, required-port negative type assertions,
prototype registry forwarding, and shared shell Close/Delete cases for
Pi/Copilot/Codex/an otherwise unknown fixture harness. Native API edge cases and
post-stop materialization are covered by concrete history/deletion fixtures.
[Verification](verification.md#session-retention-cleanup) owns execution status.

## Reopening and replacement rules

1. Restore persistent local membership and drafts without sending a message.
   Connection remains subject to the existing selection/activation policy; do not
   eagerly launch background sessions merely to make them persistent.
2. A local session without any native identity can create one on its permitted
   initial connection. Once a native ID is assigned, reconnect targets that exact
   identity. Do not silently substitute a fresh thread, even when Nimrod recorded
   the original as untouched. Do not auto-rename, send synthetic input, replay
   messages, edit native history or change global settings to force persistence.
   An explicit separate New session remains possible. Explicit New named session intent may create then natively name a new conversation once; this is not a persistence workaround and is never reapplied on reconnect. [Initial naming](session-naming.md#named-creation-via-native-rename) owns that boundary.
3. An empty rendered transcript, no known history file, a missing catalog entry,
   a failed Resume or private untouched-session metadata is **not** native
   saved-history evidence. A successful native history read can establish that
   evidence even for a zero-message thread. Conversely, observed work is not
   permission to assume saving completed. Keep uncertainty conservative, without
   persisting prompts or introducing replay or private delivery checkpoints.
4. A confirmed saved-history reference always resumes that exact identity.
   Missing, unreadable, corrupt, inaccessible or ambiguously persisted history
   fails visibly while preserving local state. Never turn arbitrary Resume errors
   into New session. All legacy candidates take this exact-ID path, including
   records with retired untouched-session markers.
5. Keep Reload, saved-history Resume and deletion eligibility truthful. A local
   placeholder/runtime ID is not a saved-history capability. Close is not history
   deletion. A native-deletion candidate may be reviewed by its independent
   catalog/source without connecting the conversation or requiring local history
   confirmation; only authoritative validation/removal authorizes cleanup.
   Explicit Close and Delete share the [confirmed-absent cleanup](#close-and-local-removal)
   policy after scoped owned stop and post-stop revalidation. Unknown history/connection errors alone never
   authorize deletion, replacing saved identity or repeating navigation.

The [optimistic interaction policy](architecture.md#optimistic-interaction-policy)
still applies: Send feedback is immediate, no durability acknowledgement gates
ordinary interaction, and uncertain delivery never causes replay or newer-draft
mutation. Replacing a native process still requires observed owned shutdown.

## Adapter review and acceptance

For each harness, document its identity assignment, first durable-save boundary,
untouched shutdown behavior, evidence of possible work and exact Resume semantics.
Review existing adapters against this policy rather than copying the behavior of
another harness or assuming their current saved-ID ports prove durability.

Provider-free fixtures should cover: create/restart/reselect before first Send
without substituting IDs; draft/image and membership retention; exact Resume
after real persistence; ambiguous first Send followed by restart; missing saved
history; ignored legacy replacement markers; explicit Temporary disposal; failed
owned shutdown; native zero-message saved history; and isolation from siblings,
newer drafts and background focus.
Fixture authoring/execution and native acceptance must be reported separately.

## Codex motivating case and implementation

Read-only investigation of Codex CLI 0.164.0 found `thread/start` can return
`ephemeral: false`, an ID and a future rollout pathname before creating a durable
thread. Matching upstream fixtures explicitly cover an untouched thread having no
rollout and idle shutdown leaving no stored thread record. The affected Nimrod
trace showed creation, no `turn/start`, then a later `thread/resume` rejection:
`no rollout found for thread id …`.

The [Codex integration skill](../../codex-integration/SKILL.md#untouched-session-persistence-anomaly)
owns its exact-ID reconnect, runtime confirmation and upstream limitation mapping.
The compatibility encoding retains `kind: codex` / `sessionId` for local layout
and draft routing; this is a reconnect candidate, not saved-history proof.
Retired `codexContinuity` metadata is ignored without removing rows or changing
draft scopes. No automatic thread replacement, private checkpoint, native history
migration or saved-scope reassignment remains. Other harness encodings are
unchanged. The isolated native probe is actual installed-runtime evidence, not
native Nimrod acceptance or a claim that the upstream limitation is fixed.
