import { expect, test, type Locator, type Page } from '@playwright/test';
import { openingRun as backfillOpening } from '../src/lib/backfill/view';
import { replay as replayCache } from '../src/lib/cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from '../src/lib/cache/view';
import {
  backfillFix,
  backfillLine,
  cacheFix,
  cacheLine,
  queueFix,
  queueLine,
  raftFailover,
  raftLine,
} from '../src/lib/lines';
import { replay as replayQueue } from '../src/lib/queue/sim';
import { OPENING as QUEUE, openingRun as queueOpening } from '../src/lib/queue/view';
import { replay as replayRaft } from '../src/lib/raft/sim';
import { OPENING as RAFT, openingRun as raftOpening } from '../src/lib/raft/view';
import { pages } from './expected';

// What Home's board and its hero say beside what they draw (the visitor review of 2026-10-31):
// each band's words tell the failure its lab opens on and the fix the lab offers, from the lab's
// own runs; each mark on a line means one thing, and the words say the same as the mark; the Raft
// line ends in a buffer stop rather than at the panel's edge; and the hero names what its struck
// figure measures and says, once, that the bakery is made up.

const SIZES = [
  { width: 390, height: 844 },
  { width: 1440, height: 900 },
] as const;

const hasLabs = () => pages().some((path) => /^\/lab\/[^/]+\/$/.test(path));
const band = (page: Page, slug: string): Locator =>
  page.locator(`[data-board] .band[data-line="${slug}"]`);

test("each band of Home's board says its lab's failure and its fix, from the lab's own runs", async ({
  page,
}) => {
  test.skip(!hasLabs(), 'this build has no demo');
  await page.goto('/');
  const leader = raftLine(raftOpening()).leader ?? 0;
  const expected: Record<string, string> = {
    backfill: `${backfillLine(backfillOpening()).words} ${backfillFix(backfillOpening('overwrite'))}`,
    cache: `${cacheLine(cacheOpening()).words} ${cacheFix(
      cacheOpening(),
      replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until),
    )}`,
    queue: `${queueLine(queueOpening()).words} ${queueFix(
      replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until),
    )}`,
    raft: `${raftLine(raftOpening()).words} ${raftFailover(
      raftOpening(),
      replayRaft(
        { seed: RAFT.seed },
        [...RAFT.actions, { at: RAFT.until, kind: 'crash', node: leader - 1 }],
        RAFT.until,
      ),
    )}`,
  };
  for (const [slug, words] of Object.entries(expected)) {
    test.skip((await band(page, slug).count()) === 0, `this build has no ${slug} lab`);
    await expect(band(page, slug).locator('.band-words'), slug).toHaveText(words);
  }
  // The Routes band names the hero's two figures: the driving as the orders came in, then VROOM's.
  const before = (await page.locator('.figure-before').textContent())?.trim() ?? '';
  const after = (await page.locator('.figure-after').textContent())?.trim() ?? '';
  test.skip(before === '' || after === '', 'this build has no Route Lab figures');
  await expect(band(page, 'routes').locator('.band-words')).toContainText(
    `${before} of driving as the orders came in, ${after} planned by VROOM`,
  );
});

// design-system.md, "Lamps: one meaning per mark": a cross is failed and a hollow track is down,
// on the board as on the desks, and a band's words say each mark it draws, and no state it does not
// draw. So the words name a failed station for every cross, and say "down" exactly where a track
// is hollow; a cross for a downed worker, as the board drew until 2026-10-31, fails here.
for (const size of SIZES)
  test(`at ${size.width} px every mark on Home's board means one thing, and its words say it`, async ({
    page,
  }) => {
    test.skip(!hasLabs(), 'this build has no demo');
    await page.setViewportSize(size);
    await page.goto('/');
    const bands = await page.locator('[data-board] .band').all();
    expect(bands.length).toBeGreaterThan(0);
    const seen = { cross: 0, gap: 0 };
    for (const one of bands) {
      const slug = await one.getAttribute('data-line');
      const drawing = one.locator('svg.line-draw').filter({ visible: true });
      const crosses = await drawing.locator('.line-cross').count();
      const gaps = await drawing.locator('.line-gap').count();
      const words = (await one.locator('.band-words').textContent()) ?? '';
      expect(words.match(/\bfailed\b/g)?.length ?? 0, `${slug}: one "failed" per cross`).toBe(
        crosses,
      );
      expect(/\bdown\b/.test(words), `${slug}: "down" where a track is hollow`).toBe(gaps > 0);
      seen.cross += crosses;
      seen.gap += gaps;
    }
    // Known answers from the openings: the Backfill week's Wednesday failed its check, and the
    // Queue's worker 2 is down after its crash.
    if ((await band(page, 'backfill').count()) > 0) expect(seen.cross).toBeGreaterThan(0);
    if ((await band(page, 'queue').count()) > 0) expect(seen.gap).toBeGreaterThan(0);
  });

// The Raft line's log ends in a buffer stop a step past its last entry, well inside the panel on
// Home, as every other line ends at a station of its own. Until 2026-10-31 its track ran on to the
// drawing's right edge, into the panel's. The Lab index drew the same line until ADR 0027, and
// draws each lab's glyph now (e2e/index.spec.ts).
for (const size of SIZES)
  for (const path of ['/'])
    test(`at ${size.width} px the Raft line on ${path} ends in a buffer stop, short of the edge`, async ({
      page,
    }) => {
      test.skip(!pages().includes('/lab/raft/'), 'this build has no Raft lab');
      await page.setViewportSize(size);
      await page.goto(path);
      const row = page.locator('[data-board] .band[data-line="raft"]');
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

// The hero's struck figure is named beside it, in view, with the Route Lab's own name for that
// plan; until 2026-10-31 only a screen reader heard what it measured. And Home says once, plainly,
// that the bakery is made up. Neither is covered by the scene (content vs display).
for (const size of [...SIZES, { width: 1024, height: 768 }])
  test(`at ${size.width} px the hero names its struck figure's baseline and says the bakery is made up`, async ({
    page,
  }) => {
    await page.setViewportSize(size);
    await page.goto('/');
    const before = page.locator('.figure-before');
    test.skip((await before.count()) === 0, 'this build has no Route Lab figures');
    const baseline = page.locator('.figure-baseline');
    await expect(baseline).toHaveText('as the orders came in');
    await baseline.scrollIntoViewIfNeeded();
    await expect(baseline).toBeVisible();
    const [figure, name] = [await before.boundingBox(), await baseline.boundingBox()];
    if (!figure || !name) throw new Error('the figure or its baseline is not drawn');
    // On the figure's line, after it.
    expect(name.y + name.height / 2).toBeGreaterThan(figure.y);
    expect(name.y + name.height / 2).toBeLessThan(figure.y + figure.height);
    expect(name.x).toBeGreaterThanOrEqual(figure.x + figure.width);
    // Nothing covers it: the element at its middle is the name itself.
    const top = await page.evaluate(
      ({ x, y }) => document.elementFromPoint(x, y)?.closest('.figure-baseline') !== null,
      { x: name.x + name.width / 2, y: name.y + name.height / 2 },
    );
    expect(top).toBe(true);
    const text = await page.evaluate(() => document.body.innerText);
    expect(text.match(/made-up bakery/g)).toHaveLength(1);
    await expect(page.locator('.figure-words')).toContainText('for a made-up bakery');
  });
