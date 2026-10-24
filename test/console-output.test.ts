import '../src/bundled-card-renderers';
import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { renderConsoleOutput } from '../src/pi/console-output';
import { renderToolCard, updateToolCard } from '../src/pi/tool-card';
import { defaultToolRenderer } from '../src/pi/card-plugins/tool';
import { bashPresentation } from '../src/pi/card-plugins/bash';
import { validatePresentation } from '../src/pi/card-renderer';

function fixture(run: (doc: Document, output: HTMLElement) => void): void {
  const dom = new JSDOM('<body><pre></pre></body>');
  try { run(dom.window.document, dom.window.document.querySelector('pre')!); }
  finally { dom.window.close(); }
}

test('console output renders SGR styles/reset and literal HTML without parsing markup', () => fixture((_doc, output) => {
  renderConsoleOutput(output, '\x1b[1;3;4;9;32m.<img src=x>\x1b[0m normal');
  assert.equal(output.textContent, '.<img src=x> normal');
  assert.equal(output.querySelector('img'), null);
  const styled = output.querySelector<HTMLElement>('.console-output-line > span')!;
  assert.match(styled.style.color, /terminal-ansiGreen/);
  assert.equal(styled.style.fontWeight, 'bold');
  assert.equal(styled.style.fontStyle, 'italic');
  assert.equal(styled.style.textDecoration, 'underline line-through');
  assert.equal(output.querySelector('.console-output-line')!.lastChild!.nodeType, 3);
}));

test('console output supports bright, indexed, RGB, background and colon colors', () => fixture((_doc, output) => {
  renderConsoleOutput(output, '\x1b[91mred\x1b[38;5;196mindexed\x1b[48;2;1;2;3mbackground\x1b[38:2::4:5:6mcolon\x1b[0m');
  const spans = output.querySelectorAll<HTMLElement>('.console-output-line > span');
  assert.match(spans[0].style.color, /ansiBrightRed/);
  assert.equal(spans[1].style.color, 'rgb(255, 0, 0)');
  assert.equal(spans[2].style.backgroundColor, 'rgb(1, 2, 3)');
  assert.equal(spans[3].style.color, 'rgb(4, 5, 6)');
}));

test('console output handles CR, CRLF, backspace, tabs, erase-line and cursor progress updates', () => fixture((_doc, output) => {
  renderConsoleOutput(output, 'progress 100%\r\x1b[2Kdone\r\nabc\b!\tZ\nfirst\nsecond\x1b[1A\r\x1b[2Kupdated');
  assert.equal(output.textContent, 'done\nab!     Z\nupdated\nsecond');
  renderConsoleOutput(output, 'abcde\rxy\x1b[K');
  assert.equal(output.textContent, 'xy');
  renderConsoleOutput(output, 'abcde\x1b[3G!\x1b[1D?');
  assert.equal(output.textContent, 'ab?de');
}));

test('console output consumes cumulative suffixes, split escapes/Unicode and snapshot replacements', () => fixture((_doc, output) => {
  let source = '\x1b[3'; renderConsoleOutput(output, source);
  assert.equal(output.textContent, '');
  source += '2mgreen\n'; renderConsoleOutput(output, source);
  const first = output.querySelector('.console-output-line')!;
  const firstText = first.firstChild;
  source += '\ud83c'; renderConsoleOutput(output, source);
  source += '\udf3f'; renderConsoleOutput(output, source);
  assert.equal(output.textContent, 'green\n🌿');
  assert.equal(output.querySelector('.console-output-line'), first);
  assert.equal(first.firstChild, firstText);
  const observer = new output.ownerDocument.defaultView!.MutationObserver(() => {});
  observer.observe(output, { subtree: true, childList: true, characterData: true });
  renderConsoleOutput(output, source);
  assert.equal(observer.takeRecords().length, 0);
  observer.disconnect();
  renderConsoleOutput(output, '\x1b[31mfinal');
  assert.equal(output.textContent, 'final');
  assert.match(output.querySelector<HTMLElement>('.console-output-line > span')!.style.color, /ansiRed/);
}));

test('console output discards OSC links/clipboard/title, DCS, modes and incomplete control strings', () => fixture((_doc, output) => {
  let source = '\x1b]8;;javascript:alert(1)\x1b\\label\x1b]8;;\x07\x1b]52;c;secret\x07\x1bPpayload\x1b\\\x1b[?25l visible\x1b]0;unfinished';
  renderConsoleOutput(output, source);
  assert.equal(output.textContent, 'label visible');
  assert.equal(output.querySelector('a'), null);
  source += '\x07 done'; renderConsoleOutput(output, source);
  assert.equal(output.textContent, 'label visible done');
}));

test('console output plain-text fast path switches to controls without losing earlier lines', () => fixture((_doc, output) => {
  renderConsoleOutput(output, 'one\ntwo');
  assert.equal(output.querySelector('span'), null);
  renderConsoleOutput(output, 'one\ntwo\r\x1b[2Kthree');
  assert.equal(output.textContent, 'one\nthree');
}));

test('plain and ANSI append updates preserve existing text nodes, including long active lines', () => fixture((_doc, output) => {
  renderConsoleOutput(output, 'plain'); const plain = output.firstChild;
  renderConsoleOutput(output, 'plain appended');
  assert.equal(output.firstChild, plain); assert.equal(output.textContent, 'plain appended');
  renderConsoleOutput(output, '\x1b[32m' + 'x'.repeat(10000));
  const line = output.firstChild; const run = line!.firstChild; const text = run!.firstChild;
  renderConsoleOutput(output, '\x1b[32m' + 'x'.repeat(10000) + ' suffix');
  assert.equal(output.firstChild, line); assert.equal(line!.firstChild, run); assert.equal(run!.firstChild, text);
  assert.equal(output.textContent, 'x'.repeat(10000) + ' suffix');
  renderConsoleOutput(output, 'replacement'); const replacement = output.firstChild;
  renderConsoleOutput(output, 'replacement appended');
  assert.equal(output.firstChild, replacement); assert.equal(output.textContent, 'replacement appended');
}));

test('managed console updates do not read accumulated DOM text or rewrite unchanged raw inputs', () => fixture((doc) => {
  const args = { command: 'stream' };
  const block = { name: 'bash', arguments: args, toolStatus: 'running' as const, executionOutput: 'initial' };
  const card = renderToolCard(doc, block, doc.createElement('details')); doc.body.append(card);
  const output = card.querySelector<HTMLElement>('.card-plugin-body .tool-output')!;
  const inputText = card.querySelector('.tool-raw-inputs pre')!.firstChild;
  const text = output.firstChild;
  const descriptor = Object.getOwnPropertyDescriptor(doc.defaultView!.Node.prototype, 'textContent')!;
  Object.defineProperty(output, 'textContent', { get() { throw new Error('accumulated DOM text read'); }, set(value) { descriptor.set!.call(this, value); }, configurable: true });
  updateToolCard(doc, card, { ...block, executionOutput: 'initial appended' });
  assert.equal(output.firstChild, text); assert.equal(text!.textContent, 'initial appended');
  assert.equal(card.querySelector('.tool-raw-inputs pre')!.firstChild, inputText);
  updateToolCard(doc, card, { ...block, executionOutput: 'initial appended\x1b[32m colored' });
  const raw = card.querySelector('.tool-raw-output pre')!; const rawText = raw.firstChild;
  updateToolCard(doc, card, { ...block, executionOutput: 'initial appended\x1b[32m colored suffix' });
  assert.equal(raw.firstChild, rawText); assert.equal(rawText!.textContent, 'initial appended\x1b[32m colored suffix');
}));

test('bundled Bash aliases opt into console sections while raw/file output stays literal', () => {
  const renderer = defaultToolRenderer.mount();
  for (const name of ['bash', 'functions.bash', 'shell', 'terminal']) {
    const value = validatePresentation(bashPresentation({ name, toolStatus: 'result', executionOutput: 'live', resultOutput: '\x1b[32mdone\x1b[0m' }));
    assert.deepEqual(value.sections.map(section => section.format), ['console', 'console']);
  }
  for (const name of ['read', 'bash', 'custom']) assert.equal(renderer.update({ name, resultOutput: '\x1b[32mliteral' }).sections[0].format, undefined);
  renderer.dispose();
});

test('console cards retain output/shell/focus/inspection, final caps and independent exact raw recovery', () => fixture((doc) => {
  const block = { name: 'bash', toolStatus: 'running' as const, executionOutput: '\x1b[32mgreen\nworking' };
  const card = renderToolCard(doc, block, doc.createElement('details')); doc.body.append(card); card.open = true;
  const output = card.querySelector<HTMLElement>('.card-plugin-body .tool-output')!;
  const spinner = card.querySelector('.tool-card-spinner');
  const raw = card.querySelector<HTMLDetailsElement>('.tool-raw-output')!;
  raw.open = true;
  assert.equal(raw.querySelector('pre')!.textContent, block.executionOutput);
  Object.defineProperties(output, { clientHeight: { value: 40 }, scrollHeight: { value: 200 } });
  output.scrollTop = 30; output.focus();
  const firstLine = output.querySelector('.console-output-line');
  updateToolCard(doc, card, { ...block, executionOutput: `${block.executionOutput}\r\x1b[2Kdone` });
  assert.equal(card.querySelector('.card-plugin-body .tool-output'), output);
  assert.equal(output.querySelector('.console-output-line'), firstLine);
  assert.equal(output.textContent, 'green\ndone');
  assert.equal(output.scrollTop, 30); assert.equal(doc.activeElement, output);
  assert.equal(card.querySelector('.tool-card-spinner'), spinner);
  assert.equal(card.querySelector('.tool-raw-output'), raw); assert.equal(raw.open, true); assert.equal(card.open, true);
  updateToolCard(doc, card, { name: 'bash', toolStatus: 'result', resultOutput: '\x1b[31mfailed\x1b[0m', isError: true });
  assert.equal(card.querySelector('.card-plugin-body .tool-output'), output);
  assert.equal(output.textContent, 'failed'); assert.equal(output.classList.contains('tool-output-final'), true);
  assert.equal(output.classList.contains('tool-output-streaming'), false);
  assert.equal(output.scrollTop, 30);
  assert.equal(raw.querySelector('pre')!.textContent, '\x1b[31mfailed\x1b[0m');
}));

test('console format can be changed to text and back through the shared plugin adapter', () => fixture((doc) => {
  let format: 'console' | 'text' = 'console';
  const renderer = { id: 'fixture.console', supports: () => true, mount: () => ({
    update: () => ({ title: 'fixture', sections: [{ key: 'result', label: 'Result', text: '\x1b[32mdone', format }] }), dispose() {},
  }) };
  const block = { name: 'fixture', toolStatus: 'result' as const };
  const card = renderToolCard(doc, block, doc.createElement('details'), renderer);
  const output = card.querySelector('.card-plugin-body .tool-output')!;
  assert.equal(output.textContent, 'done');
  format = 'text'; updateToolCard(doc, card, block); assert.equal(output.textContent, '\x1b[32mdone');
  format = 'console'; updateToolCard(doc, card, block); assert.equal(output.textContent, 'done');
}));
