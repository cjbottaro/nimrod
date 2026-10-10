import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import { installSettingsNavigation } from '../src/settings-navigation';
import { stubDialogs } from './dialog-fixture';

test('category navigation retains mounted controls, handles vertical tabs and respects owner/nested modality', () => {
  const dom = new JSDOM(readFileSync('index.html', 'utf8'), { pretendToBeVisual: true });
  const win = dom.window; stubDialogs(win);
  const get = <T extends HTMLElement>(id: string) => win.document.getElementById(id) as T;
  const page = get<HTMLDialogElement>('settings-page');
  const section = win.document.createElement('section'); section.id = 'keybindings-section'; section.className = 'settings-panel'; section.dataset.category = 'keybindings'; section.hidden = true;
  page.querySelector('.settings-content')!.append(section);
  const navigation = installSettingsNavigation(page);
  try {
    assert.equal(navigation.select('runtime'), false, 'closed page is inactive'); page.showModal();
    get<HTMLButtonElement>('settings-category-runtime').click(); assert.equal(navigation.selected, 'runtime');
    const pi = get<HTMLInputElement>('pi-path'); pi.value = '/dirty/pi';
    const appearance = get('settings-panel-appearance'); appearance.scrollTop = 123;
    assert.equal(navigation.select('appearance'), true); assert.equal(pi.isConnected, true);
    navigation.select('runtime'); assert.equal(pi.value, '/dirty/pi'); assert.equal(appearance.scrollTop, 123);
    const tab = get('settings-category-runtime'); tab.focus();
    tab.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    assert.equal(navigation.selected, 'appearance'); assert.equal(win.document.activeElement, get('settings-category-appearance'));
    const nested = get<HTMLDialogElement>('host-dialog'); nested.showModal();
    assert.equal(navigation.select('runtime'), false); assert.equal(navigation.selected, 'appearance'); nested.close();
    page.close(); page.showModal(); assert.equal(navigation.selected, 'appearance');
    navigation.dispose(); get<HTMLButtonElement>('settings-category-runtime').click(); assert.equal(navigation.selected, 'appearance');
  } finally { navigation.dispose(); win.close(); }
});
