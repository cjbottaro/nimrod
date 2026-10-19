# Translucency

Open **global Settings → Appearance** (⌘/Ctrl+,) to customize the window background. These preferences apply across project windows, Settings and pop-outs, independently of the selected color theme. Project settings does not create translucency overrides.

## Controls

- **Background opacity:** 0–100%, default **100% (Opaque)**. Lower values reveal more of the desktop behind the app. Text, icons and syntax colors remain crisp and fully opaque. Dragging previews Settings immediately and updates project windows and pop-outs live. Releasing saves the value once; closing Settings during an uncommitted drag restores the saved opacity.
- **Background blur (supported macOS systems only):** 0–40, default **20**. This independently controls how soft the desktop behind the window looks, without adding another tint. At **0**, underlying text stays sharp; increasing the value blurs it more. At **50% opacity / 0 blur**, the desktop stays sharp under a half-strength theme tint. At **0% opacity / 0 blur**, the base background is clear. Blur has no visible effect at 100% opacity, but its strength is remembered. Like opacity, dragging previews all windows immediately; releasing saves once, and closing Settings during an uncommitted drag restores the saved value. The scale is blur intensity, not a guaranteed pixel measurement.

**The same visual hierarchy is preserved throughout the slider's range.** Translucency always applies to the whole window, including Settings and pop-outs. The Status area and session notices remain denser, distinguishable panels over the conversation; lowering opacity makes them progressively more transparent without flattening them into the surrounding background. There is no abrupt switch in their treatment between 100% and 99%. Buttons—including New session, Send/Stop, sidebar controls and their hover/selected states—also change density progressively while preserving their emphasis. Labels, icons, focus rings and error outlines remain crisp. Filled buttons keep a stable readable text colour; their minimum fill density is calculated from the palette, so some buttons remain denser at low opacity. This is shared across built-in, catalog and imported themes—not a special case for Nimrod. At 0%, the main background is clear, but panels and controls retain a light tint to preserve this hierarchy. Code blocks and suggestions still have solid backing surfaces; a translucent button on one of those surfaces blends with that backing, not directly with the desktop. Translucency never fades the whole app or changes your draft, conversation, focus or reading position. At 100%, readable opaque button pairs preserve their palette colours; poorly contrasted or alpha button pairs are adapted for readability without changing the theme's underlying palette.

**Buttons follow the theme:** New session and Send/Stop use the same theme-derived button treatment as other primary actions, without extra edge highlights or softer corners. Some themes intentionally make buttons more prominent or quieter than selected rows. Translucency preserves their palette colours and protects label contrast rather than forcing every theme toward a glassy look. At 100% opacity and with Reduce Transparency, buttons retain their opaque treatment.

## Glass dialogs

With translucency enabled, the command palette, session pickers, deletion dialogs and other app modals share a denser translucent panel and restrained dimming backdrop. Their inputs and nested panels also reveal some of that glass rather than covering it with opaque rectangles. Text, icons, borders and focus behavior remain unchanged.

Every ordinary modal backdrop applies an **in-app depth blur** to Nimrod content beneath it. That includes the first modal over the conversation and an upper modal over another modal. This CSS filter samples the webview content behind the backdrop; it does not re-filter the desktop directly. Depth blur follows the same saved 0–40 strength, live preview, Off state, opacity gating and Reduce Transparency behavior as supported native macOS blur.

The two effects intentionally share a control, not a rendering algorithm. Native macOS blur samples windows behind Nimrod through AppKit; depth blur samples Nimrod's already-composited web content through the webview's CSS renderer. A strength of 20 currently maps to a 20 CSS-pixel depth radius, but different sampling, edge treatment, display scale and OS/webview versions can make the results look somewhat different. The goal is matching perceived softness and behavior, not pixel-identical output. This explicit mapping gives future calibration one place to change without creating a second preference.

At **100%** or with **Reduce Transparency**, dialogs keep their solid appearance. Theme-picker previews still leave the conversation visible without dimming it.

Filled buttons on known tinted surfaces are glassier: their parent tint contributes to contrast, and readability sets a minimum fill rather than adding another opacity ramp. This avoids unnecessarily dense buttons around 90%. Text stays readable through the same cross-theme policy—no special-case styling for New session.

## Platform behavior

**macOS:** The native title bar follows the window's theme colour and opacity while keeping its title and traffic lights. It remains separate from the Project bar; no custom replacement title bar is used. Native title-bar details, including full-screen and activation, still need visual confirmation.

Nimrod uses a native background effect with its material tint and extra saturation removed, then applies the requested blur strength. Opacity controls the theme tint, while blur controls background sharpness; Nimrod's own text stays crisp. Each window still follows its own theme, including local theme-picker previews. This depends on private macOS material/filter details, so availability and appearance may change with macOS updates. If support is unavailable, the blur control is hidden and plain transparency remains available. Native failures fall back to plain transparency and appear in the application notice strip, rather than switching to a dense frosted material. Zero removes the effect completely; there is no hidden minimum blur. System **Reduce Transparency** keeps windows opaque without changing saved preferences. Native accessibility changes are refreshed when a Nimrod window receives focus. Blur-only adjustments leave the window's theme and title-bar tint unchanged. A practically transparent native backing (0.01% alpha) preserves normal macOS shadow rendering rather than using a fully clear native backing.

**Linux:** The GTK-drawn native title bar follows each window's Nimrod theme and background opacity, including live previews, and joins the app content without a separator line. The themed separator beneath the Project bar remains. Linux uses the [command palette](command-palette.md#linux-application-actions) instead of an app menu bar. Text/icons stay opaque, and the existing native window controls remain in place. This uses GTK rather than desktop-specific integrations. If your backend uses a window-manager-drawn title bar instead, its appearance remains controlled by the desktop; popup menus also keep their native desktop appearance. Nimrod exposes opacity, not a blur-strength control. Configure desktop blur in your compositor. A compositor can blur windows behind Nimrod but, like macOS native blur, cannot blur Nimrod content beneath a modal inside the webview. CSS depth blur can solve that separate layer problem, but Nimrod cannot read a portable compositor radius and must not silently apply the hidden/default macOS strength as though it matched. Depth blur therefore remains off on Linux until there is an explicit app-owned strength contract and verified WebKitGTK/compositor behavior. Transparency and desktop blur depend on the desktop/compositor setup; Nimrod does not configure them or promise blur on every Linux desktop.

**Windows:** translucency is not enabled in this implementation. Windows remains a possible future target.

Save/native failures appear in the shared [application notice strip](error-messages.md). Correct the settings or change the control explicitly; settings writes are not automatically retried.

The material-backed implementation replaces the WindowServer radius setter that produced a grey flash when enabling blur. Native AppKit/WKWebView fixture runs using the production helper on macOS 27.0.1 showed no captured grey flash, including resize and dark/light appearance changes; zero removal and native title-bar coverage were also exercised. This is not full packaged-app acceptance: modal depth-blur calibration, all opacity/theme combinations, fullscreen/minimization, accessibility, focus/input/scroll and streaming performance still need verification. Linux native and CSS depth-blur behavior remains unverified.

## Configuration

The global [settings file](settings.md#configuration-files) accepts:

```jsonc
{
  "appearance.backgroundOpacity": 85,
  "appearance.backgroundBlur": 20
}
```

Omitted keys use the defaults above. The removed `appearance.translucencyArea` setting is ignored; existing entries may be deleted manually but do not need migration. The older `appearance.frostedBackground` boolean is still accepted: if `appearance.backgroundBlur` is absent, false means blur 0 and true means blur 20. An explicit numeric blur value wins; settings files are not automatically rewritten. The blur preference is retained but unused on Linux.
