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

// What Home says of each lab beside what it builds (the visitor review of 2026-10-31; ADR 0028):
// each lab's fact under What I build is worked out from its lab's own runs, the same sentence the
// lab's page and the Lab index work out, and where Home shows the Route Lab's figures it names what
// they are measured against and says the bakery is made up. Until ADR 0028 the facts stood on
// Home's lab cards, each with its glyph inside the card; until ADR 0027 Home's board said each
// lab's failure and fix beside its line, and the hero the Route Lab's figures.

const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

const hasLabs = () => pages().some((path) => /^\/lab\/[^/]+\/$/.test(path));

test("each lab What I build names says one fact from its lab's own runs", async ({ page }) => {
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
    const row = page.locator(`#build .build[data-line="${slug}"]`);
    if ((await row.count()) === 0) continue;
    await expect(row.locator('.build-fact'), slug).toHaveText(words);
  }
});

// The Route Lab's figures are a made-up bakery's: where Home shows them, it says so, and names what
// VROOM's figure is measured against, in the words the Route Lab uses ("as the orders came in").
// Until 2026-10-31 nothing on Home said the bakery was made up; until ADR 0027 the hero said it.
for (const size of SIZES)
  test(`at ${size.width} px the Route Lab's figures, where Home shows them, name their baseline and say the bakery is made up`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    const fact = page.locator('#build .build[data-line="routes"] .build-fact');
    test.skip((await fact.count()) === 0, 'Home shows no figure of the Route Lab');
    await expect(fact).toBeVisible();
    await expect(fact).toHaveText(
      /^\d+\sh \d+\smin of driving for a made-up bakery on a .+, planned by VROOM in your browser, against \d+\sh \d+\smin as the orders came in\.$/,
    );
    await expect(page.getByText('for a made-up bakery')).toHaveCount(1);
  });
