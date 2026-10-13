# Translucency

Open **global Settings → Appearance** (⌘/Ctrl+,) to customize the window background. These preferences apply across project windows, Settings and pop-outs, independently of the selected color theme. Project settings does not create translucency overrides.

## Controls

- **Background opacity:** 0–100%, default **100% (Opaque)**. Lower values reveal more of the desktop behind the app. Text, icons and syntax colors remain crisp and fully opaque. Dragging previews the Settings window immediately; releasing saves the value and updates other windows.
- **Apply translucency to:** **Whole window** (default) includes the conversation background. **Sidebar and Project bar** keeps the conversation opaque. Settings uses the same distinction for its category sidebar/header versus content pane. Pop-outs stay opaque in sidebar-only mode because they have no such sidebar or Project bar.
- **Frosted background (macOS only):** on by default, but has no effect at 100% opacity. Turn it on to blur the desktop behind translucent backgrounds, or off for plain transparency. macOS chooses the native blur strength; there is no blur-radius slider. Even at 0% theme-background opacity, the native frosted material can retain its own tint.

In **Whole window** mode, the Status area, composer and session notices use light additional tints instead of solid rectangles. Buttons—including New session, Send/Stop, sidebar controls and their hover/selected states—use translucent fills while labels, icons, focus rings and error outlines remain crisp. In **Sidebar and Project bar** mode, only controls in those areas become translucent; the conversation stays opaque. Code blocks, suggestions and ordinary dialogs still have solid backing surfaces; a translucent button on one of those surfaces blends with that backing, not directly with the desktop. Translucency never fades the whole app or changes your draft, conversation, focus or reading position. At 100%, the existing opaque theme appearance is preserved.

## Platform behavior

**macOS:** Nimrod requests native frosted glass using a standard popover material rather than the denser sidebar material. It follows that window's theme dark/light appearance, including local theme-picker previews, without changing other windows' native appearance. Native frosting adds its own tint, so it is not pure blur and may still look denser than plain transparency. System **Reduce Transparency** keeps windows opaque without changing your saved preferences. Native accessibility changes are refreshed when a Nimrod window receives focus.

**Linux:** Nimrod exposes opacity and surface selection, not a frosting control. Configure blur in your desktop compositor. Transparency and blur depend on your desktop/compositor setup; Nimrod does not configure it or promise blur on every Linux desktop.

**Windows:** translucency is not enabled in this implementation. Windows remains a possible future target.

Save/native failures appear in the shared [application notice strip](error-messages.md). Correct the settings or change the control explicitly; settings writes are not automatically retried.

The initial native trial exposed opaque controls/Status-area/notices and frosting that looked nearly opaque. The follow-up adjusts these fills and the native material; its macOS appearance still needs a visual check. Blur-toggle removal, accessibility, resizing/full-screen behavior and performance have not yet been accepted. Linux native behavior remains unverified.

## Configuration

The global [settings file](settings.md#configuration-files) accepts:

```jsonc
{
  "appearance.backgroundOpacity": 85,
  "appearance.frostedBackground": true,
  "appearance.translucencyArea": "window" // "chrome" for Sidebar and Project bar
}
```

Omitted keys use the defaults above. The same configuration is portable: the frosting preference is retained but unused on Linux.
