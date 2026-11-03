import { expect, test } from '@playwright/test';

// /about/ on screen (2026-10-31 visitor review; ADR 0031): Selected work's lab cards, which print,
// name their labs' lines, so whatever a card draws of its lab draws in the lab's colour (ADR 0025),
// while the card's own edge stays the page's (ADR 0027: a lab's colour lives inside its drawings, never
// the chrome); and the bio's headings take a step of the scale, not a size and face of their own.

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

// One column on every screen (ADR 0029): the head over the body, centred from a laptop up, and the
// page never scrolls sideways.
test('/about/ is one column on every screen, the head over the body', async ({ page }) => {
  for (const [width, height] of [
    [1440, 900],
    [390, 844],
    [320, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.goto('/about/');
    const at = await page.evaluate(() => {
      const head = document.querySelector('.about-head')?.getBoundingClientRect();
      const body = document.querySelector('.about-body')?.getBoundingClientRect();
      return {
        headBottom: head?.bottom ?? 0,
        bodyTop: body?.top ?? 0,
        headLeft: head?.left ?? 0,
        bodyLeft: body?.left ?? 0,
        sideways: document.documentElement.scrollWidth - window.innerWidth,
      };
    });
    expect(at.headBottom, String(width)).toBeLessThanOrEqual(at.bodyTop);
    expect(Math.abs(at.headLeft - at.bodyLeft), String(width)).toBeLessThanOrEqual(1);
    expect(at.sideways, String(width)).toBeLessThanOrEqual(0);
  }
});

// The labs' rows (ADR 0031): each row is its lab's link from edge to edge, by a press anywhere on it;
// its line stands over its words, in its lab's colour, across the column, in either theme.
test('each lab row is a link across the column, under its own line in its own colour', async ({
  page,
}) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about/');
    const rows = await page.locator('.bio-row[data-line]').evaluateAll((all) =>
      all.map((row) => {
        const box = row.getBoundingClientRect();
        const line = row.querySelector('.lab-line') as SVGElement;
        const lead = row.querySelector('.bio-item-lead') as Element;
        const link = lead.querySelector('a') as HTMLAnchorElement;
        const cover = getComputedStyle(link, '::before');
        const stroke = line.querySelector('line');
        return {
          slug: row.getAttribute('data-line'),
          href: link.getAttribute('href'),
          covers: cover.position === 'absolute' && cover.top === '0px' && cover.left === '0px',
          across: Math.abs(line.getBoundingClientRect().width - box.width) <= 1,
          over: line.getBoundingClientRect().bottom <= lead.getBoundingClientRect().top,
          drawn: stroke ? getComputedStyle(stroke).stroke : '',
          own: getComputedStyle(line).getPropertyValue(`--line-${row.getAttribute('data-line')}`),
        };
      }),
    );
    expect(rows.map((row) => row.slug)).toEqual(['cache', 'queue', 'backfill', 'routes', 'raft']);
    for (const row of rows) {
      expect(row.href, String(width)).toBe(`/lab/${row.slug}/`);
      expect(row.covers, String(width)).toBe(true);
      expect(row.across, String(width)).toBe(true);
      expect(row.over, String(width)).toBe(true);
    }
    // Five labs, five colours: none fell back to another's or to nothing.
    expect(new Set(rows.map((row) => row.drawn)).size).toBe(rows.length);
    expect(await page.locator('.resume-contact').isVisible()).toBe(false);
  }
});

// The page never goes flat below its first screen (ADR 0030, ADR 0031): the field stands behind every
// block, nothing paints a ground over it, and each section opens on a line that lights once reached.
test('below the first screen the field carries on behind the column, and each section opens on a line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  const painted = await page.evaluate(() =>
    [...document.querySelectorAll('.about-body, .about-body *')]
      .filter((e) => e.checkVisibility() && !e.closest('svg'))
      .filter((e) => {
        const ground = getComputedStyle(e).backgroundColor;
        return ground !== 'rgba(0, 0, 0, 0)' && ground !== 'transparent';
      })
      .map((e) => e.getAttribute('class')),
  );
  expect(painted).toEqual([]);
  await expect(page.locator('.field')).toBeAttached();
  const sections = page.locator('.about-body .section:visible');
  expect(await sections.count()).toBeGreaterThan(5);
  const last = sections.last();
  await last.scrollIntoViewIfNeeded();
  await expect(last).toHaveAttribute('data-lit', '');
});
