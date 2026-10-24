# Keep draft typing off expensive UI/storage paths

**Status: implemented existing baseline. Predates the later CPU-contention investigation; not a new change made during that experiment.**

## Why

The earlier typing path performed repeated geometry reads, status/button DOM mutations and broad draft-storage work on ordinary edits. Those costs are especially undesirable on the interaction path and can grow with retained transcripts/drafts even though typing does not change them.

## What is already in place

Draft-only edits update in-memory state without rebuilding status/control DOM or repainting the transcript. Native CSS content sizing is used where supported; the fallback coalesces measurement before paint while preserving the composer-shell height hold. Hide/dispose cancels pending sizing.

Drafts are independently scoped and staged asynchronously to Rust, which debounces disk writes and performs blocking I/O off the webview thread. Draft staging IPC still occurs; disk debounce is not an IPC debounce. Send clears local state immediately and does not wait for storage flush or Pi results.

Current contracts are owned by [Composer → Typing hot path](../../features/references/composer.md#typing-hot-path) and [Native drafts](../../features/references/native-drafts.md). This catalogue does not change their durability, fallback or submission behavior.

## Benefits

- Avoid forced input-handler layout on engines supporting native field sizing.
- Retain status/button identity and avoid irrelevant DOM churn while drafting.
- Avoid synchronous localStorage writes/broad retained-draft serialization on typing.
- Keep storage work and RPC results from gating ordinary local input/Send feedback.

## Results

The canonical composer reference records an earlier 80-character baseline of **160 input-handler geometry reads and 800 status/button mutations**. Supported-WebKit typing fixtures perform neither and make no localStorage writes. Coverage includes empty/large transcripts, retained draft libraries and combined cases.

User-supplied native reports during the subsequent investigation sampled composer input-handler durations of **at most 1 ms at the report's clock resolution**, including sluggish and snappy captures. This helped distinguish cheap instrumented handlers from delay elsewhere; it does not prove edited text is presented within 1 ms.

## Regression risks and maintenance guardrails

- **Likely erosion:** attaching synchronous Markdown previews, broad validation/serialization or geometry reads to every draft input; rebuilding status/control DOM for unrelated keystrokes; persisting the whole draft library instead of the selected draft.
- **Reuse the boundary:** keep ordinary text edits on `updateComposer`'s draft-only path, sizing through native field-sizing or the coalesced fallback, and draft storage through the scoped native staging/debounce path. Do not add synchronous localStorage/file writes or gate typing/Send on storage/RPC completion.
- **Correctness traps:** changes to attachments, recovery or error state must still take their required non-draft update path. Preserve IME/selection, fallback shell-height hold, hide/dispose cancellation and draft durability boundaries; disk debounce does not eliminate per-edit staging IPC.
- **Extend fixtures when changing:** autocomplete, validation, previews, attachments, composer CSS or draft storage. Extend composer-performance geometry/mutation/storage counters with large transcripts/draft libraries and both sizing-capability paths; retain native-drafts and native-view cases for selection, clearing, recovery and late results. Cheap measured handlers alone do not prove cheap engine layout.

## Limits and code anchors

Unsupported engines still require fallback layout measurement. Native sizing can involve engine layout outside the measured helper. Abrupt shutdown can lose undelivered/debounced draft changes; no guaranteed unload durability is claimed. Instrumented handler timing is not full input-to-screen latency.

Code: `src/pi/composer-dom.ts`, `src/pi/webview-client.ts`, `src/pi/transcript.css`, `src/native-drafts.ts`, `src/session-drafts.ts`, `src-tauri/src/drafts.rs`. Tests: composer-performance, native-drafts/storage, native-view and offline WebKit composer/native-drafts regressions. Broader native/platform evidence remains owned by [verification](../../features/references/verification.md).
