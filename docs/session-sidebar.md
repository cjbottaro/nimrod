# Session sidebar

The Session sidebar shows open conversations and their activity. **Open** means retained here; **connected** means a live agent connection; **working** means agent activity. These are independent—a disconnected session can still be open.

Click a row to select it. **⌘/Ctrl+B** hides/shows the sidebar without closing sessions. Each row has [Delete session tree and Close](sessions.md#delete-session-tree) controls.

## Views

| View | Shows | Order |
| --- | --- | --- |
| **All** | Every open session | Most recently used first |
| **Unread** | Unread completed responses, outstanding input requests and failures | Stable arrival order |
| **Working** | Live work, compaction and reported subagent activity | All's order |

Counts measure sessions, not messages; they include zero and can overlap. Input-waiting, inactive and lifecycle-transition sessions do not count as Working.

Reading a completed response clears its unread count but keeps the selected row until you leave. A selected Working row likewise stays readable after completion without contributing to its count. Reading does not answer an input request or clear a failure; input clears when answered/canceled, and failures clear when new work or an explicit relaunch begins.

If your remembered session isn't in the chosen filter, the conversation area stays blank until you select a row. New arrivals never select themselves. Hidden conversations keep running and retain drafts, cards and reading position. Returning to All restores the remembered conversation, loading/reconnecting it if inactive without moving focus to its composer.

Empty Unread shows **N sessions working…** while agents are busy, otherwise **No unread sessions**. Empty Working shows **No sessions working.** The chosen view is remembered per project, but live unread/working state is not reconstructed from saved history.

## Ordering and navigation

New sessions start at the top. Resumed sessions insert using remembered recency or their latest saved user-message time. Only Pi-acknowledged messages subsequently advance recency—including steering and queued follow-ups. Selecting, reading, renaming, changing models, compaction and background output do not reorder All.

Recency survives Close/reopening for saved sessions. Rows show **relative time · date**; unknown timestamps show **No message time**. Time labels refresh without reordering. When a row moves, the sidebar preserves your reading position rather than chasing it.

**Switch session…** / **⌘/Ctrl+T** and previous/next **⌘/Ctrl+Shift+[ / ]** share All's order, wrapping at the ends. They reach every open session even when hidden or filtered. Choosing a filtered-out session switches to All. Sidebar arrow keys navigate the currently displayed rows; Left/Right on view tabs switch views, and Home/End choose All/Working.

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
