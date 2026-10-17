# Model and thinking preferences

**Status: implemented.** This reference owns current specifications and implementation details. [Verification status](verification.md) separates fixture evidence from native acceptance; [historical records](history/feature-records.md#model-thinking) retain prior execution records.

Human guide: [Model and thinking preferences](../../../../docs/model-thinking.md).

[Copilot SDK](copilot-sdk.md) uses its own catalog/current-model snapshot,
idle-only SDK `setModel` and selected-model supported reasoning efforts.
`session.model_change`/deselection outrank older operation results; configuration
failure disconnects rather than presenting unconfirmed state. These choices
never change backend. SDK thinking is not Pi thinking or an ACP thought selector.

## Specification and acceptance criteria

Changing Pi-scoped model/thinking preferences stays available during work/compaction and affects upcoming requests, not in-flight streams. Only acknowledged Pi state updates displayed configuration; readiness and mutation guards remain.

## Code map

- `src/pi/model-thinking-controller.ts`: readiness, single-change lock, fresh Pi state/capabilities, mutation and acknowledged refresh.
- `src/pi/session.ts`: session-bound pickers, Pi-reported scoped models, configuration blocking only for session unavailability or pending prompt acceptance.
- `src/pi/webview-client.ts`: status-area entry points; disabled only before controls are ready, during a preference change, or when the session is unavailable.
- `src/main.ts`: originating-session binding, serialized picker tasks and lifecycle guards.
- [Command interactions](command-interactions.md): cancellation, stale metadata, focus and current-value markers.
- [Keybindings](keybindings.md): model `primary+shift+m` and thinking/effort `primary+shift+e` defaults, effective hints and overrides; native macOS Cmd-M remains Minimize.

## Invariants

- Main-agent work and compaction do not block either picker. Do not gate configuration on busy/isStreaming/isCompacting or wait for agent_settled.
- Installed Pi 1.1.0 RPC handlers accept set_model/set_thinking_level without idle checks. AgentSession reads current model/thinking selections in prepareRequest for each upcoming model request. In-flight streams keep their prepared configuration; a continuation after tools can use the new selection within the same run.
- Pi owns auth validation, model-switch thinking defaults/overrides, capability clamping and persistence. Nimrod never aborts/restarts/replays a prompt to change preferences.
- Keep readiness/disconnection and pending prompt-acceptance guards, the controller's changing lock and shell task serialization. Fresh state and supported levels are revalidated before mutation, not to establish idle.
- Model identity includes provider/id and is chosen only from Pi's scoped list. Missing scope must not expose all models.
- Refresh displayed selections from acknowledged Pi state, never optimistically. A model switch can change the thinking level.
- Preserve main-agent/compaction activity during refresh. Status controls represent the selected configuration for upcoming requests, not necessarily the request currently streaming.
- No new storage: Pi owns session model/thinking records.

## Tests and verification

- `test/model-thinking-controller.test.ts`: changes while busy/compacting, work beginning during a picker/lookup, startup and concurrent-operation guards, disconnect and capability races, failed mutation without optimistic display.
- `test/native-view.test.ts`: status controls remain enabled during working/compacting snapshots, route picker actions without sending/stopping work, preserve drafts, and disable for readiness/changing/unavailability.
- Fixture tests do not establish native acceptance; manually changing selections during a real run and Linux/Windows verification remain pending. No paid requests or live compaction for automated validation.
