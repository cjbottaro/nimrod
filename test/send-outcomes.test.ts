import assert from 'node:assert/strict';
import test from 'node:test';
import { clearDraft, initialComposerState, recoverClearedQueue, updateDraft } from '../src/pi/composer-state';
import { persistWebviewState, restoreComposerState } from '../src/pi/webview-state';
import { referencedAttachments, type ImageAttachment } from '../src/pi/image-attachments';

const image = (id: string): ImageAttachment => ({ id, name: 'Photo.png', mimeType: 'image/png', size: 3 });

test('sending clears text/images without recording a submission or changing captured payload references', () => {
  const draft = { ...initialComposerState('caption'), attachments: [image('old')] };
  const captured = { text: draft.draft, attachments: draft.attachments };
  const cleared = clearDraft(draft);
  assert.equal(cleared.draft, '');
  assert.deepEqual(cleared.attachments, []);
  assert.deepEqual(captured, { text: 'caption', attachments: [image('old')] });
  const saved = persistWebviewState({}, cleared);
  assert.equal(Object.hasOwn(saved, 'submission'), false);
  assert.deepEqual([...referencedAttachments(saved)], []);
});

test('reload restores only the new editable draft, never a send operation', () => {
  const cleared = clearDraft(initialComposerState('original'));
  for (const draft of ['', 'newer']) {
    const restored = restoreComposerState(persistWebviewState({}, updateDraft(cleared, draft)));
    assert.equal(restored.draft, draft);
    assert.equal(Object.hasOwn(restored, 'submission'), false);
  }
});

test('old submission/image/unsent backups are ignored and stripped on the next draft write', () => {
  const old = { restore: { path: '/fixture' }, imageRecovery: [{ id: 'accepted', text: 'sent', attachments: [image('accepted')] }], recovered: [
    { id: 'unsent', text: 'failed', kind: 'unsent', attachments: [image('failed')] },
    { id: 'queue', text: 'cleared queue text', kind: 'steering', attachments: [image('old-queue-copy')] },
    { id: 'empty', text: '', kind: 'followUp' },
  ], draft: 'new draft', attachments: [image('current')], submission: { id: 'uncertain', text: 'maybe sent', mode: 'normal', status: 'unknown', attachments: [image('uncertain')] } };
  const restored = restoreComposerState(old);
  assert.deepEqual(restored.recovered, [{ id: 'queue', text: 'cleared queue text', kind: 'steering' }]);
  assert.equal(Object.hasOwn(restored, 'submission'), false);
  const saved = persistWebviewState(old, restored);
  assert.equal(Object.hasOwn(saved, 'imageRecovery'), false);
  assert.equal(Object.hasOwn(saved, 'submission'), false);
  assert.deepEqual(saved.restore, old.restore);
  assert.deepEqual([...referencedAttachments(saved)], ['current']);
});

test('clear_queue keeps authoritative nonempty text only, never a blank image restoration row', () => {
  const state = recoverClearedQueue(initialComposerState(), ['', '  ', ' exact text '], ['', 'follow-up']);
  assert.deepEqual(state.recovered.map(item => item.text), [' exact text ', 'follow-up']);
});
