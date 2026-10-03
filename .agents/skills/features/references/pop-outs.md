# Nimrod pop-outs: implementation guide

Read the [human feature guide](../../../../docs/pop-outs.md) and
[shared UI vocabulary](../../nimrod-ui-vocabulary/SKILL.md) first. Follow repository
`AGENTS.md` and [architecture](../../../../docs/architecture.md). Paths below are
repository-root relative; run commands from the repository root.

This reference carries implementation detail, not a mandate to expand the feature.
Keep `docs/pop-outs.md` concise and user-facing; update this reference when changing
implementation, storage, invariants, platform workarounds or test coverage.

## Product boundaries

- Pop-outs capture immutable, read-only content; they are not editable notes or files.
- They belong to the selected session in each project window, not the globally
  focused window. Other projects retain their independently selected sessions.
- Copy/Pop out are icon-only, in that left-to-right order: Pop out, Copy. Buttons
  have accessible labels/tooltips; copy success shows a checkmark for 1.2 seconds.
- Identical content/language anywhere in one session shares a pop-out. This is
  intentional, including identical content in different turns.
- Switching sessions hides/shows references; closing the source session/project
  preserves saved snapshots. Explicit pop-out Close removes the saved reference
  and file. App Quit preserves snapshots.
- Temporary/demo and pre-first-save pop-outs are runtime-only. Provisional
  saved-session snapshots promote after verified Pi persistence, even in background.
- No original message ID, block ordinal, transcript key or backlink is tracked.
  **Show in conversation is intentionally dropped, not a deferred requirement.**
- Native title bars/window controls remain. Frameless/custom chrome was discussed
  and deferred; do not implement it as part of unrelated maintenance.
- Nimrod owns snapshots and window state. Pi owns conversations/session files.
  Pi is the only implemented harness; do not invent a generic harness protocol.

## File map

| File | Responsibility |
| --- | --- |
| `src/pi/safe-markdown.ts` | Sanitized Markdown/highlighting; code-block actions; `renderCode` |
| `src/pi/code-actions.ts` | SVG icons and timed copy success/failure feedback |
| `src/pi/webview-client.ts` | Delegated transcript Copy/Pop out clicks; exact source extraction |
| `src/main.ts` | Session ownership/selection, native bridge, first-save promotion and errors |
| `src/session-popouts.ts` | Serialized/coalesced sync/open queue and stale-open guards |
| `src/popout.ts` | Dedicated window boot, rendering, clipboard, links, appearance, close shortcut |
| `src/popout-presentation.ts` | Markdown aliases and content-derived display titles |
| `src/popout.css` | Content-first layout; floating Markdown source Copy control |
| `src-tauri/src/popouts.rs` | Window-scoped registry, session verification, visibility, restore/promotion/close |
| `src-tauri/src/popout_store.rs` | Hashing, file/index schemas, bounds, atomic snapshot persistence |
| `src-tauri/src/popout_windows.rs` | Passive automatic visibility; macOS activation workaround |
| `src-tauri/src/main.rs` | Commands, window events, close-versus-quit routing and final flush |
| `src-tauri/src/preferences.rs` | Serialized app-state merging, removal and update-existing operations |
| `src-tauri/src/window_state.rs` | Geometry cache and bounded/missing-display restoration |
| `src-tauri/capabilities/popout.json` | Narrow permissions for `popout-*` windows |

## Open and render flow

1. The safe Markdown renderer decorates code blocks. Do not allow raw agent HTML
   to create buttons/native actions; action elements are constructed by DOM APIs.
2. Delegated transcript clicks use `codeBlockSource`, which reads `pre > code`
   textContent. The renderer posts `popOutCode` with `text` and `language`, not a
   transcript locator. Source bytes include whatever newlines the rendered block
   contains; do not silently trim or normalize them.
3. `src/main.ts` adds the mounted session ID and captured session display name,
   then queues the native open. Its guard checks that the session is still selected,
   present and not closing when the queued operation executes.
4. The native open verifies the calling project window and its registered selected
   session, hashes content, and finds an existing matching reference before creating
   a new UUID. It can recover an indexed snapshot even if an earlier native window
   creation failed. Explicit open shows, unminimizes and focuses that window.
5. Windows use `index.html?popout`, initially hidden with `focused(false)`. The
   frontend branches before mounting the project/session shell; no Pi controller,
   transport, composer or launch form is mounted in this route.
6. `code_popout_snapshot` returns data only for the calling pop-out's own native
   label. Do not add a caller-supplied path/ID that can read another window's data.

### Rendering and controls

- Markdown aliases are `markdown`, `md`, `mkdown`, `mkd`, case-insensitive after trim.
  Use the existing sanitized renderer, not an unsanitized Markdown/HTML sink.
- Other languages use `renderCode`, inserting source as text and sanitized
  highlighting. Markdown-looking code in another language remains literal code.
- Remove nested Pop out actions in this window. Nested code Copy still works.
- There is no in-content session/“Read-only snapshot” header. Code keeps its
  language/Copy row; Markdown has a floating upper-right Copy source icon.
- `.popout-markdown` reserves 38 CSS pixels on the right so the source Copy icon
  never obscures scrolled content. Content otherwise has the standard 20px gutters.
- Markdown's whole-document Copy returns original source, not rendered text.
  Nested Copy returns only its own `pre > code` text. The pop-out uses native
  clipboard writes; transcript Copy tries the browser clipboard first and falls
  back through its correlated host request/result path.
- Title generation reads the first non-empty heading from the sanitized Markdown
  DOM; code uses its first non-empty source line. Empty/heading-free content falls
  back to a language name. Normalize controls/whitespace and cap at 80 Unicode code
  points without splitting a surrogate pair. Set both document and native titles.
- `CodeSnapshot.title` still holds a captured session name for file compatibility;
  it is **not** the visible title and does not affect identity.
- Preferences snapshot/broadcasts apply theme and serialized native zoom updates.
  Remove event listeners on unload. Pop-out errors appear as an alert, with native
  lifecycle errors also broadcast via `nimrod-popout-error` to project windows.
- Intercept Markdown links; never navigate the app webview. `open_popout_link`
  derives cwd from the native entry and reuses `open_link_at` validation/editor or
  browser handoff. Stored cwd remains available independently of source history.
- ⌘W / Ctrl+W calls native Close. Do not replace that with direct `destroy()`, which
  bypasses persistence deletion semantics.

## Identity and storage

Three identities serve different purposes:

1. **Nimrod UUID:** durable snapshot/file/window identity. Native labels are
   `popout-<uuid>` and filenames are `<uuid>.json`.
2. **Session owner:** canonical project cwd plus `PiSessionRef { path, sessionId }`
   for saved sessions. Runtime-only entries use calling window/mounted session IDs.
3. **Content fingerprint:** a within-session matching key, not a session identity
   or source location.

The fingerprint is SHA-256 over:

```text
"nimrod.code-popout.v1\0"
+ normalized_language_byte_length as u64 big-endian
+ normalized_language UTF-8 bytes
+ exact_source UTF-8 bytes
```

Normalize language by trim/lowercase and map `md`, `mkd`, `mkdown` to `markdown`.
Do not normalize source whitespace or include titles, window labels, runtime IDs,
geometry or turn position. A hash/schema change needs explicit compatibility work;
otherwise existing file validation and content matching will break.

Default storage (XDG overrides follow existing Preferences paths):

```text
~/.local/state/nimrod/state.json
  "nimrod.popout.v1:<uuid>" -> SavedPopout
~/.local/state/nimrod/popouts/<uuid>.json
  { version: 1, reference: SavedPopout, snapshot: CodeSnapshot }
```

`SavedPopout` contains `id`, `cwd`, `pi`, `fingerprint`, `geometry`.
`CodeSnapshot` contains `session`, `title`, `text`, `language`. Its `session` is a
captured mounted identity, not the durable ownership key used for restoration.
Old snapshot `key` fields are ignored on read and omitted on serialization; no
migration or user-file rewrite is required.

### Persistence invariants

- Exact source is capped at 16 MiB. Snapshot JSON files are capped at 100 MiB because
  JSON escaping can expand source up to sixfold. Global state retains its 8 MiB cap;
  never embed large snapshot content there.
- Only canonical UUID filenames are accepted. Validate absolute owner paths,
  source/schema/reference identity, fingerprint and geometry when loading.
- `save_new` writes a same-directory temporary file, syncs it, then uses
  `persist_noclobber`. Only afterward does it insert the state reference. A failed
  index write rolls back only that newly created file, never an existing snapshot.
- Files are immutable after creation. Geometry changes update only the state
  reference; file/index identity comparison deliberately ignores geometry.
- Geometry writes use `update_existing_state`, not insert/merge: a late update must
  not resurrect a pop-out already closed. Unchanged geometry skips persistence.
- Explicit deletion removes the state reference before unlinking the file.
  An unlink failure reports an unreferenced leftover file, rather than leaving a
  reference that reopens after Close. A state-write failure retains the open window
  and saved snapshot instead of pretending Close succeeded.
- Missing/corrupt/mismatched snapshots are reported and kept for recovery. Do not
  silently delete their references, rewrite them, scan Pi sessions, or replay prompts.
- External state edits are not live window commands. Reconciliation happens at
  session-selection/identity boundaries; do not spawn windows from preference polling.

## Session synchronization and concurrency

`syncPopouts()` sends every mounted session's runtime ID and verified saved owner,
plus the selected session ID (or null). It runs at activation, first-save promotion,
source-session close, and project boot. Temporary/demo owners never get a saved Pi ref.

`installSessionPopouts` serializes work, coalesces queued selection updates and opens
only while the source remains selected. Disposal suppresses queued mutations and
late error messages. Do not let an open overtake native session registration.

Native `Popouts` holds a mutex-protected registry and a Tokio operations mutex.
Registry entries use `Arc<CodeSnapshot>` to avoid copying potentially large content
on each session synchronization. Each incoming sync updates the desired revision
before waiting for serialized operations; superseded work checks `current()` and
cannot take ownership of the newest selection. Project retirement invalidates late
opens/restores before child shutdown finishes.

New/changed saved bindings are verified through Pi file identity checks. A bad
binding is reported and downgraded to runtime-only rather than granting an unrelated
session access to saved references. Restore finds state references by cwd and Pi
file/ID, loads Nimrod's snapshot, and reattaches it to the new mounted session ID.
The original transcript block need not exist or be visible. Pop-out restoration
itself starts no Pi process; the surrounding session shell retains its existing
selection/launch policy.

After promotion/geometry saving, windows with no corresponding mounted session are
released programmatically without deleting saved references. Source project Close
retires the registry owner, saves geometry and destroys its windows. Native Quit
captures geometry and flushes pop-out state before existing owned-child shutdown;
there is also an event-cached final-exit fallback. Do not route project Close/Quit
through the explicit pop-out deletion path.

## Native focus: keep the two paths separate

**Automatic restore/switch:** `popout_windows::show_restored`.

- Creating with `focused(false)` alone is insufficient on macOS: Tauri/Tao's
  `show()` calls AppKit `makeKeyAndOrderFront`, making the pop-out the keyboard target.
- Instead call `NSWindow.orderFront` on the main thread using Tauri's retained window
  handle. Resolve/use the pointer inside that callback; do not send raw pointers
  between threads. Await completion through the oneshot result.
- Skip already visible/minimized windows. Showing repeatedly can steal focus or
  undo minimization even when no session change occurred.
- Never repair this with a timer, a late composer `.focus()`, parent `set_focus()` or
  permanent non-focusable windows. Those approaches steal deliberate user focus,
  disrupt modal dialogs/other projects, or prevent reference-window interaction.
- The session shell's existing composer startup/selection focus and dialog modality
  stay authoritative. Windows/Linux use the existing show API plus guards; their
  native focus behavior remains unverified.

**Explicit click:** keep `show()` → `unminimize()` → `set_focus()`.

The pop-out must remain focusable/selectable when the user deliberately chooses it.
Its `popout-*` capability allows clipboard writes, native zoom, title changes and
Close; do not broaden it to project/session process controls.

## Tests and verification

Relevant tests:

- `test/native-view.test.ts`: action order/icons, exact source, locator-free duplicate
  payloads, clipboard fallback and feedback, safe code rendering.
- `test/session-popouts.test.ts`: coalescing, registration/open ordering, stale opens,
  background promotion, errors, disposal.
- `test/popout-presentation.test.ts`: aliases, sanitized/setext headings, fenced
  examples, language fallbacks, controls and Unicode title truncation.
- `test/shell.test.ts`: shell/native dispatch, restore ownership with regenerated
  runtime IDs, first-save promotion, selection/close, standalone route, copying,
  links/themes/titles and composer/dialog focus during delayed sync.
- `test/browser/popout.spec.ts`: real WebKit content-first layout, corner Copy
  clearance while scrolling, source copying and title dispatch with mocked IPC.
- Rust tests in `popout_store.rs`: disk round-trips without Pi/history, bounds,
  hashing, owner isolation, corrupt/missing files, rollback, geometry/no resurrection,
  legacy metadata compatibility and content larger than global state limits.
- Rust tests in `popouts.rs`/`popout_windows.rs`: owner/revision/retirement isolation,
  runtime-independent matching, visibility guards and automatic/explicit path separation.

Run `mise run check` and `mise run build`. Rendering/scrolling changes also warrant
`npm run test:browser`; these are offline fixtures, not the user's app. Never launch
or interrupt that app, run live compaction/model work, or modify user session/state
files to test persistence without explicit authorization.

Last runtime-change evidence: 224 TS tests, 45 default Rust tests (two opt-in real-Pi
smokes ignored), packaged macOS build. Fourteen offline WebKit tests passed for the
content-first UI; they were not rerun for the later native-only focus correction.
See [verification](../../../../docs/verification.md) for the latest recorded evidence.

Do not infer native acceptance from compiler/source-guard/jsdom/browser tests.
Ask the user to verify saved-session quit/relaunch focus, reference visibility on
switch, close-versus-quit persistence, explicit-click focus, minimization, geometry
and multi-display behavior. Offline demos cannot verify restart persistence because
those sessions deliberately have runtime-only pop-outs.
