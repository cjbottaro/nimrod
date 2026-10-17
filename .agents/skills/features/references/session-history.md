# Session lists and saved-history discovery

**Status: Pi and Copilot SDK sources implemented; latest fixtures unrun.
Installed-agent/native acceptance pending.**
User guides: [Sessions](../../../../docs/sessions.md#switch-or-resume),
[Copilot](../../../../docs/copilot.md#history-close-and-delete).

## Consumer contracts

`src/session-list.ts::SessionListEntry` is shared by the Session sidebar, Switch
and history pickers: source-qualified `key`, `title`, `harnessLabel`, optional
numeric `timestamp`, `open`, semantic `SessionStatus`, optional saved `reference`
and search `keywords`. Pi references retain exact file path/ID; Copilot references
retain `kind:'copilot-sdk'` and saved ID. No durable ACP reference remains.

The shell's `sessionRow` projects authoritative connection/activity/attention/
deletion state with existing precedence. `session-sidebar.ts` owns accessible
wording/glyphs. `resolveSessionListEntry` overlays matching open title/time/status
while retaining history search metadata. Membership is independent of connectivity;
history does not own another lifecycle state machine.

`src/session-history.ts::SessionHistory` is a project-bound consumer port:
source `id`/`label`, `list({signal,cursor?})` returning immutable entries,
optional next cursor and warnings, plus owned `dispose()`. Every history entry
has a saved reference. Failures reject, not empty-success fallback.
Opaque cursors remain source-owned; the collector deduplicates identities/repeated
cursors and retains completed pages after later failure. No persistent catalog,
polling or transcript copy.

`loadSessionHistory` queries sources concurrently and publishes incrementally.
Pi remains usable while Copilot is slow/failed and vice versa. Resume overlays open
rows before stable `sortByRecency`, newest displayed timestamp first; unknown times
last, ties in collector order. Pi uses message/local-use recency; Copilot uses
SDK-reported modification time, not invented user-message time. Delete retains
source ordering. No rendering/discovery stamps recency or changes query/highlight.

Rows show title above muted time/date/harness. Harness is a retained span after
`<time>`; minute/foreground refresh only updates time. The Copilot harness label is
**Copilot**, with no transport suffix. Source errors use source-owned application
notices; load failures use the selected session's notices.

Cancellation retires consumer waits and blocks stale publication, not the shared
project-history connection. Escape/Back/Refresh/page change/external close/disposal
invalidate selection. Accepted selections execute after palette focus restoration.
Project teardown owns source disposal; stop failure propagates and retains ownership.

## Concrete implementations and ownership

- `src/pi/session-history.ts`: existing read-only catalog plus exact-file inspection
  of otherwise unlisted open files; child/deleted filtering, identity-bound recency,
  native ordering. No Pi process starts for listing.
- `src/copilot/session-history.ts`: one discovery-only SDK connection/token per
  associated project, `listSessions` with independently validated exact
  `context.workingDirectory` and nonremote filtering. `nimrod.history.copilot-sdk.v1:<cwd>`
  stores the association independently of membership. New Copilot creation or restored
  SDK rows establish it; closing all rows retains it. Pi-only projects launch no
  discovery process. Discovery never calls connect/create/resume/prompt.
- Shell wiring owns literal runtime/native launch parameters. Source initialization
  is coalesced; explicit Refresh can reconnect after failure, never an automatic loop.
  Dispose waits for in-flight launch and observed owned stop. Conversations have
  independent controllers/tokens.
- The former ACP Copilot history source and association routing are removed.
  Old layout entries are ignored; no automatic conversion or draft migration.
  Generic ACP protocol list/load primitives remain, but custom history has no product UI.

## Resume execution

Sources expose no `resume` method. The shell accepts a saved reference and activates
its matching open row or immediately creates/selects a saved representation, restores
the normal draft scope and requests connection through the existing coordinator.
Pi keeps native file/cwd/identity/deletion validation. Copilot reconnects its exact
SDK ID, never a replacement. Missing history/binary or failed loading retains the
row/identity/draft for explicit retry. Startup does not resume Copilot conversations.

Listing, selection and replay never send prompts, restore in-flight work, stamp
Send recency, emit completion alerts or change another session's draft/focus.
Loading readiness controls composer availability. Close removes membership only;
Restart stays Pi-only. Copilot deletion uses the separate SDK
[deletion operation](session-deletion.md#consumer-interface-and-copilot-deletion).

## Fixtures and remaining evidence

`test/session-history.test.ts` retains shared qualified identity/open overlay,
incremental isolated failures, paging/dedup/repeated cursors and Pi catalog/exact-file/
child tests. `test/shell.test.ts` ports mixed-source ordering, slow/error discovery,
exact-ID Resume, drafts, open-row reuse, Close and supported deletion to SDK fixtures.
`test/copilot-sdk.test.ts`, bridge fixtures and
`test/browser/copilot-sdk.spec.ts` cover SDK behavior; generic ACP low-level
list/load tests remain separate; ACP creation/options are not exposed in the UI. Copilot ACP-specific discovery fixtures are removed.
Updated fixtures have not been run. No checks/builds/app launch, live providers or
user-session mutations were performed; native macOS/Linux acceptance remains pending.
