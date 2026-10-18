# Typography

**Status: source implemented; fixtures authored, unrun.** [User guide](../../../../docs/settings.md#typography). Global Settings → Appearance owns two independent family/size pairs; whole-webview [zoom](transcript-interaction.md#focus-reset-and-zoom) remains separate.

## Contract

| Preference | Key | Default |
| --- | --- | --- |
| Conversation family | `appearance.conversationFont` | Empty string: System default |
| Conversation size | `appearance.conversationFontSize` | 14 logical CSS px |
| Monospace family | `appearance.monospaceFont` | Empty string: System default |
| Monospace size | `appearance.monospaceFontSize` | 14 logical CSS px |

Sizes are integer 10–32 inclusive, in one-pixel steps. Family names are at most 200 Unicode scalar values, without control characters or surrounding whitespace. Empty means the existing portable system stack. Names are quoted as **one CSS family**, never interpreted as CSS/font-stack declarations. A missing font retains its saved choice and falls back to the system stack; switching machines does not rewrite preferences. No downloaded/bundled fonts, font-file import, weight/style/ligature controls or project overrides.

Conversation typography applies to user/assistant prose, reasoning text/previews, question/answer text and offered options, operation content, formatted web prose and the composer. Monospace typography applies to code/inline code, raw inputs, literal/console/diff tool output and code-like input previews. Shared editor-family compatibility tokens continue serving bundled/external cards. Tool labels retain interface typography; native chrome, Project bar, Session sidebar, Status-area controls, Settings and pickers keep their system UI font and existing sizes. Formatted web source notes retain their compact hierarchy.

Both pairs apply to captured-code/Markdown pop-outs, including already-mounted references through their scoped-preference refresh. Typography does not change zoom; the existing 125% default zoom scales logical font pixels as before.

## Controls and native boundary

- Global-only `#settings-typography` stays hidden as a complete group in Project settings. Shared project/welcome Settings controllers still install typography presentation, without installing controls or requesting font enumeration.
- Each row has a font button and labelled numeric size field with decrement/increment buttons. Valid numeric input previews locally without writing; native change/blur commits, and step buttons commit directly. Invalid committed numbers restore the current saved value and report via the application notice strip, without a native validation bubble.
- A compact preview includes prose, inline/block code and a read-only composer sample. Selection and size edits paint immediately in Settings; existing queued JSONC/CAS saves synchronize project/reference windows through ordinary revision-ordered preference broadcasts. Failure removes only the matching pending field version and restores committed presentation, never overwriting newer edits. There is no result gate for local controls/preview, no global font-preview protocol and no save on every keystroke.
- **Reset typography** deletes all four global keys in one JSONC patch, preserving unrelated keys/comments, theme, zoom and project overrides. External edits/deletion retain existing last-valid/error behavior.
- `src/font-picker.ts` mounts one searchable shared-shell dialog over Settings. It uses `showModal`/`closeModal`, native modality and the installed shared motion owner. System default is first; the monospace picker sorts fixed-pitch families before other families, without prohibiting proportional fonts. Each family name samples itself; badges use the interface font. Current choice, arrow/Home/End selection, Enter/click acceptance, Escape/Close cancellation, opener focus and retained parent Settings are explicit. Search never changes the selected preference. No additional palette action/keybinding is introduced for these field controls.
- `src-tauri/src/fonts.rs::installed_fonts` accepts only the global Settings caller and enumerates system families with `font-kit` on a blocking worker, never on the UI thread. Core Text is the macOS source; Linux uses Fontconfig/FreeType; possible Windows uses the dependency's native source, without a parity claim. Hidden dot-prefixed families, invalid/oversized names and duplicates are excluded. Metadata failures log the specific family and leave it in the ordinary family group; inventory/empty-catalog errors reach the notice strip. The frontend caches a successful inventory for that Settings-window lifetime; **Refresh** explicitly re-enumerates, including newly installed fonts. Enumeration starts only on opening a font picker and never gates initial Settings presentation. No shell/process font discovery, font bytes over IPC, user-session reads or remote font services.

## Geometry and performance invariants

`src/typography.ts` validates/quotes families and applies a changed-only root-local presentation signature. Unrelated settings/state/streaming notifications do not write CSS or produce typography geometry work. Theme application owns colors only and does not reset typography.

Before a real typography change, mounted active conversation views capture transcript follow intent and independent tool-output scroll offsets; afterward they resize the composer through its existing capability/fallback helper, restore inspected output offsets (follow only an already-following live output), and use `TranscriptScroll` for transcript reflow/follow. No second transcript scroll owner, forced bottom navigation, synthetic input/resize events, draft writes, harness calls, focus changes or disclosure/controller reconstruction. Deferred font completion also uses existing resize ownership. Hidden views skip typography geometry work and reuse existing suspended positions/activation resizing.

Scanning output viewports is restricted to actual typography changes, not routine streaming. Preserve the [typing](../../performance-optimizations/references/composer-typing-hot-path.md#regression-risks-and-maintenance-guardrails), [hidden-paint](../../performance-optimizations/references/hidden-session-painting.md#regression-risks-and-maintenance-guardrails) and [affected-output](../../performance-optimizations/references/tool-output-scroll-work.md) boundaries.

## Code and acceptance map

- `src/typography.ts`, `src/typography.css`: shared decoding, safe family stacks, root tokens, scoped content styling and geometry notifications.
- `src/typography-controls.ts`, `src/font-picker.ts`, `index.html`, `src/settings-surface.ts`: controls, field-version optimism, modal lifecycle, installed inventory and global scope.
- `src/preferences.ts`, `src-tauri/src/preferences.rs`: mirrored validation, global-only reads/writes and reset-by-deletion. Native project allowlisting rejects these keys.
- `src/conversation-view.ts`, `src/popout.ts`: mounted-view geometry preservation and reference synchronization.
- Authored **unrun** fixtures: `test/typography.test.ts` (bounds, safe quoting, changed-only notifications, independent UI tokens, preview-before-save, version races, rollback/reset, picker samples/filtering/keyboard, parent/focus, missing catalog and cancellation of late results); `test/preferences.test.ts` and native preference fixtures (global JSONC saves/reset, invalid snapshots and boundaries); `test/native-view.test.ts` (follow/reader, mounted identity, drafts/selection/focus and hidden skip); `test/browser/typography.spec.ts` (offline real-layout controls/samples/global synchronization/content-only CSS/reset and inspected-output/follow preservation). Shared offline fixtures include typography CSS and a fixed font catalog; they never enumerate the user's fonts.

No app build/launch, native font-panel comparison or macOS/Linux visual acceptance has been performed. Real WKWebView font availability, fixed-pitch classification, long/symbol/non-Latin family samples, fallback glyphs, keyboard/focus, selection and output/reader behavior after large size changes need native acceptance. Linux system discovery/rendering remains unverified; possible Windows is not a parity commitment. Run broader/offline-browser validation only when requested.
