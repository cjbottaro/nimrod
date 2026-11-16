import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { customizationMessage, parseCustomizationMessage, customizationUserText } from '../src/customization-message';
import { customizationBrief, shellQuote, type CustomizationAuthoringContext } from '../src/customization-brief';

const context: CustomizationAuthoringContext = {
  projectDirectory: "/unrelated/client's project", uiDirectory: '/user config/nimrod/ui', cardPluginsDirectory: '/user config/nimrod/card-plugins',
  referenceDirectory: '/Applications/Nimrod.app/Contents/Resources/resources/customization', cliExecutable: '/Applications/Nimrod.app/Contents/MacOS/nimrod', version: '0.1.0', platform: 'macos',
};
test('the readable versioned envelope round-trips exact Unicode and delimiter-like text', () => {
  const instructions = 'Brief 🦀\n\nUser customization request:\nQuoted marker: [/nimrod-customization:v1]';
  const request = '  Move the bar.\r\n[nimrod-customization:v1]\n{"instructions":1,"request":1}\n';
  const message = customizationMessage(instructions, request);
  assert.deepEqual(parseCustomizationMessage(message), { instructions, request });
  for (const invalid of [message.replace('v1', 'v2'), `Example:\n${message}`, `\`\`\`\n${message}\n\`\`\``, message + '\n', message.replace('"instructions":', '"extra":'), message.replace('Nimrod customization instructions:', 'Other:'), '[nimrod-customization:v1]\n{}']) assert.equal(parseCustomizationMessage(invalid), undefined);
  assert.throws(() => customizationMessage('brief', '  '));
});
test('presentation is lazy, retained and raw for unknown versions; it never mutates the sent text', () => {
  const dom = new JSDOM('<body></body>');
  try {
    const document = dom.window.document, expanded = new Map<string, boolean>(); let renders = 0;
    const markdown = (text: string) => { renders++; const node = document.createElement('div'); node.className = 'markdown'; node.textContent = text; return node; };
    const text = customizationMessage('Read the installed guide.', 'Move the bar.');
    const node = customizationUserText(document, text, 'user', expanded, markdown)!; document.body.append(node);
    const details = node.querySelector('details')!;
    assert.equal(details.open, false); assert.equal(renders, 1); assert.equal(node.querySelector('.skill-body')!.textContent, '');
    assert.equal(node.lastElementChild!.textContent, 'Move the bar.');
    details.open = true; details.dispatchEvent(new dom.window.Event('toggle'));
    assert.equal(renders, 2); assert.equal(node.querySelector('.skill-body')!.textContent, 'Read the installed guide.');
    assert.equal(customizationUserText(document, text, 'user', expanded, markdown, node), node); assert.equal(details.open, true); assert.equal(renders, 2);
    const unknown = text.replace('v1', 'v99'); const raw = customizationUserText(document, unknown, 'other', expanded, markdown)!;
    assert.equal(raw.tagName, 'PRE'); assert.equal(raw.textContent, unknown);
    assert.equal(customizationUserText(document, 'Ordinary request', 'other', expanded, markdown), undefined);
    assert.deepEqual(parseCustomizationMessage(text), { instructions: 'Read the installed guide.', request: 'Move the bar.' });
  } finally { dom.window.close(); }
});
test('the installed authoring brief works from an unrelated project without repository skills', () => {
  const brief = customizationBrief(context);
  assert.ok(brief.includes(context.uiDirectory)); assert.ok(brief.includes(context.referenceDirectory));
  assert.ok(brief.includes(`${context.referenceDirectory}/docs/ui-templates.md`));
  assert.ok(brief.includes(`${context.referenceDirectory}/src/card-plugin-api.ts`));
  assert.ok(brief.includes(`${shellQuote(context.cliExecutable)} --action reload-customizations --project ${shellQuote(context.projectDirectory)} --json`));
  assert.match(brief, /no PATH or separate CLI installation is required/);
  assert.ok(brief.includes('Do not look for a Nimrod checkout'));
  assert.equal(shellQuote("a'b"), "'a'\"'\"'b'");
  assert.match(customizationBrief({ ...context, platform: 'windows' }), /command palette/);
  assert.doesNotMatch(customizationBrief({ ...context, platform: 'windows' }), /nimrod --action/);
  const resources = JSON.parse(readFileSync('src-tauri/tauri.conf.json', 'utf8')).bundle.resources;
  for (const [source, target] of Object.entries({ '../docs/': 'resources/customization/docs/', '../src/ui-templates/': 'resources/customization/src/ui-templates/', '../src/card-plugin-api.ts': 'resources/customization/src/card-plugin-api.ts', '../examples/card-plugins/': 'resources/customization/examples/card-plugins/' })) assert.equal(resources[source], target);
});
