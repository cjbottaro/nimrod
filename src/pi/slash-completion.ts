import { matchSlashCommands } from "./slash-matching";
import { installInlineCompletion } from './inline-completion';

export interface SlashCommand {
  name: string; description: string; source: "GUI" | "Extension" | "Template" | "Skill" | "Agent";
  input?: { hint: string; required?: boolean; choices?: { name: string; description: string }[] };
}

export function slashCommands(raw: unknown): SlashCommand[] {
  const commands = new Map<string, SlashCommand>([
    ["name", { name: "name", description: "Rename this Pi session", source: "GUI" }],
    ["compact", { name: "compact", description: "Compact the active context", source: "GUI" }],
  ]);
  if (Array.isArray(raw)) for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const { name, description, source } = value as Record<string, unknown>;
    if (typeof name !== "string" || !name || /[\s\u0000-\u001f]/.test(name) || name.startsWith("/") || commands.has(name)) continue;
    commands.set(name, { name, description: typeof description === "string" ? description : "Pi command", source: source === "skill" ? "Skill" : source === "prompt" ? "Template" : "Extension" });
  }
  return [...commands.values()];
}

export function slashQuery(text: string, start: number, end: number): string | undefined {
  if (start !== end || start !== text.length || !/^\/[^\s/]*$/.test(text)) return undefined;
  return text.slice(1).toLowerCase();
}

/** Suggestions only insert text; execution remains the normal submission path. */
export function installSlashCompletion(input: HTMLTextAreaElement, list: HTMLElement, onInsert: (text: string) => void, resolve: (raw: unknown) => SlashCommand[] = slashCommands): { setCommands(raw: unknown): void; refresh(): void; setActive(value: boolean): void; dispose(): void } {
  let commands = resolve(undefined);
  let matches: SlashCommand[] = [];
  let argumentCommand: SlashCommand | undefined;
  let argumentPrefix = '';
  let argumentQuery = '';
  let argumentSelected = false;
  let selected = 0;
  let previousQuery: string | undefined;
  let dismissed: string | undefined;
  let composing = false;
  let active = true;
  let open = false;
  const document = input.ownerDocument;
  const listeners = new (document.defaultView!.AbortController)();
  const options = { signal: listeners.signal };
  const inline = installInlineCompletion(input, `${list.id}-inline-status`);
  input.setAttribute("aria-autocomplete", "both");
  input.setAttribute("aria-controls", list.id);

  function hideList(): void {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function close(): void { open = false; hideList(); inline.hide(); }
  function draw(): void {
    open = true;
    if (argumentCommand) {
      hideList();
      const candidate = matches[selected];
      const hint = argumentCommand.input?.hint.trim() || (matches.length ? matches.map(choice => choice.name).join('|') : '');
      const placeholder = /^[\[<]/.test(hint) ? hint : argumentCommand.input?.required ? `<${hint}>` : `[${hint}]`;
      const completing = !!candidate && (!!argumentQuery || argumentSelected);
      const suffix = completing ? candidate.name.slice(argumentQuery.length) : argumentQuery || !hint ? '' : placeholder;
      const separator = input.value === argumentPrefix.trimEnd() ? ' ' : '';
      const announcement = candidate && (completing || !hint)
        ? `${candidate.name}${candidate.description ? `: ${candidate.description}` : ''}. ${selected + 1} of ${matches.length}. Tab to complete; Up and Down to choose.`
        : suffix ? `${argumentCommand.input?.required ? 'Required' : 'Optional'}: ${hint}` : '';
      inline.show(suffix ? `${separator}${suffix}` : '', announcement);
      return;
    }
    inline.hide();
    list.replaceChildren();
    matches.forEach((command, index) => {
      const option = document.createElement("div");
      option.id = `${list.id}-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", String(index === selected));
      option.dataset.index = String(index);
      const name = document.createElement("strong");
      name.textContent = `/${command.name}`;
      const description = document.createElement("span");
      description.textContent = `${command.source} · ${command.description}`;
      option.title = command.source === "Extension" ? `${command.description} — provided by a Pi extension; RPC UI compatibility depends on that extension.` : command.description;
      option.append(name, description);
      list.append(option);
    });
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", `${list.id}-${selected}`);
    const option = list.querySelector<HTMLElement>(`[data-index="${selected}"]`) ?? undefined;
    if (option) {
      if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    }
  }
  function refresh(): void {
    if (!active || input.readOnly || input.disabled || composing || document.activeElement !== input
      || input.selectionStart !== input.selectionEnd || input.selectionEnd !== input.value.length || dismissed === input.value) { close(); return; }
    let query = slashQuery(input.value, input.selectionStart, input.selectionEnd);
    argumentCommand = undefined;
    // An exact command can show its hint without requiring a trailing space.
    const args = /^\/([^\s/]+)(?:([ \t])([\s\S]*))?$/.exec(input.value);
    const command = args && commands.find(command => command.name.toLowerCase() === args[1].toLowerCase());
    if (command?.input) {
      argumentCommand = command;
      argumentPrefix = args![2] ? input.value.slice(0, args![1].length + 2) : `${input.value} `;
      argumentQuery = args![3] ?? '';
      query = argumentQuery.toLowerCase();
    }
    if (query === undefined) { close(); return; }
    const context = argumentCommand ? `${argumentCommand.name} ${query}` : query;
    const previous = context === previousQuery ? matches[selected]?.name : undefined;
    if (context !== previousQuery) argumentSelected = false;
    previousQuery = context;
    // Inline suffixes must be literal prefix completions, not fuzzy rewrites.
    matches = argumentCommand
      ? (argumentCommand.input?.choices ?? []).filter(choice => choice.name.toLowerCase().startsWith(query!))
        .map(choice => ({ ...choice, source: argumentCommand!.source }))
      : matchSlashCommands(commands, query);
    if (!matches.length && !(argumentCommand?.input?.hint && !argumentQuery)) { close(); return; }
    selected = Math.max(0, matches.findIndex(command => command.name === previous));
    draw();
  }
  function queryHasArguments(): boolean { return argumentQuery.trim().length > 0; }
  function accept(index: number): void {
    const command = matches[index];
    if (!command || input.readOnly || input.disabled) return;
    const text = argumentCommand ? `${argumentPrefix}${command.name} ` : `/${command.name} `;
    close();
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    onInsert(text);
    refresh();
  }
  input.addEventListener("input", () => { dismissed = undefined; refresh(); }, options);
  input.addEventListener("focus", refresh, options);
  input.addEventListener("click", refresh, options);
  input.addEventListener("keyup", event => { if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) refresh(); }, options);
  // Covers mouse/keyboard selections as well as programmatic caret moves.
  document.addEventListener('selectionchange', () => { if (document.activeElement === input) refresh(); }, options);
  input.addEventListener("blur", () => { composing = false; close(); }, options);
  document.defaultView!.addEventListener("blur", close, options);
  document.defaultView!.addEventListener("focus", refresh, options);
  document.addEventListener("visibilitychange", () => { if (document.hidden) close(); else refresh(); }, options);
  input.addEventListener("compositionstart", () => { composing = true; close(); }, options);
  input.addEventListener("compositionend", () => { composing = false; refresh(); }, options);
  input.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229) return;
    // Selection/lock changes may arrive before a selectionchange event.
    if (input.readOnly || input.disabled || input.selectionStart !== input.selectionEnd || input.selectionEnd !== input.value.length) { close(); return; }
    if (!open) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); dismissed = input.value; close();
    } else if (matches.length && !(event.key === 'Enter' && argumentCommand && !argumentSelected && !queryHasArguments()) && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ["ArrowUp", "ArrowDown", "Tab", "Enter"].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Enter" || event.key === "Tab") accept(selected);
      else { argumentSelected = true; selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length; draw(); }
    }
  }, options);
  list.addEventListener("mousedown", event => {
    const target = event.target as HTMLElement | null;
    const option = target?.closest<HTMLElement>("[data-index]");
    if (!option || list.hidden || !active) return;
    event.preventDefault();
    accept(Number(option.dataset.index));
  }, options);
  close();
  return {
    refresh,
    setActive(value) { active = value; if (value) refresh(); else close(); },
    dispose() { active = false; close(); listeners.abort(); inline.dispose(); },
    setCommands(raw) {
      const next = resolve(raw);
      if (JSON.stringify(next) === JSON.stringify(commands)) return;
      commands = next;
      refresh();
    },
  };
}
