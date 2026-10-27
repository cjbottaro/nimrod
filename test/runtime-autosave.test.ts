import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installRuntimeSettings, type RuntimeField, type RuntimePaths } from '../src/settings';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(save?: (paths: RuntimePaths, changed: RuntimeField[]) => Promise<RuntimePaths>) {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'));
  const get = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T;
  let saved: RuntimePaths = { pi: 'pi', node: 'node', copilot: 'copilot', codex: 'codex' };
  const writes: RuntimeField[][] = [];
  const errors = new Map<string | undefined, string>();
  const runtime = installRuntimeSettings({ form: get('runtime-settings'), fields: get('runtime-fields'), pi: get('pi-path'), node: get('node-path'), copilot: get<HTMLInputElement>('copilot-path'), codex: get<HTMLInputElement>('codex-path'), status: get('runtime-status') }, {
    read: () => ({ version: 1, ...saved }),
    save: async (paths, changed) => {
      writes.push(changed);
      if (save) return save(paths, changed);
      saved = { ...saved, [changed[0]]: paths[changed[0]] }; return saved;
    },
    error: (message, key) => { if (message) errors.set(key, message); else errors.delete(key); },
  });
  runtime.initialize(saved);
  const event = (id: string, type: string) => get(id).dispatchEvent(new dom.window.Event(type, { bubbles: type !== 'blur' }));
  const edit = (id: string, value: string) => { get<HTMLInputElement>(id).value = value; event(id, 'input'); };
  return { dom, get, runtime, writes, errors, event, edit, close: () => { runtime.dispose(); dom.window.close(); } };
}

test('runtime change/blur/Enter save one field once, not every keystroke or an untouched field', async () => {
  const f = fixture();
  try {
    f.edit('pi-path', '  custom-pi  '); assert.equal(f.writes.length, 0);
    f.event('pi-path', 'change'); f.event('pi-path', 'blur'); await tick();
    assert.deepEqual(f.writes, [['pi']]); assert.equal(f.get<HTMLInputElement>('pi-path').value, 'custom-pi');
    f.event('node-path', 'blur'); assert.equal(f.writes.length, 1);
    f.edit('node-path', ''); // An invalid draft must not block an independent field.
    f.edit('codex-path', 'custom-codex'); f.event('codex-path', 'blur'); await tick();
    assert.deepEqual(f.writes, [['pi'], ['codex']]);
    f.edit('copilot-path', 'custom-copilot');
    f.get('copilot-path').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    f.event('copilot-path', 'blur'); await tick();
    assert.deepEqual(f.writes, [['pi'], ['codex'], ['copilot']]);
    assert.equal(f.runtime.current().node, 'node'); assert.equal(f.get<HTMLInputElement>('node-path').value, '');
  } finally { f.close(); }
});

test('pending runtime saves keep fields enabled and do not overwrite newer typing or focus', async () => {
  let finish!: (paths: RuntimePaths) => void;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  try {
    f.edit('pi-path', 'first'); f.event('pi-path', 'change');
    f.edit('pi-path', 'newer unfinished draft'); f.get('pi-path').focus();
    assert.equal(f.get<HTMLFieldSetElement>('runtime-fields').disabled, false);
    finish({ pi: 'first', node: 'updated-global-node', copilot: 'copilot', codex: 'codex' }); await tick();
    assert.equal(f.get<HTMLInputElement>('pi-path').value, 'newer unfinished draft');
    assert.equal(f.get<HTMLInputElement>('node-path').value, 'updated-global-node');
    assert.equal(f.dom.window.document.activeElement, f.get('pi-path'));
  } finally { f.close(); }
});

test('failed runtime commits retain drafts and committed paths, deduplicate blur and allow a new edit', async () => {
  const f = fixture();
  try {
    f.edit('pi-path', ''); f.event('pi-path', 'change'); f.event('pi-path', 'blur'); await tick();
    assert.equal(f.runtime.current().pi, 'pi'); assert.equal(f.writes.length, 0); assert.match(f.errors.get('pi')!, /non-empty/);
    f.edit('node-path', 'custom-node'); f.event('node-path', 'blur'); await tick();
    assert.match(f.errors.get('pi')!, /non-empty/, 'unrelated success must not resolve the failed field');
    f.edit('pi-path', 'corrected-pi'); f.event('pi-path', 'blur'); await tick();
    assert.equal(f.runtime.current().pi, 'corrected-pi'); assert.equal(f.errors.size, 0);
  } finally { f.close(); }
});

test('late runtime persistence failure is suppressed after disposal', async () => {
  let fail!: (error: Error) => void;
  const f = fixture(() => new Promise((_, reject) => { fail = reject; }));
  try {
    f.edit('pi-path', 'custom-pi'); f.event('pi-path', 'change'); f.runtime.dispose();
    fail(new Error('late write failure')); await tick(); assert.equal(f.errors.size, 0);
  } finally { f.close(); }
});
