/** Shared, decorative Enter-to-activate hint for picker rows, not action buttons.
 * `.picker-enter-hint` owns the appearance; the picker owns placement/visibility.
 * Use the owning document so the SVG belongs to the correct window.
 */
export function createPickerEnterHint(doc: Document): SVGSVGElement {
  const enter = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  enter.classList.add('picker-enter-hint');
  enter.setAttribute('viewBox', '0 0 24 24');
  enter.setAttribute('fill', 'none');
  enter.setAttribute('stroke', 'currentColor');
  enter.setAttribute('stroke-width', '1.7');
  enter.setAttribute('stroke-linecap', 'round');
  enter.setAttribute('stroke-linejoin', 'round');
  enter.setAttribute('aria-hidden', 'true');
  enter.setAttribute('focusable', 'false');
  const path = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', 'M20 4v8a4 4 0 0 1-4 4H4m5-5-5 5 5 5');
  enter.append(path);
  return enter;
}
