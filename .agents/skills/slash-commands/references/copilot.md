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
| `/allow-all` | `/yolo` | Permission policy | **Generic observed**: on/off return text plus authoritative permission events; show remains report output |
| `/autopilot` | `/goal` | Mode, objective, limits, activity | Unaudited; state-changing and model-backed |
| `/blame` | — | Transcript output, linked sessions | Unaudited |
| `/chronicle` | — | History reports/search/index | Unaudited; advertised subcommands, some potentially model-backed/stateful |
| `/compact` | — | Context/history/usage | Unaudited; model-backed compaction requires separate authorization |
| `/context` | — | Transcript-only context report | **Generic observed**: typed text output renders correctly; no adapter |
| `/cwd` | `/cd` | Working directory, permissions, project ownership | Unaudited; high-risk semantic conflict with Nimrod's one-directory-per-window contract |
| `/env` | — | Transcript environment report | **Generic observed**: Markdown text output; no state events or adapter |
| `/every` | `/loop` | Recurring harness work | Unaudited; free-form scheduling grammar |
| `/fleet` | — | Agent orchestration/activity | Unaudited; model-backed |
| `/init` | — | Repository instructions/files/settings | **Partial/generic observed**: bare returns typed `agent-prompt`; suppress returns text without project/session files; actual model-backed initialization remains unaccepted |
| `/list-dirs` | — | Transcript permission/path report | **Generic observed**: text output; no state events or adapter |
| `/mcp` | — | MCP configuration/status | **Partial/generic observed**: `list` and no-server `show` return text with no state events; configured-server show and enable/disable/reload remain unaudited |
| `/memory` | — | Cross-session memory setting/status | **Generic observed**: show/on/off return Markdown; on/off change isolated user settings, with no Nimrod memory projection |
| `/model` | `/models` | Model, effort, defaults/Plan model | **Source implemented narrow adapter**: bare picker and exact enabled live-model completion compensate for CLI `completed` gaps; richer syntax passes through; latest native acceptance pending |
| `/permissions` | — | Permission policy | **Generic/adapter observed**: show/default use text and authoritative events; mutations retain Command-card identity while the dedicated permission owner supplies live/deferred readiness and reconciliation |
| `/plan` | — | Mode, plan lifecycle, agent work | Unaudited; overlaps implemented mode lifecycle but must remain harness-command-owned |
| `/plugin` | — | Plugin catalog/configuration | **Partial/generic observed**: `list` returns text with no state events; mutation grammar remains unaudited |
| `/remote` | — | External remote-control state | **Partial/generic observed**: `show` returns text with no state events; on/off remain unaudited and external/stateful |
| `/rename` | — | Session title/history/sidebar | **Generic observed**: text plus authoritative `session.title_changed`, consumed by existing title projection |
| `/research` | — | Model-backed GitHub/web work | Unaudited; external/model request requires authorization |
| `/reset-allowed-tools` | — | Permission/tool approvals | **Generic observed**: text plus authoritative permission event when mode resets; exact approvals remain harness-owned |
| `/review` | — | Model-backed code review | Unaudited; provider work requires authorization |
| `/rubber-duck` | — | Model-backed critique/subagent | Unaudited; provider work requires authorization |
| `/sandbox` | — | Sandbox paths/network/CA/settings | **Partial/generic observed**: status/policy and isolated enable/disable return text/Markdown; settings persist in SessionFS; config/CA remain unaudited and security-sensitive |
| `/security-review` | — | Model-backed security review | Unaudited; provider work requires authorization |
| `/session` | `/sessions` | Session metadata/checkpoints/files/title | **Partial/source implemented**: info/checkpoints/files/plan are generic text; rename needs a harness-owned free-form-name adapter |
| `/share` | — | External sharing/publication state | Unaudited; external side effect, never probe automatically |
| `/skills` | — | Skill catalog/reload | **Partial/source implemented**: list/reload are generic text, reload emits skills-loaded and command metadata refreshes; info needs a public skill-catalog picker adapter |
| `/subconscious` | — | Memory consolidation/model work | Unaudited; stateful/model-backed |
| `/usage` | — | Transcript usage report | **Generic observed**: text output; no state events or adapter |

## Confirmed interface gaps

| Command | Observed gap | Adapter boundary | Removal condition |
| --- | --- | --- | --- |
| `/model` | Bare and exact catalog invocation returned `completed`; no picker/effect/model event, and live model remained unchanged | For bare canonical builtin command, show enabled Copilot catalog; after original invocation, apply only exact enabled catalog IDs with `session.setModel()` and reconcile `model.getCurrent()` | Remove or narrow when the pinned SDK/CLI exposes picker metadata plus a confirmed live-switch effect/event |
| `/permissions <setting>` | Permission mutations need independent live/deferred readiness and authoritative policy reconciliation | Retain one pinned Command card while the dedicated permission owner invokes the exact native command and confirms policy; never substitute Nimrod's permission action | Remove when generic command effects fully expose the same readiness/reconciliation lifecycle |
| `/skills info` | Metadata advertises `info`, but omits the required second `<skill-name>` argument; direct invocation returns a usage error | Read `session.skills.list()`, present a harness-owned skill picker, revalidate the choice, then invoke exact `/skills info <name>` | Remove when command metadata/results expose the nested skill choice |
| `/session rename` | Metadata advertises `rename`, but omits the required second free-form `<name>` argument; direct invocation returns a usage error | Present the shared input modal as a Copilot-owned interaction, revalidate the command, then invoke exact `/session rename <name>` | Remove when command metadata/results expose the nested free-form input |

## Presentation compatibility

Known rejected commands use a compact red-accent operation card with the
actionable harness error inline and wrapping. SDK transport prefixes and
Nimrod retry/fallback boilerplate are removed, with no redundant **Failed**
label or disclosure. Unknown/not-applied outcomes retain explicit status and
full diagnostic Details. Source fixtures are authored and unrun; native visual
acceptance remains pending.

## Next audit order

1. Remaining provider-free/read-only: configured-server `/mcp show`, valid
   `/skills info` native acceptance, and any newly advertised report commands.
2. Remaining local state: plugin marketplace/install grammar, `/sandbox config`
   and `/sandbox ca` only with separately bounded review.
3. Lifecycle/configuration: `/autopilot`, `/plan`, `/compact`, richer `/model`
   and `/cwd`.
4. External/model-backed/destructive: scheduling, research/review agents,
   remote/share and memory consolidation—only with explicit bounded authorization.

For every audited row, record bare/explicit/invalid/cancel/busy behavior,
typed result, subsequent events, authoritative reads, transcript/UI impact and
whether a narrow adapter remains necessary.

## Executed evidence

An isolated no-prompt SDK session with a disposable custom session filesystem
executed `/usage`, `/env`, `/list-dirs`, `/permissions show`, `/session info`,
`/session files`, `/session plan`, `/session checkpoints`, `/mcp list`, no-server
`/mcp show`, `/skills list`, `/plugin list`, `/memory show`, `/remote show`, and
`/sandbox status/policy`. Every successful invocation returned typed `text`
(Markdown for `/env` and `/memory show`), emitted no command-caused state events,
made no model request and needed no output adapter. `/skills info` instead
reported its missing required skill name, establishing the nested-picker gap.
Permission callbacks were fail-closed and unexpected user input aborted the
probe. Sanitized successful shapes are retained in
`test/fixtures/copilot-read-only-commands.json`; their offline fixtures are
authored but unrun. This evidence does not cover busy/native UI behavior or
unlisted subcommands.

An authorized isolated local-state audit additionally exercised `/rename`,
`/memory on/off`, `/skills reload`, `/permissions default`, `/allow-all on/off`,
`/reset-allowed-tools`, `/sandbox enable/disable`, bare `/init` and `/init
suppress`. It used disposable Copilot home/project/SessionFS storage and sent no
model prompt. Generic text/events/settings covered all except `/session rename`,
whose omitted free-form name established the input-adapter gap. Bare `/init`
returned `agent-prompt`; the probe did not submit it. Sanitized local-state
fixtures are authored and unrun.
