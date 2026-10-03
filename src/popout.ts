import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { parseSettings, type PreferencesSnapshot } from './preferences';
import { applyTheme, readLibrary } from './themes/theme';
import { DRACULA } from './themes/builtins';
import { DEFAULT_ZOOM } from './zoom';
import { codeBlockSource, createSafeMarkdownRenderer } from './pi/safe-markdown';
import { setCodeIcon, showCopyResult } from './pi/code-actions';
import { isMarkdownLanguage, popoutTitle } from './popout-presentation';
import './popout.css';

interface CodeSnapshot { session: string; title: string; text: string; language: string; }

export async function mountPopout(): Promise<void> {
  document.body.className = 'code-popout-window';
  document.body.replaceChildren();
  const content = document.createElement('main'); content.className = 'popout-content';
  content.setAttribute('aria-label', 'Pop-out content');
  const rendered = document.createElement('div'); rendered.className = 'markdown popout-document';
  content.append(rendered);
  const error = document.createElement('p'); error.className = 'popout-error'; error.setAttribute('role', 'alert'); error.hidden = true;
  document.body.append(error, content);
  let revision = -1;
  let zoomTask = Promise.resolve();
  const report = (message: unknown) => { error.textContent = String(message); error.hidden = false; };
  const applyPreferences = (snapshot: PreferencesSnapshot) => {
    if (snapshot.revision < revision) return;
    try {
      const settings = parseSettings(snapshot.text);
      const library = readLibrary({ version: 1, selected: settings['appearance.theme'] ?? 'nimrod', imports: settings['appearance.importedThemes'] ?? [] });
      applyTheme(document.documentElement, library.selected === 'dracula' ? DRACULA : library.imports.find(theme => theme.id === library.selected));
      const scale = (settings['appearance.zoom'] as number | undefined ?? DEFAULT_ZOOM) / 100;
      zoomTask = zoomTask.then(() => getCurrentWebview().setZoom(scale)).catch(report);
      revision = snapshot.revision;
    } catch (e) { report(e); }
  };
  try {
    const unlisten = await listen<PreferencesSnapshot>('nimrod-preferences', event => applyPreferences(event.payload));
    window.addEventListener('unload', unlisten, { once: true });
    const unlistenErrors = await listen<string>('nimrod-popout-error', event => report(event.payload));
    window.addEventListener('unload', unlistenErrors, { once: true });
    applyPreferences(await invoke<PreferencesSnapshot>('preferences_snapshot'));
    const snapshot = await invoke<CodeSnapshot>('code_popout_snapshot');
    const renderer = createSafeMarkdownRenderer(window);
    const isMarkdown = isMarkdownLanguage(snapshot.language);
    rendered.innerHTML = isMarkdown ? renderer.render(snapshot.text) : renderer.renderCode(snapshot.text, snapshot.language);
    rendered.querySelectorAll('.code-popout').forEach(button => button.remove());
    const title = popoutTitle(snapshot.text, snapshot.language, rendered);
    document.title = title;
    void getCurrentWindow().setTitle(title).catch(report);
    if (isMarkdown) {
      rendered.classList.add('popout-markdown');
      const actions = document.createElement('div'); actions.className = 'popout-copy-source';
      const copy = document.createElement('button'); copy.type = 'button';
      copy.className = 'code-copy code-action'; copy.dataset.copySnapshot = 'true';
      copy.title = 'Copy Markdown source to clipboard'; copy.setAttribute('aria-label', 'Copy Markdown source');
      setCodeIcon(copy, 'copy');
      const status = document.createElement('span'); status.className = 'code-copy-status';
      status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
      actions.append(copy, status);
      document.body.append(actions);
    }
    document.body.addEventListener('click', async event => {
      const target = event.target instanceof Element ? event.target : null;
      const copy = target?.closest<HTMLButtonElement>('button.code-copy');
      if (copy && !copy.disabled) {
        const status = copy.parentElement?.querySelector<HTMLElement>('.code-copy-status');
        const block = copy.closest('.code-block');
        const source = copy.dataset.copySnapshot ? snapshot.text : block ? codeBlockSource(block) : undefined;
        if (source === undefined || !status) return;
        copy.disabled = true;
        try { await writeText(source); showCopyResult(copy, status, true); }
        catch { showCopyResult(copy, status, false); }
        return;
      }
      const link = target?.closest('a');
      if (link) {
        event.preventDefault();
        const href = link.getAttribute('href');
        if (href) {
          try { await invoke('open_popout_link', { href }); }
          catch (e) { report(`Could not open link: ${e}`); }
        }
      }
    });
    window.addEventListener('keydown', event => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === 'w') {
        event.preventDefault(); void getCurrentWindow().close().catch(report);
      }
    });
  } catch (e) { report(`Could not open code snapshot: ${e}`); }
}
