# Codex command audit and upgrade procedure

## Baseline and evidence

**Reviewed baseline: Codex CLI/source `0.164.0`, tag `rust-v0.164.0`.**
This is a source/schema audit, not a live command-compatibility test. The installed
executable resolves to the same version; existing local official source and
experimental generated schema from the earlier async-question review were reused.
No Codex process was launched, model request made, settings changed or user
conversation inspected. Current implementation/acceptance lives in the
[compatibility matrix](codex.md) and [verification](../../features/references/verification.md#codex-command-audit).

Primary sources, all pinned to the same tag:

- [Built-in enum, descriptions, argument/busy/platform rules](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/slash_command.rs).
- [Feature filters, aliases and model-advertised service-tier commands](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/bottom_pane/slash_commands.rs).
- [Native bare/argument dispatch](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/chatwidget/slash_dispatch.rs),
  [argument parser](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/chatwidget/slash_command_args.rs).
- [Generated request schema](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server-protocol/schema/typescript/ClientRequest.ts),
  [thread processor](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/request_processors/thread_processor.rs).
- [Manual compaction task](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/core/src/tasks/compact.rs)
  and [native event projection](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/app-server/src/bespoke_event_handling.rs).
- [Skills menu/mention/toggle semantics](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/chatwidget/skills.rs)
  and [hooks browser](https://github.com/openai/codex/blob/rust-v0.164.0/codex-rs/tui/src/chatwidget/hooks.rs).

The snapshot [codex-audit-0.164.0.json](codex-audit-0.164.0.json) records **65 enum
commands**, their canonical names/aliases, source fingerprints, **178 app-server
methods** and generated schema fingerprints. It is development evidence, never
runtime advertisement or an execution allowlist. Some deferred rows below have
only catalog/dispatch/schema evidence; they are candidates, not proven adapters.

## Repeat on upgrades and anomalies

Run this audit whenever the supported/installed Codex version changes, command
semantics fail, a protocol schema changes, or a new candidate command is requested.
An audit is a one-time task, not a timer, background watcher or permission to
invoke commands. Also review newly exposed APIs even if command names did not
change: an old terminal-only command can become implementable through a new API.

1. Record installed CLI version **without starting an app-server** and obtain the
   exact matching official source tag plus generated stable/experimental schema
   in disposable local storage. Reuse verified existing material when available.
   Schema generation/help/version inspection is not live-session acceptance.
   Do not upgrade/reinstall Codex, write its configuration or alter Pi/extensions.
2. Inventory **all** enum entries, canonical names, serialization aliases,
   descriptions, argument grammar, busy/side-conversation rules and platform/debug
   visibility. Read popup filtering **and exact-name lookup**: hidden and
   unrecognized are different. Include feature/account/provider conditions.
3. Enumerate dynamic families separately: model-advertised service-tier names,
   user presets/custom prompts and skill mentions. Never claim the enum snapshot
   is the exhaustive catalog for every installation. `/goal` additionally accepts
   repeated `o` spellings in native lookup; do not invent a finite alias list.
4. Generate a source-only diff from the repo root:

   ```sh
   node scripts/audit-codex-commands.mjs \
     --source /path/to/codex-rust-vNEXT \
     --protocol /path/to/generated-types \
     --version NEXT \
     --baseline .agents/skills/slash-commands/references/codex-audit-0.164.0.json \
     --out /disposable/path/codex-audit-NEXT.json
   ```

   The script reads source/schema only; it never runs Codex. It reports added,
   removed and changed commands/methods, changed source files and changed schema
   fingerprints. Unknown enum/request syntax fails explicitly. Its conservative
   per-command policy fingerprints are triage hints, not a Rust parser or proof
   that a command did/didn't change. Read every changed source file and follow
   called handlers; source hashes intentionally flag changes outside the parser.
5. For each changed/new command **and each newly promising API**, follow native
   dispatch into the public app-server method and exact parameter/result/event
   schemas. Record discovery, validation, mutation scope, cancellation, busy
   behavior, confirmation and effects on Nimrod projections. Separate generic
   RPC acknowledgement from semantic completion. Compaction is the reference:
   `thread/compact/start` only enqueues work; the canonical compaction item and
   terminal native turn are needed to confirm it.
6. Classify/update every row below: implemented, partial, API-backed candidate,
   host-workflow gap, terminal-only or deliberately excluded. State the exact
   missing behavior and the next step/removal condition. An available method is
   not sufficient evidence for safe settings/auth/deletion semantics.
7. Implement only evidence-backed bounded adapters inside Codex. Reuse the
   required command port and native ownership/deletion gates; do not add an
   unrestricted executor or route a slash command through a Nimrod action.
   Revalidate exact choices and provenance immediately before dispatch.
8. Author sanitized offline fixtures for bare/explicit/invalid/alias/stale input,
   busy readiness, pre/post-dispatch cancellation, event-before-response ordering,
   pagination, confirmation and unknown outcomes. Tests/builds remain request-only
   except the mandatory post-merge compile check. Model-backed, destructive,
   authentication, policy and external probes need separate bounded authorization.
9. Update the implementation matrix, this inventory, protocol evidence and
   verification owner; update user guides/changelog only for observable changes.
   Preserve the old snapshot for comparison, add the new pinned snapshot, and
   update the baseline command above. Never overwrite an old version label with
   current source or promote source evidence to native/platform acceptance.

## Complete built-in classification (0.164.0)

**Implemented/partial** means source implemented in Nimrod, with native acceptance
pending—not that the command was executed in this audit. **Candidate** means a
plausible API route exists but its full contract is not yet implemented/accepted.
**Host gap** means native semantics need explicit Nimrod lifecycle/presentation
work; it does not mean Codex lacks an API. Nothing below authorizes live probes.

| Canonical command (aliases) | Classification | Boundary / remaining work |
| --- | --- | --- |
| `/model` | Partial | Model catalog/picker and confirmed mutation implemented; native combined model+effort selection/richer grammar still needs an adapter. |
| `/presets` | Host gap | Native reusable prompt/command editor and user-defined content; review quick-dial discovery/storage and draft-safe interaction before support. |
| `/daybreak` | Candidate, feature/account gated | Native settings/account conditions and continuation semantics need review; no feature enabling or inferred Autopilot equivalent. |
| `/ide` | Host gap | Editor selection/open-files context is not present in Nimrod's directory-backed workspace. |
| `/permissions` | Candidate | `permissionProfile/list`, `thread/settings/update`; require exact profile discovery, policy scope, effective confirmation and approved UX. Never substitute individual approval answers. |
| `/keymap` | Terminal-only | TUI keymap editor, not Nimrod Keybindings. |
| `/vim` | Terminal-only | TUI composer mode; no Nimrod action substitution. |
| `/setup-default-sandbox` | Platform/policy gap | Windows sandbox setup, not currently supported Nimrod platform parity; no policy/setup mutation. |
| `/experimental` | Candidate, persistent settings | Feature registry and enablement APIs exist; scope/requirements/UI and restart effects need review. |
| `/approve` | Candidate, policy-sensitive | `thread/approveGuardianDeniedAction`; not a generic allow-all grant. Must preserve the exact denied action/retry scope. |
| `/memories` | Candidate, persistent state | Memory status/mode APIs exist; scope, policy and destructive reset must be separated. |
| `/skills` | Partial | Read-only `skills/list` report implemented. Native use/mention picker, enable/disable and exact skill-input provenance remain unsupported. |
| `/import` | Host gap, stateful | External-agent config/history import APIs; no cross-harness migration is implied by listing methods. |
| `/hooks` | Partial | Project-scoped `hooks/list` report implemented; browser/edit/trust workflows are not implemented. |
| `/review` | Candidate, model-backed | `review/start` with explicit review target/delivery and review-thread lifecycle; no ordinary slash-text prompt fallback. |
| `/rename` | Implemented | Exact-thread naming/input confirmation; native generated-name suggestion is not synthesized. |
| `/new` | Host gap | Native creates/rebinds a conversation; needs an explicit target-bound creation contract, not a Nimrod New action redirect. |
| `/archive` | Host gap, stateful | `thread/archive`; sidebar/history/owned-process implications need explicit semantics. |
| `/delete` | Host gap, destructive | Existing reviewed Nimrod deletion is a separate entry point; no shortcut bypassing tree review/native reservations. |
| `/resume` | Host gap | Saved-thread picker/rebinding, exact project and ownership; never auto-resume or silently replace a session. |
| `/fork` | Host gap | `thread/fork`; lineage, separate session/draft ownership and navigation must be designed. |
| `/worktree` | Host gap, feature gated | Native managed-worktree lifecycle conflicts with silently changing the project window cwd; requires explicit window/lifecycle support. |
| `/app` | Host gap, platform gated | Native Desktop-app handoff, not switching to a Nimrod session. |
| `/init` | Candidate, model/file-backed | Native uses a bundled initialization prompt; requires pinned command-owned expansion plus explicit agent-turn lifecycle, not guessed text. |
| `/compact` | Implemented, model-backed | `thread/compact/start`; require canonical `contextCompaction` item and terminal native turn, not empty response. No optional focus argument in this schema. |
| `/config` | Candidate, persistent settings | Native configuration panel; `config/read`/write/requirements need typed key/secret/scope/confirmation treatment. |
| `/recap` | Candidate, model-backed | Native generated recap event flow; follow its exact sampling/prediction route before implementing. Not manual compaction. |
| `/plan` | Candidate, feature gated | Collaboration-mode catalog/native settings and optional submitted task; mode projection and confirmation needed. Not Copilot Plan/Autopilot semantics. |
| `/voice` | Host gap, feature gated | Realtime audio/device/consent lifecycle, not ordinary text input. |
| `/goal` | Candidate, feature gated | `thread/goal/get/set/clear`; budgets, autonomous continuation and native feature gating need review. Native lookup also accepts repeated `o` spellings. |
| `/agents` | Host gap | Native agent command center needs independently owned agent/session navigation. |
| `/side` | Host gap | Ephemeral fork/side-conversation ownership and return behavior. |
| `/btw` | Host gap | Same native ephemeral side workflow as `/side`, independently named enum entry. |
| `/copy` | Host gap | Native response/portion picker with clipboard host effect; not a blind Nimrod Copy action. |
| `/export` | Host gap | Explicit transcript snapshot/destination and native file/clipboard ownership; no silent arbitrary-path writes. |
| `/raw` | Terminal-only | Raw terminal scrollback selection mode. |
| `/tui` | Terminal-only | TUI mode for the next launch. |
| `/diff` | Host gap | Native workspace runner includes untracked-file diff; `gitDiffToRemote` alone is not equivalent. Do not add unrestricted command execution. |
| `/mention` | Host gap | Native inserts a file-mention trigger; requires draft-generation-safe host input support. |
| `/status` | Partial | Exact-thread metadata/model and last reported token usage implemented; account quotas/full configuration not claimed. |
| `/daemon` | Host gap | Native background-server control; never control unowned external processes. |
| `/warnings` | Host gap | Native retained diagnostic store/browser; no equivalent generic warning-history RPC was established. |
| `/cd` | Deliberately unavailable | One exact directory per Nimrod window; changing it requires explicit project/window lifecycle semantics. |
| `/pwd` (`/cwd`) | Implemented | Metadata-only read verifies the exact bound thread/project; aliases come from native enum serialization. |
| `/usage` | Candidate, account/feature gated | Account usage/limits/reset-credit UI; distinguish remote reads from credit consumption and session token metrics. |
| `/debug-config` | Candidate, sensitive report | Config layers/requirements can expose secret-bearing values; needs a reviewed redaction/field policy, not raw config dumping. |
| `/title` | Terminal-only | Configures terminal-title items, not the conversation name. |
| `/statusline` | Terminal-only | TUI status-line setup, not Nimrod's Status area. |
| `/theme` | Terminal-only | TUI syntax theme picker, not Nimrod Appearance. |
| `/pets` (`/pet`) | Terminal-only | TUI pet/visibility behavior; do not imply portable desktop parity. |
| `/mcp` | Partial | Thread-scoped paginated tools/auth report and `verbose` implemented; OAuth `login` is explicitly rejected. Discovery may contact configured MCP servers. |
| `/apps` | Candidate, feature/account gated | Native app catalog/management, not just a list; discovery/account/configuration effects require bounded review. |
| `/plugins` | Candidate, feature/account gated | Native plugin browsing/install/marketplaces; distinguish remote discovery from persistent mutations. |
| `/logout` | Deliberately excluded | Account-wide credential mutation outside the current desktop authentication boundary. |
| `/quit` | Host gap | Native client exit is not stopping the active turn or blindly quitting Nimrod. |
| `/exit` | Host gap | Same native client-exit purpose, separate enum name. |
| `/feedback` | Deliberately excluded pending opt-in UX | External log upload/data scope requires explicit user choice; no automatic probe. |
| `/rollout` | Debug-only candidate | Native prints the rollout path; hidden in release builds. Never read arbitrary rollout paths or synthesize release advertisement from debug schema alone. |
| `/ps` | Implemented report subset | Exact-thread paginated background-terminal listing; no mutation/OS process scan, no resource-metric parity claim. |
| `/stop` (`/clean`) | Candidate, process-mutating | Stops **background terminals**, not the active model turn. `thread/backgroundTerminals/clean` needs exact scope/confirmation; never map to Nimrod Stop. |
| `/clear` | Host gap | Clears the terminal **and starts a new conversation**, not merely clearing Nimrod's transcript DOM. |
| `/test-approval` | Debug-only, excluded | Native synthetic approval fixture; not a real permission request. |
| `/subagents` | Host gap | Native subagent picker, not automatic promotion of a child into an independently owned Nimrod session. |
| `/debug-m-drop` | Debug maintenance, excluded | Native warns DO NOT USE; no destructive memory probes. |
| `/debug-m-update` | Debug maintenance, excluded | Native warns DO NOT USE; no maintenance/model work inferred from schema. |

## Dynamic families outside the 65 enum entries

- **Model service tiers:** native `commands_for_input` inserts model-advertised
  names after `/model`, gated separately. Do not hard-code `/fast` or another
  provider's spelling as universally available. Needs live tier discovery,
  native settings/effective-state projection and confirmation before support.
- **Presets/custom prompt content:** installation/user dependent. Inventory the
  public discovery and expansion contract without reading private user prompt
  bodies during a source audit. Presence of `/presets` does not characterize all
  saved expansions.
- **Skill mentions:** native `$` chooser and structured skill input are not an
  advertised generic slash-command RPC. A read-only `/skills` catalog does not
  establish invocation, toggle or draft-insertion parity.

## Prioritized next work

1. Run the new offline fixtures when requested; perform separately authorized
   installed-runtime/native acceptance of current commands without broad probing.
2. Complete `/model` effort selection and skills native use/toggle interactions
   with exact provenance and draft-safe user intent.
3. Design `/permissions` and `/plan` native configuration projections; preserve
   existing policy and require effective confirmation, never a permissive default.
4. Add `/review`, `/goal` and `/init` only with their explicit model-backed task,
   feature/account, persistence and cancellation semantics.
5. Treat account/auth, import, feedback, process cleanup and session lifecycle as
   separately bounded work, not automatic consequences of finding API names.
