import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { parseCopilotSkillInvocation } from '../src/copilot/skill-invocation';
import { renderSkillInvocation, skillUserText } from '../src/skill-invocation';

const preamble = 'The user explicitly invoked the "/review-pr" skill. Follow its instructions now.';
const body = `${preamble}\n\nBase directory for this skill: /fixture/.agents/skills/review-pr\n\nRelated files (use view tool to read):\n\n- /fixture/.agents/skills/review-pr/references/review.md\n\n# Review instructions\n\nReview every changed file.`;
const args = 'https://github.com/fixture/project/pull/42\nCheck the **diff**.  ';

test('Copilot recognizes only explicit expanded slash-skill prompts and separates trailing arguments', () => {
  assert.deepEqual(parseCopilotSkillInvocation(`${body}\n\nARGUMENTS: ${args}`), {
    label: '/review-pr', content: body, userMessage: args,
  });
  assert.deepEqual(parseCopilotSkillInvocation(body), { label: '/review-pr', content: body, userMessage: undefined });
  const context = body.slice(preamble.length + 2);
  const wrapped = `${preamble}\n\n<skill-context name="review-pr">\n${context}\n\nARGUMENTS: ${args}\n</skill-context>`;
  assert.deepEqual(parseCopilotSkillInvocation(wrapped), { label: '/review-pr', content: body, userMessage: args });
  assert.equal(parseCopilotSkillInvocation(wrapped.replace('name="review-pr"', 'name="other"')), undefined);
  assert.equal(parseCopilotSkillInvocation(wrapped.replace('</skill-context>', '')), undefined);
  for (const text of ['/review-pr args', `Example:\n${body}`, `\`\`\`\n${body}\n\`\`\``,
    body.replace('Base directory for this skill:', 'Directory:'), body.replace(preamble, 'Use the review-pr skill.')]) {
    assert.equal(parseCopilotSkillInvocation(text), undefined);
  }
  const withExample = `${body}\n\nARGUMENTS: an example in the instructions\n\nContinue reviewing.`;
  assert.equal(parseCopilotSkillInvocation(`${withExample}\n\nARGUMENTS: ${args}`)?.content, withExample);
});

test('shared skill renderer is lazy, retains unchanged DOM, remembers disclosure and omits empty arguments', () => {
  const dom = new JSDOM('<main></main>');
  try {
    const document = dom.window.document, expanded = new Map<string, boolean>(), calls: string[] = [];
    const markdown = (text: string) => { calls.push(text); const node = document.createElement('div'); node.textContent = text; return node; };
    const skill = parseCopilotSkillInvocation(`${body}\n\nARGUMENTS: ${args}`)!;
    const node = renderSkillInvocation(document, skill, 'skill', expanded, markdown);
    document.querySelector('main')!.append(node);
    const details = node.querySelector('details')!;
    assert.equal(details.open, false);
    assert.deepEqual(calls, [args]);
    details.open = true; details.dispatchEvent(new dom.window.Event('toggle'));
    assert.deepEqual(calls, [args, body]);
    assert.equal(renderSkillInvocation(document, { ...skill }, 'skill', expanded, markdown, node), node);
    assert.deepEqual(calls, [args, body], 'routine updates never reparse skill Markdown');
    details.open = false; details.dispatchEvent(new dom.window.Event('toggle'));
    assert.equal(expanded.get('skill'), false);
    const only = renderSkillInvocation(document, parseCopilotSkillInvocation(body)!, 'only', expanded, markdown);
    assert.equal(only.children.length, 1);
    assert.equal(only.querySelector('.skill-body')!.childNodes.length, 0);
    let parses = 0;
    const renderText = skillUserText(text => { parses++; return parseCopilotSkillInvocation(text); });
    const cached = renderText(document, body, 'cached', expanded, markdown);
    assert.equal(renderText(document, body, 'cached', expanded, markdown, cached), cached);
    assert.equal(parses, 1, 'unchanged skill updates skip the harness parser too');
  } finally { dom.window.close(); }
});
