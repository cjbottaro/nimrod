# Reading conversations

The **transcript** contains user and assistant turns. An assistant turn can include reasoning, tool activity and response text—not just its final answer. The Status area below shows activity, model/thinking controls and Pi-reported usage metrics.

Empty assistant text/reasoning entries do not display blank turn markers or gaps. This includes Copilot assistant messages with tool requests but no prose; their tool cards remain visible. If text arrives later, that assistant entry appears in its original position.

## Tool and reasoning cards

Click a disclosure arrow or summary to expand a card.

- **Tool cards** show one invocation with an input preview, raw inputs and output. Expand for full details; summaries don't use hover tooltips.
- **Reasoning cards** show thinking text actually supplied by Pi.
- A temporary **parallel-tools overview** summarizes overlapping executions without replacing individual cards.
- **Skill disclosures** keep expanded skill bodies collapsed within user turns while leaving user arguments visible.

Cards start closed. Sustained non-empty execution updates may open a running tool after about half a second; a fast final result alone does not. Your manual disclosure choice wins. Inspecting one tool's output does not reset another tool's reading position.

A tool may keep its activity indicator after execution finishes while Pi processes the result. Receiving the result text alone does not end that phase. Interrupted tools retain their stopped indication if late output arrives.

### Built-in tool presentations

Each Pi built-in has a dedicated [card plugin](card-plugins.md#matching-and-overrides). Read summaries include the requested path and line range when supplied. Write cards show the destination and literal **Requested content**, separately scrollable from Pi's output; this previews the input, not a successful write. Grep/find show the pattern and path, and ls shows the directory. Edit cards retain requested diffs with Wrap/Copy. Unknown tools use a generic card, and personal plugins can override built-in presentation.

### Console-style command output

Bash, shell and terminal tool cards render ANSI colors and text styles in both live output and results. Carriage returns, backspaces, tabs, line clearing and common relative cursor movements render progress updates instead of printing escape codes. Output remains selectable text in the existing scrollable viewport; colors follow the theme's terminal palette where available.

When rendering changes the supplied text, a separate **Raw output** disclosure retains the exact original output, including escape sequences. Formatted or customized plugin sections also retain Raw output when their visible text does not contain the exact original output. Other tools keep literal output unless their card plugin requests console rendering.

This is a log renderer, not an interactive terminal: full-screen applications, alternate screens, terminal resizing and exact wide/combining-character cursor geometry are not emulated. Unsupported terminal controls are ignored; terminal titles, clipboard commands and embedded terminal links have no effect. Nimrod renders what Pi supplies—it cannot recover omitted/truncated output or make a command behave as though it had a TTY.

## Code and links

Code blocks have **Pop out** and **Copy** icons. Copy returns source text and briefly shows a checkmark on success. [Pop-outs](pop-outs.md) capture code or rendered Markdown in separate reference windows; later output does not update the capture.

Use a language label after a Markdown fence for reliable [syntax highlighting](syntax-highlighting.md). Unlabeled user code uses conservative detection; unlabeled agent/reasoning code stays plain.

Linked files open in VS Code, with supported line/column forms such as `path:line:column`, `path#Lline` and `file:///…#Lline`. File targets must exist. Plain path-looking text is not automatically linked. HTTP(S) links open your default browser, not the app's conversation window, including **Open Link / Open URL** from the link's native right-click menu. External navigation and new-window requests cannot replace Nimrod with a webpage. If the browser cannot be opened, Nimrod reports the failure without loading the page itself.

## Auto-follow and reading older output

When you're following live work near the bottom, incoming output keeps the transcript at the bottom. Scroll upward to pause and read older content; return near the bottom to follow again.

Sending while idle jumps to the bottom and enables auto-follow by default. Steering and queued follow-ups preserve your reading position. Change **Settings → Appearance → Auto-follow after sending** to **Always**, **When idle** (default), or **Never**. Never preserves current scroll intent—it does not turn off already-active following. The jump happens when you submit, before Pi responds or image preparation finishes; scrolling upward afterward pauses following. Non-message commands such as `/name` and `/compact` do not jump.

Streaming, card expansion, window resizing, zoom and ordinary session switching preserve reader intent rather than pulling you out of older history. Tool output has its own scrollable viewport; distinguish that from scrolling the transcript.

Each open session retains its draft, disclosures and reading position while hidden. Background agents keep working, but hidden transcripts wait to update until you switch back, then show the latest content. Automatic tool disclosure delay and minimum visible dwell pause while a session is hidden; a tool that finishes entirely in the background does not open just because you return. [Restart](sessions.md#restart-session) reloads history at an explicit resume boundary and resets disclosures. A [notification click](notifications.md#click-to-open-the-session) intentionally jumps its target to the bottom and re-enables auto-follow.

Appearance follows [Settings](settings.md) and [Themes](themes.md); whole-app zoom changes scale, not conversation content.
