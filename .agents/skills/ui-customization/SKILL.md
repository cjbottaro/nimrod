---
name: ui-customization
description: Nimrod declarative workspace layouts and region templates, public data/action bindings, default-template dogfooding and future UI customization direction. Load when designing or changing workspace structure or template APIs.
---

# Declarative UI customization

## Direction

Nimrod should be a customizable workspace shell, not just a themeable transcript. Users control arrangement and presentation through HTML/CSS templates; Nimrod retains application behavior and harnesses retain semantic authority. Read the [features skill](../features/SKILL.md), [architecture](../features/references/architecture.md) and [UI vocabulary](../nimrod-ui-vocabulary/SKILL.md) before implementation.

The five user-facing regions are the **Project bar**, **Session sidebar**, **Transcript**, **Status area** and **Composer**. Do not equate template flexibility with arbitrary application extension execution.

## Non-negotiable boundary

- The bundled default is an ordinary template using exactly the public template loader, validator, data bindings, actions and component slots. No privileged default-only markup/rendering path. Shared behavior components are allowed and must be equally available to users.
- Layout templates place Nimrod-owned components. Region templates bind a documented presentation model and invoke named existing actions. Never expose shell objects, harness controllers, arbitrary expressions, IPC, JavaScript execution or direct state mutation.
- Update text, attributes and availability in place. Do not recreate regions on streaming, configuration or selection updates. Preserve mounted nodes, focus/IME, drafts, disclosures, independent scroll intent and hidden-session catch-up.
- Capabilities and availability remain authoritative. Templates cannot enable unsupported actions, invent metrics, answer permissions or change sending semantics. Follow the [optimistic interaction policy](../features/references/architecture.md#optimistic-interaction-policy).
- Validate before moving live components. Missing/duplicate slots, invalid bindings and malformed templates fall back to the bundled template through the same pipeline at startup; explicit reload failures retain the current UI. Report application-owned errors through the existing notice strip. Never leave users without recovery via Settings/command palette.
- CSS is user-authored presentation code, not a security sandbox. Scope authored selectors to the owned surface, do not allow external stylesheet/resource loading, and keep Settings, dialogs, notices and native windows outside the custom shell.
- Local user configuration only initially: do not automatically load UI code from project repositories.

## Initial implementation boundary

The first slice is workspace layout and Project bar templates. The layout places the Project bar, Session sidebar, resize handle and conversation-content container. Transcript, Status area and Composer remain together inside Nimrod's existing per-session mounted view. Independent placement of those three requires a later explicit contract; do not imply it is already available.

Explicit **Reload customizations** refreshes layout/Project bar authoring and the card-plugin catalog without restarting agents; retain the mounted behavior components and reject invalid reloads before changing the current UI.

The Project bar supports live presentation bindings and named action buttons. Core controls own action semantics, accessibility/availability metadata and shortcut hints; templates own content and arrangement. An omitted action is still available through its existing palette/shortcut route.

The planned [Customize Nimrod… workflow](../customize-nimrod/SKILL.md) is owned separately; template/CLI support does not imply that session action is implemented.

The canonical implemented contract, loading paths, code map and limitations live in [UI templates](../features/references/ui-templates.md). User-facing authoring examples belong in [UI templates guide](../../../docs/ui-templates.md). Verification evidence belongs in [verification](../features/references/verification.md), not here.

## Staged expansion, not current support

1. Layout and Project bar: prove composition, reactive values, named actions and default dogfooding.
2. Session sidebar header/row templates: keyed identity with Nimrod-owned list selection, order, attention, menus and resize behavior.
3. Status-area templates: integration-advertised metrics/controls and current availability, without interpreting harness settings.
4. More Composer arrangement around owned prompt, attachment and Send/Stop components; preserve drafts, focus and IME behavior.
5. Transcript containers and card extensions; keep streaming reconciliation and scroll ownership internal. Do not replace these with arbitrary HTML regeneration.

Conditionals and keyed collections should be introduced only with an actual region consumer. General-purpose expressions, arbitrary scripts, a marketplace and a universal app-extension framework are not part of this direction.

## Change checklist

Define the public bindings/slots/actions first; use them in the default; add fixture coverage for both default and a structurally different custom template; verify invalid input recovery and retained-node updates. Update the canonical internal contract and user guide rather than duplicating API tables here. Follow repository worktree and validation policy; do not run tests/builds without authorization, except the mandatory post-merge compile check.
