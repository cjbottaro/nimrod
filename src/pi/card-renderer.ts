/** Internal presentation-only contract. Pi lifecycle and mounted DOM stay in the host. */
export interface CardSection {
  key: string;
  label: string;
  text: string;
  format?: 'text' | 'markdown';
}

export interface CardPresentation {
  title: string;
  preview?: string;
  sections: readonly CardSection[];
  members?: readonly { key: string; title: string; preview?: string }[];
}

export interface CardRendererInstance<Data> {
  update(data: Readonly<Data>): CardPresentation;
  dispose(): void;
}

export interface CardRenderer<Data> {
  id: string;
  supports(data: Readonly<Data>): boolean;
  mount(): CardRendererInstance<Data>;
}

/** Validate even bundled output: a failed renderer must not break sibling cards. */
export function validatePresentation(value: CardPresentation): CardPresentation {
  if (!value || typeof value.title !== 'string' || (value.preview !== undefined && typeof value.preview !== 'string')
    || !Array.isArray(value.sections)) throw new Error('Invalid card presentation');
  const keys = new Set<string>();
  for (const section of value.sections) {
    if (!section || typeof section.key !== 'string' || !section.key || keys.has(section.key)
      || typeof section.label !== 'string' || typeof section.text !== 'string'
      || (section.format !== undefined && !['text', 'markdown'].includes(section.format))) throw new Error('Invalid card section');
    keys.add(section.key);
  }
  if (value.members !== undefined) {
    if (!Array.isArray(value.members)) throw new Error('Invalid card members');
    const memberKeys = new Set<string>();
    for (const member of value.members) {
      if (!member || typeof member.key !== 'string' || !member.key || memberKeys.has(member.key)
        || typeof member.title !== 'string' || (member.preview !== undefined && typeof member.preview !== 'string')) throw new Error('Invalid card member');
      memberKeys.add(member.key);
    }
  }
  return value;
}

/** One instance per mounted card; unsupported/failing renderers latch to raw fallback. */
export class CardRendererController<Data> {
  private instance?: CardRendererInstance<Data>;
  private failed = false;
  private disposed = false;

  constructor(private readonly renderer: CardRenderer<Data>, private readonly fallback: (data: Readonly<Data>) => CardPresentation,
    private readonly report: (error: unknown) => void = () => {}) {}

  update(data: Readonly<Data>): CardPresentation {
    if (this.disposed) throw new Error('Card renderer is disposed');
    if (!this.failed) {
      try {
        if (!this.renderer.supports(data)) throw new Error(`Unsupported card for ${this.renderer.id}`);
        this.instance ??= this.renderer.mount();
        return validatePresentation(this.instance.update(data));
      } catch (error) {
        this.failed = true;
        this.release();
        this.reportSafely(error);
      }
    }
    return validatePresentation(this.fallback(data));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.release();
  }

  private release(): void {
    const instance = this.instance;
    this.instance = undefined;
    try { instance?.dispose(); } catch (error) { this.reportSafely(error); }
  }

  private reportSafely(error: unknown): void {
    try { this.report(error); } catch { /* Diagnostics cannot defeat raw recovery. */ }
  }
}
