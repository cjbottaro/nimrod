# Pi Web Access empty-region investigation

**Historical investigation; superseded by the containing-block fix.** Current specification/evidence: [external plugin](../pi-web-access-plugin.md).

The user observed an empty transcript viewport during live web calls. Upward scrolling recovered the text, adding an assistant message restored the normal tail, and restarting the app did not resolve it. Compact plain-text progress was tried first; it did not fix the symptom.

A temporary external-plugin `pi-web-layout-v1` probe recorded geometry only (no conversation text, URLs, arguments or identities). It located the session lazily because renderer mount starts detached. Its bounded render/scroll/toggle/resize samples were copied after completion; the probe was removed once the cause was identified.

Key native samples:

- Normal open progress: app layout/scroll height about 32,984px, viewport height 639px, scrollTop 32,345px.
- Result insertion: app layout height 33,594px but app/viewport scrollHeight 40,211px; card layout height 745px but scrollHeight 7,398px.
- Follow targeted 39,572px, moving the actual app bottom to -5,929px. The empty region was about 6,617px of escaped descendant overflow—not an oversized in-flow card or stale TS source.
- Collapsing the card/new text removed the escaped overflow and restored ordinary geometry.

An offline WebKit fixture with 16 long fenced code blocks reproduced the failure: transcript scrollHeight 6,292px versus layout height 1,060px, with every invisible `.code-copy-status` positioned relative to `.tool-card`. The scrollport was not a positioned containing block, so those absolutely positioned accessibility elements escaped the inner overflow clip and extended ancestor scroll ranges.

Setting the external plugin result scrollport to `position: relative` kept those elements inside its clipping boundary: both heights were 1,060px and the latest message remained in view while Pi was still busy. The global transcript follow algorithm/disclosure scheduler was not changed. Native confirmation after reloading the fixed source remains separate from this fixture proof.
