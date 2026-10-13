/** Standalone type-only SDK for executable card manifest API v2. No runtime imports. */
export interface ToolCardData {
  name?: unknown;
  arguments?: unknown;
  uiPhase?: 'thinking' | 'stopped';
  executionOutput?: string;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: 'running' | 'finished' | 'result';
}
export interface CardSection { key: string; label: string; text: string; format?: 'text' | 'markdown' | 'diff'; }
export interface CardPresentation {
  title: string;
  preview?: string;
  /** Core-owned raw inputs default before the body; renderers may request them below it. */
  rawInputsPlacement?: 'before' | 'after';
  sections: readonly CardSection[];
  members?: readonly { key: string; title: string; preview?: string }[];
}
export interface CardUpdateState { streaming: boolean; }
/** Supported API for explicitly trusted in-process code; not a sandbox or permission boundary. */
export interface CardPluginContext {
  readonly document: Document;
  readonly summary: HTMLElement;
  readonly body: HTMLElement;
  readonly signal: AbortSignal;
  readonly capabilities: Readonly<{ copy: boolean; openLink: boolean; popOutCode: boolean }>;
  copy(text: string): Promise<void>;
  openLink(href: string): Promise<void>;
  popOutCode(text: string, language?: string): Promise<void>;
  code(source: string, language?: string): HTMLElement;
  markdown(source: string): HTMLElement;
  renderPresentation(presentation: CardPresentation): void;
  registerOutput(key: string, element: HTMLElement): () => void;
  /** Synchronous mutation wrapper; captures scroll intent before later layout changes. */
  mutate(change: () => void): void;
  /** Managed handlers may be async; their rejected promises are contained by the host. */
  on(target: EventTarget, type: string, handler: (event: Event) => void | Promise<void>): () => void;
}
export interface CardPluginInstance<Data = ToolCardData> {
  /** Synchronous; use managed callbacks/mutate for later work. */
  update(data: Readonly<Data>, state: Readonly<CardUpdateState>): void;
  dispose(): void;
}
export interface CardPlugin<Data = ToolCardData> {
  readonly apiVersion: 2;
  readonly id: string;
  /** Required for automatically discovered personal sources; optional with a separate manifest. */
  readonly tools?: readonly string[];
  /** Compatibility, not input completeness: false latches the mounted card to raw fallback. */
  supports(data: Readonly<Data>): boolean;
  mount(context: CardPluginContext): CardPluginInstance<Data>;
}
