# Translucency

Open **global Settings → Appearance** (⌘/Ctrl+,) to customize the window background. These preferences apply across project windows, Settings and pop-outs, independently of the selected color theme. Project settings does not create translucency overrides.

## Controls

- **Background opacity:** 0–100%, default **100% (Opaque)**. Lower values reveal more of the desktop behind the app. Text, icons and syntax colors remain crisp and fully opaque. Dragging previews the Settings window immediately; releasing saves the value and updates other windows.
- **Apply translucency to:** **Whole window** (default) includes the conversation background. **Sidebar and Project bar** keeps the conversation opaque. Settings uses the same distinction for its category sidebar/header versus content pane. Pop-outs stay opaque in sidebar-only mode because they have no such sidebar or Project bar.
- **Frosted background (macOS only):** on by default, but has no effect at 100% opacity. Turn it on to blur the desktop behind translucent backgrounds, or off for plain transparency. macOS chooses the native blur strength; there is no blur-radius slider. Even at 0% theme-background opacity, the native frosted material can retain its own tint.

Code blocks, suggestions, menus and notices retain solid backgrounds; the composer retains a stronger background for readability. Translucency never fades the whole app or changes your draft, conversation, focus or reading position. At 100%, the existing opaque theme appearance is preserved.

## Platform behavior

**macOS:** Nimrod requests native frosted glass. It follows the theme's dark/light appearance, including theme-picker previews. System **Reduce Transparency** keeps windows opaque without changing your saved preferences. Native accessibility changes are refreshed when a Nimrod window receives focus.

**Linux:** Nimrod exposes opacity and surface selection, not a frosting control. Configure blur in your desktop compositor. Transparency and blur depend on your desktop/compositor setup; Nimrod does not configure it or promise blur on every Linux desktop.

**Windows:** translucency is not enabled in this implementation. Windows remains a possible future target.

Save/native failures appear in the shared [application notice strip](error-messages.md). Correct the settings or change the control explicitly; settings writes are not automatically retried.

The implementation and offline fixtures are present, but native macOS visuals, blur-toggle removal, accessibility, resizing/full-screen behavior and performance have not yet been accepted. Linux native behavior remains unverified.

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
