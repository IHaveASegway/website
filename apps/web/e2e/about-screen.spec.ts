import { expect, test } from '@playwright/test';

// /about/ on screen (2026-10-31 visitor review): Selected work's lab cards are their labs' lines,
// as the board's bands and /lab/'s rows are (ADR 0025), and the bio's headings take a step of the
// eight-size scale (design-system.md, "Type scale"), not a size and face of their own.

/** Each lab card's link, its line, and the colours its sweep and its lab's line resolve to. */
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
          sweep: getComputedStyle(card, '::before').backgroundColor,
          // The lab's own line, as tokens.css names it and the page's --line resolves it.
          own: style.getPropertyValue(`--line-${slug}`).trim(),
          resolved: style.getPropertyValue('--line').trim(),
        };
      }),
  );

test("each lab card on /about/ sweeps in its lab's line, not the lamp's colour", async ({
  page,
}) => {
  await page.goto('/about/');
  const cards = await labCards(page);
  expect(cards.length).toBeGreaterThan(0);
  for (const card of cards) {
    expect(card.line, card.href).toBe(card.href.split('/')[2]);
    expect(card.resolved, card.href).toBe(card.own);
  }
  // Two labs, two colours: the sweeps differ, so none fell back to the one lamp colour.
  expect(new Set(cards.map((card) => card.sweep)).size).toBe(cards.length);
});

// The known answer: a card stripped of its line sweeps in the lamp's colour, the review's finding,
// and the check above would see every card the same.
test('known answer: lab cards without their line all sweep in one colour', async ({ page }) => {
  await page.goto('/about/');
  await page
    .locator('.resume .card[data-line]')
    .evaluateAll((cards) => cards.forEach((card) => card.removeAttribute('data-line')));
  const cards = await labCards(page);
  expect(cards.length).toBeGreaterThan(1);
  expect(new Set(cards.map((card) => card.sweep)).size).toBe(1);
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
