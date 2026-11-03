import { expect, test, type Locator, type Page } from '@playwright/test';
import { ROUTE_LAB, SOLVER } from './expected';

// The Route Lab's desk as a visitor uses it (review of 2026-10-31, LAB-1): the cause and its effect
// on one screen. Where one map shows at a time, half the map is on the first screen of an iPhone 14
// with Safari's bars up, 390 by 664, the map switch, the map and the controls that change it fit
// the 844 px of its whole screen, and Tab meets the controls in the order the screen shows them.
// From 64rem the controls head the desk, over the readout and both maps, as before.
//
// Until 2026-11-02 the first-screen check ran at 844, which no visitor's Safari shows, and asked for
// 100 px of map, so it passed with 6 px of map on the phone (labs-m4). 844 stays for what it means,
// the whole screen: nothing else here reads it as what a visitor first sees.

/** What Safari shows of the page on an iPhone 14, its bars up: the phone project's viewport. */
const FIRST_SCREEN = { width: 390, height: 664 };

/** A visible element's top and bottom on the page, not the screen. */
const span = (locator: Locator) =>
  locator.evaluate((e) => {
    const r = e.getBoundingClientRect();
    return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY };
  });

const visibleMap = (page: Page) => page.locator('svg[data-rl-map]:visible');

test('an iPhone’s first screen, 390 by 664, holds the map switch and half the map, and no words over them', async ({
  page,
}) => {
  await page.setViewportSize(FIRST_SCREEN);
  await page.goto(ROUTE_LAB);
  await expect(visibleMap(page)).toHaveCount(1);
  const desk = await span(page.locator('#route-lab'));
  const view = await span(page.locator('.rl-view'));
  const map = await span(visibleMap(page));
  // The desk opens on the switch and the map, as the other labs' open on their picture: 21 px in.
  expect(view.top - desk.top).toBeLessThan(25);
  expect(view.bottom).toBeLessThanOrEqual(map.top);
  expect(view.bottom).toBeLessThanOrEqual(FIRST_SCREEN.height);
  expect(FIRST_SCREEN.height - map.top).toBeGreaterThanOrEqual((map.bottom - map.top) / 2);
  await expect(visibleMap(page)).toBeInViewport({ ratio: 0.5 });
  // The words come later, the room they hold empty with them: under the map and the controls.
  const figures = await span(page.locator('[data-rl-plan="after"] .rl-head'));
  const controls = await span(page.locator('.rl-controls'));
  const readout = await span(page.locator('.rl-readout'));
  expect(map.bottom).toBeLessThanOrEqual(figures.top);
  expect(figures.bottom).toBeLessThanOrEqual(controls.top);
  expect(controls.bottom).toBeLessThanOrEqual(readout.top);
});

test('on a phone’s whole screen, 390 by 844, the map switch, the map and the day and van controls fit together', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE_LAB);
  await expect(visibleMap(page)).toHaveCount(1);
  const view = await span(page.locator('.rl-view'));
  const map = await span(visibleMap(page));
  const days = await span(page.locator('.rl-days'));
  const more = await span(page.locator('.rl-more'));
  // Top to bottom: the switch, its map, then what changes it.
  expect(view.bottom).toBeLessThanOrEqual(map.top);
  expect(map.bottom).toBeLessThanOrEqual(days.top);
  expect(days.bottom).toBeLessThanOrEqual(more.top);
  expect(more.bottom - view.top).toBeLessThanOrEqual(844);
  // Scrolled there, every part is on screen at once.
  await page.evaluate((y) => window.scrollTo(0, y), view.top);
  for (const part of ['.rl-view', '.rl-days', '.rl-more']) {
    await expect(page.locator(part)).toBeInViewport({ ratio: 1 });
  }
  await expect(visibleMap(page)).toBeInViewport({ ratio: 1 });
});

test('without script the maps stack, each under its own figures, the first on the first screen', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: FIRST_SCREEN });
  const page = await context.newPage();
  await page.goto(ROUTE_LAB);
  const maps = await page.locator('svg[data-rl-map]').all();
  expect(maps).toHaveLength(2);
  for (const which of ['before', 'after']) {
    const figure = page.locator(`[data-rl-plan="${which}"]`);
    const head = await span(figure.locator('.rl-head'));
    const map = await span(figure.locator('svg[data-rl-map]'));
    expect(head.bottom).toBeLessThanOrEqual(map.top);
  }
  const first = await span(page.locator('[data-rl-plan="before"] svg[data-rl-map]'));
  expect(first.top).toBeLessThan(FIRST_SCREEN.height);
  await context.close();
});

test('on paper the headline leads, each map’s figures stand over it, and no van or control shows', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  await page.emulateMedia({ media: 'print' });
  const readout = await span(page.locator('.rl-readout'));
  const head = await span(page.locator('[data-rl-plan="before"] .rl-head'));
  const map = await span(page.locator('[data-rl-plan="before"] svg[data-rl-map]'));
  expect(readout.bottom).toBeLessThanOrEqual(head.top);
  expect(head.bottom).toBeLessThanOrEqual(map.top);
  const shown = await page.evaluate(() =>
    [
      ...document.querySelectorAll(
        '#route-lab [data-rl-drive], #route-lab [data-rl-fleet], #route-lab .rl-hint, #route-lab [data-rl-cube-controls], #route-lab .rl-controls',
      ),
    ]
      .filter((e) => e.checkVisibility())
      .map((e) => e.getAttribute('class')),
  );
  expect(shown).toEqual([]);
});

test('on a phone Tab meets the desk’s controls in the order the screen shows them', async ({
  page,
}) => {
  await page.setViewportSize(FIRST_SCREEN);
  await page.goto(ROUTE_LAB);
  await page.locator('input[name="rl-view"]:checked').focus();
  const tops: number[] = [];
  const names: string[] = [];
  for (let k = 0; k < 5; k++) {
    if (k > 0) await page.keyboard.press('Tab');
    const focused = page.locator(':focus');
    names.push(await focused.evaluate((e) => (e as HTMLInputElement).name || e.textContent || ''));
    // A radio is drawn as its chip, so the chip is where the screen shows it.
    tops.push(
      await focused.evaluate(
        (e) => (e.closest('label') ?? e).getBoundingClientRect().top + window.scrollY,
      ),
    );
  }
  expect(names.map((n) => n.trim())).toEqual([
    'rl-view',
    'Pause',
    'rl-day',
    'rl-vans',
    'Surprise me',
  ]);
  // Each is on the row of the one before, or under it.
  tops.forEach((top, k) => expect(top).toBeGreaterThanOrEqual(tops[k - 1] ?? top));
});

test('from 64rem the controls head the desk, over the readout and both maps', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await expect(page.locator('.rl-view')).toBeHidden();
  await expect(visibleMap(page)).toHaveCount(2);
  const controls = await span(page.locator('.rl-controls'));
  const readout = await span(page.locator('.rl-readout'));
  const map = await span(visibleMap(page).first());
  expect(controls.bottom).toBeLessThanOrEqual(readout.top);
  expect(readout.bottom).toBeLessThanOrEqual(map.top);
});

// What stands under the map holds still (design-system.md, "Motion"), since the controls that change
// the plan, and the list of places, stand there: from one plan's words to another's, from map to
// map, while VROOM has not answered, and with no orders. Each line keeps the room its longest words
// take at that width (route-lab.css), which is what the first screen's blank gap was for, before it
// moved under the map; and at 320 px the other map's figures took a line less than VROOM's, which
// moved everything under them by 22 px at a press of the switch.
for (const width of [320, 390, 480, 600, 768, 1440]) {
  test(`at ${width} px what stands under the map stays put, whatever the plan`, async ({
    page,
    context,
  }) => {
    test.setTimeout(90_000);
    // The worker's script is held back until the first change has been read, so VROOM's plan is for
    // the previous orders for as long as that takes.
    let hold = true;
    await context.route(`**${SOLVER}vroom-worker.mjs`, async (route) => {
      while (hold) await new Promise((resolve) => setTimeout(resolve, 50));
      await route.continue();
    });
    await page.setViewportSize({ width, height: 800 });
    await page.goto(ROUTE_LAB);
    const after = page.locator('[data-rl-plan="after"]');
    const tops = () =>
      page.evaluate(() =>
        [
          'svg[data-rl-map]',
          '.rl-controls',
          '.rl-legend',
          '[data-rl-cube-stage]',
          '.rl-orders',
        ].map((part) => {
          const shown = [...document.querySelectorAll(part)].find((e) => e.checkVisibility());
          return Math.round((shown?.getBoundingClientRect().top ?? 0) + scrollY);
        }),
      );
    const opening = await tops();
    const steady = async (what: string) => expect(await tops(), what).toEqual(opening);
    const press = (selector: string) =>
      page.locator(selector).evaluate((input: HTMLInputElement) => input.click());
    const answered = async () => {
      await expect(after).not.toHaveAttribute('data-rl-stale', '', { timeout: 30_000 });
      // The cube's words follow on the next frame.
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => done(null))));
    };

    await press('input[name="rl-vans"][value="2"]');
    await expect(after).toHaveAttribute('data-rl-stale', '');
    await expect(after.locator('[data-rl-note]')).toBeVisible();
    await steady('VROOM’s plan for the previous orders');
    hold = false;
    for (const day of ['quiet', 'busy', 'libraries', 'lake', 'everything']) {
      await press(`input[name="rl-day"][value="${day}"]`);
      await answered();
      await steady(day);
      if (width < 1024) {
        await press('input[name="rl-view"][value="before"]');
        await steady(`${day}, the other map`);
        await press('input[name="rl-view"][value="after"]');
      }
    }
    // The longest figures the page writes: every order on one van.
    await press('input[name="rl-vans"][value="1"]');
    await answered();
    await steady('every order on one van');
    if (width < 1024) {
      await press('input[name="rl-view"][value="before"]');
      await steady('every order on one van, the other map');
    }
    await page.evaluate(() => {
      for (const box of document.querySelectorAll<HTMLInputElement>(
        'input[name="rl-order"]:checked',
      ))
        box.click();
    });
    await expect(page.locator('[data-rl-saved]')).toHaveText(
      'Add at least one order to plan a route.',
    );
    await answered();
    await steady('no orders');
    await press('input[name="rl-order"][value="3"]');
    await expect(page.locator('[data-rl-saved]')).toHaveText(
      'With one order, both plans are the same route.',
      { timeout: 30_000 },
    );
    await answered();
    await steady('one order');
  });
}

// The maps' names over their routes and stops (review RTE-2): words are drawn over pictures, never
// under, and each name keeps off the stops (lib/route-lab/labels.ts), so neither hides the other.
// The few that cannot at a phone's size, in the city's dense middle and its small lakes, graze a
// stop's edge rather than cover it.

/** How much of each stop's mark a name covers on the maps on show, where it covers any: a copy of
 *  each name is laid in the map for its box, as the page draws it, and taken out again. A name's
 *  ink rises 0.78 of its size over its baseline and drops 0.22 under. */
const namesOverStops = (page: Page) =>
  page.evaluate(() => {
    const found: { name: string; covers: number }[] = [];
    for (const map of document.querySelectorAll<SVGSVGElement>('svg[data-rl-map]')) {
      const width = map.getBoundingClientRect().width;
      if (width === 0) continue;
      const units = map.viewBox.baseVal.width / width;
      const marks: { x: number; y: number; half: number }[] = [];
      for (const casing of map.querySelectorAll('[data-rl-places] .rl-stop-casing')) {
        const half = (parseFloat(getComputedStyle(casing).strokeWidth) / 2) * units;
        for (const [, x, y] of (casing.getAttribute('d') ?? '').matchAll(/M(-?[\d.]+) (-?[\d.]+)/g))
          marks.push({ x: Number(x), y: Number(y), half });
      }
      const layer = document.createElementNS('http://www.w3.org/2000/svg', 'g');
      map.append(layer);
      for (const text of document.querySelectorAll('#rl-labels text, #rl-top text')) {
        const copy = layer.appendChild(text.cloneNode(true) as SVGTextElement);
        if (getComputedStyle(copy).display === 'none') continue;
        const box = copy.getBBox();
        const size = parseFloat(getComputedStyle(copy).fontSize);
        const base = Number(copy.getAttribute('y'));
        const [left, right, top, bottom] = [
          box.x,
          box.x + box.width,
          base - 0.78 * size,
          base + 0.22 * size,
        ];
        for (const m of marks) {
          const w = Math.min(right, m.x + m.half) - Math.max(left, m.x - m.half);
          const h = Math.min(bottom, m.y + m.half) - Math.max(top, m.y - m.half);
          if (w > 0 && h > 0)
            found.push({
              name: copy.textContent?.trim() ?? '',
              covers: (w * h) / (4 * m.half * m.half),
            });
        }
      }
      layer.remove();
    }
    return found;
  });

test('each map draws its names over its routes and stops, the bakery’s and the tip’s last', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  for (const map of await page.locator('svg[data-rl-map]').all()) {
    const layers = await map.evaluate((svg) =>
      [...svg.children].map(
        (e) =>
          e.getAttribute('href') ??
          (e.hasAttribute('data-rl-routes')
            ? 'routes'
            : e.hasAttribute('data-rl-places')
              ? 'places'
              : (e.getAttribute('class') ?? e.tagName)),
      ),
    );
    expect(layers.slice(1)).toEqual([
      '#rl-base',
      'routes',
      'places',
      '#rl-labels',
      '#rl-top',
      'rl-tip',
    ]);
  }
});

test('on a laptop no name covers a stop on the opening day', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await page.evaluate(() => document.fonts.ready);
  expect(await namesOverStops(page)).toEqual([]);
});

test('on a phone, on every day, a name covers at most a third of any stop’s mark', async ({
  page,
}) => {
  test.setTimeout(60_000);
  await page.setViewportSize(FIRST_SCREEN);
  await page.goto(ROUTE_LAB);
  await page.evaluate(() => document.fonts.ready);
  for (const day of await page.locator('input[name="rl-day"]').all()) {
    // VROOM's plan for this day is on show once the map's name counts its orders as the same.
    const note = await day.locator('xpath=..').locator('.rl-chip-note').textContent();
    const orders = /(\d+) orders?/.exec(note ?? '')?.[1];
    await day.check();
    await expect(page.locator('#rl-after-title')).toContainText(`the same ${orders} order`, {
      timeout: 20_000,
    });
    for (const view of ['after', 'before']) {
      await page.locator(`input[name="rl-view"][value="${view}"]`).check({ force: true });
      for (const { name, covers } of await namesOverStops(page))
        expect(covers, `${await day.inputValue()}, ${view}: ${name}`).toBeLessThanOrEqual(1 / 3);
    }
  }
});

// Van A is the Route Lab's own van (review RTE-3): its route, on the maps, in the key and in the
// cube's pictures, is the lab's line colour in both themes, on a casing in the desk's colour, which
// is what gives the day's dark yellow its 3:1 against the bands.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`van A’s route is the Routes line’s colour, on its casing, ${colorScheme}`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(ROUTE_LAB);
    const colours = await page.evaluate(() => {
      const probe = document.createElement('i');
      document.getElementById('route-lab')?.append(probe);
      const resolve = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      const [line, desk] = [resolve('--line-routes'), resolve('--surface-1')];
      probe.remove();
      const strokes = (selector: string) => [
        ...new Set(
          [...document.querySelectorAll(`#route-lab ${selector}`)].map(
            (e) => getComputedStyle(e).stroke,
          ),
        ),
      ];
      return {
        line,
        desk,
        routes: strokes('.rl-route.van-a'),
        casings: strokes('.rl-route-casing'),
        count: document.querySelectorAll('#route-lab .rl-route.van-a').length,
        cased: document.querySelectorAll('#route-lab .rl-route-casing + .rl-route.van-a').length,
      };
    });
    // Two maps, two cube pictures and the key.
    expect(colours.count).toBe(5);
    expect(colours.cased).toBe(5);
    expect(colours.routes).toEqual([colours.line]);
    expect(colours.casings).toEqual([colours.desk]);
  });
}
