/** Internal consumer contract, not a harness protocol or public plugin API. */
export interface StatusAreaControl {
  readonly id: string;
  readonly label: string;
  readonly title: string;
  readonly disabled: boolean;
}
export interface StatusAreaInformation { readonly label: string; readonly text: string; }
export interface StatusAreaCapabilities {
  /** Missing means unsupported; supported metrics may still have no reported value. */
  readonly metrics?: { readonly label: string };
  readonly information?: boolean;
  readonly subagents?: boolean;
  readonly queue?: boolean;
}
/**
 * Immutable-by-convention publication through the owning conversation's ordered
 * snapshot channel. Producers retain this object on content-only updates.
 * Controls themselves advertise support: absent = unsupported, disabled =
 * temporarily unavailable. IDs are opaque, session-bound action contributions.
 */
export interface StatusAreaSnapshot {
  readonly capabilities: StatusAreaCapabilities;
  readonly controlsLabel: string;
  readonly controls: readonly StatusAreaControl[];
  readonly subagents?: string;
  readonly information?: readonly StatusAreaInformation[];
  readonly metrics?: string;
  /** Integration-owned metric detail/units; shared rendering never interprets billing. */
  readonly metricsTitle?: string;
}
