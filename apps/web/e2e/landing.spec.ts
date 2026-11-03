import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB } from './expected';

// What runs by itself (ADR 0030). Each lab's demo is running when a visitor lands, with no press:
// until 2026-11-02 a lab stood still until a press, and Joseph read that as a page not started. It
// holds back for a visitor who asked for less motion or to save data, and for one who pressed the top
// bar's Pause earlier in the tab. It plays only while it's on the screen and says nothing to a screen
// reader, and the visitor's first press makes it theirs. e2e/steady.spec.ts checks that it moves
// nothing on a phone as it starts.
//
// The field behind every page runs by its own clocks, and a scroll has nothing to do with it: tied to
// the scroll and fading with it, each turn of a wheel read as the page reloading.

const LABS = [
  { name: 'raft', path: '/lab/raft/', short: 'rf' },
  { name: 'queue', path: '/lab/queue/', short: 'qu' },
  { name: 'cache', path: '/lab/cache/', short: 'cl' },
  { name: 'backfill', path: '/lab/backfill/', short: 'bf' },
] as const;

type Lab = (typeof LABS)[number];

const run = (page: Page, lab: Lab) => page.locator(`[data-${lab.short}-run]`);
const clock = (page: Page, lab: Lab) => page.locator(`[data-${lab.short}-clock]`);

/** Every script the page fetched past its eager one: a lab's simulation is the file named app. */
function appFetches(page: Page): string[] {
  const seen: string[] = [];
  page.on('request', (request) => {
    if (/\/_astro\/app\.[\w-]+\.js$/.test(new URL(request.url()).pathname))
      seen.push(request.url());
  });
  return seen;
}

for (const lab of LABS) {
  test.describe(`the ${lab.name} lab`, () => {
    test('a visitor lands on it running, with no press', async ({ page }) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await expect(run(page, lab)).toHaveAttribute('data-lamp', 'on');
      const first = await clock(page, lab).textContent();
      await expect(clock(page, lab)).not.toHaveText(first ?? '');
      expect(errors).toEqual([]);
    });

    test('axe finds no violation as it runs', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      const { violations } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(violations.map((v) => v.id)).toEqual([]);
    });

    test('under reduced motion it stands still and loads nothing', async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      const fetched = appFetches(page);
      await page.goto(lab.path);
      const first = await clock(page, lab).textContent();
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
      await expect(clock(page, lab)).toHaveText(first ?? '');
      expect(fetched).toEqual([]);
    });

    test('a visitor saving data lands on it standing still', async ({ page }) => {
      await page.addInitScript(() =>
        Object.defineProperty(navigator, 'connection', { value: { saveData: true } }),
      );
      const fetched = appFetches(page);
      await page.goto(lab.path);
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
      expect(fetched).toEqual([]);
    });

    test('a link to a run opens that run paused, as it always has', async ({ page }) => {
      await page.goto(`${lab.path}#seed-12`);
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
    });

    test('a link to a run followed on the page stops the one it landed on, and that run stands', async ({
      page,
    }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await page.evaluate(() => (location.hash = '#seed-12'));
      await expect(run(page, lab)).toHaveText('Run');
      await page.waitForTimeout(800);
      await expect(run(page, lab)).toHaveText('Run');
    });

    test('its own Pause stops it alone: the field runs on, and the next lab lands running', async ({
      page,
    }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await run(page, lab).click();
      await expect(run(page, lab)).toHaveText('Run');
      const first = await clock(page, lab).textContent();
      await page.waitForTimeout(700);
      await expect(clock(page, lab)).toHaveText(first ?? '');
      await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
      expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();

      const next = LABS[(LABS.indexOf(lab) + 1) % LABS.length] as Lab;
      await page.goto(next.path);
      await expect(run(page, next)).toHaveText('Pause');
    });

    test('the top bar’s Pause stops it for the tab, and its Play starts it', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await page.locator('[data-motion-toggle]').click();
      await expect(run(page, lab)).toHaveText('Run');
      expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');

      const next = LABS[(LABS.indexOf(lab) + 1) % LABS.length] as Lab;
      await page.goto(next.path);
      await page.waitForTimeout(800);
      await expect(run(page, next)).toHaveText('Run');
      await page.locator('[data-motion-toggle]').click();
      await expect(run(page, next)).toHaveText('Pause');
    });

    test('it pauses off the screen and goes on when it comes back', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
      await expect(run(page, lab)).toHaveText('Run');
      await page.evaluate(() => scrollTo(0, 0));
      await expect(run(page, lab)).toHaveText('Pause');
    });

    // Any hash change used to end all this, so an "On this page" link or the skip link left a run
    // playing off the screen, deaf to the top bar's Pause, for as long as the tab stayed open.
    test('a link to a heading is no press: it still pauses off the screen and under the top bar’s Pause', async ({
      page,
    }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      await page.locator('.lab-contents a').last().click();
      await expect(run(page, lab)).toHaveText('Run');
      const said = page.locator(`#${lab.name}-lab [role="status"]`).first();
      await expect(said).toHaveAttribute('aria-live', 'off');
      await page.evaluate(() => scrollTo(0, 0));
      await expect(run(page, lab)).toHaveText('Pause');
      await page.locator('[data-motion-toggle]').click();
      await expect(run(page, lab)).toHaveText('Run');
      const first = await clock(page, lab).textContent();
      await page.waitForTimeout(700);
      await expect(clock(page, lab)).toHaveText(first ?? '');
    });

    test('its live regions keep quiet until the first press, then speak', async ({ page }) => {
      await page.goto(lab.path);
      await expect(run(page, lab)).toHaveText('Pause');
      const said = page.locator(`#${lab.name}-lab [role="status"]`).first();
      await expect(said).toHaveAttribute('aria-live', 'off');
      await run(page, lab).click();
      await expect(said).not.toHaveAttribute('aria-live', 'off');
    });
  });
}

// The labs on one set of controls (docs/lab.md, "The controls"). The Raft Lab's first thing to try is
// a fault, so it has no fix to replay.
const FIXES = [
  {
    name: 'queue',
    path: '/lab/queue/',
    short: 'qu',
    fix: 'label:has(input[name="qu-key"][value="on"])',
    quick: 'label:has(input[name="qu-speed"][value="5"])',
    back: 'Virtual time 1.',
    link: '#seed-28&key=on',
    words:
      'The idempotency key is on. The run starts over under it, at 1.500 s, before worker 2’s crash.',
    log: '2.873 s Worker 1 finds order 18 in the record and does not print it again',
  },
  {
    name: 'cache',
    path: '/lab/cache/',
    short: 'cl',
    fix: '[data-cl-toggle="coalesce"]',
    quick: 'label:has(input[name="cl-speed"][value="2"])',
    back: 'Virtual time 2.',
    link: '#seed-7&coalesce=on',
    words: 'Coalescing is on. The run starts over under it, at 2.500 s, before the menu expires.',
    log: 'its readers miss, and each node sends one fetch for them all',
  },
  {
    name: 'backfill',
    path: '/lab/backfill/',
    short: 'bf',
    fix: 'label:has(input[name="bf-mode"][value="overwrite"])',
    quick: 'label:has(input[name="bf-speed"][value="30"])',
    back: '00:00',
    link: '#seed-9&mode=overwrite',
    words:
      'Loads now overwrite their day. The week starts over under it, at 00:00, before the job is switched on.',
    log: 'Wednesday’s load fails part way, and as its overwrite is one atomic step, the report is as it was',
  },
] as const;

for (const lab of FIXES) {
  test.describe(`the ${lab.name} lab, as a visitor who lands on it running tries the fix`, () => {
    const clockOf = (page: Page) => page.locator(`[data-${lab.short}-clock]`);
    const line = (page: Page) => page.locator('[data-said]').first();

    // Until 2026-11-02 a fix pressed on the run that was already going changed nothing they could
    // see: the crash or the stampede had been and gone, and the checks stayed Broken beside a lit fix.
    test('its first press replays the run under the fix, still running, and says so', async ({
      page,
    }) => {
      await page.goto(lab.path);
      const run = page.locator(`[data-${lab.short}-run]`);
      await expect(run).toHaveText('Pause');
      await page.locator(lab.quick).click();
      await page.locator(lab.fix).click();
      await expect(line(page)).toHaveText(lab.words);
      await expect(line(page)).toBeVisible();
      await expect(run).toHaveText('Pause');
      expect(new URL(page.url()).hash).toBe(lab.link);
      await expect(page.locator(`#${lab.name}-lab [data-${lab.short}-lines]`)).toContainText(
        lab.log,
        { timeout: 20_000 },
      );
    });

    test('Start over goes back to the same moment, and plays on if it was playing', async ({
      page,
    }) => {
      await page.goto(lab.path);
      const run = page.locator(`[data-${lab.short}-run]`);
      await expect(run).toHaveText('Pause');
      await page.locator(`[data-${lab.short}-reset]`).click();
      await expect(run).toHaveText('Pause');
      await expect(clockOf(page)).toContainText(lab.back);
      await expect(line(page)).toHaveText(/ starts over under these settings, at /);
      // Stood still, it asks for the press it waits for.
      await run.click();
      await expect(run).toHaveText('Run');
      await page.locator(`[data-${lab.short}-reset]`).click();
      await expect(run).toHaveText('Run');
      await expect(line(page)).toHaveText(/ Press Run to watch it\.$/);
    });

    test('until a press, its lines say what their controls do, and never what the run does', async ({
      page,
    }) => {
      await page.goto(lab.path);
      await expect(page.locator(`[data-${lab.short}-run]`)).toHaveText('Pause');
      await page.waitForTimeout(600);
      const lines = page.locator('[data-said]');
      await expect(lines).toHaveCount(2);
      for (const each of await lines.all()) {
        await expect(each).toBeVisible();
        await expect(each).not.toHaveAttribute('data-spoke');
        expect(await each.textContent()).toBe(await each.getAttribute('data-said'));
        // A screen reader can read what a sighted visitor reads here. It's the only place that says
        // what these controls do before they're pressed.
        expect(await each.evaluate((line) => line.closest('[aria-hidden="true"]'))).toBeNull();
      }
    });

    // A dropped connection, or a deploy that retired the hashed file while the page was open. Until
    // 2026-11-02 the only word of it was in a line a screen reader alone could reach.
    test('a load that fails says so on the screen, leaves the picture as drawn, and a press tries again', async ({
      page,
    }) => {
      const words = 'The lab did not load. Press any control to try again.';
      await page.route('**/_astro/app.*.js', (route) => route.abort());
      await page.goto(lab.path);
      await expect(line(page)).toHaveText(words);
      await expect(line(page)).toBeVisible();
      // Every line says it: a visitor at the settings on a phone is a thousand pixels from the first.
      await expect(page.locator('[data-said]').last()).toHaveText(words);
      await expect(page.locator(`[data-${lab.short}-said]`)).toHaveText(words);
      const run = page.locator(`[data-${lab.short}-run]`);
      const standing = await clockOf(page).textContent();
      await page.waitForTimeout(300);
      await expect(run).toHaveText('Run');
      await expect(clockOf(page)).toHaveText(standing ?? '');

      // With a connection, a fresh page is the way back: a browser may keep a failed import, as
      // WebKit does (steady.spec.ts), and a deploy's new file has another name.
      await page.unroute('**/_astro/app.*.js');
      await run.click();
      await expect(run).toHaveText('Pause');
      await expect(line(page)).not.toHaveText(words);
    });
  });
}
// Heartbeats alone have no story, so the run a visitor lands on on the Raft Lab crashes its leader
// and elects another, as the Queue Lab's crashes a worker (lib/raft/view.ts, landingStory). At the
// Steady speed a real second is 50 virtual ms: the crash comes 2 s in, the new leader about 6 s in,
// the old leader comes back at 10 s, a write commits at about 15 s, and it ends at 20 s. All but the
// first test run on Playwright's clock, held still between its steps, so a run of a minute takes a
// moment and a press lands exactly when it says.
test.describe('the Raft Lab’s landing run', () => {
  const lab = LABS[0];
  const summary = (page: Page) => page.locator('[data-rf-summary]');
  const lines = (page: Page) => page.locator('[data-rf-lines] li').allTextContents();
  const up = (page: Page) => page.locator('[data-rf-node][data-up="true"]');
  /** The lines a run with no story and no press never writes: a crash, a restart, a fourth write. */
  const madeSinceTheOpening = async (page: Page) =>
    (await lines(page)).filter((line) => /crashes\.|restarts as|takes write 4/.test(line));

  /** Opens a page with the clock in the test's hand, and lets it settle: nothing by the clock moves
   *  but what the test runs. */
  async function open(page: Page, path: string = lab.path): Promise<void> {
    const start = Date.UTC(2026, 10, 2);
    await page.clock.install({ time: start });
    await page.clock.pauseAt(start + 1_000);
    await page.goto(path);
    await page.clock.runFor(200);
  }

  /** A visitor landing: the page has settled and the run stands at the opening's moment, playing.
   *  The app can arrive within the 200 ms the page settled in, and have run on for some of them. */
  async function land(page: Page): Promise<void> {
    await open(page);
    await expect(run(page, lab)).toHaveText('Pause');
    await expect(clock(page, lab)).toHaveText(/^Virtual time 1\.4[01]\d s$/);
  }

  test('on the real clock too, it shows an election with no press', async ({ page }) => {
    await page.goto(lab.path);
    await expect(summary(page)).toHaveText(
      'Server 3 leads term 2, 3 entries committed, 1 server down.',
      { timeout: 25_000 },
    );
    expect((await lines(page)).join('\n')).toContain(
      'Server 3 times out and asks for votes in term 2',
    );
  });

  test('left alone, the leader crashes, another wins a newer term, and the old one comes back to hear it', async ({
    page,
  }) => {
    await land(page);
    await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
    await page.clock.runFor(2_100);
    await expect(summary(page)).toHaveText(
      'No leader in term 1, 3 entries committed, 1 server down.',
    );
    await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'false');
    await page.clock.runFor(3_100);
    await expect(page.locator('[data-rf-node="2"]')).toHaveAttribute('data-role', 'candidate');
    await expect(summary(page)).toHaveText(
      'No leader in term 2, 3 entries committed, 1 server down.',
    );
    await page.clock.runFor(1_000);
    await expect(summary(page)).toHaveText(
      'Server 3 leads term 2, 3 entries committed, 1 server down.',
    );
    await page.clock.runFor(4_500);
    await expect(up(page)).toHaveCount(5);
    await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-role', 'follower');
    await page.clock.runFor(5_000);
    await expect(summary(page)).toHaveText('Server 3 leads term 2, 4 entries committed.');
    await expect(page.locator('[data-rf-status]')).toHaveText(/^All five safety properties held/);
  });

  test('its story ends, stands a moment, and goes round again, on the same seed', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(20_500);
    await expect(summary(page)).toHaveText('Server 3 leads term 2, 4 entries committed.');
    await expect(page.locator('.rf-cell[data-done]')).toHaveCount(20);
    await page.clock.runFor(6_200);
    await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
    await expect(run(page, lab)).toHaveText('Pause');
    await expect(page.locator('[data-rf-seed]')).toHaveText('7');
    expect(new URL(page.url()).hash).toBe('');
    expect(await madeSinceTheOpening(page)).toEqual([]);
    await page.clock.runFor(2_500);
    await expect(up(page)).toHaveCount(4);
    expect(await madeSinceTheOpening(page)).toHaveLength(1);
  });

  // A first press ends the story: nothing happens by itself after it. A press that writes or crashes
  // writes its own line, and that's the one line there is. Start over is the one press that asks for
  // the run again, and has tests of its own below.
  const FIRST_PRESSES: [string, (page: Page) => Promise<unknown>, RegExp[]][] = [
    [
      'Pause, then Run',
      async (page) => {
        await run(page, lab).click();
        await run(page, lab).click();
      },
      [],
    ],
    ['a speed', (page) => page.getByRole('radio', { name: 'Slow' }).check(), []],
    // It fires no input, since it's the speed already chosen, and it's as much a press as any.
    [
      'the speed already chosen',
      (page) => page.locator('label', { hasText: 'Steady' }).click(),
      [],
    ],
    ['Next event', (page) => page.getByRole('button', { name: 'Next event' }).click(), []],
    [
      'a write',
      (page) => page.getByRole('button', { name: 'Send a write' }).click(),
      [/Server 1 takes write 4/],
    ],
    ['the loss slider', (page) => page.locator('[data-rf-loss]').fill('0'), []],
    [
      'a tap on a server in the picture',
      (page) => page.locator('[data-rf-node="4"] .rf-name').click(),
      [/Server 5 crashes/],
    ],
  ];
  for (const [what, press, made] of FIRST_PRESSES) {
    test(`a first press makes it theirs: after ${what}, nothing happens by itself`, async ({
      page,
    }) => {
      await land(page);
      await press(page);
      if ((await run(page, lab).textContent()) === 'Run') await run(page, lab).click();
      await expect(run(page, lab)).toHaveText('Pause');
      await page.clock.runFor(30_000);
      await expect(page.locator('[data-rf-node="0"]')).toHaveAttribute('data-up', 'true');
      const said = await madeSinceTheOpening(page);
      expect(said).toHaveLength(made.length);
      made.forEach((line, i) => expect(said[i]).toMatch(line));
    });
  }

  test('a press once the story has begun keeps what happened and stops the rest', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(2_500);
    await expect(up(page)).toHaveCount(4);
    await run(page, lab).click();
    await run(page, lab).click();
    await page.clock.runFor(30_000);
    // Server 1 stays down: bringing it back was the page's to do, and the demo is theirs now.
    await expect(up(page)).toHaveCount(4);
    const said = await madeSinceTheOpening(page);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Server 1 crashes/);
    // The cluster it leaves goes on by Raft's own rules, with a leader of its own.
    await expect(summary(page)).toHaveText(/^Server [2-5] leads term \d+, 3 entries committed/);
  });

  // A visitor who watched the election and pressed Start over got heartbeats and nothing else, so the
  // run they just saw couldn't be replayed, where the Queue Lab's Start over brings its crash back.
  test('Start over on the run they landed on tells the story again, once, and it stands', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(8_000);
    await expect(summary(page)).toHaveText(
      'Server 3 leads term 2, 3 entries committed, 1 server down.',
    );
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
    await expect(run(page, lab)).toHaveText('Pause');
    await expect(page.locator('[data-rf-seed]')).toHaveText('7');
    expect(new URL(page.url()).hash).toBe('#seed-7');
    expect(await madeSinceTheOpening(page)).toEqual([]);
    await page.clock.runFor(2_500);
    await expect(up(page)).toHaveCount(4);
    await page.clock.runFor(14_000);
    await expect(summary(page)).toHaveText('Server 3 leads term 2, 4 entries committed.');
    // It's theirs now: no going round. The cluster stands on what the story left, with its one write.
    await page.clock.runFor(30_000);
    await expect(summary(page)).toHaveText('Server 3 leads term 2, 4 entries committed.');
    await expect(up(page)).toHaveCount(5);
    expect(await madeSinceTheOpening(page)).toHaveLength(3);
    // And again, for as often as they ask.
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.clock.runFor(2_500);
    await expect(up(page)).toHaveCount(4);
  });

  test('any other press after Start over drops what is left of the story', async ({ page }) => {
    await land(page);
    await page.getByRole('button', { name: 'Start over' }).click();
    await page.clock.runFor(1_000);
    await page.getByRole('button', { name: 'Send a write' }).click();
    await page.clock.runFor(30_000);
    await expect(up(page)).toHaveCount(5);
    const said = await madeSinceTheOpening(page);
    expect(said).toHaveLength(1);
    expect(said[0]).toMatch(/Server 1 takes write 4/);
  });

  test('Start over after any other press goes back to the opening with nothing ahead', async ({
    page,
  }) => {
    await land(page);
    await page.getByRole('button', { name: 'Send a write' }).click();
    await page.getByRole('button', { name: 'Start over' }).click();
    await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
    await page.clock.runFor(30_000);
    await expect(up(page)).toHaveCount(5);
    expect(await madeSinceTheOpening(page)).toEqual([]);
  });

  test('a link to a heading is no press: the story waits off the screen and carries on', async ({
    page,
  }) => {
    await land(page);
    await page.locator('.lab-contents a').last().click();
    await expect(run(page, lab)).toHaveText('Run');
    await page.clock.runFor(30_000);
    expect(await madeSinceTheOpening(page)).toEqual([]);
    await page.evaluate(() => scrollTo(0, 0));
    await expect(run(page, lab)).toHaveText('Pause');
    await page.clock.runFor(2_500);
    await expect(up(page)).toHaveCount(4);
    expect(await madeSinceTheOpening(page)).toHaveLength(1);
  });

  test('a link to a run followed on the page stands on that run with no story, and Start over keeps it so', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(2_500);
    await expect(up(page)).toHaveCount(4);
    await page.evaluate(() => {
      location.hash = '#seed-7';
    });
    await expect(run(page, lab)).toHaveText('Run');
    await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
    await page.getByRole('button', { name: 'Start over' }).click();
    await run(page, lab).click();
    await page.clock.runFor(30_000);
    await expect(up(page)).toHaveCount(5);
    expect(await madeSinceTheOpening(page)).toEqual([]);
  });

  test('a link to a run has no story, standing or run', async ({ page }) => {
    await open(page, `${lab.path}#seed-7`);
    await expect(run(page, lab)).toHaveText('Run');
    await page.clock.runFor(5_000);
    await expect(clock(page, lab)).toHaveText('Virtual time 1.400 s');
    await run(page, lab).click();
    await page.clock.runFor(30_000);
    await expect(up(page)).toHaveCount(5);
    expect(await madeSinceTheOpening(page)).toEqual([]);
  });

  test('under reduced motion, Run has no story either', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    await expect(run(page, lab)).toHaveText('Run');
    await run(page, lab).click();
    await expect(run(page, lab)).toHaveText('Pause');
    await page.clock.runFor(30_000);
    await expect(up(page)).toHaveCount(5);
    expect(await madeSinceTheOpening(page)).toEqual([]);
  });

  test('a visitor who pressed while the top bar’s Pause held the landing back gets no story from its Play', async ({
    page,
  }) => {
    await page.addInitScript(() => sessionStorage.setItem('motion', 'paused'));
    await open(page);
    await expect(run(page, lab)).toHaveText('Run');
    await run(page, lab).click();
    await expect(run(page, lab)).toHaveText('Pause');
    await page.locator('[data-motion-toggle]').click();
    await page.clock.runFor(30_000);
    await expect(up(page)).toHaveCount(5);
    expect(await madeSinceTheOpening(page)).toEqual([]);
  });

  test('the top bar’s Pause holds the story, which is no press, and its Play picks it up', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(1_000);
    await page.locator('[data-motion-toggle]').click();
    await expect(run(page, lab)).toHaveText('Run');
    const stood = (await clock(page, lab).textContent()) ?? '';
    await page.clock.runFor(30_000);
    await expect(clock(page, lab)).toHaveText(stood);
    expect(await madeSinceTheOpening(page)).toEqual([]);
    await page.locator('[data-motion-toggle]').click();
    await expect(run(page, lab)).toHaveText('Pause');
    await page.clock.runFor(1_500);
    await expect(up(page)).toHaveCount(4);
    expect(await madeSinceTheOpening(page)).toHaveLength(1);
  });

  // The end of the story stands six seconds, then goes round. With nobody watching, or the top bar's
  // Pause pressed, it went round anyway: the button lit, the clock ran for up to half a second, and
  // the picture went back to the opening, on a page told to hold still.
  test('the top bar’s Pause holds the end of the story too, and its Play goes round from there', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(21_000);
    await expect(summary(page)).toHaveText('Server 3 leads term 2, 4 entries committed.');
    await page.locator('[data-motion-toggle]').click();
    await expect(run(page, lab)).toHaveText('Run');
    const stood = (await clock(page, lab).textContent()) ?? '';
    for (let i = 0; i < 8; i++) {
      await page.clock.runFor(1_000);
      await expect(run(page, lab)).toHaveText('Run');
      await expect(clock(page, lab)).toHaveText(stood);
    }
    await expect(summary(page)).toHaveText('Server 3 leads term 2, 4 entries committed.');
    await page.locator('[data-motion-toggle]').click();
    await page.clock.runFor(6_600);
    await expect(summary(page)).toHaveText('Server 1 leads term 1, 3 entries committed.');
    await expect(run(page, lab)).toHaveText('Pause');
  });

  test('none of the story is said aloud, and the first press gives the page its voice back', async ({
    page,
  }) => {
    await land(page);
    await page.clock.runFor(2_500);
    const said = page.locator('[data-rf-said]');
    await expect(said).toHaveAttribute('aria-live', 'off');
    await expect(said).toHaveText('');
    await page.getByRole('button', { name: 'Send a write' }).click();
    await expect(said).not.toHaveAttribute('aria-live', 'off');
  });
});

test.describe('the Route Lab', () => {
  const layers = (page: Page) => page.locator('[data-rl-fleet]');
  const drive = (page: Page) => page.locator('[data-rl-drive]').first();
  const time = (page: Page) =>
    layers(page)
      .first()
      .evaluate((svg) => (svg as SVGSVGElement).getCurrentTime());
  const paused = (page: Page) =>
    layers(page)
      .first()
      .evaluate((svg) => (svg as SVGSVGElement).animationsPaused());

  test('its vans are driving when a visitor lands, each on a route it draws', async ({ page }) => {
    await page.goto(ROUTE_LAB);
    await expect(layers(page).first()).toBeVisible();
    expect(await paused(page)).toBe(false);
    const start = await time(page);
    await expect.poll(() => time(page)).toBeGreaterThan(start);
    const routes = await page.evaluate(() =>
      [...document.querySelectorAll('[data-rl-fleet] mpath')].map((m) =>
        document.querySelector(m.getAttribute('href') ?? '') ? 'found' : m.getAttribute('href'),
      ),
    );
    expect(routes.length).toBeGreaterThan(0);
    expect(new Set(routes)).toEqual(new Set(['found']));
  });

  test('their button pauses and plays them, and the top bar’s reaches them too', async ({
    page,
  }) => {
    await page.goto(ROUTE_LAB);
    await expect(drive(page)).toHaveText('Pause');
    await drive(page).click();
    await expect(drive(page)).toHaveText('Run');
    await expect(drive(page)).toHaveAccessibleName('Run the vans');
    expect(await paused(page)).toBe(true);
    await drive(page).click();
    await expect(drive(page)).toHaveText('Pause');
    expect(await paused(page)).toBe(false);

    await page.locator('[data-motion-toggle]').click();
    await expect(drive(page)).toHaveText('Run');
    expect(await paused(page)).toBe(true);
  });

  test('under reduced motion they and their button are gone', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(ROUTE_LAB);
    await expect(layers(page).first()).toBeHidden();
    await expect(drive(page)).toBeHidden();
  });

  // A mouse over the demo, or a focus in it, loads its app, which draws the plan the build drew. That
  // is no reason to send the vans home: until 2026-11-02 they jumped back to the bakery.
  test('the app arriving leaves the vans where they are', async ({ page }) => {
    await page.goto(ROUTE_LAB);
    await expect.poll(() => time(page)).toBeGreaterThan(1);
    const drawn = page.evaluate(
      () =>
        new Promise<void>((done) =>
          document
            .getElementById('route-lab')
            ?.addEventListener('rl:plans', () => done(), { once: true }),
        ),
    );
    await page.locator('.rl-controls').hover();
    await drawn;
    expect(await time(page)).toBeGreaterThan(1);
  });

  test('a new plan brings its own vans, and a tap still lands on the map', async ({ page }) => {
    await page.goto(ROUTE_LAB);
    const before = await layers(page).first().innerHTML();
    await page
      .locator('input[name="rl-vans"][value="2"]')
      .evaluate((radio: HTMLInputElement) => radio.click());
    await expect.poll(() => layers(page).first().innerHTML()).not.toBe(before);
    const pointer = await layers(page)
      .first()
      .evaluate((svg) => getComputedStyle(svg).pointerEvents);
    expect(pointer).toBe('none');
  });
});

test.describe('the field', () => {
  /** What runs by the clock, by the class of what it moves. */
  const running = (page: Page) =>
    page.evaluate(() => [
      ...new Set(
        document
          .getAnimations()
          .filter((a) => a.timeline === document.timeline && a.playState === 'running')
          .map((a) => (a.effect as KeyframeEffect).target?.getAttribute('class')?.split(' ')[0]),
      ),
    ]);

  for (const path of ['/', '/lab/', '/writing/', '/about/', '/writing/trading-bot-teardown/']) {
    test(`${path}: the lines run by themselves, under the top bar’s button`, async ({ page }) => {
      await page.goto(path);
      await expect.poll(() => running(page)).toEqual(expect.arrayContaining(['field-run']));
      await page.locator('[data-motion-toggle]').click();
      await expect.poll(() => running(page)).not.toEqual(expect.arrayContaining(['field-run']));
    });
  }

  test('a scroll has nothing to do with them', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    // Everything the scroll could touch, watched while the wheel turns.
    await page.evaluate(() => {
      const w = window as unknown as { changes: number };
      w.changes = 0;
      new MutationObserver((list) => (w.changes += list.length)).observe(
        document.querySelector('.field') as Element,
        { attributes: true, subtree: true, childList: true },
      );
    });
    const line = page.locator('.field-run').first();
    const state = () =>
      line.evaluate((element) => {
        const [animation] = element.getAnimations();
        return {
          clock: animation?.timeline === document.timeline,
          state: animation?.playState,
          time: Number(animation?.currentTime),
          opacity: getComputedStyle(element).opacity,
          now: document.timeline.currentTime as number,
        };
      });
    const before = await state();
    await page.mouse.move(600, 400);
    for (let tick = 0; tick < 8; tick++) {
      await page.mouse.wheel(0, 240);
      await page.waitForTimeout(60);
    }
    const after = await state();
    expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0);
    expect(await page.evaluate(() => (window as unknown as { changes: number }).changes)).toBe(0);
    expect(after.clock).toBe(true);
    expect(after.state).toBe('running');
    expect(after.opacity).toBe(before.opacity);
    // Its time went on by exactly the time that passed: it didn't restart or jump with the scroll.
    const passed = after.now - before.now;
    expect(Math.abs(after.time - before.time - passed)).toBeLessThan(100);
  });

  test('a section’s line lights once, and stays lit as the page scrolls back', async ({ page }) => {
    await page.goto('/');
    const last = page.locator('.section').last();
    await expect(last).not.toHaveAttribute('data-lit');
    await last.scrollIntoViewIfNeeded();
    await expect(last).toHaveAttribute('data-lit');
    await page.evaluate(() => scrollTo(0, 0));
    await page.waitForTimeout(200);
    await expect(last).toHaveAttribute('data-lit');
    // A row lights when it reaches its height in the window, and stays lit past it.
    const row = page.locator('.build').first();
    await row.scrollIntoViewIfNeeded();
    await expect(row).toHaveAttribute('data-lit');
    await page.evaluate(() => scrollTo(0, 0));
    await expect(row).toHaveAttribute('data-lit');
  });

  test('under reduced motion none of it runs, and every line stands lit', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const path of ['/', '/lab/', '/writing/']) {
      await page.goto(path);
      await page.waitForTimeout(400);
      expect(await running(page)).toEqual([]);
    }
    await page.goto('/');
    const scale = await page
      .locator('.section')
      .last()
      .evaluate((section) => getComputedStyle(section, '::before').scale);
    expect(scale).toBe('none');
  });

  test('/lab/ runs its glyphs’ sparks, and so does a lab’s page, under the same button', async ({
    page,
  }) => {
    for (const path of ['/lab/', '/lab/raft/']) {
      await page.goto(path);
      await expect.poll(() => running(page)).toEqual(expect.arrayContaining(['iso-spark']));
      await page.locator('[data-motion-toggle]').click();
      await expect.poll(() => running(page)).not.toEqual(expect.arrayContaining(['iso-spark']));
      await page.locator('[data-motion-toggle]').click();
    }
  });
});
