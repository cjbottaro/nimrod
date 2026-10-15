/** Transcript-oriented console output, not a PTY or full-screen terminal emulator. */
type Style = { foreground?: string; background?: string; bold?: boolean; dim?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; inverse?: boolean; hidden?: boolean };
type Cell = { text: string; style: Style };
type Line = { cells: Cell[]; node?: HTMLSpanElement };
const names = ['Black', 'Red', 'Green', 'Yellow', 'Blue', 'Magenta', 'Cyan', 'White'];
const fallback = ['var(--vscode-editor-background, #202124)', '#cd3131', '#0dbc79', '#e5b700', '#2472c8', '#bc3fbc', '#119eaf', 'var(--vscode-editor-foreground, #ddd)', 'var(--vscode-descriptionForeground, #888)', '#f14c4c', '#23d18b', '#f5d44f', '#3b8eea', '#d670d6', '#29b8db', 'var(--vscode-editor-foreground, #fff)'];
const palette = (index: number): string => `var(--vscode-terminal-ansi${index < 8 ? '' : 'Bright'}${names[index % 8]}, ${fallback[index]})`;
const color = (index: number): string => {
  if (index < 16) return palette(index);
  if (index >= 232) { const gray = 8 + (index - 232) * 10; return `rgb(${gray}, ${gray}, ${gray})`; }
  const n = index - 16, levels = [0, 95, 135, 175, 215, 255];
  return `rgb(${levels[Math.floor(n / 36)]}, ${levels[Math.floor(n / 6) % 6]}, ${levels[n % 6]})`;
};
const renderers = new WeakMap<HTMLElement, ConsoleOutput>();

export function clearConsoleOutput(output: HTMLElement): void { renderers.delete(output); }

export function renderConsoleOutput(output: HTMLElement, source: string): void {
  let renderer = renderers.get(output);
  if (!renderer) { renderer = new ConsoleOutput(output); renderers.set(output, renderer); }
  renderer.update(source);
}

class ConsoleOutput {
  private source = '';
  private lines: Line[] = [{ cells: [] }];
  private row = 0;
  private column = 0;
  private style: Style = {};
  private state: 'text' | 'escape' | 'csi' | 'string' | 'string-escape' | 'charset' = 'text';
  private sequence = '';
  private dirty = new Set<Line>();
  private plain = true;
  private carry = '';
  constructor(private readonly output: HTMLElement) { output.replaceChildren(); }

  update(source: string): void {
    if (source === this.source) return;
    // Ordinary command logs stay on the cheap literal-text path until controls appear.
    if (this.plain && !/[\x00-\x09\x0b-\x1f\x7f-\x9f]/.test(source)) {
      this.output.textContent = source; this.source = source; return;
    }
    let suffix: string;
    if (this.plain || !source.startsWith(this.source)) {
      this.lines = [{ cells: [] }]; this.row = this.column = 0; this.style = {};
      this.state = 'text'; this.sequence = this.carry = ''; this.output.replaceChildren();
      this.dirty.clear(); this.dirty.add(this.lines[0]); suffix = source;
    } else suffix = this.carry + source.slice(this.source.length);
    this.plain = false; this.source = source; this.carry = '';
    // Do not split an astral character between cumulative snapshots.
    if (suffix.length && /[\ud800-\udbff]/.test(suffix.at(-1)!)) { this.carry = suffix.at(-1)!; suffix = suffix.slice(0, -1); }
    for (const char of suffix) this.consume(char);
    this.flush();
  }

  private consume(char: string): void {
    if (this.state === 'string' || this.state === 'string-escape') {
      if (char === '\x07' || char === '\x9c' || (this.state === 'string-escape' && char === '\\')) this.state = 'text';
      else this.state = char === '\x1b' ? 'string-escape' : 'string';
      return;
    }
    if (char === '\x1b') { this.state = 'escape'; return; }
    if (this.state === 'charset') { this.state = 'text'; return; }
    if (this.state === 'escape') {
      this.state = 'text';
      if (char === '[') { this.state = 'csi'; this.sequence = ''; }
      else if (']PX^_'.includes(char)) this.state = 'string';
      else if ('()*+-./'.includes(char)) this.state = 'charset';
      return;
    }
    if (this.state === 'csi') {
      if (char >= '@' && char <= '~') { this.command(char, this.sequence); this.state = 'text'; }
      else if (this.sequence.length < 256) this.sequence += char;
      return;
    }
    if (char === '\x9b') { this.state = 'csi'; this.sequence = ''; return; }
    if ('\x90\x98\x9d\x9e\x9f'.includes(char)) { this.state = 'string'; return; }
    if (char === '\r') { this.column = 0; return; }
    if (char === '\b') { this.column = Math.max(0, this.column - 1); return; }
    if (char === '\n') {
      this.row++; this.column = 0;
      if (!this.lines[this.row]) { this.lines.push({ cells: [] }); this.dirty.add(this.lines[this.row]); }
      return;
    }
    if (char === '\t') { this.column = Math.min(16384, (Math.floor(this.column / 8) + 1) * 8); return; }
    if (char < ' ' || (char >= '\x7f' && char <= '\x9f')) return;
    const line = this.lines[this.row];
    const blankStyle: Style = {};
    while (line.cells.length < this.column) line.cells.push({ text: ' ', style: blankStyle });
    line.cells[this.column++] = { text: char, style: this.style };
    this.dirty.add(line);
  }

  private command(final: string, sequence: string): void {
    // Private modes, reports and unsupported/intermediate controls have no transcript effects.
    if (!/^[\d;:]*$/.test(sequence)) return;
    const values = sequence.split(';').map(value => Number(value) || 0), amount = values[0] || 1;
    const line = this.lines[this.row];
    if (final === 'm') { this.sgr(sequence); return; }
    if (final === 'A') this.row = Math.max(0, this.row - amount);
    else if (final === 'B') this.row = Math.min(this.lines.length - 1, this.row + amount);
    else if (final === 'C') this.column = Math.min(16384, this.column + amount);
    else if (final === 'D') this.column = Math.max(0, this.column - amount);
    else if (final === 'G' || final === '`') this.column = Math.min(16384, amount - 1);
    else if (final === 'K') {
      if (values[0] === 0) line.cells.length = Math.min(line.cells.length, this.column);
      else if (values[0] === 1) {
        for (let i = 0; i <= Math.min(this.column, line.cells.length - 1); i++) line.cells[i] = { text: ' ', style: this.style };
      } else if (values[0] === 2) line.cells = [];
      this.dirty.add(line);
    }
  }

  private sgr(sequence: string): void {
    // Also accept the ISO colon spelling of extended colors (including an empty color-space field).
    const values = sequence.replace(/(38|48):2::/g, '$1;2;').replaceAll(':', ';').split(';').map(value => Number(value) || 0);
    const next = { ...this.style };
    for (let i = 0; i < values.length; i++) {
      const code = values[i];
      if (code === 0) { for (const key of Object.keys(next) as (keyof Style)[]) delete next[key]; }
      else if (code === 1) next.bold = true;
      else if (code === 2) next.dim = true;
      else if (code === 3) next.italic = true;
      else if (code === 4 || code === 21) next.underline = true;
      else if (code === 7) next.inverse = true;
      else if (code === 8) next.hidden = true;
      else if (code === 9) next.strike = true;
      else if (code === 22) { delete next.bold; delete next.dim; }
      else if (code === 23) delete next.italic;
      else if (code === 24) delete next.underline;
      else if (code === 27) delete next.inverse;
      else if (code === 28) delete next.hidden;
      else if (code === 29) delete next.strike;
      else if (code === 39) delete next.foreground;
      else if (code === 49) delete next.background;
      else if (code >= 30 && code <= 37) next.foreground = palette(code - 30);
      else if (code >= 90 && code <= 97) next.foreground = palette(code - 90 + 8);
      else if (code >= 40 && code <= 47) next.background = palette(code - 40);
      else if (code >= 100 && code <= 107) next.background = palette(code - 100 + 8);
      else if (code === 38 || code === 48) {
        const key = code === 38 ? 'foreground' : 'background', mode = values[++i];
        if (mode === 5) {
          const index = values[++i]; if (index >= 0 && index <= 255) next[key] = color(index);
        } else if (mode === 2) {
          const rgb = values.slice(i + 1, i + 4); i += 3;
          if (rgb.length === 3 && rgb.every(n => n >= 0 && n <= 255)) next[key] = `rgb(${rgb.join(', ')})`;
        }
      }
    }
    this.style = next;
  }

  private flush(): void {
    const doc = this.output.ownerDocument;
    for (const line of this.dirty) {
      if (!line.node) {
        line.node = doc.createElement('span'); line.node.className = 'console-output-line';
        if (this.output.childNodes.length) this.output.append(doc.createTextNode('\n'));
        this.output.append(line.node);
      }
      const fragment = doc.createDocumentFragment();
      let text = '', style: Style | undefined;
      const append = () => {
        if (!text) return;
        if (!style || !Object.keys(style).length) fragment.append(doc.createTextNode(text));
        else {
          const span = doc.createElement('span'); span.textContent = text;
          const foreground = style.foreground || 'var(--vscode-editor-foreground, inherit)';
          const background = style.background || 'var(--vscode-editor-background, transparent)';
          if (style.foreground || style.inverse) span.style.color = style.inverse ? background : foreground;
          if (style.background || style.inverse) span.style.backgroundColor = style.inverse ? foreground : background;
          if (style.bold) span.style.fontWeight = 'bold';
          if (style.dim) span.style.opacity = '0.65';
          if (style.italic) span.style.fontStyle = 'italic';
          if (style.underline || style.strike) span.style.textDecoration = [style.underline ? 'underline' : '', style.strike ? 'line-through' : ''].filter(Boolean).join(' ');
          if (style.hidden) span.style.visibility = 'hidden';
          fragment.append(span);
        }
        text = '';
      };
      for (const cell of line.cells) { if (style !== cell.style) { append(); style = cell.style; } text += cell.text; }
      append(); line.node.replaceChildren(fragment);
    }
    this.dirty.clear();
  }
}
