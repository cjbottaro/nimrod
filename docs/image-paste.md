# Paste images

Copy a screenshot or image, focus the **prompt field**, then press **⌘/Ctrl+V**.
The composer shows a thumbnail with a Remove button. Paste again to attach more
images; add an optional message, then press Enter. Image-only messages work too.
Text paste retains normal selection/insertion behavior.

Images work in **Pi and Copilot** sessions. In Pi, Enter sends/steers, and
Option-Enter (Alt-Enter on Linux) queues a follow-up while Pi is working. Copilot
sends images while idle; busy Send keeps the draft, without steering or queueing.
Image-only messages work in both integrations. Image attachments cannot be
combined with slash commands; nothing is sent and the draft remains intact.

Attachments appear in user turns, including restored history when the harness
supplies image bytes. Copilot sends inline image blobs—no temporary files or
file-path references. Unsupported or unavailable saved attachments show their
reported metadata instead of being fetched from a path or URL.

## Transcript feedback

Images appear in a local user turn after their bytes are prepared. Copilot's
user echo updates that same turn rather than duplicating it. When Pi starts
that prompt, its actual user turn replaces the preview in place—even if Pi resizes
or re-encodes the image. Pi's coordinate-scaling note is hidden in the transcript;
other image-processing notes remain visible. Assistant output follows
that single turn; ordinary idle sends are never pinned. Images that finish loading
later retain auto-follow, unless you have scrolled up to read earlier messages.
Sending images uses the same **Auto-follow after sending** preference as text. Explicit queued follow-ups
retain their [usual sticky behavior](writing-messages.md#queued-messages) until consumed.

This uses Pi's prompt-preflight metadata. Older Pi versions without that metadata,
or extensions that rewrite queued image content, can leave a preview unconfirmed;
Nimrod does not guess delivery from a caption or automatically send it again.

## Drafts and recovery

Send immediately clears the submitted text/images, before image preparation or Pi
acknowledgement finishes. No submission recovery copy is saved. Failed or uncertain
sends show an error; type or paste a new message if needed. Receipts never change
text/images added afterward. Uncertainty does not add a recovery action or block a
new submission once the session is connected and available.
Saved-session image drafts are stored locally, separate from Pi history. Temporary
session images stay in memory and are lost when that session closes or the app
reloads/quits. If an image cannot be read when Send is attempted, nothing is sent:
the attempted message is discarded and the error is shown.

There is no separate image-send recovery section or Restore images action. Images
in accepted user turns belong to their harness's conversation history. A later model/provider
failure does not turn an accepted message into a failed send.

Pi Stop's existing queue restoration returns text only. It does not reconstruct image
attachments; paste an image again if you decide to send it in a new message. Empty
image-only queue text does not create a blank Restore row.

## Limits and platform status

- PNG, JPEG, WebP and GIF; no SVG or arbitrary clipboard HTML images.
- Up to 8 images, 4 MiB each, 8 MiB total per message, 32 megapixels per pasted image.
- Local image draft storage is bounded to 128 MiB. Unreferenced persistent images
  older than 24 hours are cleaned when another image is saved; temporary storage
  is released when its session closes.
- The harness remains responsible for model/provider image support and normalization.
  Copilot's advertised model formats/count/size limits can narrow these bounds;
  explicitly non-vision models cannot send images. Missing model metadata leaves
  final acceptance to Copilot. A model change never silently drops draft images.
- Paste events are the shared path. A native clipboard fallback reads screenshots
  and other OS image representations when the paste event exposes no image/text.
  Finder/file-manager copied files and HTML-only clipboard images are not imported.
- Copilot SDK delivery and restored image-byte handling have offline fixtures,
  but those new fixtures have not been run. Installed-CLI/model acceptance and
  actual-app behavior remain unverified.
- Native macOS screenshot/image paste and Linux desktop/Wayland clipboard acceptance
  still require manual verification. Native clipboard support varies by desktop. No file picker or drag-and-drop is included yet.
