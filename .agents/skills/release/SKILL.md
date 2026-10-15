---
name: release
description: Prepare and preview a Nimrod release, then publish only after explicit approval of that preview. Load when asked to generate, prepare, cut, ship or publish a release, select a release version, or retry a release.
---

# Nimrod release workflow

**Default: preview only.** “Generate a release”, “prepare a release”, “cut a release” or even an initial “publish a release” request starts preparation of a proposal, not publication. Always show the concrete preview and wait for a subsequent explicit approval before changing release metadata, creating a tag, pushing or dispatching the workflow.

Read repository [AGENTS.md](../../../AGENTS.md), the [features skill](../features/SKILL.md), the canonical [release policy](../features/references/releases.md), especially [preview and approval](../features/references/releases.md#agent-release-preview-and-approval), and [Contributing → Release setup](../../../CONTRIBUTING.md#release-setup). The reference owns changelog/version/publication contracts; this skill owns the operational sequence. This is agent guidance, not a new technical approval gate inside GitHub Actions.

## Invocation

Invoke as `/skill:release`, optionally followed by a requested version/channel or preparation-only scope, for example `/skill:release prepare v0.1.0-alpha.1`. Pi discovers this project skill from `.agents/skills/release/SKILL.md`; its frontmatter name is `release`. A session must have discovered the new skill before the command is available; use a new session or the harness's supported explicit reload/restart action, never restart the user's session automatically. Nimrod does not implement Pi's `/reload` command.

Arguments refine the proposal; they never preapprove a preview the user has not seen. There is no skip-preview or auto-publish flag.

## 1. Inspect without changing anything

- Inspect local main, its exact commit, working-tree status, locally available tags/tracking refs, package versions, CHANGELOG.md and the actual release workflow/scripts. Do not include work from unrelated or unmerged task worktrees.
- Propose a version/channel from the implemented changes and known release history. Explain the choice; flag unknown remote history instead of treating stale local refs as current GitHub state. Do not invent historical versions, verification or supported platforms.
- Show any dirty-tree, missing-note, version, validation or prerequisite blockers. Review validation evidence against its exact revision; “main passed earlier” does not validate later changes. Missing local checks are “not run”, not passes. Known failures remain blockers; do not waive pipeline checks.
- No version/changelog edits, release commits/merges, tag creation, pushes, workflow dispatch, notarization or publication before approval of the concrete preview. Fetch/remote queries and checks/tests/builds also require separate explicit authorization; do not run them merely to produce a preview. Local read-only inspection is sufficient to present a proposal with unknowns.

## 2. Present a release preview and STOP

Include all of the following, with the **complete exact proposed release-note body**, not only a summary or a link:

```text
Release preview — NOT PUBLISHED

Version / tag: <version> / v<version>
Channel: <stable or prerelease>
Release source: <main base commit; preparation commit will contain only the listed metadata edits>
Included changes: <scope since the last known release; explicitly identify uncertain history>
Platforms and artifacts: <read from the current workflow, not the roadmap>
Destination: <GitHub repository and release title>
Homebrew: <tap and whether it will update; no update for prereleases>
Changelog plan: <stable rollover/date or unchanged Unreleased snapshot>
Preparation diff: <exact version fields/files and changelog changes>
Validation: <results with source revisions, or not run>
Blockers / unverified prerequisites: <explicit list, including unknown remote state>

Exact release notes:
<full proposed Markdown body>

Actions requiring approval:
<local preparation commit/merge; exact remote/ref pushes; tag-triggered CI,
signing/notarization, GitHub publication and stable tap update>
Local checks/builds: <separately authorized actions, or none>

Approve publishing v<version> with this source, notes and action scope?
```

- Distinguish hard blockers from unverified prerequisites. If hard blockers need resolution, ask for those specific actions instead of offering publication as ready. Unknown remote state may require separately approved read-only inspection; it is not proof of a conflict or readiness. A review is not native/platform acceptance.
- Wait for a subsequent explicit affirmative answer to the specific publication question. Approval of wording/version alone, silence or an ambiguous “looks good” is not publication permission; clarify. The initial release request is never its own approval.
- If the user wants preparation only, confirm that narrower scope and stop before any tag, push or remote operation. Explicitly authorized validation can run independently without authorizing publication.

## 3. Execute only the approved scope

- Recheck the selected base, notes, version/channel, workflow/platforms, destinations and approval scope. If any material input changed, issue a fresh preview and wait again. Do not silently retarget a newer main or use a previous session's assumed approval. Mechanical metadata edits exactly matching the preview are expected, not a source-scope change.
- Prepare the approved npm/Cargo/Tauri versions and stable changelog rollover (or prerelease snapshot) on a dedicated task branch/worktree. Preserve unrelated work. Commit and merge only the reviewed preparation changes. Stop on main drift or merge blockers rather than pulling new feature work into the release.
- Run local checks/builds only when explicitly authorized and record results against the prepared source. A local app build remains separately authorized; release approval may authorize the disclosed remote CI build without authorizing local packaging or touching the user's running app.
- With explicit publication approval, inspect the named remote/tag/release state and prerequisites. Stop for a conflicting/existing tag, published version, missing credentials or other newly discovered blocker; do not move tags, overwrite public assets, create credentials or bypass protection. A retry needs its own scoped preview under the recovery policy.
- Verify the final preparation diff and source commit still match the preview. Create an annotated tag on that exact preparation commit, make it reachable from remote main using only the approved non-force push, then push only the approved tag. No broad `--tags`, force pushes, unreviewed refs or automatic workflow dispatch in addition to the tag push.
- Remember that the tag push starts a pipeline capable of publishing publicly and updating Homebrew. GitHub environment approvals, if configured, still apply. An approval never authorizes repository/credential administration or deletion of existing releases.

## 4. Report the actual outcome

Report the version/tag and exact prepared commit, changelog treatment, actions actually performed, release/workflow URLs when available, and Homebrew status. Distinguish a successful push, queued/running CI, a public GitHub release and an updated tap; never call an in-progress run “released”. Do not expose secret values.

After an ambiguous push/dispatch response, inspect state before retrying. Follow the reference's immutable-publication/recovery rules; do not rebuild and replace an already-public version. A tap failure does not undo GitHub publication. Preserve the preparation branch/worktree unless cleanup was explicitly requested.

If permission or prerequisites are missing, stop with the preview/blocker. Do not silently broaden the approval, fix unrelated features, run paid/live agent work, launch the app, or perform cleanup to make the release happen.
