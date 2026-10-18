import { expect, test } from '@playwright/test';
import { demoFixture } from './demo-fixture';

for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`operation titles retain typography and themed outcome accents (${reducedMotion})`, async ({ page }) => {
  const demo = await demoFixture(page);
  try {
    await page.emulateMedia({ reducedMotion });
    const actual = await page.evaluate(async () => {
      // Exercise the shared renderer against the offline app's actual theme/CSS.
      const modulePath = '/src/operation-card.ts';
      const { renderOperationCard } = await import(modulePath);
      const node = document.createElement('article'); node.className = 'message user';
      const content = document.createElement('div'); content.textContent = 'Fixture content'; node.append(content); document.body.append(node);
      const reference = document.createElement('span'); node.append(reference);
      const token = (name: string) => { reference.style.color = `var(${name})`; return getComputedStyle(reference).color; };
      const red = token('--vscode-errorForeground'), grey = token('--vscode-descriptionForeground');
      const rows = [];
      let retained: Element | null = null;
      for (const title of ['Configuration change', 'Steering', 'Queued']) for (const state of ['pending', 'succeeded', 'failed', 'unknown', 'not-applied']) {
        renderOperationCard(node, { title, state, details: state === 'failed' || state === 'unknown' ? 'Full error details' : undefined }, () => {});
        const label = node.querySelector('.delivery-status-text')!;
        const css = getComputedStyle(label), article = getComputedStyle(node);
        rows.push({ title, state, sameNode: !retained || retained === label, transform: css.textTransform, spacing: parseFloat(css.letterSpacing) / parseFloat(css.fontSize),
          size: parseFloat(css.fontSize) / parseFloat(article.fontSize), weight: css.fontWeight, font: css.fontFamily, bodyFont: article.fontFamily,
          animation: css.animationName, accent: article.borderLeftColor, details: node.querySelector('summary')?.textContent });
        retained = label;
      }
      node.remove();
      return { rows, red, grey };
    });
    for (const row of actual.rows) {
      expect(row.sameNode).toBe(true);
      expect(row.transform).toBe('uppercase'); expect(row.spacing).toBeCloseTo(0.05, 2);
      expect(row.size).toBeCloseTo(0.78, 2); expect(row.weight).toBe('400'); expect(row.font).toBe(row.bodyFont);
      expect(row.animation).toBe(row.state === 'pending' && reducedMotion === 'no-preference' ? 'delivery-status-shimmer' : 'none');
      if (row.state === 'failed') { expect(row.accent).toBe(actual.red); expect(row.details).toBe('Error details'); }
      if (row.state === 'unknown' || row.state === 'not-applied') expect(row.accent).toBe(actual.grey);
      if (row.state === 'unknown') expect(row.details).toBe('Details');
    }
    expect(demo.errors).toEqual([]);
  } finally { await demo.close(); }
});
