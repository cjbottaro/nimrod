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

Successful sends clear the submitted text/images without keeping an extra recovery
copy. Definitively rejected sends show an error and discard that attempted message;
write a new message if needed. Text or images added while a send was pending remain.
If Pi does not confirm acceptance, the message is marked uncertain and sending stays
blocked. **Write a new message** explicitly discards the uncertain attempt while
preserving newer edits; it does not retry it or prove it failed.
Saved-session image drafts are stored locally, separate from Pi history. Temporary
session images stay in memory and are lost when that session closes or the app
reloads/quits. If an image cannot be read when Send is attempted, nothing is sent:
the attempted message is discarded and the error is shown.

There is no separate image-send recovery section or Restore images action. Images
in accepted user turns belong to Pi's conversation history. A later model/provider
failure does not turn an accepted message into a failed send.

Stop's existing queue restoration returns text only. It does not reconstruct image
attachments; paste an image again if you decide to send it in a new message. Empty
image-only queue text does not create a blank Restore row.

## Limits and platform status

- PNG, JPEG, WebP and GIF; no SVG or arbitrary clipboard HTML images.
- Up to 8 images, 4 MiB each, 8 MiB total per message, 32 megapixels per pasted image.
- Local image draft storage is bounded to 128 MiB. Unreferenced persistent images
  older than 24 hours are cleaned when another image is saved; temporary storage
  is released when its session closes.
- Pi remains responsible for model/provider image support and image normalization.
- Paste events are the shared path. A native clipboard fallback reads screenshots
  and other OS image representations when the paste event exposes no image/text.
  Finder/file-manager copied files and HTML-only clipboard images are not imported.
- Native macOS screenshot/image paste and Linux desktop/Wayland clipboard acceptance
  still require manual verification. Native clipboard support varies by desktop. No file picker or drag-and-drop is included yet.
