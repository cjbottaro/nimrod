# Drafts and composer responsiveness

Copilot drafts use a separate `copilot-sdk:` identity scope. Close keeps saved
drafts; confirmed deletion cleans only the target scope. Drafts from the removed
earlier integration are left on disk, but are not restored or copied into current
sessions. See [Copilot history](copilot.md#history-close-and-delete).

Nimrod keeps saved-session drafts in Rust-managed files beneath the app-state directory:

```text
~/.local/state/nimrod/drafts/<project hash>/<draft-scope hash>.json
```

An absolute `XDG_STATE_HOME` override changes the root, as with other app state. Drafts are separate from `state.json` and Pi's conversation files.

Built-in [SDK Copilot sidebar sessions](copilot.md#history-close-and-delete) also use native draft storage, scoped by project, Copilot identity and session ID rather than a Pi file path. Their drafts survive quit/reopen and Close; custom ACP drafts remain runtime-only.

Typing updates the draft immediately in memory and asynchronously stages the current session's record in Rust. Disk saves are debounced by 300 ms, with a 2-second maximum wait during continuous typing. Only the changed draft is written, using atomic replacement. Abrupt termination can lose recent unsaved typing or changes not yet delivered to Rust. Errors are shown without discarding the in-memory draft.

Send clears the editable draft immediately. Pi responses are correlated by the transport, not composer state; submission text/images are not saved as recovery, restored after a failure or replayed after reload. Failed or uncertain sends show an error without changing the next draft or adding a recovery gate. Cleared drafts and queue-restoration/attachment changes request a storage flush, but sending does not wait for draft persistence. A storage error reports a storage problem, not that the message was unsent. Close, window shutdown and Quit flush staged records. Temporary drafts and images remain memory-only.

**Old webview drafts are ignored, not migrated.** Existing localStorage draft text, uncertain-submission recovery and attachment references will not be restored. Their old storage is left physically untouched. Pi conversation history, settings and open-session bookkeeping are unaffected. Newly created unfinished drafts remain available through explicit unattached-draft recovery.

Image bytes remain in IndexedDB; native draft files contain attachment references only. Unreferenced images older than 24 hours can be collected on subsequent image saves. Legacy localStorage references do not prevent that cleanup. Failure to read native references disables cleanup for that save.

The composer uses native CSS content sizing where the webview supports it. Older engines use coalesced manual sizing. Draft edits do not rebuild unchanged status controls or rerender the transcript. Existing height limits, zoom, bottom-follow and older-history reading behavior are retained.

Offline WebKit fixtures exercise sizing, typing, immediate send clearing and draft-only persistence, focus and scrolling. They do not establish packaged-app typing latency; native macOS feel and Linux/Windows acceptance remain to be validated.
