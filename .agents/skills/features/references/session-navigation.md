# Shared session navigation

Human guide: [Projects and sessions](../../../../docs/workspace-sessions.md#session-navigation).

## Ownership and code map

- `src/session-navigation.ts`: `SessionNavigation<T>` owns private open-session membership, canonical All order, view projections/retention, counts, adjacency, selected-row presentation, selection intents and post-removal replacement policy.
- `src/session-attention.ts`: arrival-order/selected-retention primitive, used only by the navigation model for shell views.
- `src/session-recency.ts`: timestamp validation/stable recency sort/monotonic timestamp and identity-bound persisted cache; navigation owns how open-session consumers use these primitives. DOM viewport anchoring/reveal remain separate effects.
- `src/main.ts`: adapts authoritative Pi/runtime state through `needsAttention`, `isWorking`, `isConnected`; applies navigation plans at `activate` and `presentConversation`. It owns DOM, focus, storage, launch guards, pop-outs and native lifecycle, not ordering or replacement algorithms.
- `test/session-navigation.test.ts`: deterministic small-layout traversal invariants, tie/legacy recency, membership changes, retained views/counts, selection intents and connected/positional/batched cleanup.
- `test/shell.test.ts`, `test/browser/workspace-tabs.spec.ts`: cross-consumer order comparisons through the real shell, acknowledged sends, filtered/collapsed navigation, mounted renderer/draft/focus preservation and no cleanup reconnect.

This is a project-shell navigation layer, not a generic harness protocol, event bus, application-wide store or framework dependency. Pi remains authoritative for conversation/process activity and acknowledgements. History discovery retains its separate scope/order.

## Contracts

1. `open()` is a read-only, stable insertion-order membership view for lifecycle/storage and canonical ties. Add/remove through the model; never sort/mutate this collection or use it as UI order. Session objects remain live shell-owned objects; the model does not own Pi state.
2. `all()` is the canonical most-recently-used projection. All sidebar, Switch picker, default restoration and all-open cycling consume it. `adjacent` wraps exactly this order; visible-row keyboard focus explicitly supplies the current view projection.
3. `snapshot(view, presented, selected)` captures independent ordered arrays and reconciles retained rows. Unread intentionally uses arrival order; Working filters canonical order. Outstanding counts exclude resolved retained rows and can overlap. `presented(snapshot)` returns selection only if visible; filtering never launches or automatically selects an arrival.
4. Selection intents are named: `explicit` reveals/focuses/reconnects; `row` focuses/reconnects without scrolling an already-visible sidebar row; `restore` does not focus/reveal or escape a persisted filter, but retains the existing selected-All startup reconnect; `cleanup` focuses without reveal/reconnect; `notification` reveals/focuses without reconnect. Explicit/row/notification targets outside the filter switch to All. The shell retains modal, lifecycle, file identity and deletion guards before applying effects.
5. Close and definitive batched deletion capture a pre-removal snapshot and resolve `replacement` after all removed entries are detached. A surviving selection stays. Otherwise prefer connected current-view candidates in canonical recency order, then connected All, then positional next/previous in the prior displayed view, falling back to All. Automatic replacement never creates/reconnects a process, marks recency or replays prompts.
6. Creation and Pi-acknowledged prompts use `nextRecency`; selection/plans, snapshots, background output, renaming, model/control acknowledgements and history never mark live use. Existing cache/history seed validation and first-save promotion are unchanged.
7. Snapshot arrays capture order/membership, not deep copies of runtime objects. Consumers cannot mutate internal order through `all`/`visible`; do not hold snapshots across unrelated asynchronous navigation. Removal snapshots are deliberately retained for positional fallback.

## Adding navigation consumers

Choose an existing projection and named selection intent. Do not introduce a separate sort, a positional index into lifecycle `open()`, or a boolean reconnection flag. If behavior genuinely differs (like Unread arrival order or Resume catalog history), encode and test that distinction rather than assuming all lists are interchangeable.

Test relationships: every traversal edge equals the displayed canonical projection; Switch equals All even with hidden sessions; acknowledged recency updates all consumers; cleanup resolves one post-batch target and cannot reconnect. Keep concrete shell/WebKit coverage to prove consumers use the model; pure policy tests alone cannot detect shell bypasses.

## Verification

Shared navigation verification (`.worktrees/session-navigation`, branch `refactor/session-navigation`): `mise run check` passes 366 TS/Node tests, formatting/Clippy and 93 Rust tests (two opt-in Pi smokes ignored); the signed macOS build verifies and all 37 offline WebKit tests pass. The first full check hit the existing single-instance lock-holder timeout fixture's `Option::unwrap()` failure; its focused retry and complete check rerun passed without any Rust change. The new WebKit invariant compares All/Switch and both wrapped traversal directions through creation and acknowledged-message recency. No primary bundle/user app, live Pi/models, real session deletion, upstream extension, commit or push was touched. Native focus/shortcut and Linux/possible Windows acceptance remain separate.

## Storage and acceptance

No schema/key migration: `nimrod.tabs.v1:<cwd>`, recency cache, sidebar view, drafts and Pi file ownership remain unchanged. Existing legacy `attention` migration stays in project restoration. No Rust/native integration changes.

Run `mise run check`, `mise run build`, and `npm run test:browser`. Unit/jsdom/offline WebKit tests do not establish native focus/shortcut or Linux acceptance. Never launch/interrupt the user's app, mutate user sessions or request live models for this refactor.
