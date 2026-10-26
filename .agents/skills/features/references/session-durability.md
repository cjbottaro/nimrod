# Session durability and untouched-session continuity

**Status: accepted cross-harness product policy; implementation convergence pending.**
This reference owns the distinction between local session continuity, runtime
identity and saved harness history. It applies to future integrations and reviews
of existing ones; it does not claim that current ports or adapters implement it.
[Projects and sessions](projects-and-sessions.md) owns lifecycle mechanics,
[native drafts](native-drafts.md) owns draft storage, and
[consumer interfaces](consumer-interfaces.md) owns interface extraction.

## Product decision

Nimrod should feel uniform across harnesses at the session level, without
pretending their native persistence semantics are identical. A persistent New
session should remain a usable open conversation after restarting Nimrod, even
when the user has not sent its first message. Preserve its local continuity and
draft rather than exposing a harness's lazy history creation as a broken Resume.
Explicit Temporary sessions retain their disposable lifetime.

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

## Reopening and replacement rules

1. Restore persistent local membership and drafts without sending a message.
   Connection remains subject to the existing selection/activation policy; do not
   eagerly launch background sessions merely to make them persistent.
2. A session **positively known to be untouched and not yet durably saved** may
   obtain a fresh native thread on its next permitted connection. This is the
   continuation of an empty local session, not Resume of the old runtime ID.
   Preserve local identity, draft, title and navigation continuity. Do not send a
   synthetic prompt, replay input, edit harness files or change global settings
   to force persistence. Reapply only configuration with documented native support;
   do not claim unsupported or unconfirmed settings were restored.
3. Persist enough conservative lifecycle evidence to justify that distinction
   across restarts. An empty rendered transcript, no known history file, a missing
   catalog entry or a failed Resume is **not** proof that a session was untouched.
   Once input may have been delivered, a turn/history is observed, or another
   history-producing operation may have occurred, do not classify it as safely
   replaceable. Mark that uncertainty before dispatch, not only after a response.
   This evidence is not a stored prompt or submission replay mechanism.
4. A confirmed saved-history reference always resumes that exact identity.
   Missing, unreadable, corrupt, inaccessible or ambiguously persisted history
   fails visibly while preserving local state. Never turn arbitrary Resume errors
   into New session. Legacy records without trustworthy untouched-session evidence
   take this conservative path; an explicit separate New session remains possible.
5. Keep Reload, saved-history Resume and deletion eligibility truthful. A local
   placeholder/runtime ID is not a saved-history capability. Close is not history
   deletion. History loss or connection failure never authorizes deleting drafts,
   replacing saved identity or repeating navigation.

The [optimistic interaction policy](architecture.md#optimistic-interaction-policy)
still applies: Send feedback is immediate, no durability acknowledgement gates
ordinary interaction, and uncertain delivery never causes replay or newer-draft
mutation. Replacing a native process still requires observed owned shutdown.

## Adapter review and acceptance

For each harness, document its identity assignment, first durable-save boundary,
untouched shutdown behavior, evidence of possible work and exact Resume semantics.
Review existing adapters against this policy rather than copying the behavior of
another harness or assuming their current saved-ID ports prove durability.

Provider-free fixtures should cover: create/restart/reselect before first Send;
draft and image retention; promotion without duplicate membership; exact Resume
after real persistence; ambiguous first Send followed by restart; missing saved
history; legacy records without evidence; explicit Temporary disposal; failed
owned shutdown; and isolation from siblings, newer drafts and background focus.
Fixture authoring/execution and native acceptance must be reported separately.

## Codex motivating case and implementation gap

Read-only investigation of Codex CLI 0.164.0 found `thread/start` can return
`ephemeral: false`, an ID and a future rollout pathname before creating a durable
thread. Matching upstream fixtures explicitly cover an untouched thread having no
rollout and idle shutdown leaving no stored thread record. The affected Nimrod
trace showed creation, no `turn/start`, then a later `thread/resume` rejection:
`no rollout found for thread id …`.

Current `src/codex/connection.ts` immediately sets `savedSessionId` in the identity
callback; `src/codex/client.ts::open` treats non-ephemeral creation as durable.
These are implementation gaps, not exceptions to this policy. The
[Codex integration skill](../../codex-integration/SKILL.md) owns the concrete
mapping and follow-up. No runtime fix, migration, live reproduction or acceptance
is implied by recording this decision.
