import type { ScanStyle } from './modal-animation-defaults';

export interface ScanBounds { top: number; bottom: number }
export interface ScanEdges { top: number; bottom: number }
export interface ScanPlan { from: ScanEdges; to: ScanEdges; speed: number; duration: number }

export function initialScanEdges(style: ScanStyle, bounds: ScanBounds): ScanEdges {
  const origin = style === 'crt' ? (bounds.top + bounds.bottom) / 2 : bounds.top;
  return { top: origin, bottom: origin };
}

/** Edges are absolute CSS-pixel positions, never percentages of a mutable box. */
export function planScan(style: ScanStyle, bounds: ScanBounds, from: ScanEdges, speed: number, closing = false): ScanPlan {
  if (style === 'hologram') from = { top: bounds.top, bottom: from.bottom };
  const center = Math.max(from.top, Math.min((bounds.top + bounds.bottom) / 2, from.bottom));
  const to = closing ? { top: style === 'crt' ? center : bounds.top, bottom: style === 'crt' ? center : bounds.top }
    : { top: style === 'crt' ? Math.min(from.top, bounds.top) : bounds.top, bottom: Math.max(from.bottom, bounds.bottom) };
  // A filtered CRT can move completely outside its old reveal band. Finish
  // instead of hiding the new results while an off-screen edge catches up.
  const outside = !closing && style === 'crt' && (from.top >= bounds.bottom || from.bottom <= bounds.top);
  const distance = outside ? 0 : Math.max(Math.abs(to.top - from.top), Math.abs(to.bottom - from.bottom));
  return { from, to, speed, duration: distance / speed * 1000 };
}

export function sampleScan(plan: ScanPlan, elapsed: number): ScanEdges {
  const distance = Math.max(0, elapsed) / 1000 * plan.speed;
  const move = (from: number, to: number) => from + Math.sign(to - from) * Math.min(distance, Math.abs(to - from));
  return { top: move(plan.from.top, plan.to.top), bottom: move(plan.from.bottom, plan.to.bottom) };
}

/** Extra keyframes stop an edge at its boundary while the other keeps moving. */
export function scanOffsets(plan: ScanPlan): number[] {
  if (!plan.duration) return [0, 1];
  return [...new Set([0, 1, ...(['top', 'bottom'] as const).map(key => Math.abs(plan.to[key] - plan.from[key]) / plan.speed * 1000 / plan.duration)])].sort((a, b) => a - b);
}

export function scanClip(bounds: ScanBounds, edges: ScanEdges): string {
  return `inset(${Math.max(0, edges.top - bounds.top)}px 0px ${Math.max(0, bounds.bottom - edges.bottom)}px 0px)`;
}

export function edgesFromClip(style: ScanStyle, bounds: ScanBounds, clip: string): ScanEdges {
  const parts = clip.match(/^inset\(([^)]+)\)$/)?.[1].trim().split(/\s+/);
  if (!parts) return { ...bounds };
  const length = (part: string) => part.endsWith('%') ? parseFloat(part) / 100 * (bounds.bottom - bounds.top) : parseFloat(part);
  const top = style === 'crt' ? length(parts[0]) : 0, bottom = length(parts[2] ?? parts[0]);
  return Number.isFinite(top) && Number.isFinite(bottom) ? { top: bounds.top + top, bottom: bounds.bottom - bottom } : { ...bounds };
}
