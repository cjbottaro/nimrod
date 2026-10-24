/** Standalone type-only SDK for executable card manifest API v2. No runtime imports. */
export interface CardPluginTarget { backend: string; agent?: string; }
export interface ToolCardData {
  /** Absence means legacy Pi. Supplied by Nimrod, not inferred from a tool name. */
  source?: CardPluginTarget;
  title?: string;
  kind?: string;
  /** Retained native tool metadata, not permission to execute anything. */
  native?: unknown;
  name?: unknown;
  arguments?: unknown;
  uiPhase?: 'thinking' | 'stopped';
  executionOutput?: string;
  resultOutput?: string;
  isError?: boolean;
  toolStatus?: 'running' | 'finished' | 'result';
}
export interface CardSection {
  key: string; label: string; text: string; format?: 'text' | 'markdown' | 'diff' | 'console';
  /** Markdown-only: keep HTTP(S) links, resolving relative URLs only against a supplied web base. */
  webLinks?: boolean;
  baseUrl?: string;
}
export interface CardPresentation {
  title: string;
  preview?: string;
  /** Display-only line counts; adapters distinguish requested from confirmed changes. */
  diffStats?: { added: number; removed: number };
  /** Read-only question/reply summary; title is the question. No decision controls. */
  questionAnswer?: { answer: string };
  /** Core-owned raw inputs default before the body; renderers may request them below it. */
  rawInputsPlacement?: 'before' | 'after';
  /** Compact display of a sole string input field; other shapes retain Raw inputs. */
  inputDisclosure?: { label: string; field: string };
  /** Optional retained disclosure around output sections. */
  outputDisclosure?: string;
  sections: readonly CardSection[];
  members?: readonly { key: string; title: string; preview?: string }[];
}
export interface CardUpdateState { streaming: boolean; }
/** Supported API for explicitly trusted in-process code; not a sandbox or permission boundary. */
export interface CardPluginContext {
  /** Owning project's canonical directory; display context only, not file-access authority. */
  readonly projectDirectory?: string;
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
  /** Normalized tool names, not ACP categories. Personal sources need tools and/or kinds. */
  readonly tools?: readonly string[];
  /** ACP categories (execute, edit, etc.), independent of the optional native tool name. */
  readonly kinds?: readonly string[];
  /** Omitted targets preserve legacy Pi-only matching. An ACP target may name an exact negotiated agent. */
  readonly targets?: readonly CardPluginTarget[];
  /** Optional mount-time applicability, after metadata matching. False tries another candidate.
   * Runs on an immutable snapshot; never use input completeness to select a streaming renderer. */
  matches?(data: Readonly<Data>): boolean;
  /** Compatibility, not input completeness: false latches the mounted card to raw fallback. */
  supports(data: Readonly<Data>): boolean;
  mount(context: CardPluginContext): CardPluginInstance<Data>;
}
