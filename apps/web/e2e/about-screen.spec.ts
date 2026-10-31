import { expect, test } from '@playwright/test';

// /about/ on screen (2026-10-31 visitor review): Selected work's lab cards name their labs' lines,
// so whatever a card draws of its lab draws in the lab's colour (ADR 0025), while the card's own
// edge stays the page's (ADR 0027: a lab's colour lives inside its drawings, never the chrome); and
// the bio's headings take a step of the scale, not a size and face of their own.

/** Each lab card's link, its line, its edge's colour, and the colour its lab's line resolves to. */
const labCards = (page: import('@playwright/test').Page) =>
  page.locator('.resume .card').evaluateAll((cards) =>
    cards
      .filter((card) => card.querySelector('.card-more')?.getAttribute('href')?.startsWith('/lab/'))
      .map((card) => {
        const href = card.querySelector('.card-more')?.getAttribute('href') ?? '';
        const slug = href.split('/')[2] ?? '';
        const style = getComputedStyle(card);
        return {
          href,
          line: card.getAttribute('data-line'),
          edge: style.borderTopColor,
          // The lab's own line, as tokens.css names it and the page's --line resolves it.
          own: style.getPropertyValue(`--line-${slug}`).trim(),
          resolved: style.getPropertyValue('--line').trim(),
        };
      }),
  );

test("each lab card on /about/ resolves its own lab's line, and its edge is the page's", async ({
  page,
}) => {
  await page.goto('/about/');
  const cards = await labCards(page);
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(card.line, card.href).toBe(card.href.split('/')[2]);
    expect(card.resolved, card.href).toBe(card.own);
  }
  // Two labs, two colours, each its own: none fell back to another's or to nothing.
  expect(new Set(cards.map((card) => card.resolved)).size).toBe(cards.length);
  // The chrome carries no lab's colour: every card's edge is the same hairline.
  expect(new Set(cards.map((card) => card.edge)).size).toBe(1);
});

// The known answer: a card stripped of its line resolves no lab's colour, so the check above would
// see every card the same.
test('known answer: lab cards without their line resolve no colour', async ({ page }) => {
  await page.goto('/about/');
  await page
    .locator('.resume .card[data-line]')
    .evaluateAll((cards) => cards.forEach((card) => card.removeAttribute('data-line')));
  const cards = await labCards(page);
  expect(cards.length).toBeGreaterThan(1);
  expect(new Set(cards.map((card) => card.resolved))).toEqual(new Set(['']));
});

// The bio's h3s (What I build, How I work) are its sections under "About me": the headline, the
// step a card's title takes on the same page. Until 2026-10-31 they were the lead's size in the
// display face, a ninth size and face. The fixture builds hold no bio, so there is nothing to read.
test("the bio's headings take the headline's size and face, a card title's", async ({ page }) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about/');
    const type = await page.evaluate(() => {
      const of = (e: Element) => {
        const s = getComputedStyle(e);
        return `${s.fontSize} ${s.fontFamily} ${s.fontWeight} ${s.lineHeight}`;
      };
      const card = document.querySelector('.card-title');
      return {
        headings: [...document.querySelectorAll('.bio .prose h3')].map(of),
        headline: card ? of(card) : null,
      };
    });
    test.skip(type.headings.length === 0, 'this build has no bio');
    expect(type.headline).not.toBeNull();
    for (const heading of type.headings) expect(heading, String(width)).toBe(type.headline);
  }
});
