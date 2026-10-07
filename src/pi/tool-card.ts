export const TOOL_AUTO_DISCLOSURE_MS = 500;

export interface ToolCardBlock {
  name?: unknown;
  arguments?: unknown;
  uiPhase?: "thinking" | "stopped";
  executionOutput?: string;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: "running" | "finished" | "result";
}

export interface ToolOutputScrollState {
  top: number;
  atBottom: boolean;
}

export function toolCardIsBusy(block: ToolCardBlock): boolean {
  const status = toolStatus(block);
  return status === "running" || status === "thinking";
}

export function toolInputPreview(name: string, args: unknown): string | undefined {
  return inputPresentation(name, args, true)?.value;
}

export function renderToolCard(document: Document, block: ToolCardBlock, details: HTMLDetailsElement): HTMLDetailsElement {
  details.classList.add("tool-card");
  const summary = document.createElement("summary");
  const summaryContent = document.createElement("span");
  summaryContent.className = "tool-card-summary";
  summary.append(summaryContent);
  details.append(summary);
  updateToolCard(document, details, block);
  return details;
}

/**
 * Updates a card in place. In particular, a running indicator stays in its
 * connected summary so its CSS animation timeline is never restarted by a
 * streaming snapshot.
 */
export function updateToolCard(document: Document, details: HTMLDetailsElement, block: ToolCardBlock): void {
  const name = string(block.name) || "tool";
  const status = toolStatus(block);
  const summary = directChild<HTMLElement>(details, "summary");
  const summaryContent = summary?.querySelector<HTMLElement>(".tool-card-summary");
  if (!summary || !summaryContent) return;

  summary.setAttribute("aria-label", `${name} (${status})`);
  let indicator = summaryContent.querySelector<HTMLElement>(".tool-card-spinner, .tool-card-dot");
  const indicatorClass = status === "running" || status === "pending" || status === "thinking" ? "tool-card-spinner" : `tool-card-dot tool-card-${status}`;
  if (!indicator || indicator.className !== indicatorClass) {
    const next = document.createElement("span");
    next.className = indicatorClass;
    next.setAttribute("aria-hidden", "true");
    if (indicator) indicator.replaceWith(next);
    else summaryContent.prepend(next);
    indicator = next;
  }

  let title = summaryContent.querySelector<HTMLElement>(".tool-card-title");
  if (!title) {
    title = document.createElement("span");
    title.className = "tool-card-title";
    summaryContent.append(title);
  }
  title.textContent = name;

  const presentation = inputPresentation(name, block.arguments, block.toolStatus !== undefined);
  const preview = summaryContent.querySelector<HTMLElement>(".tool-card-preview");
  if (presentation) {
    if (preview) {
      preview.textContent = presentation.value;
    } else {
      summaryContent.append(inputPreview(document, presentation));
    }
  } else {
    preview?.remove();
  }

  let phase = directChild<HTMLElement>(details, ".tool-phase");
  if (status === "stopped") {
    if (!phase) {
      phase = document.createElement("div");
      phase.className = "tool-phase";
      summary.after(phase);
    }
    phase.textContent = "Execution was interrupted before completion was reported.";
  } else phase?.remove();
  updateInputs(document, details, block.arguments);
  updateOutputs(document, details, block);
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
  const output = root.querySelector<HTMLElement>(".tool-output-streaming");
  if (!output) return undefined;
  return {
    top: output.scrollTop,
    atBottom: output.scrollTop + output.clientHeight >= output.scrollHeight - 2,
  };
}

/** Restores inspection position, or follows new live output when the viewport was at its bottom. */
export function restoreStreamingOutput(root: ParentNode, previous?: ToolOutputScrollState): void {
  const output = root.querySelector<HTMLElement>(".tool-output-streaming");
  if (!output) return;
  output.scrollTop = previous && !previous.atBottom ? previous.top : output.scrollHeight;
}

interface InputPresentation {
  value: string;
}

function updateInputs(document: Document, root: HTMLDetailsElement, argumentsValue: unknown): void {
  const existing = directChild<HTMLDetailsElement>(root, "details.tool-raw-inputs");
  if (argumentsValue === undefined || argumentsValue === "") {
    existing?.remove();
    return;
  }
  if (existing) {
    const pre = existing.querySelector("pre");
    if (pre) pre.textContent = stringify(argumentsValue);
    return;
  }
  const inputs = rawInputs(document, argumentsValue);
  const firstOutput = directChild<HTMLElement>(root, ".tool-section");
  root.insertBefore(inputs, firstOutput || null);
}

function updateOutputs(document: Document, root: HTMLDetailsElement, block: ToolCardBlock): void {
  const desired = outputParts(block);
  const sections = (): HTMLElement[] => (Array.from(root.children) as HTMLElement[]).filter((child) => child.classList.contains("tool-section"));
  const existing = new Map(sections().map((section) => [section.dataset.outputKind || "", section]));

  desired.forEach((part, index) => {
    let section = existing.get(part.kind);
    if (!section) {
      section = outputSection(document, part.label, part.value, part.streaming, part.kind);
    } else {
      section.querySelector<HTMLElement>(".tool-label")!.textContent = part.label;
      const output = section.querySelector<HTMLPreElement>(".tool-output")!;
      output.className = `tool-output ${part.streaming ? "tool-output-streaming" : "tool-output-final"}`;
      if (output.textContent !== part.value) output.textContent = part.value;
      existing.delete(part.kind);
    }
    const current = sections()[index];
    if (current !== section) root.insertBefore(section, current || null);
  });
  for (const section of existing.values()) section.remove();
}

function outputParts(block: ToolCardBlock): Array<{ kind: string; label: string; value: string; streaming: boolean }> {
  const active = toolCardIsBusy(block);
  const parts: Array<{ kind: string; label: string; value: string; streaming: boolean }> = [];
  if (block.executionOutput && block.resultOutput && block.executionOutput !== block.resultOutput) {
    parts.push({ kind: "execution", label: "Live output", value: block.executionOutput, streaming: active });
  }
  const output = block.resultOutput || block.executionOutput;
  if (output) parts.push({ kind: "result", label: block.toolStatus === "running" && !block.resultOutput ? "Live output" : "Result", value: output, streaming: active });
  return parts;
}

/** A concise header preview. Expanded cards keep raw inputs and output only. */
function inputPresentation(toolName: string, argumentsValue: unknown, complete: boolean): InputPresentation | undefined {
  if (argumentsValue === undefined || argumentsValue === "") return undefined;
  const argumentsRecord = record(argumentsValue);
  if (!argumentsRecord && !complete) return undefined;
  const normalizedName = normalizedToolName(toolName);
  const path = firstString(argumentsRecord, ["path", "file_path", "filePath", "filename", "file", "target_path", "targetPath"]);

  if (isAgentTool(normalizedName)) {
    const description = firstString(argumentsRecord, ["description"]);
    return description ? { value: description } : complete ? { value: "No description provided" } : undefined;
  }
  if (isSteerSubagentTool(normalizedName)) {
    const message = firstString(argumentsRecord, ["message"]);
    return message ? { value: message } : complete ? { value: "No message provided" } : undefined;
  }
  if (isFileTool(normalizedName) && path) return { value: path };
  if (isBashTool(normalizedName)) {
    const command = firstString(argumentsRecord, ["command", "cmd", "script"]);
    if (command) return { value: command };
  }
  if (normalizedName === "web_search" || normalizedName === "web-search") {
    const value = namedStrings(argumentsRecord, "query", "queries");
    return value ? { value } : complete ? { value: "Search inputs" } : undefined;
  }
  if (normalizedName === "fetch_content" || normalizedName === "fetch-content") {
    const value = namedStrings(argumentsRecord, "url", "urls");
    return value ? { value } : complete ? { value: "Fetch inputs" } : undefined;
  }
  if (isSearchTool(normalizedName)) {
    const pattern = firstString(argumentsRecord, ["pattern", "query", "search", "glob", "regex"]);
    const value = pattern && path ? `${pattern} in ${path}` : pattern || path;
    return value ? { value } : complete ? { value: "Search inputs" } : undefined;
  }
  if (!complete) return undefined;
  const count = argumentsRecord ? Object.keys(argumentsRecord).length : 0;
  return { value: count === 1 ? "1 field" : `${count} fields` };
}

function inputPreview(document: Document, presentation: InputPresentation): HTMLElement {
  const preview = document.createElement("span");
  preview.className = "tool-card-preview";
  preview.textContent = presentation.value;
  return preview;
}

function rawInputs(document: Document, value: unknown): HTMLDetailsElement {
  const details = document.createElement("details");
  details.className = "tool-raw-inputs";
  const summary = document.createElement("summary");
  summary.textContent = "Raw inputs";
  const pre = document.createElement("pre");
  pre.textContent = stringify(value);
  details.append(summary, pre);
  return details;
}

function outputSection(document: Document, label: string, value: string, streaming: boolean, kind: string): HTMLElement {
  const root = document.createElement("div");
  root.className = "tool-section";
  root.dataset.outputKind = kind;
  const heading = document.createElement("div");
  heading.className = "tool-label";
  heading.textContent = label;
  const pre = document.createElement("pre");
  pre.className = `tool-output ${streaming ? "tool-output-streaming" : "tool-output-final"}`;
  pre.tabIndex = 0;
  pre.setAttribute("aria-label", label);
  pre.textContent = value;
  root.append(heading, pre);
  return root;
}

function normalizedToolName(name: string): string {
  return name.trim().toLowerCase().split(/[.:/]/).pop() || "";
}

function isAgentTool(name: string): boolean {
  return ["agent", "subagent", "sub-agent", "sub_agent"].includes(name);
}

function isSteerSubagentTool(name: string): boolean {
  return name === "steer_subagent";
}

function isFileTool(name: string): boolean {
  return ["read", "write", "edit"].includes(name);
}

function isBashTool(name: string): boolean {
  return name === "bash" || name === "shell" || name === "terminal";
}

function isSearchTool(name: string): boolean {
  return ["search", "grep", "find", "glob", "web_search", "web-search"].includes(name);
}

function record(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    try { return record(JSON.parse(value)); } catch { return partialTopLevelStrings(value); }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

/**
 * Tool-call arguments stream as JSON fragments. Preserve only complete,
 * top-level string fields; incomplete escapes and nested fields are ignored.
 */
function partialTopLevelStrings(text: string): Record<string, unknown> | undefined {
  const fields: Record<string, unknown> = {};
  let index = skipWhitespace(text, 0);
  if (text[index] !== "{") return undefined;
  index++;
  while (index < text.length) {
    index = skipWhitespace(text, index);
    if (text[index] === "}") return fields;
    const key = jsonStringAt(text, index);
    if (!key) return fields;
    index = skipWhitespace(text, key.end);
    if (text[index] !== ":") return fields;
    index = skipWhitespace(text, index + 1);
    const value = jsonStringAt(text, index);
    if (value) {
      fields[key.value] = value.value;
      index = value.end;
    } else {
      const end = skipJsonValue(text, index);
      if (end === undefined) return fields;
      index = end;
    }
    index = skipWhitespace(text, index);
    if (text[index] === ",") { index++; continue; }
    if (text[index] === "}") return fields;
    return fields;
  }
  return fields;
}

function jsonStringAt(text: string, start: number): { value: string; end: number } | undefined {
  if (text[start] !== "\"") return undefined;
  let index = start + 1;
  while (index < text.length) {
    if (text[index] === "\\") { index += 2; continue; }
    if (text[index] === "\"") {
      try { return { value: JSON.parse(text.slice(start, index + 1)) as string, end: index + 1 }; } catch { return undefined; }
    }
    index++;
  }
  return undefined;
}

function skipJsonValue(text: string, start: number): number | undefined {
  if (text[start] === "\"") return jsonStringAt(text, start)?.end;
  if (text[start] !== "{" && text[start] !== "[") {
    let index = start;
    while (index < text.length && !/[\s,}\]]/.test(text[index])) index++;
    return index > start ? index : undefined;
  }
  const closing = text[start] === "{" ? "}" : "]";
  let depth = 0;
  let index = start;
  while (index < text.length) {
    if (text[index] === "\"") {
      const string = jsonStringAt(text, index);
      if (!string) return undefined;
      index = string.end;
      continue;
    }
    if (text[index] === "{" || text[index] === "[") depth++;
    if (text[index] === "}" || text[index] === "]") {
      depth--;
      if (depth === 0) return text[index] === closing ? index + 1 : undefined;
    }
    index++;
  }
  return undefined;
}

function skipWhitespace(text: string, index: number): number {
  while (index < text.length && /\s/.test(text[index])) index++;
  return index;
}

function namedStrings(value: Record<string, unknown> | undefined, singular: string, plural: string): string | undefined {
  if (!value) return undefined;
  const parts: string[] = [];
  if (typeof value[singular] === "string" && value[singular]) parts.push(value[singular] as string);
  if (Array.isArray(value[plural])) parts.push(...value[plural].filter((entry): entry is string => typeof entry === "string" && entry.length > 0));
  return parts.join(" · ") || undefined;
}

function firstString(value: Record<string, unknown> | undefined, keys: string[]): string | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === "string" && value[key]) return value[key] as string;
  }
  return undefined;
}

function toolStatus(block: ToolCardBlock): "running" | "thinking" | "stopped" | "failed" | "succeeded" | "pending" {
  if (block.isError === true) return "failed";
  if (block.uiPhase === "stopped") return "stopped";
  if (block.uiPhase === "thinking") return "thinking";
  if (block.toolStatus === "running") return "running";
  if (block.toolStatus === "finished" || block.toolStatus === "result") return "succeeded";
  return "pending";
}

function directChild<T extends HTMLElement>(root: HTMLElement, selector: string): T | undefined {
  return Array.from(root.children).find((child) => child.matches(selector)) as T | undefined;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try { return JSON.stringify(value, null, 2); } catch { return "[unserializable arguments]"; }
}

function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
