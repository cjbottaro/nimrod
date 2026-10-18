import { installApplicationNotices } from './application-notices';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { parseSettings, parseProjectSettings, type PreferencesSnapshot } from './preferences';
import { applyTheme, readLibrary } from './themes/theme';
import { selectedTheme } from './themes/builtins';
import { DEFAULT_ZOOM } from './zoom';
import { readWindowAppearance } from './window-appearance';
import { installNativeWindowAppearance } from './native-window-appearance';
import { installKeybindingDispatch, readKeyOverrides } from './keybindings';
import { codeBlockSource, createSafeMarkdownRenderer } from './pi/safe-markdown';
import { setCodeIcon, showCopyResult } from './pi/code-actions';
import { isMarkdownLanguage, popoutTitle } from './popout-presentation';
import { applyTypography, readTypography } from './typography';
import './popout.css';

interface CodeSnapshot { session: string; title: string; text: string; language: string; }

export async function mountPopout(): Promise<void> {
  document.body.className = 'code-popout-window';
  document.body.replaceChildren();
  const content = document.createElement('main'); content.className = 'popout-content';
  content.setAttribute('aria-label', 'Pop-out content');
  const rendered = document.createElement('div'); rendered.className = 'markdown popout-document';
  content.append(rendered);
  document.body.append(content);
  const notices = installApplicationNotices(window);
  window.addEventListener('unload', () => notices.dispose(), { once: true });
  let noticeSequence = 0;
  let revision = -1, projectRevision = -1;
  let globalSettings: Record<string, unknown> = {};
  let zoomTask = Promise.resolve();
  const report = (message: unknown) => { notices.report({ id: `reference:${++noticeSequence}`, operation: 'Reference window', message: String(message) }); };
  const appearance = installNativeWindowAppearance({
    read: () => readWindowAppearance(globalSettings),
    report: (message, cause = 'native') => { const id = 'window-appearance:' + cause; if (message) notices.report({ id, operation: 'Window appearance', message }); else notices.resolve(id); },
  });
  window.addEventListener('unload', () => appearance.dispose(), { once: true });
  const settingsDispatch = installKeybindingDispatch(window, {
    actions: ['settings'], read: () => readKeyOverrides(globalSettings.keybindings), enabled: () => true,
    run: () => invoke('open_global_settings'), error: report,
  });
  window.addEventListener('unload', () => settingsDispatch.dispose(), { once: true });
  const applyPreferences = (snapshot: PreferencesSnapshot) => {
    if (snapshot.revision < revision || (snapshot.projectRevision ?? 0) < projectRevision) return;
    try {
      const global = parseSettings(snapshot.text); globalSettings = global;
      applyTypography(document.documentElement, readTypography(global));
      appearance.reload(); // Global appearance still updates if the project's theme is invalid.
      const scale = (global['appearance.zoom'] as number | undefined ?? DEFAULT_ZOOM) / 100;
      zoomTask = zoomTask.then(() => getCurrentWebview().setZoom(scale)).catch(report);
      revision = snapshot.revision; projectRevision = snapshot.projectRevision ?? 0;
      const settings = { ...global, ...(snapshot.projectText ? parseProjectSettings(snapshot.projectText, global) : {}) };
      const library = readLibrary({ version: 1, selected: settings['appearance.theme'] ?? 'nimrod', imports: settings['appearance.importedThemes'] ?? [] });
      applyTheme(document.documentElement, selectedTheme(library));
    } catch (e) { report(e); }
  };
  try {
    const refreshPreferences = () => invoke<PreferencesSnapshot>('scoped_preferences_snapshot').then(applyPreferences).catch(report);
    const unlisten = await listen('nimrod-preferences', () => { void refreshPreferences(); });
    window.addEventListener('unload', unlisten, { once: true });
    const unlistenErrors = await listen<string>('nimrod-popout-error', event => report(event.payload));
    window.addEventListener('unload', unlistenErrors, { once: true });
    const unlistenLinkErrors = await listen<string>('nimrod-link-error', event => {
      notices.report({ id: `link:${++noticeSequence}`, operation: 'Open link', message: event.payload });
    }, { target: { kind: 'WebviewWindow', label: getCurrentWindow().label } });
    window.addEventListener('unload', unlistenLinkErrors, { once: true });
    await refreshPreferences();
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
        catch (error) { copy.disabled = false; status.textContent = ''; setCodeIcon(copy, 'copy'); report(`Could not copy source: ${String(error)}`); }
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
