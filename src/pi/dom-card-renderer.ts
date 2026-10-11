import { validatePresentation, type CardPresentation, type CardRenderer } from './card-renderer';

export interface CardUpdateState { streaming: boolean; }
/** Supported API boundaries for trusted code, not a JavaScript sandbox. */
export interface CardPluginContext {
  readonly document: Document;
  readonly summary: HTMLElement;
  readonly body: HTMLElement;
  readonly signal: AbortSignal;
  renderPresentation(presentation: CardPresentation): void;
  markdown(source: string): HTMLElement;
  registerOutput(key: string, element: HTMLElement): () => void;
  mutate(change: () => void): void;
  on(target: EventTarget, type: string, handler: (event: Event) => void | Promise<void>): () => void;
}
export interface DomCardInstance<Data> {
  update(data: Readonly<Data>, state: Readonly<CardUpdateState>): void;
  dispose(): void;
}
export interface DomCardRenderer<Data> {
  readonly apiVersion: 2;
  readonly id: string;
  supports(data: Readonly<Data>): boolean;
  mount(context: CardPluginContext): DomCardInstance<Data>;
}
export interface CardDomHost {
  markdown?: (source: string) => HTMLElement;
  beforeChange?: () => void;
  afterChange?: () => void;
  canInteract?: () => boolean;
  report?: (error: unknown) => void;
  /** Core may retain independent raw recovery outside plugin-owned slots. */
  afterUpdate?: () => void;
}

/** Legacy declarations and pure bundled presentation helpers use the public DOM API. */
export function presentationPlugin<Data>(renderer: CardRenderer<Data>): DomCardRenderer<Data> {
  return { apiVersion: 2, id: renderer.id, supports: data => renderer.supports(data), mount(context) {
    const instance = renderer.mount();
    return { update(data) { context.renderPresentation(instance.update(data)); }, dispose: () => instance.dispose() };
  } };
}

export class DomCardController<Data> {
  private instance?: DomCardInstance<Data>;
  private resources = new AbortController();
  private cleanups = new Set<() => void>();
  private outputs = new Map<string, HTMLElement>();
  private failed = false;
  private disposed = false;
  private data?: Readonly<Data>;
  private state: CardUpdateState = { streaming: false };
  private readonly content = new WeakMap<HTMLElement, { text: string; format: string }>();
  readonly context: CardPluginContext;

  constructor(private readonly renderer: DomCardRenderer<Data>, private readonly summary: HTMLElement,
    private readonly body: HTMLElement, private readonly fallback: (data: Readonly<Data>) => CardPresentation,
    private readonly host: CardDomHost = {}) {
    const owner = this;
    this.context = {
      document: body.ownerDocument, summary, body,
      get signal() { return owner.resources.signal; },
      renderPresentation: value => { if (this.alive()) this.renderPresentation(validatePresentation(value)); },
      markdown: source => this.host.markdown?.(source) ?? this.literal(source),
      registerOutput: (key, element) => {
        if (!this.alive()) return () => {};
        if (!key || !this.body.contains(element)) throw new Error('Output viewport must belong to the plugin body');
        const existing = this.outputs.get(key);
        if (existing && existing !== element) throw new Error(`Duplicate output viewport ${key}`);
        this.outputs.set(key, element);
        element.classList.add('tool-output');
        this.applyOutputPolicy(element);
        return () => { if (this.outputs.get(key) === element) this.outputs.delete(key); };
      },
      mutate: change => {
        if (!this.alive()) return;
        this.host.beforeChange?.();
        const positions = this.captureOutputs();
        try { const result: unknown = change(); this.assertSynchronous(result, 'mutate'); } catch (error) { this.fail(error); }
        finally { this.restoreOutputs(positions); this.host.afterChange?.(); }
      },
      on: (target, type, handler) => {
        if (!this.alive()) return () => {};
        const listener = (event: Event) => {
          if (!this.alive() || !this.body.isConnected || this.host.canInteract?.() === false) return;
          try { void Promise.resolve(handler(event)).catch(error => this.fail(error)); } catch (error) { this.fail(error); }
        };
        target.addEventListener(type, listener);
        const remove = () => { target.removeEventListener(type, listener); this.cleanups.delete(remove); };
        this.cleanups.add(remove); return remove;
      },
    };
  }

  update(data: Readonly<Data>, state: CardUpdateState): void {
    if (this.disposed) return;
    this.data = data; this.state = state;
    const positions = this.captureOutputs();
    if (!this.failed) {
      try {
        const supported: unknown = this.renderer.supports(data);
        this.assertSynchronous(supported, 'supports');
        if (supported !== true) throw new Error(`Unsupported card for ${this.renderer.id}`);
        if (!this.instance) {
          const candidate = this.renderer.mount(this.context);
          this.assertSynchronous(candidate, 'mount');
          this.instance = candidate;
        }
        if (!this.instance || typeof this.instance.update !== 'function' || typeof this.instance.dispose !== 'function') throw new Error('Invalid DOM renderer instance');
        const result: unknown = this.instance.update(data, state);
        this.assertSynchronous(result, 'update');
      } catch (error) { this.fail(error); }
    } else this.renderPresentation(this.fallback(data));
    for (const [key, output] of this.outputs) {
      if (!this.body.contains(output)) this.outputs.delete(key);
      else this.applyOutputPolicy(output);
    }
    this.restoreOutputs(positions);
    this.host.afterUpdate?.();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true; this.release();
  }

  private alive(): boolean { return !this.disposed && !this.failed; }
  private literal(text: string): HTMLElement { const node = this.body.ownerDocument.createElement('pre'); node.textContent = text; return node; }
  private applyOutputPolicy(output: HTMLElement): void {
    output.classList.add('tool-output');
    output.classList.toggle('tool-output-streaming', this.state.streaming);
    output.classList.toggle('tool-output-final', !this.state.streaming);
  }
  private captureOutputs(): Map<string, { top: number; atBottom: boolean }> {
    return new Map([...this.outputs].map(([key, output]) => [key, { top: output.scrollTop, atBottom: output.clientHeight > 0 && output.scrollTop + output.clientHeight >= output.scrollHeight - 2 }]));
  }
  private restoreOutputs(positions: Map<string, { top: number; atBottom: boolean }>): void {
    for (const [key, output] of this.outputs) {
      const previous = positions.get(key);
      if (!previous) continue;
      if (!previous.atBottom) output.scrollTop = previous.top;
      else if (this.state.streaming) output.scrollTop = output.scrollHeight;
    }
  }
  private release(): void {
    this.resources.abort();
    for (const remove of [...this.cleanups]) remove();
    this.outputs.clear();
    const instance = this.instance; this.instance = undefined;
    try { const result: unknown = instance?.dispose(); this.assertSynchronous(result, 'dispose'); } catch (error) { this.report(error); }
  }
  private fail(error: unknown): void {
    if (this.failed || this.disposed) return;
    this.host.beforeChange?.();
    this.failed = true; this.release();
    this.summary.replaceChildren(); this.body.replaceChildren();
    this.report(error);
    if (this.data !== undefined) this.renderPresentation(this.fallback(this.data));
    this.host.afterUpdate?.();
    this.host.afterChange?.();
  }
  private assertSynchronous(value: unknown, operation: string): void {
    if (value && typeof (value as { then?: unknown }).then === 'function') {
      void Promise.resolve(value).catch(error => this.report(error));
      throw new Error(`Card plugin ${operation} must be synchronous; use managed callbacks and mutate for later work`);
    }
  }
  private report(error: unknown): void { try { this.host.report?.(error); } catch { /* diagnostics aren't recovery */ } }

  private renderPresentation(value: CardPresentation): void {
    const doc = this.body.ownerDocument;
    let title = this.summary.querySelector<HTMLElement>('.tool-card-title');
    if (!title) { title = doc.createElement('span'); title.className = 'tool-card-title'; this.summary.append(title); }
    title.textContent = value.title;
    let preview = this.summary.querySelector<HTMLElement>('.tool-card-preview');
    if (value.preview !== undefined) {
      if (!preview) { preview = doc.createElement('span'); preview.className = 'tool-card-preview'; this.summary.append(preview); }
      preview.textContent = value.preview;
    } else preview?.remove();
    const sections = () => Array.from(this.body.children).filter((node): node is HTMLElement => node instanceof doc.defaultView!.HTMLElement && node.classList.contains('tool-section'));
    const old = new Map(sections().map(section => [section.dataset.outputKind!, section]));
    value.sections.forEach((part, index) => {
      let section = old.get(part.key);
      if (!section) {
        section = doc.createElement('div'); section.className = 'tool-section'; section.dataset.outputKind = part.key;
        const label = doc.createElement('div'); label.className = 'tool-label';
        const output = doc.createElement('pre'); output.className = 'tool-output'; output.tabIndex = 0;
        section.append(label, output);
      }
      section.querySelector<HTMLElement>('.tool-label')!.textContent = part.label;
      const output = section.querySelector<HTMLElement>('.tool-output')!;
      output.setAttribute('aria-label', part.label);
      const format = part.format || 'text';
      const previous = this.content.get(output);
      if (previous?.text !== part.text || previous.format !== format) {
        this.content.set(output, { text: part.text, format });
        if (format === 'diff') {
          output.replaceChildren();
          for (const line of part.text.split('\n')) {
            const span = doc.createElement('span'); span.className = line.startsWith('+') ? 'hljs-addition' : line.startsWith('-') ? 'hljs-deletion' : '';
            span.textContent = line; output.append(span, doc.createTextNode('\n'));
          }
        } else if (format === 'markdown') output.replaceChildren(this.context.markdown(part.text));
        else output.textContent = part.text;
      }
      this.applyOutputPolicy(output); this.outputs.set(part.key, output);
      const at = sections()[index]; if (at !== section) this.body.insertBefore(section, at || null);
      old.delete(part.key);
    });
    for (const [key, section] of old) { section.remove(); this.outputs.delete(key); }
  }
}
