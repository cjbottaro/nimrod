import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderOperationCard, type OperationCard } from '../src/operation-card';

for (const title of ['Configuration change', 'Steering', 'Queued']) {
  test(`${title} retains title/content and disclosure across success, failure and uncertainty`, () => {
    const dom = new JSDOM('<article><div class="content">Original intent</div></article>');
    try {
      const node = dom.window.document.querySelector('article')!;
      const content = node.querySelector('.content');
      const update = (state: OperationCard['state'], details?: string) => renderOperationCard(node, { title, state, details }, () => assert.fail('no focused cancellation'));
      update('pending');
      const label = node.querySelector('.delivery-status-text');
      assert.equal(label?.textContent, title);
      assert.ok(label?.classList.contains('delivery-status-shimmer'));
      assert.equal(node.getAttribute('aria-label'), `${title}: Pending`);
      update('succeeded');
      assert.equal(node.querySelector('.delivery-status-text'), label);
      assert.equal(label?.classList.contains('delivery-status-shimmer'), false);
      assert.equal(node.querySelector('.operation-outcome'), null);
      update('failed', '<literal error>\nFull diagnostic details');
      assert.equal(node.dataset.operationState, 'failed');
      assert.equal(node.querySelector('.operation-outcome')?.textContent, 'Failed');
      const details = node.querySelector('details')!;
      assert.equal(details.open, false);
      assert.equal(details.querySelector('summary')?.textContent, 'Error details');
      assert.equal(details.querySelector('pre')?.textContent, '<literal error>\nFull diagnostic details');
      details.open = true;
      update('failed', 'Updated diagnostics');
      assert.equal(node.querySelector('details'), details); assert.equal(details.open, true);
      update('unknown', 'Connection lost');
      assert.equal(node.dataset.operationState, 'unknown');
      assert.equal(node.querySelector('.operation-outcome')?.textContent, 'Outcome unknown');
      assert.equal(details.querySelector('summary')?.textContent, 'Details');
      update('not-applied');
      assert.equal(node.querySelector('.operation-outcome')?.textContent, 'Not applied');
      assert.equal(node.querySelector('details'), null);
      assert.equal(node.querySelector('.content'), content);
      assert.equal(node.querySelector('.delivery-status-text'), label);
    } finally { dom.window.close(); }
  });
}

test('cancellation is capability-bound and only restores focus when its control disappears', () => {
  const dom = new JSDOM('<article></article><textarea></textarea>');
  try {
    const document = dom.window.document, node = document.querySelector('article')!, prompt = document.querySelector('textarea')!;
    const pending: OperationCard = { title: 'Configuration change', state: 'pending', cancelId: 'configuration:one' };
    let restores = 0;
    const restore = () => { restores++; prompt.focus({ preventScroll: true }); };
    renderOperationCard(node, pending, restore);
    const cancel = node.querySelector('button')!; cancel.focus();
    assert.equal(cancel.dataset.cancelOperation, pending.cancelId);
    renderOperationCard(node, { ...pending, cancelId: undefined }, restore);
    assert.equal(node.querySelector('button'), null); assert.equal(document.activeElement, prompt); assert.equal(restores, 1);
    renderOperationCard(node, pending, restore);
    renderOperationCard(node, { ...pending, state: 'succeeded' }, restore);
    assert.equal(restores, 1, 'no focus movement if another control owns focus');
    assert.equal(node.querySelector('button'), null, 'terminal operations never offer cancellation');
  } finally { dom.window.close(); }
});
