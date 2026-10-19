/** Presentation only. Concrete owners decide acceptance, cancellation and uncertainty. */
export interface OperationCard {
  readonly title: string;
  readonly state: 'pending' | 'succeeded' | 'failed' | 'unknown' | 'not-applied';
  readonly details?: string;
  readonly inlineError?: string;
  /** Opaque, owner-bound cancellation capability; absence means unsupported. */
  readonly cancelId?: string;
}
const outcomes: Record<OperationCard['state'], string> = {
  pending: 'Pending', succeeded: 'Succeeded', failed: 'Failed', unknown: 'Outcome unknown', 'not-applied': 'Not applied',
};

/** Updates a retained header/footer, without touching the consumer's content nodes. */
export function renderOperationCard(node: HTMLElement, operation: OperationCard | undefined, restoreFocus: () => void): void {
  if (!operation && !node.classList.contains('operation-card')) return;
  const document = node.ownerDocument;
  const create = <K extends keyof HTMLElementTagNameMap>(tag: K, className: string) => {
    const child = document.createElement(tag); child.className = className; return child;
  };
  const setText = (element: HTMLElement, text: string) => { if (element.textContent !== text) element.textContent = text; };
  let header = node.querySelector<HTMLElement>(':scope > .operation-header');
  let footer = node.querySelector<HTMLElement>(':scope > .operation-footer');
  node.classList.toggle('operation-card', !!operation);
  if (!operation) {
    if (header?.contains(document.activeElement)) restoreFocus();
    header?.remove(); footer?.remove(); delete node.dataset.operationState; return;
  }
  node.dataset.operationState = operation.state;
  node.setAttribute('aria-label', `${operation.title}: ${outcomes[operation.state]}`);
  if (!header) {
    header = create('div', 'operation-header');
    const label = create('div', 'steering-status');
    label.append(create('span', 'delivery-status-text'));
    header.append(label); node.prepend(header);
  }
  const title = header.querySelector<HTMLElement>('.delivery-status-text')!;
  setText(title, operation.title);
  title.classList.toggle('delivery-status-shimmer', operation.state === 'pending');
  let cancel = header.querySelector<HTMLButtonElement>('.operation-cancel');
  if (operation.state === 'pending' && operation.cancelId) {
    if (!cancel) { cancel = create('button', 'operation-cancel'); cancel.type = 'button'; cancel.textContent = 'Cancel'; header.append(cancel); }
    cancel.dataset.cancelOperation = operation.cancelId;
    cancel.setAttribute('aria-label', `Cancel ${operation.title.toLowerCase()}`);
  } else {
    if (cancel === document.activeElement) restoreFocus();
    cancel?.remove();
  }
  const compactError = operation.state === 'failed' ? operation.inlineError : undefined;
  const outcome = operation.state === 'pending' || operation.state === 'succeeded' || compactError ? '' : outcomes[operation.state];
  if (!outcome && !operation.details && !compactError) { footer?.remove(); return; }
  if (!footer) { footer = create('div', 'operation-footer'); node.append(footer); }
  let label = footer.querySelector<HTMLElement>('.operation-outcome');
  if (outcome) {
    if (!label) { label = create('div', 'operation-outcome'); footer.prepend(label); }
    setText(label, outcome);
  } else label?.remove();
  let inlineError = footer.querySelector<HTMLElement>('.operation-inline-error');
  if (compactError) {
    if (!inlineError) { inlineError = create('div', 'operation-inline-error'); footer.append(inlineError); }
    setText(inlineError, compactError);
  } else inlineError?.remove();
  let details = footer.querySelector<HTMLDetailsElement>('.operation-details');
  if (operation.details) {
    if (!details) {
      details = create('details', 'operation-details');
      details.append(create('summary', ''), create('pre', 'operation-diagnostics')); footer.append(details);
    }
    setText(details.querySelector('summary')!, operation.state === 'failed' ? 'Error details' : 'Details');
    setText(details.querySelector('pre')!, operation.details);
  } else details?.remove();
  // Content reconciliation may append blocks; diagnostics always follow content.
  if (node.lastElementChild !== footer) node.append(footer);
}
