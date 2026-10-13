# Architecture

**Status: current system boundaries.** Read before changes alongside repository `AGENTS.md`. Feature-specific specifications live in the linked references, not here.

## Product boundary

Nimrod is a directory-backed agent workspace, not an IDE or generic chat frontend. One canonical directory belongs to each project window and is every session's exact cwd. Nested worktrees with other cwd values require separate windows. User terminology is Project/Project bar; existing workspace identifiers, IPC labels and storage keys remain compatibility details.

Pi is the only implemented harness. Integrate a concrete second harness before inventing a universal protocol. Pi owns conversation history, tools, models, configuration and semantic lifecycle; Nimrod owns presentation, local drafts, native windows, process ownership and explicit file deletion.

## Responsibility map

| Layer | Responsibility | Canonical specification |
| --- | --- | --- |
| Project shell (`src/main.ts`) | Mounted session views and effect coordination | [Projects/sessions](projects-and-sessions.md) |
| Navigation/connection | Shared projections, activation and connection deferral | [Session navigation](session-navigation.md) |
| Pi coordinator/transport | Ordered RPC, identity and result correlation | [Pi transport](pi-transport.md) |
| Transcript/composer | Incremental presentation and user intent | [Cards](transcript-cards.md), [scroll/focus](transcript-interaction.md), [composer](composer.md) |
| Rust host | Window/token ownership, pipes, shutdown and file validation | [Projects/sessions](projects-and-sessions.md), [Pi transport](pi-transport.md) |
| Settings/state | JSONC preferences and separate app-managed bookkeeping | [Preferences](preferences.md) |
| Window presentation | Shared creation/focus composition, explicit theme snapshots, appearance pipeline and prepared-window lifetime | [Window presentation](window-presentation.md) |
| Native integrations | Startup, references and notifications | [Startup](single-instance.md), [pop-outs](pop-outs.md), [notifications](notifications.md) |

There is no extra Node backend; Pi itself requires Node. The reducer and request correlation remain TypeScript so response snapshots apply synchronously in the ordered channel before later events. Rust validates the outer framing/record, TypeScript validates relevant Pi payload content. Small TS/Rust launch/packet shapes are hand-maintained; Pi's open-ended payload remains JSON.

## Optimistic interaction policy

User intent drives local UI immediately after local validation; do not make RPC acknowledgement a general prerequisite for interaction feedback. Dispatch work without waiting for prior prompt results. For Send, clear the composer, preview the message (images after local byte preparation), update session recency and follow the current recency-ordered sidebar row to the top. Image preparation must not delay recency or sidebar feedback.

RPC results correlate errors to the originating operation and supply specific authoritative results; successful replies do not repeat local interaction effects. Harness events/history reconcile optimistic presentation in place. Late failures or uncertainty annotate the affected message and report its error without restoring the composer, rolling back Send recency, reordering/selecting sessions again, changing a newer draft or automatically replaying work. No persisted submission lifecycle or acceptance-driven UI gate.

Pi remains authoritative for history, queue consumption, configuration, identity and process state. Narrow result-dependent behavior (for example, a confirmed Queued label, canonical identity verification, operation-in-flight lifecycle guards or destructive-operation completion) must have a documented concrete requirement; it is not precedent for delaying ordinary user feedback. Preserve focus. Preserve transcript reader/follow intent except for Send's explicit [auto-follow preference](transcript-interaction.md#auto-follow-after-sending). Its transcript navigation is local-only, never repeated by results or image preparation. Send's sidebar-to-top effect is not permission to switch filters.

## Cross-cutting contracts

- One ordered channel carries all stdout events and responses. Synchronous snapshot application is required; Promise continuations alone can overwrite newer streaming state.
- Apply the [optimistic interaction policy](#optimistic-interaction-policy). Unknown delivery is not rejection; never replay a prompt. RPC results never mutate a newer draft or repeat Send's navigation effects.
- Native ownership is window/token scoped. Shutdown must observe owned-child exit before replacement launch; failed shutdown retains reservations. No OS-wide process scans or external-writer exclusion guarantee.
- Shared navigation decides membership/order/replacement; the shell owns DOM, focus, persistence and native effects. All activations request connection through the single connection coordinator.
- Routine updates preserve mounted nodes, disclosures, focus and scroll intent. Explicit resume/restart is a distinct reset boundary.
- Nimrod-generated errors share one notice store/renderer, with ownership-based placement: session notices stay in their conversation area; window/application notices use the shell strip, including Settings/dialogs. Background-session errors are not displayed or announced elsewhere. Placement, wording, deduplication and lifecycle follow the [error presentation policy](error-presentation.md); remaining producer metadata cleanup is not precedent for new surfaces.
- Preferences and bookkeeping are separate from Pi history and scoped draft storage.
- RPC results and background delivery/completion never navigate themselves. Explicit user navigation can connect a saved session without sending a prompt.
- Platform direction is macOS first, Linux next, Windows possibly later. Narrow native integrations must not turn macOS conventions into portable product requirements. See [verification](verification.md) for actual acceptance.

## Window presentation choke points

[Window presentation](window-presentation.md) owns change routing and implementation boundaries. Every native constructor composes appearance and navigation through `window_presentation::prepare`; navigation security does not own styling. Explicit user focus is centralized separately from passive reference restoration. `applyTheme` publishes a completed, root-local appearance snapshot instead of having native presentation infer palette changes from DOM mutations. A single typed native pipeline serializes appearance/title work; a prepared-window lifetime owner handles first reveal/cancellation/cleanup. Feature owners retain their concrete project/session/Settings identity and lifecycle—this is not a generic harness abstraction or a single catch-all UI controller.

## Source provenance

Transcript/reducer/composer modules and baseline tests originated in the user's local sibling `pi-gui`, including uncommitted interaction fixes, without changing that project. The VS Code host was not copied. Nimrod owns its bridge, Pi coordinator, Rust backend, packaging and policies. `scripts/bootstrap-ui.mjs` records the one-time extraction; never rerun it as a build step or overwrite subsequent work.

## Documentation ownership

[Features index](../SKILL.md) routes tasks to current specifications. Keep shared contracts in one reference and link consumers. [User guides](../../../../docs/README.md) explain usage; [historical records](history/verification.md) preserve evidence, not current instructions. Development setup is in [Contributing](../../../../CONTRIBUTING.md).
