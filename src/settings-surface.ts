import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { installApplicationNotices } from './application-notices';
import { installPreferences, type ProjectSettingKey } from './preferences';
import { installSettings, installRuntimeSettings, type RuntimeField } from './settings';
import { installSettingsNavigation } from './settings-navigation';
import { installSidebarResize } from './sidebar-resize';
import { installKeybindingEditor } from './keybinding-editor';
import { isMac } from './keybindings';
import { installThemes } from './themes/picker';
import { installZoom } from './zoom';
import { installSettingsChoiceControls, type ChooseSetting } from './settings-choice-controls';
import { installModalMotion, showModal, closeModal } from './modal-motion';
import { applyModalAnimation, type ModalAnimationStyle } from './modal-animation';
import { updateRangeFill } from './range-input';
import { pixelCapabilities } from './modal-pixel-surface';
import { DEFAULT_MODAL_DURATIONS, DEFAULT_PIXEL_OPTIONS, DEFAULT_SCAN_SPEEDS, isScanStyle } from './modal-animation-defaults';
import { installNativeWindowAppearance } from './native-window-appearance';
import { installPerformanceDiagnostics } from './performance-diagnostics';
import { createTranscriptLog } from './transcript-logs';
import type { NotificationDispatch } from './notifications';
import { installTypography } from './typography-controls';
import type { InstalledFont } from './font-picker';

export function installSettingsSurface(preferences: Awaited<ReturnType<typeof installPreferences>>, notices: ReturnType<typeof installApplicationNotices>, global = false, harnesses: readonly { id: string; label: string }[] = []) {
  const required = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let unloading = false, noticeSequence = 0;
  let chooseSetting: ChooseSetting = async () => undefined;
  let choiceControls: ReturnType<typeof installSettingsChoiceControls> | undefined;
  const feedback = (id: string, operation: string) => (message?: string) => {
    if (message) notices.report({ id, operation, message }); else notices.resolve(id);
  };
  const persistenceError = feedback('settings-storage', 'Save Settings layout');
  const settings = installSettings(window, required<HTMLDialogElement>('settings-page'), required<HTMLButtonElement>('open-settings'), required<HTMLButtonElement>('settings-back'), false, {
    canOpen: () => global || !!preferences.projectPath,
    unavailable: () => { void invoke('open_global_settings').catch(error => feedback('open-settings', 'Open Settings')(String(error))); },
    closeWindow: global ? () => { void getCurrentWindow().close().catch(error => feedback('close-settings', 'Close Settings')(String(error))); } : undefined,
  });
  const keybindingEditor = global ? installKeybindingEditor(window, required('settings-page').querySelector<HTMLElement>('.settings-content')!, {
    read: () => preferences.keybindings(),
    save: (id, bindings, reassign) => preferences.saveKeybinding(id, bindings, reassign, isMac(window)),
    resetAll: () => preferences.resetKeybindings(),
    error: feedback('keybindings', 'Edit keybindings'),
  }) : undefined;
  if (!global) {
    for (const category of ['notifications', 'diagnostics', 'keybindings']) required('settings-category-' + category).hidden = true;
    required('settings-translucency').hidden = true;
    required('settings-zoom').hidden = true;
    required('settings-typography').hidden = true;
    required('settings-send-auto-follow').hidden = true;
    required('settings-modal-animation').hidden = true;
  }
  required('card-plugin-status').hidden = !global;
  required('settings-project-inheritance').hidden = global;
  required('settings-project-file').hidden = global;
  required('settings-state-file').hidden = !global;
  const settingsNavigation = installSettingsNavigation(required<HTMLDialogElement>('settings-page'));
  const typography = installTypography(document.documentElement, {
    read: () => preferences.typography(),
    save: values => preferences.saveTypography(values),
    reset: () => preferences.resetTypography(),
    fonts: () => invoke<InstalledFont[]>('installed_fonts'),
    report: (cause, message) => feedback('typography:' + cause, 'Typography')(message),
  }, global);
  const settingsSidebarWidthKey = 'nimrod.settings.sidebar.width';
  let settingsSidebarWidth = preferences.readState(settingsSidebarWidthKey);
  const settingsSidebarResize = installSidebarResize(window, {
    layout: required('settings-layout'), sidebar: required('settings-sidebar'),
    handle: required('settings-resizer'), toggle: required('settings-back'),
  }, {
    read: () => preferences.readState(settingsSidebarWidthKey),
    save: width => { void preferences.saveState(settingsSidebarWidthKey, width).catch(persistenceError); },
  }, {
    widthProperty: '--settings-sidebar-width', minWidth: 160, maxWidth: 360,
    defaultWidth: () => 220, maxAvailableWidth: available => Math.min(available * .45, Math.max(0, available - 240)),
    active: () => settings.isOpen, allowedDialog: required<HTMLDialogElement>('settings-page'),
  });
  const runtimeKeys: Record<RuntimeField, ProjectSettingKey> = { pi: 'runtime.piPath', node: 'runtime.nodePath', copilot: 'runtime.copilotPath', codex: 'runtime.codexPath' };
  required('runtime-inheritance-hint').hidden = global;
  if (!global) for (const id of ['pi-path', 'node-path', 'copilot-path', 'codex-path']) {
    const field = required<HTMLInputElement>(id);
    field.required = false;
    field.setAttribute('aria-describedby', 'runtime-inheritance-hint');
  }
  let runtimeDefaults: { pi: string; node: string } | undefined;
  const runtime = installRuntimeSettings({
    form: required<HTMLFormElement>('runtime-settings'), fields: required<HTMLFieldSetElement>('runtime-fields'),
    pi: required<HTMLInputElement>('pi-path'), node: required<HTMLInputElement>('node-path'), copilot: required<HTMLInputElement>('copilot-path'), codex: required<HTMLInputElement>('codex-path'), status: required('runtime-status'),
  }, {
    read: () => runtimeDefaults ? preferences.runtime(runtimeDefaults) : null,
    save: async (paths, fields) => {
      await preferences.saveRuntime(paths, fields);
      return preferences.runtime(runtimeDefaults ?? paths);
    },
    project: global ? undefined : {
      overridden: key => preferences.isOverridden(runtimeKeys[key]),
      inherited: () => preferences.runtime(runtimeDefaults!, 'global'),
      clear: async key => {
        await preferences.useGlobal(runtimeKeys[key]);
        return preferences.runtime(runtimeDefaults!);
      },
    },
    error: (message, field) => feedback(field ? 'runtime:' + field : 'runtime', 'Save runtime paths')(message),
  });
  let selectTheme = () => {};
  const themes = installThemes({
    root: document.documentElement,
    select: required<HTMLButtonElement>('theme-picker'), current: required('theme-current'),
    importButton: required<HTMLButtonElement>('theme-import'), removeButton: required<HTMLButtonElement>('theme-remove'), file: required<HTMLInputElement>('theme-file'),
    notice: required('theme-notice'), noticeText: required('theme-notice-text'), dismiss: required<HTMLButtonElement>('theme-notice-dismiss'),
  }, {
    read: () => preferences.theme(),
    save: library => preferences.saveTheme(library), newId: () => `import-${crypto.randomUUID()}`,
    error: feedback('themes', 'Color theme'),
    libraryEdits: global, selectTheme: () => selectTheme(),
  });
  if (!global) required('theme-library-actions').hidden = true;
  if (!global) required('theme-hint').hidden = true;
  const appearance = installNativeWindowAppearance({
    read: () => preferences.windowAppearance(),
    save: patch => preferences.saveWindowAppearance(patch),
    report: (message, cause = 'native') => feedback('window-appearance:' + cause, 'Window appearance')(message),
  }, global ? {
    opacity: required<HTMLInputElement>('background-opacity'), value: required<HTMLOutputElement>('background-opacity-value'),
    blur: required<HTMLInputElement>('background-blur'),
    blurValue: required<HTMLOutputElement>('background-blur-value'),
    blurGroup: required('settings-background-blur'), hint: required('translucency-hint'),
  } : undefined);
  const zoom = installZoom(window, required<HTMLButtonElement>('zoom-level'), required('zoom-error'), {
    read: () => preferences.zoom(), save: percent => preferences.saveZoom(percent),
    apply: scale => getCurrentWebview().setZoom(scale),
    error: feedback('zoom', 'App zoom'), present: () => choiceControls?.paint(),
  }, false);
  const transcriptLogPicker = required<HTMLInputElement>('transcript-logs-mode');
  const transcriptLogStatus = required('transcript-logs-status');
  let transcriptLogPath = '', transcriptLogFailure = '', transcriptLogLoss = '';
  const transcriptLog = createTranscriptLog({
    write: (lines, captureId) => invoke('append_transcript_logs', { lines, captureId }),
    failure: message => {
      if (unloading) return;
      transcriptLogFailure = message;
      transcriptLogStatus.textContent = message;
      notices.report({ id: 'transcript-logs', operation: 'Record transcript debug logs', message });
    },
    recovered: () => { transcriptLogFailure = ''; transcriptLogLoss = ''; notices.resolve('transcript-logs'); notices.resolve('transcript-log-loss'); },
    dropped: count => {
      if (unloading) return;
      transcriptLogLoss = `Transcript logging dropped ${count} diagnostic records. Capture is incomplete; session processing is unaffected.`;
      transcriptLogStatus.textContent = transcriptLogLoss;
      notices.report({ id: 'transcript-log-loss', operation: 'Transcript debug logs', severity: 'warning', message: transcriptLogLoss });
    },
  });
  let unlistenLogErrors: UnlistenFn | undefined;
  void listen<{ captureId: string; message: string }>('transcript-log-error', event => {
    if (!unloading) transcriptLog.writeFailed(event.payload.captureId, event.payload.message);
  }).then(unlisten => {
    if (unloading) unlisten(); else unlistenLogErrors = unlisten;
  }).catch(error => {
    if (!unloading) notices.report({ id: 'transcript-log-monitor', operation: 'Monitor transcript logging', message: String(error) });
  });
  function reloadTranscriptLog(): void {
    const enabled = preferences.transcriptLogEnabled();
    transcriptLog.setEnabled(enabled && !global);
    transcriptLogPicker.checked = enabled;
    transcriptLogStatus.textContent = transcriptLogFailure || transcriptLogLoss || `${enabled ? 'Transcript debug logging enabled for project windows.' : 'Transcript debug logging is off; existing logs are retained.'}${transcriptLogPath ? ` Logs: ${transcriptLogPath}` : ''}`;
  }
  transcriptLogPicker.addEventListener('change', () => {
    transcriptLogPicker.disabled = true;
    void preferences.saveTranscriptLog(transcriptLogPicker.checked).then(() => notices.resolve('transcript-logs-settings'))
      .catch(error => notices.report({ id: 'transcript-logs-settings', operation: 'Save transcript debug logging setting', message: String(error) }))
      .finally(() => { if (!unloading) { reloadTranscriptLog(); transcriptLogPicker.disabled = false; } });
  });
  reloadTranscriptLog();
  void invoke<string>('transcript_logs_directory').then(path => {
    if (!unloading) { transcriptLogPath = path; reloadTranscriptLog(); }
  }).catch(error => {
    if (!unloading) notices.report({ id: 'transcript-logs-path', operation: 'Locate transcript debug logs', message: String(error) });
  });
  const performanceDiagnostics = installPerformanceDiagnostics(window, () => ({
    userAgent: navigator.userAgent.slice(0, 512), fieldSizing: window.CSS?.supports('field-sizing', 'content') ?? false,
    zoom: Number(preferences.zoom()), devicePixelRatio: window.devicePixelRatio, hardwareConcurrency: navigator.hardwareConcurrency || 0,
    appearance: {
      backgroundOpacity: preferences.windowAppearance().opacity,
      frostedBackground: preferences.windowAppearance().blur > 0,
      backgroundBlur: preferences.windowAppearance().blur,
      area: 'window',
      ...appearance.diagnostics(),
    },
  }));
  const performancePicker = required<HTMLInputElement>('performance-mode');
  const performanceCapture = required<HTMLButtonElement>('performance-capture');
  const performanceStatus = required('performance-status');
  let capturingPerformance = false;
  let performancePath: string | undefined;
  function reloadPerformance(): void {
    const enabled = preferences.performanceEnabled();
    const changed = enabled !== performanceDiagnostics.enabled;
    performanceDiagnostics.setEnabled(enabled && !global);
    performancePicker.checked = enabled;
    performanceCapture.disabled = !enabled || capturingPerformance;
    if (changed || !enabled) performanceStatus.textContent = enabled ? 'Timing diagnostics enabled. Capture when the app feels slow.' : 'Performance diagnostics are off.';
  }
  async function capturePerformance(copyPath = false): Promise<void> {
    if (capturingPerformance) return;
    capturingPerformance = true; reloadPerformance();
    performanceStatus.textContent = 'Capturing five more seconds of timing data…';
    if (!global) notices.report({ id: 'performance-capture', operation: 'Capture performance report', message: performanceStatus.textContent, severity: 'info' });
    try {
      const report = await performanceDiagnostics.capture();
      if (!report) { if (!unloading) { performanceStatus.textContent = 'Capture cancelled; timing buffer cleared.'; notices.resolve('performance-capture'); } return; }
      performanceStatus.textContent = 'Saving performance report…';
      const path = await invoke<string>('write_performance_report', { report });
      if (unloading) return;
      performancePath = path;
      performanceStatus.textContent = `Report saved: ${path}`;
      notices.report({ id: 'performance-capture', operation: 'Capture performance report', message: `Report saved: ${path}`, severity: 'info' });
      if (copyPath) {
        try {
          await writeText(path);
          if (!unloading) {
            notices.resolve('performance-copy');
            performanceStatus.textContent = `Report saved: ${path} · Path copied to clipboard.`;
            notices.report({ id: 'performance-capture', operation: 'Capture performance report', message: performanceStatus.textContent, severity: 'info' });
          }
        } catch (error) {
          if (!unloading) notices.report({ id: 'performance-copy', operation: 'Copy performance report path',
            message: `Report saved: ${path}. Could not copy its path: ${String(error)}` });
        }
      }
    } catch (error) {
      if (!unloading) {
        performanceStatus.textContent = '';
        notices.report({ id: 'performance-capture', operation: 'Capture performance report', message: String(error) });
      }
    } finally { capturingPerformance = false; if (!unloading) reloadPerformance(); }
  }
  performanceCapture.addEventListener('click', () => { void capturePerformance(); });
  performancePicker.addEventListener('change', () => {
    performancePicker.disabled = true;
    void preferences.savePerformance(performancePicker.checked).then(() => {
      notices.resolve('performance-settings');
    }).catch(error => {
      notices.report({ id: 'performance-settings', operation: 'Save performance diagnostics setting', message: String(error) });
    }).finally(() => { reloadPerformance(); performancePicker.disabled = false; });
  });
  reloadPerformance();
  const modalMotion = installModalMotion(document);
  const animationStyle = required<HTMLButtonElement>('modal-animation-style');
  const animationDuration = required<HTMLInputElement>('modal-animation-duration');
  const animationDurationValue = required<HTMLOutputElement>('modal-animation-duration-value');
  const animationPreview = required<HTMLDialogElement>('modal-animation-preview-dialog');
  let savingAnimation = 0, durationRevision = 0, durationEditing = false;
  let pendingStyle: ModalAnimationStyle | undefined;
  let valueKind: 'duration' | 'scanSpeed' = 'duration';
  const pixelInputs = { pixelSize: required<HTMLInputElement>('modal-pixel-size'), pixelBlur: required<HTMLInputElement>('modal-pixel-blur') };
  const pixelEditing = new Set<keyof typeof pixelInputs>();
  const pixelFade = required<HTMLInputElement>('modal-pixel-fade');
  const pixelSupport = pixelCapabilities(window.CSS);
  function showPixelValues(): void {
    updateRangeFill(pixelInputs.pixelSize); updateRangeFill(pixelInputs.pixelBlur);
    required<HTMLOutputElement>('modal-pixel-size-value').value = `${pixelInputs.pixelSize.value} px target`;
    required<HTMLOutputElement>('modal-pixel-blur-value').value = Number(pixelInputs.pixelBlur.value) === 0 ? 'Off' : `${pixelInputs.pixelBlur.value} px`;
    pixelInputs.pixelSize.setAttribute('aria-valuetext', `${pixelInputs.pixelSize.value} pixels target`);
    pixelInputs.pixelBlur.setAttribute('aria-valuetext', `${pixelInputs.pixelBlur.value} pixels content blur`);
  }
  function showAnimationDuration(): void {
    updateRangeFill(animationDuration);
    const scan = valueKind === 'scanSpeed';
    animationDurationValue.value = `${animationDuration.value} ${scan ? 'px/s' : 'ms'}`;
    animationDuration.setAttribute('aria-valuetext', `${animationDuration.value} ${scan ? 'pixels per second' : 'milliseconds'}`);
  }
  function reloadModalAnimation(force = false): void {
    const animation = preferences.modalAnimation(pendingStyle);
    applyModalAnimation(document.documentElement, animation);
    animationStyle.value = animation.style; choiceControls?.paint();
    const scan = isScanStyle(animation.style), kind = scan ? 'scanSpeed' : 'duration';
    const kindChanged = valueKind !== kind; valueKind = kind;
    animationDuration.step = scan ? '50' : '10';
    required('modal-animation-value-label').textContent = scan ? 'Scan speed (pixels/second)' : 'Duration (milliseconds)';
    if (kindChanged || force || (!durationEditing && !savingAnimation)) animationDuration.value = String(scan ? animation.scanSpeed : animation.duration);
    showAnimationDuration();
    required('modal-animation-options').hidden = animation.style === 'none';
    required('modal-pixel-options').hidden = animation.style !== 'pixel';
    for (const key of ['pixelSize', 'pixelBlur'] as const) {
      if (!pixelEditing.has(key) && (force || !savingAnimation)) pixelInputs[key].value = String(animation[key] ?? DEFAULT_PIXEL_OPTIONS[key]);
    }
    if (!savingAnimation) pixelFade.checked = animation.pixelFade ?? DEFAULT_PIXEL_OPTIONS.pixelFade;
    pixelInputs.pixelBlur.disabled = !pixelSupport.blur; pixelFade.disabled = !pixelSupport.fade;
    showPixelValues();
    required('modal-pixel-hint').textContent = 'Text and content inside each hard-edged tile sharpen and fade in. Larger panels may coarsen the grid to keep at most 96 tiles.'
      + (!pixelSupport.blur ? ' Content blur is unavailable in this renderer.' : '')
      + (!pixelSupport.fade ? ' Per-tile fading is unavailable in this renderer.' : '');
    required('modal-animation-hint').textContent = (animation.style === 'crt'
      ? 'A theme-accent horizontal line expands up and down like a CRT powering on.'
      : animation.style === 'hologram' ? 'A glowing scan line reveals the panel from top to bottom, with a soft trailing glow and no flicker.'
      : animation.style === 'pixel' ? 'Chunky shuffled tiles assemble into the panel, then dissolve away on close.'
      : animation.style === 'subtle' ? 'A short fade, lift and gentle scale.' : 'Dialogs appear and disappear instantly; your duration is remembered.')
      + (animation.style === 'crt' || animation.style === 'hologram'
        ? ' Speed is independent of modal size; closing scans 25% faster. Filtering retargets the reveal without restarting it.'
        : animation.style === 'pixel' ? ' Closing reverses the tiles without fading the panel and takes 20% less time.'
        : animation.style === 'subtle' ? ' Dismissal is 25% faster.' : '')
      + (scan ? ` Default scan speed: ${DEFAULT_SCAN_SPEEDS[animation.style as 'crt' | 'hologram']} px/s.` : ` Default duration: ${DEFAULT_MODAL_DURATIONS[animation.style]} ms.`)
      + ' Reduced motion disables animations.';
  }
  async function saveModalAnimation(values: Parameters<typeof preferences.saveModalAnimation>[0]): Promise<void> {
    const revision = durationRevision;
    const noticeId = 'modal-animation-settings:' + Object.keys(values).sort().join('+');
    savingAnimation++;
    animationStyle.disabled = true;
    try {
      await preferences.saveModalAnimation(values);
      notices.resolve(noticeId);
    } catch (error) {
      notices.report({ id: noticeId, operation: 'Save modal animation', message: String(error) });
    } finally {
      savingAnimation--;
      if (!unloading) {
        reloadModalAnimation(!durationEditing && !savingAnimation && revision === durationRevision);
        animationStyle.disabled = savingAnimation > 0;
      }
    }
  }
  const changeAnimationStyle = () => {
    pendingStyle = animationStyle.value as ModalAnimationStyle;
    reloadModalAnimation(true);
    void saveModalAnimation({ style: pendingStyle }).finally(() => { pendingStyle = undefined; if (!unloading) reloadModalAnimation(); });
  };
  const inputAnimationDuration = () => { durationRevision++; durationEditing = true; showAnimationDuration(); };
  const changeAnimationDuration = () => {
    if (!animationDuration.reportValidity()) return;
    durationRevision++; durationEditing = false;
    const values: Parameters<typeof preferences.saveModalAnimation>[0] = {};
    values[valueKind] = animationDuration.valueAsNumber;
    void saveModalAnimation(values);
  };
  animationStyle.addEventListener('change', changeAnimationStyle);
  animationDuration.addEventListener('input', inputAnimationDuration);
  animationDuration.addEventListener('change', changeAnimationDuration);
  const pixelBindings = (['pixelSize', 'pixelBlur'] as const).map(key => {
    const input = pixelInputs[key];
    const edit = () => { pixelEditing.add(key); showPixelValues(); };
    const commit = () => {
      pixelEditing.delete(key);
      const values: Parameters<typeof preferences.saveModalAnimation>[0] = {}; values[key] = input.valueAsNumber;
      void saveModalAnimation(values);
    };
    input.addEventListener('input', edit); input.addEventListener('change', commit);
    return () => { input.removeEventListener('input', edit); input.removeEventListener('change', commit); };
  });
  const changePixelFade = () => { void saveModalAnimation({ pixelFade: pixelFade.checked }); };
  pixelFade.addEventListener('change', changePixelFade);
  const previewAnimation = () => { if (!animationPreview.open) showModal(animationPreview); };
  required('modal-animation-preview').addEventListener('click', previewAnimation);
  reloadModalAnimation();
  const sendAutoFollowPicker = required<HTMLButtonElement>('send-auto-follow');
  const reloadSendAutoFollow = () => { sendAutoFollowPicker.value = preferences.sendAutoFollow(); choiceControls?.paint(); };
  const changeSendAutoFollow = () => {
    sendAutoFollowPicker.disabled = true;
    void preferences.saveSendAutoFollow(sendAutoFollowPicker.value as import('./pi/transcript-scroll').SendAutoFollow).then(() => {
      notices.resolve('send-auto-follow-settings');
    }).catch(error => {
      notices.report({ id: 'send-auto-follow-settings', operation: 'Save auto-follow setting', message: String(error) });
    }).finally(() => { if (!unloading) { reloadSendAutoFollow(); sendAutoFollowPicker.disabled = false; } });
  };
  sendAutoFollowPicker.addEventListener('change', changeSendAutoFollow);
  reloadSendAutoFollow();
  const defaultHarnessPicker = required<HTMLButtonElement>('default-harness');
  const reloadDefaultHarness = () => { defaultHarnessPicker.value = preferences.defaultHarness(); choiceControls?.paint(); };
  const changeDefaultHarness = () => {
    void preferences.saveDefaultHarness(defaultHarnessPicker.value)
      .then(() => notices.resolve('default-harness-settings'))
      .catch(error => notices.report({ id: 'default-harness-settings', operation: 'Save default harness', message: String(error) }))
      .finally(() => { if (!unloading) reloadDefaultHarness(); });
  };
  reloadDefaultHarness();
  const autocompletePicker = required<HTMLButtonElement>('autocomplete-accept');
  const reloadAutocomplete = () => { autocompletePicker.value = preferences.autocompleteAccept(); choiceControls?.paint(); };
  const changeAutocomplete = () => {
    autocompletePicker.disabled = true;
    void preferences.saveAutocompleteAccept(autocompletePicker.value as import('./autocomplete-settings').AutocompleteAccept)
      .then(() => notices.resolve('autocomplete-settings'))
      .catch(error => notices.report({ id: 'autocomplete-settings', operation: 'Save autocomplete setting', message: String(error) }))
      .finally(() => { if (!unloading) { reloadAutocomplete(); autocompletePicker.disabled = false; } });
  };
  autocompletePicker.addEventListener('change', changeAutocomplete);
  reloadAutocomplete();
  const notificationPicker = required<HTMLInputElement>('notification-mode');
  const notificationStatus = required('notification-status');
  const notificationTest = required<HTMLButtonElement>('notification-test');
  const notificationDiagnostics = required<HTMLButtonElement>('notification-diagnostics');
  let testingNotification = false, readingNotificationDiagnostics = false;
  const reloadNotifications = () => {
    notificationPicker.checked = preferences.notificationsEnabled();
    notificationTest.disabled = testingNotification || readingNotificationDiagnostics || !preferences.notificationsEnabled();
    notificationDiagnostics.disabled = testingNotification || readingNotificationDiagnostics;
  };
  const notificationProgress = (message: string) => { notificationStatus.textContent = message; };
  const notificationError = (message: string) => {
    notificationStatus.textContent = '';
    notices.report({ id: `notifications:${++noticeSequence}`, cause: 'notifications', operation: 'Desktop notifications', message });
  };
  async function refreshNotificationDiagnostics(prefix = 'Notification diagnostics.') {
    try { notificationProgress(`${prefix} ${await invoke<string>('notification_diagnostics')}`); }
    catch (error) { notificationError(`${prefix} Could not read diagnostics: ${String(error)}`); }
  }
  notificationDiagnostics.addEventListener('click', () => {
    if (testingNotification || readingNotificationDiagnostics) return;
    readingNotificationDiagnostics = true; reloadNotifications();
    notificationProgress('Reading notification diagnostics…');
    void refreshNotificationDiagnostics().finally(() => { readingNotificationDiagnostics = false; reloadNotifications(); });
  });
  notificationTest.addEventListener('click', () => {
    if (testingNotification || readingNotificationDiagnostics || !preferences.notificationsEnabled()) return;
    testingNotification = true; reloadNotifications();
    notificationProgress('Test notification: checking OS authorization and submitting…');
    void invoke<NotificationDispatch>('test_notification').then(async outcome => {
      if (outcome === 'suppressed') notificationProgress('Test notification was suppressed because the app is closing or alerts were disabled.');
      else {
        if (outcome === 'submitted') notices.store.resolveCause('notifications');
        await refreshNotificationDiagnostics('Test notification submitted to the OS.');
      }
    }).catch(error => notificationError(`Notifications: ${String(error)}`)).finally(() => {
      testingNotification = false; reloadNotifications();
    });
  });
  reloadNotifications();
  notificationPicker.addEventListener('change', () => {
    notificationPicker.disabled = true;
    void preferences.saveNotifications(notificationPicker.checked).then(() => {
      notificationStatus.textContent = 'Saved. System notification settings still apply.'; notices.resolve('notification-settings');
    }).catch(error => { notificationStatus.textContent = ''; notices.report({ id: 'notification-settings', operation: 'Save notification settings', message: String(error) }); }).finally(() => {
      reloadNotifications(); notificationPicker.disabled = false;
    });
  });

  choiceControls = installSettingsChoiceControls(document, {
    choose: (...args) => chooseSetting(...args),
    harnesses,
    apply: { 'default-harness': changeDefaultHarness, 'zoom-level': value => zoom.select(Number(value)), 'modal-animation-style': changeAnimationStyle,
      'send-auto-follow': changeSendAutoFollow, 'autocomplete-accept': changeAutocomplete },
    error: (id, error) => feedback('settings-choice:' + id, 'Change setting')(String(error)),
  });

  const sources = new Map<ProjectSettingKey, { status: HTMLElement; reset: HTMLButtonElement }>();
  if (!global) {
    const controls: [ProjectSettingKey, string][] = [
      ['appearance.theme', 'theme-picker'],
      ['interaction.autocompleteAccept', 'autocomplete-accept'],
      ['sessions.defaultHarness', 'default-harness'],
    ];
    for (const [key, id] of controls) {
      const row = document.createElement('div'); row.className = 'settings-source';
      const status = document.createElement('span'); status.id = id + '-source';
      const reset = document.createElement('button'); reset.type = 'button'; reset.className = 'settings-reset secondary utility-button'; reset.textContent = 'Remove override';
      reset.id = id + '-reset';
      reset.setAttribute('aria-label', 'Remove override for ' + (document.querySelector('label[for="' + id + '"]')?.textContent ?? id));
      required(id).setAttribute('aria-describedby', [required(id).getAttribute('aria-describedby'), status.id].filter(Boolean).join(' '));
      const setting = required(id).closest<HTMLElement>('.settings-row')!;
      setting.classList.add('settings-column-row', 'settings-provenance-row');
      const field = setting.querySelector<HTMLElement>('.settings-field')!;
      let actions = setting.querySelector<HTMLElement>('.settings-control-actions');
      if (!actions) {
        actions = document.createElement('div'); actions.className = 'settings-control-actions';
      }
      row.append(status); actions.append(reset);
      field.after(row); row.after(actions);
      sources.set(key, { status, reset });
      reset.addEventListener('click', () => {
        const restoreFocus = document.activeElement === reset;
        reset.disabled = true;
        void preferences.useGlobal(key).then(() => {
          if (unloading) return;
          const nested = [...document.querySelectorAll('dialog[open], #dialog.open')].some(dialog => dialog !== required('settings-page'));
          if (restoreFocus && settings.isOpen && !nested && !required(id).closest<HTMLElement>('.settings-panel')?.hidden && (document.activeElement === reset || document.activeElement === document.body)) required(id).focus({ preventScroll: true });
          feedback('settings-reset', 'Remove override')();
        }).catch(error => feedback('settings-reset', 'Remove override')(String(error))).finally(reloadSources);
      });
    }
  }
  function reloadSources() {
    const project = preferences.projectPath?.replace(/[\\/]\.nimrod[\\/]settings\.json$/, '');
    required('settings-title').textContent = global ? 'Settings' : 'Project settings' + (project ? ' — ' + project.split(/[\\/]/).pop() : '');
    required('settings-scope-description').textContent = global
      ? 'Global defaults for all projects. Project overrides take precedence.'
      : 'Changes here apply only to this project directory and override Global Settings.';
    required('settings-scope-description').title = project ?? '';
    required('settings-title').title = project ?? 'Global Settings';
    required('settings-file-path').textContent = preferences.paths.settings;
    required('project-settings-file-path').title = preferences.projectPath ?? '';
    required('copy-project-settings-path').title = preferences.projectPath ?? '';
    required('state-file-path').textContent = preferences.paths.state;
    for (const [key, { status, reset }] of sources) {
      const overridden = preferences.isOverridden(key);
      status.textContent = overridden ? 'Project override' : 'Inherited';
      status.dataset.source = overridden ? 'project' : 'inherited';
      reset.hidden = !overridden; reset.disabled = false;
    }
  }
  let copyRevision = 0;
  const fileCopyBindings = [
    { id: 'copy-project-settings-path', path: () => preferences.projectPath ?? '', label: 'project settings' },
    { id: 'copy-global-settings-path', path: () => preferences.paths.settings, label: 'global settings' },
    { id: 'copy-state-path', path: () => preferences.paths.state, label: 'app-managed state' },
  ].map(({ id, path, label }) => {
    const button = required<HTMLButtonElement>(id);
    const copy = () => {
      const value = path();
      if (unloading || !value) return;
      const revision = ++copyRevision;
      required('settings-file-copy-status').textContent = '';
      void writeText(value).then(() => {
        if (unloading || revision !== copyRevision) return;
        required('settings-file-copy-status').textContent = `Copied ${label} path.`;
        feedback('settings-file-copy', 'Copy settings path')();
      }).catch(error => {
        if (!unloading && revision === copyRevision) feedback('settings-file-copy', 'Copy settings path')(String(error));
      });
    };
    button.addEventListener('click', copy);
    return () => button.removeEventListener('click', copy);
  });
  required('settings-global-link').hidden = global;
  required('settings-global-link').addEventListener('click', () => {
    void invoke('open_global_settings').catch(error => feedback('open-settings', 'Open Settings')(String(error)));
  });
  if (global) {
    required('settings-back').textContent = 'Close'; required('settings-back').title = 'Close · Escape';
    required('performance-capture').hidden = true;
    required('performance-capture').nextElementSibling!.textContent = 'Capture a project window through its command palette → Capture performance report.';
  }
  const unsubscribe = preferences.subscribe(() => {
    const width = preferences.readState(settingsSidebarWidthKey);
    if (!Object.is(width, settingsSidebarWidth)) { settingsSidebarWidth = width; settingsSidebarResize.reload(); }
    runtime.reload(); themes.reload(); typography.reload(); appearance.reload(); void zoom.reload(); reloadNotifications(); reloadPerformance(); reloadTranscriptLog(); reloadSendAutoFollow(); reloadAutocomplete(); reloadDefaultHarness(); reloadModalAnimation(); keybindingEditor?.reload(); reloadSources();
  });
  reloadSources();
  return {
    settings, settingsNavigation, themes, zoom, runtime,
    onSelectTheme(action: () => void) { selectTheme = action; },
    onChooseSetting(choose: ChooseSetting) { chooseSetting = choose; },
    ready: Promise.all([appearance.ready, zoom.ready]).then(() => {}),
    async settled() { await appearance.ready; await zoom.reload(); await appearance.settled(); },
    initializeRuntime(defaults: { pi: string; node: string }) { runtimeDefaults = defaults; runtime.initialize(defaults); },
    notificationError, notificationProgress, capturePerformance,
    performanceProbe: performanceDiagnostics.probe,
    transcriptLog,
    get capturingPerformance() { return capturingPerformance; },
    get performancePath() { return performancePath; },
    openKeybindings() { settings.open(); if (settings.isOpen && settingsNavigation.select('keybindings')) keybindingEditor?.focus(); },
    dispose() {
      unloading = true; unsubscribe();
      fileCopyBindings.forEach(dispose => dispose());
      typography.dispose(); choiceControls?.dispose();
      sendAutoFollowPicker.removeEventListener('change', changeSendAutoFollow);
      autocompletePicker.removeEventListener('change', changeAutocomplete);
      required('modal-animation-preview').removeEventListener('click', previewAnimation);
      animationStyle.removeEventListener('change', changeAnimationStyle);
      animationDuration.removeEventListener('input', inputAnimationDuration);
      animationDuration.removeEventListener('change', changeAnimationDuration);
      pixelBindings.forEach(dispose => dispose()); pixelFade.removeEventListener('change', changePixelFade);
      if (animationPreview.open) closeModal(animationPreview);
      performanceDiagnostics.dispose(); transcriptLog.dispose(); unlistenLogErrors?.();
      keybindingEditor?.dispose(); settingsNavigation.dispose(); settingsSidebarResize.dispose();
      appearance.dispose(); zoom.dispose(); themes.dispose(); runtime.dispose(); settings.dispose(); modalMotion.dispose();
    },
  };
}
