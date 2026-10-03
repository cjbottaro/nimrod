import { ActivityPresentation } from "./activity-state";

export interface MainActivityDom {
  spinner: HTMLSpanElement;
  text: HTMLSpanElement;
}

export interface SubagentActivityDom {
  root: HTMLElement;
  spinner: HTMLSpanElement;
  text: HTMLSpanElement;
}

/** Build this once: replacing a CSS-animated spinner on every stream update restarts it. */
export function createMainActivityDom(root: HTMLElement): MainActivityDom {
  const spinner = root.ownerDocument.createElement("span");
  spinner.className = "activity-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = root.ownerDocument.createElement("span");
  text.className = "main-activity-text";
  root.prepend(spinner, text);
  return { spinner, text };
}

/** The recognized subagent count owns a separate, stable spinner beside its status text. */
export function createSubagentActivityDom(root: HTMLElement): SubagentActivityDom {
  const spinner = root.ownerDocument.createElement("span");
  spinner.className = "activity-spinner";
  spinner.setAttribute("aria-hidden", "true");
  const text = root.ownerDocument.createElement("span");
  text.className = "subagent-activity-text";
  root.replaceChildren(spinner, text);
  return { root, spinner, text };
}

export function renderMainActivity(dom: MainActivityDom, presentation: ActivityPresentation): void {
  dom.spinner.hidden = !presentation.busy;
  dom.text.textContent = presentation.text;
}

export function renderSubagentActivity(dom: SubagentActivityDom, subagents: string | undefined): void {
  dom.root.hidden = !subagents;
  dom.text.textContent = subagents || "";
}
