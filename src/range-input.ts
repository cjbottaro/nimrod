/** Paint-only range state. Call after assigning .value and on native input;
 * never synthesize input/change events just to initialize a slider's fill.
 */
export function updateRangeFill(input: HTMLInputElement): void {
  const bound = (text: string, fallback: number) => text !== '' && Number.isFinite(Number(text)) ? Number(text) : fallback;
  const min = bound(input.min, 0), max = bound(input.max, 100), value = input.valueAsNumber;
  const progress = max > min && Number.isFinite(value)
    ? Math.max(0, Math.min(100, (value - min) / (max - min) * 100)) : 0;
  input.style.setProperty('--range-fill', `${Number(progress.toFixed(4))}%`);
}
