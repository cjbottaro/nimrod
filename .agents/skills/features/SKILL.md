---
name: features
description: Feature implementation guide for Nimrod. Load when designing, implementing, debugging or reviewing features, or updating their documentation. Use the index to read only the relevant detailed references, including pop-outs, code copying, snapshot persistence and native reference-window focus.
---

# Nimrod features

This is the shared entry point for feature implementation knowledge. Keep this
skill short; put detailed per-feature guidance in `references/` and read only the
items relevant to the task. Follow repository `AGENTS.md` and
[architecture](../../../docs/architecture.md). For UI work, also load the
[shared UI vocabulary](../nimrod-ui-vocabulary/SKILL.md).

## Feature index

| Feature / work area | Implementation reference | Human guide |
| --- | --- | --- |
| Pop-outs, code Copy actions, content hashing, snapshot persistence, session visibility, reference-window focus and geometry | [Pop-outs](references/pop-outs.md) | [Pop-outs](../../../docs/pop-outs.md) |

Features without a reference yet: consult their existing docs and source; add a
reference when doing substantive feature work rather than inventing details.

## Keeping documentation useful

- Human guides belong in `docs/`: concise usage, observable behavior and limitations.
- Agent details belong in `references/<feature>.md`: decisions, code map, invariants,
  data formats, concurrency/lifecycle, platform pitfalls, tests and verification gaps.
- Update the human guide and reference together when behavior changes. Keep
  implementation-only changes in the reference instead of inflating the human guide.
- Add new references to this index; link human guides from `docs/README.md` and the
  main README as appropriate. Do not create a separate skill for every feature.
- Reuse the vocabulary skill for shared UI terminology; do not duplicate its glossary.
- Keep unsupported/deferred behavior explicit. Distinguish fixture evidence from
  native/platform acceptance and follow the repository's local-testing restrictions.
