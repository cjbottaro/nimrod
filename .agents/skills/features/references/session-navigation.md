# Shared session navigation

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#session-navigation) retain prior execution records.

Human guide: [Projects and sessions](../../../../docs/session-sidebar.md#ordering-and-navigation).

[Copilot SDK](copilot-sdk.md) uses the same coordinator and canonical open-session
projection. Saved SDK rows restore inactive and connect only on explicit exact-ID
selection; discovery never loads them. SDK callbacks do not repeat navigation
after acceptance. Copilot SDK references use their own keys/draft scopes;
conflicting raw IDs block connection rather than switching the selected backend.

## Specification and acceptance criteria

All, Switch and cycling share one canonical projection. Navigation effects retain mounted state, all visible saved selections request the shared connection coordinator, and batched cleanup uses one connected-first replacement policy.

## Ownership and code map

- `src/session-navigation.ts`: `SessionNavigation<T>` owns private open-session membership, canonical All order, view projections/retention, counts, adjacency, selected-row presentation, presentation intents and post-removal replacement policy.
- `src/session-connection.ts`: `SessionConnection<T>` owns selected-session connection requests, in-flight deduplication, latest-selection deferral and gate-change reconciliation. It takes authoritative shell eligibility and a concrete Pi/ACP launch dispatcher, not navigation intents or feature-specific deletion events.
- `src/session-attention.ts`: arrival-order/selected-retention primitive, used only by the navigation model for shell views.
- `src/session-recency.ts`: timestamp validation/stable recency sort/monotonic timestamp and identity-bound persisted cache; navigation owns how open-session consumers use these primitives. DOM viewport anchoring/reveal remain separate effects.
- `src/main.ts`: adapts authoritative runtime state through `needsAttention`, `isWorking`, `isConnected`; applies navigation plans at `activate` and `presentConversation`. It owns DOM, focus, storage, pop-outs and common window/lifecycle gates, not ordering, replacement algorithms or deferred connection state. Backend eligibility/connect/state/stop/disconnect come from each tab's `SessionLifecycle` implementation.
- `test/session-navigation.test.ts`: deterministic small-layout traversal invariants, tie/legacy recency, membership changes, retained views/counts, selection intents (including focus-free/filter-preserving startup reveal) and connected/recency/batched cleanup.
- `test/shell.test.ts`, `test/browser/workspace-tabs.spec.ts`: cross-consumer order comparisons through the real shell, optimistic Send recency, filtered/collapsed navigation, mounted renderer/draft/focus preservation and selected-session loading/reconnect with deletion-barrier guards.

This is a project-shell navigation layer, not a generic harness protocol, event bus, application-wide store or framework dependency. Pi remains authoritative for conversation/process activity and RPC results. History discovery retains its separate saved-history membership; Resume shares the sidebar's timestamp validation/newest-first sorting primitive after open-row reconciliation, as specified in [session history](session-history.md).

## Contracts

1. `open()` is a read-only, stable insertion-order membership view for lifecycle/storage and canonical ties. Add/remove through the model; never sort/mutate this collection or use it as UI order. Session objects remain live shell-owned objects; the model does not own Pi state.
2. `all()` is the canonical most-recently-used projection. All sidebar, Switch picker, default restoration and all-open cycling consume it. `adjacent` wraps exactly this order; visible-row keyboard focus explicitly supplies the current view projection.
3. `snapshot(view, presented, selected)` captures independent ordered arrays and reconciles retained rows. Unread intentionally uses arrival order; Working filters canonical order. Outstanding counts exclude resolved retained rows and can overlap. `presented(snapshot)` returns selection only if visible; filter membership itself never launches or automatically selects an arrival. Revealing an existing saved selection requests connection through the normal activation boundary.
4. Selection intents are named: `explicit` reveals/focuses/reconnects; `row` focuses/reconnects without scrolling an already-visible sidebar row; `startup` reveals the restored selected row once with minimum necessary sidebar scroll, without focusing or escaping the persisted filter (hidden selections and collapsed sidebars do not scroll); `restore` does not focus/reveal or escape a filter and remains the view-switching intent; `cleanup` focuses/connects without reveal; `notification` reveals/focuses/connects. Intents only govern presentation; `SelectionPlan` has no connection flag. Every activation requests connection for visible saved targets through `SessionConnection`. Explicit/row/notification targets outside the filter switch to All. The shell retains modal, lifecycle, file identity and deletion guards before applying effects. Connected/starting and unavailable targets do not launch; temporary barriers defer only the latest selected target. Gate changes reconsider only deferrals, never retry failed launches or disconnects.
5. Close and definitive batched deletion capture a pre-removal snapshot and resolve `replacement` after all removed entries are detached. A surviving selection stays. Otherwise choose the most recently used connected session in the current view, then the most recently used connected session across All, then the most recently used remaining session in the current view, then the most recently used remaining session across All. Every preference uses canonical All recency order (including stable insertion-order ties), even in Unread's arrival-ordered view; inactive fallback does not use row adjacency. Fall back to All only when its candidate wins; no survivors means no selection. Both actions reconnect a selected inactive saved replacement immediately unless its own file remains deletion-locked; there is no app-wide deletion launch barrier. Neither creates a new conversation, marks recency or replays prompts.
6. Creation and locally submitted messages use `nextRecency` immediately, following the [optimistic interaction policy](architecture.md#optimistic-interaction-policy). Send marks use once, before image preparation or RPC results; errors never roll it back. The current All/Working list scrolls to the top, while Unread preserves arrival order/scroll. Selection/plans, snapshots, background output, renaming, compaction, RPC results and history never mark live use. Existing cache/history seed validation and first-save promotion are unchanged.
7. Snapshot arrays capture order/membership, not deep copies of runtime objects. Consumers cannot mutate internal order through `all`/`visible`; do not hold snapshots across unrelated asynchronous navigation. Removal snapshots retain the prior selection so cleanup can preserve it if it survives; fallback ranking uses post-removal canonical recency and current-view membership.

## Adding navigation consumers

Choose an existing projection and named presentation intent, then use the shell's `activate` boundary. Do not directly present a selected session, launch it from navigation callers, maintain a feature-local pending target, introduce a separate sort, use a positional index into lifecycle `open()`, or add a reconnection opt-out. New launch barriers belong in the central eligibility adapter; signal `selectedConnection.barriersChanged()` when their state changes. Only creation/restart/recovery operations own explicit lifecycle launches; routine renderer snapshots are not selection requests. If behavior genuinely differs (like Unread arrival order or Resume catalog history), encode and test that distinction rather than assuming all lists are interchangeable.

Test relationships: every traversal edge equals the displayed canonical projection; Switch equals All even with hidden sessions; local Send recency updates all consumers before any RPC result; cleanup resolves one post-batch target; every visible saved-session selection requests connection, with immediate unrelated cleanup reconnection and deferral only for affected-file locks. Keep concrete shell/WebKit coverage to prove consumers use the model; pure policy tests alone cannot detect shell bypasses.

Built-in [Copilot restoration](copilot-sdk.md#identity-history-and-drafts) uses the same startup activation boundary as Pi: the one restored selection requests connection, while restored background rows remain disconnected. Pending Copilot reload cleanup is a blocked gate reconciled on `copilotReady`, not a reason to spawn another agent or replay navigation. Failed loading waits for explicit retry, with no automatic retry on snapshots. Shared `SessionLifecycle.connection` supplies live connectivity independently of persisted membership; `eligibility()` is a coordinator decision that may treat an in-flight startup as already satisfied, not a user-facing Connected claim.

## Connection-coordinator tests

`test/session-connection.test.ts` uses feature-independent eligibility states to cover ordinary connection, empty/unavailable/connected targets, gate deferral, latest-selection wins, hidden/removed targets, quarantine, independent connection, in-flight deduplication, sibling independence and failed-launch no-retry. Existing shell tests establish that navigation intents and Close/deletion/notification/view consumers actually use the common boundary. This is a project-shell connection effect owner, not a generic harness protocol or event bus.

## Storage and acceptance

No schema/key migration for existing Pi entries: `nimrod.tabs.v1:<cwd>`, recency cache, sidebar view and Pi file ownership remain compatible. Built-in Copilot adds a tagged layout-entry variant and project/profile-qualified active/draft keys as specified in [Copilot restoration](copilot-sdk.md#identity-history-and-drafts); these IDs never use the Pi recency/file cache. Existing legacy `attention` migration stays in project restoration. Native Copilot message validation and draft-scope support are integration-owned.

Run `mise run test` and `npm run test:browser`. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow). Unit/jsdom/offline WebKit tests do not establish native focus/shortcut or Linux acceptance. Never launch/interrupt the user's app, mutate user sessions or request live models for this refactor.
