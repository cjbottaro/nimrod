---
name: performance-optimizations
description: Catalogue of Nimrod performance optimizations already implemented, why they were chosen, measured results and limitations, plus potential future enhancements with rationale and benefits. Load for responsiveness investigations, performance planning or reviewing earlier optimization decisions.
---

# Nimrod performance optimizations

This agent-facing catalogue separates **completed optimizations**, **measurement work**, and **potential future optimizations**. Each entry has its own reference. Completed entries record what changed, why, benefits and available results; future entries describe hypotheses and experiments, not an approved implementation queue.

Read the [features skill](../features/SKILL.md), [architecture](../features/references/architecture.md) and [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md) before implementation. Feature references remain authoritative for current behavior. This catalogue owns the performance rationale and decision/result summaries, not duplicate lifecycle specifications. Recheck source and evidence before assuming an entry still applies.

## Completed optimizations

1. [Suppress unchanged bookkeeping writes](references/unchanged-bookkeeping-writes.md) — the optimization selected during the CPU-contention investigation.
2. [Keep draft typing off expensive UI/storage paths](references/composer-typing-hot-path.md) — existing optimization baseline that predates that investigation.
3. [Suppress hidden-session transcript painting](references/hidden-session-painting.md) — latest-snapshot catch-up with retained interaction state; regression coverage added, validation/native comparison pending.

## Measurement work

1. [Opt-in local performance diagnostics](references/local-performance-diagnostics.md) — implemented instrumentation, **not itself a responsiveness optimization**.

## Potential future optimizations

The remaining four are **deferred**. Suggested order is subject to the next observed bottleneck, not a delivery commitment:

1. [Make Session sidebar updates change-driven](references/change-driven-sidebar.md)
2. [Make transcript updates proportional to changed content](references/incremental-transcript.md)
3. [Limit tool-output scroll work to affected viewports](references/tool-output-scroll-work.md)
4. [Reduce large-history rendering and DOM cost](references/large-history-dom.md)

Each optimization reference includes **Regression risks and maintenance guardrails**: likely ways to lose the benefit or break correctness, shared paths to reuse, and fixture-extension triggers. Deferred candidates describe proposed safeguards, not implemented protections. Each candidate also includes **why**, **potential benefits**, code anchors, an experiment outline, preservation constraints and validation targets. Existing observed improvement justified pausing additional work; a later mildly sluggish report suggests remaining scaling opportunities without invalidating the earlier result. [Native observations](../features/references/verification.md#performance-observation) owns the report comparisons and attribution limits.

## Maintaining and using the catalogue

- Before adding features to persistence, draft input, transcript/card rendering, activation, sidebar projections or output-scroll/history layout, read the relevant optimization's regression guardrails—even if the task is not labelled performance work. Extend shared boundaries and dependency/invalidation coverage rather than bypassing them. Feature specifications remain authoritative.
- Maintain a **Regression risks and maintenance guardrails** section for every implemented optimization and future candidate. Record concrete erosion/correctness hazards, paths new features should reuse, and when/which fixtures to extend. Update it when schemas, lifecycle, rendering dependencies or ownership change; distinguish existing protections from proposed ones and test coverage from executed validation. Prefer deterministic avoided-work counters alongside behavioral assertions over timing-only thresholds. This guidance does not authorize automatic tests/checks.
- When implementing a candidate, update its reference with what actually shipped, why it was chosen, fixture results, available native observations and remaining limitations; move its link to Completed optimizations. Do not equate an intended benefit with an observed result.
- Add one reference per new optimization or measurement effort. Record provenance where known; mark an inherited baseline as existing work rather than attributing it to the latest investigation. Keep detailed superseded investigations in feature-reference history, not a growing run log here.
- Choose one bounded experiment when implementation is requested. This skill does not authorize changes, builds or user-app interruption by itself. Preserve the ability to attribute results rather than stacking unrelated experiments.
- Distinguish confirmed unnecessary work from a theory about the lag's root cause. Establish avoided-work counters/fixtures, then compare native responsiveness when available. [Performance diagnostics](../features/references/performance-diagnostics.md) owns metric meanings and sampling limitations; [verification](../features/references/verification.md) owns native/platform evidence.
- Preserve synchronous ordered Pi state/event processing. Defer/coalesce presentation only where the owning contract allows it; never discard response, queue-consumption, error or identity transitions.
- Preserve optimistic local interaction, mounted card identity, focus, disclosures, drafts and independent scroll intent. Performance work is not permission to invent an RPC-gated interaction or generic harness protocol.
- Prefer eliminating work before workers, separate webviews or process-priority changes. Architectural escalation needs a measured bottleneck and its own design/ownership analysis.
- Follow repository worktree/local-development rules. Run tests/checks only when explicitly requested; requested validation uses `mise run check`, and scroll/layout changes also require `npm run test:browser`. No automatic packaging, live model requests, session-file mutation, browser debugging or user-window restart. Fixture tests are not native macOS/Linux/possible Windows acceptance. Behavior changes update their canonical feature reference and relevant user guide.
