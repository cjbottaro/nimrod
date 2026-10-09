---
name: features
description: Feature implementation guide for Nimrod. Load when designing, implementing, debugging or reviewing features, or updating their documentation. Use the index to read only the relevant detailed references, including session management, reload/restart, session tree deletion, pop-outs, code copying, snapshot persistence and native reference-window focus.
---

# Nimrod features

This is the shared entry point for feature implementation knowledge. Keep this
skill short; put detailed per-feature guidance in `references/` and read only the
items relevant to the task. Follow repository `AGENTS.md` and
[architecture](../../../docs/architecture.md). For UI work, also load the
[shared UI vocabulary](../nimrod-ui-vocabulary/SKILL.md).

## Feature index

| Feature / work area | Implementation reference | Human guide |
| --- | --- | --- |
| Transcript tool/reasoning cards, call-ID keyed updates/placement, tooltip-free summaries and accessible status labels | [Transcript cards](references/transcript-cards.md) | [Rendering behavior](../../../docs/architecture.md#rendering-contract-retained-from-pi-gui) |
| Customizable project/app keybindings, recorder UI, conflict reassignment, JSONC overrides and action/all reset | [Keybindings](references/keybindings.md) | [Keybindings](../../../docs/keybindings.md) |
| Composer keyboard hints, working-only follow-up queueing and delivery fallback | [Composer](references/composer.md) | [Pi-specific behavior](../../../docs/architecture.md#pi-specific-behavior) |
| Resizable session sidebar, per-project app-state width, zoom-aware drag/keyboard controls and responsive clamping | [Sidebar resizing](references/sidebar-resize.md) | [Sidebar width](../../../docs/workspace-sessions.md#sidebar-width) |
| Session sidebar All / Needs attention views, persisted last-used order and prompt-only acknowledgement-driven recency (selection/rename never reorder), viewport anchoring, stable inbox order, selected-row retention, working empty-state, blank conversation surfaces and filtered navigation | [Sidebar views](references/sidebar-attention.md) | [Sidebar views](../../../docs/workspace-sessions.md#sidebar-views) |
| Background-session desktop notifications, response previews, macOS authorization/delivery and bundle signing, test alerts/read-only foreground diagnostics, focus suppression and preferences | [Notifications](references/notifications.md) | [Notifications](../../../docs/notifications.md) |
| Session management: row-targeted sidebar trash/Delete session tree, Rust-native file preview/removal, window-scoped icon/guide-line tree review with delayed loading, affected-project locks, batch cleanup, partial outcomes and quarantined recovery | [Session deletion](references/session-deletion.md) | [Delete session tree](../../../docs/workspace-sessions.md#delete-session-tree) |
| Session management: temporary-session disposal, reload/Restart session, lifecycle ownership, exact-file resume, draft preservation, Project bar and native Open project menu | [Projects and sessions](references/projects-and-sessions.md#session-management) | [Projects and sessions](../../../docs/workspace-sessions.md#session-management) |
| Pop-outs, code Copy actions, content hashing, snapshot persistence, project/session visibility, reference-window focus and geometry | [Pop-outs](references/pop-outs.md) | [Pop-outs](../../../docs/pop-outs.md) |

Features without a reference yet: consult their existing docs and source; add a
reference when doing substantive feature work rather than inventing details.

## Keeping documentation useful

- **External docs** are user guides in `docs/`: concise usage, observable behavior and limitations.
- **Internal docs** are this features skill and `references/<feature>.md`: decisions, code map, invariants,
  data formats, concurrency/lifecycle, platform pitfalls, tests and verification gaps.
- Update the human guide and reference together when behavior changes. Keep
  implementation-only changes in the reference instead of inflating the human guide.
- Add new references to this index; link human guides from `docs/README.md` and the
  main README as appropriate. Do not create a separate skill for every feature.
- Reuse the vocabulary skill for shared UI terminology; do not duplicate its glossary.
- Keep unsupported/deferred behavior explicit. Distinguish fixture evidence from
  native/platform acceptance and follow the repository's local-testing restrictions.
