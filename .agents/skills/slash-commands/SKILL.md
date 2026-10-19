---
name: slash-commands
description: Design, implement, debug, audit or review slash commands for any Nimrod harness. Use for command discovery, autocomplete, invocation, results/effects, UI reconciliation, operation cards, compatibility audits and narrow harness adapters.
---

# Harness slash commands

## Purpose

Use this skill for slash-command work across Pi, Copilot, curated future
integrations and generic ACP agents. It owns the implementation workflow,
decision criteria and cross-harness review checklist. It does not define a
universal harness wire protocol or duplicate concrete command catalogs.

Read repository `AGENTS.md`, `README.md`, the
[features skill](../features/SKILL.md), and:

- [Architecture](../features/references/architecture.md)
- [Harness command ownership](../features/references/harness-presentation.md#harness-command-ownership)
- [Composer](../features/references/composer.md)
- [Operation cards](../features/references/operation-cards.md)
- [Command interactions](../features/references/command-interactions.md)
- [Error presentation](../features/references/error-presentation.md)
- [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md)

Then load only the concrete harness reference needed. For Copilot, use
[Copilot commands](../features/references/copilot-commands.md) and the
[SDK boundary](../features/references/copilot-sdk.md). Pi command behavior stays
behind Pi's native RPC/view policy and feature-specific references such as the
[MCP inspector](../features/references/mcp-inspector.md). Generic ACP uses only
agent-advertised commands.

## Harness compatibility matrices

Every product-supported harness with slash commands must have a matrix reference
here before command support is considered characterized. The matrix records
catalog provenance, generic coverage, UI/state impacts, adapters, evidence and
remaining gaps. Dynamic catalogs still need a matrix for their command classes
and known built-ins; do not pretend a snapshot is exhaustive forever.

| Integration | Compatibility matrix | Product status |
| --- | --- | --- |
| Pi | [Pi slash commands](references/pi.md) | Current flagship integration |
| Copilot | [Copilot slash commands](references/copilot.md) | Current built-in SDK integration |
| Generic ACP | [Generic ACP command baseline](references/generic-acp.md) | Retained internal baseline; no current product entry point |

When adding another supported harness, create `references/<harness>.md` and add
it to this table. Concrete feature references continue to own protocol details;
the matrix links them rather than duplicating full lifecycle specifications.

## Non-negotiable ownership

Harness slash commands and Nimrod actions are separate entry points even when
they have the same visible purpose.

- Execute slash commands through the owning harness command interface.
- Never replace `/model`, `/permissions`, `/mcp` or another harness command with
  a Nimrod action.
- Never implement a Nimrod action by submitting slash text.
- Shared Nimrod pickers and operation cards may present harness work; UI reuse
  does not change ownership.
- Harnesses remain authoritative for command meaning, arguments, persistence,
  effects and lifecycle.

Prefer generic metadata/results/effects. Add a concrete adapter only for an
observed supported-interface gap, and keep that adapter inside the owning
integration. Command-name-specific code is a last resort, not the starting
architecture.

## Command lifecycle

Implement the complete lifecycle rather than treating invocation as submission
of an ordinary prompt:

1. **Discover** advertised canonical names, aliases, descriptions, kind,
   argument metadata, choices and live-use capability.
2. **Validate locally** against the current catalog and connection before
   clearing the submitted command.
3. **Accept intent** into the harness command operation lifecycle. Do not create
   an ordinary user turn, Send recency effect or forced transcript navigation.
4. **Collect interaction** from advertised choices or typed result requests
   using shared modal mechanics. Escape invokes nothing when no mutation was
   dispatched.
5. **Invoke exactly once** with the original harness command and exact selected
   argument. Never retry after ambiguous delivery.
6. **Interpret typed results/effects** exhaustively. Unknown results fail
   explicitly; never fall back to chat.
7. **Reconcile affected consumer state** from authoritative events or reads.
8. **Settle the operation card** only when the command's promised semantic
   outcome is confirmed, failed or honestly unknown.

A transport result named `completed` proves only that command invocation
finished. It does not prove that a requested model, permission, title, mode,
directory or other state change occurred.

## Generic result handling

Build one handler per stable semantic result/effect type, not per command name:

- Literal or Markdown command output.
- Completion with optional output.
- Advertised subcommand selection.
- Harness-requested dialog/picker.
- Explicit agent prompt.
- Typed host effect with apply/cancel finalization.
- Timeline/status entry.

Commands composed from supported types should work without new code. Preserve
raw values and harness labels; do not infer executable actions from prose.
Unknown/malformed results remain unsupported until their contract is
implemented.

## Command cards

Every accepted slash command starts with an operation lifecycle, but its settled
presentation is a specialized **Command card**, not a requirement that every
result resemble a configuration-change card.

The Command card owns one invocation from accepted intent through terminal
outcome:

- Create it immediately after local validation accepts the command.
- Retain one stable card/key while queued, collecting interaction, waiting for
  harness readiness, invoking and settling.
- Keep it in the shared bottom-pinned stack while any accepted work remains
  pending, including a human picker/input or a harness-required idle boundary.
- Shimmer only its command title while pending.
- Put typed command results into that same card rather than appending a separate
  request card and response row.
- Preserve the command text, ordering, reader intent, focus and newer drafts.
- Keep command output connection-local; never manufacture harness history.

Settled presentation adapts to the semantic result:

| Result | Command-card presentation |
| --- | --- |
| Text/Markdown report | Result body inside the retained card |
| Confirmed state change | Compact command plus harness confirmation when useful; authoritative UI projections update separately |
| Known rejection | Concise wrapping harness error inline |
| Output-free completion | Minimal settled command card |
| Agent prompt | Card records the command transition; actual user/assistant turns remain separate harness conversation history |
| Unknown/not applied | Explicit operation outcome and diagnostic Details |

This specialization reuses operation-card identity, pending placement,
cancellation, settlement, failure/uncertainty semantics and accessibility. It
does not force reports, state changes and agent prompts into identical terminal
layouts. A slash command is one operation, so separate request/response cards
are inappropriate unless the harness actually reports independent operations.

### Deferred execution and readiness

An accepted slash command should execute as soon as its concrete harness
semantics permit; immediate dispatch is not required. Acceptance creates the
Command card immediately, while the owning integration waits for an
authoritative readiness transition.

- Pending cards remain pinned and shimmering while queued, collecting required
  user interaction, or waiting for the harness's supported dispatch boundary.
- Dispatch at the earliest safe boundary reported by the concrete integration:
  for example terminal idle, or an advertised live-use capability.
- Do not poll, stop work, reconnect, submit a hidden prompt, replay the command
  or treat a child/intermediate idle event as readiness unless the harness
  contract explicitly does.
- Preserve accepted FIFO ordering within one command owner unless that harness
  defines independent semantic domains. An independent live-capable owner may
  bypass an unrelated queue only when the concrete contract guarantees it.
- A command accepted during work remains bound to its originating session and
  exact advertised command/arguments. Revalidate catalog and choice provenance
  immediately before dispatch.
- Cancellation removes the pinned card only while the entire command can still
  be withdrawn. After possible dispatch, retain the honest confirmed or unknown
  outcome.
- On terminal success/failure/known cancellation, unpin the retained card and
  place it in normal transcript flow at its ordered settlement boundary. Later
  output never drags it back to the bottom.

`/permissions <setting>` is the reference specialized case. The slash command
must remain a Command card even if a separate permission-policy executor handles
readiness, mutation and authoritative reconciliation. If Copilot advertises
live use, dispatch at that supported boundary; otherwise keep the card pending
until terminal idle. Nimrod's **Select permissions…** action is a separate entry
point and may use a Permission-change operation card. Shared execution code does
not merge their presentation identities.

## UI effects and authoritative reconciliation

Some commands only render output; others affect Nimrod projections. Never parse
displayed output to infer state. Route confirmed state through the same
consumer-oriented projection used elsewhere, without dispatching the
corresponding Nimrod action.

Common affected domains:

| Domain | Authoritative source |
| --- | --- |
| Model, effort, mode, context tier | Harness configuration event/snapshot |
| Permissions | Harness permission-policy event/read |
| Session title/identity | Harness lifecycle event/read |
| Command catalog | Fresh advertised catalog |
| Usage/context metrics | Harness metrics/context read |
| Saved history/session list | Harness history source |
| Working directory | Supported concrete harness/native lifecycle only |

Prefer authoritative harness events. If the public interface omits an event,
perform the narrow supported read after mutation. Do not update shared UI state
speculatively. A state-changing command remains pending until its concrete owner
confirms the effect; uncertainty uses **Outcome unknown** and may require
disconnect/reconnect for authoritative recovery.

Command output can arrive before terminal settlement. Capture the pre-result
transcript boundary so the settled command card precedes its own output.
Preserve reader position, auto-follow intent, focus and newer drafts.

## Narrow adapter criteria

Add an adapter only when all are true:

1. The command is advertised by the harness.
2. Generic metadata/results/effects cannot express required behavior.
3. The missing behavior is observed in a pinned supported interface/version,
   not inferred from terminal appearance alone.
4. A public supported harness API can complete or reconcile the semantics.
5. The adapter can be bounded without parsing prose, guessing grammar or
   substituting a Nimrod action.

Use the narrowest discriminator available:

1. Typed result/effect.
2. Stable command kind plus semantic metadata.
3. Canonical command name only as a documented last resort.

Explicitly validate aliases, arguments, enabled capabilities and current
catalog state. Pass richer syntax through untouched when its grammar is not
public. Record the exact interface gap and removal condition so a later
SDK/agent improvement can retire the adapter.

## Compatibility audit

Do not discover exceptions by blindly invoking every command. Commands can
alter settings, files, sessions, authentication, permissions or external
resources.

For a harness/version audit:

1. Capture the advertised catalog and refresh behavior.
2. Classify commands as presentation-only, state-mutating, destructive,
   model-backed or externally contacting.
3. Probe only explicitly allowlisted, provider-free commands in isolated
   fixture storage.
4. For unsafe/stateful commands, use manual or separately authorized bounded
   probes.
5. Compare bare invocation, explicit valid argument, invalid argument,
   cancellation and advertised busy behavior with the harness's native client.
6. Record metadata, typed result, subsequent events, settings/state reads and
   whether promised semantics actually occurred.
7. Create sanitized offline fixtures for every confirmed generic shape or gap.

Maintain a compatibility matrix:

| Command | Metadata sufficient | Result sufficient | Confirmed state | Missing host behavior | Adapter |
| --- | --- | --- | --- | --- | --- |
| Harness command | Yes/No | Yes/No | Event/read | Exact gap | None/typed/narrow |

Repeat the audit on SDK/CLI/agent upgrades. An existing adapter is not proof the
new version still needs it.

## Safety and interaction invariants

- Slash commands are not ordinary prompts unless a typed command result
  explicitly supplies an agent prompt.
- Never replay after timeout, disconnect or ambiguous delivery.
- Command acceptance clears only the submitted command; later results never
  replace a newer draft.
- Images/attachments remain rejected unless the concrete command contract
  supports them.
- Background results and modal choices stay bound to the originating session;
  they never navigate or steal focus.
- Busy behavior comes from the concrete harness. Queue accepted command intent
  and keep its Command card pinned only when the integration documents that
  lifecycle/readiness.
- Unknown effects do not become success-shaped output.
- Operation-specific failures belong on the operation card, not duplicated in a
  session notice.
- No paid requests, external side effects, user-session deletion or live
  configuration mutation without explicit authorization.

## Implementation checklist

Before editing:

- Identify the command owner and supported discovery/invocation API.
- Locate existing generic result handlers and consumer projections.
- Determine whether the change affects transcript order, drafts, focus, scroll,
  permissions, configuration, identity, history or process ownership.
- Capture actual metadata/result evidence for a proposed exception.

During implementation:

- Keep command-name checks out of shared UI/renderers.
- Put concrete adapters in the owning harness integration.
- Revalidate catalog/choice provenance immediately before invocation.
- Separate invocation completion from semantic completion.
- Publish confirmed changes through existing consumer ports.
- Preserve exact cancellation and unknown-outcome boundaries.

Before completion:

- Update the owning harness compatibility-matrix row with implementation and
  evidence status; never leave a newly discovered gap only in task prose.
- Cover canonical name and aliases.
- Cover bare, explicit, invalid and stale input.
- Cover picker cancellation and late result suppression.
- Cover busy/queued behavior where supported.
- Cover output-before-settlement ordering.
- Cover authoritative event/read reconciliation.
- Assert no ordinary prompt and no overlapping Nimrod action dispatch.
- Document actual evidence versus unrun fixtures/native acceptance.
- Update the concrete user guide for observable behavior and the changelog for
  meaningful behavior changes.

Repository policy still controls validation: tests/builds/app launches are
request-only; the mandatory post-merge `mise run check` is the sole automatic
exception.
