export type CodeIcon = 'copy' | 'check' | 'error' | 'popout';

const paths: Record<CodeIcon, string> = {
  copy: 'M9 9h11v11H9z M15 5V3H3v12h2',
  check: 'm5 12 4 4L19 6',
  error: 'm6 6 12 12 M6 18 18 6',
  popout: 'M14 3h7v7 M21 3 10 14 M10 3H3v18h18v-7',
};

export function setCodeIcon(button: HTMLButtonElement, icon: CodeIcon): void {
  const svg = button.ownerDocument.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [key, value] of Object.entries({ viewBox: '0 0 24 24', width: '16', height: '16', fill: 'none', stroke: 'currentColor', 'stroke-width': '1.8', 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true' })) svg.setAttribute(key, value);
  const path = button.ownerDocument.createElementNS(svg.namespaceURI, 'path');
  path.setAttribute('d', paths[icon]); svg.append(path);
  button.replaceChildren(svg);
}

// A new click cancels the previous feedback timer instead of resetting early.
const resets = new WeakMap<HTMLButtonElement, ReturnType<typeof setTimeout>>();
export function showCopyResult(button: HTMLButtonElement, status: HTMLElement, success: boolean): void {
  clearTimeout(resets.get(button));
  button.disabled = false;
  setCodeIcon(button, success ? 'check' : 'error');
  button.title = success ? 'Copied to clipboard' : 'Copy failed — try again';
  status.textContent = success ? 'Copied to clipboard' : 'Unable to copy code';
  resets.set(button, setTimeout(() => {
    setCodeIcon(button, 'copy'); button.title = 'Copy to clipboard'; status.textContent = '';
    resets.delete(button);
  }, 1_200));
}
