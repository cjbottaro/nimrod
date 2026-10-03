# Nimrod

A dedicated cross-platform agent workspace, with bespoke harness integrations. Pi is the first and only implemented harness; do not invent a generic harness protocol before a concrete second integration.

Read README.md and docs/architecture.md before changes. Preserve exact streaming, acknowledgement, tool disclosure, focus and scroll behavior inherited from Pi GUI. Harnesses remain authoritative for conversations, tools, models and configuration.

- For UI discussions or changes, load [nimrod-ui-vocabulary](.agents/skills/nimrod-ui-vocabulary/SKILL.md) and use its shared terminology. Keep agreed vocabulary there rather than duplicating it here.
- For feature implementation/debugging/review, load the shared [features](.agents/skills/features/SKILL.md) skill, then only the relevant per-feature references from its index.
- Document every new or changed feature in two layers: a concise human guide in `docs/` (usage, visible behavior, limitations) and a detailed reference in `.agents/skills/features/references/` (code map, invariants, storage, platform pitfalls, tests). Update both with behavior changes and add new items to the features skill index; link human guides from the docs index/README. Keep detailed internals and debugging history in agent references, not walls of prose in human docs.
- Rust is installed and pinned through mise.toml. Use `mise exec -- cargo ...` or `mise run check`.
- Implement directly unless delegation is requested/approved. No commits or pushes without permission.
- Keep work local. Tests use fixtures; no paid model requests, live compaction, user-session deletion, or changes to upstream Pi/extensions without explicit authorization.
- Do not alter or reinstall the sibling pi-gui extension when working here.
- Do not use a browser for debugging or development unless the user explicitly asks. Automated tests (including browser-based tests) are fine. Ask the user to validate visual behavior rather than interactively inspecting it.
- Validate with `mise run check` and `mise run build`. Scrolling changes also require `npm run test:browser` (one-time setup: `npx playwright install webkit`); these run the offline demo in an isolated browser, not the user's app. Do not launch or interrupt the user's app/window without approval.
- Never replay a prompt after ambiguous acceptance. Only Pi's acknowledgement clears the unchanged submitted draft.
- One directory per window, independently live sessions, an Open sessions sidebar (no tab strip), and command-palette history navigation; see docs/workspace-sessions.md for behavior and remaining native acceptance. Native ownership is window/token-scoped. Resume is user-triggered, never automatic. Pi owns session files; drafts are scoped separately. Stop only owned children; no OS-wide process scans or claims of excluding external writers.
- Do not claim native/platform acceptance from jsdom or unit tests. Document actual verification and remaining limitations.
