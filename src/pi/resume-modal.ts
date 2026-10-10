import { SessionRow, visibleSessionRows } from "./session-picker";

export function createResumeModal(post: (type: string, data?: Record<string, unknown>) => void, onClose: (accepted: boolean) => void) {
  const dialog = document.createElement("dialog");
  dialog.id = "resume-modal";
  dialog.className = "nimrod-modal modal-stack";
  dialog.setAttribute("aria-label", "Resume session");
  const heading = document.createElement("strong"); heading.className = "modal-title"; heading.textContent = "Resume session";
  const search = document.createElement("input"); search.type = "search"; search.placeholder = "Search sessions…"; search.setAttribute("aria-label", "Search sessions");
  const status = document.createElement("div"); status.setAttribute("role", "status");
  const tree = document.createElement("div"); tree.setAttribute("role", "tree"); tree.setAttribute("aria-label", "Sessions");
  tree.id = "resume-tree"; tree.className = "modal-body";
  search.setAttribute("role", "combobox"); search.setAttribute("aria-controls", tree.id); search.setAttribute("aria-haspopup", "tree"); search.setAttribute("aria-expanded", "true"); search.setAttribute("aria-autocomplete", "list");
  const cancel = document.createElement("button"); cancel.textContent = "Cancel";
  const actions = document.createElement("div"); actions.className = "modal-actions"; actions.append(cancel);
  dialog.append(heading, search, status, tree, actions); document.body.append(dialog);
  let generation = 0;
  let action: "resume" | "delete" = "resume";
  let loading = false, minimumElapsed = false;
  let loadingTimer: ReturnType<typeof setTimeout> | undefined;
  let loaded: { rows?: SessionRow[]; error?: string } | undefined;
  let rows: SessionRow[] = [], shown: SessionRow[] = [], selected = "", pending = false;
  const collapsed = new Set<string>();
  const close = (accepted = false) => { if (pending && action === "delete" && !accepted) return; clearTimeout(loadingTimer); loading = false; loaded = undefined; dialog.close(); onClose(accepted); };
  cancel.onclick = () => close();
  dialog.addEventListener("cancel", event => { event.preventDefault(); close(); });
  const children = (row: SessionRow) => { const index = rows.indexOf(row); return (rows[index + 1]?.depth ?? 0) > row.depth; };
  const choose = () => { if (loading || !selected || pending) return; pending = true; cancel.disabled = action === "delete"; status.textContent = action === "delete" ? "Preparing deletion confirmation…" : "Opening session…"; post(`${action}Select`, { file: selected, id: String(generation) }); };
  const render = () => {
    if (loading) return;
    shown = visibleSessionRows(rows, search.value, collapsed);
    if (!shown.some(row => row.file === selected)) selected = shown[0]?.file || "";
    tree.replaceChildren();
    for (const row of shown) {
      const item = document.createElement("div"); item.setAttribute("role", "treeitem"); item.tabIndex = -1; item.id = `resume-row-${rows.indexOf(row)}`;
      item.setAttribute("aria-level", String(row.depth + 1)); item.setAttribute("aria-selected", String(row.file === selected));
      item.style.paddingLeft = `${12 + row.depth * 22}px`;
      const branch = children(row), expanded = !!search.value.trim() || !collapsed.has(row.file);
      if (branch) item.setAttribute("aria-expanded", String(expanded));
      const toggle = document.createElement("span"); toggle.className = "resume-arrow"; toggle.textContent = branch ? expanded ? "▾" : "▸" : ""; toggle.setAttribute("aria-hidden", "true");
      toggle.onclick = event => { event.stopPropagation(); selected = row.file; if (!search.value.trim()) { if (collapsed.has(row.file)) collapsed.delete(row.file); else collapsed.add(row.file); } render(); focusSelected(); };
      const text = document.createElement("span"), title = document.createElement("div"), detail = document.createElement("small"); title.textContent = row.title; detail.textContent = row.detail; text.append(title, detail); item.append(toggle, text);
      item.onclick = () => {
        selected = row.file;
        for (const sibling of Array.from(tree.children) as HTMLElement[]) {
          sibling.setAttribute("aria-selected", String(sibling === item));
          sibling.tabIndex = -1;
        }
        focusSelected();
      };
      item.ondblclick = choose;
      tree.append(item);
    }
    updateActiveDescendant();
    status.textContent = shown.length ? action === "delete" ? "Enter or double-click to review deletion" : "Enter to resume • Double-click to resume" : "No sessions found";
  };
  const updateActiveDescendant = () => {
    const item = tree.querySelector<HTMLElement>('[aria-selected="true"]');
    if (item) search.setAttribute("aria-activedescendant", item.id);
    else search.removeAttribute("aria-activedescendant");
    return item;
  };
  const focusSelected = () => {
    updateActiveDescendant()?.scrollIntoView?.({ block: "nearest" });
    search.focus({ preventScroll: true });
  };
  tree.addEventListener("mousedown", event => event.preventDefault());
  const finishLoading = () => {
    if (!dialog.open || !minimumElapsed || !loaded) return;
    loading = false; tree.removeAttribute("aria-busy");
    if (loaded.error) { tree.replaceChildren(); status.textContent = loaded.error; }
    else { rows = loaded.rows || []; render(); }
    loaded = undefined;
  };
  search.oninput = render;
  dialog.addEventListener("keydown", event => {
    if (event.isComposing || loading) return;
    const index = shown.findIndex(row => row.file === selected), row = shown[index];
    if (event.key === "Enter" && event.target !== cancel) { event.preventDefault(); choose(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault(); selected = shown[Math.max(0, Math.min(shown.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)))]?.file || ""; render(); focusSelected();
    }
    if (event.altKey && row && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
      event.preventDefault();
      if (event.key === "ArrowRight") {
        if (collapsed.has(row.file)) collapsed.delete(row.file);
        else if (children(row)) selected = shown[index + 1]?.file || selected;
      } else if (children(row) && !collapsed.has(row.file) && !search.value.trim()) collapsed.add(row.file);
      else { for (let i = index - 1; i >= 0; i--) if (shown[i].depth < row.depth) { selected = shown[i].file; break; } }
      render(); focusSelected();
    }
  });
  return {
    get open() { return dialog.open; },
    show(mode: "resume" | "delete" = "resume") {
      if (dialog.open) return;
      action = mode; heading.textContent = action === "delete" ? "Delete session tree" : "Resume session"; dialog.setAttribute("aria-label", heading.textContent); cancel.disabled = false;
      generation++; rows = []; shown = []; selected = ""; pending = false;
      loading = true; minimumElapsed = false; loaded = undefined;
      collapsed.clear(); search.value = ""; search.removeAttribute("aria-activedescendant"); tree.replaceChildren(); tree.setAttribute("aria-busy", "true");
      for (let i = 0; i < 5; i++) {
        const skeleton = document.createElement("div"); skeleton.className = "resume-skeleton"; skeleton.setAttribute("aria-hidden", "true");
        skeleton.append(document.createElement("span"), document.createElement("span")); tree.append(skeleton);
      }
      status.textContent = "Loading sessions…"; dialog.showModal(); search.focus();
      const current = generation;
      loadingTimer = setTimeout(() => { if (current !== generation) return; minimumElapsed = true; finishLoading(); }, 500);
      post(`${action}List`, { id: String(generation) });
    },
    receive(type: string, next?: SessionRow[], error?: string, id?: string) {
      if (!dialog.open || id !== String(generation)) return;
      if (type === "resumeOpened" || type === "deleteOpened") { close(true); return; }
      if (type === "resumeList" || type === "deleteList") { loaded = { rows: next, error }; finishLoading(); return; }
      pending = false; cancel.disabled = false;
      if (type === "deleteCancelled") { render(); focusSelected(); return; }
      if (error) { status.textContent = error; return; }
      if (next) { rows = next; render(); }
    },
  };
}
