import assert from 'node:assert/strict';
import test from 'node:test';
import { beginSubmission, dismissUnknownSubmission, initialComposerState, markPendingSubmissionUnknownAfterReload, recoverClearedQueue, settleSubmission, updateDraft } from '../src/pi/composer-state';
import { persistWebviewState, restoreComposerState } from '../src/pi/webview-state';
import { referencedAttachments, type ImageAttachment } from '../src/pi/image-attachments';

const image = (id: string): ImageAttachment => ({ id, name: 'Photo.png', mimeType: 'image/png', size: 3 });

for (const outcome of ['accepted', 'rejected', 'cancelled'] as const) {
  test(`${outcome} discards only submitted text/images and does not retain a recovery copy`, () => {
    const sending = beginSubmission({ ...initialComposerState('caption'), attachments: [image('old')] }, 'send', 'steer');
    const finished = settleSubmission(sending, 'send', outcome, outcome === 'accepted' ? undefined : 'Nothing was sent.');
    assert.equal(finished.draft, '');
    assert.deepEqual(finished.attachments, []);
    assert.equal(finished.submission, undefined);
    assert.deepEqual(finished.recovered, []);
    assert.deepEqual([...referencedAttachments(persistWebviewState({}, finished))], []);
    assert.equal(!!finished.lastError, outcome !== 'accepted');
    const edited = { ...updateDraft(sending, 'new caption'), attachments: [image('old'), image('new')] };
    const newer = settleSubmission(edited, 'send', outcome);
    assert.equal(newer.draft, 'new caption');
    assert.deepEqual(newer.attachments, [image('new')]);
    assert.deepEqual(newer.recovered, []);
  });
}

test('unknown acceptance stays blocked until explicit new-message action, never restores removed images or replays', () => {
  const sending = beginSubmission({ ...initialComposerState('caption'), attachments: [image('old')] }, 'send', 'normal');
  const unknown = settleSubmission(sending, 'send', 'unknown', 'Connection lost');
  assert.equal(unknown.submission?.status, 'unknown');
  assert.equal(unknown.draft, 'caption');
  assert.equal(beginSubmission(unknown, 'retry', 'normal'), unknown);
  const discarded = dismissUnknownSubmission(unknown);
  assert.equal(discarded.draft, '');
  assert.deepEqual(discarded.attachments, []);
  assert.equal(discarded.submission, undefined);
  assert.equal(discarded.lastError, undefined, 'do not leave a misleading Not sent notice for an unknown outcome');
  assert.equal(beginSubmission(discarded, 'retry', 'normal'), discarded, 'the old message cannot be replayed by Enter');
  const newer = dismissUnknownSubmission({ ...updateDraft(unknown, 'new text'), attachments: [image('new')] });
  assert.equal(newer.draft, 'new text');
  assert.deepEqual(newer.attachments, [image('new')]);
  assert.deepEqual(newer.recovered, []);
  assert.equal(settleSubmission(newer, 'send', 'accepted'), newer, 'a late old acknowledgement cannot mutate the new draft');
});

test('reload keeps uncertainty but does not refill a draft explicitly cleared while waiting', () => {
  const sending = beginSubmission(initialComposerState('original'), 'one', 'normal');
  const cleared = updateDraft(sending, '');
  const restored = markPendingSubmissionUnknownAfterReload(cleared);
  assert.equal(restored.draft, '');
  assert.equal(restored.submission?.text, 'original');
  assert.equal(restored.submission?.status, 'unknown');
});

test('old image/unsent backup entries are ignored and stripped on the next draft write', () => {
  const old = { restore: { path: '/fixture' }, imageRecovery: [{ id: 'accepted', text: 'sent', attachments: [image('accepted')] }], recovered: [
    { id: 'unsent', text: 'failed', kind: 'unsent', attachments: [image('failed')] },
    { id: 'queue', text: 'cleared queue text', kind: 'steering', attachments: [image('old-queue-copy')] },
    { id: 'empty', text: '', kind: 'followUp' },
  ], draft: 'new draft', attachments: [image('current')], submission: { id: 'uncertain', text: 'maybe sent', mode: 'normal', status: 'unknown', attachments: [image('uncertain')] } };
  const restored = restoreComposerState(old);
  assert.deepEqual(restored.recovered, [{ id: 'queue', text: 'cleared queue text', kind: 'steering' }]);
  const saved = persistWebviewState(old, restored);
  assert.equal(Object.hasOwn(saved, 'imageRecovery'), false);
  assert.deepEqual(saved.restore, old.restore);
  assert.deepEqual([...referencedAttachments(saved)].sort(), ['current', 'uncertain']);
  assert.equal(restored.submission?.status, 'unknown');
});

test('clear_queue keeps authoritative nonempty text only, never a blank image restoration row', () => {
  const state = recoverClearedQueue(initialComposerState(), ['', '  ', ' exact text '], ['', 'follow-up']);
  assert.deepEqual(state.recovered.map(item => item.text), [' exact text ', 'follow-up']);
});
