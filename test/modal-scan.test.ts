import assert from 'node:assert/strict';
import test from 'node:test';
import { initialScanEdges, planScan, sampleScan, scanOffsets, scanClip, edgesFromClip } from '../src/modal-scan';

test('scan time follows actual travel distance, not a reference modal or duration cap', () => {
  for (const [style, speed] of [['crt', 500], ['hologram', 1000]] as const) {
    const small = { top: 40, bottom: 340 }, large = { top: 40, bottom: 640 };
    const a = planScan(style, small, initialScanEdges(style, small), speed);
    const b = planScan(style, large, initialScanEdges(style, large), speed);
    assert.equal(a.duration, 300); assert.equal(b.duration, 600);
    const close = planScan(style, small, small, speed * 1.25, true);
    assert.equal(close.duration, 240);
    assert.deepEqual(sampleScan(a, 10000), small);
  }
  const huge = { top: 0, bottom: 1200 };
  assert.equal(planScan('hologram', huge, initialScanEdges('hologram', huge), 100).duration, 12000);
});

test('Hologram retargets smaller/larger bounds without jumping or changing pixel velocity', () => {
  const original = { top: 0, bottom: 600 };
  const plan = planScan('hologram', original, initialScanEdges('hologram', original), 1000);
  const position = sampleScan(plan, 100);
  assert.equal(position.bottom, 100);
  for (const bottom of [200, 800]) {
    const next = planScan('hologram', { top: 0, bottom }, position, 1000);
    assert.deepEqual(sampleScan(next, 0), position);
    assert.equal(sampleScan(next, 50).bottom, 150);
    assert.equal(next.duration, bottom - 100);
  }
  assert.equal(planScan('hologram', { top: 0, bottom: 80 }, position, 1000).duration, 0);
});

test('CRT preserves independent outward edges, stopping one without slowing the other', () => {
  const bounds = { top: 0, bottom: 220 };
  const next = planScan('crt', bounds, { top: 100, bottom: 200 }, 500);
  assert.equal(next.duration, 200); assert.deepEqual(scanOffsets(next), [0, .2, 1]);
  assert.deepEqual(sampleScan(next, 0), { top: 100, bottom: 200 });
  assert.deepEqual(sampleScan(next, 50), { top: 75, bottom: 220 });
  assert.equal(scanClip(bounds, sampleScan(next, 50)), 'inset(75px 0px 0px 0px)');
  assert.equal(planScan('crt', { top: 0, bottom: 80 }, { top: 100, bottom: 200 }, 500).duration, 0);
});

test('partly revealed closing starts at the current edges and collapses inward', () => {
  const bounds = { top: 0, bottom: 300 };
  assert.deepEqual(edgesFromClip('hologram', bounds, 'inset(0px 0px 200px 0px)'), { top: 0, bottom: 100 });
  assert.equal(planScan('hologram', bounds, { top: 0, bottom: 100 }, 1250, true).duration, 80);
  const close = planScan('crt', { top: 0, bottom: 100 }, { top: 20, bottom: 80 }, 625, true);
  assert.deepEqual(close.to, { top: 50, bottom: 50 });
  assert.deepEqual(sampleScan(close, 16), { top: 30, bottom: 70 });
  assert.deepEqual(edgesFromClip('crt', bounds, 'inset(25% 0px 25% 0px)'), { top: 75, bottom: 225 });
});
