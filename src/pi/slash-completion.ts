import { matchSlashCommands } from "./slash-matching";

export interface SlashCommand { name: string; description: string; source: "GUI" | "Extension" | "Template" | "Skill"; }

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
export function installSlashCompletion(input: HTMLTextAreaElement, list: HTMLElement, onInsert: (text: string) => void): { setCommands(raw: unknown): void; refresh(): void } {
  let commands = slashCommands(undefined);
  let matches: SlashCommand[] = [];
  let selected = 0;
  let previousQuery: string | undefined;
  let dismissed: string | undefined;
  let composing = false;
  const document = input.ownerDocument;
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", list.id);

  function close(): void {
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
  }
  function draw(): void {
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
    const option = list.children[selected] as HTMLElement | undefined;
    if (option) {
      if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop;
      else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
        list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight;
      }
    }
  }
  function refresh(): void {
    const query = slashQuery(input.value, input.selectionStart, input.selectionEnd);
    if (input.readOnly || composing || document.activeElement !== input || query === undefined || dismissed === input.value) { close(); return; }
    const previous = query === previousQuery ? matches[selected]?.name : undefined;
    previousQuery = query;
    matches = matchSlashCommands(commands, query);
    if (!matches.length) { close(); return; }
    selected = Math.max(0, matches.findIndex(command => command.name === previous));
    draw();
  }
  function accept(index: number): void {
    const command = matches[index];
    if (!command || input.readOnly) return;
    const text = `/${command.name} `;
    close();
    input.value = text;
    input.setSelectionRange(text.length, text.length);
    onInsert(text);
  }
  input.addEventListener("input", () => { dismissed = undefined; refresh(); });
  input.addEventListener("focus", refresh);
  input.addEventListener("click", refresh);
  input.addEventListener("keyup", event => { if (event.key === "ArrowLeft" || event.key === "ArrowRight" || event.key === "Home" || event.key === "End") refresh(); });
  input.addEventListener("blur", close);
  input.addEventListener("compositionstart", () => { composing = true; close(); });
  input.addEventListener("compositionend", () => { composing = false; refresh(); });
  input.addEventListener("keydown", event => {
    if (event.isComposing || event.keyCode === 229 || list.hidden) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); dismissed = input.value; close();
    } else if (!event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && ["ArrowUp", "ArrowDown", "Tab", "Enter"].includes(event.key)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (event.key === "Enter" || event.key === "Tab") accept(selected);
      else { selected = (selected + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length; draw(); }
    }
  });
  list.addEventListener("mousedown", event => {
    const target = event.target as HTMLElement | null;
    const option = target?.closest<HTMLElement>("[data-index]");
    if (!option) return;
    event.preventDefault();
    accept(Number(option.dataset.index));
  });
  close();
  return {
    refresh,
    setCommands(raw) {
      const next = slashCommands(raw);
      if (JSON.stringify(next) === JSON.stringify(commands)) return;
      commands = next;
      refresh();
    },
  };
}
