# Pi slash-command compatibility

**Status: current source behavior; installed command catalogs are dynamic.**
This matrix classifies Nimrod-owned Pi interception and agent-advertised command
classes. It is not an exhaustive list of commands supplied by every installed
Pi extension, prompt template or skill.

Canonical behavior: [Pi transport](../../features/references/pi-transport.md),
[composer](../../features/references/composer.md), [MCP
inspector](../../features/references/mcp-inspector.md), and
[`src/pi/view-policy.ts`](../../../../src/pi/view-policy.ts).

## Catalog provenance

Nimrod contributes `/name` and `/compact` completion metadata, then merges
Pi-reported extension, prompt-template and skill commands without overriding
those names. Suggestions insert text only; Enter on an exact typed command
passes directly to normal Pi submission without an extra completion step. That remains the
execution path except for the documented local/intercepted commands below.

## Matrix

| Command/class | Discovery | Execution | Nimrod UI/state impact | Adapter/status | Evidence |
| --- | --- | --- | --- | --- | --- |
| `/name [name]` | Nimrod completion entry; Pi command semantics | Sent through Pi prompt/RPC path | Authoritative rename updates session title/history; no Send navigation | Pi-specific presentation/submission handling; not a Nimrod Rename action | Source/fixtures; native acceptance follows general Pi status |
| `/compact [focus]` | Nimrod completion entry | Intercepted to Pi's supported compact RPC while idle | Compaction activity/input lock, context/history changes and Status-area updates | Concrete Pi adapter required because compaction has lifecycle beyond ordinary prompt submission | Source/fixtures; live compaction requires explicit authorization |
| Bare `/mcp` | Pi reports builtin; Nimrod recognizes exact builtin identity | Read-only Pi RPC report, not prompt submission | Opens Nimrod MCP inspector; no model turn, recency or transcript navigation | Documented Pi-specific adapter | Source/offline fixtures; native acceptance pending |
| `/mcp <subcommand>` | Pi-reported | Normal Pi command submission | Harness-defined output/effects | Generic Pi submission; never redirected to MCP inspector | Source/fixtures |
| Extension command | Pi-reported dynamic catalog | Normal Pi command submission | Unknown until extension behavior/events are observed | Generic pass-through; RPC UI compatibility is extension-dependent | Catalog/source only; audit per extension when claiming support |
| Prompt template | Pi-reported dynamic catalog | Normal Pi command submission | Usually expands/sends harness work | Generic pass-through | Catalog/source; concrete templates vary |
| Skill command | Pi-reported dynamic catalog | Normal Pi command submission | Skill disclosure/turn presentation when Pi reports invocation | Generic pass-through plus Pi skill presentation | Source/fixtures; installed skills vary |
| Unsupported session-management commands (`/resume`, `/delete`, `/new`, `/fork`, `/clone`, `/tree`, `/reload`, `/quit`) | May be typed regardless of suggestions | Rejected locally | None; draft retained | Deliberate safety boundary—use Nimrod project/session controls, not action substitution | Source/fixtures |

## Audit requirements

- Capture the actual Pi-reported catalog for the tested installation.
- Audit extension commands separately; their presence does not imply complete
  RPC-mode UI compatibility.
- Verify commands that mutate title, model, thinking, context, queue or
  extensions through authoritative Pi snapshots/events.
- Do not infer an extension command's semantics from its name or description.
- Keep `/name`, `/compact` and bare `/mcp` concrete behavior distinct from
  similarly named Nimrod actions.

