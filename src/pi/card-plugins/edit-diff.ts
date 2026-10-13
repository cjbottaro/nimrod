/** Input-backed line diff. Bounds quadratic work; large middles remain literal replacements. */
export function editDiff(oldText: string, newText: string): { text: string; added: number; removed: number } {
  const before = oldText === '' ? [] : oldText.split('\n');
  const after = newText === '' ? [] : newText.split('\n');
  let start = 0;
  while (start < before.length && start < after.length && before[start] === after[start]) start++;
  let end = 0;
  while (end < before.length - start && end < after.length - start
    && before[before.length - 1 - end] === after[after.length - 1 - end]) end++;
  const a = before.slice(start, before.length - end), b = after.slice(start, after.length - end);
  const lines = before.slice(0, start).map(line => ` ${line}`);
  let added = 0, removed = 0;
  const remove = (line: string) => { lines.push(`-${line}`); removed++; };
  const add = (line: string) => { lines.push(`+${line}`); added++; };
  const width = b.length + 1;
  if ((a.length + 1) * width <= 250_000) {
    const lengths = new Uint32Array((a.length + 1) * width);
    for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) {
      lengths[i * width + j] = a[i] === b[j] ? 1 + lengths[(i + 1) * width + j + 1]
        : Math.max(lengths[(i + 1) * width + j], lengths[i * width + j + 1]);
    }
    let i = 0, j = 0;
    while (i < a.length || j < b.length) {
      if (i < a.length && j < b.length && a[i] === b[j]) { lines.push(` ${a[i++]}`); j++; }
      else if (i < a.length && (j === b.length || lengths[(i + 1) * width + j] >= lengths[i * width + j + 1])) remove(a[i++]);
      else add(b[j++]);
    }
  } else { a.forEach(remove); b.forEach(add); }
  if (end) before.slice(before.length - end).forEach(line => { lines.push(` ${line}`); });
  return { text: lines.join('\n'), added, removed };
}
