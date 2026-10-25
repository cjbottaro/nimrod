export type PaletteItemMarker = 'bullet' | 'pencil' | 'circle-slash';

/** Decorative leading markers never alter a choice's label, answer or keyboard bindings. */
export function createPaletteItemMarker(document: Document, kind: PaletteItemMarker): HTMLElement {
  const marker = document.createElement('span');
  marker.className = 'palette-item-marker'; marker.dataset.marker = kind;
  marker.setAttribute('aria-hidden', 'true');
  if (kind === 'bullet') { marker.textContent = '•'; return marker; }
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.5');
  svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('focusable', 'false');
  if (kind === 'circle-slash') {
    const circle = document.createElementNS(ns, 'circle');
    circle.setAttribute('cx', '12'); circle.setAttribute('cy', '12'); circle.setAttribute('r', '9');
    svg.append(circle);
  }
  const path = document.createElementNS(ns, 'path');
  path.setAttribute('d', kind === 'pencil' ? 'm16 3 5 5-13 13H3v-5L16 3Z M14 5l5 5' : 'm5.6 5.6 12.8 12.8');
  svg.append(path); marker.append(svg); return marker;
}
