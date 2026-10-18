import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { updateRangeFill } from '../src/range-input';

test('range fill is initialized from current bounds/value without editing or dispatching events', () => {
  const dom = new JSDOM('<input type="range" min="100" max="1500" step="10" value="500">');
  try {
    const input = dom.window.document.querySelector('input')!;
    let events = 0;
    input.addEventListener('input', () => events++); input.addEventListener('change', () => events++);
    updateRangeFill(input);
    assert.equal(input.style.getPropertyValue('--range-fill'), '28.5714%');
    assert.equal(input.value, '500'); assert.equal(events, 0);
    input.value = '1500'; updateRangeFill(input);
    assert.equal(input.style.getPropertyValue('--range-fill'), '100%');
    input.value = '100'; updateRangeFill(input);
    assert.equal(input.style.getPropertyValue('--range-fill'), '0%');
    input.min = '0'; input.max = '40'; input.step = '1'; input.value = '20'; updateRangeFill(input);
    assert.equal(input.style.getPropertyValue('--range-fill'), '50%');
    input.removeAttribute('min'); input.removeAttribute('max'); input.value = '65'; updateRangeFill(input);
    assert.equal(input.style.getPropertyValue('--range-fill'), '65%');
    input.min = input.max = '10'; updateRangeFill(input);
    assert.equal(input.style.getPropertyValue('--range-fill'), '0%');
    assert.equal(events, 0);
  } finally { dom.window.close(); }
});
