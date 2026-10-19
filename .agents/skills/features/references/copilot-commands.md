# Copilot SDK slash commands

**Status: source implemented; authored offline fixtures unrun.** No app launches
or model requests were performed for the argument-picker follow-up. A sanitized
user-observed installed-CLI trace supplies the bare `/model` result evidence
described below; the released `@github/copilot-sdk@1.0.22`
declarations/implementation remain the API evidence, not repository-main
documentation or native acceptance.

## Ownership and scope

Composer slash commands belong to Copilot. Discover them through public
experimental `session.rpc.commands.list()` and execute through
`session.rpc.commands.invoke({name,input})`. Never send unknown slash text as
an ordinary prompt, substitute a Nimrod action, or retry an invocation after
failure/ambiguous delivery. Palette/keybindings/Status-area controls retain
Nimrod-owned dispatch. Reusing the palette's modal mechanics for a returned
selection is presentation reuse, not application action dispatch/ranking.

The shared [harness command ownership
policy](harness-presentation.md#harness-command-ownership) applies. Concretely,
**Select model…** uses Nimrod's session-configuration port, while Copilot
`/model` is invoked and completed through Copilot's command protocol. Neither
entry point redirects to or impersonates the other.

The pinned CLI's builtin `model` command is one such narrow exception. CLI 1.0.98
advertises canonical `/model` with alias `/models` and a free-form `model` hint,
but a bare SDK invocation returns only `completed`; the terminal UI's catalog
picker is not projected through command metadata or results. For a bare
advertised builtin model command, Nimrod presents Copilot's enabled model catalog
and then invokes that same harness command with the selected model ID. Explicit
arguments still pass through untouched. This is not Nimrod's **Select model…**
action: Copilot still parses the argument and owns its settings/effect transaction.

This feature applies to **Copilot SDK sessions**. Pi's existing `/name`,
`/compact` and bare `/mcp` interception remains unchanged; removing it requires a
separate Pi contract change. Generic ACP keeps advertised-only passthrough; the Copilot ACP integration has been removed.

New commands using implemented metadata/result shapes work without command-name
handlers. This is not universal CLI/TUI parity. Generic command execution remains idle-only, but advertised command intent is accepted during work and queued locally. The deliberate exception is advertised builtin `/permissions allow-all`: the [live permission configuration adapter](live-permissions.md) accepts it during work, honours `allowDuringAgentExecution`, and executes the exact native command through its own configuration owner. It neither sends a steering prompt nor invents a host permission policy.

## Discovery and autocomplete

- List commands after connection, after successful invocation, and when a root
  `commands.changed` event arrives. That event's payload lists registered SDK
  commands only, so refresh the full catalog rather than replacing it with the
  event payload. Share an in-flight read; never invoke commands during discovery.
- Discovery failure clears slash suggestions, reports a session-owned notice and
  leaves ordinary chat available. Reconnect or a subsequent catalog refresh can
  restore suggestions. Invocation independently checks fresh SDK advertisement.
- Retain names, aliases, descriptions, kind, input hint/required flag and literal
  choices/descriptions. Names/aliases are matched case-insensitively; canonical
  names win over conflicting aliases. Preserve complete raw argument text,
  including internal/trailing spaces and newlines, after the first delimiter.
- Shared slash suggestions handle command names and full argument prefixes while
  the caret is at the draft's end. Hints remain visible without selectable rows;
  they never consume Enter. No inferred grammar, dynamic argument callbacks or
  directory completion is claimed. SDK directory-completion hints are not yet
  implemented; free-text remains available.
- Tab/click and Enter on a typed argument accept suggestions only. Arrows select
  a choice; Enter on a blank argument without arrow selection submits the command
  intent. If the command advertises literal argument choices, an empty argument
  opens the shared palette-style picker **before any SDK invocation**. Escape
  invokes nothing; selection invokes the command once with that exact argument.
  This applies to all advertised choices, not a `/permissions` name special case.
  Required finite-choice input can also be supplied this way. Explicit arguments
  bypass this picker; commands without choices keep their SDK default behavior.
  The documented builtin `/model` exception supplies Copilot's catalog because
  its bare SDK invocation otherwise completes without exposing the CLI picker.
  Escape dismisses suggestions; IME/modifier and mid-draft editing are unchanged.
- Local validation precedes draft clearing for unavailable sessions,
  unadvertised commands, required input and attachments. No optimistic literal
  slash user turn, Send-recency bump or forced transcript navigation. Clear the
  submitted command immediately; later output/errors never replace a newer draft.

## Result vocabulary

| Released SDK result | Current handling |
| --- | --- |
| `text` | Labelled `command` transcript row; Markdown only with `markdown:true`, otherwise literal preformatted text. ANSI is literal, not terminal execution/styled ANSI parity. |
| `add-timeline-entry` | Labelled command row with supplied text/URL; no inferred assistant message or automatic link activation. Suggested prefill never overwrites a newer draft; report its omission. Remediation actions are not executed. |
| `completed` | Finish; display optional message as command output. No fabricated model response or completion notification. |
| `select-subcommand` | Validate supplied title/parent/options; open a standalone shared selection modal. Display descriptions/group labels, arrows/Enter select, Escape cancels. Invoke only the exact offered argument against the same session. |
| `agent-prompt` | Only an interactive/unspecified-mode result may submit its actual returned prompt. Display its supplied display prompt and optional notice. Never treat command invocation failure as this result or send twice. |
| `show-dialog` | Model-picker requests can present the reported enabled-model catalog and return the selection to the originating command, including settings scope/target metadata interpreted by that command. Model enabling and other dialog kinds remain unsupported. |
| `set-model` | The bridge applies the command-selected live model/effort/Auto tier, reads authoritative state, then calls the SDK's public experimental invocation-effect finalizer with the original effect unchanged. Invalid effects finalize as cancelled; mutation/finalization uncertainty disconnects for explicit reconciliation. This does not dispatch Nimrod's **Select model…** action. |
| `set-plan-model` | The command's provisional future Plan-model preference is finalized through the same SDK effect transaction and its confirmation is displayed. It does not change the active model or dispatch a Nimrod action. |
| Unknown/malformed result or unknown mode | Session-owned error; no speculative prompt/action or automatic replay. Supported Interactive, Plan and Autopilot changes reconcile through the session mode configuration; unknown values disconnect before follow-on work. |

Supported permission mutation uses one **PERMISSION CHANGE** operation card instead of a duplicate command-output row. Choosing `allow-all` in the existing argument/result-choice workflow converges on that same owner. Native policy confirmation, pending-callback retention and failure/uncertainty semantics are specified in [Live permissions](live-permissions.md).

Command-output rows are **connection-local presentation**, not invented persisted
Copilot events. They survive switching within that connection, not Close/Resume.
The command operation captures the non-sticky transcript boundary when intent is
accepted, so its settled card remains immediately before result rows produced by
that command rather than anchoring after them.
The normal transcript renderer owns escaping, Markdown, stable keys, reading
intent and hidden-view catch-up. Do not synthesize assistant history or write
SDK session files to persist local output.

## Choice lifecycle and concurrency

`CopilotCommandQueue` owns a connection-local FIFO of validated command intents. Accepting an advertised command clears the composer immediately, even during agent work or another command workflow. Unknown commands, required free-text input and attachments still fail before clearing. Ordinary text/image prompts retain their busy rejection; this is not SDK prompt steering/queueing.

Each intent immediately publishes a **COPILOT COMMAND** operation card containing the exact submitted text. Its immutable progress records reuse the existing local operation projector/renderer through `configurationOperations`; they are not configuration mutations or persisted harness rows. Unchanged streaming publications preserve the combined array identity. The queue owns execution/settlement separately from configuration owners; no per-card cancellation capability is advertised. Failures/uncertainty belong to this card, without duplicate submission-error notices. Local acceptance receipts are not invocation completion.

Drain one workflow at a time when connected, root-terminal-idle and free of configuration/permission mutation. Child idle and non-aborted Autopilot intermediate idle never release the queue. Commands queued before idle take priority over deferred model changes; the independent live permission owner remains able to apply during work. Revalidate the catalog before starting each workflow; the bridge revalidates again and rejects an idle-to-busy race before invoking. A rejected/ambiguous dispatch is never retried. The exact advertised name/alias and raw arguments stay intact: `/allow-all` is not rewritten into `/permissions allow-all` or a Nimrod action.

Each command workflow owns an AbortController and serializes its own invocations.
Advertised argument choices are available before invocation and must not require
executing a bare command to discover its default behavior. Separately, waiting
for a returned `select-subcommand` choice is result-gated because those choices
are unavailable before invocation. Neither path gates clearing the composer on RPC.
Ordinary message submissions and model mutation remain locally unavailable until queued command workflows settle; further advertised commands can queue. Live permission intent may be accepted while it waits for the active command owner to finish; the draft stays editable. Ordinary agent turns retain SDK `session.idle`
semantics, separate from local command completion.

Returned choices open only for their still-presented, connected owner with no
Settings or other modal open. They never replace another interaction. Reusing
`startSelection(..., standalone:true)` hides application Back/Retry and preserves
close-time focus restoration, filtering, Escape and stale-page suppression.
Acceptance runs after native dialog close restoration; there is no nested picker
stack, new dialog key handler, or palette command usage entry.

Switching away, Stop or Close withdraws all undispatched command intents and aborts the active workflow/open picker. Disconnect/reconnect disposes the queue: undispatched cards become Not applied, dispatched unfinished cards become Outcome unknown. Nothing is replayed on a new connection. User cancellation removes safely undispatched cards; already-dispatched work retains uncertainty when its outcome is not known. Late results/choices cannot reopen a modal, invoke another command,
write a draft or act on the newly selected session. An already-dispatched command
may have executed; cancellation only suppresses follow-on effects and never
claims rollback. No timer covers human think-time; only actual bridge requests
use the existing bounded request timeout/unknown-outcome disconnect contract.

## Code map and authored coverage

- `copilot/bridge.mjs`: public SDK discovery/invocation, fresh command validation,
  root change refresh, ordinary-prompt slash rejection, interactive-mode guard.
- `src-tauri/src/copilot.rs`: narrow private command/list bridge-record admission.
- `copilot/command-effects.mjs`: command-name-independent SDK effect application,
  authoritative model reconciliation and applied/cancelled finalization.
- `src/copilot/commands.ts`: validated metadata, aliases, raw parsing and choices.
- `src/copilot/command-queue.ts`: connection-local FIFO, readiness-driven drain, immutable operation progress, cancellation and disconnect outcome fencing.
- `src/copilot/{session,view-policy}.ts`: command intent, operation ownership,
  result interpretation, labelled output and submission receipts.
- `src/pi/slash-completion.ts`: optional presentation-only argument hints/choices;
  Pi command resolution and submission policy are unchanged.
- `src/command-palette.ts`, `src/main.ts`: shared described-choice/standalone page
  and exact session-bound modal composition. No command names become app actions.
  The shell's `session` initializer is explicitly typed `CopilotSession`: its
  command-choice ownership callback references that same session, so inference
  alone creates a circular initializer/return-type dependency (TS7022/TS7023).
- `test/copilot-command-queue.test.ts`: authored, unrun FIFO/active-work serialization, cancelled picker removal, failure without retry and dispatched/undispatched disconnect outcomes.
- `test/copilot-commands.test.ts`: authored, unrun busy `/allow-all`/alias FIFO, terminal-root-idle gating, queued choices/cancellation, catalog revocation and unchanged draft effects, plus metadata, argument insertion/Enter/IME/caret,
  raw argument preservation, selection/cancellation/late results, discovery
  updates, finalized model reconciliation, explicit agent prompts and no fallback
  for unsupported effects.
- `test/copilot-command-effects.test.ts`: applied/cancelled model and Plan-model
  transactions, authoritative mismatch and finalization uncertainty.
- `test/copilot-bridge.test.ts`, `test/fixtures/copilot-sdk.mjs`: production bridge
  with offline SDK fixture, alias/fresh-list invocation and newly advertised
  commands, no prompts for command output.
- `test/{command-palette,shell}.test.ts`: standalone described modal choices,
  focus/lifecycle mechanics, command intent and transcript output.
- `src-tauri/src/copilot_tests.rs`: private command-record admission/rejection.

The user reported that bare `/permissions` and `/permissions show` both display
a report in Nimrod, while the Copilot TUI opens a picker for the bare command.
The initial fixtures incorrectly assumed bare SDK invocation returned
`select-subcommand`. The offline SDK fixture now models a text default, and
controller/shell fixtures cover metadata-driven pre-invocation selection,
explicit-argument bypass, Escape with zero invocations and stale-choice rejection.
These updated fixtures are **unrun**. Actual installed catalog/command behavior,
post-fix macOS/Linux modal/focus/scroll and SDK packaging acceptance are pending.
Schema support, Rust compilation and mocks are not live command/UI acceptance.

User guide: [Copilot slash commands](../../../../docs/copilot.md#slash-commands).
