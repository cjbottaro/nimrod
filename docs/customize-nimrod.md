# Customize Nimrod with your agent

Use **Customize Nimrod…** in the command palette to ask the current session's agent to customize Nimrod. It works from ordinary project directories: your project does not need Nimrod's source code, `.agents` directory or skills.

1. Select a connected session that can accept an ordinary message.
2. Open **⌘/Ctrl+Shift+P → Customize Nimrod…**.
3. Describe the changes you want. Expand **Instructions included with your request** to inspect the authoring guidance that will accompany your request.
4. Choose **Send request**. **Enter** sends; **Shift+Enter** inserts a newline. **Cancel** or **Escape** sends nothing.

There is no default shortcut for this action. You can assign one in [Keybindings](keybindings.md).

## An ordinary user message

Nimrod sends one normal user message containing the customization instructions followed by your exact request. It does not inject hidden system context, install a harness skill, create another session, change models or give the agent extra permissions. The agent uses its existing tools and permission policy to perform the work.

The Transcript keeps your request prominent, with the supplied instructions collapsed under **Nimrod customization instructions**. Expand the disclosure to read the brief that was actually sent. The complete message belongs to the harness's normal conversation history; other clients can read it without understanding Nimrod's presentation.

Your existing Composer draft, selection and attachments are not replaced or submitted. The modal owns its own input. Cancelling discards that input, not your Composer draft. Failed or uncertain delivery follows ordinary message handling; nothing is automatically replayed or restored over newer input.

## Guidance belongs to the installed app

The included brief identifies the actual global customization directories and the originating project. A complete installation bundles the matching authoring guides, public card types, examples and default templates in a read-only reference directory. The agent can read those absolute paths through its normal file tools, independently of your current project.

Customizable surfaces and APIs are described in [UI templates](ui-templates.md) and [Card plugins](card-plugins.md). Requests outside those surfaces may require a Nimrod feature change; the supplied brief does not authorize app-source edits, builds or restarts as a fallback.

Customization files are global user files. The agent can apply changes to the originating project window using the existing [reload CLI](cli-actions.md), with an explicit project target even if its shell later changes directories. The brief uses the actual running executable's absolute path, so a separate CLI installation or PATH entry is not required. Nimrod does not automatically edit files or reload anything merely because you sent the request. Existing inspected cards retain their renderers, and other open windows are not automatically refreshed.

Ask the agent for a change such as “Make the Project bar more compact” or “Move the Session sidebar to the right.” The reload result confirms application/validation, not the final appearance—check the result in your window and continue the conversation with feedback.

## Availability and connection changes

The action is offered only for a connected session with an eligible ordinary-message path. Disconnected/saved sessions are not resumed automatically. Busy-session behavior follows the harness: integrations that support ordinary steering can accept the request, while integrations that reject busy sends do not offer it then.

The modal remains bound to its originating session. If the connection or session changes while you type, Send becomes unavailable and your unsent input stays in the modal until you cancel. It is never redirected to another session or automatically sent after reconnection. Missing installed authoring resources also disable sending rather than supplying broken checkout paths.

Native installed-app, focus/accessibility and packaging acceptance remain pending; see the documented platform limitations in [CLI actions](cli-actions.md).
