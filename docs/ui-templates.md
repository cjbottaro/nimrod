# UI templates

Nimrod supports experimental HTML/CSS customization of the workspace layout and Project bar. **The bundled default uses the same template API as custom files.** Themes still supply colors and fonts; [card plugins](card-plugins.md) still customize transcript content.

This first version can reposition the Project bar and Session sidebar and change the Project bar's content. The Transcript, Status area and Composer remain together inside Nimrod's existing conversation view. It does not replace sending, history, session navigation or scroll behavior.

## Install local templates

Create a `ui` directory beside Nimrod's global `settings.json`. You can find that settings file's path in Global Settings. Files are optional:

```text
ui/
  layout.html
  layout.css
  project-bar.html
  project-bar.css
```

Missing files use their bundled defaults. Start from the [bundled templates](../src/ui-templates/) to customize the existing appearance, or use the examples below. These are global user files, never automatically loaded from a project repository.

After editing, run **Reload UI templates** from the command palette. It rereads all four files for the current welcome/project window without restarting agents or reloading the webview. It has no default shortcut; assign one in [Keybindings](keybindings.md). Other open windows are unchanged. There is no file watcher or in-app editor yet.

The reload retains mounted sessions, drafts, selection, reading positions and existing action wiring, while replacing the layout wrappers and Project bar presentation. Live values are immediately applied to the new bindings. Invalid templates or unreadable files leave the current UI intact and report an application notice. Finish any active IME composition or close an open dialog before retrying. Browser-ignored CSS declarations may simply have no effect.

At window startup, invalid supported markup/bindings/rules fall back to the affected default surface; unreadable files use all defaults. To recover from visually broken CSS, rename/remove the custom files and run **Reload UI templates**, or reopen the window. Global Settings and the command palette remain Nimrod-owned, outside template styling. Templates cannot execute JavaScript.

## Example: Session sidebar on the right

Save as `layout.html`:

```html
<div class="my-workspace">
  <nimrod-slot name="project-bar"></nimrod-slot>
  <div data-nimrod-sidebar-layout data-nimrod-sidebar-side="right">
    <nimrod-slot name="content"></nimrod-slot>
    <nimrod-slot name="sidebar-resizer"></nimrod-slot>
    <nimrod-slot name="session-sidebar"></nimrod-slot>
  </div>
</div>
```

Save as `layout.css`:

```css
.my-workspace {
  display: grid;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: 48px minmax(0, 1fr);
}
```

All four slots are required exactly once and must be empty. Sidebar, resize handle and content slots must be direct children of the single `data-nimrod-sidebar-layout` container. The Project bar sits outside that container. `data-nimrod-sidebar-side` defaults to `left`; use `right` when moving the sidebar so dragging and keyboard resizing retain their correct direction. The sidebar must remain a horizontal neighbor of the content.

Nimrod preserves the actual sidebar and conversation components, including selection, draft input and reading position. Do not add a competing scrolling wrapper around the conversation. Use `min-height: 0` / `min-width: 0` in flexible containers to keep their owned viewports usable.

## Example: a compact Project bar

Save as `project-bar.html`:

```html
<nav class="my-project-bar" aria-label="Project">
  <button data-nimrod-action="sidebar">Sessions</button>
  <strong data-nimrod-text="project.name"
          data-nimrod-title="project.path"></strong>
  <span data-nimrod-visible="session.present"
        data-nimrod-text="session.title"></span>
  <button data-nimrod-action="settings">Settings</button>
</nav>
```

Save as `project-bar.css`:

```css
#workspace-bar { min-width: 0; }
.my-project-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 0 12px;
  box-sizing: border-box;
}
.my-project-bar strong { color: var(--vscode-foreground); }
.my-project-bar span {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--vscode-descriptionForeground);
}
```

### Live values

| Binding key | Value |
| --- | --- |
| `project.name` | Directory name, or “Choose a project” before opening one |
| `project.parent` | Parent directory, with home abbreviated to `~` |
| `project.path` | Full project directory path |
| `session.title` | Displayed session's title, or empty |
| `session.harness` | Displayed session's harness label |
| `session.badge` | Integration-provided badge text |
| `session.badgeTitle` | Integration-provided badge description |
| `session.present` | Whether a session is displayed; visibility binding only |

Use `data-nimrod-text` on a leaf element for literal text, `data-nimrod-title` for a tooltip, and `data-nimrod-visible="session.present"` to hide content when there is no displayed session. Values update in place. There are no expressions, `$variable` interpolation, HTML-valued bindings, loops or scripts.

### Actions and styling hooks

Buttons can declare `data-nimrod-action="sidebar"`, `"reload"`, `"delete"` or `"settings"`. Each may appear once or be omitted. Nimrod owns execution, current availability, accessible action labels and shortcut hints; you supply button contents. Omitted controls remain available through their existing palette/shortcut routes. Templates cannot enable unsupported operations.

The host IDs `#workspace-shell` and `#workspace-bar` are styling hooks. To reuse bundled Project bar element styling, use the optional `data-nimrod-part` values found in the default template: `project-identity`, `project-name`, `workspace-label`, `project-session`, `project-session-separator`, `project-session-name`, `mode-badge`. Each may appear once. You do not need these parts in a custom design. IDs are assigned by Nimrod; do not write your own HTML IDs.

## Limits

- HTML supports structural/text elements, named action buttons and inline SVG primitives. No inline styles, event handlers, arbitrary scripts, external resources or custom executable components.
- Styles are scoped to the layout or Project bar. Regular CSS rules, comments, `@media` and `@supports` are supported; imports, resource URLs, CSS escapes, nested rules and global rules such as `@font-face`/`@keyframes` are not.
- Each file must be UTF-8 and at most 256 KiB. File symlinks cannot escape the UI directory.
- Arbitrary CSS can still make a layout unusable. This is trusted local presentation customization, not a sandbox or an automatic layout-accessibility checker.
- Settings, dialogs, application notices and native windows are not customizable slots. The application notice strip keeps its fixed position 48 CSS pixels below the window top, even if you reposition the Project bar; its height is reserved before the sidebar/content group.
- The API is experimental. Native macOS/Linux visual, focus and accessibility acceptance of this feature remains pending; Windows is not a current parity commitment.
