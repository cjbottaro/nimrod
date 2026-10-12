# Pi Web Access cards

An optional external Nimrod plugin for Pi's `pi-web-access` extension. It is a normal personal TypeScript plugin—not a built-in renderer or a Pi extension modification.

## Install and reload

Copy [`plugins/pi-web-access.ts`](../plugins/pi-web-access.ts) to:

```text
~/.config/nimrod/card-plugins/pi-web-access.ts
```

Use the directory beside your resolved Nimrod settings when an absolute XDG config root is configured. No manifest, dependency installation, app rebuild or per-file enable/trust setting is needed. The file uses only the existing browser plugin API; its type-only SDK import is erased.

Run **Reload card plugins** in Nimrod's command palette, or reopen the window. Newly mounted tool cards use the plugin; cards you're already inspecting retain their existing renderer. Installation in the personal directory trusts the code, as described in [Card plugins](card-plugins.md#personal-typescript-plugins).

ID: `nimrod-plugins.pi-web-access`. Default matching covers `web_search`, `fetch_content`, `get_search_content` and `source_check`, including normal namespace prefixes. `web_enable` stays generic. If your Pi extension renames its tools, adjust the plugin's `TOOLS` and label mapping; it does not read Pi's configuration or credentials.

## What you get

- Request summaries for queries, URLs/paths, claims and stored-content selectors, with requested options. Proxy/auth settings are not repeated in the presentation (core Raw inputs remains available).
- Search/source-check/stored-search **source links mentioned in returned text**, grouped by query when present. Open and Copy URL use Nimrod's presentation APIs; nothing is fetched automatically.
- Compact plain-text progress while a tool is running; request/result controls and richer layouts mount only after execution finishes.
- Safe readable Markdown for returned content, and literal text for `fetch_content` with `mode: "raw"`.
- Copy returned text, Copy response ID and Pop out returned text. These are read-only presentation actions, not search/retrieval requests.
- Independently scrolling source/content viewports with core live/final caps and retained inspection positions. Native status/disclosure remains core-owned.
- Full retained raw inputs/output recovery if the plugin is missing or fails.

Relative Markdown links resolve against a single known fetched/requested HTTP(S) URL. Without that reliable base (for example multi-URL results), relative links are inert rather than opening project files. Unsafe/non-HTTP(S)/credential-bearing links are not offered as link actions. No remote images, previews, favicon loads or extra web requests occur.

## Long code-block containment

The result viewport establishes its own positioning boundary. This keeps code-block accessibility/Copy-status elements inside the independently scrolling result, rather than extending the transcript's scroll range into an empty region. The temporary troubleshooting trace/button has been removed. Reload and use a new tool card to pick up this fix; existing mounted cards retain their old renderer.

## Evidence and limitations

The renderer is based on the installed `pi-web-access` **0.38.0** input/text formats. It recognizes numbered title/URL pairs and stored-result headings; other text still renders safely with raw recovery. Source-check assessments are displayed as returned, not independently verified by Nimrod.

The current SDK supplies text, not extension `details`, structured results, image/video blocks, provider routing metadata or total/progress fields. Link counts mean **links shown**, not total provider results. Results may already be truncated by the extension; the plugin cannot retrieve missing content itself. It exposes mentioned response IDs for copying, not an automatic next-page action. Cached raw content retrieved via `get_search_content` cannot be reliably distinguished from readable content without metadata; exact Copy/Raw output remains available.

Resource guards show an explicit notice when source links exceed 200 or response-ID controls exceed 32; complete retained output remains below/in Raw output. A clipped final URL near the extension's truncation marker is conservatively excluded from link actions.

Unit and offline WebKit/CSP tests use synthetic text and mocked native actions. They make no paid searches, provider requests, actual clipboard/editor/pop-out operations or real-session mutations. Native visual/interaction acceptance remains yours to validate in the app.
