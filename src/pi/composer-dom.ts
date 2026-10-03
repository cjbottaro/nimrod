export interface PrimaryActionState {
  mainBusy: boolean;
  submissionPending: boolean;
  sessionUnavailable: boolean;
}

export type KeyboardSubmissionMode = "normal" | "steer" | "followUp";

export interface ComposerKeyboardEvent {
  key: string;
  shiftKey: boolean;
  altKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

/** Maps an unmodified Enter to the delivery Pi accepts in the current main-agent state. */
export function keyboardSubmissionMode(event: ComposerKeyboardEvent, mainBusy: boolean): KeyboardSubmissionMode | undefined {
  if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) return undefined;
  if (!mainBusy) return "normal";
  return "steer";
}

export function keyboardHint(mainBusy: boolean): string {
  if (!mainBusy) return "Enter to send · Shift+Enter for newline";
  return "Enter to steer · Shift+Enter for newline";
}

/** Keep the primary composer affordance stable while its main-agent action changes. */
export function renderPrimaryAction(button: HTMLButtonElement, state: PrimaryActionState): void {
  const stopping = state.mainBusy;
  button.dataset.action = stopping ? "stop" : "send";
  button.disabled = stopping ? false : state.submissionPending || state.sessionUnavailable;
  button.setAttribute("aria-label", stopping ? "Stop Pi" : "Send message");
  button.title = stopping ? "Stop Pi" : "Send message";
  button.replaceChildren(icon(button.ownerDocument, stopping ? "stop" : "send"));
}

/** Size the draft field to its contents without allowing it to take over the editor. */
export function resizeComposer(textarea: HTMLTextAreaElement, minHeight = 40, maxHeight = 160): void {
  // Measuring the content forces layout. Hold the shell at its current
  // height so that measurement cannot briefly enlarge the transcript pane and
  // clamp its scrollTop (even when the final composer height is unchanged).
  const shell = textarea.parentElement?.closest<HTMLElement>('#composer-shell, [data-pi-id="composer-shell"]');
  const shellHeight = shell?.style.height ?? "";
  if (shell) shell.style.height = `${shell.offsetHeight}px`;
  try {
    // An auto-height flex child stretches to the held shell height, preventing
    // scrollHeight from shrinking after content is removed. Measure at the floor.
    textarea.style.height = `${minHeight}px`;
    const contentHeight = textarea.scrollHeight;
    const height = Math.min(Math.max(contentHeight, minHeight), maxHeight);
    textarea.style.height = `${height}px`;
    textarea.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  } finally {
    if (shell) shell.style.height = shellHeight;
  }
}

function icon(document: Document, name: "send" | "stop"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", name === "send" ? "M1.3 1.2 15 8 1.3 14.8l2.2-5.3H9V6.5H3.5z" : "M3 3h10v10H3z");
  svg.append(path);
  return svg;
}
