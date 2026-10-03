import createDOMPurify, { type WindowLike } from "dompurify";
import hljs from "highlight.js/lib/common";
import { marked } from "marked";
import { setCodeIcon } from './code-actions';

export interface SafeMarkdownRenderer {
  render(markdown: string): string;
  renderCode(source: string, language?: string): string;
}

const AUTO_DETECT_MIN_RELEVANCE = 2;

const SANITIZE_OPTIONS = {
  ALLOWED_TAGS: [
    "a", "blockquote", "br", "code", "del", "details", "div", "em", "h1", "h2", "h3", "h4", "h5", "h6",
    "hr", "input", "li", "ol", "p", "pre", "span", "strong", "summary", "table", "tbody", "td", "th", "thead", "tr", "ul",
  ],
  ALLOWED_ATTR: ["checked", "class", "colspan", "href", "start", "title", "type"],
  ALLOW_DATA_ATTR: false,
  ALLOWED_URI_REGEXP: /^(?:(?:https?|file):|[^:\s?#]*[./][^:\s?#]*:\d+(?::\d+)?$|[a-z]:[\\/]|(?!(?:[a-z][a-z0-9+.-]*:|\/\/))[^\s])/i,
  FORBID_ATTR: ["style"],
};

/**
 * Render GitHub-flavoured Markdown without exposing a raw HTML or executable URL sink.
 * Highlight.js receives only textContent and its output is sanitized again before insertion.
 */
export function createSafeMarkdownRenderer(window: Window): SafeMarkdownRenderer {
  const purifier = createDOMPurify(window as unknown as WindowLike);

  return {
    renderCode(source: string, language = ''): string {
      const root = window.document.createElement('div');
      const pre = window.document.createElement('pre');
      const code = window.document.createElement('code');
      code.textContent = source;
      if (hljs.getLanguage(language)) {
        code.innerHTML = purifier.sanitize(hljs.highlight(source, { language, ignoreIllegals: true }).value, SANITIZE_OPTIONS);
      }
      pre.append(code); root.append(pre);
      decorateCodeBlock(window.document, code, language || 'plain text');
      root.querySelector('.code-popout')?.remove();
      return root.innerHTML;
    },
    render(markdown: string): string {
      const root = window.document.createElement("div");
      root.innerHTML = purifier.sanitize(marked.parse(markdown || "", { async: false, breaks: true, gfm: true }), SANITIZE_OPTIONS);

      for (const code of root.querySelectorAll("pre > code")) {
        const source = code.textContent || "";
        const explicitLanguage = languageFromClass(code.className);
        const highlightLanguage = explicitLanguage?.toLowerCase();
        let label = explicitLanguage || "plain text";

        if (highlightLanguage && hljs.getLanguage(highlightLanguage)) {
          const result = hljs.highlight(source, { language: highlightLanguage, ignoreIllegals: true });
          code.innerHTML = purifier.sanitize(result.value, SANITIZE_OPTIONS);
        } else if (!explicitLanguage) {
          const result = hljs.highlightAuto(source);
          if (result.language && result.relevance >= AUTO_DETECT_MIN_RELEVANCE) {
            code.innerHTML = purifier.sanitize(result.value, SANITIZE_OPTIONS);
            label = `${result.language} (detected)`;
          }
        }

        decorateCodeBlock(window.document, code, label);
      }

      for (const link of root.querySelectorAll("a")) {
        const href = link.getAttribute("href") || "";
        if (!isSafeLink(href)) link.removeAttribute("href");
      }

      // Everything derived from Markdown was sanitized before decoration. The header is
      // constructed with DOM APIs, so it cannot carry raw Markdown attributes or handlers.
      return root.innerHTML;
    },
  };
}

export function isSafeLink(value: string): boolean {
  if (!value || /[\u0000-\u0020\u007f]/.test(value) || value.startsWith('//') || value.startsWith('#')) return false;
  if (/^file:/i.test(value)) {
    try { const url = new URL(value); return !url.hostname || url.hostname === 'localhost'; } catch { return false; }
  }
  if (/^[^:\s?#]*[./][^:\s?#]*:\d+(?::\d+)?$/.test(value) || /^[a-z]:[\\/]/i.test(value)) return true;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return isSafeExternalHttpUrl(value);
  return true; // Project-relative/absolute file; Rust validates existence on click.
}

export function isSafeExternalHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function codeBlockSource(block: Element): string | undefined {
  const code = block.querySelector("pre > code");
  return code ? code.textContent || "" : undefined;
}

function decorateCodeBlock(document: Document, code: Element, label: string): void {
  const pre = code.parentElement;
  if (!pre || pre.tagName !== "PRE") return;

  const block = document.createElement("div");
  block.className = "code-block";
  const header = document.createElement("div");
  header.className = "code-block-header";
  const language = document.createElement("span");
  language.className = "code-language";
  language.textContent = label;
  const copy = document.createElement("button");
  copy.className = "code-copy code-action";
  copy.type = "button";
  copy.title = 'Copy to clipboard';
  setCodeIcon(copy, 'copy');
  copy.setAttribute("aria-label", `Copy ${label} code`);
  const popout = document.createElement('button');
  popout.className = 'code-popout code-action';
  popout.type = 'button';
  popout.title = 'Pop out a read-only snapshot in a separate window. Keep it visible while the conversation continues.';
  popout.setAttribute('aria-label', 'Pop out code block');
  setCodeIcon(popout, 'popout');
  const status = document.createElement("span");
  status.className = "code-copy-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");

  pre.replaceWith(block);
  header.append(language, popout, copy, status);
  block.append(header, pre);
}

function languageFromClass(className: string): string | undefined {
  const match = /(?:^|\s)language-([^\s]+)(?:\s|$)/i.exec(className);
  return match?.[1];
}
