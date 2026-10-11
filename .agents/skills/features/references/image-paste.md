# Composer image paste

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#image-paste) retain prior execution records.

## Specification and acceptance criteria

Explicit focused paste attaches bounded original image bytes to the originating session. Image-only prompts, selective acknowledgement clearing and explicit image recovery must preserve newer drafts and never infer image consumption from text-only queues.

## Code map

- `src/pi/image-attachments.ts`: reference/wire types, MIME/size/count/base64 bounds, clipboard file extraction, image decoding/dimension check, reference traversal.
- `src/attachment-store.ts`: IndexedDB `nimrod.attachments.v1`, `images` object store keyed by UUID. ArrayBuffer bytes + MIME are separate from localStorage draft metadata; reconstruct Blob on read. WebKit rejected IndexedDB Blob persistence (`UnknownError: Error preparing Blob/File data`), so avoid storing Blob/File directly.
- `src/clipboard-image.ts`: user-triggered Tauri clipboard-manager fallback, RGBA + dimensions → canvas PNG, native resource closed in finally.
- `src/main.ts`: attachment host; persistent IndexedDB vs temporary window-local Blob map. Temporary disposal invalidates late writes and releases bytes.
- `src/pi/composer-state.ts`, `webview-state.ts`: attachment-aware submission snapshot, selective acknowledgement clearing, rejected/unknown recovery, accepted image-send recovery references.
- `src/pi/webview-client.ts`: paste scope, removable thumbnail tray/object URL lifecycle, asynchronous preparation/generation guards, slash exclusion, safe image blocks, collapsed image recovery.
- `src/pi/session.ts`: validates images before RPC, supports image-only prompts, includes original steering/followUp fallback.
- `src/pi/steering-transcript.ts`: pending image turns reconcile only on equal text plus ordered image MIME/base64 blocks; never caption-only history or text-only clear_queue recovery.
- `src-tauri/capabilities/main.json`: clipboard read-image permission only on project windows. `tauri.conf.json`: blob image sources (not script/connect sources).
- `src-tauri/src/process.rs`: requests bounded at 13 MB (8 MiB binary base64 + 1M text); aggregated stdout histories bounded at 256 MiB. Individual session JSONL records remain bounded at 16 MiB.
- `src-tauri/resources/demo.mjs`: offline image-aware user turns/queues only; no models.

## Invariants

- Attachments are `{id,name,mimeType,size}` references in drafts, submissions, recovered items and accepted imageRecovery entries. Never put image bytes in localStorage or app preferences.
- Original PNG/JPEG/WebP/GIF bytes retained; native pixel clipboard becomes PNG. No URL fetches, SVG, HTML extraction, file-manager path importing, implicit resizes or model requests.
- Limit 8 images / 4 MiB each / 8 MiB total / 32 megapixels. MIME validation does not authorize markup; images render via img, not innerHTML.
- Only explicit focused composer paste reads clipboard. Prefer event image files and never also read native clipboard. Mixed text is inserted with native textarea selection semantics; ordinary text/HTML/non-image file paste unchanged.
- Paste may finish after selection changes: it belongs to its originating mounted session. Reset/disposal/Stop generation invalidation blocks late insertion or sends. Preparation blocks submission. Revalidate readiness/deletion/compaction immediately before posting.
- Pi RPC acknowledgement alone clears submitted attachment IDs; newly added images survive. Rejection preserves missing original images in recovered items. Unknown sends stay blocked, and explicit allow-another-send retains images removed during the uncertain send.
- Stop cancels unposted image preparation; posted requests retain existing unknown/acknowledgement rules. No automatic retry.
- Pi queue_update/clear_queue report text, not image identity. Accepted image sends retain explicit imageRecovery (max 32) until Restore images/Dismiss; do not infer consumption from snapshots, count, idle, caption or normalized Pi image content. Caption recovery remains authoritative and separate. Pending image previews may remain unconfirmed after Pi normalization; this is deliberate conservative behavior, not authority.
- Image recovery is collapsed/bounded, not a duplicate prompt replay. Restoring images merges references without overwriting newer draft text; recovered rejected items restore text+images with bounds.
- IndexedDB writes use one readwrite transaction to check 128 MiB quota across windows. On each write, collect localStorage library references; delete only unreferenced entries >24h old. Corrupt/unreadable libraries never authorize GC. Grace protects other windows/in-flight drafts. Confirmed session deletion removes draft references; orphan blobs expire on subsequent saves rather than immediate deletion, preserving copied recovery references.
- Temporary images never touch IndexedDB; bounded window-local map released with owning session disposal. Temporary drafts remain excluded from library serialization.
- Object URLs revoked on removal/reset/disposal; reuse unchanged transcript image elements to preserve load/scroll stability. Existing TranscriptScroll resize/follow handling owns geometry, never force-focus or scroll on load.

## Tests and acceptance

`test/image-attachments.test.ts`: bounds/formats/reference-only persistence, newer attachment acknowledgement, rejected restoration, reload uncertainty and strict steering reconciliation.
`test/session.test.ts`: actual prompt fields/image-only acceptance and malformed/slash validation before writing.
`test/browser/paste-images.spec.ts`: offline WebKit image decode/removal/image-only send, mixed selection insertion and session isolation. Fixture allows local blob resources while aborting external networking.
Automated WebKit also checks persistent-store byte roundtrip through a new store instance and missing-reference failure. Native paste acceptance, actual app reload/quota behavior and Linux desktop/Wayland acceptance remain manual checks. Unit/automated WebKit evidence is not native macOS acceptance. No user app or live Pi/model is launched by validation.

See [user guide](../../../../docs/image-paste.md).
