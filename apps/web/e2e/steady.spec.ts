import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test';
import { handsOn, pages, ROUTE_LAB } from './expected';

// A page that holds still on a phone (design-system.md, "Layout"): once a page has painted, nothing
// on the screen moves unless the visitor scrolls or opens something. Live text, a log, a picture
// the app takes over: each has the room it can take from the first paint, so what is above the
// reader never changes height. On 2026-10-31 it did not: the Cache Lab's map grew and shrank by
// 71 px under a running demo, the first Run emptied every event log and moved the page by up to
// 320 px, the Queue Lab's key reflowed when the web fonts arrived, and a tap on the space-time cube
// scrolled the page to show all of it.
//
// It runs in WebKit on an iPhone (playwright.config.ts, the phone project), with scroll anchoring
// off. Playwright's WebKit anchors, and so hides a growth above the screen by scrolling with it;
// iOS Safari has never shipped scroll anchoring (overflow-anchor is unsupported there), so on a
// visitor's phone the same growth moves what they read. With it off, a move here is a move there.
//
// What it watches: every element on the screen, by its top, every frame, and each lab's controls by
// their left edge too, since a button that changes width sends its neighbor sideways, or a row down,
// away from the finger. It leaves out what moves by design: the inside of an SVG picture or a canvas
// (vans, lamps and curves, though not the picture's own box), the field behind the page, and whatever
// scrolls inside a box of its own, as an event log's lines do.
// A move of more than 1 px fails, and so does a scroll the test did not make, or a focus the
// visitor did not put somewhere: on the page's body, or off the screen.

const LABS = {
  raft: { path: '/lab/raft/', short: 'rf' },
  queue: { path: '/lab/queue/', short: 'qu' },
  cache: { path: '/lab/cache/', short: 'cl' },
  backfill: { path: '/lab/backfill/', short: 'bf' },
} as const;

/** Where a page is stood still: its top, a third and two thirds of the way down, its foot. */
const STOPS = [0, 1 / 3, 2 / 3, 1];
const STILL_MS = 2_000;
const AFTER_PRESS_MS = 3_000;

declare global {
  interface Window {
    __steady: {
      /** Starts watching what is on the screen now, or with `whole`, all of the page. */
      watch(whole?: boolean): void;
      /** Stops, and says each thing that moved, and any scroll. */
      moves(): string[];
    };
  }
}

/** iOS Safari's scrolling, and the watcher, in every page before its own scripts run. */
async function steady(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // No scroll anchoring. The page's policy refuses a <style> element, so through the CSSOM.
    const unanchor = () => {
      document.documentElement?.style.setProperty('overflow-anchor', 'none');
      document.body?.style.setProperty('overflow-anchor', 'none');
    };
    unanchor();
    document.addEventListener('DOMContentLoaded', unanchor);

    const name = (el: Element) => {
      const tag = el.tagName.toLowerCase();
      if (el.id) return `${tag}#${el.id}`;
      const data = [...el.attributes].find((a) => a.name.startsWith('data-'));
      const kind = el.getAttribute('class')?.split(' ')[0];
      return `${tag}${kind ? `.${kind}` : ''}${data ? `[${data.name}]` : ''}`;
    };
    /** Whether an element moves by design: inside a picture, inside a box that scrolls, or in the
     *  field behind the page (field.css), which holds nothing to read; or folded away, where nobody
     *  sees it, as a closed list's table is when a new plan changes its rows. */
    const exempt = (el: Element) => {
      if (el.parentElement?.closest('svg') || el.closest('canvas, .field')) return true;
      if (el.closest('details:not([open])') && !el.closest('summary')) return true;
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const { overflowY } = getComputedStyle(up);
        if (overflowY === 'auto' || overflowY === 'scroll') return true;
      }
      return false;
    };
    let watched: { el: Element; top: number; left: number }[] = [];
    let y = 0;
    let frame = 0;
    const found: string[] = [];
    const look = () => {
      if (scrollY !== y) found.push(`the page scrolled by itself, ${y} to ${scrollY}`);
      y = scrollY;
      // Each element that moved this frame, by how far; one whose parent moved as far is said
      // once, by the parent.
      const moved = new Map<Element, number>();
      for (const w of watched) {
        if (!w.el.isConnected) continue;
        const box = w.el.getBoundingClientRect();
        if (box.height === 0 && box.width === 0) continue;
        if (Math.abs(box.top - w.top) > 1) {
          moved.set(w.el, Math.round(box.top - w.top));
          w.top = box.top;
        }
        // A control that holds its height but not its place along the row, in the labs on one set
        // of controls so far.
        if (Math.abs(box.left - w.left) > 1 && w.el.closest('.lab-row, .cl-node-buttons')) {
          found.push(`${name(w.el)} moved ${Math.round(box.left - w.left)} px sideways`);
          w.left = box.left;
        }
      }
      for (const [el, by] of moved) {
        const parent = el.parentElement;
        if (parent && moved.get(parent) === by) continue;
        found.push(`${name(el)} moved ${by} px`);
      }
      frame = requestAnimationFrame(look);
    };
    window.__steady = {
      watch(whole = false) {
        cancelAnimationFrame(frame);
        found.length = 0;
        y = scrollY;
        watched = [];
        for (const el of document.body.querySelectorAll('*')) {
          const box = el.getBoundingClientRect();
          const seen = (whole || (box.bottom > 0 && box.top < innerHeight)) && box.height > 0;
          if (seen && !exempt(el)) watched.push({ el, top: box.top, left: box.left });
        }
        frame = requestAnimationFrame(look);
      },
      moves() {
        cancelAnimationFrame(frame);
        look();
        cancelAnimationFrame(frame);
        // The first few, so a report says where without a thousand lines.
        return found.length > 8 ? [...found.slice(0, 8), `and ${found.length - 8} more`] : found;
      },
    };
  });
}

/** Scrolls at once, as a finger does, then lets the page take one frame. */
async function scrollTo(page: Page, y: number): Promise<void> {
  await page.evaluate((top) => window.scrollTo({ top, behavior: 'instant' }), y);
  await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
}

/** Stands an element at a share of the screen's height. A control is pressed near the screen's
 *  top, so that what is below it, which a press changes most, is on the screen too; anything
 *  above it that changes height moves the control itself. */
async function stand(page: Page, target: Locator, share = 0.1): Promise<void> {
  const y = await target.evaluate(
    (el, at) => Math.round(el.getBoundingClientRect().top + scrollY - innerHeight * at),
    share,
  );
  await scrollTo(page, Math.max(0, y));
}

/** What moved while `act` ran and for `ms` after it: on the screen, or with `whole`, anywhere. */
async function movesAround(page: Page, act: () => Promise<unknown>, ms: number, whole = false) {
  await page.evaluate((all) => window.__steady.watch(all), whole);
  await act();
  await page.waitForTimeout(ms);
  return page.evaluate(() => window.__steady.moves());
}

/** Where focus stands: nowhere the visitor did not put it. Safari does not focus a button it
 *  taps: focus stays where it was, or goes to the nearest box around the button that takes focus,
 *  as a section with tabindex="-1" does; WebKit on Linux focuses a label's radio. After a key, it
 *  is on the control. Either way it is on the screen, never on the page's body after a key, nor
 *  somewhere else on the page. */
async function focusProblems(control: ElementHandle, before: string): Promise<string[]> {
  const now = await control.evaluate((el) => {
    const a = document.activeElement;
    const box = a?.getBoundingClientRect();
    return {
      name: a === document.body || !a ? 'body' : (a.outerHTML.split('>')[0] ?? '') + '>',
      // The control, a box around it, or what it holds: a tap on a label focuses its radio.
      near: a === el || (a !== document.body && Boolean(a?.contains(el) || el.contains(a))),
      off: box ? box.bottom < 0 || box.top > innerHeight : false,
    };
  });
  const problems: string[] = [];
  if (!now.near && now.name !== before) problems.push(`focus went to ${now.name}`);
  if (now.off) problems.push(`focus is off the screen, on ${now.name}`);
  return problems;
}

const activeName = (page: Page) =>
  page.evaluate(() => {
    const a = document.activeElement;
    return a === document.body || !a ? 'body' : (a.outerHTML.split('>')[0] ?? '') + '>';
  });

/** Loads a page, its fonts in, and turns its scroll anchoring off. */
async function open(page: Page, path: string, landing = false): Promise<void> {
  await steady(page);
  if (!landing) await handsOn(page);
  await page.goto(path, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  // A frame or two for what the load set going: boot scripts, the scene's first frame.
  await page.waitForTimeout(500);
}

/** Stands still at each stop and says what moved there. */
async function standStill(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const share of STOPS) {
    const end = await page.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    const y = Math.round(end * share);
    await scrollTo(page, y);
    await page.waitForTimeout(150);
    const moves = await movesAround(page, async () => undefined, STILL_MS);
    found.push(...moves.map((m) => `at ${y} px: ${m}`));
  }
  return found;
}

test.describe('standing still, nothing on the screen moves', () => {
  for (const path of pages()) {
    test(`on ${path}`, async ({ page }) => {
      await open(page, path);
      expect(await standStill(page)).toEqual([]);
    });
  }
});

test.describe('web fonts arriving late move nothing', () => {
  for (const path of pages()) {
    test(`on ${path}`, async ({ page }) => {
      await steady(page);
      await handsOn(page);
      // The faces every page preloads a second late, as on a slow first visit. They are optional
      // (astro.config.mjs): not here in the browser's first moment, they are not swapped in, and
      // the page stays in its fitted fallback. Archivo's SemiBold and JetBrains Mono swap by design, as
      // a page fetches them only once it sets <strong> or code (design-system.md, "The faces"), so
      // they come on time here. All of the page is watched, not only the screen: a reader may have
      // scrolled before the fonts came.
      const html = await (await page.request.get(path)).text();
      const preloaded = [...html.matchAll(/<link rel="preload" href="([^"]+\.woff2)"/g)].map(
        ([, href]) => href ?? '',
      );
      // Archivo's display, wide and interface faces, on a lab its label face, and on a long read
      // the reading face (ADR 0029).
      const lab = /^\/lab\/[a-z]+\/$/.test(path);
      const post = /^\/writing\/[a-z-]+\/$/.test(path);
      expect(preloaded).toHaveLength(3 + (lab ? 1 : 0) + (post ? 1 : 0));
      let asked = 0;
      let served = 0;
      await page.route(/\.woff2$/, async (route) => {
        if (!preloaded.includes(new URL(route.request().url()).pathname)) return route.continue();
        asked += 1;
        await new Promise((done) => setTimeout(done, 1_000));
        await route.continue();
        served += 1;
      });
      await page.goto(path, { waitUntil: 'domcontentloaded' });
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
      const moves = await movesAround(
        page,
        async () => {
          await expect.poll(() => asked > 0 && served === asked, { timeout: 10_000 }).toBe(true);
          await page.evaluate(() => document.fonts.ready);
        },
        300,
        true,
      );
      expect(moves).toEqual([]);
    });
  }
});

/** A press in a lab: a tap on what the selector finds, or a key on it after focusing it. */
type Press = { what: string; selector: string; by: 'tap' | 'key'; ms?: number };

/** The radio of a group that is not chosen, by its label: what a finger taps. */
const another = (group: string) =>
  `label:has(> input[name="${group}"]:not(:checked)), label:has(input[name="${group}"]:not(:checked))`;

/** The longest words a line under the controls says, each at or near the room it holds at. */
const LONGEST_SAID = [
  'Wednesday’s next load will fail partway. Wednesday has loaded already, so this fails its load when the week plays again, or after a clear.',
  'Loads now file under the clock’s day. The week starts over under it, at 00:00, before the job is switched on. Press Run to watch it.',
  'Serving stale is off. The run starts over under it, at 2.500 s, before the menu expires. Press Run to watch it.',
  'Worker 1 crashes holding orders 26, 27, 28 and 7 more, after order 26’s ticket printed and before its acknowledgement left.',
];

const FLOWS: Record<keyof typeof LABS, Press[]> = {
  raft: [
    { what: 'Run, the first touch', selector: 'button[data-rf-run]', by: 'tap' },
    { what: 'Pause', selector: 'button[data-rf-run]', by: 'tap', ms: 500 },
    { what: 'Next event', selector: 'button[data-rf-step]', by: 'key', ms: 500 },
    { what: 'Start over', selector: 'button[data-rf-reset]', by: 'key' },
    { what: 'Run again', selector: 'button[data-rf-run]', by: 'key' },
    { what: 'Start over while it runs', selector: 'button[data-rf-reset]', by: 'tap' },
    { what: 'a speed', selector: another('rf-speed'), by: 'tap' },
    // Each press that says something says it on the line under Time, whose room is kept.
    { what: 'a heal with nothing to heal', selector: '[data-rf-heal]', by: 'tap', ms: 500 },
    { what: 'a write', selector: '[data-rf-write]', by: 'tap', ms: 500 },
    { what: 'the leader cut off', selector: '[data-rf-lone]', by: 'tap', ms: 500 },
    { what: 'the split', selector: '[data-rf-split]', by: 'tap', ms: 500 },
    { what: 'the heal', selector: '[data-rf-heal]', by: 'tap', ms: 500 },
  ],
  queue: [
    { what: 'Run, the first touch', selector: 'button[data-qu-run]', by: 'tap' },
    { what: 'Pause', selector: 'button[data-qu-run]', by: 'tap', ms: 500 },
    { what: 'Next event', selector: 'button[data-qu-step]', by: 'key', ms: 500 },
    { what: 'Start over', selector: 'button[data-qu-reset]', by: 'key' },
    { what: 'Run again', selector: 'button[data-qu-run]', by: 'key' },
    { what: 'Start over while it runs', selector: 'button[data-qu-reset]', by: 'tap' },
    { what: 'a load', selector: another('qu-load'), by: 'tap' },
    { what: 'a worker crashed', selector: '[data-qu-crash="0"]', by: 'key' },
    { what: 'the key on', selector: 'label:has(input[name="qu-key"][value="on"])', by: 'tap' },
    { what: 'a poison order', selector: '[data-qu-poison]', by: 'tap', ms: 500 },
    { what: 'no more orders', selector: '[data-qu-producer]', by: 'tap', ms: 500 },
    { what: 'orders again', selector: '[data-qu-producer]', by: 'tap', ms: 500 },
    { what: 'a choice of prefetch', selector: another('qu-prefetch'), by: 'tap', ms: 500 },
    { what: 'a worker slowed', selector: '[data-qu-slow="1"]', by: 'tap', ms: 500 },
  ],
  cache: [
    { what: 'Run, the first touch', selector: 'button[data-cl-run]', by: 'tap' },
    { what: 'Pause', selector: 'button[data-cl-run]', by: 'tap', ms: 500 },
    { what: 'Next event', selector: 'button[data-cl-step]', by: 'key', ms: 500 },
    { what: 'Start over', selector: 'button[data-cl-reset]', by: 'key' },
    { what: 'Run again', selector: 'button[data-cl-run]', by: 'key' },
    { what: 'Start over while it runs', selector: 'button[data-cl-reset]', by: 'tap' },
    { what: 'a switch against a stampede', selector: '[data-cl-toggle="coalesce"]', by: 'tap' },
    { what: 'a node lost', selector: '[data-cl-lose="1"]', by: 'key' },
    // Each loss put more pages on fewer nodes, and sent the next button away from the finger: until
    // 2026-11-02 the third moved from (242, 2059) to (35, 2159), and the page grew by 196 px.
    { what: 'a second node lost', selector: '[data-cl-lose="2"]', by: 'tap', ms: 500 },
    { what: 'a third node lost', selector: '[data-cl-lose="3"]', by: 'tap', ms: 500 },
    { what: 'one node restarted', selector: '[data-cl-lose="1"]', by: 'tap', ms: 500 },
    { what: 'the cache flushed', selector: '[data-cl-flush]', by: 'tap', ms: 500 },
    { what: 'a write', selector: '[data-cl-write]', by: 'tap', ms: 500 },
    { what: 'a load', selector: another('cl-load'), by: 'tap', ms: 500 },
    { what: 'a placement', selector: another('cl-placement'), by: 'tap', ms: 500 },
  ],
  backfill: [
    { what: 'Run, the first touch', selector: 'button[data-bf-run]', by: 'tap' },
    { what: 'Pause', selector: 'button[data-bf-run]', by: 'tap', ms: 500 },
    { what: 'Next event', selector: 'button[data-bf-step]', by: 'key', ms: 500 },
    { what: 'Start over', selector: 'button[data-bf-reset]', by: 'key' },
    { what: 'Run again', selector: 'button[data-bf-run]', by: 'key' },
    { what: 'Start over while it runs', selector: 'button[data-bf-reset]', by: 'tap' },
    { what: 'a way to write', selector: another('bf-mode'), by: 'tap' },
    { what: 'a failed load', selector: '[data-bf-fail]', by: 'tap', ms: 500 },
    { what: 'a clear', selector: '[data-bf-clear]', by: 'tap', ms: 500 },
    { what: 'a late file', selector: '[data-bf-late]', by: 'tap', ms: 500 },
    { what: 'a limit of runs', selector: another('bf-runs'), by: 'tap', ms: 500 },
  ],
};

/** Presses each in turn, the control held where a reader holds it, and says what went wrong. */
async function play(page: Page, presses: readonly Press[]): Promise<string[]> {
  const found: string[] = [];
  for (const press of presses) {
    // The element itself, held: a locator for a choice not yet made finds the next one once it is.
    const control = page.locator(press.selector).first();
    const pressed = await control.elementHandle();
    if (!pressed) throw new Error(`nothing to press for ${press.what}`);
    await stand(page, control);
    // A finger starts from no focus, as Safari leaves it after a tap; a key, from the control.
    if (press.by === 'key') await control.focus();
    else await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const before = await activeName(page);
    const moves = await movesAround(
      page,
      () => (press.by === 'tap' ? control.tap() : control.press('Enter')),
      press.ms ?? AFTER_PRESS_MS,
    );
    found.push(...moves.map((m) => `${press.what}: ${m}`));
    found.push(...(await focusProblems(pressed, before)).map((m) => `${press.what}: ${m}`));
  }
  return found;
}

/** The fill behind a control, from its computed style. */
const fill = (control: Locator) => control.evaluate((el) => getComputedStyle(el).backgroundColor);

// A touch screen keeps :hover on what was last tapped (test/hover.test.ts): until 2026-11-02 a switch
// tapped on and off still looked half on, a paused Run looked pressed, and a gray tile stayed behind
// the theme icon.
test('a tap leaves no fill behind: a switch off again, Run after Pause, and the theme button', async ({
  page,
}) => {
  await open(page, '/lab/cache/');
  const clear = 'rgba(0, 0, 0, 0)';
  const invalidate = page.locator('[data-cl-toggle="invalidate"]');
  await expect(invalidate).toHaveAttribute('aria-pressed', 'true');
  await invalidate.tap();
  await expect(invalidate).toHaveAttribute('aria-pressed', 'false');
  expect(await invalidate.evaluate((el) => el.matches(':hover'))).toBe(true);
  expect(await fill(invalidate)).toBe(clear);

  const run = page.locator('[data-cl-run]');
  await run.tap();
  await expect(run).toHaveText('Pause');
  await run.tap();
  await expect(run).toHaveText('Run');
  expect(await fill(run)).toBe(clear);

  const reset = page.locator('[data-cl-reset]');
  await reset.tap();
  expect(await fill(reset)).toBe(clear);

  // A chosen radio keeps its fill, which is no hover's: only the one left behind goes clear.
  const steady = page.locator('label:has(input[name="cl-speed"][value="0.5"])');
  const quick = page.locator('label:has(input[name="cl-speed"][value="2"])');
  await quick.tap();
  expect(await fill(steady)).toBe(clear);
  expect(await fill(quick)).not.toBe(clear);

  const toggle = page.locator('.theme-toggle').first();
  await toggle.tap();
  expect(await fill(toggle)).toBe(clear);
});

// The Cache Lab's lead says to watch the database, and the stampede plays on landing: all of the
// database stands on the first screen. Until 2026-11-02 it ended 845 px down a 664 px screen, so a
// visitor saw only page dots. Run at what a phone's bars leave: the iPhone 14's real height, not 844,
// then the small phones, where the top bar and the title take a second line each.
for (const [width, height] of [
  [390, 664],
  [375, 553],
  [360, 640],
  [320, 568],
] as const) {
  test(`at ${width} by ${height}, the database the Cache Lab says to watch is on the first screen`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height });
    await page.goto('/lab/cache/', { waitUntil: 'load' });
    await page.evaluate(() => document.fonts.ready);
    const bottom = await page.locator('.cl-db').evaluate((db) => db.getBoundingClientRect().bottom);
    expect(bottom).toBeLessThanOrEqual(height);
  });
}

// However many pages a node holds, its lamps stay in the room its box keeps, so no press makes the
// map taller. The room is laid out by the width, so a width in between can break what 320 and 390
// don't: at 360 px, a common phone, all 120 pages took four rows, 3 px past the room.
test('one node holding all 120 pages keeps to its room at every width a phone has', async ({
  page,
}) => {
  await open(page, '/lab/cache/');
  for (const node of [0, 1, 2]) await page.locator(`[data-cl-lose="${node}"]`).tap();
  await expect(page.locator('.cl-pages[data-crowded]')).toHaveCount(1);
  for (let width = 320; width <= 430; width += 5) {
    await page.setViewportSize({ width, height: 664 });
    const past = await page.locator('.cl-pages[data-crowded]').evaluate((lamps) => {
      const end = (box: Element | null) => box?.lastElementChild?.getBoundingClientRect().bottom;
      return (end(lamps) ?? 0) - (end(lamps.nextElementSibling) ?? 0);
    });
    expect(past, `at ${width} px`).toBeLessThanOrEqual(0.5);
  }
});

// The Raft Lab's caption says more as the cluster breaks. Its room is laid out by the width, so a width
// in between can break what 320 and 390 don't, and until 2026-11-02 at 320 px a second line moved Run.
test('the raft lab’s caption keeps the room of its longest words at every width a phone has', async ({
  page,
}) => {
  await open(page, LABS.raft.path);
  const caption = page.locator('[data-rf-summary]');
  for (let width = 320; width <= 480; width += 5) {
    await page.setViewportSize({ width, height: 664 });
    const room = await caption.evaluate((p) => {
      const opening = p.textContent;
      const before = p.getBoundingClientRect().height;
      p.textContent =
        'Term 123 has lost its leader, 1000 entries committed, 2 servers down, the network is split. Servers 1 and 3 and 4 still think they lead older terms.';
      const after = p.getBoundingClientRect().height;
      p.textContent = opening;
      return after - before;
    });
    expect(room, `at ${width} px`).toBeLessThanOrEqual(0.5);
  }
});

// A press and what it says share a screen, on the smallest screen a phone's bars leave: each part of
// the controls has its own line, because one by Run would be over a thousand pixels from the settings.
for (const [name, lab] of Object.entries(LABS)) {
  test(`the ${name} lab: each control stands within a screen of the line it speaks in`, async ({
    page,
  }) => {
    await open(page, lab.path);
    const far = await page.locator('[data-part]').evaluateAll((parts) =>
      parts.flatMap((part) => {
        const line = part.querySelector('[data-said]')?.getBoundingClientRect();
        if (!line) return ['a part with no line'];
        return [...part.querySelectorAll('button, label')].flatMap((control) => {
          const box = control.getBoundingClientRect();
          return Math.max(line.bottom, box.bottom) - Math.min(line.top, box.top) > innerHeight
            ? [control.textContent?.trim() ?? '']
            : [];
        });
      }),
    );
    expect(far).toEqual([]);
  });
}

// The line stands under Time, so at 320 px, where the Raft Lab's controls take more than a screen,
// no control is further from it than a screen is tall. A line under them all would be 800 px from Run.
test('at 320 by 568, every control of the raft lab stands within a screen of its line', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page, LABS.raft.path);
  const far = await page.locator('[data-part]').evaluate((part) => {
    const line = part.querySelector('[data-said]')?.getBoundingClientRect() as DOMRect;
    return [...part.querySelectorAll('button, label')].flatMap((control) => {
      const box = control.getBoundingClientRect();
      return Math.max(line.bottom, box.bottom) - Math.min(line.top, box.top) > innerHeight
        ? [control.textContent?.trim() ?? '']
        : [];
    });
  });
  expect(far).toEqual([]);
});

// WebKit keeps a failed import for the life of the page, so "Press any control to try again" has to
// mean a fresh page there. With no connection yet, the page stays and says so again.
for (const [name, lab] of Object.entries(LABS)) {
  test(`the ${name} lab that did not load: a press tries again, here in WebKit too`, async ({
    page,
  }) => {
    const words = 'The lab did not load. Press any control to try again.';
    await page.route('**/_astro/app.*.js', (route) => route.abort());
    await page.goto(lab.path);
    const said = page.locator('[data-said]').first();
    await expect(said).toHaveText(words);
    const run = page.locator(`[data-${lab.short}-run]`);
    await page.route(lab.path, (route) => route.abort());
    await run.tap();
    await expect(said).toHaveText(words);
    await expect(run).toHaveText('Run');
    // A press far down the desk has its words beside it too, not a thousand pixels up the page.
    const far = page.locator('[data-part]').last().locator('button').last();
    await far.tap();
    await expect(page.locator('[data-said]').last()).toHaveText(words);
    await page.unroute(lab.path);
    await page.unroute('**/_astro/app.*.js');
    await run.tap();
    await expect(run).toHaveText('Pause');
    await expect(said).not.toHaveText(words);
  });
}

// The Route Lab's load, the same: its retry imported the file again until 2026-11-02, which WebKit
// answers with the failure it kept, so "Change anything to try again" could never come true on a phone.
test('the route lab that did not load: a press tries again, here in WebKit too', async ({
  page,
}) => {
  const words = 'The lab did not load. Press any control to try again.';
  const line = page.locator('[data-rl-status]');
  await page.route('**/_astro/app.*.js', (route) => route.abort());
  await page.goto(ROUTE_LAB);
  const surprise = page.locator('[data-rl-surprise]');
  await surprise.tap();
  await expect(line).toHaveText(words);
  await expect(line).toBeVisible();
  await page.unroute('**/_astro/app.*.js');
  const loaded = page.waitForEvent('load');
  await surprise.tap();
  await loaded;
  await expect(line).toHaveText('');
  await surprise.tap();
  await expect(line).toHaveText(/^A surprise: /, { timeout: 20_000 });
});

// A reader who has scrolled back keeps their lines as new ones come, and the log keeps only 60. Until
// 2026-11-02 the top line slid from 3.3 s to 5.7 s in 5 s of reading. iOS Safari has no scroll
// anchoring to do it for them, and neither has this WebKit once the page turns it off.
test('in a log scrolled back, what a reader is reading stays where it is as the run writes on', async ({
  page,
}) => {
  await open(page, '/lab/cache/');
  await page.locator('label:has(input[name="cl-speed"][value="2"])').tap();
  const run = page.locator('[data-cl-run]');
  await run.tap();
  await expect(run).toHaveText('Pause');
  const log = page.locator('[role="log"]');
  await expect
    .poll(() => log.evaluate((box) => box.scrollHeight - box.clientHeight), { timeout: 10_000 })
    .toBeGreaterThan(400);
  await log.evaluate((box) => {
    box.style.setProperty('overflow-anchor', 'none');
    box.scrollTop = -200;
  });
  // The run writes when it has something to say, and can say nothing for seconds, so this waits for
  // the next line and never for a time: a fixed wait passed or failed by where the run stood.
  const lines = log.locator('li');
  const newest = () => lines.last().textContent();
  const nextLine = async () => {
    const was = await newest();
    await expect.poll(newest, { timeout: 20_000 }).not.toBe(was);
  };
  const words = await log.evaluate((box) => {
    const top = box.getBoundingClientRect().top;
    const line = [...box.querySelectorAll('li')].find(
      (item) => item.getBoundingClientRect().top >= top + 8,
    );
    return line?.textContent ?? '';
  });
  const standing = () =>
    log.evaluate((box, reading) => {
      const line = [...box.querySelectorAll('li')].find((item) => item.textContent === reading);
      return (line?.getBoundingClientRect().top ?? NaN) - box.getBoundingClientRect().top;
    }, words);
  const before = await standing();
  const count = await lines.count();
  await nextLine();
  await run.tap();
  // Scroll offsets are whole pixels and a line's height isn't, so each line written can round by a
  // pixel. A line nothing held would move by the height of what was written, 17 px a line at least.
  const written = (await lines.count()) - count;
  expect(written).toBeGreaterThan(0);
  expect(Math.abs((await standing()) - before)).toBeLessThanOrEqual(1 + written);
  expect(await log.evaluate((box) => box.scrollTop)).toBeLessThan(-200);
  // Back at its end, it follows the newest line again, with no script to tell it.
  await log.evaluate((box) => {
    box.scrollTop = 0;
  });
  await run.tap();
  await nextLine();
  expect(await log.evaluate((box) => box.scrollTop)).toBe(0);
});

/** The phones the labs are pressed on: the project's iPhone 14, and the narrowest the site is
 *  laid out for, 320 px, where an iPhone SE wraps the labs' words onto more lines. */
const PHONES = [
  { phone: 'a 390 px phone', viewport: undefined },
  { phone: 'a 320 px phone', viewport: { width: 320, height: 568 } },
];

// The Route Lab's first screen on the iPhone itself, in WebKit, at the viewport the project gives it,
// 390 by 664, with no size set by hand: routes-layout.spec.ts holds the same in Chromium, and a check
// on any other height can pass on what a phone doesn't show.
test('the route lab’s first screen on an iPhone 14 holds its map switch and half its map', async ({
  page,
}) => {
  expect(page.viewportSize()).toEqual({ width: 390, height: 664 });
  await page.goto(ROUTE_LAB);
  await page.evaluate(() => document.fonts.ready);
  await expect(page.locator('.rl-view')).toBeInViewport({ ratio: 1 });
  await expect(page.locator('svg[data-rl-map] >> visible=true')).toBeInViewport({ ratio: 0.5 });
  await expect(page.locator('[data-rl-saved]')).not.toBeInViewport();
});

for (const { phone, viewport } of PHONES) {
  test.describe(`on ${phone}, a lab moves nothing on the screen, and the focus stays put`, () => {
    if (viewport) test.use({ viewport });
    for (const [name, lab] of Object.entries(LABS)) {
      // The run a visitor lands on (ADR 0030): it starts by itself, a frame or two after they arrive,
      // under a thumb that hasn't moved.
      test(`the ${name} lab, as a visitor lands on it and it starts`, async ({ page }) => {
        await steady(page);
        // From the load, when the page has its styles: the run waits for the page to settle after it.
        await page.addInitScript(() => {
          addEventListener('load', () => window.__steady.watch());
        });
        await page.goto(lab.path, { waitUntil: 'load' });
        await expect(page.locator(`[data-${lab.short}-run]`)).toHaveText('Pause');
        await page.waitForTimeout(1_500);
        expect(await page.evaluate(() => window.__steady.moves())).toEqual([]);
      });

      if (name === 'raft') {
        // The Raft Lab's landing run tells a story (lib/raft/view.ts, landingStory): the caption, the
        // logs and the buttons change with it, and it goes round again, under a thumb that hasn't
        // moved. All of the page is watched, on Playwright's clock, every frame of it.
        test('the raft lab, through the whole of its landing story and round again', async ({
          page,
        }) => {
          test.slow();
          await steady(page);
          const start = Date.UTC(2026, 10, 2);
          await page.clock.install({ time: start });
          await page.clock.pauseAt(start + 1_000);
          await page.goto(lab.path, { waitUntil: 'load' });
          await page.evaluate(() => document.fonts.ready);
          await page.clock.runFor(200);
          await expect(page.locator('[data-rf-run]')).toHaveText('Pause');
          await page.evaluate(() => window.__steady.watch(true));
          await page.clock.runFor(27_000);
          expect(await page.evaluate(() => window.__steady.moves())).toEqual([]);
          // It did go round: the first telling is over, and the second is under way.
          await expect(page.locator('[data-rf-summary]')).toHaveText(
            'Server 1 leads term 1, 3 entries committed.',
          );
          await expect(page.locator('[data-rf-log="0"] .rf-cell')).toHaveCount(3);
        });

        // A server's button says Crash, then Restart, and the caption grows as the cluster breaks,
        // over the buttons a thumb is on.
        test('the raft lab, as its cluster breaks and comes back', async ({ page }) => {
          await open(page, lab.path);
          const presses: Press[] = [
            { what: 'Run', selector: 'button[data-rf-run]', by: 'tap', ms: 500 },
            { what: 'a server crashed', selector: '[data-rf-toggle="0"]', by: 'key', ms: 800 },
            { what: 'the servers split', selector: '[data-rf-split]', by: 'key', ms: 800 },
            { what: 'another crashed', selector: '[data-rf-toggle="3"]', by: 'tap', ms: 800 },
            { what: 'the network healed', selector: '[data-rf-heal]', by: 'tap', ms: 800 },
            { what: 'a server restarted', selector: '[data-rf-toggle="0"]', by: 'key', ms: 800 },
          ];
          expect(await play(page, presses)).toEqual([]);
        });

        // The logs' box takes focus, as the event log's does, for the keys that scroll it: a tap where
        // it shows only in part must not scroll the page to show the rest.
        test('the raft lab’s logs, touched where they show only in part', async ({ page }) => {
          await open(page, lab.path);
          const box = page.locator('.rf-logs-box');
          const y = await box.evaluate((el) => {
            const rect = el.getBoundingClientRect();
            return Math.round(rect.top + scrollY - innerHeight + rect.height / 4);
          });
          await scrollTo(page, y);
          const rect = await box.boundingBox();
          if (!rect) throw new Error('no logs');
          const viewport = page.viewportSize();
          const at = { x: rect.x + rect.width / 2, y: (viewport?.height ?? 0) - 10 };
          const moves = await movesAround(page, () => page.touchscreen.tap(at.x, at.y), 1_000);
          expect(moves).toEqual([]);
        });

        // A log outgrows its row with a thumb on Send a write: the page holds still, all of it.
        test('the raft lab, as its logs outgrow their rows', async ({ page }) => {
          await open(page, lab.path);
          const write = page.locator('[data-rf-write]');
          await stand(page, write);
          const moves = await movesAround(
            page,
            async () => {
              for (let i = 0; i < 25; i++) await write.tap();
            },
            300,
            true,
          );
          expect(moves).toEqual([]);
          await expect(page.locator('[data-rf-log="0"] .rf-cell')).toHaveCount(28);
        });

        // Its caption takes the room its longest words take from the first paint, so a run that
        // breaks the cluster further never moves the controls under it.
        test('the raft lab keeps its caption the room of its longest words', async ({ page }) => {
          await open(page, lab.path);
          const caption = page.locator('[data-rf-summary]');
          const before = await caption.boundingBox();
          // The longest a run can say, with each number a digit longer than a run makes it.
          await caption.evaluate((p) => {
            p.textContent =
              'Term 123 has lost its leader, 1000 entries committed, 2 servers down, the network is split. Servers 1 and 3 and 4 still think they lead older terms.';
          });
          const after = await caption.boundingBox();
          expect(Math.abs((after?.height ?? 0) - (before?.height ?? 0))).toBeLessThanOrEqual(1);
        });
      }

      test(`the ${name} lab, standing still while it runs`, async ({ page }) => {
        await open(page, lab.path);
        const run = page.locator(`[data-${lab.short}-run]`);
        await stand(page, run);
        await run.tap();
        await expect(run).toHaveText('Pause');
        await page.waitForTimeout(500);
        expect(await standStill(page)).toEqual([]);
      });
    }

    for (const [name, lab] of Object.entries(LABS) as [
      keyof typeof LABS,
      (typeof LABS)[keyof typeof LABS],
    ][]) {
      test(`the ${name} lab`, async ({ page }) => {
        // Eight presses with their waits, each long enough to catch a late move, and the link's: 20
        // s of it is the check watching. That leaves under 10 s of the default limit for the work
        // itself, and on a busy machine the queue lab's took more, with nothing having moved.
        test.setTimeout(60_000);
        await open(page, lab.path);
        expect(await play(page, FLOWS[name])).toEqual([]);
        // A link to a run, followed on the page: the run it names, in the same room.
        const run = page.locator(`[data-${lab.short}-run]`);
        await stand(page, run);
        const moves = await movesAround(
          page,
          () => page.evaluate(() => (location.hash = '#seed-7')),
          1_500,
        );
        expect(moves).toEqual([]);
      });

      test(`the ${name} lab's event log, touched where it shows only in part`, async ({ page }) => {
        await open(page, lab.path);
        const log = page.locator(`#${name}-lab [role="log"]`);
        // The log's top quarter on the screen, the rest below it: a tap there must not scroll.
        const y = await log.evaluate((el) => {
          const box = el.getBoundingClientRect();
          return Math.round(box.top + scrollY - innerHeight + box.height / 4);
        });
        await scrollTo(page, y);
        const box = await log.boundingBox();
        if (!box) throw new Error('no log');
        const viewport = page.viewportSize();
        const at = { x: box.x + box.width / 2, y: (viewport?.height ?? 0) - 10 };
        const moves = await movesAround(page, () => page.touchscreen.tap(at.x, at.y), 1_000);
        expect(moves).toEqual([]);
      });
    }

    // Filed under the clock's day, a week's rows have somewhere to go that isn't one of its days. Until
    // 2026-11-02 that was a row of their own, which took 67 px mid-run, with a finger on Pause.
    test('the backfill lab, its rows landing on the clock’s day mid-run', async ({ page }) => {
      await open(page, LABS.backfill.path);
      const run = page.locator('[data-bf-run]');
      await page.locator(another('bf-partition')).first().tap();
      await page.locator('label:has(input[name="bf-speed"][value="30"])').tap();
      await stand(page, run);
      const moves = await movesAround(
        page,
        async () => {
          await run.tap();
          await expect(page.locator('[data-bf-stray]')).toBeVisible({ timeout: 15_000 });
        },
        500,
      );
      expect(moves).toEqual([]);
    });

    for (const [name, lab] of Object.entries(LABS)) {
      // The line under a part of the controls keeps the room its longest words take, so speaking moves
      // nothing, at the narrowest phone too (lib/lab/said.ts holds the words to SAID_ROOM).
      test(`the ${name} lab's lines hold their longest words in the room they keep`, async ({
        page,
      }) => {
        await open(page, lab.path);
        const heights = await page.locator('[data-said]').evaluateAll(
          (lines, longest) =>
            lines.flatMap((line) =>
              longest.map((words) => {
                line.textContent = '';
                const empty = line.getBoundingClientRect().height;
                line.textContent = words;
                return [empty, line.getBoundingClientRect().height];
              }),
            ),
          LONGEST_SAID,
        );
        expect(heights.length).toBeGreaterThanOrEqual(LONGEST_SAID.length);
        for (const [empty, full] of heights) expect(full).toBe(empty);
      });
    }

    test('the route lab, as a visitor lands on it and its vans drive', async ({ page }) => {
      await steady(page);
      await page.addInitScript(() => {
        addEventListener('load', () => window.__steady.watch());
      });
      await page.goto(ROUTE_LAB, { waitUntil: 'load' });
      await page.waitForTimeout(1_500);
      expect(await page.evaluate(() => window.__steady.moves())).toEqual([]);
    });

    test('the route lab: a new day redraws the cube’s picture and words, and all of the page holds', async ({
      page,
    }) => {
      await open(page, ROUTE_LAB);
      const backs = page.locator('[data-rl-cube-back]');
      const moves = await movesAround(
        page,
        async () => {
          // From the page itself, with no finger anywhere: a real tap and a scroll fire a mouse's
          // pointerover on the cube here, which loads the scene, and a finger that never touches
          // the cube is the case this holds.
          await page
            .locator('input[name="rl-day"][value="quiet"]')
            .evaluate((radio: HTMLInputElement) => radio.click());
          await expect(backs.last()).toHaveText(/2\u00a0h 48\u00a0min$/, { timeout: 20_000 });
          await expect(page.locator('svg[data-rl-cube-picture] .rl-route')).toHaveCount(2);
        },
        300,
        true,
      );
      expect(moves).toEqual([]);
      await expect(page.locator('[data-rl-cube] canvas')).toHaveCount(0);
    });

    // The words under the map change most when the last order goes, and they keep their room. All of
    // the page is watched, with a real tap: on 2026-11-02 QA measured 88 px of move at this press.
    test('the route lab: the last order goes, and all of the page holds', async ({ page }) => {
      await open(page, ROUTE_LAB);
      await page.locator('.rl-orders summary').tap();
      const orders = page.locator('input[name="rl-order"]:checked');
      await orders.evaluateAll((boxes) => {
        for (const box of boxes.slice(1)) (box as HTMLInputElement).click();
      });
      await expect(page.locator('[data-rl-saved]')).toHaveText(
        'With one order, both plans are the same route.',
        { timeout: 20_000 },
      );
      await stand(page, orders.first());
      const moves = await movesAround(page, () => orders.first().tap(), 800, true);
      expect(moves).toEqual([]);
      await expect(page.locator('[data-rl-saved]')).toHaveText(
        'Add at least one order to plan a route.',
      );
    });

    test('the route lab: a map, the vans, Surprise and the space-time cube', async ({ page }) => {
      await open(page, ROUTE_LAB);
      const found = await play(page, [
        { what: 'Surprise, the first touch', selector: '[data-rl-surprise]', by: 'tap' },
        { what: 'the vans', selector: another('rl-vans'), by: 'tap' },
        { what: 'a tap on the map', selector: 'svg[data-rl-map] >> visible=true', by: 'tap' },
        { what: 'a day', selector: another('rl-day'), by: 'tap' },
        { what: 'the other map', selector: another('rl-view'), by: 'tap', ms: 500 },
        { what: 'back to the first', selector: another('rl-view'), by: 'tap', ms: 500 },
      ]);
      // A tap on a cube that shows only in part: the page stays where the finger left it.
      const stage = page.locator('[data-rl-cube-stage] >> visible=true').first();
      const y = await stage.evaluate((el) => {
        const box = el.getBoundingClientRect();
        return Math.round(box.top + scrollY - innerHeight + box.height * 0.7);
      });
      await scrollTo(page, y);
      const box = await stage.boundingBox();
      if (!box) throw new Error('no cube');
      const viewport = page.viewportSize();
      const moves = await movesAround(
        page,
        () => page.touchscreen.tap(box.x + box.width / 2, (viewport?.height ?? 0) - 20),
        AFTER_PRESS_MS,
      );
      found.push(...moves.map((m) => `the cube: ${m}`));
      // Its Play, once the cube has loaded: the focus stays near the cube, the page where it was.
      found.push(
        ...(await play(page, [
          { what: "the cube's Play", selector: '[data-rl-cube-play] >> visible=true', by: 'tap' },
        ])),
      );
      expect(found).toEqual([]);
    });
  });
}

// A press that changes a button's words can reflow the row it stands in, at the widths that row wraps
// and no others, so a check at 390 and 320 px sees none of it: until 2026-11-03 choosing Wednesday took
// the Backfill Lab's page 56 px down on a 1,440 px laptop and on the largest iPhones, and Stop taking
// orders sent itself 800 px across the Queue Lab at 1,216. All of the page is watched, at every kind of
// width: the phones, the tablets, the laptops, and each width a reviewer saw it at.
const WRAPPING_WIDTHS = [320, 390, 430, 440, 600, 640, 1024, 1180, 1216, 1280, 1440];

test('the backfill lab: a day chosen moves nothing, at any width its row could wrap', async ({
  page,
}) => {
  test.setTimeout(120_000);
  await open(page, LABS.backfill.path);
  for (const width of WRAPPING_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    const days = page.locator('label:has(input[name="bf-day"])');
    await stand(page, days.first());
    const moves = await movesAround(
      page,
      async () => {
        for (const day of await days.all()) {
          await day.tap();
          await page.waitForTimeout(60);
        }
        await days.first().tap();
      },
      60,
      true,
    );
    expect(moves, `at ${width} px`).toEqual([]);
  }
});

test('the queue lab: Stop taking orders and Take orders move nothing, at any width their row could wrap', async ({
  page,
}) => {
  test.setTimeout(90_000);
  await open(page, LABS.queue.path);
  for (const width of WRAPPING_WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    const producer = page.locator('[data-qu-producer]');
    await stand(page, producer);
    const moves = await movesAround(
      page,
      async () => {
        await producer.tap();
        await expect(producer).toHaveText('Take orders');
        await page.waitForTimeout(60);
        await producer.tap();
        await expect(producer).toHaveText('Stop taking orders');
      },
      60,
      true,
    );
    expect(moves, `at ${width} px`).toEqual([]);
  }
});

// The top bar on an iPhone, in WebKit, at the widths phones have: one row, 56 px, so the first screen
// doesn't lose 32 px to a second row with half of it empty (e2e/top-bar.spec.ts holds every width in
// Chromium). 320 is an iPhone SE of the first generation, 375 a 13 mini or a later SE, 390 an iPhone
// 14, and 360 most Androids.
for (const width of [320, 360, 375, 390]) {
  test(`at ${width} px the top bar is one row, 56 px tall`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.setViewportSize({ width, height: 664 });
    await page.goto('/lab/');
    await page.waitForFunction(() => 'palette' in document.documentElement.dataset);
    const bar = await page.evaluate(() => {
      const tile = document.querySelector('.wordmark-tile') as Element;
      const box = (document.querySelector('.site-header') as Element).getBoundingClientRect();
      return {
        height: Math.round(box.height),
        tools: [...document.querySelectorAll('.search-open, .motion-toggle, .theme-toggle')].map(
          (tool) => Math.round(tool.getBoundingClientRect().height),
        ),
        tile: tile.getBoundingClientRect().left,
        wide: document.documentElement.scrollWidth,
      };
    });
    expect(bar).toEqual({ height: 56, tools: [44, 44, 44], tile: 18, wide: width });
  });
}
