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

// The bio as named blocks (ADR 0027, after syntaqx's Currently and Previously): each block's name,
// and each section's name on the page, is a label in the wide face at the label's size, in the
// accent, sentence case, the way Home names its bio blocks; each item's lead takes a card title's
// size and face, one step of the scale. Until 2026-10-31 the bio's headings were display titles.
// The fixture builds hold no bio, so there the leads are not read.
test("the page's sections are named by wide labels in the accent, and the bio's leads by a card title's type", async ({
  page,
}) => {
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about/');
    const type = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.cssText =
        'color: var(--primary); font-family: var(--font-wide); font-size: var(--text-label)';
      document.body.append(probe);
      const want = getComputedStyle(probe);
      const accent = { color: want.color, family: want.fontFamily, size: want.fontSize };
      probe.remove();
      const of = (e: Element) => {
        const s = getComputedStyle(e);
        return `${s.fontSize} ${s.fontFamily} ${s.fontWeight} ${s.lineHeight}`;
      };
      const card = document.querySelector('.card-title');
      return {
        accent,
        labels: [...document.querySelectorAll('.resume h2')].map((h) => {
          const s = getComputedStyle(h);
          return {
            text: h.textContent?.trim(),
            color: s.color,
            family: s.fontFamily,
            size: s.fontSize,
            case: s.textTransform,
          };
        }),
        leads: [...document.querySelectorAll('.bio-item-lead')].map(of),
        headline: card ? of(card) : null,
      };
    });
    expect(type.labels.length).toBeGreaterThan(0);
    for (const label of type.labels) {
      expect(label, String(width)).toEqual({
        text: label.text,
        color: type.accent.color,
        family: type.accent.family,
        size: type.accent.size,
        case: 'none',
      });
    }
    expect(type.headline).not.toBeNull();
    for (const lead of type.leads) expect(lead, String(width)).toBe(type.headline);
  }
});

// After brittanychiang's (ADR 0027): from 64rem two columns, the head on the left, held in view as
// the page scrolls, and the body on the right; below it, one column, the head over the body. Every
// link of the way round the page leads to a section the page holds, and the page never scrolls
// sideways.
test('/about/ is two columns from 64rem, the head held in view, and one column on a phone', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about/');
  const wide = await page.evaluate(() => {
    const head = document.querySelector('.about-head')?.getBoundingClientRect();
    const body = document.querySelector('.about-body')?.getBoundingClientRect();
    return { headRight: head?.right ?? 0, bodyLeft: body?.left ?? 0, headTop: head?.top ?? 0 };
  });
  expect(wide.headRight).toBeLessThanOrEqual(wide.bodyLeft);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight / 2));
  const held = await page.locator('.about-name').boundingBox();
  expect(held?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(held?.y ?? 1e6).toBeLessThan(900);
  const targets = await page
    .locator('.about-toc a')
    .evaluateAll((links) =>
      links.map((a) => document.getElementById((a.getAttribute('href') ?? '').slice(1)) !== null),
    );
  expect(targets.length).toBeGreaterThan(2);
  expect(targets.every(Boolean)).toBe(true);

  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/about/');
    const narrow = await page.evaluate(() => ({
      head: document.querySelector('.about-head')?.getBoundingClientRect().bottom ?? 0,
      body: document.querySelector('.about-body')?.getBoundingClientRect().top ?? 0,
      sideways: document.documentElement.scrollWidth - window.innerWidth,
      toc: getComputedStyle(document.querySelector('.about-toc') as Element).display,
    }));
    expect(narrow.head, String(width)).toBeLessThanOrEqual(narrow.body);
    expect(narrow.sideways, String(width)).toBeLessThanOrEqual(0);
    expect(narrow.toc).toBe('none');
  }
});
