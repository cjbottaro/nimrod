# Drafts and composer responsiveness

Nimrod keeps saved-session drafts in Rust-managed files beneath the app-state directory:

```text
~/.local/state/nimrod/drafts/<project hash>/<draft-scope hash>.json
```

An absolute `XDG_STATE_HOME` override changes the root, as with other app state. Drafts are separate from `state.json` and Pi's conversation files.

Typing updates the draft immediately in memory and asynchronously stages the current session's record in Rust. Disk saves are debounced by 300 ms, with a 2-second maximum wait during continuous typing. Only the changed draft is written, using atomic replacement. Abrupt termination can lose recent unsaved typing or changes not yet delivered to Rust. Errors are shown without discarding the in-memory draft.

Before sending a saved-session prompt, Nimrod flushes its submission-recovery state. If that fails, nothing is sent. Pi's acceptance response alone clears an unchanged submitted draft; newer text survives. Uncertain acceptance is never automatically replayed. Recovery/attachment changes request prompt persistence, and Close, window shutdown and Quit flush staged records. Temporary drafts and images remain memory-only.

**Old webview drafts are ignored, not migrated.** Existing localStorage draft text, uncertain-submission recovery and attachment references will not be restored. Their old storage is left physically untouched. Pi conversation history, settings and open-session bookkeeping are unaffected. Newly created unfinished drafts remain available through explicit unattached-draft recovery.

Image bytes remain in IndexedDB; native draft files contain attachment references only. Unreferenced images older than 24 hours can be collected on subsequent image saves. Legacy localStorage references do not prevent that cleanup. Failure to read native references disables cleanup for that save.

The composer uses native CSS content sizing where the webview supports it. Older engines use coalesced manual sizing. Draft edits do not rebuild unchanged status controls or rerender the transcript. Existing height limits, zoom, bottom-follow and older-history reading behavior are retained.

Offline WebKit fixtures exercise sizing, typing, persistence ordering, focus and scrolling. They do not establish packaged-app typing latency; native macOS feel and Linux/Windows acceptance remain to be validated.
