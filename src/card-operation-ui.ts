/** Presentation only: no permission callbacks, choices or agent actions. */
export function operationPreview(document: Document, value: { title: string; description?: string; content?: readonly string[]; notes?: readonly string[]; raw: unknown }): HTMLElement {
  const region = document.createElement('div');
  const summary = document.createElement('div'); summary.className = 'acp-permission-summary';
  const title = document.createElement('strong'); title.textContent = value.title; summary.append(title);
  if (value.description) {
    const description = document.createElement('span'); description.className = 'acp-permission-description'; description.textContent = value.description;
    summary.append(document.createTextNode(' · '), description);
  }
  region.append(summary);
  for (const text of value.content || []) {
    const output = document.createElement('pre'); output.className = 'acp-permission-command'; output.tabIndex = 0;
    const code = document.createElement('code'); code.textContent = text; output.append(code); region.append(output);
  }
  for (const note of value.notes || []) { const line = document.createElement('p'); line.className = 'permission-note'; line.textContent = note; region.append(line); }
  const raw = document.createElement('details'); raw.className = 'acp-permission-raw';
  const label = document.createElement('summary'); label.textContent = 'Raw details';
  const output = document.createElement('pre'); output.textContent = JSON.stringify(value.raw, null, 2) ?? '';
  raw.append(label, output); region.append(raw);
  return region;
}
