# Paste images

Copy a screenshot or image, focus the **prompt field**, then press **⌘/Ctrl+V**.
The composer shows a thumbnail with a Remove button. Paste again to attach more
images; add an optional message, then press Enter. Image-only messages work too.
Text paste retains normal selection/insertion behavior.

Images use the existing delivery controls: Enter sends/steers, and Option-Enter
(Alt-Enter on Linux) queues a follow-up while Pi is working. Attached images
appear in user turns, including history restored from Pi. Image attachments cannot
be combined with slash commands; nothing is sent and the draft remains intact.

## Drafts and recovery

Only Pi acknowledgement clears submitted text/images. Newer edits and attachments
remain. Rejected or uncertain sends are kept, and nothing is retried automatically.
Saved-session image drafts are stored locally, separate from Pi history. Temporary
session images stay in memory and are lost when that session closes or the app
reloads/quits. Missing image draft data blocks sending; remove or repaste that image.

Pi's queue recovery returns text only. Consequently, acknowledged image sends also
retain a collapsed **Image send recovery** section. **Restore images** explicitly
reattaches those images without restoring the caption or sending anything; recover
cleared caption text through the existing status-area Restore control if needed.
**Dismiss** removes the recovery entry. Check the transcript/queue before restoring
an accepted or uncertain message. Recovery does not prove images are still queued
or that the agent has read them. Pi may normalize images; Nimrod does not guess
consumption from a caption or idle state.

## Limits and platform status

- PNG, JPEG, WebP and GIF; no SVG or arbitrary clipboard HTML images.
- Up to 8 images, 4 MiB each, 8 MiB total per message, 32 megapixels per pasted image.
- Local image draft storage is bounded to 128 MiB. Unreferenced persistent images
  older than 24 hours are cleaned when another image is saved; temporary storage
  is released when its session closes.
- Up to 32 accepted image-send recovery entries per session. Dismiss or restore old
  entries before sending more image messages.
- Pi remains responsible for model/provider image support and image normalization.
- Paste events are the shared path. A native clipboard fallback reads screenshots
  and other OS image representations when the paste event exposes no image/text.
  Finder/file-manager copied files and HTML-only clipboard images are not imported.
- Native macOS screenshot/image paste and Linux desktop/Wayland clipboard acceptance
  still require manual verification. Offline automated WebKit tests do not establish
  native platform parity. No file picker or drag-and-drop is included yet.
