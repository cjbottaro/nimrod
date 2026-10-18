import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PIXEL_TILES, pixelGrid, pixelClip, pixelFrames } from '../src/modal-pixels';

test('pixel grids cover the box with bounded deterministic shuffled cells', () => {
  for (const [width, height] of [[620, 240], [300, 80], [620, 900], [10000, 10]]) {
    const grid = pixelGrid(width, height);
    assert.ok(grid.tiles.length > 0 && grid.tiles.length <= MAX_PIXEL_TILES);
    assert.deepEqual(grid, pixelGrid(width, height));
    const area = grid.tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0);
    assert.ok(Math.abs(area - width * height) < .001);
    assert.equal(Math.min(...grid.tiles.map(tile => tile.delay)), 0);
    if (grid.tiles.length > 1) assert.equal(Math.max(...grid.tiles.map(tile => tile.delay)), .65);
  }
});

test('all keyframes preserve path topology for native interpolation and partial reversal', () => {
  const grid = pixelGrid(620, 240), frames = pixelFrames(grid);
  assert.equal(frames.length, 13);
  const paths = frames.map(frame => String(frame.clipPath));
  for (const path of paths) {
    assert.equal((path.match(/M/g) ?? []).length, grid.tiles.length);
    assert.equal((path.match(/L/g) ?? []).length, grid.tiles.length * 3);
    assert.equal((path.match(/Z/g) ?? []).length, grid.tiles.length);
    assert.doesNotMatch(path, /NaN|Infinity/);
  }
  assert.notEqual(paths[0], paths[6]); assert.notEqual(paths[6], paths[12]);
  assert.equal(pixelFrames(grid, .5).at(-1)!.clipPath, pixelClip(grid, .5));
  assert.equal(pixelClip(grid, -1), pixelClip(grid, 0));
  assert.equal(pixelClip(grid, 2), pixelClip(grid, 1));
  assert.equal(pixelClip(pixelGrid(0, 10), .5), 'none');
});
