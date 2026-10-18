import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_IMAGE_INPUT, validateImageSelection, validateMessageImages } from '../src/session-message-input';
import { copilotImageCapabilities, copilotUserContent } from '../src/copilot/image-input';

const image = { type: 'image' as const, mimeType: 'image/png', data: 'YWJj' };
test('shared input validates unsupported images, formats, count and exact decoded-byte limits', () => {
  assert.deepEqual(validateMessageImages(undefined, {}), []);
  assert.throws(() => validateMessageImages([image], {}), /not supported/);
  assert.deepEqual(validateMessageImages([image], { images: DEFAULT_IMAGE_INPUT }), [image]);
  for (const limits of [
    { maxImages: 0 }, { maxImageBytes: 2 }, { maxTotalBytes: 2 }, { mimeTypes: ['image/jpeg'] },
  ]) assert.throws(() => validateMessageImages([image], { images: { ...DEFAULT_IMAGE_INPUT, ...limits } }));
  for (const value of [null, {}, [null], [{ ...image, data: 'javascript:evil' }], Array(9).fill(image)])
    assert.throws(() => validateMessageImages(value, { images: DEFAULT_IMAGE_INPUT }));
  assert.throws(() => validateImageSelection([{ mimeType: 'image/png', size: 4 * 1024 * 1024 + 1 }], { images: { ...DEFAULT_IMAGE_INPUT, maxImageBytes: Infinity } }), /size limit/);
});

test('Copilot honors explicit vision capabilities and intersects catalog limits with shared bounds', () => {
  assert.equal(copilotImageCapabilities().images?.maxImages, 8, 'missing metadata defers model acceptance to the SDK');
  assert.equal(copilotImageCapabilities({ capabilities: { supports: { vision: false } } }).images, undefined);
  const caps = copilotImageCapabilities({ capabilities: { supports: { vision: true }, limits: { vision: {
    supported_media_types: ['image/png', 'image/svg+xml'], max_prompt_images: 2, max_prompt_image_size: 1024,
  } } } });
  assert.deepEqual(caps.images, { ...DEFAULT_IMAGE_INPUT, mimeTypes: ['image/png'], maxImages: 2, maxImageBytes: 1024 });
  assert.throws(() => validateMessageImages(Array(3).fill(image), caps), /at most 2/);
  assert.equal(copilotImageCapabilities({ capabilities: { limits: { vision: { max_prompt_images: 0 } } } }).images, undefined);
  assert.equal(copilotImageCapabilities({ capabilities: { limits: { vision: { supported_media_types: [] } } } }).images, undefined);
});

test('SDK blobs project to images for captions/image-only history; omissions and unsupported assets remain explicit', () => {
  const blob = { ...image, type: 'blob' };
  assert.deepEqual(copilotUserContent('Caption', [blob]), [{ type: 'text', text: 'Caption' }, image]);
  assert.deepEqual(copilotUserContent('', [blob]), [{ type: 'text', text: '' }, image]);
  const unsupported = [{ type: 'file', path: '/do-not-read.png' }, { type: 'blob', mimeType: 'image/png', assetId: 'sha256:missing' }, { ...blob, omittedReason: 'unsupported' }, { ...blob, data: '<invalid>' }];
  const projected = copilotUserContent('', unsupported);
  assert.ok(Array.isArray(projected));
  assert.equal(projected.length, 5);
  assert.ok(projected.slice(1).every(block => block.type === 'raw'));
  assert.match(String(projected[2].text), /Image unavailable/);
  assert.match(String(projected[3].text), /unsupported/);
  assert.doesNotMatch(String(projected[4].text), /<invalid>/);
  assert.equal(blob.type, 'blob', 'presentation does not mutate authoritative attachment records');
});
