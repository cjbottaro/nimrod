# Model and thinking preferences

Click the model or thinking-level button in the **Status area**, or use **Select model…** / **Select thinking level…** in the command palette. Default shortcuts are **⌘/Ctrl Shift+M** for model and **⌘/Ctrl Shift+E** for thinking level (also searchable as “effort”). These choices never switch harnesses.

## Immediate and deferred changes

You can choose configuration while the agent is working. Nimrod applies it as soon as that harness permits:

- **Pi** normally applies model/thinking changes during work, including compaction, for upcoming model requests. A response already streaming keeps its original configuration; a continuation after tool execution can use the new one.
- **Copilot** applies configuration while idle. You can choose while it is working or handling another configuration/command operation; the change waits for the supported idle boundary without stopping the agent or sending another message.

A pending **configuration change** appears in the transcript like Queued/Steering: a shimmering title and the requested value, pinned in the same bottom stack. It says **Model change queued** while waiting and **Changing model** while applying. Choosing another model updates the **same entry**, rather than adding another pending change. An already-dispatched change finishes before the latest choice is applied.

The **Status area shows confirmed values only**. There is no pending badge or speculative model/effort value there. When the harness confirms the change, the Status area updates and the transcript entry stops shimmering and unpins. Failed/cancelled changes also stop shimmering; error details belong to that session's notices. These entries are local to the connection, not messages sent to the agent or saved in harness history.

Changing models can change thinking effort according to the harness's defaults and supported levels. Selecting another pending model drops effort queued for the previous target. Copilot can offer efforts advertised for a pending target model; for Pi, wait until the model changes before choosing its supported thinking levels. Nimrod revalidates choices before applying, rather than silently carrying an incompatible effort across models.

## Copilot new-session defaults

New Copilot sessions use Copilot’s configured model/effort preferences, read through
the SDK. Each setting is independent: non-null values are supplied at creation;
unset values are omitted and display lowercase **default model** / **default effort**
until Copilot reports a concrete value. No default is guessed from the catalog.
When the model is unknown, the effort value/placeholder stays visible but cannot
be selected until its supported choices are known. Resuming saved sessions never
applies current new-session defaults.

## Limits and lifecycle

Models and efforts come from the harness. Pi models stay inside Pi's configured scope; Copilot uses its reported catalog. Nimrod never guesses unknown selections, stops/restarts work to apply a change, or automatically retries an uncertain mutation.

Startup/disconnected sessions do not accept deferred changes; resume a disconnected session first. Changing sessions leaves accepted intent with its originating session. Close, Restart or disconnect cancels pending intent; it is not restored or replayed on another connection. Escape cancels an open picker without submitting your draft. Configuration progress never forces transcript navigation or replaces a newer draft.

Generic ACP adapters remain internal, without product session actions. New configuration-interface, deferred-change and transcript fixtures are authored but **unrun**; native Pi/Copilot visual/live-run behavior and Linux/possible Windows verification remain pending.
