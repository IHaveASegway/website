import { expect, test } from '@playwright/test';
import { replay as replayCache } from '../src/lib/cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from '../src/lib/cache/view';
import { openingRun as backfillOpening } from '../src/lib/backfill/view';
import { backfillFact, cacheFact, cacheLine, queueFact, queueLine } from '../src/lib/lines';
import { replay as replayQueue } from '../src/lib/queue/sim';
import { OPENING as QUEUE, openingRun as queueOpening } from '../src/lib/queue/view';
import { pages } from './expected';

// The site as an index (ADR 0022): a row of an index opens its page wherever it is pressed, the
// top bar marks the section on screen, and no page scrolls on past its own end.

const LISTS = ['/', '/lab/', '/writing/', '/notes/'];

for (const path of LISTS) {
  test(`${path}: a press on a row's empty space opens the page its link names`, async ({
    page,
  }) => {
    test.skip(!pages().includes(path), `this build has no ${path}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    // The first row that opens a page on this site: a project's card opens its repository.
    // A lab's card is its title's link (components/lab/LabCard.astro).
    const rows = page.locator(
      'main :is(.card:has(:is(.card-more, .card-title > a)[href^="/"]), .post-list > li:has(.post-title > a[href^="/"]))',
    );
    test.skip((await rows.count()) === 0, `${path} lists no row`);
    const row = rows.first();
    const href = await row
      .locator(':is(.card-more, .card-title > a, .post-title > a)')
      .first()
      .getAttribute('href');
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    if (!box) throw new Error(`${path}: the row is not drawn`);
    // The row's foot, at its start: its padding, under none of its words, where only the link's
    // stretched box can answer a press.
    const at = { x: box.x + 4, y: box.y + box.height - 4 };
    expect(
      await page.evaluate(
        ({ x, y }) => document.elementFromPoint(x, y)?.closest('a')?.getAttribute('href') ?? null,
        at,
      ),
    ).toBe(href);
    await page.mouse.click(at.x, at.y);
    await page.waitForURL(`**${href}`);
  });
}

// The rail's drop-downs (ADR 0023) gave way to the top bar, whose items are one link each
// (e2e/top-bar.spec.ts, ADR 0027): a demo is found on /lab/ and in Search.

// The page's drawing is 900 px tall; on a page shorter than that it reached past the body, and the
// window scrolled on into nothing, beyond the rail and the footer (2026-10-29, /lab/ at 1512 × 737).
for (const { width, height } of [
  { width: 1512, height: 737 },
  { width: 390, height: 844 },
]) {
  test(`at ${width} × ${height} no page scrolls past its own end`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    for (const path of pages()) {
      await page.goto(path);
      const { document: whole, body } = await page.evaluate(() => ({
        document: document.documentElement.scrollHeight,
        body: Math.ceil(document.body.getBoundingClientRect().height),
      }));
      expect(whole, path).toBeLessThanOrEqual(body);
    }
  });
}

// The Lab index (docs/design/overhaul.md, "/lab/"; ADR 0027): a card per live lab, in the lab's
// order, its glyph across its top, then its title, its summary and one fact from its build. One a
// row on a phone, two a row from 64rem, where an odd card out at the end takes the whole row with
// its glyph beside its words. Nothing scrolls sideways. Until ADR 0027 each lab was a row of its
// line, drawn large, coming in from the page's edge.
for (const { width, height, two } of [
  { width: 1440, height: 900, two: true },
  { width: 390, height: 844, two: false },
]) {
  test(`at ${width} px the Lab index is a card per lab, its glyph over its words, ${two ? 'two' : 'one'} a row`, async ({
    page,
  }) => {
    test.skip(!pages().includes('/lab/'), 'this build has no lab');
    await page.setViewportSize({ width, height });
    await page.goto('/lab/');
    await page.evaluate(() => document.fonts.ready);
    const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
    const cards = await page.locator('main .lab-cards > .lab-card').all();
    expect(cards).toHaveLength(demos.length);
    const boxes = [];
    for (const card of cards) {
      const slug = (await card.getAttribute('data-line')) ?? '';
      const box = await card.boundingBox();
      const glyph = await card.locator('svg.iso-glyph').boundingBox();
      const title = await card.locator('.card-title').boundingBox();
      if (!box || !glyph || !title) throw new Error(`${slug}: the card is not drawn`);
      boxes.push(box);
      // Its glyph inside the card, a picture assistive technology skips.
      expect(glyph.x, slug).toBeGreaterThanOrEqual(box.x);
      expect(glyph.x + glyph.width, slug).toBeLessThanOrEqual(box.x + box.width + 1);
      await expect(card.locator('svg.iso-glyph'), slug).toHaveAttribute('aria-hidden', 'true');
      const last = cards.length % 2 === 1 && card === cards.at(-1);
      if (two && last)
        expect(title.x, `${slug}: words beside`).toBeGreaterThan(glyph.x + glyph.width);
      else expect(title.y, `${slug}: words under`).toBeGreaterThan(glyph.y + glyph.height);
      // The title is the card's one link, to the lab's page.
      await expect(card.locator('a'), slug).toHaveCount(1);
      await expect(card.locator('.card-title > a'), slug).toHaveAttribute('href', `/lab/${slug}/`);
      await expect(card.locator('.lab-fact'), `${slug}: its fact`).toHaveText(/\S.*\.$/);
    }
    // The first two cards share a row from 64rem; on a phone each has its own.
    const [first, second] = boxes;
    if (first && second) {
      if (two) expect(Math.round(second.y)).toBe(Math.round(first.y));
      else expect(second.y).toBeGreaterThan(first.y + first.height);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

// Each card's fact is the sentence its lab's own model writes from the run its page opens on,
// with the change its write-up tells the visitor to make first (lib/lines.ts), and its glyph is
// that opening: the Queue Lab's downed worker is a dashed solid with its wire cut, the Backfill
// Lab's day counted twice is a dashed block over its partition. So the card and the simulation
// cannot disagree. Every glyph draws its wires in its own lab's colour, and no card's edge or
// words take it.
test('the Lab index draws each glyph from its lab’s opening, and each fact from the same run', async ({
  page,
}) => {
  test.skip(!pages().includes('/lab/'), 'this build has no lab');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lab/');
  const card = (slug: string) => page.locator(`main .lab-card[data-line="${slug}"]`);

  if ((await card('queue').count()) > 0) {
    const keyed = replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until);
    await expect(card('queue').locator('.lab-fact')).toHaveText(queueFact(keyed));
    const line = queueLine(queueOpening());
    const down = line.workers.filter((w) => w.lamp === 'down').length;
    await expect(card('queue').locator('.iso-off')).toHaveCount(down);
    await expect(card('queue').locator('.iso-cut')).toHaveCount(down);
    await expect(card('queue').locator('.iso-lit')).toHaveCount(Math.min(8, line.waiting));
  }

  if ((await card('cache').count()) > 0) {
    const opening = cacheOpening();
    const coalesced = replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until);
    await expect(card('cache').locator('.lab-fact')).toHaveText(cacheFact(opening, coalesced));
    await expect(card('cache').locator('.iso-off')).toHaveCount(
      cacheLine(opening).nodes.filter((lamp) => lamp === 'down').length,
    );
  }

  if ((await card('backfill').count()) > 0) {
    const opening = backfillOpening();
    await expect(card('backfill').locator('.lab-fact')).toHaveText(
      backfillFact(opening, backfillOpening('overwrite')),
    );
    await expect(card('backfill').locator('.iso-ghost')).toHaveCount(
      opening.source.filter((n, k) => (opening.report[k] ?? 0) > n).length,
    );
  }

  // A colour per lab: each glyph's wires in its own line's token, which the card resolves from
  // its slug; the card's edge and its title in the page's colours.
  const seen = await page.locator('main .lab-card').evaluateAll((cards) =>
    cards.map((card) => {
      const slug = card.getAttribute('data-line') ?? '';
      const probe = document.createElement('span');
      probe.style.setProperty('color', `var(--line-${slug})`);
      card.append(probe);
      const token = getComputedStyle(probe).color;
      probe.remove();
      const wire = card.querySelector('.iso-wire');
      return {
        slug,
        token,
        wire: wire ? getComputedStyle(wire).stroke : null,
        edge: getComputedStyle(card).borderTopColor,
        title: getComputedStyle(card.querySelector('.card-title') as Element).color,
      };
    }),
  );
  for (const { slug, token, wire, edge, title } of seen) {
    expect(wire, slug).toBe(token);
    expect(edge, slug).not.toBe(token);
    expect(title, slug).not.toBe(token);
  }
  expect(new Set(seen.map((s) => s.wire)).size).toBe(seen.length);
});

// Home draws a card for every live lab (ADR 0027; until then a band of the board, ADR 0025), one
// glyph each, cut from the drawing and drawn in the lab's own colour, so no two cards' glyphs share
// a colour, and never wider than the page.
for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`at ${width} px Home draws a card for every lab, each glyph in its own lab's colour`, async ({
    page,
  }) => {
    const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
    test.skip(demos.length === 0, 'this build has no demo');
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const cards = page.locator('#work .lab-card');
    expect(
      (await cards.evaluateAll((all) => all.map((card) => card.getAttribute('data-line')))).sort(),
    ).toEqual(demos.map((path) => path.split('/')[2]).sort());
    for (const card of await cards.all())
      await expect(card.locator('svg.iso-glyph').filter({ visible: true })).toHaveCount(1);
    const colours = await cards.evaluateAll((all) =>
      all.map((card) => {
        const edge = card.querySelector('.iso-glyph path');
        return {
          glyph: edge ? getComputedStyle(edge).stroke : '',
          card: getComputedStyle(card).borderTopColor,
        };
      }),
    );
    expect(new Set(colours.map((c) => c.glyph)).size).toBe(colours.length);
    // The card's own edge is the page's hairline, never the lab's colour.
    expect(new Set(colours.map((c) => c.card)).size).toBe(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

// A lab's page heads its title with its glyph (docs/design/overhaul.md, "A lab's page chrome";
// ADR 0027): from 48rem the drawing its card on /lab/ carries stands beside the title and the
// lead, in the lab's own colour, a picture assistive technology skips; on a phone it is left out,
// so the demo comes up the first screen. The page's head says nothing above the title, and the
// lab's colour is in the glyph alone. Until ADR 0027 a lab's line ran across the top in its colour.
for (const { width, height, glyph } of [
  { width: 1440, height: 900, glyph: true },
  { width: 390, height: 844, glyph: false },
]) {
  test(`at ${width} px each lab's page ${glyph ? 'heads its title with its glyph, in its own colour' : 'leaves its glyph out of its head'}`, async ({
    page,
  }) => {
    const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
    test.skip(demos.length === 0, 'this build has no demo');
    await page.setViewportSize({ width, height });
    const seen = new Set<string>();
    for (const demo of demos) {
      await page.goto(demo);
      const slug = demo.split('/')[2] ?? '';
      const icon = page.locator('.lab-head > svg.iso-glyph');
      await expect(icon, demo).toHaveCount(1);
      await expect(icon, demo).toHaveAttribute('data-line', slug);
      await expect(icon, demo).toHaveAttribute('aria-hidden', 'true');
      if (!glyph) {
        await expect(icon, demo).toBeHidden();
        continue;
      }
      await expect(icon, demo).toBeVisible();
      const head = await page.locator('.lab-head').evaluate((element) => {
        const box = (el: Element | null) => el?.getBoundingClientRect().toJSON();
        const slug = element.querySelector('svg')?.getAttribute('data-line') ?? '';
        const probe = document.createElement('span');
        probe.style.setProperty('color', `var(--line-${slug})`);
        element.append(probe);
        const token = getComputedStyle(probe).color;
        probe.remove();
        const wire = element.querySelector('.iso-wire');
        return {
          title: box(element.querySelector('.page-title')),
          glyph: box(element.querySelector('svg')),
          first: element.firstElementChild?.className,
          wire: wire ? getComputedStyle(wire).stroke : '',
          token,
        };
      });
      expect(head.first, demo).toBe('page-title');
      expect(head.glyph?.left ?? 0, demo).toBeGreaterThan(head.title?.left ?? Infinity);
      expect(head.wire, demo).toBe(head.token);
      seen.add(head.wire);
    }
    // A colour per lab.
    if (glyph) expect(seen.size).toBe(demos.length);
    await page.goto('/lab/');
    await expect(page.locator('.page-head svg')).toHaveCount(0);
  });
}
