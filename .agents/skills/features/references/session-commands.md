# Required session command consumer port

**Status: source implemented; new/updated offline fixtures authored, not run.**
[Verification](verification.md#session-command-port) owns executed evidence.
The [slash-commands skill](../../slash-commands/SKILL.md) owns implementation
workflow, command-card behavior, audits and concrete compatibility matrices.

## Consumer and ownership

`HarnessSession.commands: SessionCommands` is mandatory for every registration,
including retained ACP and fixture integrations. The registry forwards the live
port, including prototype implementations. The mounted composer receives it
through `ConversationViewHost.commands`; only legacy standalone renderers may
omit it and retain their old interaction-policy submission path. No product
session uses that fallback. Shared consumers never identify a harness or parse
its native command result.

This is an internal consumer interface, not a common wire protocol or a promise
of identical command catalogs. A named `unsupportedCommands(reason)` supplies an
empty catalog and explicit rejecting invocation for integrations without commands.
Do not satisfy the port with a success-shaped no-op.

## Contract

`src/session-commands.ts` owns:

- `catalog()` returns a cached `{revision, commands}` metadata snapshot. Revisions
  change when metadata changes; aliases are expanded only for suggestions.
  Names, descriptions, source, argument hints/literal choices and advertised
  live-use metadata remain integration-owned. Discovery never executes commands.
  `source: 'Skill'` marks a directly invocable skill, not a command that reports
  on or manages skills. The [skills browser](composer.md#skills-browser) projects
  these canonical entries from the same required catalog used by composer
  completion, without a separate discovery or execution port.
- `validate(text)` is synchronous and side-effect-free. Rejection retains the
  draft. After validation, the composer clears only the submitted draft and
  calls `invoke({id,text})`, without an ordinary user preview, Send recency or
  forced transcript navigation. Arguments retain internal/trailing whitespace;
  a concrete command adapter may validate its documented grammar.
- `invoke()` creates one Command card synchronously on acceptance. Its promise
  waits for that operation's execution/interaction to settle, not just for a
  transport response. Consumers read `operations` for the actual outcome.
- `operations` is a stable immutable-by-convention array until changed. It uses
  existing operation phases/placement and optional typed `commandOutput` parts,
  rendered inside the same retained card. No command output is fabricated as
  harness history. Invocation completion alone does not confirm a semantic
  mutation.
- `cancel(key?)` withdraws undispatched work; possible dispatch retains an honest
  unknown outcome. `SessionCommandQueue` serializes accepted intents and calls
  an integration-supplied readiness predicate on authoritative updates. No
  polling, implicit Stop/reconnect, ambiguous replay or prompt fallback.

`bindSessionCommands` captures one concrete owner for each invocation, while
catalog and availability getters follow explicit replacement connections.
Readiness, current advertisement/choices and selected arguments are revalidated
by the owning integration immediately before native mutation. A newer draft,
selected session or replacement connection is never the target of an old result.
Stop, session hiding and disposal cancel command interactions; disconnection
settles pending work as not applied and dispatched work as unknown.

The queue's `applying` phase includes collecting input, invoking and confirming;
all remain pending/pinned. It does not expose fictional native lifecycle phases.
Only pre-dispatch cancellation is shown on a Command card. Card cancellation
routes through the required port, not session configuration execution.

## Concrete mappings

| Owner | Mapping / authoritative boundary |
| --- | --- |
| Copilot | Native SDK command discovery/invocation and typed effects stay in `src/copilot/`. Existing live-use metadata decides dispatch. Generic output moves into the retained card; explicit agent prompts retain their command transition separately from native conversation turns. Copilot-specific adapters remain concrete. |
| Pi | Dynamic Pi catalog plus supported `/name` and `/compact` entries. Commands wait for main-agent idle and configuration readiness. Rename uses Pi's naming RPC; compaction uses native compact lifecycle. The [MCP inspector](mcp-inspector.md) is an independent session action. Other advertised commands use Pi's supported prompt RPC command entry point, never an unknown-command chat fallback. Recognized dispositions report handled versus accepted agent work; state/model reads reconcile projections without claiming arbitrary extension effects were proven. |
| Codex | Integration-owned client catalog, not a fabricated app-server command API. `/model` uses native model discovery and the same concrete configuration adapter as controls, without dispatching their action or creating a second configuration operation. `/rename` uses exact-thread naming; `/compact` waits for native compaction item/turn confirmation. These mutations wait for idle. Native-backed live report commands expose explicitly bounded read-only subsets. Exact result/effective state is required; the [Codex matrix](../../slash-commands/references/codex.md) owns the full supported catalog and omissions. |
| Retained ACP | Agent-advertised commands only, native `session/prompt` dispatch and terminal-turn result; no synthetic user preview or invented effects. Idle-only acceptance remains ACP-specific. No current product entry point. |

Codex's detailed mappings and limits live in its
[compatibility matrix](../../slash-commands/references/codex.md). Pi and Copilot
matrices own their known built-ins/classes and remaining acceptance gaps.

## Code and evidence map

- `src/session-commands.ts`: required port, metadata/parser, alias suggestions,
  replacement-safe binding and shared FIFO operation mechanics.
- `src/command-interaction.ts`: shared guarded selection/input modal mechanics;
  concrete owners retain response/provenance and native execution semantics.
- `src/harness-contract.ts`, `harness-registry.ts`, `main.ts`: required registration,
  live forwarding, composer binding and card cancellation routing.
- `src/conversation-view.ts`: port-based slash validation/invocation and retained
  output bodies. Existing transcript placement/follow/focus owners are unchanged.
- Concrete `session.ts` and `integration.ts` files: catalog, dispatch, reconciliation,
  teardown and current-generation availability.
- `test/session-commands.test.ts`: catalog revisions/aliases/literal arguments,
  owner replacement, FIFO, cancellation, output identity and uncertainty.
- `test/harness-contract.types.ts`, `harness-registry.test.ts`: required-port and
  prototype forwarding; dependency gate still excludes concrete authority imports.
- `test/conversation-view.test.ts`: actual shared composer routing, rejection,
  no ordinary Send effects, retained card/output/newer draft/focus.
- `test/codex-session.test.ts`, `session.test.ts`, `copilot-commands.test.ts`:
  concrete native mapping, safe cancellation, queued readiness and output ownership.

These are offline fixtures, not installed-runtime/native acceptance. Tests,
checks beyond the mandatory post-merge check, builds, live CLI probes and model
work remain request-only under repository policy.
