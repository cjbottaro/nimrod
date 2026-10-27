# Codex sessions

Nimrod integrates with your installed **Codex CLI** using its native app-server interface. Codex owns authentication, configuration, tools and saved conversation history. Nimrod provides the shared conversation view, drafts, navigation and notifications.

**Status:** source-implemented against the reviewed Codex `0.162.0` protocol. Offline fixtures are authored but unrun. Real installed-CLI, packaging and native macOS/Linux acceptance are pending; this is not a claim of verified parity with Pi or Copilot.

## Setup and create

Install and authenticate Codex CLI using OpenAI's instructions. Nimrod does not bundle Codex, log you in, copy credentials or rewrite your Codex configuration. Node is not required by Nimrod's Codex adapter; your chosen CLI installation may have its own runtime requirements.

Open a project and choose **New Codex session** from the command palette. There is no default keyboard shortcut, but you can assign one in Keybindings. **New session** and its existing shortcut still create Pi sessions.

If discovery fails, set **Settings → Runtime → Codex CLI executable** to your executable. Global defaults and project overrides work like the other runtime fields and apply to the next connection. Nimrod starts its own local stdio app-server, never attaches to another application's server.

Codex inherits its own configured model, reasoning effort, approval and sandbox policies. Nimrod does not silently weaken those policies to make an integration work. macOS and Linux use scoped process-group ownership; Windows launch is unavailable.

## Send, steer and Stop

Sending clears the composer and previews the message immediately. Native user-message identity reconciles that preview in place. If delivery is uncertain, Nimrod reports that outcome without restoring the attempted draft or resending it.

- **Enter** sends while idle and steers an identified active turn while working.
- **Shift+Enter** inserts a newline.
- **Stop** interrupts the actual active Codex turn. An acknowledgement is not completion; the session stays working until Codex reports its terminal state.
- Codex does not have a Nimrod follow-up queue. **Option/Alt+Enter** does not enqueue work or create an extra prompt.

Image paste and image-only messages are enabled only when the connected model advertises image input. They use shared attachment limits, thumbnails and draft storage. Busy image sends are rejected without silently stripping attachments; text steering remains available. Saved remote/local-path image references without inline bytes appear as explicit raw data rather than being fetched or read from arbitrary paths.

## History, drafts and Close

Codex threads have their own saved identity and draft namespace; an identical Pi/Copilot ID does not alias them. **Resume session…** and **Delete sessions…** discover project-local top-level Codex history even if the project has not used Codex in Nimrod. History is paginated and does not require sending a prompt. Nimrod's catalog explicitly includes CLI, VS Code and app-server roots, including Nimrod-created history, and excludes archived threads; it is not a promise to list every headless/exec or archived thread.

Restored Codex rows stay disconnected until you explicitly select or Resume one. Reconnect always uses that exact thread ID and project, whether the thread was created by Nimrod or the native CLI. A failure never starts a replacement conversation, renames the thread or sends a prompt to force saving. Your local draft, title and pin remain; they are independent of Codex's saved history. Background sessions remain independently live once connected. Closing stops only Nimrod's owned process and keeps any saved Codex history and your draft. No background-process continuity or coordination with external writers is promised.

**Untouched-session limitation:** Codex 0.164.0 can assign an ID without saving resumable history. Creating a session, sending no message and quitting can therefore leave a thread that neither native Codex nor Nimrod can reopen. An open sidebar row is not a guarantee of saved history. Native naming can persist an empty paginated thread, but Codex's ordinary history list—and consequently Resume pickers—may still omit it. Nimrod does not scan private Codex databases or fabricate history to bypass these limits. Use **New Codex session** explicitly if the original cannot be resumed; nothing is automatically replayed.

Startup failures preserve your local draft and do not replay a prompt. If cleanup also fails, the original startup error remains visible with cleanup diagnostics in Details. Late startup cleanup targets only its original process, not a replacement connection.

[Reload session](sessions.md#reload-session) reopens this same thread with a fresh Codex agent while keeping your draft. Reload remains unavailable until exact Resume or a successful native saved-history read confirms persistence; deletion is independent of that confirmation. These read-only checks run after readiness and supported native lifecycle changes, without delaying Send; Close remains available independently. Installed-runtime/native restart and reload acceptance remain pending. Close is not deletion.

## Delete a Codex thread tree

Use **Delete session…** in the session-row menu or command palette, the Project bar trash control, or **Delete sessions…** to review a Codex thread tree. The conversation does **not** need to be connected: Nimrod validates the saved target through its separate history catalog, without resuming it or sending a message. If Codex never saved the thread and the catalog cannot establish a persisted target, Delete reports that limitation without discarding the local row or draft. **Close session** (⌘/Ctrl+W) removes that local row after its owned process has exited; your draft remains. The existing shared review shows the root and its spawned descendants, including archived and non-interactive descendants. Confirmation authorizes the current spawned subtree, including descendants created during review or shutdown; Nimrod rescans after stopping affected owned agents before submitting one recursive deletion request.

Cancel releases the review without deliberately stopping established agents or deleting history/drafts. Unrelated sessions stay usable. Late affected mutations or new attachments can be rejected while reviewed; nothing is automatically replayed.

Only confirmed removals clean the corresponding Nimrod sidebar entries, drafts and references. If the result is uncertain or partial, unconfirmed identities/drafts remain; refresh history to inspect the outcome before another explicit attempt. Native cleanup failures retain reservations rather than pretending the operation safely finished.

Codex removes rollout history and associated metadata through its supported API. Nimrod does not remove arbitrary project files/worktrees or coordinate external writers. Cross-project descendants, missing/cyclic ancestry and forks with unverified deletion scope are refused explicitly. Deletion fixtures are authored but unrun; real installed-CLI and native acceptance remain pending.

## Approvals

Command and file-change requests use a session-local approval picker with **Allow once**, **Allow for this session**, **Decline** and **Cancel**. The native request, including command, directory, reason and proposed policy information, remains visible for inspection. Session-scoped approval retains Codex's own meaning; it is not a global permission preference.

Escape dismisses the picker without answering. The **Waiting for permission** banner retains **Review requests**, so you can read the transcript and reopen it. Background requests do not switch sessions or steal focus. Codex resolution, turn completion and disconnection retire stale callbacks.

Additional-permission requests, policy-amendment responses and MCP elicitation are not implemented; unsupported requests fail explicitly and never become automatic approval.

## Structured questions and experimental protocol

Nimrod now connects with Codex's experimental **protocol API** enabled. This does not enable every runtime experiment, change your feature flags or select native Plan mode.

When Codex sends a supported structured question request, the **Codex question** picker shows its offered choices/descriptions, using the shared [question-picker markers](command-palette.md#question-pickers). **Enter your own answer…** appears for free-text questions or when Codex allows an alternative. Batches of up to three questions are answered in order; one native reply is sent only when all are answered. Responses are not extra prompts.

Escape dismisses the picker without answering. The session-local **Waiting for input** banner offers **Answer question** to reopen it. Escape in a nested text dialog returns to the picker. Switching sessions keeps unanswered questions; Stop, server resolution and disconnection retire them without stale replies or partial batch answers. There is no automatic timeout answer.

Codex can also send **async questions** while continuing its work (including in Default mode). These use the same picker, always allow a custom answer, and remain available after Codex finishes. Escape keeps the established dismiss-and-resume behavior. **Ignore question** removes only that optional question locally and sends nothing to Codex; it is not available for blocking question batches. You can also send a different message normally, which retires the old async questions without forcing an answer. Answering one keeps other pending questions available. Async answers are normal follow-up messages (or steering while Codex is working), displayed using the shared speech-bubble [question/answer card](reading-conversations.md#codex-questionanswer-cards), with the original transport envelope available under its raw disclosure. Your composer draft stays untouched. Stop, failed/interrupted turns and disconnection retire these optional questions; saved history does not reopen old question pickers on Resume.

The baseline supports one choice or free-text answer per question. Secret-input questions and unrecognized schemas are not collected in ordinary text dialogs. These and other unsupported interactive requests show a session-local diagnostic with the method/request ID and receive an explicit error—not a guessed answer or approval.

For capture, enable **Global Settings → Diagnostics → Transcript debug logs** before starting a new Codex session or explicitly reconnecting an existing one. The logs include raw requests and response/error packets; see [Transcript debug logs](transcript-logs.md). A model can still ask for choices in plain conversation text: native tool availability depends on Codex's model/mode, and protocol opt-in does not force an interactive request. Native question acceptance remains pending.

## Models, reasoning and usage

Advertised model/effort choices use the shared Status-area controls and pickers. Changes chosen while busy remain local pending intent until idle. Nimrod applies supported resume overrides and requires the returned effective value to match before reporting success; it does not send a prompt or edit global configuration to force a change. Installed-runtime acceptance of already-loaded-thread overrides remains pending. A CLI that cannot confirm a change produces an error instead of showing a speculative effective value.

Usage shows Codex-reported token totals and the last-turn token amount against the reported model window. This is not a guaranteed current-context measurement or a monetary estimate. No inferred dollar cost, Copilot credit conversion or fabricated context metric is shown.

## Slash commands

Type `/` for the commands supported by the connected Codex integration:

- `/model` opens the Codex model picker; `/model <model-id>` selects an exact advertised ID.
- `/rename` asks for a session name; `/rename <name>` renames the connected thread.
- `/compact` asks Codex to compact the conversation. It may use the model; the card waits for native compaction completion, not just request acknowledgement. There is no optional focus argument. The composer locks while it runs, and Stop targets the identified compaction turn.
- `/mcp` reports Codex's MCP servers, tools and authentication state; `/mcp verbose` adds descriptions and resources. Discovery may contact configured MCP servers. MCP login/configuration changes are not supported here.
- `/status` reports thread/model details and last reported token usage—not account quotas or a complete configuration dump.
- `/pwd` (also `/cwd`) shows the verified thread working directory; it never changes the project.
- `/ps` lists the thread's background terminals without stopping them or scanning OS processes.
- `/skills` and `/hooks` show read-only catalogs and reported diagnostics. Skill invocation/toggles and hook editing/trust changes are not implemented.

Each accepted command gets one Command card immediately. Model, rename and
compaction commands wait for idle; report commands can run during work, while
preserving accepted FIFO order. The card stays pending through any picker and
native confirmation. Output/errors stay on that card, without an ordinary chat message,
sidebar-recency bump or forced transcript navigation. Cancellation before dispatch
invokes nothing; uncertain delivery is never retried. Switching away cancels
pending command interactions without changing a newer draft.

These are Codex-owned client adapters backed by native app-server APIs, not a
copy of the complete CLI command catalog. Some are deliberately read-only subsets
of a richer terminal workflow. Native `/stop` (alias `/clean`) stops background
terminals; it is **not** Nimrod's Stop button and is not exposed as a slash command. Model changes require effective-state confirmation;
installed-runtime acceptance remains pending. Other commands are rejected with
the draft intact, never submitted as a model prompt.

## Current differences

Codex app-server does not advertise the CLI's complete slash-command catalog. Plan/Autopilot controls, a context-tier picker, live permission-policy editing and Pi's MCP inspector are not provided by this integration yet. Native compaction and the MCP slash report are available as described above. Unknown native item types keep raw details; command output and file changes have dedicated shared-component presentations.

See [Sessions](sessions.md), [Drafts](drafts.md), [Reading conversations](reading-conversations.md) and [Error messages](error-messages.md) for the shared workspace behavior.
