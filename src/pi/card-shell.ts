export const TOOL_AUTO_DISCLOSURE_MS = 500;

/** Paint the triangle directly, avoiding transient clip-path edges in WebKitGTK. */
export function createCardSummary(document: Document, label?: string): HTMLElement {
  const summary = document.createElement('summary');
  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  arrow.classList.add('card-disclosure-arrow');
  arrow.setAttribute('viewBox', '0 0 100 100');
  arrow.setAttribute('width', '7');
  arrow.setAttribute('height', '7');
  arrow.setAttribute('aria-hidden', 'true');
  arrow.setAttribute('focusable', 'false');
  const triangle = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  triangle.setAttribute('d', 'M15 0 L85 50 L15 100 Z');
  arrow.append(triangle);
  summary.append(arrow);
  if (label !== undefined) summary.append(label);
  return summary;
}

export interface ToolOutputScrollState { top: number; atBottom: boolean; }
const outputViewports = new WeakMap<ParentNode, HTMLElement>();
export function associateOutputViewport(root: ParentNode, viewport?: HTMLElement): void {
  if (viewport) outputViewports.set(root, viewport); else outputViewports.delete(root);
}
function liveViewport(root: ParentNode): HTMLElement | null {
  const associated = outputViewports.get(root);
  if (associated) return associated.classList.contains('tool-output-streaming') ? associated : null;
  return root.querySelector<HTMLElement>('.tool-output-streaming');
}

/**
 * Keeps the automatic lifecycle default separate from explicit user toggles.
 * Browser details elements emit a deferred toggle event for their initial `open`
 * value, which must not make a running card stay open after it completes.
 */
export function createToolDetails(document: Document, expanded: Map<string, boolean>, key: string, defaultOpen = false, onManualToggle?: (key: string) => void): HTMLDetailsElement {
  const node = document.createElement("details");
  node.dataset.detailKey = key;
  const initialOpen = expanded.get(key) ?? defaultOpen;
  node.open = initialOpen;
  let ignoreInitialToggle = initialOpen;
  node.addEventListener("toggle", () => {
    if (node.dataset.automaticOpenChange === "true") {
      delete node.dataset.automaticOpenChange;
      ignoreInitialToggle = false;
      return;
    }
    if (ignoreInitialToggle && node.open === initialOpen) {
      ignoreInitialToggle = false;
      return;
    }
    ignoreInitialToggle = false;
    expanded.set(key, node.open);
    onManualToggle?.(key);
  });
  return node;
}

/** Changes the automatic running-state disclosure without recording a user toggle. */
export function setToolDetailsAutoOpen(node: HTMLDetailsElement, open: boolean): void {
  if (node.open === open) return;
  node.dataset.automaticOpenChange = "true";
  node.open = open;
}

/** Captures only the live-output viewport, never the page transcript scroll position. */
export function captureStreamingOutput(root: ParentNode): ToolOutputScrollState | undefined {
  const output = liveViewport(root);
  if (!output) return undefined;
  return {
    top: output.scrollTop,
    atBottom: output.scrollTop + output.clientHeight >= output.scrollHeight - 2,
  };
}

/** Restores inspection position, or follows new live output when the viewport was at its bottom. */
export function restoreStreamingOutput(root: ParentNode, previous?: ToolOutputScrollState): void {
  const output = liveViewport(root);
  if (!output) return;
  output.scrollTop = previous && !previous.atBottom ? previous.top : output.scrollHeight;
}

