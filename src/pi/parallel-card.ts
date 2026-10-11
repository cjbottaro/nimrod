import type { ParallelTool, ParallelToolCluster } from './tool-progress';
import { CardRendererController } from './card-renderer';
import { defaultParallelRenderer } from './card-plugins/parallel';
const instances = new WeakMap<HTMLDetailsElement, CardRendererController<ParallelToolCluster>>();
export function disposeParallelCard(details: HTMLDetailsElement): void { instances.get(details)?.dispose(); instances.delete(details); }

/** Compact live-only overview; completed rows sort above running rows. */
export function renderParallelToolCard(document: Document, cluster: ParallelToolCluster, details = document.createElement("details")): HTMLDetailsElement {
  let summary = Array.from(details.children).find((child): child is HTMLElement => child.tagName === "SUMMARY");
  let list = Array.from(details.children).find((child): child is HTMLUListElement => child.tagName === "UL" && child.classList.contains("parallel-tool-list"));
  let indicator = summary?.querySelector<HTMLElement>(".parallel-indicator");
  let title = summary?.querySelector<HTMLElement>(".parallel-title");
  if (!indicator || !title || !summary || !list) {
    // A render may resume against an interrupted/partial card. Restore the shell
    // in place rather than letting a missing child break the entire transcript.
    details.replaceChildren();
    details.className = "tool-card parallel-tool-card";
    details.open = true;
    summary = document.createElement("summary");
    const row = document.createElement("span"); row.className = "tool-card-summary";
    indicator = document.createElement("span"); indicator.className = "parallel-indicator"; indicator.setAttribute("aria-hidden", "true");
    title = document.createElement("span"); title.className = "parallel-title";
    row.append(indicator, title); summary.append(row);
    list = document.createElement("ul"); list.className = "parallel-tool-list";
    details.append(summary, list);
  }
  const running = cluster.tools.some(tool => tool.status === "running");
  setIndicator(indicator, running ? "running" : "done");
  let instance = instances.get(details);
  if (!instance) {
    instance = new CardRendererController(defaultParallelRenderer, data => ({ title: 'Parallel tools', sections: [], members: data.tools.map(tool => ({ key: tool.id, title: tool.name })) }));
    instances.set(details, instance);
  }
  const presentation = instance.update(cluster);
  title.textContent = presentation.title;
  summary.setAttribute("aria-label", `Parallel tools — ${cluster.tools.filter(tool => tool.status === "running").length} running`);
  const members = presentation.members || [];
  members.forEach((member, index) => {
    const tool = cluster.tools.find(tool => tool.id === member.key);
    if (!tool) return;
    let row = Array.from(list.children).find(child => (child as HTMLElement).dataset.toolId === tool.id) as HTMLElement | undefined;
    if (!row) {
      row = document.createElement("li"); row.dataset.toolId = tool.id; row.className = "parallel-tool-row";
      const indicator = document.createElement("span"); indicator.className = "member-indicator"; indicator.setAttribute("aria-hidden", "true");
      const name = document.createElement("span"); name.className = "tool-card-title";
      const preview = document.createElement("span"); preview.className = "tool-card-preview";
      row.append(indicator, name, preview);
    }
    setIndicator(row.querySelector<HTMLElement>(".member-indicator")!, tool.status);
    row.querySelector(".tool-card-title")!.textContent = member.title;
    row.querySelector(".tool-card-preview")!.textContent = member.preview || "";
    const at = list.children[index];
    if (at !== row) list.insertBefore(row, at || null);
  });
  for (const row of Array.from(list.children)) if (!members.some(member => member.key === (row as HTMLElement).dataset.toolId)) row.remove();
  return details;
}

function setIndicator(node: HTMLElement, status: ParallelTool["status"]): void {
  // Keep the semantic identity class used by the incremental renderer.
  node.classList.remove("tool-card-spinner", "tool-card-dot", "tool-card-succeeded", "tool-card-failed");
  if (status === "running") node.classList.add("tool-card-spinner");
  else if (status === "done") node.classList.add("tool-card-dot", "tool-card-succeeded");
  else if (status === "failed") node.classList.add("tool-card-dot", "tool-card-failed");
  else node.classList.add("tool-card-dot");
}
