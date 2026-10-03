/** Replace changed blocks, preserve live tool nodes, and remove newly empty blocks. */
export function reconcileContentBlock(parent: HTMLElement, previous: HTMLElement | undefined, next: HTMLElement | undefined, position: HTMLElement | undefined): void {
  if (!next) {
    previous?.remove();
    return;
  }
  if (previous && previous !== next) {
    previous.replaceWith(next);
    if (position === previous) position = next;
  }
  if (position !== next) parent.insertBefore(next, position || null);
}
