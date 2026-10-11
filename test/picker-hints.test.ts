import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { createPickerEnterHint } from '../src/picker-hints';

test('picker Enter hints use the owning document and stay decorative, not buttons', () => {
  const windows = [new JSDOM(), new JSDOM()];
  try {
    for (const { window } of windows) {
      const first = createPickerEnterHint(window.document), second = createPickerEnterHint(window.document);
      assert.equal(first.ownerDocument, window.document);
      assert.equal(first.namespaceURI, 'http://www.w3.org/2000/svg');
      assert.equal(first.className.baseVal, 'picker-enter-hint');
      assert.equal(first.getAttribute('aria-hidden'), 'true');
      assert.equal(first.getAttribute('focusable'), 'false');
      assert.equal(first.hasAttribute('tabindex'), false);
      assert.equal(first.hasAttribute('role'), false);
      assert.equal(first.getAttribute('stroke'), 'currentColor');
      assert.equal(first.querySelectorAll('path').length, 1);
      assert.equal(first.outerHTML, second.outerHTML);
      assert.notEqual(first, second, 'each picker row gets its own SVG node');
    }
  } finally { for (const { window } of windows) window.close(); }
});
