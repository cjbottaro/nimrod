import assert from 'node:assert/strict';
import test from 'node:test';
import { JSDOM } from 'jsdom';
import { copilotSlashCommands } from '../src/copilot/commands';
import type { AutocompleteAccept } from '../src/autocomplete-settings';
import { installSlashCompletion } from '../src/pi/slash-completion';

const commands = [
  { name: 'review-pr', kind: 'skill', input: { hint: 'instructions for the skill' } },
  { name: 'permissions', kind: 'builtin', aliases: ['perms'], input: {
    hint: '[default|allow-all|allow-tools|show]', choices: [
      { name: 'default', description: 'Ask first' },
      { name: 'allow-all', description: 'Allow everything' },
      { name: 'allow-tools', description: 'Allow tools' },
      { name: 'show', description: 'Show permissions' },
    ],
  } },
  { name: 'required', kind: 'builtin', input: { hint: 'name', required: true } },
  { name: 'config', kind: 'client', input: { hint: '[key]', valueHint: '[value]', choices: [
    { name: 'model', description: 'Default model' },
    { name: 'memory', description: 'Memory setting' },
  ] } },
];
function fixture(configure?: (window: JSDOM['window']) => void, acceptWith: (() => AutocompleteAccept) | null = () => 'tabOrEnter') {
  const dom = new JSDOM('<div><textarea aria-describedby="existing"></textarea><div id="suggestions" role="listbox"></div><button>Other</button></div>', { pretendToBeVisual: true });
  configure?.(dom.window);
  const input = dom.window.document.querySelector('textarea')!;
  const list = dom.window.document.querySelector<HTMLElement>('#suggestions')!;
  const inserted: string[] = [];
  const completion = installSlashCompletion(input, list, value => inserted.push(value), copilotSlashCommands, acceptWith ?? undefined);
  completion.setCommands(commands); input.focus();
  return {
    dom, input, list, inserted, completion,
    ghost: () => dom.window.document.querySelector('.composer-inline-suffix')!.textContent,
    hidden: () => dom.window.document.querySelector<HTMLElement>('.composer-inline-completion')!.hidden,
    status: () => dom.window.document.querySelector('.composer-inline-status')!.textContent,
    type(value: string) { input.value = value; input.setSelectionRange(value.length, value.length); input.dispatchEvent(new dom.window.Event('input')); },
    key(key: string, init: KeyboardEventInit = {}) {
      const event = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
      input.dispatchEvent(event); return event;
    },
    close() { completion.dispose(); dom.window.close(); },
  };
}

test('Tab-only is the default and leaves every Enter to the normal composer handler', () => {
  const f = fixture(undefined, null);
  try {
    for (const value of ['/rev', '/review-pr', '/permissions al', '/permissions allow-all', '/permissions ']) {
      f.type(value); f.key('ArrowDown');
      assert.equal(f.key('Enter').defaultPrevented, false);
      assert.equal(f.input.value, value);
    }
    assert.deepEqual(f.inserted, []);
    f.type('/permissions al'); f.key('Tab');
    assert.equal(f.input.value, '/permissions allow-all ');
  } finally { f.close(); }
});

test('acceptance preference changes affect already-open suggestions without changing the draft', () => {
  let mode: AutocompleteAccept = 'tab';
  const f = fixture(undefined, () => mode);
  try {
    f.type('/permissions al');
    assert.equal(f.key('Enter').defaultPrevented, false);
    mode = 'tabOrEnter'; assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.input.value, '/permissions allow-all ');
    f.type('/rev'); mode = 'tab'; assert.equal(f.key('Enter').defaultPrevented, false);
    mode = 'tabOrEnter'; assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.input.value, '/review-pr ');
  } finally { f.close(); }
});

test('bare skill hints are inline, optional, non-insertable and disappear with free text', () => {
  const f = fixture();
  try {
    f.type('/review-pr');
    assert.equal(f.list.hidden, true);
    assert.equal(f.ghost(), ' [instructions for the skill]');
    assert.equal(f.input.value, '/review-pr');
    assert.equal(f.input.selectionStart, f.input.value.length);
    assert.match(f.status()!, /Optional/);
    assert.equal(f.key('Enter').defaultPrevented, false);
    assert.equal(f.key('Tab').defaultPrevented, false, 'placeholder prose is never inserted');
    assert.deepEqual(f.inserted, []);
    f.type('/review-pr '); assert.equal(f.ghost(), '[instructions for the skill]');
    f.type('/review-pr inspect this'); assert.equal(f.hidden(), true);
    f.type('/review-pr '); assert.equal(f.hidden(), false);
    f.type('/required'); assert.equal(f.ghost(), ' <name>'); assert.match(f.status()!, /Required/);
  } finally { f.close(); }
});

test('literal argument suffixes complete on Tab, preserve aliases and never invoke a command', () => {
  const f = fixture();
  try {
    f.type('/permissions al');
    assert.equal(f.ghost(), 'low-all'); assert.equal(f.list.hidden, true);
    assert.equal(f.input.getAttribute('aria-expanded'), 'false');
    assert.equal(f.input.hasAttribute('aria-activedescendant'), false);
    assert.match(f.status()!, /allow-all: Allow everything.*1 of 2/);
    assert.equal(f.key('Tab').defaultPrevented, true);
    assert.equal(f.input.value, '/permissions allow-all ');
    assert.deepEqual(f.inserted, ['/permissions allow-all ']);
    assert.equal(f.hidden(), true);
    f.type('/PeRmS\tal'); f.key('Tab');
    assert.equal(f.input.value, '/PeRmS\tallow-all ');
    f.type('/permissions low');
    assert.equal(f.hidden(), true, 'inline completion does not fuzzy-rewrite non-prefix input');
    assert.equal(f.key('Tab').defaultPrevented, false);
  } finally { f.close(); }
});

test('ambiguous choices cycle inline while blank and typed Enter retain their existing semantics', () => {
  const f = fixture();
  try {
    f.type('/permissions ');
    assert.equal(f.ghost(), '[default|allow-all|allow-tools|show]');
    assert.equal(f.key('Enter').defaultPrevented, false);
    f.key('ArrowDown'); assert.equal(f.ghost(), 'allow-all');
    assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.input.value, '/permissions allow-all ');
    f.type('/permissions al'); f.key('ArrowDown');
    assert.equal(f.ghost(), 'low-tools'); assert.match(f.status()!, /2 of 2/);
    f.key('ArrowDown'); assert.equal(f.ghost(), 'low-all');
    f.key('ArrowUp'); assert.equal(f.ghost(), 'low-tools');
    f.key('Tab'); assert.equal(f.input.value, '/permissions allow-tools ');
    f.type('/permissions sh'); assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.input.value, '/permissions show ');
    assert.equal(f.key('Enter').defaultPrevented, false, 'second Enter submits normally');
  } finally { f.close(); }
});

test('exact arguments submit on the first Enter without rewriting the draft; Tab still completes explicitly', () => {
  const f = fixture();
  try {
    f.completion.setCommands([...commands, { name: 'allow-all', kind: 'builtin', input: {
      hint: '[on|off]', choices: [{ name: 'onward', description: 'Longer prefix' }, { name: 'on', description: 'Enable' }, { name: 'off', description: 'Disable' }],
    } }]);
    for (const value of ['/allow-all on', '/permissions show', '/PeRmS\tSHOW']) {
      f.type(value);
      assert.equal(f.key('Enter').defaultPrevented, false, 'an exact match wins even if a longer candidate appears first');
      assert.equal(f.input.value, value); assert.deepEqual(f.inserted, []);
    }
    f.type('/allow-all on');
    assert.equal(f.hidden(), true, 'an exact match does not show a longer candidate as ghost text');
    f.key('ArrowUp'); f.key('Enter'); // Explicitly choose the longer onward.
    assert.equal(f.input.value, '/allow-all onward ');
    f.type('/permissions show'); f.key('Tab');
    assert.equal(f.input.value, '/permissions show ', 'Tab remains explicit completion');
  } finally { f.close(); }
});

test('exact command names submit while partial names still complete on Enter', () => {
  const f = fixture();
  try {
    f.completion.setCommands([{ name: 'context', kind: 'builtin' }]);
    f.type('/context'); assert.equal(f.key('Enter').defaultPrevented, false);
    assert.equal(f.input.value, '/context'); assert.deepEqual(f.inserted, []);
    f.type('/con'); assert.equal(f.key('Enter').defaultPrevented, true);
    assert.equal(f.input.value, '/context ');
  } finally { f.close(); }
});

test('Escape, selections, locks, modifiers and IME never accidentally accept ghost text', () => {
  const f = fixture();
  try {
    f.type('/permissions al'); f.key('Escape'); f.completion.refresh();
    assert.equal(f.hidden(), true); assert.equal(f.status(), '');
    assert.equal(f.key('Tab').defaultPrevented, false);
    f.type('/permissions al');
    for (const modifier of ['shiftKey', 'altKey', 'ctrlKey', 'metaKey'])
      assert.equal(f.key('Tab', { [modifier]: true }).defaultPrevented, false);
    assert.equal(f.key('Enter', { isComposing: true }).defaultPrevented, false);
    assert.equal(f.key('Tab', { keyCode: 229 }).defaultPrevented, false);
    f.input.dispatchEvent(new f.dom.window.Event('compositionstart'));
    assert.equal(f.hidden(), true); assert.equal(f.key('Tab').defaultPrevented, false);
    f.input.dispatchEvent(new f.dom.window.Event('compositionend'));
    assert.equal(f.hidden(), false);
    f.input.setSelectionRange(2, 4);
    assert.equal(f.key('Tab').defaultPrevented, false); assert.equal(f.hidden(), true);
    f.type('/permissions al'); f.input.readOnly = true;
    assert.equal(f.key('Tab').defaultPrevented, false); assert.equal(f.hidden(), true);
    f.input.readOnly = false; f.completion.refresh();
    f.input.disabled = true; f.completion.refresh(); assert.equal(f.hidden(), true);
    assert.deepEqual(f.inserted, []);
  } finally { f.close(); }
});

test('focus, session hiding, catalog changes and disposal clear inline state without changing the draft', () => {
  const f = fixture();
  try {
    f.type('/permissions al');
    f.completion.setActive(false); assert.equal(f.hidden(), true);
    f.completion.setCommands(commands); assert.equal(f.hidden(), true);
    f.completion.setActive(true); assert.equal(f.hidden(), false);
    f.dom.window.document.querySelector('button')!.focus(); assert.equal(f.hidden(), true);
    f.input.focus(); assert.equal(f.hidden(), false);
    f.dom.window.dispatchEvent(new f.dom.window.Event('blur')); assert.equal(f.hidden(), true);
    f.dom.window.dispatchEvent(new f.dom.window.Event('focus')); assert.equal(f.hidden(), false);
    f.completion.setCommands([]); assert.equal(f.hidden(), true);
    f.completion.setCommands(commands); assert.equal(f.hidden(), false);
    assert.equal(f.input.getAttribute('aria-describedby'), 'existing suggestions-inline-status');
    f.completion.dispose();
    assert.equal(f.dom.window.document.querySelector('.composer-inline-completion'), null);
    assert.equal(f.input.getAttribute('aria-describedby'), 'existing');
    f.type('/permissions al'); assert.equal(f.key('Tab').defaultPrevented, false);
    assert.equal(f.input.value, '/permissions al'); assert.deepEqual(f.inserted, []);
  } finally { f.close(); }
});

test('ghost mirror follows textarea scrolling and avoids synchronous layout reads during argument typing', () => {
  const f = fixture();
  try {
    Object.defineProperty(f.input, 'scrollHeight', { get() { throw new Error('No input layout read'); } });
    f.input.getBoundingClientRect = () => { throw new Error('No input layout read'); };
    f.type('/permissions al');
    f.input.scrollTop = 40; f.input.scrollLeft = 12;
    f.input.dispatchEvent(new f.dom.window.Event('scroll'));
    const mirror = f.dom.window.document.querySelector<HTMLElement>('.composer-inline-mirror')!;
    assert.equal(mirror.style.transform, 'translate(-12px, -40px)');
    assert.equal(mirror.querySelector('.composer-inline-prefix')!.textContent, '/permissions al');
    assert.equal(f.input.value, '/permissions al');
    assert.equal(f.dom.window.document.querySelector('.composer-inline-completion')!.getAttribute('aria-hidden'), 'true');
  } finally { f.close(); }
});

test('content-box resize observations account for scrollbars and disconnect on disposal', () => {
  let resize!: (entries: { contentRect: { width: number } }[]) => void;
  let disconnects = 0;
  const f = fixture(window => Object.defineProperty(window, 'ResizeObserver', { value: class {
    constructor(callback: typeof resize) { resize = callback; }
    observe() {}
    disconnect() { disconnects++; }
  } }));
  try {
    f.type('/permissions al');
    resize([{ contentRect: { width: 217 } }]);
    assert.equal(f.dom.window.document.querySelector<HTMLElement>('.composer-inline-mirror')!.style.width, '217px');
    f.completion.dispose(); assert.equal(disconnects, 1);
  } finally { f.dom.window.close(); }
});

test('command names keep the existing menu and Tab insertion before arguments switch inline', () => {
  const f = fixture();
  try {
    f.type('/rev'); assert.equal(f.list.hidden, false); assert.equal(f.hidden(), true);
    assert.match(f.list.textContent!, /\/review-pr/);
    f.key('Tab'); assert.equal(f.input.value, '/review-pr ');
    assert.equal(f.list.hidden, true); assert.equal(f.ghost(), '[instructions for the skill]');
  } finally { f.close(); }
});

test('a selected key advances to a value-only inline hint without value suggestions', () => {
  const f = fixture();
  try {
    f.type('/config m');
    assert.equal(f.ghost(), 'odel');
    f.key('Tab');
    assert.equal(f.input.value, '/config model ');
    assert.equal(f.ghost(), '[value]');
    f.type('/config model gpt');
    assert.equal(f.hidden(), true, 'values remain free-form without completion');
  } finally { f.close(); }
});
