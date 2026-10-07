import { createMainActivityDom, createSubagentActivityDom, renderMainActivity, renderSubagentActivity } from "./activity-dom";
import { formatNativeSessionStats } from "./session-stats";
import { installSlashCompletion } from "./slash-completion";

import { reconcileContentBlock } from "./content-dom";
import { informationalExtensionStatuses, presentActivity } from "./activity-state";
import { beginSubmission, ComposerState, dismissUnknownSubmission, recoverClearedQueue, restoreRecoveredQueueItem, settleSubmission, SubmissionMode, updateDraft } from "./composer-state";
import { keyboardHint, keyboardSubmissionMode, renderPrimaryAction, resizeComposer } from "./composer-dom";
import { codeBlockSource, createSafeMarkdownRenderer } from "./safe-markdown";
import { showCopyResult } from './code-actions';
import { persistWebviewState, restoreComposerState } from "./webview-state";
import { captureStreamingOutput, createToolDetails, renderToolCard as renderToolCardDom, restoreStreamingOutput, updateToolCard, toolCardIsBusy } from "./tool-card";
import { ToolDisclosureController } from "./tool-disclosure";
import { toolMessageBlock } from "./tool-call";
import { TranscriptScroll } from "./transcript-scroll";
import { renderReasoningCard, updateReasoningCard } from "./reasoning-card";
import { transcriptRolePresentation } from "./transcript-presentation";
import { renderSkillInvocation } from "./skill-invocation";
import { renderParallelToolCard, type ParallelToolCluster } from "./tool-progress";

export interface PiView { setActive(active: boolean): void; dispose(): void; }

export function mountPiView(host: import('./view-host').ViewHost, root: HTMLElement | Document = document): PiView {
  let active = true;
  let disposed = false;
  const listeners = new AbortController();
  const markdown = createSafeMarkdownRenderer(window);
  const messages = required("messages");
  const transcriptViewport = required("transcript-viewport");
  const prompt = required<HTMLTextAreaElement>("prompt");
  const send = required<HTMLButtonElement>("send");
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
  const rendered = new Map<string, { node: HTMLElement; signature: string }>();
  const expanded = new Map<string, boolean>();
  const toolCards = new Map<string, HTMLDetailsElement>();
  const transcriptScroll = new TranscriptScroll(window, transcriptViewport);
  const toolDisclosure = new ToolDisclosureController(expanded, undefined, () => {
    transcriptScroll.request(transcriptScroll.capture());
  });
  const resizeTranscript = () => transcriptScroll.resize();
  const transcriptResizeObserver = "ResizeObserver" in window ? new ResizeObserver(resizeTranscript) : undefined;
  transcriptResizeObserver?.observe(transcriptViewport);
  window.addEventListener("resize", resizeTranscript, { passive: true, signal: listeners.signal });
  function dispose(): void {
    disposed = true;
    listeners.abort();
    toolDisclosure.dispose();
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
  resizeComposer(prompt);
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

  function updateComposer(next: ComposerState): void {
    composer = next;
    if (prompt.value !== composer.draft) prompt.value = composer.draft;
    resizeComposer(prompt);
    persistComposer();
    renderActivity(displayedState);
    renderComposer();
    slashCompletion.refresh();
  }

  function renderComposer(): void {
    const submission = composer.submission;
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
      submissionPending: !!submission,
      sessionUnavailable: displayedState.sessionUnavailable === true,
    });
    keyboardHintNode.textContent = compacting ? "Compacting context… · Stop to cancel" : keyboardHint(mainBusy);
    if (compacting) {
      send.title = "Cancel compaction";
      send.setAttribute("aria-label", "Cancel compaction");
    }
    if (displayedState.recoveryNotice) {
      submissionNotice.hidden = false;
      submissionNotice.textContent = displayedState.recoveryNotice;
      return;
    }
    if (submission?.status === "unknown") {
      submissionNotice.hidden = false;
      submissionNotice.replaceChildren();
      const text = element("span");
      text.textContent = "Pi did not confirm this message. Check the conversation or queue before allowing another send; it may already be accepted.";
      const allow = element("button");
      allow.type = "button";
      allow.dataset.action = "dismiss-unknown";
      allow.textContent = "Allow another send";
      submissionNotice.append(text, allow);
      return;
    }
    if (composer.lastError) {
      submissionNotice.hidden = false;
      submissionNotice.textContent = `Not sent: ${composer.lastError}`;
      return;
    }
    submissionNotice.hidden = true;
    submissionNotice.textContent = "";
  }

  function renderMarkdown(value: unknown): HTMLElement {
    const root = element("div", "markdown");
    root.innerHTML = markdown.render(safeText(value));
    return root;
  }

  function renderToolCard(block: ContentBlock, detailKey: string): HTMLDetailsElement {
    // Identity belongs to the invocation, not its current message/placement.
    const key = safeText(block.id) ? `tool:${safeText(block.id)}` : detailKey;
    let details = toolCards.get(key);
    if (details) updateToolCard(document, details, block);
    else {
      details = renderToolCardDom(document, block, toolDetail(key));
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
    return renderSkillInvocation(document, safeText(text), key, expanded, renderMarkdown, previous) ?? renderMarkdown(text);
  }

  function renderBlock(block: ContentBlock, messageKey: string, index: number, role?: string, previous?: HTMLElement): HTMLElement | undefined {
    const type = safeText(block.type);
    const node = type === "text" ? (role === "user" ? renderUserText(block.text, `${messageKey}:skill:${index}`, previous) : renderMarkdown(block.text))
      : type === "thinking" ? renderReasoningCard(document, expanded, `${messageKey}:thinking:${index}`, block.thinking, renderMarkdown, block.thinkingComplete === false)
        : type === "toolCall" ? renderToolCard(block, `${messageKey}:tool:${safeText(block.id) || index}`)
          : renderMarkdown(`[${type}]`);
    if (!node) return undefined;
    node.dataset.blockKey = contentBlockKey(block, index);
    return node;
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
    if (message.isError) article.classList.add("error");
    if (message.role === "parallel" && message.parallelCluster) {
      article.append(renderParallelToolCard(document, message.parallelCluster));
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

  /** Patches tool cards in their existing article so active spinner nodes never disconnect. */
  function patchMessage(node: HTMLElement, message: DisplayMessage): boolean {
    if (node.dataset.key !== safeText(message.key) || node.classList.contains(safeText(message.role)) === false) return false;
    node.classList.toggle("error", message.isError === true);
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
      reconcileContentBlock(node, previous, blockNode, blockChildren()[visibleIndex]);
      if (blockNode) visibleIndex++;
      existing.delete(key);
    });
    for (const stale of existing.values()) stale.remove();
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
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(source);
      setCopyStatus(button, status, true);
    } catch {
      const id = `copy-${++nextCopyRequest}`;
      pendingCopies.set(id, { button, status });
      post("copyCode", { id, text: source });
    }
  }

  function setCopyStatus(button: HTMLButtonElement, status: HTMLElement, success: boolean): void {
    showCopyResult(button, status, success);
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
    const enabled = controls?.ready === true && controls.changing !== true && state.busy !== true && state.compacting !== true && state.sessionUnavailable !== true;
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
      for (const text of queue.steering || []) queueActivity.append(activityRow("steering", text));
      for (const text of queue.followUp || []) queueActivity.append(activityRow("queued", text));
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
        rendered.clear();
        messages.replaceChildren();
        const display = Array.isArray(snapshot.messages) ? snapshot.messages : [];
        for (const [index, message] of display.entries()) {
          const key = safeText(message.key) || `message-${index}`;
          try {
            const node = renderMessage(message);
            messages.append(node);
            rendered.set(key, { node, signature: JSON.stringify(message) });
          }
          catch (messageError) {
            reportRenderError(messageError);
            const fallback = element("pre", "message error");
            fallback.textContent = `Unable to render this message. Raw content:\n${JSON.stringify(message.content, null, 2)}`;
            messages.append(fallback);
            rendered.set(key, { node: fallback, signature: JSON.stringify(message) });
          }
        }
      }
    });
  }

  function render(state: State): void {
    const wasAtBottom = transcriptScroll.capture();
    const outputPositions = new Map(Array.from(toolCards, ([key, card]) => [key, captureStreamingOutput(card)]));
    displayedState = state;
    renderActivity(state);
    renderModelControls(state);
    renderComposer();

    const nextKeys = new Set<string>();
    const display = Array.isArray(state.messages) ? state.messages : [];
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
          if (entry) entry.node.replaceWith(node);
          entry = { node, signature };
          rendered.set(key, entry);
        }
      }
      const currentAtIndex = messages.children.item(index);
      if (currentAtIndex !== entry.node) messages.insertBefore(entry.node, currentAtIndex || null);
    });
    for (const [key, entry] of rendered) {
      if (!nextKeys.has(key)) {
        entry.node.remove();
        rendered.delete(key);
      }
    }
    for (const [key, card] of toolCards) {
      if (!card.isConnected) toolCards.delete(key);
      else requestAnimationFrame(() => {
        if (!disposed && card.isConnected) restoreStreamingOutput(card, outputPositions.get(key));
      });
    }
    transcriptScroll.request(wasAtBottom);
  }

  function submit(mode: SubmissionMode = "normal"): void {
    if (deletionLocked) return;
    const text = composer.draft.trim();
    const compact = /^\/compact(?:\s+([\s\S]*))?$/.exec(text);
    if (/^\/(?:resume|delete|new|fork|clone|tree|reload|quit)(?:\s|$)/.test(text)) {
      updateComposer({ ...composer, lastError: 'Use the project session controls for session management. This slash operation is not supported; nothing was sent.' }); return;
    }
    if (compact && (displayedState.sessionUnavailable || displayedState.busy || displayedState.compacting || composer.submission)) {
      updateComposer({ ...composer, lastError: 'Manual compaction is available only while Pi is idle. Your draft was kept.' }); return;
    }
    if (displayedState.sessionUnavailable || displayedState.compacting || composer.submission || !text) return;
    const id = `submission-${Date.now()}-${++nextSubmissionId}`;
    const next = beginSubmission(composer, id, mode);
    if (next === composer) return;
    // Compaction is a control operation, not a user turn: consume its slash text immediately.
    updateComposer(compact ? { ...next, draft: "" } : next);
    if (compact) post("compact", { id, customInstructions: compact[1]?.trim() || undefined });
    else post("prompt", { id, text: next.submission!.text, mode });
  }

  const updateTopScrollEdge = (): void => {
    (root instanceof HTMLElement ? root : document.body).classList.toggle("transcript-scrolled", transcriptViewport.scrollTop > 0);
  };
  transcriptViewport.addEventListener("scroll", updateTopScrollEdge, { passive: true });
  updateTopScrollEdge();

  send.addEventListener("click", () => {
    if (send.dataset.action === "stop") post("stop");
    else submit();
  });
  model.addEventListener("click", () => post("selectModel"));
  thinking.addEventListener("click", () => post("selectThinking"));
  prompt.addEventListener("input", () => updateComposer(updateDraft(composer, prompt.value)));
  submissionNotice.addEventListener("click", (event) => {
    const target = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-action='dismiss-unknown']") : undefined;
    if (target) updateComposer(dismissUnknownSubmission(composer));
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
    if (href) post("openLink", { href });
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
      // An explicit launch boundary only; ordinary snapshots retain all live UI state.
      toolDisclosure.dispose();
      toolCards.clear();
      expanded.clear();
      rendered.clear();
      messages.replaceChildren();
      pendingState = undefined;
      displayedState = { sessionUnavailable: true };
      persistedState = data.composerState;
      slashCompletion.setCommands([]);
      updateComposer(restoreComposerState(persistedState));
      queueRender(displayedState);
    }
    if (data.type === "sessionDisconnected" && composer.submission?.status === "pending") {
      updateComposer(settleSubmission(composer, composer.submission.id, "unknown", "Pi disconnected before confirming this submission. It will not be sent again automatically."));
    }
    if (data.type === "deletionLock") {
      deletionLocked = data.locked === true;
      renderComposer();
      if (deletionLocked) { persistComposer(); post("deletionState", { id: data.id, hasDraft: !!(composer.draft.trim() || composer.submission || composer.recovered.length) }); }
    }
    if (data.type === "snapshot") {
      if (typeof data.state?.deletionLocked === "boolean") deletionLocked = data.state.deletionLocked;
      if (typeof data.build === "string") activeBuild = data.build;
      if (data.restore && typeof data.restore === "object" && !Array.isArray(data.restore)) {
        const retained = persistedState && typeof persistedState === "object" && !Array.isArray(persistedState) ? persistedState as Record<string, unknown> : {};
        persistedState = { ...retained, restore: data.restore };
        persistComposer();
      }
      if (data.commands !== undefined) slashCompletion.setCommands(data.commands);
      queueRender(data.state || {});
    }
    if (data.type === "setEditorText") updateComposer(updateDraft(composer, safeText(data.text)));
    if (data.type === "submissionReceipt" && typeof data.id === "string" && (data.outcome === "accepted" || data.outcome === "rejected" || data.outcome === "cancelled" || data.outcome === "unknown")) {
      updateComposer(settleSubmission(composer, data.id, data.outcome, safeText(data.error) || undefined));
    }
    if (data.type === "queueRecovery") {
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
    setActive(value) {
      active = value;
      transcriptScroll.setActive(value);
      if (value) resizeComposer(prompt);
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
  steering?: unknown;
  followUp?: unknown;
}

interface ContentBlock {
  type?: unknown;
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
