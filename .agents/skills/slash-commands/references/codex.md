# Codex slash-command compatibility

**Status: source-implemented bounded client adapters; new offline fixtures authored,
not run; installed-CLI/native acceptance pending.**

## Provenance and boundary

The reviewed app-server has no CLI command catalog or generic command-invoke API.
Nimrod advertises a **Codex integration-owned client catalog** backed by reviewed
native APIs, not copied terminal output or unknown slash text sent as chat.

The [0.164.0 source audit](codex-audit.md) inventories all **65 native enum
commands**, aliases, dynamic families, API candidates and exclusions. It also owns
the optional full-inventory procedure and source/schema fingerprint snapshot.
For upgrades and regressions, use the [supported-command review policy](../SKILL.md#codex-upgrade-and-new-command-audit). [Codex integration](../../codex-integration/SKILL.md)
owns protocol evidence; [session commands](../../features/references/session-commands.md)
owns the required consumer contract. No runtime semver gate or all-version promise
is implied: unsupported native APIs fail explicitly on their Command card.

## Implemented catalog

| Command | Discovery / arguments | Execution / confirmation | Scope and remaining limitation |
| --- | --- | --- | --- |
| `/model [model-id]` | Connected advertised model catalog; literal ID completion and bare picker | Refresh `model/list`, validate exact ID, `thread/settings/update` through concrete configuration adapter; require acknowledgement plus native effective settings | Model selection only; native combined effort picker/richer syntax remains partial. Live-settings runtime acceptance pending. Outer token whitespace ignored. |
| `/rename [name]` | Connected-thread entry, bare text input | Nonempty single-line name; exact-thread `thread/name/set`, ordered name reconciliation and requested-name confirmation | Conflicting newer name is not overwritten or claimed as this command's success. No generated-name model request. |
| `/compact` | No arguments; accepted during work, dispatched at native idle | `thread/compact/start` only acknowledges enqueued work. Wait for the identified native turn, canonical `contextCompaction` item and terminal result; failed/interrupted/missing-marker outcomes are not success | May use the model when explicitly invoked by the user. No `turn/start`, hidden prompt, optional focus grammar, polling or automatic retry. Composer locks during compaction; Stop uses the actual identified turn. |
| `/status` | No arguments | Metadata-only `thread/read`, exact bound identity/cwd, native model/name/status and last reported usage | Partial native status report: no account quotas, monetary estimate or full permission/configuration parity. Does not hydrate or replace history. |
| `/pwd` (alias `/cwd`) | No arguments; native enum alias | Same exact-thread metadata-only read, return verified cwd | Never changes the project/window directory. |
| `/ps` | No arguments | Exact-thread `thread/backgroundTerminals/list`, complete pagination | Read-only process-ID/command/cwd report; no OS scan, termination, or resource-metric parity claim. Native `/stop` is a different background-terminal mutation, not Nimrod Stop. |
| `/skills` | Explicitly labelled read-only catalog subset | `skills/list {cwds:[exactProject]}`, require one matching project entry; show enabled/disabled catalog and native diagnostics | Partial: no skill invocation, draft insertion, enable/disable, guessed subcommand syntax or reading skill files. Native menu has additional workflows. |
| `/hooks` | Explicitly labelled read-only catalog subset | `hooks/list {cwds:[exactProject]}`, matching project entry; show native handler/event/trust/enabled state and diagnostics | Partial: no hook execution, editor or trust/configuration mutation. |

## Readiness, ownership and outcomes

MCP reports moved to the [MCP inspector action](../../features/references/mcp-inspector.md); `/mcp` is not a composer command.

Model/rename/compact wait for native idle plus configuration readiness. Report
commands advertise supported live-use, following the native source's busy rules;
they may run during work but do not bypass an earlier FIFO command or active
configuration/compaction. All share one retained Command card through queue,
interaction, invocation and settlement. Output stays in the card, not fabricated
harness history. Fresh catalogs/choices are revalidated before mutation.

Read-only results validate the fields they consume and never become executable
choices by parsing prose. Paginated reports are complete or fail explicitly;
unknown/malformed/cross-project results are not success. No partial output is
silently settled after a repeated cursor. Native guards restrict new methods,
parameters, thread binding and catalog cwd; discovery-only connections cannot
use conversation commands. Compaction also respects deletion reservations.

Cancellation before dispatch invokes nothing. Stop/hiding/disposal aborts command
interactions; possible dispatch retains uncertainty rather than rollback/replay.
Compaction continues native lifecycle tracking even if its presentation was
cancelled. A missing terminal event leaves it pending until explicit Stop or
connection teardown; an empty RPC response never settles it. Background results
never replace a draft, navigate or open another session's modal.

## Adapter rationale and removal condition

The terminal command UI is client-owned and absent from app-server command
metadata. These adapters use reviewed `model/list`, live settings updates, naming,
compaction and read-only report APIs—not an invented command RPC or a Nimrod
action redirect. Migrate to authoritative native command metadata/typed results
if Codex adds them. Unsupported variants remain rejected, not guessed.

## Evidence and gaps

`test/codex-session.test.ts` contains provider-free fixtures for model/name,
all report commands and `/cwd`, read-only execution during work, exact scope,
invalid mutation variants, cursor cycles, compaction event-before/after-response,
canonical marker/terminal confirmation, failures, disconnect and no replay.
`test/codex-command-reports.test.ts` covers report validation and the source-only
audit diff using synthetic source. Rust fixtures cover parameter allowlists,
exact native ownership and deletion gates. They are authored **unrun**.
[Verification](../../features/references/verification.md#codex-command-audit) owns
executed evidence and remaining installed-runtime/macOS/Linux acceptance.

No app-server connection, live compaction, model request, user configuration
change or installed command invocation was performed for this source audit.
