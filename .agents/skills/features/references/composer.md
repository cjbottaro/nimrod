# Composer delivery and keyboard hints

## Code map

- `src/pi/composer-dom.ts`: keyboard delivery mapping and hint ordering.
- `src/pi/webview-client.ts`: busy-state hints, keyboard submission, draft receipts and compaction lock.
- `src/pi/session.ts`: authoritative session-state gate and Pi prompt RPC.

## Contract

- Idle: Enter sends normally; Option-Enter also sends normally, never queues. Hints: `Enter to send · Shift+Enter for newline`.
- Main agent working: Enter steers; Option-Enter queues a follow-up. Hints: `Enter to steer · Option-Enter to queue · Shift+Enter for newline`.
- Option is the macOS name for the Alt modifier (`KeyboardEvent.altKey`); Linux uses Alt+Enter. The current hint text uses the macOS label.
- Shift+Enter and IME input are not consumed by submission mapping.
- The controller sends `streamingBehavior: followUp` only for explicit `followUp` delivery while its main agent is busy. All other prompts include `steer`, preserving idle-to-busy race handling. If the controller is already idle after a busy renderer snapshot, the submission uses the ordinary steering fallback.
- Compaction locks submission and replaces keyboard hints with its cancellation hint. Background-only activity does not enable queueing.
- Keep acknowledgement/draft behavior unchanged: only Pi acknowledgement clears an unchanged submitted draft; never replay uncertain acceptance.

## Verification

`test/composer-dom.test.ts` covers idle/busy mapping, exact hint order, newline and IME guards. `test/session.test.ts` covers prompt RPC delivery and acknowledgement, including explicit follow-up requests arriving while idle. DOM/unit coverage is not native keyboard acceptance on macOS or Linux.

User-facing behavior: [architecture](../../../../docs/architecture.md#pi-specific-behavior).
