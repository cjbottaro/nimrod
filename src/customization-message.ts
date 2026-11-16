import { renderSkillInvocation } from './skill-invocation';

// A readable user-message format, not a harness protocol or an authority marker.
const NAMESPACE = '[nimrod-customization:';
export const CUSTOMIZATION_PREFIX = '[nimrod-customization:v1]\n';
const INSTRUCTIONS = '\nNimrod customization instructions:\n';
const REQUEST = '\n\nUser customization request:\n';
const END = '\n[/nimrod-customization:v1]';
export interface CustomizationMessage { instructions: string; request: string; }

export function customizationMessage(instructions: string, request: string): string {
  if (!instructions.trim() || !request.trim()) throw new Error('Customization instructions and a request are required.');
  return `${CUSTOMIZATION_PREFIX}${JSON.stringify({ instructions: instructions.length, request: request.length })}${INSTRUCTIONS}${instructions}${REQUEST}${request}${END}`;
}

/** Lengths count JS UTF-16 code units so delimiter-like text and Unicode round-trip exactly. */
export function parseCustomizationMessage(text: string): CustomizationMessage | undefined {
  if (!text.startsWith(CUSTOMIZATION_PREFIX)) return;
  const headerEnd = text.slice(CUSTOMIZATION_PREFIX.length, CUSTOMIZATION_PREFIX.length + 128).indexOf('\n');
  if (headerEnd < 0) return;
  const start = CUSTOMIZATION_PREFIX.length + headerEnd;
  let lengths: { instructions: number; request: number };
  try { lengths = JSON.parse(text.slice(CUSTOMIZATION_PREFIX.length, start)); } catch { return; }
  if (!lengths || typeof lengths !== 'object' || Object.keys(lengths).sort().join(',') !== 'instructions,request'
    || !Number.isSafeInteger(lengths.instructions) || !Number.isSafeInteger(lengths.request) || lengths.instructions <= 0 || lengths.request <= 0) return;
  if (!text.startsWith(INSTRUCTIONS, start)) return;
  const bodyStart = start + INSTRUCTIONS.length, bodyEnd = bodyStart + lengths.instructions;
  if (!text.startsWith(REQUEST, bodyEnd)) return;
  const requestStart = bodyEnd + REQUEST.length, requestEnd = requestStart + lengths.request;
  if (requestEnd + END.length !== text.length || !text.startsWith(END, requestEnd)) return;
  const instructions = text.slice(bodyStart, bodyEnd), request = text.slice(requestStart, requestEnd);
  return instructions.trim() && request.trim() ? { instructions, request } : undefined;
}

const sources = new WeakMap<HTMLElement, string>();
/** Nimrod-owned user-turn presentation, ahead of any harness-specific user-text hook. */
export function customizationUserText(document: Document, text: string, key: string, expanded: Map<string, boolean>,
  markdown: (text: string) => HTMLElement, previous?: HTMLElement): HTMLElement | undefined {
  if (previous && sources.get(previous) === text) return previous;
  if (!text.startsWith(NAMESPACE)) return;
  const message = parseCustomizationMessage(text);
  let node: HTMLElement;
  if (message) {
    // Reuse only the shared lazy disclosure mechanics, never a harness skill parser.
    node = renderSkillInvocation(document, { label: 'Nimrod customization instructions', content: message.instructions, userMessage: message.request }, key, expanded, markdown, previous);
    node.classList.add('customization-request');
  } else {
    node = document.createElement('pre'); node.className = 'customization-unrecognized'; node.textContent = text;
  }
  sources.set(node, text);
  return node;
}
