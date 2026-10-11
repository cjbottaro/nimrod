# Notifications

Nimrod sends native desktop alerts when a background session:

- **Finishes:** Pi reports that the agent has settled, not merely finished a turn or tool.
- **Needs input:** an extension input, editor, selection, or confirmation dialog is ready.
- **Fails:** its process/transport disconnects unexpectedly, or its run settles with an assistant error.

Other sessions count as background even while you’re using Nimrod. The remembered session also counts as background when Unread hides its conversation. The selected session notifies when its project window is unfocused or Settings covers its conversation. Viewing the selected session in a focused project window suppresses alerts. Delivery itself does not focus/select another session, resume an agent, or submit prompts. First-time macOS authorization can display an OS permission dialog.

Alerts are **on by default**. Change **Settings → Notifications → Background session alerts** to turn them off across windows. On macOS, Nimrod explicitly requests foreground presentation for eligible alerts—so session A can show a banner while you’re viewing session B. **System Settings → Notifications → Nimrod** must allow **Banners** or **Alerts**; Focus/Do Not Disturb and other OS settings still apply. Suppressed alerts are not replayed later.

The banner title is **project · session**: the project directory’s final component and an explicit session name (or “Session”). The OS supplies the app identity, so the title does not repeat “Nimrod”. Completion bodies preview the latest finalized assistant response as plain text, with Markdown formatting removed and whitespace compacted. Nimrod supplies up to **1,000 Unicode characters**, ending longer previews with an ellipsis; the OS decides how much fits in a collapsed or expanded notification. Responses without text fall back to “Agent finished.” Input/failure bodies remain generic.

Previews never pull from user messages, reasoning, tool-result records, dialog content, or raw errors. Prompt-derived sidebar titles stay excluded. Response previews can also appear in Notification Center or on the lock screen according to your OS settings. No custom sound is requested. Ordinary Pi extension notices remain in-app rather than becoming desktop alerts.

Intentional Stop/Close/Restart/quit and history restoration do not produce completion/failure alerts. Completion markers in the session sidebar come from live settled runs rather than routine state refreshes.

## Click to open the session

On macOS and supported Linux desktops, clicking a session notification brings its owning project window forward, selects that exact open session and **scrolls the transcript to the bottom**. This intentionally overrides that session's reading position and re-enables auto-follow. Ordinary session switching still preserves reading position.

A session hidden by Unread or Working is revealed, switching to All when necessary. Settings or the command palette closes; pending Pi input dialogs remain unanswered. Clicking never sends a prompt. A valid click on a still-open disconnected saved session loads its history and reconnects Pi, like any other session selection; stale alerts never reopen closed or retired sessions.

Routing applies only to the original session still open in the running app. Alerts for closed, deleted or restarted sessions, closed windows, or an earlier app run are ignored by Nimrod's session router. The OS may still activate the app. Test notifications have no session target.

Linux requires a desktop notification service supporting the default action. Notification-click support varies by desktop, and compositor/Wayland focus policy may prevent bringing the window forward even when session selection succeeds. Windows session-click routing is not implemented.

## Test delivery and diagnose failures

From an open project, choose **Settings → Notifications → Send test notification**. This uses the same native delivery path but intentionally allows a banner while Nimrod is focused. It sends only fixed test text—no agent launch, model request or conversation data—and is disabled while alerts are off.

After a test, the status line also includes macOS’s reported authorization, desktop-alert setting/style, Notification Center setting, app-active state and **foreground handler calls**. **Refresh notification diagnostics** reads those values again without sending anything or requesting permission, even when alerts are off. The counter is cumulative for the running app, not proof that the latest test displayed a banner; refresh after delivery to account for asynchronous callbacks. Diagnostics currently cover macOS only.

The status line records the latest alert attempt or suppression reason. “Submitted” means the OS accepted the request, not that a banner appeared. Errors remain visible; an ambiguous timeout isn't retried.

On macOS, use the packaged **Nimrod.app**, not an unbundled development executable. Local bundles are ad-hoc signed; rebuilding may require a fresh permission grant. If delivery reports an app identity/signature error, ask for a correctly packaged build.

## Platform limitations

- On the tested **macOS 27.0.1** setup, signed test alerts reached Notification Center, while Temporary desktop presentation was inconsistent. The user confirmed that **Persistent** style makes foreground test alerts visible. Try Persistent in System Settings if Temporary fails; Nimrod does not override your style.
- Native macOS session-click acceptance remains pending. Linux delivery/action/focus remains unverified and requires a desktop notification service. Windows session-click routing is not implemented, and native delivery remains unverified.
- There is no notification history, badge count, per-event/per-session policy, custom sound or background daemon. Closing a project stops its agents.
