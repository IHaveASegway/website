import { expect, test } from '@playwright/test';
import { openingRun as backfillOpening } from '../src/lib/backfill/view';
import { replay as replayCache } from '../src/lib/cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from '../src/lib/cache/view';
import { backfillFact, cacheFact, queueFact, raftFailover, raftLine } from '../src/lib/lines';
import { replay as replayQueue } from '../src/lib/queue/sim';
import { OPENING as QUEUE } from '../src/lib/queue/view';
import { replay as replayRaft } from '../src/lib/raft/sim';
import { OPENING as RAFT, openingRun as raftOpening } from '../src/lib/raft/view';
import { pages } from './expected';

// What Home's lab cards say beside what they draw (the visitor review of 2026-10-31; ADR 0027):
// each card's fact is worked out from its lab's own runs, the same sentence the lab's page and the
// Lab index work out; the Route Lab's card names what its figure is measured against and says that
// the bakery is made up; and each card's glyph stands inside its card. Until ADR 0027
// Home's board said each lab's failure and fix beside its line, and the hero the Route Lab's
// figures, and these checks held them.

const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

const hasLabs = () => pages().some((path) => /^\/lab\/[^/]+\/$/.test(path));

test("each lab card on Home says one fact from its lab's own runs", async ({ page }) => {
  test.skip(!hasLabs(), 'this build has no demo');
  await page.goto('/');
  const leader = raftLine(raftOpening()).leader ?? 0;
  const expected: Record<string, string> = {
    backfill: backfillFact(backfillOpening(), backfillOpening('overwrite')),
    cache: cacheFact(
      cacheOpening(),
      replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until),
    ),
    queue: queueFact(replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until)),
    raft: raftFailover(
      raftOpening(),
      replayRaft(
        { seed: RAFT.seed },
        [...RAFT.actions, { at: RAFT.until, kind: 'crash', node: leader - 1 }],
        RAFT.until,
      ),
    ),
  };
  for (const [slug, words] of Object.entries(expected)) {
    const card = page.locator(`.lab-card[data-line="${slug}"]`);
    if ((await card.count()) === 0) continue;
    await expect(card.locator('.lab-card-fact'), slug).toHaveText(words);
  }
});

// The Route Lab's figures are a made-up bakery's: where Home shows them, it says so, and names what
// VROOM's figure is measured against, in the words the Route Lab uses ("as the orders came in").
// Until 2026-10-31 nothing on Home said the bakery was made up; until ADR 0027 the hero said it.
for (const size of SIZES)
  test(`at ${size.width} px the Route Lab's card names its figure's baseline and says the bakery is made up`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    const fact = page.locator('.lab-card[data-line="routes"] .lab-card-fact');
    test.skip((await fact.count()) === 0, 'this build has no Route Lab');
    await expect(fact).toBeVisible();
    await expect(fact).toHaveText(
      /^\d+\sh \d+\smin of driving for a made-up bakery on a .+, planned by VROOM in your browser, against \d+\sh \d+\smin as the orders came in\.$/,
    );
    await expect(page.getByText('for a made-up bakery')).toHaveCount(1);
  });

// Each glyph on Home's cards ends inside its card, short of the card's edge: the successor to the
// Raft line's buffer stop, which held a lab's drawing back from the edge of the panel it stood in
// (until 2026-10-31 its track ran on into the panel's edge). ADR 0027 took the lines off Home's board
// and off the Lab index, so the check now holds the glyphs that replaced them; the Lab index's own
// cards are held to the same in e2e/index.spec.ts.
for (const size of SIZES)
  test(`at ${size.width} px each glyph on Home's lab cards stands inside its card, short of the edge`, async ({
    page,
  }) => {
    test.skip(!hasLabs(), 'this build has no demo');
    await page.setViewportSize(size);
    await page.goto('/');
    const cards = await page.locator('#work .lab-card').all();
    expect(cards.length).toBeGreaterThan(0);
    for (const card of cards) {
      const slug = (await card.getAttribute('data-line')) ?? '';
      const { box, inner, glyph } = await card.evaluate((element) => {
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        const svg = element.querySelector('svg.iso-glyph')?.getBoundingClientRect();
        return {
          box: box.toJSON() as DOMRect,
          inner: {
            left: box.left + parseFloat(style.borderLeftWidth) + parseFloat(style.paddingLeft),
            right: box.right - parseFloat(style.borderRightWidth) - parseFloat(style.paddingRight),
          },
          glyph: svg?.toJSON() as DOMRect | undefined,
        };
      });
      if (!glyph) throw new Error(`${slug}: the card draws no glyph`);
      expect(glyph.width, `${slug}: a glyph is drawn`).toBeGreaterThan(0);
      expect(glyph.left, `${slug}: inside the card's left padding`).toBeGreaterThanOrEqual(
        inner.left - 0.5,
      );
      expect(glyph.right, `${slug}: short of the card's right edge`).toBeLessThanOrEqual(
        inner.right + 0.5,
      );
      expect(glyph.top, slug).toBeGreaterThanOrEqual(box.top);
      expect(glyph.bottom, slug).toBeLessThanOrEqual(box.bottom);
    }
  });
