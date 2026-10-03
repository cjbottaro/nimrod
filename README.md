# Nimrod ✦

A dedicated cross-platform app for directory-backed coding projects and agent harnesses. Conversations belong here; files, searches, and diffs stay in your editor.

**Directory-backed projects, bespoke harness integrations—not a universal chat protocol.** Pi is the first and only implemented integration. This proof of concept extracts the useful Pi GUI interaction work from VS Code into a Tauri desktop app.

## Run

Rust and Node are pinned in `mise.toml`. Rust was installed through **mise**, not Homebrew or a standalone manual installer.

```sh
cd ~/Projects/nimrod
mise trust
mise install
npm ci
mise run dev
```

macOS development needs Xcode Command Line Tools. Other platforms need [Tauri's prerequisites](https://v2.tauri.app/start/prerequisites/).

The local macOS build is:

```text
src-tauri/target/release/bundle/macos/Nimrod.app
```

Open it in Finder, or:

```sh
open src-tauri/target/release/bundle/macos/Nimrod.app
```

No VS Code extension installation is involved. The sibling `pi-gui` project is untouched.

### Terminal launcher

The CLI is a small **Bash script**, not another binary or Node program:

```sh
# From this checkout, after building:
mise run install-cli                  # creates ~/.local/bin/nimrod
# Ensure ~/.local/bin is on your PATH, then:
nimrod .
nimrod ~/Projects/another-project
nimrod --help
```

Without installation, use `./bin/nimrod .`. To install into a different directory, run `bash scripts/install-cli.sh /your/bin`. Installation refuses to overwrite another command and never edits shell configuration. The symlink points to this checkout, so subsequent builds are picked up automatically.

`nimrod` defaults to the terminal's current directory. Paths are canonicalized; an already-open project is brought forward (including a minimized/hidden window), otherwise a project window is opened. No session is started or resumed.

The default app is this checkout's packaged build. Set `NIMROD_APP=/Applications/Nimrod.app` to use another macOS copy. The Bash launcher supports macOS and Linux; Linux defaults to `src-tauri/target/release/nimrod` and accepts an executable override. A Windows terminal wrapper is not included.

**Restart the new build once before trying the CLI against a running app.** Older builds cannot receive forwarded CLI requests. On macOS the wrapper uses `open -n -a … --args …`; Tauri's single-instance plugin forwards the transient second launch to the running app. Plain `open --args` would not deliver arguments to an already-running app. The launcher returns on OS launch acceptance, not a window-focus acknowledgement; subsequent routing errors are shown in the app.

### First try

1. Choose a project folder (choose this repository to exercise the demo's README link).
2. Click **Try offline demo**. This runs a deterministic Node fixture through the actual Rust subprocess transport. It does not launch Pi, call models, execute the displayed tool, or use the network.
3. Send any message. Inspect streaming, thinking/tool disclosures, code copying, and file links. Send another message while it runs to exercise steering; Stop clears/recover queues before aborting.
4. Use **⌘/Ctrl ⇧ P → New offline demo** to open a second session. Switch between open sessions with **⌘/Ctrl ⇧ [ / ]** while one streams; drafts and conversations stay separate. Hide/show the sidebar with **⌘/Ctrl B**.
5. Choose **New session** in the sidebar when ready to use your installed Pi. **New temporary session** remains available explicitly through the command palette.

**Launching Pi is real agent work.** It uses your existing Pi configuration/extensions and selected project's normal Pi trust policy. `--offline` disables Pi's startup networking; it does not disable provider calls when you submit a prompt. Nimrod does not modify Pi's settings or authentication.

Runtime paths are discovered from PATH/common install locations; Node lookup also tries `mise which node`. Override either path in **Settings → Runtime**, then click **Save runtime paths**. Changes apply to the next session only. Windows users can select Pi's `dist/cli.js` and `node.exe` explicitly; npm `.cmd` wrappers aren't supported by this PoC launcher yet.

## Included

- Tauri 2 shell and Rust-owned subprocess, no additional Node backend (Pi itself uses Node).
- One project directory per window and a collapsible session sidebar with activity indicators. The sidebar has a flat open-session list and does not repeat the project directory or duplicate history actions. Opening a directory already open in Nimrod focuses its window.
- **⌘/Ctrl ⇧ P** command palette: choose **Resume session…**, then type to filter this project's history by name, preview or file path. **Switch session…** lists only sessions open in the sidebar; **Resume session…** lists all resumable project sessions. The palette also contains the less-common session actions.
- **New session** is persistent by default; **New named session…** is a compact palette step with a single-line field and inline Create button (Enter creates; Esc cancels), then starts Pi with its native `--name` option (requires a Pi runtime supporting that option). Temporary sessions and offline demos are explicit alternatives. Open historical sessions from the palette or an exact file. Closing a session does not delete history.
- Existing transcript, Markdown/code highlighting, reasoning/tool cards, disclosure timers, queue recovery, and bottom-follow behavior.
- **Pop-outs:** keep code or rendered Markdown visible in separate, session-scoped windows. Saved-session references survive restart; Copy briefly shows a checkmark. [Pop-out guide →](docs/pop-outs.md)
- Fluid conversation layout: transcript, status, and composer follow the window width with consistent side padding rather than a fixed-width centered column.
- Enter to send/steer; Shift+Enter for newline; Stop to clear queues then abort.
- Acknowledged submission handling: preserve newer drafts; never replay uncertain submissions.
- `/name`, idle-only `/compact` (with optional instructions), Pi-discovered slash commands, scoped-model picker, supported thinking levels, native Pi cost/context metrics. **Select model…** and **Select thinking level…** (searchable as “effort”) are command-palette actions; the status-area buttons open those same filtered pickers. Current values are marked, and unavailable/error states are explicit even before a new session's first save.
- RPC extension notifications, text widgets/statuses, and input/select/confirm/editor dialogs. TUI-only widgets remain unsupported.
- File links to VS Code (`path:line:column`, `path#Lline`, or `file:///…#Lline`), HTTP(S) links to the default browser. Plain unlinked path text is not automatically linkified.
- Scoped local drafts, file-backed JSONC preferences in `~/.config/nimrod/settings.json`, separate app-managed state in `~/.local/state/nimrod/state.json`, and the **Nimrod scheme**—this app's custom theme, with dark and light variants. Blue-gray foundations, mint/teal accents, and warm gold details; defined in `src/theme.css`.
- A separate **Settings page** (gear button or **⌘/Ctrl ,**) for Appearance and Runtime preferences; opening it leaves the conversation and Pi running. Valid external settings edits synchronize across windows; comments and unrelated keys survive UI saves. Absolute XDG root overrides are supported on all platforms. [Settings behavior →](docs/settings.md)
- A **theme picker in Settings → Appearance** with **Nimrod (system)** and **Dracula**, plus local imports of standalone VS Code color-theme `.json`/`.jsonc` files. Themes switch immediately and are remembered. See [themes and import instructions](docs/themes.md).
- Whole-app webview zoom, default **125%**, saved between launches. Use **Settings → Appearance → Zoom** or **⌘/Ctrl + / −**; **⌘/Ctrl 0** resets to 100%. Range: 75–200%.
- Explicit disconnect and observed child shutdown on window close/quit.

## Themes

Open **Settings → Appearance** and pick **Dracula** or **Nimrod (system)**. To add another, choose **Import color theme…** and select a standalone VS Code color-theme JSON/JSONC file. You can export your current VS Code theme using **Developer: Generate Color Theme From Current Settings**.

Terminal themes and `.vsix` extension packages aren't interchangeable with these color files. Missing UI colors get sensible defaults, and broad syntax colors are adapted to Nimrod rather than reproducing the entire VS Code grammar engine. [Details and places to find themes →](docs/themes.md)

## Projects and sessions

A **project is a directory**—no Git repository, manifest or registration required. Its canonical path identifies the project, scopes its sessions, and is their working directory. One project belongs to each window; the path remains visible in the project bar. Gitignored worktree subdirectories are a useful layout, but launching a session in a different directory currently requires a separate project window, even when that directory is nested inside another project.

Choose a project directory and **Open**, or use **Open project…**. Opening a project never launches Pi. The sidebar shows open sessions and their activity. Use **New session** or **⌘/Ctrl ⇧ P → Resume session…** to open a conversation; selecting an already-open session focuses it. Background agents keep running when you switch sessions. Each session retains its draft, disclosures and scroll position.

The palette's session list filters as you type. Escape returns to commands (retaining your command query); Escape again closes the palette and restores focus. History is loaded only when requested, with visible loading/error states and Refresh. The palette remains modal while background streaming continues.

**⌘/Ctrl T** creates a session, **⌘/Ctrl W** closes the selected session, **⌘/Ctrl B** toggles the sidebar, and **⌘/Ctrl ⇧ [ / ]** switches open sessions. Closing a session stops only its agent and retains persistent history. Reopening a project restores remembered open sessions without starting them; selecting one automatically loads its history and starts Pi. Closing a project window stops its children, not other projects. No background daemon or automatic prompt replay.

Session discovery reads Pi's default cwd-scoped session directory (or its session-directory environment override); custom locations can be opened through **Open session file…**. See [project behavior and implementation](docs/workspace-sessions.md) for storage, discovery and native-verification boundaries.

## Not currently included

- Background process continuity.
- Session deletion, forks, tree navigation, reload commands, or integrated diffs.
- Other harnesses, generic adapters, updates, signing/notarization, mobile builds, or a production installer.

Deferred slash commands (including `/resume`) are rejected explicitly, not silently submitted as chat; resume is a palette or exact-file action. Automatic Pi compaction remains visible and blocks that session's composer. Window reload reaps that window's children before allowing another launch and never replays a prompt.

## Sessions and resume

**New session** lets Pi choose and write its normal session file. The project bar shows **Pi · awaiting first save** until the file exists: Pi 0.86.1 does not flush an empty session or a rename alone before the first assistant message. Once verified on disk, the badge becomes **Pi** (hover for the exact path), and Nimrod remembers that file/project for **Resume last session**. Missing startup metadata never changes a saved launch into a temporary one.

**Resume session file…** selects an existing JSONL file; select its original project folder first. **Resume last session** explicitly restores the remembered file/project pair. Neither launches automatically on app startup. Resume uses a canonical absolute file path—not a partial ID or “most recent” lookup—and verifies Pi's returned file/ID before enabling submission. Missing, empty, malformed, unsupported-version, or wrong-project files fail without a replacement. Validation currently accepts Pi header versions 1–3, at most 256 MiB per file and 16 MiB per JSONL record; Pi owns subsequent format migration and history interpretation.

Stop any other Pi/Nimrod/VS Code process using the file before resuming. Nimrod serializes its own child shutdown but cannot exclude external writers or eliminate external file-change races. Resume restores Pi's active-context history, not an in-flight process, pending queue, or every abandoned/pre-compaction branch.

Drafts, recovered text, and uncertain submissions are scoped by canonical session file. New sessions use provisional draft identities until their file exists; temporary and demo drafts are separate per tab. Libraries and remembered tab layouts are scoped to the project directory. **Recover unattached draft…** explicitly copies a legacy PoC or unfinished provisional draft into a new session, preserving uncertainty and the recovery source. Nothing is submitted automatically, and history never counts as an acknowledgement. Browser-storage failure is reported but is not a durable-draft guarantee.

The pre-persistence development conversation was temporary; this build does not retroactively save it.

## Build and verify

```sh
mise run check  # TS + UI tests; Rust fmt, clippy, process tests
mise run build  # macOS .app (unsigned local build)

# Real WebKit scrolling regression (offline demo only)
npx playwright install webkit  # one-time browser installation
npm run test:browser
```

JavaScript/Rust Tauri packages must remain on compatible **major/minor** versions. Lockfiles are included; update both sides deliberately.

Optional real-Pi smoke tests use isolated temporary config/session directories and disable user resources. They check temporary startup, a new persistent file identity, and exact-file resume of hand-authored fixture history across two launches. A fixture-only rename verifies Pi's disk writes. No prompt, compaction, or model request:

```sh
NIMROD_TEST_PI="$(command -v pi)" mise exec -- cargo test \
  --manifest-path src-tauri/Cargo.toml \
  local_pi_ -- --ignored
```

See the [documentation index](docs/README.md), [architecture and behavior](docs/architecture.md), and [verification](docs/verification.md). Cross-platform source does not mean cross-platform acceptance: only the macOS build has been produced so far.
