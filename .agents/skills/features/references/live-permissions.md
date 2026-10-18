# Live permission configuration

**Status: source-implemented; authored unit/bridge/browser fixtures unrun.** No installed-CLI probe, user-session change, paid prompt, app launch or build was performed. Native active-turn acceptance remains pending. User guide: [Copilot permission changes](../../../../docs/copilot.md#change-permissions-during-work).

## Consumer boundary

Permission policy is an optional `SessionConfiguration` capability with setting ID `permissions`, opaque values, advertised choices, a confirmed getter and concrete readiness/mutation semantics. The shared `Select permissions…` action (`permissions`, no default keybinding) is contributed whenever that setting exists, regardless of backend. `SessionAction.configurationSetting` routes it through the generic picker; no Copilot branch exists in the palette/renderer.

`src/session-configuration-set.ts::ConfigurationOwner` adds only `update()` and `dispose(reason?)` to the existing consumer port. `SessionConfigurationSet` composes independent owners behind that same port. Each owner retains its own serialized latest-wins intents, dependencies, cancellation and failure handling. The integration chooses domains: there is no global busy gate, cross-domain dependency scheduler, automatic retry or universal harness protocol.

- A deferred or in-flight model operation cannot hold an otherwise-ready permission change behind it.
- Model/effort dependencies remain in the same owner. Cross-owner dependencies are unsupported; duplicate setting ownership rejects on dispatch rather than choosing an arbitrary provider.
- Combined operation publications retain reference identity when children are unchanged and first-observed key order when updating/removing entries. No additional subscriptions, transcript history materialization or persistence.
- Cancellation routes by exact operation key to its owner. With multiple cancellable operations, the palette asks which one; a card always cancels only itself. Each owner independently decides whether withdrawal remains safe.
- `ConfigurationAdapter.operationTitle` supplies a stable title; the existing operation projector/rendering/scroll path handles it without another backend switch.

A future integration that implements the `permissions` setting gets the picker, registered action, operation card, cancellation/error UI and session-bound dispatch without changing those consumers. Its native transport, policy scope, mutation confirmation and pending-approval lifecycle stay concrete. Truly new capabilities may require another deliberate consumer extension.

## Copilot mapping

Existing local debug captures from CLI **1.0.98** report builtin `permissions` with `default | allow-all | show` and `allowDuringAgentExecution:true`. The user's screenshot showed `/permissions allow-all` incorrectly hitting the ordinary idle-only gate. The first implementation and its invented fixture both used the wrong `allow-any` spelling. `test/fixtures/copilot-permission-command.json` now retains only the actual command descriptor from those captures, without session/user data. This confirms advertisement, not successful active-turn invocation of the corrected code.

The first supported mutation is **Allow all**, executing the exact native `/permissions allow-all` command. It is not approximated with `setApproveAll`, `setMode`, URL/path flags or a Nimrod host-side auto-approval rule. Copilot remains authoritative for the command's scope and managed-policy enforcement. Other permission commands such as `show`/`reset` retain the existing idle-only command workflow; this is not a generic busy-command rollout.

- Require a registered **builtin** `permissions` command advertising the literal `allow-all` argument. Frontend recognition and bridge revalidation share `permissionArgument` / `advertisedPermissionCommand` from the side-effect-free native helper module, rather than duplicating the spelling/filter. Missing/revoked advertisement means unsupported; no guessed argument or fallback prompt.
- Explicit `/permissions allow-all` and its advertised command-name aliases are recognized by the Copilot adapter before the ordinary busy-send gate. Only this known single-token argument is canonicalized. Other command inputs retain their existing raw parsing.
- The shared **Select permissions… → Allow all** picker and choosing `allow-all` from the existing idle `/permissions` argument picker converge on the same configuration owner. Explicit composer submission clears that command immediately, without Send recency/navigation or a literal user turn; later results do not modify a newer draft.
- Copilot's model/effort/mode/context settings use the existing idle-only owner. Permission configuration uses a separate owner. It is ready during an active turn, including while decisions are pending, only when `allowDuringAgentExecution` is true. An existing local command or permission mutation defers it; model mutation does not. A runtime advertising idle-only permission commands defers until actual terminal idle, not an Autopilot intermediate idle.
- The private `permission-change` bridge request accepts only `value:'allow-all'`. Fresh `commands.list()` revalidates builtin identity, exact argument and live-use capability immediately before invocation. It publishes that fresh catalog before returning any pre-mutation deferral so the frontend cannot busy-loop against stale readiness.
- A deferral proves no native mutation was attempted. The shared controller restores that attempt's prior dispatch flag; later supported readiness may apply the still-pending intent. Once `commands.invoke` starts, no error/uncertainty path becomes deferral or retries it.
- Execute `session.rpc.commands.invoke({name: canonicalName,input:'allow-all'})` once, then read `session.rpc.permissions.getMode()`. Only a supported completed/text/timeline result plus native `allow-all` mode can confirm success. Unsupported effects (including agent prompts/dialogs), missing confirmation or post-command read failures become Outcome unknown, without follow-on work. Literal command diagnostics are retained when confirmation fails.
- An optional background connection-time `getMode()` seeds the current permission value; it never gates connection/chat and failure leaves it unknown. The bridge fences that read against newer native events and mutation dispatch. Root `session.permissions_changed.data.mode` events supersede older results through a permission-specific version fence. No model/context/usage fields are guessed or invalidated by permission changes.

## Existing approvals and operation lifetime

The operation is **PERMISSION CHANGE** with content **Permissions: Allow all**. Pending uses the shared shimmer/stack; confirmed mode settles it at the ordered confirmation boundary. Known command failure uses Failed; missing confirmation uses Outcome unknown. No duplicate command-output receipt or error banner is added for the same operation.

**Existing permission callbacks are deliberately untouched.** Applying policy does not answer, cancel, hide or reconstruct them, and does not clear the pending-permission banner. The user can Escape out of the picker (dismissal only), submit the command or use the configuration action, then reopen Review requests and answer older requests. Copilot's policy governs subsequent requests. If the runtime itself resolves existing requests, its own lifecycle remains authoritative; this implementation does not promise retroactive resolution.

Applying/rejecting policy does not stop the agent, send a prompt, change busy/Waiting for permission state, announce turn completion or generate usage. A known policy rejection leaves the active session working. Transport loss retains the existing disconnect contract and uncertain outcome; it never retries. Stop retains its existing agent/decision semantics and is not a separate permission-policy cancellation mechanism. Explicit connection reset removes local operation presentation; no queued intent is replayed on reconnect.

## Code and fixtures

- `src/session-configuration{,-set}.ts`, `src/session-backend.ts`, `src/main.ts`, `src/keybindings.ts`: consumer port, independent owners, shared capability action/picker and key-bound cancellation.
- `src/copilot/permission-configuration.ts`, `src/copilot/session.ts`: concrete advertisement, live readiness, command entry points, native mode/version reconciliation and unchanged pending decisions.
- `copilot/permission-configuration.mjs`, `copilot/bridge.mjs`: exact native command, fresh busy-capability check, independent incoming IPC dispatch, confirmation and no retry/follow-on effects.
- `src-tauri/src/copilot.rs`, `src-tauri/build.rs`, `scripts/prepare-copilot.mjs`, `scripts/verify-macos-bundle.ts`: narrow request admission and bundled helper staging/watch/verification. No build was run.
- `test/session-configuration-set.test.ts`: permission changes bypass queued/in-flight model work, stable publications, key-scoped cancellation and a non-Copilot capability contribution.
- `test/copilot-permission-configuration.test.ts`: exact native invocation, fresh advertisement/deferral, unsupported effects, unconfirmed mode and read errors without retries.
- `test/copilot-sdk.test.ts`: busy command/alias acceptance, queued model independence, pending-decision retention, stale native mode precedence, rejection without disconnect and terminal-idle-only fallback.
- `test/copilot-bridge.test.ts`, `test/fixtures/copilot-sdk.mjs`: production bridge against an offline SDK with one old approval left unresolved while policy applies, then no second prompt after answering the old one. This deliberately models no retroactive resolution; it is not runtime evidence.
- `test/browser/live-permissions.spec.ts`: the exact `/permissions allow-all` streaming screenshot regression, explicit command and generic picker, pending/settled card identity, queued-model bypass, retained older permission picker/banner, newer draft and continuation after a single old approval.
- Native admission tests reject arbitrary policy values. Keybinding fixtures register `permissions` as intentionally unbound.

When requested, validate with `mise run test` and `npm run test:browser`. The mandatory post-merge `mise run check` establishes compilation only. The existing logs establish the 1.0.98 catalog/live flag. Actual corrected invocation while callbacks wait, full policy scope, and native macOS/Linux behaviour remain unverified. Do not infer those from fixture capability declarations.
