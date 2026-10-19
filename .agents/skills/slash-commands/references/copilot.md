# Copilot slash-command compatibility

**Snapshot: SDK 1.0.22 / CLI 1.0.98, observed 2026-10-18.** The catalog is
runtime/account/plugin/policy dependent and must be refreshed on upgrades.
This sanitized snapshot records names and semantics only—no conversation
content. Source implementation is not native acceptance.

Canonical protocol/lifecycle: [Copilot commands](../../features/references/copilot-commands.md),
[Copilot SDK](../../features/references/copilot-sdk.md), and [verification](../../features/references/verification.md).

## Status vocabulary

- **Generic observed** — user trace demonstrated the generic path.
- **Source implemented** — implementation/fixtures exist but the current path
  has not been accepted natively after the latest change.
- **Partial** — some arguments/effects are handled; remaining variants need audit.
- **Unaudited** — advertised, but result/effect/UI parity is not characterized.

## Matrix

| Command | Aliases | Likely effect/UI domain | Current compatibility |
| --- | --- | --- | --- |
| `/add-dir` | — | Allowed paths, skills/agents catalog | Unaudited; required directory completion is not implemented generically |
| `/after` | — | Scheduled harness work | Unaudited; free-form scheduling grammar |
| `/allow-all` | `/yolo` | Permission policy | Partial; advertised choices are generic, live permission reconciliation needs audit against the dedicated `/permissions` path |
| `/autopilot` | `/goal` | Mode, objective, limits, activity | Unaudited; state-changing and model-backed |
| `/blame` | — | Transcript output, linked sessions | Unaudited |
| `/chronicle` | — | History reports/search/index | Unaudited; advertised subcommands, some potentially model-backed/stateful |
| `/compact` | — | Context/history/usage | Unaudited; model-backed compaction requires separate authorization |
| `/context` | — | Transcript-only context report | **Generic observed**: typed text output renders correctly; no adapter |
| `/cwd` | `/cd` | Working directory, permissions, project ownership | Unaudited; high-risk semantic conflict with Nimrod's one-directory-per-window contract |
| `/env` | — | Transcript environment report | Unaudited |
| `/every` | `/loop` | Recurring harness work | Unaudited; free-form scheduling grammar |
| `/fleet` | — | Agent orchestration/activity | Unaudited; model-backed |
| `/init` | — | Repository instructions/files/settings | Unaudited; stateful/destructive potential |
| `/list-dirs` | — | Transcript permission/path report | Unaudited |
| `/mcp` | — | MCP configuration/status | Unaudited; advertised subcommands, settings mutations possible |
| `/memory` | — | Cross-session memory setting/status | Unaudited; persisted setting and UI reconciliation not characterized |
| `/model` | `/models` | Model, effort, defaults/Plan model | **Source implemented narrow adapter**: bare picker and exact enabled live-model completion compensate for CLI `completed` gaps; richer syntax passes through; latest native acceptance pending |
| `/permissions` | — | Permission policy | **Partial/source implemented**: choices and show output generic; `allow-all` uses dedicated live effect/reconciliation; other variants/native acceptance pending |
| `/plan` | — | Mode, plan lifecycle, agent work | Unaudited; overlaps implemented mode lifecycle but must remain harness-command-owned |
| `/plugin` | — | Plugin catalog/configuration | Unaudited; only `list` advertised in this snapshot |
| `/remote` | — | External remote-control state | Unaudited; external/stateful |
| `/rename` | — | Session title/history/sidebar | Unaudited; requires authoritative title reconciliation |
| `/research` | — | Model-backed GitHub/web work | Unaudited; external/model request requires authorization |
| `/reset-allowed-tools` | — | Permission/tool approvals | Unaudited; stateful |
| `/review` | — | Model-backed code review | Unaudited; provider work requires authorization |
| `/rubber-duck` | — | Model-backed critique/subagent | Unaudited; provider work requires authorization |
| `/sandbox` | — | Sandbox paths/network/CA/settings | Unaudited; security-sensitive and potentially destructive |
| `/security-review` | — | Model-backed security review | Unaudited; provider work requires authorization |
| `/session` | `/sessions` | Session metadata/checkpoints/files/title | Unaudited; multiple state/read domains |
| `/share` | — | External sharing/publication state | Unaudited; external side effect, never probe automatically |
| `/skills` | — | Skill catalog/reload | Unaudited; list/info likely output, reload stateful |
| `/subconscious` | — | Memory consolidation/model work | Unaudited; stateful/model-backed |
| `/usage` | — | Transcript usage report | Unaudited; likely generic output but not yet evidenced |

## Confirmed interface gaps

| Command | Observed gap | Adapter boundary | Removal condition |
| --- | --- | --- | --- |
| `/model` | Bare and exact catalog invocation returned `completed`; no picker/effect/model event, and live model remained unchanged | For bare canonical builtin command, show enabled Copilot catalog; after original invocation, apply only exact enabled catalog IDs with `session.setModel()` and reconcile `model.getCurrent()` | Remove or narrow when the pinned SDK/CLI exposes picker metadata plus a confirmed live-switch effect/event |
| `/permissions allow-all` | Active-turn permission change needs independent readiness and authoritative policy reconciliation | Dedicated Copilot permission configuration owner invokes exact native command and confirms policy | Remove when generic command effects fully expose the same active-turn lifecycle |

## Next audit order

1. Provider-free/read-only: `/usage`, `/env`, `/list-dirs`, read-only `/session`
   variants, `/permissions show`, read-only `/mcp` variants.
2. Local state: `/rename`, `/memory`, `/skills reload`, `/plugin`, `/init`,
   `/reset-allowed-tools`.
3. Lifecycle/configuration: `/autopilot`, `/plan`, `/compact`, richer `/model`,
   `/cwd`, `/sandbox`.
4. External/model-backed/destructive: scheduling, research/review agents,
   remote/share and memory consolidation—only with explicit bounded authorization.

For every audited row, record bare/explicit/invalid/cancel/busy behavior,
typed result, subsequent events, authoritative reads, transcript/UI impact and
whether a narrow adapter remains necessary.

