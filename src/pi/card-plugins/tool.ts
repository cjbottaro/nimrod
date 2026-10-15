import type { CardPresentation, CardRenderer } from '../card-renderer';
import type { ToolCardBlock } from '../tool-card';

interface InputPresentation { value: string; }

export function toolInputPreview(name: string, args: unknown): string | undefined {
  return inputPresentation(name, args, true)?.value;
}

export function rawToolPresentation(block: Readonly<ToolCardBlock>): CardPresentation {
  const sections: CardPresentation['sections'][number][] = [];
  if (block.executionOutput && block.resultOutput && block.executionOutput !== block.resultOutput) {
    sections.push({ key: 'execution', label: 'Live output', text: block.executionOutput });
  }
  const output = block.resultOutput || block.executionOutput;
  if (output) sections.push({ key: 'result', label: block.toolStatus === 'running' && !block.resultOutput ? 'Live output' : 'Result', text: output });
  return { title: typeof block.name === 'string' && block.name || 'tool', sections };
}

export const defaultToolRenderer: CardRenderer<ToolCardBlock> = {
  id: 'nimrod.tool',
  supports: () => true,
  mount: () => ({
    update: block => {
      const presentation = rawToolPresentation(block);
      if (isBashTool(normalizedToolName(presentation.title))) {
        presentation.sections = presentation.sections.map(section => ({ ...section, format: 'console' as const }));
      }
      return { ...presentation, preview: inputPresentation(typeof block.name === 'string' ? block.name : 'tool', block.arguments, block.toolStatus !== undefined)?.value };
    },
    dispose() {},
  }),
};

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

