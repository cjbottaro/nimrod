# Composer image paste

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#image-paste) retain prior execution records.

## Specification and acceptance criteria

Explicit focused paste attaches bounded original image bytes to the originating session. Image-only prompts clear the editable composer immediately; receipts preserve newer drafts. Successful sends retain no image backup UI or draft copies; definitive failures discard the attempted message, and uncertainty is explicit with no replay. Never infer image consumption from text-only queues.

## Code map

- `src/pi/image-attachments.ts`: reference/wire types, MIME/size/count/base64 bounds, clipboard file extraction, image decoding/dimension check, reference traversal.
- `src/attachment-store.ts`: IndexedDB `nimrod.attachments.v1`, `images` object store keyed by UUID. ArrayBuffer bytes + MIME are separate from native draft metadata; reconstruct Blob on read. WebKit rejected IndexedDB Blob persistence (`UnknownError: Error preparing Blob/File data`), so avoid storing Blob/File directly.
- `src/clipboard-image.ts`: user-triggered Tauri clipboard-manager fallback, RGBA + dimensions → canvas PNG, native resource closed in finally.
- `src/main.ts`: attachment host; persistent IndexedDB vs temporary window-local Blob map. Temporary disposal invalidates late writes and releases bytes.
- `src/pi/composer-state.ts`, `webview-state.ts`: draft-only immediate text/image clearing, receipt isolation and retired-submission/backup filtering.
- `src/pi/webview-client.ts`: paste scope, removable thumbnail tray/object URL lifecycle, asynchronous preparation/generation guards, slash exclusion, safe image blocks and explicit send notices; no image recovery section.
- `src/pi/session.ts`: validates images before RPC, supports image-only prompts, includes original steering/followUp fallback.
- `src/pi/steering-transcript.ts`: pending image turns reconcile only on equal text plus ordered image MIME/base64 blocks; never caption-only history or text-only clear_queue recovery.
- `src-tauri/capabilities/main.json`: clipboard read-image permission only on project windows. `tauri.conf.json`: blob image sources (not script/connect sources).
- `src-tauri/src/process.rs`: requests bounded at 13 MB (8 MiB binary base64 + 1M text); aggregated stdout histories bounded at 256 MiB. Individual session JSONL records remain bounded at 16 MiB.
- `src-tauri/resources/demo.mjs`: offline image-aware user turns/queues only; no models.

## Invariants

- Attachments are `{id,name,mimeType,size}` references in editable drafts. Send-local image reads capture bytes before the draft is cleared; there is no submission ownership record or persisted recovery. Retired imageRecovery fields and unsent recovered items are ignored, removed on the next write and excluded from native GC reference protection. Never put image bytes in localStorage or app preferences.
- Original PNG/JPEG/WebP/GIF bytes retained; native pixel clipboard becomes PNG. No URL fetches, SVG, HTML extraction, file-manager path importing, implicit resizes or model requests.
- Limit 8 images / 4 MiB each / 8 MiB total / 32 megapixels. MIME validation does not authorize markup; images render via img, not innerHTML.
- Only explicit focused composer paste reads clipboard. Prefer event image files and never also read native clipboard. Mixed text is inserted with native textarea selection semantics; ordinary text/HTML/non-image file paste unchanged.
- Paste may finish after selection changes: it belongs to its originating mounted session. Reset/disposal/Stop generation invalidation blocks late insertion or sends. Preparation blocks submission. Revalidate readiness/deletion/compaction immediately before posting.
- Pi RPC acknowledgement alone establishes acceptance, but Send clears text/images immediately before asynchronous preparation. Send-local payload preparation finishes independently of RPC acknowledgement. Receipts never touch newer text/images. Failed/unknown outcomes show a notice without restoring attachments, a recovery gate or automatic retry.
- Stop cancels unposted image preparation; posted requests retain existing unknown/acknowledgement rules. No automatic retry.
- Pi queue_update/clear_queue report text, not image identity. Keep only authoritative nonempty text for Stop restoration; no image restoration or blank image-only rows. Do not infer consumption from snapshots, count, idle, caption or normalized Pi image content. Pending image previews may remain unconfirmed after Pi normalization. Definitively failed local previews are discarded; authoritative Pi turns remain unchanged.
- IndexedDB writes use one readwrite transaction to check 128 MiB quota across windows. On each write, query Rust persisted/staged draft references (legacy localStorage references ignored); delete only unreferenced entries >24h old. Failed/corrupt native-reference queries never authorize GC. Grace protects other windows/in-flight drafts. Confirmed session deletion removes draft references; orphan blobs expire on subsequent saves rather than immediate deletion, preserving copied recovery references.
- Temporary images never touch IndexedDB; bounded window-local map releases IDs no longer referenced by that session's editable draft; reads started before clearing retain bytes locally, and the rest on owning-session disposal. Temporary drafts remain excluded from library serialization.
- Object URLs revoked on removal/reset/disposal; reuse unchanged transcript image elements to preserve load/scroll stability. Existing TranscriptScroll resize/follow handling owns geometry, never force-focus or scroll on load.

## Tests and acceptance

`test/image-attachments.test.ts`: bounds/formats/reference-only persistence, newer attachment receipt isolation, immediate clearing, no submission backup copies, draft-only reload and strict steering reconciliation. `test/send-outcomes.test.ts` covers draft-only immediate clearing/reload and retired stored-state cleanup. Renderer/session fixtures cover overlapping sends, receipt isolation, image reads before temporary storage release and cancellation across Stop/reset/disconnect.
`test/session.test.ts`: actual prompt fields/image-only acceptance and malformed/slash validation before writing.
`test/browser/paste-images.spec.ts`: offline WebKit image decode/removal/image-only send, mixed selection insertion, absence of successful-send recovery UI and session isolation. `test/browser/send-outcomes.spec.ts` covers definitive rejection, newer text/images and unknown acceptance without recovery actions against the offline process fixture. Fixture allows local blob resources while aborting external networking.
Automated WebKit also checks persistent-store byte roundtrip through a new store instance and missing-reference failure. Native paste acceptance, actual app reload/quota behavior and Linux desktop/Wayland acceptance remain manual checks. Unit/automated WebKit evidence is not native macOS acceptance. No user app or live Pi/model is launched by validation.

See [user guide](../../../../docs/image-paste.md).
