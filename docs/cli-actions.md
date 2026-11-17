# CLI actions

Reload customizations in an **already-open** Nimrod project window:

```sh
nimrod --action reload-customizations
nimrod --action reload-customizations --project /path/to/project
nimrod --action reload-customizations --project /path/to/project --json
```

Without `--project`, the target is your current directory. Paths are canonicalized, so directory symlinks resolve to the same project identity. Use the actual project directory, not an arbitrary nested directory. `--project` is useful when your shell has changed directories during work.

This invokes the same **Reload customizations** action as the command palette: it reloads [layout/Project bar templates](ui-templates.md) and refreshes the [card-plugin catalog](card-plugins.md#startup-reload-and-caching). Inspected cards keep their renderer. It does not restart agents, send prompts, resume sessions or clear drafts.

## Targeting and completion

The command does **not** open Nimrod, create a project window, bring it to the front or select a session. The matching project must already be open and ready in the running app. Missing, closing, unready or ambiguous targets return an error; the command never falls back to whichever window is focused.

Unlike `nimrod DIRECTORY`, which returns after the OS accepts a launch, an action command waits for the target window's actual result. Both reload branches are attempted independently: invalid templates keep the existing UI while card plugins can still refresh successfully. Errors are returned to the terminal as well as their normal in-app notices.

Only `reload-customizations` is exposed. Other palette actions, arbitrary JavaScript and native commands are not accepted.

## Structured output

`--json` writes one response object to stdout. A successful response resembles:

```json
{
  "ok": true,
  "action": "reload-customizations",
  "project": "/path/to/project",
  "outcome": "completed",
  "result": {
    "uiTemplates": { "applied": true, "error": null },
    "cardPlugins": {
      "report": { "personalLoaded": 2, "cacheHits": 1, "manifestLoaded": 0 },
      "error": null
    }
  }
}
```

- **`completed`**: the window returned its results. Inspect both branches; `ok: false` includes partial failures or plugin warnings/errors even when some plugins loaded.
- **`notDispatched`**: no action was sent to a window—for example, the app/project is unavailable, the window is not ready or the control service is busy.
- **`unknown`**: delivery or completion could not be established. The action may have run. Do not retry automatically. A timeout does not cancel the underlying reload.

Rejected/uncertain responses carry an `error` instead of `result`. `project` may be null for requests rejected before target decoding. CLI subsystem diagnostics are limited to 2000 characters each, with a truncation marker; the existing in-app notices retain full operation errors.

Exit status is **0** only for complete success, **1** for partial failure/rejection/transport uncertainty, and **2** for native argument parsing errors. Launcher errors are nonzero. Argument/launcher errors remain on stderr rather than becoming JSON action responses. Without `--json`, the CLI prints a readable summary and errors.

## Availability

The control transport is implemented for macOS and Linux, using a private local per-user socket separate from ordinary terminal launch forwarding. It has bounded waits (up to roughly two minutes for the operation) and never automatically retries a request. Native end-to-end/installed-binary acceptance remains pending on both platforms. Windows action transport is not implemented.

Use a build that includes CLI action support for both the running app and the CLI's selected executable. `NIMROD_APP` retains its existing executable/app override semantics; it does not cause an action request to start that app. A source change alone does not update an already-built or running app.
