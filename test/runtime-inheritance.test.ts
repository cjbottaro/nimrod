import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installRuntimeSettings, type RuntimeField, type RuntimePaths } from '../src/settings';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function fixture(options: { save?: () => Promise<void>; clear?: () => Promise<void> } = {}) {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'));
  const get = <T extends HTMLElement>(id: string) => dom.window.document.getElementById(id) as T;
  let inherited: RuntimePaths = { pi: '/global/pi', node: '/global/node', copilot: 'copilot', codex: 'codex' };
  let overrides: Partial<RuntimePaths> = {};
  const effective = (): RuntimePaths => ({ ...inherited, ...overrides });
  const writes: { key: RuntimeField; value?: string }[] = [];
  const errors = new Map<RuntimeField | undefined, string>();
  const runtime = installRuntimeSettings({ form: get('runtime-settings'), fields: get('runtime-fields'), pi: get('pi-path'), node: get('node-path'), copilot: get('copilot-path'), codex: get('codex-path'), status: get('runtime-status') }, {
    read: () => ({ version: 1, ...effective() }),
    save: async (paths, fields) => {
      const key = fields[0]; writes.push({ key, value: paths[key] });
      await options.save?.(); overrides[key] = paths[key]; runtime.reload(); return effective();
    },
    project: {
      overridden: key => Object.hasOwn(overrides, key), inherited: () => inherited,
      clear: async key => {
        writes.push({ key }); await options.clear?.(); delete overrides[key]; runtime.reload(); return effective();
      },
    },
    error: (message, key) => { if (message) errors.set(key, message); else errors.delete(key); },
  });
  runtime.initialize(inherited);
  const event = (key: RuntimeField, type: string) => get(key + '-path').dispatchEvent(new dom.window.Event(type, { bubbles: type !== 'blur' }));
  const edit = (key: RuntimeField, value: string) => { get<HTMLInputElement>(key + '-path').value = value; event(key, 'input'); };
  return { dom, get, runtime, writes, errors, edit, event,
    inherited(value: Partial<RuntimePaths>) { inherited = { ...inherited, ...value }; runtime.reload(); },
    overrides(value: Partial<RuntimePaths>) { overrides = value; runtime.reload(); },
    close() { runtime.dispose(); dom.window.close(); },
  };
}

test('inherited fields are empty with effective placeholders and pristine blur makes no writes', () => {
  const f = fixture();
  try {
    for (const key of ['pi', 'node', 'copilot', 'codex'] as const) {
      assert.equal(f.get<HTMLInputElement>(key + '-path').value, '');
      assert.equal(f.get<HTMLInputElement>(key + '-path').placeholder, f.runtime.current()[key]);
      f.event(key, 'blur');
    }
    assert.deepEqual(f.writes, []);
    f.inherited({ pi: '/new/global/pi' });
    assert.equal(f.get<HTMLInputElement>('pi-path').value, '');
    assert.equal(f.get<HTMLInputElement>('pi-path').placeholder, '/new/global/pi');
    assert.equal(f.runtime.current().pi, '/new/global/pi');
  } finally { f.close(); }
});

test('equal-valued override presence changes presentation and blank change/blur removes only that field', async () => {
  const f = fixture();
  try {
    f.overrides({ pi: '/global/pi', node: '/project/node' });
    assert.equal(f.get<HTMLInputElement>('pi-path').value, '/global/pi');
    f.edit('pi', ''); assert.deepEqual(f.writes, []);
    f.event('pi', 'change'); f.event('pi', 'blur'); await tick();
    assert.deepEqual(f.writes, [{ key: 'pi' }]);
    assert.equal(f.get<HTMLInputElement>('pi-path').value, '');
    assert.equal(f.get<HTMLInputElement>('node-path').value, '/project/node');
    assert.equal(f.runtime.current().node, '/project/node');
    f.inherited({ pi: '/changed/pi' });
    assert.equal(f.runtime.current().pi, '/changed/pi');
    assert.equal(f.get<HTMLInputElement>('pi-path').placeholder, '/changed/pi');
    f.edit('copilot', ' custom-copilot ');
    f.get('copilot-path').dispatchEvent(new f.dom.window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    f.event('copilot', 'blur'); await tick();
    assert.deepEqual(f.writes.at(-1), { key: 'copilot', value: 'custom-copilot' });
    assert.equal(f.get<HTMLInputElement>('copilot-path').value, 'custom-copilot');
  } finally { f.close(); }
});

test('inheritance changes and pending clear preserve newer drafts, focus and authoritative launch paths', async () => {
  let finish!: () => void;
  const f = fixture({ clear: () => new Promise(resolve => { finish = resolve; }) });
  try {
    f.overrides({ pi: '/project/pi' });
    f.edit('pi', ''); f.event('pi', 'change');
    f.edit('pi', '/newer/draft'); f.get('pi-path').focus();
    f.edit('node', '/unfinished/node');
    f.inherited({ pi: '/new/global/pi', node: '/new/global/node' });
    assert.equal(f.get<HTMLInputElement>('node-path').value, '/unfinished/node');
    assert.equal(f.get<HTMLInputElement>('node-path').placeholder, '/new/global/node');
    finish(); await tick();
    assert.equal(f.get<HTMLInputElement>('pi-path').value, '/newer/draft');
    assert.equal(f.runtime.current().pi, '/new/global/pi');
    assert.equal(f.dom.window.document.activeElement, f.get('pi-path'));
    assert.equal(f.get<HTMLFieldSetElement>('runtime-fields').disabled, false);
    assert.equal(f.get<HTMLInputElement>('node-path').value, '/unfinished/node');
  } finally { f.close(); }
});

test('failed clears retain the blank draft and prior effective override without replaying on blur', async () => {
  const f = fixture({ clear: async () => { throw new Error('fixture CAS conflict'); } });
  try {
    f.overrides({ codex: '/project/codex' });
    f.edit('codex', ''); f.event('codex', 'change'); f.event('codex', 'blur'); await tick();
    assert.equal(f.get<HTMLInputElement>('codex-path').value, '');
    assert.equal(f.runtime.current().codex, '/project/codex');
    assert.match(f.errors.get('codex')!, /CAS conflict/);
    f.event('codex', 'blur'); assert.equal(f.writes.length, 1);
    f.edit('node', '/independent/node'); f.event('node', 'change'); await tick();
    assert.match(f.errors.get('codex')!, /CAS conflict/);
  } finally { f.close(); }
});

test('late clear results do not touch disposed presentation or report failures', async () => {
  let reject!: (error: Error) => void;
  const f = fixture({ clear: () => new Promise((_, fail) => { reject = fail; }) });
  try {
    f.overrides({ pi: '/project/pi' }); f.edit('pi', ''); f.event('pi', 'change');
    f.runtime.dispose(); reject(new Error('late clear failure')); await tick();
    assert.equal(f.errors.size, 0);
  } finally { f.close(); }
});
