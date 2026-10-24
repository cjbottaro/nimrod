# Permission command shortcut

**Status: source-implemented; updated fixtures unrun.** Native active-turn,
picker/focus and platform acceptance remain pending. User guide: [Copilot
permission changes](../../../../docs/copilot.md#change-permissions-during-work).

## Contract

Permission setting is a common action concept, but not a universal Nimrod
configuration setting or command name. A concrete harness integration may
contribute **Set permissions…** when it advertises a supported permission
command.

The action is a harness-command shortcut:

- Activating it enters the owning integration's normal command queue.
- It invokes the harness command API, never an ordinary prompt containing slash
  text.
- It presents the same harness-owned choices as bare command submission.
- It creates one retained **Command card**, including pinned/deferred/live
  readiness, result content, errors and uncertainty.
- It never creates a separate Permission-change operation or dispatches an
  independent host permission mutation.

Future harnesses can contribute the same Nimrod action ID/label with their own
session-bound command runner. Shared shell/palette code knows neither the
command spelling nor permission-policy values.

## Copilot mapping

CLI 1.0.98 advertises builtin `/permissions` with
`default | allow-all | show` and `allowDuringAgentExecution:true`. Copilot
contributes **Set permissions…** only while that builtin command is advertised.
The action enqueues bare canonical `/permissions`; generic command handling
opens the advertised choice picker and invokes the exact selected argument.

Composer `/permissions`, aliases and the Nimrod action therefore share:

- The same command queue and FIFO ordering.
- The same `allowDuringAgentExecution` readiness rule.
- Fresh frontend and bridge catalog revalidation.
- One exact SDK `commands.invoke` call.
- Native `session.permissions_changed` events as authoritative policy state.
- Pending permission callbacks/banner ownership that is never answered, hidden
  or cancelled by changing policy.
- No prompt fallback, hidden continuation, automatic retry or replay.

If live use is revoked, the Command card remains pinned until terminal idle.
Child idle and non-aborted Autopilot intermediate idle do not release it.
Stopping or switching sessions withdraws undispatched work; ambiguous dispatch
retains an honest unknown outcome.

## Boundaries

- **Set permissions…** is not contributed from a generic
  `SessionConfiguration` capability.
- There is no private `permission-change` bridge request or separate permission
  configuration owner.
- Permission requests from tools remain separate interactive decisions.
- Managed-policy scope and command effects remain Copilot-owned.
- The action does not imply every harness supports permission changes; absence
  of a contributed action means unsupported.

## Code and evidence

- `src/session-backend.ts`: internal session action supports a session-bound
  runner; it does not infer permission capabilities.
- `src/copilot/view-policy.ts`: contributes **Set permissions…** from the fresh
  advertised builtin command.
- `src/copilot/session.ts`, `command-queue.ts`, `commands.ts`: generic command
  acceptance, picker, live/deferred readiness, invocation and Command card.
- `copilot/bridge.mjs`: fresh advertisement/live-use validation and exact SDK
  invocation.
- `test/copilot-commands.test.ts`, `test/copilot-sdk.test.ts`,
  `test/browser/live-permissions.spec.ts`: action/composer convergence on the
  generic command owner, live and idle-only readiness, retained old approvals,
  newer drafts and no prompt/native-action substitution. Updated fixtures are
  authored but unrun.
