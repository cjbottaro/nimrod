# Translucency

Open **global Settings → Appearance** (⌘/Ctrl+,) to customize the window background. These preferences apply across project windows, Settings and pop-outs, independently of the selected color theme. Project settings does not create translucency overrides.

## Controls

- **Background opacity:** 0–100%, default **100% (Opaque)**. Lower values reveal more of the desktop behind the app. Text, icons and syntax colors remain crisp and fully opaque. Dragging previews Settings immediately and updates project windows and pop-outs live. Releasing saves the value once; closing Settings during an uncommitted drag restores the saved opacity.
- **Apply translucency to:** **Whole window** (default) includes the conversation background. **Sidebar and Project bar** keeps the conversation opaque. Settings uses the same distinction for its category sidebar/header versus content pane. Pop-outs stay opaque in sidebar-only mode because they have no such sidebar or Project bar.
- **Frosted background (macOS only):** on by default, but has no effect at 100% opacity. Turn it on to blur the desktop behind translucent backgrounds, or off for plain transparency. macOS chooses the native blur strength; there is no blur-radius slider. Even at 0% theme-background opacity, the native frosted material can retain its own tint.

**The same visual hierarchy is preserved throughout the slider's range.** In **Whole window** mode, the Status area and session notices remain denser, distinguishable panels over the conversation; lowering opacity makes them progressively more transparent without flattening them into the surrounding background. There is no abrupt switch in their treatment between 100% and 99%. Buttons—including New session, Send/Stop, sidebar controls and their hover/selected states—also change density progressively while preserving their emphasis. Labels, icons, focus rings and error outlines remain crisp. Filled buttons keep a stable readable text colour; their minimum fill density is calculated from the palette, so some buttons remain denser at low opacity. This is shared across built-in, catalog and imported themes—not a special case for Nimrod. At 0%, the main background is clear, but panels and controls retain a light tint to preserve this hierarchy. In **Sidebar and Project bar** mode, only controls in those areas become translucent; the conversation stays opaque. Code blocks and suggestions still have solid backing surfaces; a translucent button on one of those surfaces blends with that backing, not directly with the desktop. Translucency never fades the whole app or changes your draft, conversation, focus or reading position. At 100%, readable opaque button pairs preserve their palette colours; poorly contrasted or alpha button pairs are adapted for readability without changing the theme's underlying palette.

## Glass dialogs

With **Whole window** translucency, the command palette, session pickers, deletion dialogs and other app modals share a denser translucent panel and restrained dimming backdrop. Their inputs and nested panels also reveal some of that glass rather than covering it with opaque rectangles. Text, icons, borders and focus behavior remain unchanged. They reveal the app underneath; no additional dialog blur is applied.

At **100%**, in **Sidebar and Project bar** mode, or with **Reduce Transparency**, dialogs keep their solid appearance. Theme-picker previews still leave the conversation visible without dimming it.

Filled buttons on known tinted surfaces are slightly glassier: their parent tint contributes to contrast, with a reduction capped at five opacity points. Text stays readable through the same cross-theme policy—no special-case styling for New session.

## Platform behavior

**macOS:** The native title bar follows the window's theme colour and opacity while keeping its title and traffic lights. It remains separate from the Project bar; no custom replacement title bar is used. Native title-bar details, including full-screen and activation, still need visual confirmation.

Nimrod requests native frosted glass using a standard popover material rather than the denser sidebar material. It follows that window's theme dark/light appearance, including local theme-picker previews, without changing other windows' native appearance. Native frosting adds its own tint, so it is not pure blur and may still look denser than plain transparency. System **Reduce Transparency** keeps windows opaque without changing your saved preferences. Native accessibility changes are refreshed when a Nimrod window receives focus.

**Linux:** Nimrod exposes opacity and surface selection, not a frosting control. Configure blur in your desktop compositor. Transparency and blur depend on your desktop/compositor setup; Nimrod does not configure it or promise blur on every Linux desktop.

**Windows:** translucency is not enabled in this implementation. Windows remains a possible future target.

Save/native failures appear in the shared [application notice strip](error-messages.md). Correct the settings or change the control explicitly; settings writes are not automatically retried.

Native trials exposed opaque controls and then a loss of panel distinction below 100%. The user reported the continuous surface-density treatment as much better. The next polish prepares cold Settings before showing it and themes the macOS title bar; those native changes still need a visual check. Blur-toggle removal, accessibility, resizing/full-screen behavior and performance have not yet been accepted. Linux native behavior remains unverified.

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
