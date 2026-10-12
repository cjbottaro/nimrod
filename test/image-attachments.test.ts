import assert from 'node:assert/strict';
import test from 'node:test';
import { attachmentArray, referencedAttachments, validateImageBlob, validateImageContents, validateAttachments, MAX_IMAGE_BYTES, type ImageAttachment } from '../src/pi/image-attachments';
import { clearDraft, initialComposerState } from '../src/pi/composer-state';
import { persistWebviewState, restoreComposerState } from '../src/pi/webview-state';
import { SteeringTranscript } from '../src/pi/steering-transcript';

const image = (id: string): ImageAttachment => ({ id, name: 'Screenshot.png', mimeType: 'image/png', size: 3 });
const wire = { type: 'image' as const, mimeType: 'image/png', data: 'YWJj' };

test('image validation bounds formats, encoding, count and total bytes', () => {
  assert.deepEqual(validateImageContents([wire]), [wire]);
  for (const invalid of [{ ...wire, mimeType: 'image/svg+xml' }, { ...wire, data: 'javascript:alert(1)' }, { ...wire, data: 'a' }, Array(9).fill(wire), { images: [wire] }]) assert.throws(() => validateImageContents(Array.isArray(invalid) ? invalid : [invalid]));
  assert.throws(() => validateImageBlob(new Blob(['svg'], { type: 'image/svg+xml' })));
  assert.throws(() => validateImageBlob(new Blob([new Uint8Array(MAX_IMAGE_BYTES + 1)], { type: 'image/png' })));
  assert.throws(() => validateAttachments(Array(3).fill({ ...image('large'), size: MAX_IMAGE_BYTES })));
  assert.deepEqual(attachmentArray([{ ...image('bad'), id: '../file' }]), []);
});

test('image-only sends clear editable attachments without changing a captured payload', () => {
  const original = { ...initialComposerState(), attachments: [image('a')] };
  const captured = original.attachments;
  const cleared = clearDraft(original);
  assert.deepEqual(cleared.attachments, []);
  assert.deepEqual(captured, [image('a')]);
  assert.deepEqual(cleared.recovered, []);
  assert.equal(Object.hasOwn(cleared, 'submission'), false);
});

test('reload never restores submitted images or an in-flight request', () => {
  const sending = clearDraft({ ...initialComposerState(), attachments: [image('a')] });
  const saved = persistWebviewState({ restore: { path: '/fixture' } }, sending);
  assert.equal(JSON.stringify(saved).includes(wire.data), false);
  const restored = restoreComposerState(JSON.parse(JSON.stringify(saved)));
  assert.equal(Object.hasOwn(restored, 'submission'), false);
  assert.deepEqual(restored.attachments, []);
  assert.deepEqual([...referencedAttachments(saved)], []);
});

test('image steering never reconciles against caption-only user messages or text-only recovery', () => {
  const projection = new SteeringTranscript();
  projection.begin('one', 'caption', 'sending', [wire]);
  projection.snapshot([{ key: 'text', role: 'user', content: 'caption' }]);
  projection.recover(['caption']);
  assert.equal(projection.project([]).length, 1);
  projection.snapshot([{ key: 'image', role: 'user', content: [{ type: 'text', text: 'caption' }, wire] }]);
  assert.equal(projection.project([]).length, 0);
  assert.equal(projection.project([{ key: 'image', role: 'user' }])[0].key, 'steering:one');
});
