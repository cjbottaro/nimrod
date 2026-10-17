# Model and thinking preferences

[Copilot SDK](copilot.md) exposes idle-only model choices from its catalog and
reasoning efforts supported by the selected model. Native changes override older
picker results; failures do not silently keep unconfirmed live configuration.
This does not switch harnesses or inherit Pi queue/thinking semantics.

Click the model or thinking-level button in the **Status area**, or use **Select model…** / **Select thinking level…** in the command palette. Default shortcuts are **⌘/Ctrl Shift+M** for model and **⌘/Ctrl Shift+E** for thinking level (also searchable as “effort”).

For [ACP POC sessions](acp.md), only agent-advertised selectors appear and configuration changes require idle. The behavior below describes the bespoke Pi integration.

Both pickers work while Pi is working, including during compaction. Changing a selection does not stop or restart the agent:

- A response already streaming keeps its original model and thinking level.
- The next model request uses the new selection, including a continuation after tool execution in the same run.
- The Status area shows the selected configuration for upcoming requests, which may differ from the response currently streaming.
- Changing models can also change the thinking level according to Pi's defaults, overrides and supported levels.

Models come from Pi's configured scope; thinking levels come from the selected model's capabilities. Nimrod updates displayed values only after Pi acknowledges the change and reports its state.

Controls are unavailable during startup/disconnection or another preference change. Pending prompt acceptance must finish before a change can begin. Disconnected sessions must be resumed first. Escape cancels the picker without submitting your draft; explicit Back returns to commands.

Native live-run behavior and Linux/possible Windows verification remain pending.
