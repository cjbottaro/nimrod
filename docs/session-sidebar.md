# Session sidebar

The Session sidebar shows open conversations and their activity. **Open** means retained here; **connected** means a live agent connection; **working** means agent activity. These are independent—a disconnected session can still be open.

Click a row to select it. **⌘/Ctrl+B** hides/shows the sidebar without closing sessions. Hover or keyboard-focus a row to reveal **Pin** and **Close**. A pinned row keeps its pin visible. Right-click a row (Control-click on macOS) for a native **Pin/Unpin session**, **Close session** and [Delete](sessions.md#delete-session-tree) menu. The menu targets that row without switching to it. **Shift+F10** or the Menu key opens it from a focused row. Delete reviews a Pi tree or one saved Copilot session when supported; unsupported deletion stays disabled.

## Views

The New session button and All / Unread / Working controls stay fixed; only the session list scrolls.

| View | Shows | Order |
| --- | --- | --- |
| **All** | Every open session | Pinned first; most recently used within each group |
| **Unread** | Unread completed responses, outstanding input requests and failures | Pinned first; stable arrival order within each group |
| **Working** | Live work, compaction and reported subagent activity | All's order |

Counts measure sessions, not messages; they include zero and can overlap. Input-waiting, inactive and lifecycle-transition sessions do not count as Working.

Reading a completed response clears its unread count but keeps the selected row until you leave. A selected Working row likewise stays readable after completion without contributing to its count. Reading does not answer an input request or clear a failure; input clears when answered/canceled, and failures clear when new work or an explicit relaunch begins.

If your remembered session isn't in the chosen filter, the conversation area stays blank until you select a row. New arrivals never select themselves. Hidden conversations keep running and retain drafts, cards and reading position. Returning to All restores the remembered conversation, loading/reconnecting it if inactive without moving focus to its composer.

Empty Unread shows **N sessions working…** while agents are busy, otherwise **No unread sessions**. Empty Working shows **No sessions working.** The chosen view is remembered per project, but live unread/working state is not reconstructed from saved history.

## Pinning

Pin sessions you want to keep near the top. Pinned rows appear above unpinned rows, separated by a subtle divider when both groups are present. Pins do not bypass Unread/Working filters or change counts. Pinning scrolls to the top if the newly pinned row fits there; with a long pin group, it scrolls only far enough from the top to show that row in full, without centering it. Unpinning preserves your sidebar reading position rather than scrolling to the top. A hidden or filtered-out target causes no scrolling. **Pin session / Unpin session** is also in the command palette and can be assigned a shortcut in Keybindings (none by default).

Pinning never selects, connects or restarts a session, marks it read, or changes its message time. Pins on saved open sessions survive reopening the project. Temporary sessions can be pinned for the current window only. Close still works normally and removes the pin along with sidebar membership; resuming a closed session starts unpinned. Pinning is organization, not protection against Close or Delete.

## Ordering and navigation

When a project opens, the sidebar starts at the top if the remembered selected session's entire row is visible there. Otherwise, it scrolls only far enough from the top to reveal the full row—not to center it. This rule starts from the top of the list, not a previous scroll position. It preserves your chosen view: a session excluded by Unread or Working stays hidden without changing filters or scrolling, and a collapsed sidebar stays collapsed. Later activity updates do not repeat this startup scroll. Ordinary session switching keeps its existing scroll behavior.

New sessions start at the top of the unpinned group. Resumed Pi sessions insert using remembered recency or their latest saved user-message time; closed Copilot history uses the agent's reported update time when available. Already-open history entries reuse their sidebar time and status. Sending a message immediately moves its session to the top of its pin group—including Pi steering, queued follow-ups and image-only messages—without waiting for the agent. A later send error does not undo that ordering. Selecting, reading, renaming, changing models, compaction and background output do not reorder All.

Recency survives Close/reopening for saved sessions. Rows show **relative time · date · harness**; unknown timestamps show **No message time · harness**. The session pickers use the same row layout. Time labels refresh without reordering. Sending in the current session scrolls All or Working to the top for a pinned row (or when no pins exist); for an unpinned row below pins it only reveals that row. It does not move focus or change transcript reading position. Unread keeps arrival order within each pin group and its list position. Later Pi responses, errors and activity updates do not move the list; routine updates preserve your reading position.

**Switch session…** / **⌘/Ctrl+T** and previous/next **⌘/Ctrl+Shift+[ / ]** share All's order, wrapping at the ends. They reach every open session even when hidden or filtered. Choosing a filtered-out session switches to All. Sidebar arrow keys navigate the currently displayed rows; Left/Right on view tabs switch views, and Home/End choose All/Working.

After Close or successful deletion of the selected session, selection prefers the most recently used connected session in the current view, then across All. If none are connected, it chooses the most recently used remaining session in the current view, then across All if the view is empty. This rule uses recency even in Unread, not neighboring rows. See [session cleanup](sessions.md#close-a-session).

## Indicators

| Indicator | Meaning |
| --- | --- |
| Hollow circle | Inactive/disconnected |
| Small dot | Ready |
| Ringed dot | Unread response |
| Spinner | Working, sending or a lifecycle transition |
| **?** | Input needed |
| **!** | Failure |
| **↻** | Recovery needed |
| **—** in saved-history pickers | Closed history, not an inactive open session |

Accessible labels distinguish compaction and lifecycle states. Reduced-motion preferences disable spinners/pulsing dots.

## Resize

Drag the right edge. Preferred width is remembered per project, independently of Settings' sidebar width. Narrower windows temporarily cap it; the preferred width returns when space is available.

- Tab to the handle, then use **Left/Right** for 10px steps or **Shift+Left/Right** for 50px.
- **Home/End** choose current limits.
- **Double-click** resets to the default.
- **Escape** cancels an unfinished drag without saving.

Resizing retains focus, drafts, cards and transcript follow/reading intent. Narrow project windows use an overlay sidebar.
