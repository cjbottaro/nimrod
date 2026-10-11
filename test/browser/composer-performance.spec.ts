import { expect, test } from '@playwright/test';
import { demoFixture, visible } from './demo-fixture';

// Timings are diagnostic, not CI thresholds. Deterministic operation counts
// distinguish main-thread work from browser/OS scheduling noise.
for (const scenario of [
  { name: 'empty', messages: 0, drafts: 0, persistent: true },
  { name: 'transcript', messages: 160, drafts: 0, persistent: true },
  { name: 'draft-library', messages: 0, drafts: 200, persistent: true },
  { name: 'combined', messages: 160, drafts: 200, persistent: true },
  { name: 'temporary-with-saved-drafts', messages: 0, drafts: 200, persistent: false },
]) test(`typing work: ${scenario.name}`, async ({ page }, testInfo) => {
  const drafts = Object.fromEntries(Array.from({ length: scenario.drafts }, (_, i) =>
    [`file:/offline/closed-${i}.jsonl`, { draft: 'Saved offline draft. '.repeat(200), recovered: [] }]));
  const demo = await demoFixture(page, {}, [], { drafts, persistent: scenario.persistent });
  try {
    // Inject offline authoritative events into the real app channel. No models,
    // session files or live application windows are involved.
    await page.evaluate(count => {
      const channels = (window as unknown as { __fixtureChannels: Record<string, { onmessage(packet: unknown): void }> }).__fixtureChannels;
      const channel = Object.values(channels)[0];
      for (let i = 0; i < count; i++) channel.onmessage({ kind: 'rpc', value: {
        type: 'message_end', message: { role: i % 2 ? 'assistant' : 'user', timestamp: i + 1,
          content: [{ type: 'text', text: `Offline turn ${i}\n\n` + (i % 2
            ? 'Some **rendered Markdown**.\n\n```typescript\nconst value = 42;\n```\n'.repeat(3)
            : 'Please inspect the local fixture. '.repeat(6)) }] },
      } });
    }, scenario.messages);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const prompt = page.locator(visible('prompt'));
    await prompt.focus();
    await prompt.evaluate(field => {
      const input = field as HTMLTextAreaElement;
      const root = input.closest('.session-view')!;
      const status = root.querySelector('[data-pi-id="activity"]')!;
      const send = root.querySelector('[data-pi-id="send"]')!;
      const report = { handlers: [] as number[], storageMs: 0, storageWrites: 0, storageBytes: 0, layoutReads: 0, inputLayoutReads: 0, statusMutations: 0 };
      const observer = new MutationObserver(records => { report.statusMutations += records.length; });
      observer.observe(status, { subtree: true, childList: true, characterData: true, attributes: true });
      observer.observe(send, { subtree: true, childList: true, attributes: true });
      (window as unknown as { __typingReport: typeof report }).__typingReport = report;
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        const start = performance.now();
        try { return original.call(this, key, value); }
        finally { report.storageMs += performance.now() - start; report.storageWrites++; report.storageBytes += value.length; }
      };
      for (const [node, property] of [[input, 'scrollHeight'], [root.querySelector('[data-pi-id="composer-shell"]')!, 'offsetHeight']] as const) {
        let prototype: object | null = node;
        let descriptor: PropertyDescriptor | undefined;
        while (prototype && !descriptor) { descriptor = Object.getOwnPropertyDescriptor(prototype, property); prototype = Object.getPrototypeOf(prototype); }
        const get = descriptor!.get!;
        Object.defineProperty(node, property, { configurable: true, get() { report.layoutReads++; return get.call(this); } });
      }
      let started = 0;
      let layoutBefore = 0;
      input.addEventListener('input', () => { started = performance.now(); layoutBefore = report.layoutReads; observer.takeRecords(); }, { capture: true });
      input.addEventListener('input', () => {
        report.handlers.push(performance.now() - started);
        report.inputLayoutReads += report.layoutReads - layoutBefore;
        report.statusMutations += observer.takeRecords().length;
      });
    });
    const text = 'Typing a normal prompt should stay responsive even with retained session drafts.';
    await page.keyboard.type(text);
    await expect(prompt).toHaveValue(text);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const report = await page.evaluate(() => {
      const raw = (window as unknown as { __typingReport: { handlers: number[]; storageMs: number; storageWrites: number; storageBytes: number; layoutReads: number; inputLayoutReads: number; statusMutations: number } }).__typingReport;
      const sorted = [...raw.handlers].sort((a, b) => a - b);
      return { ...raw, handlers: raw.handlers.length, p50Ms: sorted[Math.floor(sorted.length * .5)], p95Ms: sorted[Math.floor(sorted.length * .95)], maxMs: sorted.at(-1),
        domNodes: document.querySelectorAll('*').length };
    });
    console.log(`Typing benchmark ${scenario.name}: ${JSON.stringify(report)}`);
    await testInfo.attach('typing-work.json', { body: JSON.stringify({ scenario, report }, null, 2), contentType: 'application/json' });
    expect(report.handlers).toBe(text.length);
    expect(report.inputLayoutReads, 'typing does not synchronously force composer measurement').toBe(0);
    expect(report.statusMutations, 'draft edits do not rebuild status controls').toBe(0);
    expect(report.storageWrites).toBe(0);
    if (scenario.persistent) {
      await expect.poll(() => [...demo.nativeDrafts.values()].some(record => (record.value as { draft: string })?.draft === text)).toBe(true);
      expect(demo.nativeDrafts.get('file:/offline/closed-0.jsonl')?.value).toEqual(drafts['file:/offline/closed-0.jsonl']);
    }
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
