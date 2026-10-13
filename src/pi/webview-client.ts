import { createMainActivityDom, createSubagentActivityDom, renderMainActivity, renderSubagentActivity } from "./activity-dom";
import { formatNativeSessionStats } from "./session-stats";
import { installSlashCompletion } from "./slash-completion";

import { reconcileContentBlock } from "./content-dom";
import { informationalExtensionStatuses, presentActivity } from "./activity-state";
import { clearDraft, ComposerState, recoverClearedQueue, restoreRecoveredQueueItem, SubmissionMode, updateDraft } from "./composer-state";
import { keyboardHint, keyboardSubmissionMode, renderPrimaryAction, resizeComposer } from "./composer-dom";
import { codeBlockSource, createSafeMarkdownRenderer, isSafeLink } from "./safe-markdown";
import { showCopyResult, setCodeIcon } from './code-actions';
import { persistWebviewState, restoreComposerState } from "./webview-state";
import { captureStreamingOutput, createToolDetails, renderToolCard as renderToolCardDom, restoreStreamingOutput, updateToolCard, toolCardIsBusy, disposeToolCard } from "./tool-card";
import { ToolDisclosureController } from "./tool-disclosure";
import { toolMessageBlock } from "./tool-call";
import { TranscriptScroll } from "./transcript-scroll";
import { disposeParallelCard } from './parallel-card';
import { renderReasoningCard, updateReasoningCard, disposeReasoningCard } from "./reasoning-card";
import { transcriptRolePresentation } from "./transcript-presentation";
import { SteeringTranscript, steeringStatusLabel, type SteeringStatus } from "./steering-transcript";
import { renderSkillInvocation } from "./skill-invocation";
import { clipboardImages, imageContent, validImageContent, validateAttachments } from './image-attachments';
import { renderParallelToolCard, type ParallelToolCluster } from "./tool-progress";

export interface PiView { setActive(active: boolean): void; scrollToBottom(): void; dispose(): void; }

export function mountPiView(host: import('./view-host').ViewHost, root: HTMLElement | Document = document): PiView {
  let active = true;
  let disposed = false;
  const listeners = new AbortController();
  const markdown = createSafeMarkdownRenderer(window);
  const messages = required("messages");
  const transcriptViewport = required("transcript-viewport");
  // One sticky stack keeps multiple queued turns from covering one another.
  const queuedTurns = document.createElement('div');
  queuedTurns.className = 'queued-turns';
  queuedTurns.hidden = true;
  messages.append(queuedTurns);
  const prompt = required<HTMLTextAreaElement>("prompt");
  const send = required<HTMLButtonElement>("send");
  const attachmentTray = document.createElement('div'); attachmentTray.className = 'composer-attachments'; attachmentTray.setAttribute('aria-label', 'Image attachments');
  required('composer').prepend(attachmentTray);
  const attachmentUrls = new Map<string, string>();
  let composerGeneration = 0;
  let preparing = 0;
  let attachmentSignature = '';
  let errorNoticeText: string | undefined;
  let errorNoticeSequence = 0;
  let composerNoticeCause: string | undefined;
  let composerNoticeOperation: string | undefined;
  const keyboardHintNode = required("keyboard-hint");
  const model = required<HTMLButtonElement>("model");
  const thinking = required<HTMLButtonElement>("thinking");
  const activity = required("activity");
  const mainActivity = required("main-activity");
  const subagentActivity = required("subagent-activity");
  const sessionMetrics = required("session-metrics");
  const extensionActivity = required("extension-activity");
  const queueActivity = required("queue-activity");
  const submissionNotice = required("submission-notice");
  const mainActivityDom = createMainActivityDom(mainActivity);
  const subagentActivityDom = createSubagentActivityDom(subagentActivity);
  const dialog = required("dialog");
  const dialogTitle = required("dialog-title");
  const dialogText = required<HTMLTextAreaElement>("dialog-text");
  let editorRequest: string | undefined;
  let deletionLocked = false;
  let pendingState: State | undefined;
  let displayedState: State = {};
  let renderScheduled = false;
  let composerResizeFrame: number | undefined;
  const rendered = new Map<string, { node: HTMLElement; signature: string }>();
  let steeringTranscript = new SteeringTranscript();
  const expanded = new Map<string, boolean>();
  const toolCards = new Map<string, HTMLDetailsElement>();
  const transcriptScroll = new TranscriptScroll(window, transcriptViewport);
  const updateMotion = () => messages.classList.toggle('transcript-motion-paused', !active || document.hidden);
  document.addEventListener('visibilitychange', updateMotion, { signal: listeners.signal });
  updateMotion();
  const toolDisclosure = new ToolDisclosureController(expanded, undefined, () => {
    transcriptScroll.request(transcriptScroll.capture());
  });
  const resizeTranscript = () => transcriptScroll.resize();
  const transcriptResizeObserver = "ResizeObserver" in window ? new ResizeObserver(entries => {
    const height = entries[0]?.contentRect.height;
    // Bound to the actual pane, not the window (composer growth and zoom matter).
    if (height && height > 0) {
      const maxHeight = `${height * 0.4}px`;
      if (queuedTurns.style.maxHeight !== maxHeight) queuedTurns.style.maxHeight = maxHeight;
    }
    resizeTranscript();
  }) : undefined;
  transcriptResizeObserver?.observe(transcriptViewport);
  window.addEventListener("resize", resizeTranscript, { passive: true, signal: listeners.signal });
  function dispose(): void {
    disposed = true;
    if (composerResizeFrame !== undefined) window.cancelAnimationFrame(composerResizeFrame);
    composerGeneration++;
    for (const url of attachmentUrls.values()) URL.revokeObjectURL(url);
    attachmentUrls.clear();
    listeners.abort();
    toolDisclosure.dispose();
    for (const entry of rendered.values()) disposeMessageCards(entry.node);
    for (const card of toolCards.values()) disposeToolCard(card);
    toolCards.clear();
    transcriptScroll.dispose();
    transcriptResizeObserver?.disconnect();
  }
  window.addEventListener("unload", dispose, { once: true, signal: listeners.signal });
  const pendingCopies = new Map<string, { button: HTMLButtonElement; status: HTMLElement }>();
  let nextCopyRequest = 0;
  let nextSubmissionId = 0;
  const savedState = host.getState();
  const bootstrapRestore = (window as Window & { __PI_GUI_RESTORE__?: unknown }).__PI_GUI_RESTORE__;
  let persistedState: unknown = savedState && typeof savedState === "object" && !Array.isArray(savedState)
    ? { ...(savedState as Record<string, unknown>), ...(bootstrapRestore ? { restore: bootstrapRestore } : {}) }
    : (bootstrapRestore ? { restore: bootstrapRestore } : {});
  let composer = restoreComposerState(persistedState);
  // A temporary process is deliberately not restarted, so queue/history recovery
  // would describe a conversation that no longer exists. The draft remains intact.
  if (isTemporaryRestore(bootstrapRestore)) composer = { ...composer, recovered: [], queue: { steering: [], followUp: [], authoritative: false } };
  prompt.value = composer.draft;
  sizeComposer();
  const slashCompletion = installSlashCompletion(prompt, required("slash-suggestions"), text => updateComposer(updateDraft(composer, text)));

  function post(type: string, extra: Record<string, unknown> = {}): void { host.postMessage({ type, ...extra }); }
  function required<T extends HTMLElement = HTMLElement>(id: string): T {
    const node = root.querySelector(`[data-pi-id="${id}"], #${id}`);
    if (!node) throw new Error(`Missing #${id}`);
    return node as T;
  }
  function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string): HTMLElementTagNameMap[K] {
    const node = document.createElement(tag);
    if (className) node.className = className;
    return node;
  }
  function safeText(value: unknown): string { return typeof value === "string" ? value : ""; }
  function isTemporaryRestore(value: unknown): boolean {
    return !!value && typeof value === "object" && !Array.isArray(value) && (value as { temporary?: unknown }).temporary === true;
  }

  function persistComposer(): void {
    persistedState = persistWebviewState(persistedState, composer);
    host.setState(persistedState);
  }

  function sizeComposer(): void {
    if (host.performance) host.performance.measure('composer-layout', () => resizeComposer(prompt), active);
    else resizeComposer(prompt);
  }

  function resizePrompt(): void {
    if (composerResizeFrame !== undefined) window.cancelAnimationFrame(composerResizeFrame);
    composerResizeFrame = undefined;
    if (active && !disposed) sizeComposer();
  }

  function schedulePromptResize(): void {
    if (!active || composerResizeFrame !== undefined || window.CSS?.supports('field-sizing', 'content')) return;
    // Keep forced geometry measurement out of the native input handler and
    // coalesce rapid edits. TranscriptScroll still owns follow/reading intent.
    composerResizeFrame = window.requestAnimationFrame(() => {
      composerResizeFrame = undefined;
      if (active && !disposed) sizeComposer();
    });
  }

  function updateComposer(next: ComposerState): void {
    const draftOnly = next.attachments === composer.attachments
      && next.lastError === composer.lastError
      && next.recovered === composer.recovered && next.queue === composer.queue;
    const recoveryChanged = next.recovered !== composer.recovered;
    composer = next;
    if (prompt.value !== composer.draft) prompt.value = composer.draft;
    if (draftOnly) schedulePromptResize();
    else resizePrompt();
    // Only editable drafts and authoritative queue recovery are persisted.
    persistComposer();
    if (recoveryChanged) renderActivity(displayedState);
    if (!draftOnly) renderComposer();
    slashCompletion.refresh();
  }

  function renderAttachments(): void {
    const signature = JSON.stringify([composer.attachments, deletionLocked, displayedState.compacting, preparing]);
    if (signature === attachmentSignature) return;
    attachmentSignature = signature;
    const images = composer.attachments ?? [];
    for (const [id, url] of attachmentUrls) if (!images.some(image => image.id === id)) { URL.revokeObjectURL(url); attachmentUrls.delete(id); }
    for (const old of attachmentTray.querySelectorAll<HTMLElement>('[data-image-id]')) if (!images.some(image => image.id === old.dataset.imageId)) host.resolveNotice?.(`image-preview:${old.dataset.imageId}`);
    attachmentTray.replaceChildren(); attachmentTray.hidden = !images.length && !preparing;
    for (const image of images) {
      const card = element('div', 'composer-attachment'); card.dataset.imageId = image.id;
      const preview = element('img'); preview.alt = image.name; preview.width = 72; preview.height = 72;
      const remove = element('button'); remove.type = 'button'; remove.textContent = '×'; remove.title = `Remove ${image.name}`; remove.setAttribute('aria-label', remove.title);
      remove.disabled = deletionLocked || displayedState.compacting === true;
      remove.addEventListener('click', () => { updateComposer({ ...composer, attachments: composer.attachments?.filter(item => item.id !== image.id) }); if (active && !document.querySelector('dialog[open]')) prompt.focus({ preventScroll: true }); });
      card.append(preview, remove); attachmentTray.append(card);
      const url = attachmentUrls.get(image.id);
      if (url) preview.src = url;
      else if (host.attachments) {
        const generation = composerGeneration;
        void host.attachments.get(image).then(blob => {
          if (disposed || generation !== composerGeneration || !composer.attachments?.some(item => item.id === image.id)) return;
          const loaded = attachmentUrls.get(image.id) ?? URL.createObjectURL(blob); attachmentUrls.set(image.id, loaded);
          for (const node of attachmentTray.querySelectorAll<HTMLImageElement>('img')) if (node.parentElement?.dataset.imageId === image.id) node.src = loaded;
        }).catch(error => {
          if (!disposed && generation === composerGeneration && composer.attachments?.some(item => item.id === image.id)) {
            card.classList.add('error'); preview.alt = 'Image unavailable';
            host.reportNotice?.({ id: `image-preview:${image.id}`, cause: `image:${image.id}`, operation: `Read image: ${image.name}`, message: String(error) });
          }
        });
      }
    }
    if (preparing) { const status = element('span'); status.textContent = 'Preparing images…'; attachmentTray.append(status); }
  }

  function renderComposer(): void {
    renderAttachments();
    const mainBusy = displayedState.busy === true;
    const compacting = displayedState.compacting === true;
    const wasLocked = prompt.readOnly;
    prompt.readOnly = compacting || deletionLocked;
    prompt.setAttribute("aria-busy", String(compacting));
    if (wasLocked !== prompt.readOnly) {
      slashCompletion.refresh();
    }
    renderPrimaryAction(send, {
      mainBusy,
      preparing: preparing > 0,
      sessionUnavailable: displayedState.sessionUnavailable === true,
    });
    keyboardHintNode.textContent = compacting ? "Compacting context… · Stop to cancel" : keyboardHint(mainBusy);
    if (compacting) {
      send.title = "Cancel compaction";
      send.setAttribute("aria-label", "Cancel compaction");
    }
    if (host.reportNotice) {
      submissionNotice.hidden = true; submissionNotice.replaceChildren();
      if (composer.lastError && composer.lastError !== errorNoticeText) {
        host.reportNotice({ id: `composer:${++errorNoticeSequence}`, operation: composerNoticeOperation || 'Send message', message: composer.lastError, cause: composerNoticeCause, priority: composerNoticeOperation === 'Message delivery unknown' ? 100 : composerNoticeCause ? 20 : undefined });
        composerNoticeCause = undefined; composerNoticeOperation = undefined;
      }
      errorNoticeText = composer.lastError;
      if (displayedState.recoveryNotice) host.reportNotice({ id: 'session-recovery', operation: 'Session unavailable', message: displayedState.recoveryNotice });
      else host.resolveNotice?.('session-recovery');
      return;
    }
    if (displayedState.recoveryNotice) {
      submissionNotice.hidden = false;
      submissionNotice.textContent = displayedState.recoveryNotice;
      return;
    }
    if (composer.lastError) {
      submissionNotice.hidden = false;
      submissionNotice.textContent = composer.lastError;
      return;
    }
    submissionNotice.hidden = true;
    submissionNotice.textContent = "";
  }

  function renderMarkdown(value: unknown, detectUnlabeledCode = false): HTMLElement {
    const root = element("div", "markdown");
    root.innerHTML = markdown.render(safeText(value), { detectUnlabeledCode });
    return root;
  }

  function cardDomHost(): import('./dom-card-renderer').CardDomHost {
    return {
      markdown: renderMarkdown,
      code: (source, language) => { const node = element('div', 'markdown'); node.innerHTML = markdown.renderCode(source, language); return node; },
      copy: host.cardActions?.copy,
      openLink: host.cardActions ? async href => { if (!isSafeLink(href)) throw new Error('Unsupported card link'); await host.cardActions!.openLink(href); } : undefined,
      popOutCode: host.cardActions?.popOutCode,
      beforeChange: () => transcriptScroll.request(transcriptScroll.capture()),
      afterChange: () => transcriptScroll.resize(),
      canInteract: () => active && !disposed && !document.querySelector('dialog[open]'),
      report: reportRenderError,
    };
  }

  function renderToolCard(block: ContentBlock, detailKey: string): HTMLDetailsElement {
    // Identity belongs to the invocation, not its current message/placement.
    const key = safeText(block.id) ? `tool:${safeText(block.id)}` : detailKey;
    let details = toolCards.get(key);
    if (details) updateToolCard(document, details, block);
    else {
      details = renderToolCardDom(document, block, toolDetail(key), host.cardRenderer?.(block), reportRenderError, cardDomHost());
      toolCards.set(key, details);
    }
    applyToolDetailsLifecycle(details, block);
    return details;
  }

  function contentBlockKey(block: ContentBlock, index: number): string {
    const type = safeText(block.type);
    return type === "toolCall" ? `tool:${safeText(block.id) || index}` : `${type}:${index}`;
  }

  function renderUserText(text: unknown, key: string, previous?: HTMLElement): HTMLElement {
    const renderUserMarkdown = (value: string) => renderMarkdown(value, true);
    return renderSkillInvocation(document, safeText(text), key, expanded, renderUserMarkdown, previous) ?? renderMarkdown(text, true);
  }

  function renderBlock(block: ContentBlock, messageKey: string, index: number, role?: string, previous?: HTMLElement): HTMLElement | undefined {
    const type = safeText(block.type);
    const node = type === 'image' ? renderImage(block, previous) : type === "text" ? (role === "user" ? renderUserText(block.text, `${messageKey}:skill:${index}`, previous) : renderMarkdown(block.text))
      : type === "thinking" ? renderReasoningCard(document, expanded, `${messageKey}:thinking:${index}`, block.thinking, renderMarkdown, block.thinkingComplete === false, cardDomHost())
        : type === "toolCall" ? renderToolCard(block, `${messageKey}:tool:${safeText(block.id) || index}`)
          : renderMarkdown(`[${type}]`);
    if (!node) return undefined;
    node.dataset.blockKey = contentBlockKey(block, index);
    return node;
  }

  function renderImage(block: ContentBlock, previous?: HTMLElement): HTMLElement {
    if (validImageContent(block) && previous?.querySelector('img')?.getAttribute('src') === `data:${block.mimeType};base64,${block.data}`) return previous;
    const container = element('div', 'transcript-image');
    if (!validImageContent(block)) { container.textContent = '[Unsupported or invalid image]'; return container; }
    const image = element('img'); image.alt = 'Attached image'; image.src = `data:${block.mimeType};base64,${block.data}`;
    image.addEventListener('load', () => transcriptScroll.resize(), { once: true });
    image.addEventListener('error', () => { container.textContent = '[Image could not be decoded]'; transcriptScroll.resize(); }, { once: true });
    container.append(image); return container;
  }

  function renderMessage(message: DisplayMessage): HTMLElement {
    const role = safeText(message.role);
    const article = element("article", `message ${role}`);
    article.dataset.key = safeText(message.key);
    const presentation = transcriptRolePresentation(role, safeText(message.toolName));
    if (presentation.ariaLabel) article.setAttribute("aria-label", presentation.ariaLabel);
    if (presentation.visibleLabel) {
      const label = element("div", "label");
      label.textContent = presentation.visibleLabel;
      article.append(label);
    }
    renderSteeringStatus(article, message);
    if (message.isError) article.classList.add("error");
    if (message.role === "parallel" && message.parallelCluster) {
      article.append(renderParallelToolCard(document, message.parallelCluster, undefined, cardDomHost()));
      return article;
    }
    if (message.role === "tool") {
      const tool = renderToolCard(toolMessageBlock(message), `${message.key}:tool:${message.toolCallId || "unknown"}`);
      tool.dataset.blockKey = "tool:message";
      article.append(tool);
      return article;
    }
    if (message.role === "bashExecution") {
      const pre = element("pre");
      pre.textContent = `${safeText(message.content)}\n${safeText(message.output)}`;
      article.append(pre);
      return article;
    }
    if (Array.isArray(message.content)) message.content.forEach((block, index) => {
      const node = renderBlock(block, safeText(message.key), index, role);
      if (node) article.append(node);
    });
    else {
      const text = role === "user" ? renderUserText(message.content, `${message.key}:skill:0`) : renderMarkdown(message.content);
      text.dataset.blockKey = "text:0";
      article.append(text);
    }
    return article;
  }

  function renderSteeringStatus(node: HTMLElement, message: DisplayMessage): void {
    let label = node.querySelector<HTMLElement>(".steering-status");
    node.classList.toggle('queued-turn', message.queued === true);
    node.classList.toggle('sticky-turn', message.sticky === true);
    const pending = message.steeringStatus === 'sending' || message.steeringStatus === 'pending';
    const showSteering = message.steering && pending;
    if (!message.steeringStatus || (pending && !message.queued && !showSteering)) { label?.remove(); return; }
    if (!label) {
      label = element("div", "steering-status");
      label.append(element('span', 'delivery-status-text'));
      node.prepend(label);
    }
    const text = label.firstElementChild as HTMLElement;
    const status = pending ? message.queued ? 'Queued' : 'Steering' : steeringStatusLabel(message.steeringStatus);
    if (text.textContent !== status) text.textContent = status;
    text.classList.toggle('delivery-status-shimmer', pending);
    node.setAttribute("aria-label", `User message: ${status}`);
  }

  function disposeMessageCards(node: HTMLElement): void {
    for (const card of node.querySelectorAll<HTMLDetailsElement>('.reasoning-card')) disposeReasoningCard(card);
    for (const card of node.querySelectorAll<HTMLDetailsElement>('.parallel-tool-card')) disposeParallelCard(card);
  }

  /** Patches tool cards in their existing article so active spinner nodes never disconnect. */
  function patchMessage(node: HTMLElement, message: DisplayMessage): boolean {
    if (node.dataset.key !== safeText(message.key) || node.classList.contains(safeText(message.role)) === false) return false;
    node.classList.toggle("error", message.isError === true);
    if (message.role === "user") node.setAttribute("aria-label", "User message");
    renderSteeringStatus(node, message);
    if (message.role === "parallel" && message.parallelCluster) {
      const details = node.querySelector<HTMLDetailsElement>(".parallel-tool-card");
      if (!details) return false;
      renderParallelToolCard(document, message.parallelCluster, details);
      return true;
    }
    if (message.role === "tool") {
      const tool = Array.from(node.children).find((child): child is HTMLDetailsElement => child instanceof HTMLDetailsElement && child.classList.contains("tool-card"));
      if (!tool) return false;
      node.setAttribute("aria-label", transcriptRolePresentation("tool", safeText(message.toolName)).ariaLabel!);
      const block = toolMessageBlock(message);
      updateToolCard(document, tool, block);
      applyToolDetailsLifecycle(tool, block);
      return true;
    }
    if (!Array.isArray(message.content)) {
      if (message.role !== "user" || node.querySelectorAll("[data-block-key]").length !== 1) return false;
      const previous = node.querySelector<HTMLElement>('[data-block-key="text:0"]') ?? undefined;
      if (!previous) return false;
      const text = renderUserText(message.content, `${message.key}:skill:0`, previous);
      text.dataset.blockKey = "text:0";
      reconcileContentBlock(node, previous, text, previous);
      return true;
    }

    const blockChildren = (): HTMLElement[] => Array.from(node.children)
      .filter((child): child is HTMLElement => child instanceof HTMLElement && !!child.dataset.blockKey);
    const existing = new Map(blockChildren().map((child) => [child.dataset.blockKey!, child]));
    let visibleIndex = 0;
    message.content.forEach((block, index) => {
      const key = contentBlockKey(block, index);
      const previous = existing.get(key);
      const blockNode = safeText(block.type) === "toolCall" && previous instanceof HTMLDetailsElement
        ? (updateToolCard(document, previous, block), applyToolDetailsLifecycle(previous, block), previous)
        : safeText(block.type) === "thinking" && previous instanceof HTMLDetailsElement && typeof block.thinking === "string" && block.thinking.trim()
          ? (updateReasoningCard(previous, block.thinking, renderMarkdown, block.thinkingComplete === false), previous)
          : renderBlock(block, safeText(message.key), index, safeText(message.role), previous);
      if (previous && previous !== blockNode && previous.classList.contains('reasoning-card')) disposeReasoningCard(previous as HTMLDetailsElement);
      reconcileContentBlock(node, previous, blockNode, blockChildren()[visibleIndex]);
      if (blockNode) visibleIndex++;
      existing.delete(key);
    });
    for (const stale of existing.values()) {
      if (stale.classList.contains('reasoning-card')) disposeReasoningCard(stale as HTMLDetailsElement);
      stale.remove();
    }
    return true;
  }

  /** Only a real execution-update stream—not a final result or model thinking—qualifies a card. */
  function applyToolDetailsLifecycle(details: HTMLDetailsElement, block: ContentBlock): void {
    toolDisclosure.update(details, toolCardIsBusy(block), block.toolStatus === "running", block.hasStreamingOutput === true);
  }

  function toolDetail(key: string): HTMLDetailsElement {
    let details: HTMLDetailsElement;
    details = createToolDetails(document, expanded, key, false, manualKey => {
      toolDisclosure.manualToggle(manualKey);
      transcriptScroll.cancel();
      if (details.open) revealExpandedCard(details);
    });
    return details;
  }

  /** Manual disclosure is a local reveal, never an automatic bottom-follow request. */
  function revealExpandedCard(details: HTMLDetailsElement): void {
    requestAnimationFrame(() => {
      if (!details.isConnected || !details.open) return;
      const viewport = transcriptViewport.getBoundingClientRect();
      const bounds = details.getBoundingClientRect();
      const margin = 12;
      if (bounds.bottom > viewport.bottom - margin) transcriptViewport.scrollTop += bounds.bottom - viewport.bottom + margin;
      else if (bounds.top < viewport.top + margin) transcriptViewport.scrollTop += bounds.top - viewport.top - margin;
    });
  }

  async function copyCode(button: HTMLButtonElement): Promise<void> {
    const block = button.closest(".code-block");
    const source = block ? codeBlockSource(block) : undefined;
    const status = button.parentElement?.querySelector<HTMLElement>(".code-copy-status");
    if (source === undefined || !status) return;

    button.disabled = true;
    status.textContent = "Copying…";
    try {
      if (host.cardActions) await host.cardActions.copy(source);
      else {
        if (!navigator.clipboard?.writeText) throw new Error('Clipboard API unavailable');
        await navigator.clipboard.writeText(source);
      }
      setCopyStatus(button, status, true);
    } catch (error) {
      if (host.cardActions) { setCopyStatus(button, status, false, String(error)); return; }
      const id = `copy-${++nextCopyRequest}`;
      pendingCopies.set(id, { button, status });
      post("copyCode", { id, text: source });
    }
  }

  function setCopyStatus(button: HTMLButtonElement, status: HTMLElement, success: boolean, detail?: string): void {
    if (!success && host.reportNotice) {
      button.disabled = false; status.textContent = ''; setCodeIcon(button, 'copy');
      host.reportNotice({ id: `clipboard:${++nextCopyRequest}`, operation: 'Copy code', message: detail || 'Could not copy code to the clipboard.' });
    } else showCopyResult(button, status, success);
  }

  function receiveCopyResult(id: string | undefined, success: boolean): void {
    if (!id) return;
    const pending = pendingCopies.get(id);
    if (!pending) return;
    pendingCopies.delete(id);
    setCopyStatus(pending.button, pending.status, success);
  }

  function renderModelControls(state: State): void {
    const controls = state.modelControls;
    const current = controls?.model;
    const modelId = current ? safeText(current.id) : "No model";
    const modelIdentity = current ? `${safeText(current.provider)}/${safeText(current.id)}` : "unavailable";
    model.textContent = controls?.ready ? modelId : "Loading model…";
    model.title = controls?.ready ? `Select model: ${modelIdentity}` : "Loading model";
    model.setAttribute("aria-label", model.title);
    const thinkingLevel = controls?.ready ? controls.thinkingLevel || "unavailable" : "Loading…";
    thinking.textContent = thinkingLevel;
    thinking.title = controls?.ready ? `Select thinking level: ${thinkingLevel}` : "Loading thinking level";
    thinking.setAttribute("aria-label", thinking.title);
    const enabled = controls?.ready === true && controls.changing !== true && state.sessionUnavailable !== true;
    model.disabled = !enabled;
    // Empty startup metadata is not a permanent capability decision. The picker
    // queries Pi again and explains missing-model/unsupported states explicitly.
    thinking.disabled = !enabled;
  }

  function renderActivity(state: State): { busy: boolean; text: string } {
    const presentation = presentActivity(!!state.busy, state.status, state.extensionStatuses);
    mainActivity.hidden = false;
    renderMainActivity(mainActivityDom, presentation);
    renderSubagentActivity(subagentActivityDom, presentation.subagents);
    if (state.sessionStats && typeof state.sessionStats === "object") {
      sessionMetrics.hidden = false;
      sessionMetrics.textContent = formatNativeSessionStats(state.sessionStats);
    } else {
      sessionMetrics.hidden = true;
      sessionMetrics.textContent = "";
    }

    extensionActivity.replaceChildren();
    const informational = informationalExtensionStatuses(state.extensionStatuses);
    const widgets = extensionWidgets(state.extensionWidgets);
    for (const [key, text] of informational) extensionActivity.append(activityRow(key, text));
    for (const [key, lines] of widgets) {
      for (const line of lines) extensionActivity.append(activityRow(key, line));
    }
    extensionActivity.hidden = extensionActivity.childElementCount === 0;
    queueActivity.replaceChildren();
    const queue = state.queue;
    if (queue?.authoritative) {
      const count = queue.steering?.length || 0;
      if (count) queueActivity.append(activityRow("steering", `${count} pending`));
      const followUps = queue.followUp?.length || 0;
      if (followUps) queueActivity.append(activityRow("queued", `${followUps} pending`));
    } else if (typeof queue?.pendingCount === "number" && queue.pendingCount > 0) {
      queueActivity.append(activityRow("Pi queue", `${queue.pendingCount} message${queue.pendingCount === 1 ? "" : "s"} pending; text unavailable until Pi sends a queue update.`));
    }
    for (const item of composer.recovered) {
      const row = activityRow(`Recovered ${item.kind}`, item.text);
      const restore = element("button");
      restore.type = "button";
      restore.dataset.recoveryId = item.id;
      restore.textContent = "Restore";
      row.append(restore);
      queueActivity.append(row);
    }
    queueActivity.hidden = queueActivity.childElementCount === 0;
    activity.hidden = false;
    return presentation;
  }

  function activityRow(label: string, text: string): HTMLElement {
    const row = element("div", "activity-row");
    const heading = element("strong");
    heading.textContent = label;
    const value = element("span");
    value.textContent = text;
    row.append(heading, value);
    return row;
  }

  function extensionWidgets(value: unknown): Array<[string, string[]]> {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    return Object.entries(value).flatMap(([key, widget]) => {
      if (!widget || typeof widget !== "object" || Array.isArray(widget)) return [];
      const lines = (widget as { lines?: unknown }).lines;
      return Array.isArray(lines) && lines.every((line) => typeof line === "string") ? [[key, lines]] : [];
    });
  }

  let lastRenderError = "";
  let activeBuild = "unknown";
  function reportRenderError(error: unknown): void {
    const text = error instanceof Error ? error.stack || error.message : String(error);
    if (text !== lastRenderError) {
      post("renderError", { error: `[Build ${activeBuild}] ${text}`.slice(0, 8000) });
      lastRenderError = text;
    }
  }
  window.addEventListener("error", event => { if (active) reportRenderError(event.error || event.message); }, { signal: listeners.signal });
  window.addEventListener("unhandledrejection", event => { if (active) reportRenderError(event.reason); }, { signal: listeners.signal });

  function queueRender(state: State): void {
    pendingState = state;
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      const snapshot = pendingState;
      pendingState = undefined;
      if (!snapshot || disposed) return;
      try {
        render(snapshot);
      } catch (error) {
        reportRenderError(error);
        // Recover from a broken incremental patch using the authoritative snapshot.
        for (const entry of rendered.values()) disposeMessageCards(entry.node);
        rendered.clear();
        queuedTurns.replaceChildren();
        messages.replaceChildren(queuedTurns);
        const display = steeringTranscript.project(Array.isArray(snapshot.messages) ? snapshot.messages : []);
        for (const [index, message] of display.entries()) {
          const key = safeText(message.key) || `message-${index}`;
          try {
            const node = renderMessage(message);
            if (message.sticky) queuedTurns.append(node);
            else messages.insertBefore(node, queuedTurns);
            rendered.set(key, { node, signature: JSON.stringify(message) });
          }
          catch (messageError) {
            reportRenderError(messageError);
            const fallback = element("pre", "message error");
            fallback.textContent = `Unable to render this message. Raw content:\n${JSON.stringify(message.content, null, 2)}`;
            messages.insertBefore(fallback, queuedTurns);
            rendered.set(key, { node: fallback, signature: JSON.stringify(message) });
          }
        }
        queuedTurns.hidden = queuedTurns.childElementCount === 0;
      }
    });
  }

  function render(state: State): void {
    if (host.performance) host.performance.measure('transcript-render', () => renderState(state), active);
    else renderState(state);
  }

  function renderState(state: State): void {
    const wasAtBottom = transcriptScroll.capture();
    const outputPositions = new Map(Array.from(toolCards, ([key, card]) => [key, captureStreamingOutput(card)]));
    displayedState = state;
    renderActivity(state);
    renderModelControls(state);
    renderComposer();

    const nextKeys = new Set<string>();
    const display = steeringTranscript.project(Array.isArray(state.messages) ? state.messages : []);
    let normalIndex = 0;
    let stickyIndex = 0;
    display.forEach((message, index) => {
      const key = safeText(message.key) || `message-${index}`;
      nextKeys.add(key);
      const signature = JSON.stringify(message);
      let entry = rendered.get(key);
      if (!entry || entry.signature !== signature) {
        if (entry && patchMessage(entry.node, message)) {
          entry.signature = signature;
        } else {
          const node = renderMessage(message);
          if (entry) { disposeMessageCards(entry.node); entry.node.replaceWith(node); }
          entry = { node, signature };
          rendered.set(key, entry);
        }
      }
      const parent = message.sticky ? queuedTurns : messages;
      const currentAtIndex = parent.children.item(message.sticky ? stickyIndex++ : normalIndex++);
      if (currentAtIndex !== entry.node) parent.insertBefore(entry.node, currentAtIndex || (parent === messages && queuedTurns.parentElement === messages ? queuedTurns : null));
    });
    for (const [key, entry] of rendered) {
      if (!nextKeys.has(key)) {
        disposeMessageCards(entry.node);
        entry.node.remove();
        rendered.delete(key);
      }
    }
    queuedTurns.hidden = queuedTurns.childElementCount === 0;
    // The stack is always last, after ordinary pending and authoritative turns.
    if (queuedTurns.hidden) queuedTurns.remove();
    else if (messages.lastElementChild !== queuedTurns) messages.append(queuedTurns);
    for (const [key, card] of toolCards) {
      if (!card.isConnected) {
        disposeToolCard(card);
        toolDisclosure.remove(key);
        toolCards.delete(key);
      }
      else requestAnimationFrame(() => {
        if (!disposed && card.isConnected) restoreStreamingOutput(card, outputPositions.get(key));
      });
    }
    transcriptScroll.request(wasAtBottom);
  }

  function submit(mode: SubmissionMode = "normal"): void {
    if (deletionLocked || preparing) return;
    const text = composer.draft.trim();
    if (composer.attachments?.length && text.startsWith('/')) { updateComposer({ ...composer, lastError: 'Send images with a message, not a slash command. Your draft was kept.' }); return; }
    const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(text);
    if (/^\/(?:resume|delete|new|fork|clone|tree|reload|quit)(?:\s|$)/.test(text)) {
      updateComposer({ ...composer, lastError: 'Use the project session controls for session management. This slash operation is not supported; nothing was sent.' }); return;
    }
    if (compact && (displayedState.sessionUnavailable || displayedState.busy || displayedState.compacting)) {
      updateComposer({ ...composer, lastError: 'Manual compaction is available only while Pi is idle. Your draft was kept.' }); return;
    }
    if (displayedState.sessionUnavailable || displayedState.compacting || (!text && !composer.attachments?.length)) return;
    const id = `submission-${Date.now()}-${++nextSubmissionId}`;
    const submittedText = composer.draft;
    const generation = composerGeneration;
    // Start every image read before clearing the draft releases temporary storage.
    // These promises own the bytes locally; no submission state survives dispatch.
    const imagesReady = composer.attachments?.length ? Promise.all(composer.attachments.map(async image => {
      if (!host.attachments) throw new Error('Image storage is unavailable.');
      return imageContent(await host.attachments.get(image));
    })) : undefined;
    // Slash commands may be controls or expand into different content.
    if (!imagesReady && !text.startsWith("/")) {
      steeringTranscript.begin(id, submittedText, 'sending', undefined, mode);
      queueRender(pendingState || displayedState);
    }
    updateComposer(clearDraft(composer));
    // Local interaction effects belong to Send, never to a late RPC result.
    if (!compact && !/^\/name(?:\s|$)/.test(text)) host.promptSubmitted?.();
    if (compact) post("compact", { id, customInstructions: compact[1]?.trim() || undefined });
    else if (imagesReady) {
      preparing++; renderComposer();
      void (async () => {
        try {
          const images = await imagesReady;
          if (disposed || generation !== composerGeneration) return;
          const state = pendingState || displayedState;
          if (deletionLocked || state.compacting || state.sessionUnavailable) throw new Error('Session became unavailable while preparing images. Nothing was sent.');
          steeringTranscript.begin(id, submittedText, 'sending', images, mode); queueRender(state);
          post('prompt', { id, text: submittedText, mode, images });
        } catch (error) { if (!disposed && generation === composerGeneration) updateComposer({ ...composer, lastError: String(error) }); }
        finally { if (!disposed && generation === composerGeneration) { preparing--; renderComposer(); } }
      })();
    } else post("prompt", { id, text: submittedText, mode });
  }

  const updateTopScrollEdge = (): void => {
    (root instanceof HTMLElement ? root : document.body).classList.toggle("transcript-scrolled", transcriptViewport.scrollTop > 0);
  };
  transcriptViewport.addEventListener("scroll", updateTopScrollEdge, { passive: true });
  updateTopScrollEdge();

  send.addEventListener("click", () => {
    if (send.dataset.action === "stop") {
      composerGeneration++; preparing = 0;
      renderComposer(); post('stop');
    }
    else submit();
  });
  model.addEventListener("click", () => post("selectModel"));
  thinking.addEventListener("click", () => post("selectThinking"));
  prompt.addEventListener('paste', event => {
    if (!active || disposed || prompt.readOnly || document.querySelector('dialog[open]')) return;
    const files = clipboardImages(event.clipboardData);
    const text = event.clipboardData?.getData('text/plain') ?? '';
    if (!files.length && (text || event.clipboardData?.types.includes('text/html') || event.clipboardData?.files.length)) return;
    if (!files.length && !host.attachments?.readClipboard) return;
    if (files.length) {
      event.preventDefault();
      if (text) { prompt.setRangeText(text, prompt.selectionStart, prompt.selectionEnd, 'end'); updateComposer(updateDraft(composer, prompt.value)); }
    }
    const generation = composerGeneration;
    preparing++; renderComposer();
    void (async () => {
      try {
        if (!host.attachments) throw new Error('Image storage is unavailable.');
        const blobs: { blob: Blob; name: string }[] = files.map(file => ({ blob: file, name: file.name }));
        if (!blobs.length) { const blob = await host.attachments.readClipboard?.(); if (blob) blobs.push({ blob, name: 'Pasted image' }); }
        for (const { blob, name } of blobs) {
          if (disposed || generation !== composerGeneration || deletionLocked || prompt.readOnly) return;
          const image = await host.attachments.put(blob, name);
          if (disposed || generation !== composerGeneration || deletionLocked || prompt.readOnly) return;
          const attachments = [...(composer.attachments ?? []), image]; validateAttachments(attachments);
          updateComposer({ ...composer, attachments, lastError: undefined });
        }
      } catch (error) { if (!disposed && generation === composerGeneration) updateComposer({ ...composer, lastError: String(error) }); }
      finally { if (!disposed && generation === composerGeneration) { preparing--; renderComposer(); transcriptScroll.resize(); } }
    })();
  }, { signal: listeners.signal });
  prompt.addEventListener("input", () => {
    const update = () => updateComposer(updateDraft(composer, prompt.value));
    if (host.performance) host.performance.measure('input-handler', update, active);
    else update();
  });
  queueActivity.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-recovery-id]") : undefined;
    const id = target?.dataset.recoveryId;
    if (id) updateComposer(restoreRecoveredQueueItem(composer, id));
  });
  prompt.addEventListener("keydown", (event) => {
    const mode = keyboardSubmissionMode(event, displayedState.busy === true);
    if (!mode) return;
    event.preventDefault();
    submit(mode);
  });
  messages.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target : null;
    const copy = target?.closest<HTMLButtonElement>("button.code-copy");
    if (copy) {
      void copyCode(copy);
      return;
    }
    const popout = target?.closest<HTMLButtonElement>('button.code-popout');
    if (popout) {
      const block = popout.closest('.code-block');
      const source = block ? codeBlockSource(block) : undefined;
      if (block && source !== undefined) {
        const language = block.querySelector('pre > code')?.className.match(/(?:^|\s)language-([^\s]+)/)?.[1]
          || block.querySelector('.code-language')?.textContent?.replace(/ \(detected\)$/, '') || '';
        post('popOutCode', { text: source, language });
      }
      return;
    }
    const link = target?.closest("a");
    if (!link) return;
    event.preventDefault();
    // Native host handles validated links; never navigate the application webview.
    event.stopPropagation();
    const href = link.getAttribute("href");
    if (href) {
      if (host.cardActions) { if (isSafeLink(href)) void host.cardActions.openLink(href).catch(reportRenderError); }
      else post('openLink', { href });
    }
  });
  required("dialog-save").addEventListener("click", () => {
    if (editorRequest) post("uiResponse", { id: editorRequest, value: dialogText.value });
    editorRequest = undefined;
    dialog.classList.remove("open");
  });
  required("dialog-cancel").addEventListener("click", () => {
    if (editorRequest) post("uiResponse", { id: editorRequest, cancelled: true });
    editorRequest = undefined;
    dialog.classList.remove("open");
  });
  host.onMessage((data: HostMessage) => {
    if (disposed) return;
    if (data.type === "sessionReset") {
      composerGeneration++; preparing = 0; attachmentSignature = '';
      // An explicit launch boundary only; ordinary snapshots retain all live UI state.
      toolDisclosure.dispose();
      for (const card of toolCards.values()) disposeToolCard(card);
      toolCards.clear();
      expanded.clear();
      for (const entry of rendered.values()) disposeMessageCards(entry.node);
      rendered.clear();
      steeringTranscript = new SteeringTranscript();
      queuedTurns.replaceChildren();
      queuedTurns.hidden = true;
      messages.replaceChildren();
      pendingState = undefined;
      displayedState = { sessionUnavailable: true };
      persistedState = data.composerState;
      slashCompletion.setCommands([]);
      updateComposer(restoreComposerState(persistedState));
      queueRender(displayedState);
    }
    if (data.type === "sessionDisconnected") {
      steeringTranscript.disconnect();
      composerGeneration++; preparing = 0; renderComposer();
      queueRender(pendingState || displayedState);
    }
    if (data.type === "deletionLock") {
      deletionLocked = data.locked === true;
      renderComposer();
      if (deletionLocked) { persistComposer(); post("deletionState", { id: data.id, hasDraft: !!(composer.draft.trim() || composer.attachments?.length || preparing || composer.recovered.length) }); }
    }
    if (data.type === "snapshot") {
      host.performance?.record('snapshot', active);
      if (typeof data.state?.deletionLocked === "boolean") deletionLocked = data.state.deletionLocked;
      if (typeof data.build === "string") activeBuild = data.build;
      if (data.restore && typeof data.restore === "object" && !Array.isArray(data.restore)) {
        const retained = persistedState && typeof persistedState === "object" && !Array.isArray(persistedState) ? persistedState as Record<string, unknown> : {};
        persistedState = { ...retained, restore: data.restore };
        persistComposer();
      }
      if (data.commands !== undefined) slashCompletion.setCommands(data.commands);
      const state = data.state || {};
      steeringTranscript.snapshot(state.messages || [], state.queue?.authoritative ? state.queue.steering || [] : undefined, state.queue?.authoritative ? state.queue.followUp || [] : undefined);
      if (state.sessionUnavailable) steeringTranscript.disconnect();
      queueRender(state);
    }
    if (data.type === "setEditorText") updateComposer(updateDraft(composer, safeText(data.text)));
    if (data.type === "submissionReceipt" && typeof data.id === "string" && (data.outcome === "accepted" || data.outcome === "rejected" || data.outcome === "cancelled" || data.outcome === "unknown")) {
      steeringTranscript.receipt(data.id, data.outcome);
      queueRender(pendingState || displayedState);
      if (data.outcome === 'accepted') {
        if (typeof data.noticeCause === 'string') host.resolveNoticeCause?.(data.noticeCause);
      } else if (data.outcome !== 'cancelled') {
        const unknown = data.outcome === 'unknown';
        const error = safeText(data.error);
        const message = unknown ? `Pi did not confirm whether this message was received. Nothing was retried automatically.${error ? ` ${error}` : ""}` : error || 'Pi rejected this message.';
        if (host.reportNotice) host.reportNotice({ id: `send:${data.id}`, operation: unknown ? 'Message delivery unknown' : safeText(data.operation) || 'Send message', message,
          cause: unknown ? 'connection' : safeText(data.noticeCause) || undefined, priority: unknown ? 100 : undefined });
        else updateComposer({ ...composer, lastError: message });
      }
    }
    if (data.type === "queueRecovery") {
      steeringTranscript.recover(stringArray(data.steering));
      steeringTranscript.recover(stringArray(data.followUp), 'followUp');
      queueRender(pendingState || displayedState);
      updateComposer(recoverClearedQueue(composer, stringArray(data.steering), stringArray(data.followUp)));
    }
    if (data.type === "copyResult") receiveCopyResult(data.id, data.success === true);
    if (data.type === "editorDialog") {
      editorRequest = data.id;
      dialogTitle.textContent = safeText(data.title) || "Edit text";
      dialogText.value = safeText(data.prefill);
      dialog.classList.add("open");
      if (active && !document.querySelector('dialog[open]')) dialogText.focus();
    }
  });
  persistComposer();
  renderComposer();
  if (active && window.__PI_GUI_INITIAL_FOCUS__) prompt.focus({ preventScroll: true });
  // Tab re-entry can focus the document's BODY instead of restoring a control.
  // Fill only that empty focus slot, synchronously; never override another input.
  window.addEventListener("focus", () => {
    if (active && !disposed && document.hasFocus() && document.activeElement === document.body && !editorRequest && !document.querySelector('dialog[open]') && !prompt.readOnly) {
      prompt.focus({ preventScroll: true });
    }
  }, { signal: listeners.signal });
  post("ready");
  return {
    dispose,
    scrollToBottom: () => { if (!disposed) transcriptScroll.scrollToBottom(); },
    setActive(value) {
      active = value;
      updateMotion();
      transcriptScroll.setActive(value);
      if (value) resizePrompt();
      else if (composerResizeFrame !== undefined) {
        window.cancelAnimationFrame(composerResizeFrame);
        composerResizeFrame = undefined;
      }
    },
  };
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

declare global {
  interface Window { __PI_GUI_RESTORE__?: unknown; __PI_GUI_INITIAL_FOCUS__?: boolean; }
}

interface State {
  deletionLocked?: boolean;
  messages?: DisplayMessage[];
  busy?: boolean;
  compacting?: boolean;
  status?: string;
  sessionName?: string;
  sessionFile?: string;
  temporary?: boolean;
  sessionUnavailable?: boolean;
  recoveryNotice?: string;
  sessionStats?: {
    cost?: number;
    context?: { tokens?: number | null; contextWindow?: number; percent?: number | null };
    autoCompactionEnabled?: boolean;
  };
  extensionStatuses?: Record<string, string>;
  extensionWidgets?: Record<string, { lines?: unknown[] }>;
  queue?: { steering?: string[]; followUp?: string[]; authoritative?: boolean; pendingCount?: number };
  modelControls?: {
    ready?: boolean;
    changing?: boolean;
    model?: { id?: unknown; provider?: unknown; name?: unknown } | null;
    thinkingLevel?: string;
    thinkingLevels?: string[];
  };
}

export interface HostMessage {
  type?: string;
  build?: string;
  locked?: boolean;
  commands?: unknown;
  state?: State;
  restore?: unknown;
  composerState?: unknown;
  text?: unknown;
  id?: string;
  customInstructions?: unknown;
  title?: unknown;
  prefill?: unknown;
  success?: boolean;
  outcome?: "accepted" | "rejected" | "cancelled" | "unknown";
  error?: unknown;
  noticeCause?: string;
  operation?: string;
  steering?: unknown;
  followUp?: unknown;
}

interface ContentBlock {
  type?: unknown;
  data?: unknown;
  mimeType?: unknown;
  text?: unknown;
  thinking?: unknown;
  thinkingComplete?: boolean;
  uiPhase?: "thinking" | "stopped";
  id?: unknown;
  name?: unknown;
  arguments?: unknown;
  executionOutput?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: "running" | "finished" | "result";
}

interface DisplayMessage {
  steeringStatus?: SteeringStatus;
  steering?: boolean;
  queued?: boolean;
  sticky?: boolean;
  uiPhase?: "thinking" | "stopped";
  key?: string;
  role?: string;
  parallelCluster?: ParallelToolCluster;
  content?: unknown | ContentBlock[];
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  output?: string;
  hasStreamingOutput?: boolean;
  resultOutput?: string;
  toolStatus?: "running" | "finished" | "result";
}
