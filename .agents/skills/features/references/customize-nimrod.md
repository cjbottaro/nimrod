# Customize Nimrod request contract

The [Customize Nimrod skill](../../customize-nimrod/SKILL.md) owns the workflow specification. This reference owns its concrete message, authoring-resource, consumer and modal contracts. [User guide](../../../../docs/customize-nimrod.md); [verification](verification.md#customize-nimrod) owns execution/acceptance evidence.

## Session action and normal submission

`customize-nimrod` is a Nimrod-owned session action, bindable without a default shortcut. The shell contributes it when its presented, connected, non-retiring session can accept an ordinary text message. No backend whitelist, session creation, implicit connection or harness skill registration. Opening it does not send anything. Each integration's existing interaction policy validates text and supplies its unmodified Enter intent: Pi/Codex may steer during work, while busy-rejecting integrations keep their ordinary restrictions. No new queue or automatic Stop.

`ConversationView.validateUserText`, `submitUserText` and `userTextLifetime` are consumer-facing view operations for a separate text input, not a harness protocol. The shared view checks its latest snapshot, disposal/activation/deletion/preparation gates and integration policy. It rejects non-prompt control/slash intents. Both ordinary Composer sends and separate-input sends reuse pending-preview, Send recency/follow effects and typed prompt dispatch. The modal path never clears or temporarily swaps the Composer draft, attachments, recovered messages or selection. Expected correlated receipts and authoritative echoes retain their current ownership/reconciliation; unexpected synchronous/Promise dispatch failures mark delivery unknown without mutating the draft or replaying.

The shell binds the modal to the actual tab/project, native token and a view lifetime identity that changes on session Reset/disconnection. Reconnection or a new controller cannot revive an old modal, even for an integration without a native process token. Opening, final validation and synchronous submission all recheck the owner. Mutable active-session lookup never routes a delayed request. No feature-specific RPC/SDK prompt implementation exists.

## Modal ownership

`installCustomizeNimrodDialog` mounts one ordinary shared modal using `showModal`/`closeModal`, shared footer navigation and textarea sizing. User input is immediately editable while local authoring context loads; Send stays disabled until the brief is available, the input is nonblank and the owner is eligible. The included instructions are inspectable as literal text in a collapsed disclosure. No external markup executes in the preview.

`Send request` builds one envelope and validates it locally. A synchronous local rejection keeps the modal/input. Accepted dispatch updates the pending transcript and local Send effects, then clears/closes the modal in the same interaction, without awaiting acknowledgement. No late failure restores submitted text or replays it. The shared close lifecycle restores focus; capture/close occurs before clearing the modal's DOM values so exit snapshots retain the visible request. Enter submits, Shift+Enter inserts a newline, and IME/repeated Enter cannot submit. Escape/Cancel sends nothing and discards this ephemeral input, leaving the Composer unchanged.

Lost eligibility disables Send and preserves unsent input until cancellation; it never reconnects or automatically submits after recovery. Missing guidance reports through the originating session's existing notices and keeps input. Generation/owner checks discard late guidance after cancellation, a newer open or disposal. Controls refresh on existing shell lifecycle/selection updates, input and context completion—not a timer or per-content history scan. Modal availability text is a disabled-state explanation, not a second operational error surface.

## Installed authoring references

`customization_authoring_context` verifies native project-window ownership and resolves the authoritative project directory, global `ui` / `card-plugins` directories beside settings, installed reference directory, actual running executable path, package version and platform. It checks required reference files. It does not create/write customizations, export arbitrary files or invoke any harness.

Tauri bundles these canonical sources read-only under `resources/customization/`, preserving their repository-relative layout:

- `docs/`: user-facing authoring/CLI guides and their linked guides.
- `src/ui-templates/`: all four dogfooded defaults.
- `src/card-plugin-api.ts`: public card types.
- `examples/card-plugins/`: public example sources/manifests.

`customizationBrief` uses those resolved absolute paths and concise public-surface guidance. It does not read `.agents`, depend on the session cwd containing Nimrod code, use online/latest docs, register a skill, or require a discovery CLI. The brief includes a shell-quoted CLI command using the actual running executable (no PATH/launcher installation dependency) and targeting the originating project (not a later tool cwd), global-file/current-window scope, existing-file preservation and no app-source/build/restart fallback. On platforms without the reload CLI it directs the user to the existing palette action instead. Actual tool access/permissions remain harness-owned.

The references travel with a complete app build/package; the native command rejects incomplete resources instead of supplying broken source-checkout paths. Build/package and native acceptance remain explicit validation activities, not consequences of opening the modal.

## Versioned user-message envelope

The full message is normal user text. Version 1 has this exact framing:

```text
[nimrod-customization:v1]
{"instructions":<UTF-16 code-unit count>,"request":<UTF-16 code-unit count>}
Nimrod customization instructions:
<exact brief>

User customization request:
<exact user input>
[/nimrod-customization:v1]
```

The header's two keys are required, with positive safe-integer counts and no additional keys. Counts use JavaScript string length, not UTF-8 bytes or Unicode code-point count. Labels, separators and trailing marker are exact; nothing may trail the marker. The parser bounds the header read, checks both lengths/separators and preserves request whitespace, CRLF, emoji and delimiter-like text verbatim. It does not search for an end delimiter inside user input. This is a presentation format, not proof of origin or elevated authority. A user can deliberately type it; it still has only normal user-message authority.

`customizationUserText` runs only on user turns, before integration-owned user-text hooks. It uses shared lazy instruction-disclosure mechanics, never a Pi/Copilot skill parser. The actual sent brief is collapsed under **Nimrod customization instructions** with the user request below it; no hidden second turn or fabricated tool call. Stable source/node caching retains disclosure identity during normal dirty/full updates and optimistic echo adoption. History/Resume reconstructs from the actual message, not mutable app metadata or a newly generated brief. Other clients see readable labels and the full text.

Unknown/malformed messages beginning with the explicit customization namespace render as literal text rather than hiding a guessed brief. Ordinary text, fenced examples, assistant turns and harness-owned skill/question formats retain their existing handling. Existing transcript/scroll/Markdown owners are unchanged; there is no second renderer engine or per-chunk full-history work.

## Code and fixture map

- `src/customization-message.ts`: v1 serializer/parser and retained user-turn presentation.
- `src/customization-brief.ts`: installed context shape, concise brief and POSIX path quoting.
- `src/customize-nimrod-dialog.ts`, `src/customize-nimrod.css`: shared modal input/preview/lifetime and content styling only.
- `src/conversation-view{,-host}.ts`: ordinary separate-input validation/dispatch/lifetime and shared user-turn presentation.
- `src/main.ts`, `src/keybindings.ts`: session-bound action, native context and shared dispatcher wiring.
- `src-tauri/src/customization_authoring.rs`, `src-tauri/tauri.conf.json`: native paths/ownership/resource checks and canonical resource packaging.
- `test/customization-message.test.ts`: exact Unicode/framing, malformed versions, lazy retained/raw presentation, unrelated-project brief and package mappings.
- `test/customize-nimrod-dialog.test.ts`: inspectable brief, separate draft, local rejection, IME/repeat rules, cancellation and stale/failed loading.
- `test/conversation-view.test.ts`: real mounted text path across Pi/Copilot/Codex/unknown-ACP policies, unchanged draft/selection, echo adoption, busy modes and lifetime retirement.
- `test/shell.test.ts`: unrelated-project palette/shortcut submission, one native prompt, no automatic reload/start/stop, existing Composer preservation, lost connection and cancellation.
- `test/browser/customize-nimrod.spec.ts`: offline trusted modal interaction, preview, Escape, Send, focus and retained prompt/disclosure.

Follow [composer](composer.md), [modal](modal-layout.md), [error](error-presentation.md) and [incremental rendering guardrails](../../performance-optimizations/references/incremental-transcript.md#regression-risks-and-maintenance-guardrails). Run broader tests/browser checks only when requested. No paid prompts, live user customization edits, app launch or packaging are implicit in implementation.
