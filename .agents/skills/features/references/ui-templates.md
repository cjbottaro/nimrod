# Declarative UI templates

**Status: initial layout/Project bar implementation; behavioral and native acceptance pending.** The [UI customization skill](../../ui-customization/SKILL.md) owns the broader direction and staged expansion. This reference owns the implemented contract. [User guide](../../../../docs/ui-templates.md); [verification](verification.md#ui-templates).

## Ownership and scope

A window mounts one declarative outer layout and Project bar before Settings/sidebar/session consumers acquire nodes. Existing sidebar/content nodes are retained at startup and explicit template reload; streaming and navigation never remount templates. The default HTML/CSS in `src/ui-templates/` uses exactly the same parsing, scoped stylesheet, binding and action paths as user files.

The first version does **not** expose independent template slots or replacement APIs for the per-session Transcript, Status area or Composer. Layout CSS can visually arrange those existing components using the [documented conversation styling hooks](../../../../docs/ui-templates.md#styling-the-existing-conversation-components); visual reordering does not change DOM/keyboard order or behavior ownership. The content slot retains the complete existing conversation engine, empty-project and welcome states. Session lists, sending, configuration, commands, drafts, native ownership, focus and scroll remain with their current owners. Template button content is author-owned; execution, disabled state, shortcut hints and accessible action metadata remain Nimrod-owned.

## Loading and recovery

`read_ui_templates` reads four optional fixed UTF-8 files from `ui/` beside global `settings.json`: `layout.html`, `layout.css`, `project-bar.html`, `project-bar.css`. No project discovery, arbitrary read path or scripts. Welcome/project windows only; Global Settings/reference windows never load user templates. Native loading runs on a blocking worker, bounds each file at 256 KiB and rejects non-files and file symlinks escaping the canonical UI directory. Missing files use corresponding defaults. An I/O error falls back to all defaults and reports an application notice.

Frontend validates each surface's HTML and CSS together before moving any owned component. Invalid layout or Project bar input falls back to that surface's bundled pair through the identical pipeline, with an application notice. CSS parser-ignored declarations follow browser behavior; this is not a full CSS lint/parser diagnostic service. Templates are read on startup and by explicit **Reload customizations** (`reload-customizations`, application context/project-scope shortcut handling, no default binding). No watcher, automatic session Resume or draft replay. Existing configured users without these files retain the default presentation.

### Explicit reload

The palette, configurable shortcut and [target-window CLI action](cli-actions.md) share `reloadCustomizations` in the shell, concurrently refreshing UI templates and the card-plugin catalog. Concurrent invocations coalesce the combined operation; a failure in one subsystem does not suppress the other, and each retains its own error reporting. `reloadUiTemplates` owns only the internal template operation: late unload results are ignored, and all HTML/CSS is prepared before live mutation. Unlike cold startup, invalid reload input retains the entire current UI and reports one stable application notice. Successful reload resolves template-load/reload notices without a success toast.

The runtime retains the resize-owner container, Project bar host, action button objects/listeners and actual sidebar/content/session nodes. It replaces only author-owned wrappers, button contents and bindings, copies permitted presentation attributes, preserves action availability/accessibility/error metadata and immediately publishes cached live values. Managed sidebar width survives, and resize observation is refreshed against the new geometry. Use state-preserving DOM moves when supported, otherwise restore the currently focused retained element, text selection and scroll offsets explicitly. If a focused author-owned node disappears, focus falls back to the mounted prompt or an available mounted action. No harness or draft lifecycle methods run. Active IME composition and open dialogs reject the commit; the user can explicitly retry. No delayed automatic remount.

## Layout API (experimental v1)

Exactly one empty `nimrod-slot` for each of `project-bar`, `session-sidebar`, `sidebar-resizer`, `content`. Exactly one `data-nimrod-sidebar-layout` container holds sidebar/resizer/content slots as direct children; the Project bar is outside it. This container receives the internal `workspace-layout` identity and shared resize behavior. `data-nimrod-sidebar-side="left|right"` controls pointer/key resizing direction and resize-handle placement, not visual order: author markup/CSS determines order. Preserve horizontal sidebar geometry. `--session-sidebar-width` is managed on that container; `--sidebar-width` is its shared consumed alias.

The root host is `#workspace-shell`, Project bar host `#workspace-bar`. Both are stable styling hooks. Layout CSS can arrange these and descendants. Existing conversation resize observers retain scroll ownership; there is no second scroll container or resize engine.

Application notices, Settings/dialogs and native windows are not template slots. The notice strip remains at its existing fixed 48 CSS-pixel offset, with its measured height reserved before the sidebar/content group. Moving the Project bar does not move that strip. Template CSS must not obscure recovery UI or remove the owned content's usable dimensions; semantic validation cannot guarantee arbitrary CSS usability.

## Project bar API (experimental v1)

`data-nimrod-text="key"` patches a leaf's `textContent`, `data-nimrod-title="key"` patches title, and `data-nimrod-visible="session.present"` patches hidden. No expressions, interpolation, event handlers, loops, HTML injection, IPC or arbitrary code. Text/title keys are `project.name`, `project.parent` (home-abbreviated parent), `project.path`, `session.title`, `session.badge`, `session.badgeTitle`, `session.harness` (display label). `session.present` is boolean and is only accepted for visibility. Session values follow the **presented** session, including empty filtered views, not background updates/navigation membership alone.

A `button data-nimrod-action="sidebar|reload|delete|settings"` is a named behavior component. Each action can appear at most once; all are optional. Omitted controls remain detached owned buttons for existing dispatcher/Settings/resize focus consumers; no consumer requires their presence in the template DOM. Existing palette and shortcut routes remain available. No general arbitrary action runner is exposed in v1. New session and other controls remain in existing UI/palette. Changes to the action inventory must also cover bindable action routing.

Optional `data-nimrod-part` assigns default presentation hooks without requiring private IDs in templates: `project-identity`, `project-name`, `workspace-label`, `project-session`, `project-session-separator`, `project-session-name`, `mode-badge`. Each may occur once; the runtime assigns its matching stable ID for bundled CSS/compatibility. Custom templates need none of them. Action IDs/accessibility are runtime-owned. Bindings patch existing nodes only and skip unchanged values. No observer, subscription, state store, shell callbacks or persistence per streaming chunk is added.

HTML is an allowlist of structural/text elements, buttons and inline SVG primitives. No IDs, scripts, styles, external resources, inline handlers or arbitrary attributes. CSSOM scopes selectors (including comma lists) to the relevant host, retaining style, `@media` and `@supports` rules. Imports, URLs/image-set resources, CSS escapes, nested rules and other global at-rules are outside v1. Local CSS remains trusted presentation, not security isolation. Use existing theme tokens rather than hardcoded palette assumptions.

## Code and fixtures

- `src/ui-templates.ts`: public values, validator, scoped CSS, action components, retained binding updates, startup mount and explicit live reload.
- `src/ui-templates/{layout,project-bar}.{html,css}`: dogfooded defaults; no privileged render path.
- `src/main.ts`: native load, notice routing, project/session projections and existing action wiring.
- `src/session-presenter.ts`: presentation identity callback instead of fixed header DOM ownership.
- `src/settings-surface.ts`: accepts the owning Settings action component, including omitted/detached controls.
- `src/sidebar-resize.ts`: optional side-aware pointer/key direction; Settings resizing retains left-side default.
- `src-tauri/src/ui_templates.rs`: fixed user-config reads and window authorization.
- `test/ui-templates.test.ts`: real bundled/default/custom pipelines, literal values, stable nodes/focus, omitted actions and invalid-input fallback.
- `test/shell.test.ts`: custom header through real presentation/Settings/sidebar consumers and I/O-error recovery.
- `test/browser/ui-templates.spec.ts`: authored offline custom-layout/sidebar geometry and draft preservation; not executed.

Follow [performance guardrails](../../performance-optimizations/SKILL.md#maintaining-and-using-the-catalogue). Broader requested validation is `mise run test`, plus `npm run test:browser` for this layout change. Do not equate jsdom or compile checks with native visual/platform acceptance.
