# Syntax highlighting: implementation

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#syntax-highlighting) retain prior execution records.

## Specification and acceptance criteria

Explicit labels always win; only user text opts into strong unambiguous inference. Unsupported/weak code stays plain, source bytes survive Copy/Pop out, and captured snapshot language is never re-guessed.

## Code map and policy

- `src/pi/safe-markdown.ts`: common Highlight.js bundle plus locally registered
  Elixir (`ex`, `exs`) and Erlang (`erl`) grammars. Shared `highlightCode` normalizes
  trim/case for explicit labels in Markdown and `renderCode` snapshots.
  `render(markdown, { detectUnlabeledCode: true })` opts into conservative inference;
  default Markdown and snapshot rendering never infer a language.
- `src/pi/webview-client.ts`: only `renderUserText` opts into inference, including
  string content, text blocks, incremental updates, pending steering, and user
  skill invocations. Assistant, reasoning and other Markdown remain explicit-only.
  Exact code-source extraction and delegated Copy/Pop out actions are unchanged.
  Fence labels or the existing detected header fallback supply snapshot language.
- `src/popout.ts`: code snapshots call `renderCode`; Markdown snapshots call
  `render` without detection. No snapshot fingerprints/schema/storage changes.
- `src/pi/transcript.css`: existing `hljs-*` token styles using theme variables.
- [User guide](../../../../docs/syntax-highlighting.md).

## Detection thresholds

The original unrestricted `highlightAuto` accepted relevance >= 2, frequently
mislabeling short code, logs and prose. User-only detection now requires all of:

- winner relevance >= 6;
- winner minus runner-up relevance >= 2;
- winner relevance >= 1.5 times runner-up relevance.

Missing runner-up relevance counts as zero. These are heuristic scores, not
calibrated probabilities. Ties remain plain text, even at high relevance. In
particular, common Elixir snippets can tie with Ruby; explicit Elixir labels always
highlight correctly. Do not replace a user's explicit unknown/plain-text label
with a guess. Registered common languages plus Elixir/Erlang remain candidates;
no guessed project language, runtime fetch, language picker or harness changes.

## Invariants

- Source text and whitespace survive highlighting exactly as supplied to the code
  renderer (Markdown parsing retains its existing newline behavior).
- Highlight output is sanitized before insertion; unhighlighted source uses
  textContent / already-sanitized Markdown. Never admit raw agent HTML actions.
- Code headers preserve explicit labels; aliases/case normalize for lookup only.
  Accepted guesses use `<language> (detected)`; do not turn guesses into fence classes.
- Copy/Pop out construction, disclosure, streaming, focus and scroll mechanisms
  remain unchanged. Detected snapshots preserve their language without re-detection;
  code snapshots still remove their nested Pop out action.
- Saved snapshots retain captured language. Never rewrite user snapshot files to
  apply revised inference thresholds.

## Validation

`test/safe-markdown.test.ts` covers Elixir aliases/case in both rendering paths,
Erlang/common aliases, normalized snapshot labels, explicit user-label precedence,
strong-winner inference, rejection of weak/tied/close guesses, default no-inference,
source preservation, HTML safety and actions. `test/native-view.test.ts` verifies
user vs assistant/reasoning policy across strings and blocks, pending steering,
incremental label changes and detected-language snapshot payloads.

Run `mise run check` and offline `npm run test:browser`. Build/package the app only on explicit user request, then publish to main's CLI-visible app location per [build workflow](build-cache.md#explicit-build-and-publication-workflow).

Shared portable frontend behavior, not a native integration: macOS visual
acceptance and Linux/Windows webview verification remain user/platform checks;
jsdom and offline WebKit fixtures do not establish native acceptance.
