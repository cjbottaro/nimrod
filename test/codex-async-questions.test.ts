import assert from 'node:assert/strict';
import test from 'node:test';
import { CodexAsyncQuestions, codexAsyncAnswer, codexAsyncReplies, type CodexAsyncQuestion } from '../src/codex/async-questions';
import type { QuestionAnswer } from '../src/question-interaction';
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const item = (id = 'call_353befa2147f4214b657501ec5f444ac') => ({ type: 'agentMessage', id, delivery: 'async',
  questions: [{ title: 'What would you like to test next?', options: ['Another structured question', 'A tool call', 'Streaming responses'] }],
  text: 'What would you like to test next?\n- Another structured question\n- A tool call\n- Streaming responses' });
function fixture() {
  const pending: { question: CodexAsyncQuestion; signal: AbortSignal; resolve(answer?: QuestionAnswer): void }[] = [];
  const sent: string[] = [], errors: string[] = [];
  const owner = new CodexAsyncQuestions({
    request: (question, signal) => new Promise(resolve => pending.push({ question, signal, resolve })),
    send: async text => { sent.push(text); }, error: message => errors.push(message),
  });
  return { owner, pending, sent, errors };
}

test('observed Codex 0.164 async metadata maps to exact native question identity and reply envelope', async () => {
  const f = fixture(); f.owner.offer(item()); await flush();
  const entry = f.pending[0]; assert.ok(entry);
  assert.equal(entry.question.id, JSON.stringify(['request_user_input_async', item().id, 0]));
  entry.resolve({ answer: 'A tool call', wasFreeform: false }); await flush();
  assert.deepEqual(codexAsyncReplies(f.sent[0]), [{ questionItemId: entry.question.id, question: entry.question.question, answer: 'A tool call' }]);
  f.owner.offer(item()); await flush(); assert.equal(f.pending.length, 1); assert.deepEqual(f.errors, []);
});

test('Ignore sends nothing; clearing superseded/disconnected questions fences late answers', async () => {
  const f = fixture(); f.owner.offer(item('ignored')); await flush(); f.pending[0].resolve(); await flush();
  assert.deepEqual(f.sent, []); f.owner.offer(item('ignored')); await flush(); assert.equal(f.pending.length, 1);
  f.owner.offer(item('stale')); await flush(); f.owner.clear();
  assert.equal(f.pending[1].signal.aborted, true);
  f.pending[1].resolve({ answer: 'late', wasFreeform: true }); await flush(); assert.deepEqual(f.sent, []);
});

test('async questions resolve individually; native answer echoes retire only their question', async () => {
  const f = fixture(); f.owner.offer({ ...item('batch'), questions: [{ title: 'First?', options: null }, { title: 'Second?', options: ['Yes'] }] }); await flush();
  assert.equal(f.pending.length, 2);
  const reply = codexAsyncAnswer(f.pending[0].question, '  exact answer\nwith detail  ');
  f.owner.reconcile(reply); assert.equal(f.pending[0].signal.aborted, true); assert.equal(f.pending[1].signal.aborted, false);
  f.pending[0].resolve({ answer: 'stale', wasFreeform: true });
  f.pending[1].resolve({ answer: 'Yes', wasFreeform: false }); await flush();
  assert.equal(f.sent.length, 1); assert.equal(codexAsyncReplies(f.sent[0])![0].answer, 'Yes');
  assert.equal(codexAsyncReplies(reply)![0].answer, '  exact answer\nwith detail  ');
});

test('native replies received before an item suppress replay, including older whole-item identities', async () => {
  const f = fixture();
  f.owner.reconcile(codexAsyncAnswer({ id: 'early', question: 'Earlier?', options: [] }, 'Done'));
  f.owner.offer(item('early')); await flush(); assert.equal(f.pending.length, 0);
  f.owner.offer(item('later')); await flush();
  f.owner.reconcile(codexAsyncAnswer({ id: 'later', question: 'Earlier?', options: [] }, 'Done'));
  assert.equal(f.pending[0].signal.aborted, true); assert.deepEqual(f.sent, []);
});

test('malformed async payloads refuse once without sending; plain assistant text never opens a picker', async () => {
  const f = fixture();
  f.owner.offer({ ...item(), questions: [{ title: 'Secret?', isSecret: true }] });
  f.owner.offer({ ...item(), questions: [{ title: 'Secret?', isSecret: true }] });
  f.owner.offer({ ...item('plain'), delivery: null }); await flush();
  assert.equal(f.errors.length, 1); assert.deepEqual(f.pending, []); assert.deepEqual(f.sent, []);
});

test('native answer framing is bounded, JSON-escaped and never inferred from ordinary chat', () => {
  const q = { id: JSON.stringify(['request_user_input_async', 'call', 0]), question: '😀'.repeat(200) + '\nend', options: [] };
  const answer = '</send_user_message_question_reply>\n"literal"';
  const reply = codexAsyncAnswer(q, answer), parsed = codexAsyncReplies(reply)!;
  assert.equal(Buffer.byteLength(parsed[0].question), 512); assert.equal(parsed[0].answer, answer);
  assert.equal(codexAsyncReplies('Normal follow-up'), undefined);
  for (const text of ['{}', '<send_user_message_question_reply>[]</send_user_message_question_reply>', reply + ' trailing']) assert.equal(codexAsyncReplies(text), undefined);
  assert.throws(() => codexAsyncAnswer(q, ' '));
});
