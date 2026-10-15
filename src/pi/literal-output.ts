import { sameOutputAppend, type OutputSource } from './output-source';
const sources = new WeakMap<HTMLElement, { text: string; source?: OutputSource }>();

/** Retain text-node identity on cumulative appends; replacements remain authoritative. */
export function renderLiteralOutput(output: HTMLElement, text: string, source?: OutputSource): void {
  const previous = sources.get(output);
  if (previous?.text === text) return;
  const node = output.firstChild;
  if (previous && (sameOutputAppend(previous.source, source) || text.startsWith(previous.text)) && node?.nodeType === 3 && node === output.lastChild) {
    (node as Text).appendData(text.slice(previous.text.length));
  } else output.textContent = text;
  sources.set(output, { text, source });
}
export function clearLiteralOutput(output: HTMLElement): void { sources.delete(output); }
