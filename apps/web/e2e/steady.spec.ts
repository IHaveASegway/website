import { expect, test, type ElementHandle, type Locator, type Page } from '@playwright/test';
import { pages, ROUTE_LAB } from './expected';

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
// What it watches: every element on the screen, by its top, every frame. It leaves out what moves
// by design: the inside of an SVG picture or a canvas (vans, lamps and curves, though not the
// picture's own box), and whatever scrolls inside a box of its own, as an event log's lines do.
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
    /** Whether an element moves by design: inside a picture, or inside a box that scrolls. */
    const exempt = (el: Element) => {
      if (el.parentElement?.closest('svg') || el.closest('canvas')) return true;
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const { overflowY } = getComputedStyle(up);
        if (overflowY === 'auto' || overflowY === 'scroll') return true;
      }
      return false;
    };
    let watched: { el: Element; top: number }[] = [];
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
          if (seen && !exempt(el)) watched.push({ el, top: box.top });
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
async function open(page: Page, path: string): Promise<void> {
  await steady(page);
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
      // The faces every page preloads a second late, as on a slow first visit. They are optional
      // (astro.config.mjs): not here in the browser's first moment, they are not swapped in, and
      // the page stays in its fitted fallback. Barlow's SemiBold and B612 Mono swap by design, as
      // a page fetches them only once it sets <strong> or code (design-system.md, "The faces"), so
      // they come on time here. All of the page is watched, not only the screen: a reader may have
      // scrolled before the fonts came.
      const html = await (await page.request.get(path)).text();
      const preloaded = [...html.matchAll(/<link rel="preload" href="([^"]+\.woff2)"/g)].map(
        ([, href]) => href ?? '',
      );
      expect(preloaded).toHaveLength(3);
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

const FLOWS: Record<keyof typeof LABS, Press[]> = {
  raft: [
    { what: 'Run, the first touch', selector: 'button[data-rf-run]', by: 'tap' },
    { what: 'Pause', selector: 'button[data-rf-run]', by: 'tap', ms: 500 },
    { what: 'Next event', selector: 'button[data-rf-step]', by: 'key', ms: 500 },
    { what: 'Start over', selector: 'button[data-rf-reset]', by: 'key' },
    { what: 'Run again', selector: 'button[data-rf-run]', by: 'key' },
    { what: 'Start over while it runs', selector: 'button[data-rf-reset]', by: 'tap' },
    { what: 'a speed', selector: another('rf-speed'), by: 'tap' },
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
  ],
  backfill: [
    { what: 'Run, the first touch', selector: 'button[data-bf-run]', by: 'tap' },
    { what: 'Pause', selector: 'button[data-bf-run]', by: 'tap', ms: 500 },
    { what: 'Next event', selector: 'button[data-bf-step]', by: 'key', ms: 500 },
    { what: 'Start over', selector: 'button[data-bf-reset]', by: 'key' },
    { what: 'Run again', selector: 'button[data-bf-run]', by: 'key' },
    { what: 'Start over while it runs', selector: 'button[data-bf-reset]', by: 'tap' },
    { what: 'a way to write', selector: another('bf-mode'), by: 'tap' },
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

/** The phones the labs are pressed on: the project's iPhone 14, and the narrowest the site is
 *  laid out for, 320 px, where an iPhone SE wraps the labs' words onto more lines. */
const PHONES = [
  { phone: 'a 390 px phone', viewport: undefined },
  { phone: 'a 320 px phone', viewport: { width: 320, height: 568 } },
];

for (const { phone, viewport } of PHONES) {
  test.describe(`on ${phone}, a lab moves nothing on the screen, and the focus stays put`, () => {
    if (viewport) test.use({ viewport });
    for (const [name, lab] of Object.entries(LABS)) {
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

    test('the route lab: a map, the vans, Surprise and the space-time cube', async ({ page }) => {
      await open(page, ROUTE_LAB);
      const found = await play(page, [
        { what: 'Surprise, the first touch', selector: '[data-rl-surprise]', by: 'tap' },
        { what: 'the vans', selector: another('rl-vans'), by: 'tap' },
        { what: 'a tap on the map', selector: 'svg[data-rl-map] >> visible=true', by: 'tap' },
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
