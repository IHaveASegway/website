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
// the bakery is made up; and the Raft line on the Lab index ends in a buffer stop. Until ADR 0027
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

// The Raft line's log ends in a buffer stop a step past its last entry, short of the words on the
// Lab index, as every other line ends at a station of its own. Until 2026-10-31 its track ran on to
// the drawing's right edge; until ADR 0027 Home's board drew the same line, held to the same.
for (const size of SIZES)
  for (const path of ['/lab/'])
    test(`at ${size.width} px the Raft line on ${path} ends in a buffer stop, short of the edge`, async ({
      page,
    }) => {
      test.skip(!pages().includes('/lab/raft/'), 'this build has no Raft lab');
      await page.setViewportSize(size);
      await page.goto(path);
      const row = page.locator('main .lab-row[data-line="raft"]');
      const drawing = row.locator('svg.line-draw').filter({ visible: true });
      await expect(drawing).toHaveCount(1);
      const { svg, track, stop, lamps } = await drawing.evaluate((element) => {
        const box = (el: Element | null | undefined) => el?.getBoundingClientRect().toJSON();
        return {
          svg: box(element),
          track: box(element.querySelector('.line-track')),
          stop: box(element.querySelector('rect.line-depot')),
          lamps: [...element.querySelectorAll('.line-lamp')].map(
            (lamp) => lamp.getBoundingClientRect().right,
          ),
        };
      });
      if (!svg || !track || !stop) throw new Error('the Raft line has no track or no buffer stop');
      // The track runs into the stop and no further, and the stop stands past the last entry.
      expect(track.right).toBeLessThanOrEqual(stop.left + 1);
      expect(stop.left).toBeGreaterThan(Math.max(...lamps));
      // Well inside the drawing: at least a fifth of its width is left after the stop.
      expect(svg.right - stop.right).toBeGreaterThan(svg.width / 5);
    });
