# Pi transport and RPC results

**Status: implemented.** User behavior: [Writing messages](../../../../docs/writing-messages.md). Related: [projects/sessions](projects-and-sessions.md), [composer](composer.md), [scroll/focus](transcript-interaction.md).

## Specification and acceptance criteria

Pi remains authoritative for request acceptance, queues, active history and model configuration. A saved launch must verify the returned canonical file/ID/cwd before enabling submission; absence of initial persistence metadata must not turn it into a temporary session.

Every stdout response/event travels over one ordered Tauri channel. State/history response callbacks execute synchronously during delivery so later streaming events cannot be overwritten by stale snapshots. Request promises may resolve afterward, but are not the snapshot ordering mechanism. Image prompts also use the synchronous response callback to record Pi's `started` preflight disposition before its first live user event; that event's renderer key is correlated back to the local submission before publishing the snapshot. This is Pi-specific correlation metadata, not acknowledgement-driven UI gating; [Image paste](image-paste.md#invariants) owns the exact boundary and fallback.

Opt-in [transcript logging](transcript-logs.md#queue-best-effort-delivery-and-failures) is best-effort and independent of session delivery. Semantic application stays synchronous and ordered; diagnostic buffers can drop records instead of delaying the next packet, Send or Stop. There are no logging barriers or pre-dispatch flushes.

Ordinary RPC result timeout is 20 seconds. Explicit rejection, successful result and unknown delivery are distinct transport outcomes, not an overarching UI submission lifecycle. Apply the [optimistic interaction policy](architecture.md#optimistic-interaction-policy): composer clearing, message previews and sidebar recency/scroll effects originate at local Send, never the result. Transport correlation is the only pending-request state; there is no persisted composer submission record. The renderer's synchronous `ViewHost.promptSubmitted` notification supplies local shell effects outside transport. Multiple prompt requests can be outstanding, with Pi authoritative for their actual results. Each response settles its own RPC without touching the editable draft; failed/unknown outcomes report a notice, with no recovery copy or explicit new-message gate. History, queue counts and idle state never synthesize an RPC result. Actual user-message events reconcile transcript previews independently of result timing. No timeout/disconnect automatic retry or prompt replay.

`agent_end` is not the idle boundary; `agent_settled` is. Manual/automatic compaction locks submission. Stop first obtains authoritative `clear_queue` recovery then aborts, except during compaction. RPC abort can remain stuck awaiting acknowledgement; exact-file Restart uses native owned-child stop, not another RPC.

## Code map

- `src/pi/session-startup.ts`: Pi-only native launch identity checks and pre-result packet buffering; binds validated shell identity/drafts before ordered packet release and initialization. `src/pi/integration.ts` owns native wiring, controller callbacks and token-bound teardown, with scoped shell effects behind the registered ports. Retired launch completion is rejected before identity binding/replay/initialization. See [consumer interfaces](consumer-interfaces.md#implemented-extraction-and-registration-boundary).
- `src/pi/transport.ts`: correlation, synchronous response callbacks, deadlines, disconnect invalidation and hasPendingRequest queries over the existing RPC map for lifecycle/model/compaction guards.
- `src/pi/session.ts`: launch metadata, history, queue/control semantics, Pi capabilities and identity guards.
- `src/pi/reducer.ts`: validated event state.
- `src/pi/webview-client.ts`: ordered snapshots before coalesced paint; receipts update steering presentation/report errors but never mutate drafts.
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

`test/pi-session-startup.test.ts` adds ordered buffer release, bind-before-replay, live-generation filtering and failure-before-effects fixtures for the startup extraction; these additions have not been run.

Use `test/transport.test.ts`, `test/session.test.ts`, `test/native-view.test.ts`, native process/workspace/session fixtures and optional isolated installed-Pi metadata smokes. Validate ordering, late old callbacks, acknowledgement races, strict identity, malformed framing and shutdown-before-relaunch with fixtures.

Run `mise run test`; no live models, compaction or user-session mutation. Native provider-generated first-save, queue consumption and platform process behavior remain distinct from fixture evidence. See [verification](verification.md).
