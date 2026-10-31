import { expect, test } from '@playwright/test';
import { replay as replayCache } from '../src/lib/cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from '../src/lib/cache/view';
import { openingRun as backfillOpening } from '../src/lib/backfill/view';
import {
  backfillFact,
  backfillLine,
  cacheFact,
  cacheLine,
  queueFact,
  queueLine,
} from '../src/lib/lines';
import { replay as replayQueue } from '../src/lib/queue/sim';
import { OPENING as QUEUE, openingRun as queueOpening } from '../src/lib/queue/view';
import { pages } from './expected';

// The site as an index (ADR 0022): a row of an index opens its page wherever it is pressed, the
// rail lists every demo and marks the one on screen, and no page scrolls on past its own end.

const LISTS = ['/', '/lab/', '/writing/', '/notes/'];

for (const path of LISTS) {
  test(`${path}: a press on a row's empty space opens the page its link names`, async ({
    page,
  }) => {
    test.skip(!pages().includes(path), `this build has no ${path}`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(path);
    // The first row that opens a page on this site: a project's card opens its repository.
    const rows = page.locator(
      'main :is(.card:has(.card-more[href^="/"]), .post-list > li:has(.post-title > a[href^="/"]))',
    );
    test.skip((await rows.count()) === 0, `${path} lists no row`);
    const row = rows.first();
    const href = await row.locator(':is(.card-more, .post-title > a)').getAttribute('href');
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

// ADR 0023: an item that holds pages is a disclosure in the rail, closed until pressed, and open on
// a page it lists, with the page marked and "View all" last.
test('the rail drops down to every demo under Lab, open on a demo and marking it', async ({
  page,
}) => {
  const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
  test.skip(demos.length === 0, 'this build has no demo');
  await page.setViewportSize({ width: 1440, height: 900 });
  const fold = page.locator('.nav-fold:has(> summary:text-is("Lab"))');
  const leaves = fold.locator('.nav-leaves a');
  for (const demo of demos) {
    await page.goto(demo);
    await expect(fold).toHaveAttribute('open', '');
    expect(await leaves.evaluateAll((links) => links.map((a) => a.getAttribute('href')))).toEqual([
      ...[...demos].sort(),
      '/lab/',
    ]);
    await expect(leaves.last()).toHaveText(/^View all demos/);
    await expect(leaves.and(page.locator('[aria-current="page"]'))).toHaveAttribute('href', demo);
    await expect(fold).toHaveAttribute('data-current', '');
  }
  // Below 80rem the header is the row across the top, with its items alone, each a link.
  await page.setViewportSize({ width: 1024, height: 900 });
  await expect(fold).toBeHidden();
  await expect(page.locator('.site-nav a.bar-only[href="/lab/"]')).toBeVisible();
});

test('on Home the rail is closed until pressed; pressing one item closes the other', async ({
  page,
}) => {
  test.skip(!pages().includes('/lab/'), 'this build has no lab');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  const lab = page.locator('.nav-fold:has(> summary:text-is("Lab"))');
  await expect(lab).not.toHaveAttribute('open');
  await expect(lab.locator('.nav-leaves')).toBeHidden();
  await lab.locator('summary').click();
  await expect(lab).toHaveAttribute('open', '');
  await expect(lab.locator('.nav-leaves a').last()).toBeVisible();
  // The keyboard opens one the same way, and the rail's items share a name, so it closes Lab.
  const writing = page.locator('.nav-fold:has(> summary:text-is("Writing"))');
  if ((await writing.count()) > 0) {
    await writing.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(writing).toHaveAttribute('open', '');
    await expect(lab).not.toHaveAttribute('open');
  }
});

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

// The Lab index (ADR 0025): each live lab is a row of its line, drawn large, and its words, its
// title, its summary and one fact from its build. From 64rem the line takes the left of the row
// and the words the right; below, the line heads the row, small and with no names. Either way it
// comes in from the page's edge, the rail's or the window's, where main clips it, and the page
// never scrolls sideways.
for (const { width, height, beside } of [
  { width: 1440, height: 900, beside: true },
  { width: 390, height: 844, beside: false },
]) {
  test(`at ${width} px the Lab index draws each lab's line ${beside ? 'beside' : 'above'} its words, in from the page's edge`, async ({
    page,
  }) => {
    test.skip(!pages().includes('/lab/'), 'this build has no lab');
    await page.setViewportSize({ width, height });
    await page.goto('/lab/');
    await page.evaluate(() => document.fonts.ready);
    const rows = await page.locator('main .lab-row').all();
    expect(rows.length).toBeGreaterThan(0);
    const main = await page.locator('main').evaluate((element) => ({
      left: element.getBoundingClientRect().left,
      clip: getComputedStyle(element).overflowX,
    }));
    expect(main.clip).toBe('clip');
    for (const row of rows) {
      const slug = await row.getAttribute('data-line');
      const drawing = row.locator('svg.line-draw').filter({ visible: true });
      await expect(drawing, `${slug}: one drawing at a time`).toHaveCount(1);
      const box = await drawing.boundingBox();
      const title = await row.locator('.post-title').boundingBox();
      if (!box || !title) throw new Error(`${slug}: the row is not drawn`);
      // Its track starts past the page's edge: the drawing's own left is the text's edge.
      const track = await drawing.locator('.line-track').first().boundingBox();
      expect(track?.x ?? Infinity, `${slug}: in from the edge`).toBeLessThanOrEqual(main.left);
      if (beside) expect(title.x, `${slug}: words beside`).toBeGreaterThan(box.x + box.width);
      else expect(title.y, `${slug}: words under`).toBeGreaterThan(box.y + box.height);
      // Stations are named on the large drawing only.
      expect((await drawing.locator('.line-label').count()) > 0, `${slug}: names`).toBe(beside);
      await expect(row.locator('.lab-fact'), `${slug}: its fact`).toHaveText(/\S.*\.$/);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

// The simulated labs' rows (ADR 0025): each line drawn from its lab's opening run, through its own
// simulation, its stations named and its lamps in the states the run leaves them in, and its fact
// the sentence the model writes from the same opening with the change its lab entry makes first
// (lib/lines.ts), so the page and the simulation cannot disagree. Every row in its own colour.
test('the Lab index draws the queue, the cache and the backfill from their openings, each with its fact', async ({
  page,
}) => {
  test.skip(!pages().includes('/lab/'), 'this build has no lab');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/lab/');
  const row = (slug: string) => page.locator(`main .lab-row[data-line="${slug}"]`);
  const wide = (slug: string) => row(slug).locator('svg.line-wide');
  const count = <T>(list: readonly T[], test: (item: T) => boolean) => list.filter(test).length;

  if ((await row('queue').count()) > 0) {
    const line = queueLine(queueOpening());
    const keyed = replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until);
    await expect(row('queue').locator('.lab-fact')).toHaveText(queueFact(keyed));
    await expect(wide('queue').locator('.line-label')).toHaveText([
      ...line.workers.map((w) => w.name),
      'Dead letters',
      'Publisher',
      'Queue',
    ]);
    // A lamp in the tank for each order waiting, then a worker's lamp each: lit while it works,
    // crossed while it is down.
    await expect(wide('queue').locator('.line-now')).toHaveCount(
      count(line.workers, (w) => w.lamp === 'lit'),
    );
    await expect(wide('queue').locator('.line-cross')).toHaveCount(
      count(line.workers, (w) => w.lamp === 'cross'),
    );
    await expect(wide('queue').locator('.line-lamp')).toHaveCount(
      line.waiting + count(line.workers, (w) => w.lamp !== 'lit'),
    );
  }

  if ((await row('cache').count()) > 0) {
    const opening = cacheOpening();
    const line = cacheLine(opening);
    const coalesced = replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until);
    await expect(row('cache').locator('.lab-fact')).toHaveText(cacheFact(opening, coalesced));
    await expect(wide('cache').locator('.line-label')).toHaveText([
      'Database',
      'Readers',
      'Cache nodes',
    ]);
    // A filled lamp per node up, and a lamp per connection of the database's pool, lit while a
    // fetch runs on it.
    await expect(wide('cache').locator('.line-lamp-lit[data-lit]')).toHaveCount(
      count(line.nodes, (lamp) => lamp === 'filled'),
    );
    await expect(wide('cache').locator('.line-now')).toHaveCount(
      count(line.connections, (busy) => busy),
    );
    await expect(wide('cache').locator('.line-lamp')).toHaveCount(
      line.nodes.length + count(line.connections, (busy) => !busy),
    );
  }

  if ((await row('backfill').count()) > 0) {
    const line = backfillLine(backfillOpening());
    await expect(row('backfill').locator('.lab-fact')).toHaveText(
      backfillFact(backfillOpening(), backfillOpening('overwrite')),
    );
    await expect(wide('backfill').locator('.line-label')).toHaveText([
      ...line.days.map((day) => day.name),
      'Report',
    ]);
    await expect(wide('backfill').locator('.line-lamp-lit[data-lit]')).toHaveCount(
      count(line.days, (day) => day.lamp === 'filled'),
    );
    await expect(wide('backfill').locator('.line-cross')).toHaveCount(
      count(line.days, (day) => day.lamp === 'cross'),
    );
  }

  // A colour per lab: each row's track in its own line's colour.
  const strokes = await page.locator('main .lab-row').evaluateAll((rows) =>
    rows.map((r) => {
      const track = r.querySelector('svg.line-wide .line-track');
      return track ? getComputedStyle(track).stroke : null;
    }),
  );
  expect(new Set(strokes).size).toBe(strokes.length);
});

// Home's board (ADR 0025) draws a band for every live lab with a line, one drawing at a time, and
// never wider than the page. A hollow lamp there stands on the board's own surface, not the page's:
// it takes the band's --line-ground (styles/lines.css), where it once took the page's background.
for (const { width, height } of [
  { width: 1440, height: 900 },
  { width: 390, height: 844 },
]) {
  test(`at ${width} px Home's board draws a line for every lab, its hollow lamps on the board's surface`, async ({
    page,
  }) => {
    const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
    test.skip(demos.length === 0, 'this build has no demo');
    await page.setViewportSize({ width, height });
    await page.goto('/');
    const board = page.locator('[data-board]');
    const bands = board.locator('.band');
    expect(
      (await bands.evaluateAll((all) => all.map((band) => band.getAttribute('data-line')))).sort(),
    ).toEqual(demos.map((path) => path.split('/')[2]).sort());
    for (const band of await bands.all())
      await expect(band.locator('svg.line-draw').filter({ visible: true })).toHaveCount(1);
    const { surface, lamps } = await board.evaluate((element) => ({
      surface: getComputedStyle(element).backgroundColor,
      lamps: [
        ...new Set(
          [...element.querySelectorAll('.line-draw .line-lamp')].map(
            (lamp) => getComputedStyle(lamp).fill,
          ),
        ),
      ],
    }));
    expect(lamps).toEqual([surface]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
  });
}

// A lab's page heads its title with the lab's line (ADR 0025), in the colour the rail's lamp for
// that lab is lit in, and it ends in a lamp; a page that is not a lab's has no line.
test("each lab's page heads its title with its line, in its own colour, ending in a lamp", async ({
  page,
}) => {
  const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
  test.skip(demos.length === 0, 'this build has no demo');
  await page.setViewportSize({ width: 1440, height: 900 });
  const seen = new Set<string>();
  for (const demo of demos) {
    await page.goto(demo);
    const head = await page.locator('.page-head > .page-line').evaluate((line) => {
      const before = getComputedStyle(line, '::before');
      const after = getComputedStyle(line, '::after');
      const lamp = document.querySelector('.nav-leaves a[aria-current] .nav-lamp');
      // The lab's own line token, as the page resolves it from the lab's slug, read from a probe,
      // so the drawing is tied to the token and not only to the rail's lamp.
      const slug = line.closest('[data-line]')?.getAttribute('data-line') ?? '';
      const probe = document.createElement('span');
      probe.style.setProperty('background-color', `var(--line-${slug})`);
      document.body.append(probe);
      const token = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return {
        hidden: line.getAttribute('aria-hidden'),
        line: before.backgroundColor,
        height: before.height,
        lamp: after.backgroundColor,
        round: after.borderRadius,
        rail: lamp ? getComputedStyle(lamp).fill : null,
        token,
      };
    });
    expect(head.token, demo).not.toBe('rgba(0, 0, 0, 0)');
    expect(head, demo).toEqual({
      hidden: 'true',
      line: head.token,
      height: '6px',
      lamp: head.token,
      round: '50%',
      rail: head.token,
      token: head.token,
    });
    seen.add(head.line);
  }
  // A colour per lab.
  expect(seen.size).toBe(demos.length);
  await page.goto('/lab/');
  await expect(page.locator('.page-line')).toHaveCount(0);
});
