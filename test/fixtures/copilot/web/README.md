# Copilot web-card examples

Scrubbed native SDK start/completion pairs captured locally on **2026-10-17**,
from `copilot-sdk/copilot/2026-10-17.jsonl`. These committed files are the durable
card-development corpus; the original transcript logs are not required.

| Example | Observed behavior |
| --- | --- |
| `search-answer.json` | GitHub MCP `web_search`, long Markdown answer, 14 citations / 6 unique URLs, repeated citations and non-ASCII text. |
| `search-scoped.json` | Site-scoped query, 6 citations / 3 unique URLs, fenced commands and inline links. |
| `fetch-page.json` | Ordinary Markdown fetch with headings, images and `about:blank` links in the native text. |
| `fetch-redirect.json` | Explicit original/final URLs, relative links and fenced commands. |
| `fetch-partial.json` | Redirected page ending in the native truncation note with `start_index: 10000`. |
| `fetch-permission-error.json` | Historical native `error` completion without a `result`; the old malformed permission-decision failure, not a current expected permission outcome. |

## Retained versus scrubbed

- Retain exact native argument/result/error shapes, MCP server/tool identity,
  search answer/citation offsets, duplicate result representations, fetch
  preambles, redirects, relative links and partial-content wording. Public
  documentation URLs/content and documentation-search queries are retained.
- Replace each tool-call ID consistently with the example name. Replace the
  failed fetch's repository-specific URL with `https://example.test/fixture.txt`.
- Omit the capture envelope, session/connection/capture/event/interaction IDs,
  receipt/native timestamps, parent links, model/turn attribution and telemetry.
  Store history-delivered events as the same native start/completion pair; no
  history/live delivery semantics are implied by these files.
- No prompts, unrelated conversation, credentials, user-local paths, permissions
  or executable replay instructions are stored. Recorded command/code snippets
  are display data only. Search-generated claims are not verified API guidance.

`test/copilot-web-fixtures.ts` loads fresh copies for adapter/DOM tests and offline
Playwright demo fixtures. They feed existing fake event channels, never a live
SDK. Synthetic malformed/unsafe-link/Unicode edge cases remain alongside these
captures in `test/copilot-web-cards.test.ts`.

When adding examples, scrub identities/paths/secrets before committing. Preserve
answer strings and citation offsets together; changing one without the other
turns a native example into a malformed fixture. Keep failures and partial
results rather than only successful pretty output. New regression fixtures are
authored but unrun; fixtures are not native visual/platform acceptance.
