---
name: customize-nimrod
description: "Specification for the Customize Nimrod action: explicit user-request modal, ordinary user-message submission, installation-aware customization instructions and collapsed transcript presentation across harnesses. Load when specifying, implementing or reviewing agent-first customization requests."
---

# Customize Nimrod — agent-first customization requests

This specification defines the action, modal, generated instruction brief and user-turn presentation for agent-first customization requests. It builds on UI templates, card plugins and the reload CLI.

This is repository agent-facing guidance, **not** a runtime harness skill to install, register or inject into an existing conversation. This skill owns the workflow decisions below. The [UI customization skill](../ui-customization/SKILL.md) owns customization surfaces, template direction and default-template dogfooding. The [request contract](../features/references/customize-nimrod.md) owns message framing, packaged references, modal lifetime, consumer ports and fixture locations. Read the [features skill](../features/SKILL.md), [architecture](../features/references/architecture.md) and [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md) before implementation.

## Product intent and boundary

A user should be able to ask an existing Nimrod session to customize Nimrod, regardless of which supported harness owns it. Nimrod supplies an explicit, inspectable authoring brief alongside the user's request; the agent performs the work using that session's normal tools and permissions.

**Nimrod helps the user submit an informed request; it does not become a harness.** Do not silently inject system/developer context, create a hidden turn, install a harness skill, register a special agent/tool, switch models/harnesses, spawn another session or build a privileged execution path. No backend whitelist: the request is ordinary text, not a Pi-specific skill invocation or a new universal harness protocol. The agent's actual tool access and permissions still determine what it can accomplish.

## Interaction

1. Offer **Customize Nimrod…** through the normal command-palette/bindable-action infrastructure for an eligible connected session. No default shortcut has been agreed.
2. Open an ordinary shared modal asking **“How would you like to customize Nimrod?”** with multiline user input.
3. Make the supplied brief inspectable in an optional **“Instructions included with your request”** disclosure. Explain that these instructions will be sent with the request; they are not secret context.
4. **Send request** submits exactly one ordinary user turn containing the Nimrod customization instructions followed by the user's actual instructions. Opening the modal, expanding the brief or cancelling sends nothing.
5. The agent edits customization files and invokes the existing reload CLI through its normal tools. Nimrod does not perform those edits or automatically reload as a side effect of submitting the request.

Use the agreed terms: **Project bar**, **Session sidebar**, **Transcript**, **Status area**, **Composer**. “Running session” means connected/eligible here, not necessarily **Working**, and not merely open in the sidebar. Do not start, connect or Resume a session to make this action available. Respect each harness's existing ordinary-message busy/send policy; do not invent a queue, automatically Stop work or turn the request into an undisclosed command. Revalidate availability at submission.

Bind the modal to the originating project window and concrete session/lifetime. A later selection change, close, Reload or lost connection cannot redirect the request to whichever session is now selected. If eligibility is lost before dispatch, reject locally and preserve the unsubmitted input for correction/cancellation; never silently send to a replacement session or reconnect to deliver it.

## Ordinary submission, separate input ownership

The modal owns its input. Preserve the existing Composer draft, selection, attachments and recovered text; do not overwrite the Composer, synthesize typing or temporarily swap drafts to reuse Send.

Use the existing normal submission pipeline and integration-owned message-input/policy boundaries. Extend a narrow shared submission seam if needed rather than adding direct per-harness RPC/SDK calls. Modal submission is still user intent, not background context delivery.

After local validation, apply the existing [optimistic interaction policy](../features/references/architecture.md#optimistic-interaction-policy): close/clear the submitted modal input and show the pending user turn immediately, with ordinary Send recency/follow behavior. Do not wait for acknowledgement to repeat those effects. Authoritative harness events reconcile the same pending turn; no duplicate message or second instruction-only turn. Existing error/uncertainty handling remains session-bound. Late failures must not overwrite newer input, restore submitted text into the Composer, repeat navigation or automatically replay the prompt. Consult [composer delivery](../features/references/composer.md) and [error presentation](../features/references/error-presentation.md).

Use the [shared modal shell/lifecycle](../features/references/modal-layout.md#implementation-checklist), reusing existing input interactions where practical. Respect Escape/Cancel, multiline input, Enter/IME rules, parent-modal priority and focus restoration; no custom geometry or animation lifecycle.

## The outgoing instruction brief

The brief must be self-contained and installation-aware. It should provide the minimum useful supported authoring context:

- Which customization surfaces/APIs the running version supports, including current limitations and the ordinary bundled-default approach.
- Actual resolved customization locations and relevant default/API guidance, without assuming the current project is Nimrod's source checkout or referring only to repository-internal skills.
- Preservation of existing user-authored files and the distinction between customization-file edits and requests requiring a change to Nimrod itself. A customization request is not blanket authorization for app source changes, builds, restarts or unrelated file edits.
- The existing [reload CLI](../features/references/cli-actions.md), explicitly targeting the originating project even if the agent later changes cwd:

  ```sh
  nimrod --action reload-customizations --project <originating-project-directory> --json
  ```

  Generate real paths with appropriate quoting, not the placeholder above. Use the actual running executable's absolute path in place of `nimrod`, so the workflow does not depend on PATH or a separately installed launcher. Explain actual completion/partial-error/uncertainty semantics; do not treat successful reload as visual acceptance or automatically replay uncertain requests.
- The scope of customization files versus the scope of reload: existing user files are global, while the CLI targets one already-open project window. Do not imply project-local or harness-local customization storage.

Reuse canonical authoring contracts: [UI templates](../features/references/ui-templates.md), [card plugins](../features/references/card-plugins.md), and their user guides. Do not maintain a second handwritten copy of the complete API in this skill. The runtime brief must match the installed/running app's supported API, not require access to this development repository. Bundle the matching canonical guides, public card types, examples and defaults as read-only app resources. Resolve their installed absolute paths and global user directories through the owning project window; keep the brief concise and point to those resources for complete API guidance. Do not invent a discovery command or depend on a source checkout as a prerequisite.

## One user turn; presentation-only disclosure

The entire brief and user request are ordinary user-message content, sent to and retained by the harness. They must remain understandable in another client without Nimrod rendering. No system-role promotion, out-of-band context mutation or Nimrod-authored replacement history.

In Nimrod, keep the user's request prominent and the supplied brief collapsed by default, schematically:

```text
▸ Nimrod customization instructions

Move the Status area above the Transcript.
```

Expanding reveals the actual sent brief, not regenerated instructions from the current app version. The user's request remains outside the disclosure. Preserve exact request text and full-content access; never execute or interpret its contents as template markup. The modal preview and sent content must agree.

Use a **Nimrod-owned user-turn presentation**, not the existing public tool-card plugin API, a fabricated tool call, or Pi/Copilot skill syntax. Use a small versioned, explicitly recognizable text envelope so presentation can be reconstructed after history replay/Resume without relying solely on ephemeral local metadata. This envelope is a message-content/presentation format, not a harness wire protocol. Use the [versioned length-delimited framing](../features/references/customize-nimrod.md#versioned-user-message-envelope) so delimiter-like user input and Unicode round-trip without escaping or losing request text. Do not casually classify arbitrary user prose or assistant examples by keywords. Unknown versions, malformed envelopes or unsupported presentations must retain literal full-text fallback rather than hiding or losing content.

Preserve retained turn/disclosure identity through optimistic echo adoption, streaming updates, hidden-session catch-up and history reconciliation. Reuse shared disclosure/Markdown mechanics and lazy rendering; do not add a transcript scan or a second scroll owner. Existing [skill disclosures](../features/references/transcript-cards.md#skill-disclosures) are a presentation precedent, not a supported invocation or envelope API to impersonate.

## Acceptance criteria

Unsubmitted input belongs only to the modal lifetime: preserve it through local rejection or lost eligibility, and discard it on cancellation or accepted dispatch. Fence the originating session/connection lifetime independently of the current selection. Keep the one-message/explicit-consent boundary intact.

Fixture coverage must exercise:

- Eligible/ineligible and busy sessions through real consumer paths, without harness-specific shell branches or automatic connection.
- Cancel/no-send, inspectable brief, exact single-turn payload, originating-session lifetime revalidation and unchanged existing Composer state.
- Immediate pending presentation, authoritative echo adoption, failed/uncertain delivery without replay or newer-draft mutation.
- Disclosure/raw fallback for history/Resume, unknown versions and malformed/user-supplied delimiter text; stable nodes, focus and reading intent.
- Installed-app-compatible paths/guidance and correctly quoted explicit reload target, including spaces in paths; normal permission/tool handling.

Do not send real model requests or run live customization work as an implementation test without explicit authorization. Follow repository worktree and validation rules; only the mandatory post-merge compile check is automatic. Keep specifications, verification evidence and user guidance in their canonical owners. Follow the repository's documentation/changelog policy for user-visible behavior changes.
