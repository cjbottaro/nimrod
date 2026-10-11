# Pi transport and acknowledgement

**Status: implemented.** User behavior: [Writing messages](../../../../docs/writing-messages.md). Related: [projects/sessions](projects-and-sessions.md), [composer](composer.md), [scroll/focus](transcript-interaction.md).

## Specification and acceptance criteria

Pi remains authoritative for request acceptance, queues, active history and model configuration. A saved launch must verify the returned canonical file/ID/cwd before enabling submission; absence of initial persistence metadata must not turn it into a temporary session.

Every stdout response/event travels over one ordered Tauri channel. State/history response callbacks execute synchronously during delivery so later streaming events cannot be overwritten by stale snapshots. Request promises may resolve afterward, but are not the snapshot ordering mechanism.

Ordinary acknowledgement timeout is 20 seconds. Explicit rejection, acknowledged acceptance and unknown acceptance are distinct states. Only acknowledgement clears an unchanged submitted draft; newer drafts survive. History, queue counts, idle state and user-message events never substitute for a receipt. No timeout/disconnect automatic retry or prompt replay.

`agent_end` is not the idle boundary; `agent_settled` is. Manual/automatic compaction locks submission. Stop first obtains authoritative `clear_queue` recovery then aborts, except during compaction. RPC abort can remain stuck awaiting acknowledgement; exact-file Restart uses native owned-child stop, not another RPC.

## Code map

- `src/pi/transport.ts`: correlation, synchronous response callbacks, deadlines and disconnect invalidation.
- `src/pi/session.ts`: launch metadata, history, queue/control semantics, Pi capabilities and identity guards.
- `src/pi/reducer.ts`: validated event state.
- `src/pi/webview-client.ts`: ordered snapshots before coalesced paint; selective draft receipts.
- `src-tauri/src/process.rs`: bounded LF framing, pipes, ordered `Channel<Packet>`, observed shutdown.
- `src-tauri/src/workspaces.rs`: window/token ownership and file reservations.
- `src-tauri/src/sessions.rs`: exact-file validation and literal launch arguments.

## Framing and failure invariants

- UTF-8 LF-delimited JSON, CRLF and a final unterminated record accepted; U+2028/U+2029 remain string data.
- Stdout records max 16 MiB; aggregate returned histories max 256 MiB. Image-aware request bound is 13 MB, as specified in [image paste](image-paste.md).
- Pipe, malformed JSON or channel failure stops the owned child and invalidates pending requests. The composer stays draft-editable but unavailable for submission.
- Late events/receipts from an old token/generation cannot mutate another launch/session.
- Rust exposes only named Pi operations, not an arbitrary command API. Links never navigate the app webview.
- Stop only owned children. Detached descendants/abrupt parent death are not guaranteed cleaned up.

## Tests and remaining acceptance

Use `test/transport.test.ts`, `test/session.test.ts`, `test/native-view.test.ts`, native process/workspace/session fixtures and optional isolated installed-Pi metadata smokes. Validate ordering, late old callbacks, acknowledgement races, strict identity, malformed framing and shutdown-before-relaunch with fixtures.

Run `mise run check`; no live models, compaction or user-session mutation. Native provider-generated first-save, queue consumption and platform process behavior remain distinct from fixture evidence. See [verification](verification.md).
