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
| Pi coordinator/transport | Ordered RPC, identity and acknowledgement | [Pi transport](pi-transport.md) |
| Transcript/composer | Incremental presentation and user intent | [Cards](transcript-cards.md), [scroll/focus](transcript-interaction.md), [composer](composer.md) |
| Rust host | Window/token ownership, pipes, shutdown and file validation | [Projects/sessions](projects-and-sessions.md), [Pi transport](pi-transport.md) |
| Settings/state | JSONC preferences and separate app-managed bookkeeping | [Preferences](preferences.md) |
| Native integrations | Startup, references and notifications | [Startup](single-instance.md), [pop-outs](pop-outs.md), [notifications](notifications.md) |

There is no extra Node backend; Pi itself requires Node. The reducer and request correlation remain TypeScript so response snapshots apply synchronously in the ordered channel before later events. Rust validates the outer framing/record, TypeScript validates relevant Pi payload content. Small TS/Rust launch/packet shapes are hand-maintained; Pi's open-ended payload remains JSON.

## Cross-cutting contracts

- One ordered channel carries all stdout events and responses. Synchronous snapshot application is required; Promise continuations alone can overwrite newer streaming state.
- Unknown acceptance is not rejection. Never replay a prompt; only Pi acknowledgement establishes acceptance. The composer clears immediately on submission; runtime receipts never mutate a newer draft. Failures/uncertainty report a notice without restoring the attempt, persisting submission recovery or adding a new-message gate.
- Native ownership is window/token scoped. Shutdown must observe owned-child exit before replacement launch; failed shutdown retains reservations. No OS-wide process scans or external-writer exclusion guarantee.
- Shared navigation decides membership/order/replacement; the shell owns DOM, focus, persistence and native effects. All activations request connection through the single connection coordinator.
- Routine updates preserve mounted nodes, disclosures, focus and scroll intent. Explicit resume/restart is a distinct reset boundary.
- Nimrod-generated errors share one notice store/renderer, with ownership-based placement: session notices stay in their conversation area; window/application notices use the shell strip, including Settings/dialogs. Background-session errors are not displayed or announced elsewhere. Placement, wording, deduplication and lifecycle follow the [error presentation policy](error-presentation.md); remaining producer metadata cleanup is not precedent for new surfaces.
- Preferences and bookkeeping are separate from Pi history and scoped draft storage.
- Delivery/completion never navigates itself. Explicit user navigation can connect a saved session without sending a prompt.
- Platform direction is macOS first, Linux next, Windows possibly later. Narrow native integrations must not turn macOS conventions into portable product requirements. See [verification](verification.md) for actual acceptance.

## Source provenance

Transcript/reducer/composer modules and baseline tests originated in the user's local sibling `pi-gui`, including uncommitted interaction fixes, without changing that project. The VS Code host was not copied. Nimrod owns its bridge, Pi coordinator, Rust backend, packaging and policies. `scripts/bootstrap-ui.mjs` records the one-time extraction; never rerun it as a build step or overwrite subsequent work.

## Documentation ownership

[Features index](../SKILL.md) routes tasks to current specifications. Keep shared contracts in one reference and link consumers. [User guides](../../../../docs/README.md) explain usage; [historical records](history/verification.md) preserve evidence, not current instructions. Development setup is in [Contributing](../../../../CONTRIBUTING.md).
