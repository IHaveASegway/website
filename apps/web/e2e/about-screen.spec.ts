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

// A skill's name lists what it holds, and left to itself a line break strands the last of them:
// "Message brokers: RabbitMQ, LavinMQ, / SQS", from 768 px up and on an iPhone 14. Each name that
// takes two lines keeps two words or more on its last.
const strandedNames = (page: import('@playwright/test').Page) =>
  page.locator('.skills dt').evaluateAll((names) =>
    names.flatMap((name) => {
      const text = name.firstChild as Text;
      const rows = new Map<number, string[]>();
      for (const word of (text.data ?? '').matchAll(/\S+/g)) {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        const top = Math.round(range.getBoundingClientRect().top);
        rows.set(top, [...(rows.get(top) ?? []), word[0]]);
      }
      const lines = [...rows.values()];
      return lines.length > 1 && lines.at(-1)?.length === 1 ? [text.data] : [];
    }),
  );

for (const width of [320, 360, 390, 768, 1024, 1440, 2560]) {
  test(`at ${width} px no skill's name leaves a word alone on its last line`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about/');
    await page.evaluate(() => document.fonts.ready);
    expect(await strandedNames(page)).toEqual([]);
  });
}

// The known answer: the same reading on a name set in a column too narrow for it, left to wrap as it
// likes, finds the word it strands.
test('known answer: a name left to wrap by itself strands its last word, and this finds it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.goto('/about/');
  const stranded = await page
    .locator('.skills dt')
    .first()
    .evaluate((name) => {
      name.textContent = 'Message brokers: RabbitMQ, LavinMQ, SQS';
      (name as HTMLElement).style.setProperty('text-wrap', 'wrap');
      const words = name.textContent.split(' ').slice(0, -1).join(' ');
      const measure = document.createRange();
      (name.firstChild as Text).data = words;
      measure.selectNodeContents(name);
      const wide = measure.getBoundingClientRect().width;
      (name.firstChild as Text).data = 'Message brokers: RabbitMQ, LavinMQ, SQS';
      // Just wide enough for all but the last word.
      (name as HTMLElement).style.setProperty('inline-size', `${Math.ceil(wide) + 2}px`);
      return true;
    });
  expect(stranded).toBe(true);
  expect(await strandedNames(page)).toEqual(['Message brokers: RabbitMQ, LavinMQ, SQS']);
});
