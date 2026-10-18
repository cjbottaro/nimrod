# Translucency

Open **global Settings → Appearance** (⌘/Ctrl+,) to customize the window background. These preferences apply across project windows, Settings and pop-outs, independently of the selected color theme. Project settings does not create translucency overrides.

## Controls

- **Background opacity:** 0–100%, default **100% (Opaque)**. Lower values reveal more of the desktop behind the app. Text, icons and syntax colors remain crisp and fully opaque. Dragging previews Settings immediately and updates project windows and pop-outs live. Releasing saves the value once; closing Settings during an uncommitted drag restores the saved opacity.
- **Apply translucency to:** **Whole window** (default) includes the conversation background. **Sidebar and Project bar** keeps the conversation opaque. Settings uses the same distinction for its category sidebar/header versus content pane. Pop-outs stay opaque in sidebar-only mode because they have no such sidebar or Project bar.
- **Background blur (supported macOS systems only):** 0–40, default **20**. This independently controls how soft the desktop behind the window looks, without adding another tint. At **0**, underlying text stays sharp; increasing the value blurs it more. At **50% opacity / 0 blur**, the desktop stays sharp under a half-strength theme tint. At **0% opacity / 0 blur**, the base background is clear. Blur has no visible effect at 100% opacity, but its strength is remembered. Like opacity, dragging previews all windows immediately; releasing saves once, and closing Settings during an uncommitted drag restores the saved value. The scale is blur intensity, not a guaranteed pixel measurement.

**The same visual hierarchy is preserved throughout the slider's range.** In **Whole window** mode, the Status area and session notices remain denser, distinguishable panels over the conversation; lowering opacity makes them progressively more transparent without flattening them into the surrounding background. There is no abrupt switch in their treatment between 100% and 99%. Buttons—including New session, Send/Stop, sidebar controls and their hover/selected states—also change density progressively while preserving their emphasis. Labels, icons, focus rings and error outlines remain crisp. Filled buttons keep a stable readable text colour; their minimum fill density is calculated from the palette, so some buttons remain denser at low opacity. This is shared across built-in, catalog and imported themes—not a special case for Nimrod. At 0%, the main background is clear, but panels and controls retain a light tint to preserve this hierarchy. In **Sidebar and Project bar** mode, only controls in those areas become translucent; the conversation stays opaque. Code blocks and suggestions still have solid backing surfaces; a translucent button on one of those surfaces blends with that backing, not directly with the desktop. Translucency never fades the whole app or changes your draft, conversation, focus or reading position. At 100%, readable opaque button pairs preserve their palette colours; poorly contrasted or alpha button pairs are adapted for readability without changing the theme's underlying palette.

**Lighter primary buttons:** below 100%, New session and Send/Stop use a softer tint where readability allows, a faint top-edge highlight and slightly softer corners. Hover strengthens the tint and edge. Their label/icon colours stay unchanged and fully opaque; some themes still need denser fills for contrast. In sidebar-only mode this applies only to New session. **At 100% opacity, their existing appearance is unchanged**, including hover, pressed, focus and disabled states. Reduce Transparency also keeps the original treatment. Other buttons are unchanged by this styling trial.

## Glass dialogs

With **Whole window** translucency, the command palette, session pickers, deletion dialogs and other app modals share a denser translucent panel and restrained dimming backdrop. Their inputs and nested panels also reveal some of that glass rather than covering it with opaque rectangles. Text, icons, borders and focus behavior remain unchanged. They reveal the app underneath; no additional dialog blur is applied.

At **100%**, in **Sidebar and Project bar** mode, or with **Reduce Transparency**, dialogs keep their solid appearance. Theme-picker previews still leave the conversation visible without dimming it.

Filled buttons on known tinted surfaces are glassier: their parent tint contributes to contrast, and readability sets a minimum fill rather than adding another opacity ramp. This avoids unnecessarily dense buttons around 90%. Text stays readable through the same cross-theme policy—no special-case styling for New session.

## Platform behavior

**macOS:** The native title bar follows the window's theme colour and opacity while keeping its title and traffic lights. It remains separate from the Project bar; no custom replacement title bar is used. Native title-bar details, including full-screen and activation, still need visual confirmation.

Nimrod requests compositor-level background blur rather than a tinted native material. Opacity controls the theme tint, while blur controls background sharpness; Nimrod's own text stays crisp. Each window still follows its own theme, including local theme-picker previews. This uses a private macOS API, so availability and appearance may change with macOS updates. If the API is unavailable, the blur control is hidden and plain transparency remains available; native failures appear in the application notice strip rather than switching to a dense frosted material. System **Reduce Transparency** keeps windows opaque without changing saved preferences. Native accessibility changes are refreshed when a Nimrod window receives focus. Blur-only adjustments leave the window's theme and title-bar tint unchanged. A practically transparent native backing (0.01% alpha) preserves normal macOS shadow rendering rather than using a fully clear native backing.

**Linux:** Nimrod exposes opacity and surface selection, not a blur-strength control. Configure blur in your desktop compositor. Transparency and blur depend on your desktop/compositor setup; Nimrod does not configure it or promise blur on every Linux desktop.

**Windows:** translucency is not enabled in this implementation. Windows remains a possible future target.

Save/native failures appear in the shared [application notice strip](error-messages.md). Correct the settings or change the control explicitly; settings writes are not automatically retried.

The independent macOS blur implementation still needs native visual acceptance, including sharp transparency at zero blur, adjustable strength, removal, rounded corners and flicker-free changes, accessibility, resizing/full-screen behavior and performance. The first independent-blur trial exposed a square backdrop and a flash when enabling blur; the user subsequently confirmed that the backing workaround fixes the corners, while enabling blur still flickers. **Known issue:** changing blur from zero to nonzero can briefly show a flat-grey backdrop in every affected window. An isolated native AppKit/WKWebView reproduction on macOS 27.0.1 confirms the native blur-enable path can cause it without Nimrod's Settings or theme updates. The current compositor update batch does not eliminate it. Disabling blur did not show this flash in the reproduction. No flicker fix is claimed. Earlier native feedback accepted improvements to surface hierarchy, not this new blur implementation. Linux native behavior remains unverified.

## Configuration

The global [settings file](settings.md#configuration-files) accepts:

```jsonc
{
  "appearance.backgroundOpacity": 85,
  "appearance.backgroundBlur": 20,
  "appearance.translucencyArea": "window" // "chrome" for Sidebar and Project bar
}
```

Omitted keys use the defaults above. The older `appearance.frostedBackground` boolean is still accepted: if `appearance.backgroundBlur` is absent, false means blur 0 and true means blur 20. An explicit numeric blur value wins; settings files are not automatically rewritten. The blur preference is retained but unused on Linux.
