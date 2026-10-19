# Session configuration

Click the model or thinking-level button in the **Status area**, or use **Select model…** / **Select thinking level…** in the command palette. Default shortcuts are **⌘/Ctrl Shift+M** for model and **⌘/Ctrl Shift+E** for thinking level (also searchable as “effort”). These choices never switch harnesses.

Copilot also shows its confirmed mode after effort, producing
`model · effort · mode`. Use that button or **Select mode…** to choose
**Interactive**, **Plan** or **Autopilot**. Harnesses without a mode capability
omit both the control and palette action.

Copilot’s reported context line keeps its compact usage form, for example
`25.5% / 125k`. When the selected session supports changing its context window,
the reported limit is a button that opens **Select context window…**. Choices
use the tier name as the primary label—such as **Default context** or
**Long context**—and the reported token amount as secondary detail when
available. **Long context** shows the selected model’s advertised maximum; an
intermediate usage report cannot relabel that choice with the default window.
After a context change, usage can briefly show an unknown window while Nimrod
fetches the confirmed budget; no additional message is needed. Pi’s reported
context limit remains non-interactive because Pi does
not expose a corresponding setting.

Model pickers show readable names without numbered prefixes. Copilot places the model ID beneath its friendly name. Pi places the provider beneath the reported friendly name, falling back to the model ID when no friendly name is available. Secondary details align with those names while the current-value marker occupies its own column. Filtering still matches the underlying model identity, and selection does not depend on displayed labels being unique.

## Immediate and deferred changes

You can choose configuration while the agent is working. Nimrod applies it as soon as that harness permits:

- **Pi** normally applies model/thinking changes during work, including compaction, for upcoming model requests. A response already streaming keeps its original configuration; a continuation after tool execution can use the new one.
- **Copilot** applies model/thinking/mode/context configuration while idle. Model, thinking level, mode and context-window changes apply in the existing session without reconnecting or sending another message. You can choose while it is working or handling another configuration/command operation; the change waits for the supported idle boundary without stopping the agent.

Copilot's [permission-policy changes](copilot.md#change-permissions-during-work)
use an independent configuration operation for Nimrod's **Select permissions…
→ Allow all** action, with stable title **PERMISSION CHANGE**. Copilot
`/permissions allow-all` is a separate generic Command card; advertised
live-use metadata lets the command queue invoke it during work without
substituting the Nimrod action.

A pending **configuration change** appears in the transcript like Queued/Steering: a shimmering title and the requested value, pinned in the same bottom stack. Its title is always **CONFIGURATION CHANGE**, using the same uppercase typography whether pending or settled. Choosing another model updates the **same entry**, rather than adding another pending change. An already-dispatched change finishes before the latest choice is applied.

The **Status area shows confirmed values only**. There is no pending badge or speculative model/effort value there. When the harness confirms the change, the Status area updates and the transcript entry stops shimmering and joins normal transcript flow at that point. Later messages appear after it; a change confirmed before the first message stays at the start of the transcript. This also holds when the session is in the background. Failed changes stop shimmering and show a red accent, **Failed**, and an **Error details** disclosure. A lost connection before dispatch shows grey **Not applied**; potentially applied but unconfirmed changes show grey **Outcome unknown**, with details when available. The same failure is not duplicated in a session banner. These entries are local to the connection, not messages sent to the agent or saved in harness history.

If a setting is truly unavailable rather than temporarily deferred, Nimrod accepts no change and shows the reason in that session's notice banner at the top of the conversation area. It does not create a queued configuration card.

A queued change offers **Cancel** while all its work can safely be withdrawn. It removes the intent and card immediately. The same action is available as **Cancel pending configuration change** in the command palette, with no default shortcut. If more than one operation can be cancelled, the palette asks which one. Cancel is omitted during application and after any represented change has dispatched; it never merely hides work that could still take effect.

Changing models can change thinking effort according to the harness's defaults and supported levels. Selecting another pending model drops effort queued for the previous target. Copilot can offer efforts advertised for a pending target model; for Pi, wait until the model changes before choosing its supported thinking levels. Nimrod revalidates choices before applying, rather than silently carrying an incompatible effort across models.

## Copilot new-session defaults

New Copilot sessions use Copilot’s configured model/effort preferences, read through
the SDK. Each setting is independent: non-null values are supplied at creation;
unset values are omitted and display lowercase **default model** / **default effort**
until Copilot reports a concrete value. No default is guessed from the catalog.
When the model is unknown, the effort value/placeholder stays visible; selecting
it reports that a model is required in the session notice banner. Resuming saved sessions never
applies current new-session defaults.

Copilot restores the saved mode and context tier reported by the session.
Changing mode or context follows the same confirmed-value and deferred-change
rules as model/effort. Plan-mode completion choices remain in that session;
background requests never navigate or take focus. Autopilot remains stoppable
through the normal composer Stop action.

## Limits and lifecycle

Models and efforts come from the harness. Pi models stay inside Pi's configured scope; Copilot uses its reported catalog. Nimrod never guesses unknown selections, stops/restarts work to apply a change, or automatically retries an uncertain mutation.

Startup/disconnected sessions do not accept deferred changes; resume a disconnected session first. Changing sessions leaves accepted intent with its originating session. Close, Restart or disconnect retires pending intent with its known or uncertain outcome; it is not restored or replayed on another connection. Escape cancels an open picker without submitting your draft. Configuration progress never forces transcript navigation or replaces a newer draft.

Generic ACP adapters remain internal, without product session actions. New configuration-interface, deferred-change and transcript fixtures are authored but **unrun**; native Pi/Copilot visual/live-run behavior and Linux/possible Windows verification remain pending.
