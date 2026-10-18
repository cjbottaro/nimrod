# Copilot SQL capture fixture

`task-progress.json` is a scrubbed native `tool.execution_start` / `tool.execution_complete`
pair from the user's authorized local transcript-log inspection on October 18, 2026,
reported Copilot CLI version 1.0.98. It is the invocation shown in the SQL-card screenshot.

Preserved: tool name, input description/query, exact content/detailedContent, success,
reported count metrics and statement-type properties. Replaced: tool-call identity.
Omitted: session/connection/capture/event/parent/interaction/turn identities,
timestamps, model identifiers, `rte` and redundant restricted telemetry query.
No credentials or user paths are included. No user logs or session files are needed
by the fixture, and loading it never executes SQL or sends a request.

`test/copilot-sql-cards.test.ts` loads fresh copies and derives synthetic malformed,
error, SELECT-result and lifecycle variants. Only the base pair is capture-backed;
the variants are not additional native acceptance evidence. Extend this corpus when
another real result schema is observed rather than guessing from SQL text.
