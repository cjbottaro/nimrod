# Generic ACP slash-command baseline

**Status: retained internal infrastructure, no current product creation/options
entry point.** This is a future compatibility baseline, not a claim that generic
ACP sessions or their commands are currently supported in Nimrod's product UI.

Canonical boundary: [ACP harnesses](../../features/references/acp-harnesses.md)
and [harness presentation](../../features/references/harness-presentation.md).

ACP command catalogs are agent-specific and dynamic. Nimrod retains only
advertised-command completion and normal prompt submission; it must not invent
Pi or Copilot command semantics.

| Command class | Discovery | Execution/UI | Compatibility status |
| --- | --- | --- | --- |
| Advertised text command | Agent-advertised catalog | Submitted through owning ACP session; ordinary agent output/events | Dormant generic baseline; no current product acceptance |
| Advertised command affecting configuration | Agent-advertised catalog/options | Must reconcile through ACP configuration updates, never infer from text | Requires per-agent audit before a support claim |
| Advertised command requiring modal interaction | Only if protocol metadata/result exposes it | Shared presentation may be used while ownership stays ACP | No generic interaction contract currently claimed |
| Unadvertised slash text | None | Reject rather than guess/fall back | Required safety behavior |

When generic ACP product entry points return, replace this class matrix with
the actual agent/version matrix for every claimed supported agent. Do not use
the broad ACP baseline as evidence for Codex, Claude Code or another curated
integration.

