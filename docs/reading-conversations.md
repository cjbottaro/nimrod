# Reading conversations

The **transcript** contains user and assistant turns. An assistant turn can include reasoning, tool activity and response text—not just its final answer. The Status area below shows activity, model/thinking controls and Pi-reported usage metrics.

## Tool and reasoning cards

Click a disclosure arrow or summary to expand a card.

- **Tool cards** show one invocation with an input preview, raw inputs and output. Expand for full details; summaries don't use hover tooltips.
- **Reasoning cards** show thinking text actually supplied by Pi.
- A temporary **parallel-tools overview** summarizes overlapping executions without replacing individual cards.
- **Skill disclosures** keep expanded skill bodies collapsed within user turns while leaving user arguments visible.

Cards start closed. Sustained non-empty execution updates may open a running tool after about half a second; a fast final result alone does not. Your manual disclosure choice wins. Inspecting one tool's output does not reset another tool's reading position.

## Code and links

Code blocks have **Pop out** and **Copy** icons. Copy returns source text and briefly shows a checkmark on success. [Pop-outs](pop-outs.md) capture code or rendered Markdown in separate reference windows; later output does not update the capture.

Use a language label after a Markdown fence for reliable [syntax highlighting](syntax-highlighting.md). Unlabeled user code uses conservative detection; unlabeled agent/reasoning code stays plain.

Linked files open in VS Code, with supported line/column forms such as `path:line:column`, `path#Lline` and `file:///…#Lline`. File targets must exist. Plain path-looking text is not automatically linked. HTTP(S) links open your default browser, not the app's conversation window, including **Open Link / Open URL** from the link's native right-click menu. External navigation and new-window requests cannot replace Nimrod with a webpage. If the browser cannot be opened, Nimrod reports the failure without loading the page itself.

## Auto-follow and reading older output

When you're following live work near the bottom, incoming output keeps the transcript at the bottom. Scroll upward to pause and read older content; return near the bottom to follow again.

Streaming, card expansion, window resizing, zoom and ordinary session switching preserve reader intent rather than pulling you out of older history. Tool output has its own scrollable viewport; distinguish that from scrolling the transcript.

Each open session retains its draft, disclosures and reading position while hidden. [Restart](sessions.md#restart-session) reloads history at an explicit resume boundary and resets disclosures. A [notification click](notifications.md#click-to-open-the-session) intentionally jumps its target to the bottom and re-enables auto-follow.

Appearance follows [Settings](settings.md) and [Themes](themes.md); whole-app zoom changes scale, not conversation content.
