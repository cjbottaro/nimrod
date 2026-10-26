# Codex slash-command compatibility

**Status: bounded client adapters source-implemented; new offline fixtures authored,
not run; installed-CLI/native acceptance pending.**

## Provenance and boundary

The reviewed app-server has no CLI command catalog or generic command-invoke API.
Nimrod therefore advertises a small **Codex integration-owned client catalog**
backed by existing reviewed native APIs. It does not copy terminal screen output,
claim the complete CLI catalog or send unknown slash text as agent input.

[Codex integration](../../codex-integration/SKILL.md) owns pinned protocol evidence
and effective-model limitations. The [required consumer
port](../../features/references/session-commands.md) owns shared routing/lifetime.

| Command | Discovery / arguments | Execution / confirmation | Host behavior / limitation |
| --- | --- | --- | --- |
| `/model [model-id]` | Integration entry appears only with a connected advertised model catalog; literal ID completion; bare invocation opens shared model picker | Refresh `model/list`, validate exact current model ID, native `thread/resume` override through Codex's concrete configuration adapter; require returned effective model and selected projection to match | One Command card, no ordinary prompt or separate Nimrod configuration operation. Loaded-thread overrides remain installed-runtime acceptance work; failure/uncertainty is explicit. Outer argument whitespace is ignored for the single model-ID grammar. |
| `/rename [name]` | Connected-thread integration entry; bare invocation opens shared text input | Validate a nonempty single-line name; exact-thread `thread/name/set`; ordered response/name events reconcile title, followed by requested-name confirmation | One Command card; a newer conflicting native name is not overwritten or claimed as this command's success. |
| Other CLI commands, including `/compact`, `/mcp`, `/skills` | Not advertised | Rejected before draft clearing; no prompt fallback | Require separately reviewed native discovery/mutation/completion semantics before adding adapters. No guessed CLI parity. |

Both supported commands accept intent while working and wait for authoritative
native idle plus configuration readiness. The card remains pinned/shimmering
through queued work, picker/input and native invocation. Fresh catalog/choice
validation precedes dispatch. Cancellation before dispatch invokes nothing;
after possible delivery the card retains uncertainty without replay. Background
results never replace drafts, navigate or open modals in another session.

## Adapter rationale and removal condition

The terminal command UI is client-owned and absent from app-server command
metadata. These adapters are justified by the already-reviewed `model/list`,
`thread/resume` and `thread/name/set` APIs, not by an invented command RPC.
Remove or migrate them if Codex exposes an authoritative command catalog and
typed invocation/result lifecycle that covers these semantics. Do not route
through Nimrod's **Select model…** or **Rename session…** actions.

## Evidence and gaps

`test/codex-session.test.ts` includes provider-free fixtures for catalog/picker,
exact model confirmation, trailing-space completion, queued rename at terminal
idle, cancellation, stale model choices, no extra prompt/configuration card and
post-dispatch disconnect without retry. Existing native configuration/naming
fixtures remain regression targets. Current executed evidence belongs to
[verification](../../features/references/verification.md#session-command-port).

Still needed when authorized: fixture execution; installed-runtime model override
confirmation; native picker cancellation, visual/focus/scroll acceptance; actual
macOS and Linux acceptance. No model request, live compaction, app launch or
installed-CLI probe was performed for this implementation.
