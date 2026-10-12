# Error presentation policy

**Status: shared strip and app routing implemented in the task branch; producer-metadata cleanup and native acceptance pending.** This is the canonical agent-facing policy for Nimrod-owned errors, warnings and delivery uncertainty. Load it when adding or changing an error path, notice, banner, flash message or operational notification. Feature references own the underlying operation semantics; this reference owns in-app presentation and routing. OS alert delivery/presentation remains owned by [Notifications](notifications.md), not this notice-strip policy.

## One application-error surface

All Nimrod-generated errors use a single shared **notice strip** at one consistent window-relative location. This includes send, connection, startup/restart, persistence, model/thinking, Settings, dialogs, command-palette actions and other Nimrod operations. There are no operation-local error-placement exceptions.

The strip is owned by the application shell, not a session's composer or the failing control. It is fixed 48 CSS pixels below the viewport top (below the project/Settings header), with one shared content region across conversation, Settings, modal, welcome and empty-project surfaces. Pop-outs use the same position and reserve equivalent space when notices exist.

- Do not create additional inline error messages, feature-specific banners, bottom-of-window overlays, transient flashes or synthetic transcript entries for these errors.
- The Status area describes agent activity, model/thinking, usage and queues. Do not overwrite its activity text with arbitrary error messages. State such as disconnected/unavailable remains distinct from its explanatory notice.
- The transcript contains authoritative harness conversation output, including actual agent/provider/tool failures belonging to a turn or tool card. Preserve that output; do not convert it into a Nimrod notice or add a duplicate application-error turn.
- Settings, dialogs and command-palette failures use that same strip, not messages beside their controls. Identify the failed operation in the message instead of changing its location. Field guidance and non-error progress text are not alternative error surfaces; a control's invalid state must not trigger a second error bubble/message.
- Opening or closing Settings/dialogs, switching sessions, or showing welcome/empty-project content must not relocate the strip or introduce another error mechanism. Context changes do not discard outstanding notices.
- The strip must remain visible and its actions accessible while Settings or a modal dialog is open, without closing the owning surface or weakening its modality. Account explicitly for native HTML dialog top-layer/inert behavior; a larger z-index alone is not sufficient.

## Ownership and deduplication

- Route by the failed operation and its owner, not by whichever module caught the exception. Session notices belong to the originating session/process generation; app-wide notices belong to the window/application concern, not the selected session by accident. Ownership determines message context and valid actions, never a different display location.
- One failure has one visible error presentation. Propagation through native storage, transport, session coordination and rendering must not multiply it into several messages. Correlate by operation/cause identity; identical wording alone must not collapse unrelated failures.
- Prefer the actionable user-level outcome over a cascade of derivative exceptions. For example, connection loss before a send receipt should explain unknown delivery once, not independently report a process error, disconnect banner and send error.
- Independent outstanding errors must remain discoverable; a later message must not silently overwrite an earlier unrelated one. Use the same notice surface rather than introducing a second banner or toast to avoid overwriting.
- Background-session errors do not select a session, focus a window, resume an agent or scroll a transcript. Existing sidebar-attention/desktop-notification policies remain authoritative for background signaling.

## Lifecycle, layout and actions

- Errors remain until explicitly dismissed or their own underlying issue is resolved. No automatic timed disappearance for operational errors or uncertain delivery.
- Resolving one operation clears only its matching notice. Unrelated success, routine snapshots or later activity must not erase another error.
- Dismissal is presentation only: it does not fix the issue, acknowledge delivery, retry a request or remove an operation's safety gate. Send uncertainty has no recovery action or extra submission gate; Dismiss only hides its notice.
- Show actions only when their semantics are known and permitted by the owning feature. Never replay a prompt after ambiguous acceptance; a connection Retry must not secretly resend a message.
- Reserve the strip's consistent location in the application shell layout with shared styling/gutters; do not overlay transcript content or append it to individual forms/composers. Preserve transcript reader intent, node identity, input focus and dialog focus ownership when it appears, updates or disappears. Never force-scroll, steal focus or navigate to draw attention.
- Use appropriate accessible error/status semantics. Announce a new/changed notice without repeatedly announcing unchanged content on streaming snapshots.

## Wording

Use a consistent, concise structure: **which operation failed or is uncertain**, **its effect**, and **an actionable next step when one exists**. Name the affected setting, dialog action or session when needed so the common location does not lose context.

- Be explicit about not sent versus acceptance unknown; do not label unknown delivery as a rejected send.
- Send clears the composer immediately. Successful send: no error or recovery copy. Definitively rejected send: show the error without restoring the attempted message. Unknown send: show a dismissible uncertainty notice without recovery actions or an extra submission gate; no automatic retry. Every outcome preserves newer drafts. See [Composer](composer.md).
- A later model/provider failure does not retroactively make an accepted submission not sent. Its actual harness output stays in the transcript.
- Do not expose plumbing as a user workflow: no image-send recovery section, stack traces in the primary summary, or instructions to manage internal backup copies. Diagnostic detail can be available separately without replacing the useful summary.
- User cancellation is not automatically an error; use neutral wording when the operation was intentionally cancelled.

## Implementation and code map

- `src/application-notices.ts`: window-local NoticeStore, independent occurrence IDs, owner/cause grouping and priority selection. Unknown delivery (priority 100) outranks connection state (10); the lower-level issue remains grouped with the delivery error. Dismiss suppresses that cause's presentation, but never reconnects the session. Identical wording never merges unrelated IDs. Dismissal suppresses unchanged re-reports of the same occurrence until explicit resolution or changed/new occurrence; it does not change feature state.
- The renderer preserves unchanged rows/action nodes and announcements. Action callbacks are refreshed without publishing unchanged signatures; execution revalidates the latest guarded action. No automatic retries or timers.
- One strip DOM node moves into the actual last-open native HTML dialog to escape inert/top-layer restrictions, without changing its viewport position. It does not close dialogs. Native pointer-focus fixups can focus the dialog container after a notice action; restore the previously focused control only when focus is vacant, never steal it from another input. Detached/closed owners cannot execute stale actions.
- `src/application-notices.css`: shell slot reserves the strip's measured layout-pixel height. ResizeObserver schedules one pre-paint measurement instead of writing shell geometry during resize delivery; unchanged reports do not force layout. Direct writes during delivery caused WebKit ResizeObserver-loop failures when plugin diagnostics added notices. Settings reserves equivalent space, ordinary modals clamp below it only while notices exist, and references reserve space without overlaying document content. Percentage-height Settings fits the viewport under CSS fixture zoom as well as native page zoom; offsetHeight avoids confusing scaled viewport pixels with layout pixels.
- `src/main.ts`: shell installation, session ownership, connection/source priority, storage and submission causal grouping, Settings/palette/plugin/notification feedback, explicit owner disposal. The legacy projectErrors producer channel now reports to the strip rather than a visible element. It remains a cleanup target for more precise operation/cause tags, not an alternative UI.
- `src/pi/view-host.ts`, `webview-client.ts`: optional presentation-only report/resolve hooks; the app always supplies them. Send/image/clipboard errors and unknown-delivery notices route to the shell. Standalone renderer fixture compatibility retains local fallback behavior when no shell host is provided. Legacy submission/tab/storage/preference elements in the app remain empty/hidden, not active error surfaces.
- `src/pi/session.ts`, `reducer.ts`: operation/extension notify errors use typed UI callbacks; process state is Disconnected rather than a diagnostic string. Mark unavailable before ModelThinkingController.disconnect publishes its control snapshot so a transient old available state cannot resolve the connection notice. Palette preference failures are reported once, not also through a project channel.
- `src/settings.ts`, `zoom.ts`, `themes/picker.ts`, `keybinding-editor.ts`, `command-palette.ts`: optional producer callbacks supplied by the app, suppressing inline operational errors. Successful matching settings operations resolve only their own feedback cause. Runtime/launch forms disable native validation bubbles and use owned validation. Progress, selection guidance and conflict descriptions remain local non-error UI.
- `src/popout.ts`: same notice renderer for reference-window failures; source-copy failure no longer creates a second error paragraph or failed-copy announcement.

This is Nimrod presentation code, not a universal harness protocol. Authoritative harness/tool failure output is unchanged. Harness-authored extension status/widget text has no generic severity field and is not classified by guessing its wording; explicit notify severity is routed to the strip.

## Remaining work and acceptance

- Replace the transitional projectErrors channel and generic Pi-operation labels with precise operation/cause metadata at remaining producers. Strengthen per-operation resolution for palette/model requests and native draft-store health; do not infer resolution merely from a later unrelated success.
- Native Tauri/macOS focus/accessibility announcements, modal layering and page-zoom acceptance still require user verification; Linux/WebKitGTK is unverified. Do not infer native acceptance from browser fixtures or compilation. Remaining producer cleanup is implementation work, not permission to add another error surface.

## Acceptance checks and tests

Fixture tests must cover the same error-strip location across conversation, Settings, modal, welcome and empty-project surfaces; visibility/action accessibility through dialog top-layer/inert behavior; no inline/native-validation duplicates; one error after multi-layer propagation; concurrent independent notices; source-session/window/generation isolation; matching-resolution/dismissal behavior; unknown-delivery notices without recovery gates; and no navigation/replay/focus/scroll side effects. Preserve real harness error content and existing queue behavior.

`test/application-notices.test.ts` covers cause priority, independent identical errors, dismissal suppression, unchanged DOM/announcement behavior, nested modal ownership/focus and guarded action execution. `test/browser/application-notices.spec.ts` exercises one stable position through Settings/nested dialogs, runtime validation without bubbles/inline duplicates and one uncertainty notice for a disconnect cascade. Existing shell/renderer/palette/Settings/plugin/pop-out tests now assert shared-strip routing; transcript and draft regression suites remain required.

Run `mise run check`; layout/scroll changes also require offline `npm run test:browser`. Build only on explicit request. Native acceptance remains separate from fixture evidence; see [verification](verification.md).

[User-facing direction and current limitations](../../../../docs/error-messages.md). [Shared vocabulary](../../nimrod-ui-vocabulary/SKILL.md).
