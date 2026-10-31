import { expect, test } from '@playwright/test';

// /about/ on screen (2026-10-31 visitor review): Selected work's lab cards are their labs' lines,
// as the board's bands and /lab/'s rows are (ADR 0025).

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
