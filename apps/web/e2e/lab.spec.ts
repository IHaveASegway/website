import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { ROUTE_LAB, SOLVER, SOLVER_POLICY } from './expected';
import { fallbacksOn } from './fonts-drawn';

// The Route Lab in a browser (ADR 0016): VROOM, compiled to WebAssembly, plans a day in a module
// Web Worker under the worker's own policy, with no violation on the page or in the worker; every
// change plans again, by itself, and says what it did and what VROOM saved; a tap on the map
// changes the orders; nothing loads until a visitor shows intent, and the solver only once there
// is something to plan; without JavaScript the page is the plan worked out at build; and after a
// solve the page still meets axe, the motion rules and the glyph check, since script wrote its
// tables. The figures are VROOM's own answers for the data in tools/route-data/out/.

const NBSP = ' ';
const WCAG = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const FAILED =
  'This browser could not run the solver. VROOM’s plan on the map is the last one it made.';
const PLANNED = /Planned in (\d+\u00a0ms|\d+\.\d\d\u00a0s), in this browser\./;

/** Collects CSP violations from the page's event, and CSP messages from the page's and its
 *  workers' consoles. */
async function watch(page: Page): Promise<() => Promise<string[]>> {
  const messages: string[] = [];
  const csp = (text: string) => /content security policy/i.test(text) && messages.push(text);
  page.on('console', (m) => csp(m.text()));
  page.on('worker', (worker) => worker.on('console', (m) => csp(`worker: ${m.text()}`)));
  await page.addInitScript(() => {
    const seen: string[] = [];
    Object.defineProperty(window, '__cspViolations', { value: seen });
    document.addEventListener('securitypolicyviolation', (event) => {
      seen.push(`${event.effectiveDirective} blocked ${event.blockedURI || 'inline'}`);
    });
  });
  return async () => {
    await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 50)));
    const events = await page.evaluate(
      () => (window as unknown as { __cspViolations: string[] }).__cspViolations,
    );
    return [...events, ...messages];
  };
}

const status = (page: Page) => page.locator('[data-rl-status]');
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const said = (page: Page) => page.locator('[data-rl-say]');

/** Loads a day by its radio, which plans it, then waits for VROOM's answer to that day. */
async function plan(page: Page, day: string): Promise<void> {
  await page.check(`input[name="rl-day"][value="${day}"]`);
  await expect(status(page)).toHaveText(PLANNED, { timeout: 20_000 });
  await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale');
}

test('VROOM plans every order at once in a module worker, with no policy violation anywhere', async ({
  page,
  baseURL,
}) => {
  const violations = await watch(page);
  const offOrigin: string[] = [];
  page.on('request', (request) => {
    const url = request.url();
    if (/^https?:/.test(url) && new URL(url).origin !== new URL(baseURL ?? '').origin)
      offOrigin.push(url);
  });
  const solverFiles: string[] = [];
  page.on(
    'response',
    (r) => r.url().includes(SOLVER) && solverFiles.push(new URL(r.url()).pathname),
  );
  await page.goto(ROUTE_LAB);
  await plan(page, 'everything');
  await expect(status(page)).toHaveText(
    /^Every order at once: 63 orders, 4 vans\. Planned in .* VROOM needed 3 of your 4 vans\.$/,
  );
  const saved = `VROOM saves 13${NBSP}h 27${NBSP}min of driving, 66% less, and 419.6${NBSP}mi.`;
  await expect(page.locator('[data-rl-saved]')).toHaveText(saved);
  // Assistive technology hears the change, what VROOM saved, when the last vans are back, and the
  // solve: the one status region says it all at once.
  const back = `The last van is back after 6${NBSP}h 20${NBSP}min as the orders came in, and after 3${NBSP}h 27${NBSP}min with VROOM.`;
  await expect(said(page)).toHaveText(
    new RegExp(
      `^Every order at once: 63 orders, 4 vans\\. ${escape(saved)} ${escape(back)} Planned in `,
    ),
  );
  await expect(page.locator('[data-rl-say]')).toHaveAttribute('role', 'status');
  const after = page.locator('[data-rl-plan="after"]');
  await expect(after.locator('[data-rl-time]')).toHaveText(`6${NBSP}h 51${NBSP}min`);
  await expect(after.locator('[data-rl-line]')).toHaveText(`147.1${NBSP}mi, 3 vans`);
  await expect(after.locator('.rl-route')).toHaveCount(3);
  await expect(page.locator('[data-rl-plan="before"] .rl-route')).toHaveCount(4);
  await expect(after).not.toHaveAttribute('data-rl-stale');
  await expect(page.locator('[data-rl-table="after"] tbody tr')).toHaveCount(63 + 4);
  expect(await violations()).toEqual([]);
  expect(offOrigin).toEqual([]);
  expect(solverFiles.map((p) => p.slice(SOLVER.length)).sort()).toEqual([
    'vroom-solver.mjs',
    'vroom-worker.mjs',
    'vroom.mjs',
    'vroom.wasm',
  ]);
});

test('a tap on a map orders from that place, and both plans follow by themselves', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  const map = page.locator('[data-rl-plan="after"] svg[data-rl-map]');
  const box = await map.boundingBox();
  const scale = (box?.width ?? 0) / 2000;
  // Discovery Park, place 3, at (143, 786) in the map's units: not on a busy Saturday.
  await map.click({ position: { x: 143 * scale + 1, y: 786 * scale + 1 } });
  await expect(page.locator('input[name="rl-order"][value="3"]')).toBeChecked();
  await expect(page.locator('input[name="rl-day"]:checked')).toHaveCount(0);
  await expect(status(page)).toHaveText(
    /^Added Discovery Park: Trail mix cookies, 3 dozen\. Planned in /,
    { timeout: 20_000 },
  );
  await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale');
  await expect(page.locator('[data-rl-saved]')).toHaveText(/^VROOM saves /);
  // The new stop is on VROOM's map too: 21 numbered stops on each.
  for (const which of ['before', 'after'])
    await expect(page.locator(`[data-rl-plan="${which}"] .rl-num`)).toHaveCount(21);
});

test('the keyboard reaches every order through the list of places', async ({ page }) => {
  await page.goto(ROUTE_LAB);
  await page.locator('.rl-orders summary').focus();
  await page.keyboard.press('Enter');
  const box = page.locator('input[name="rl-order"][value="3"]');
  await box.focus();
  await page.keyboard.press('Space');
  await expect(box).toBeChecked();
  await expect(said(page)).toHaveText(/^Added Discovery Park: .* VROOM saves .* Planned in /, {
    timeout: 20_000,
  });
});

test('nothing loads until a visitor shows intent, and the solver only once there is something to plan', async ({
  page,
}) => {
  const asked: string[] = [];
  page.on('request', (r) => asked.push(new URL(r.url()).pathname));
  const app = () => asked.filter((p) => /\/_astro\/app\.|route-data/.test(p));
  const solver = () => asked.filter((p) => p.startsWith(SOLVER));
  await page.goto(ROUTE_LAB);
  // A finger that only scrolls the page: no app, no data, no solver.
  const map = page.locator('[data-rl-plan="after"] svg[data-rl-map]');
  for (const type of ['pointerover', 'pointerdown', 'pointerup'])
    await map.dispatchEvent(type, { pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(300);
  expect([app(), solver()]).toEqual([[], []]);
  // A mouse over the demo: the app and the route data, still no solver.
  await map.hover({ position: { x: 20, y: 20 } });
  await expect.poll(() => app().length).toBe(2);
  expect(solver()).toEqual([]);
  // A change: the solver's files, and VROOM's answer.
  await page.check('input[name="rl-vans"][value="2"]');
  await expect(status(page)).toHaveText(PLANNED, { timeout: 20_000 });
  expect(solver().length).toBeGreaterThan(0);
});

test('changes made while VROOM plans are planned once it answers, as one', async ({ page }) => {
  await page.addInitScript(() => {
    // Counts every message the page sends a worker: one per solve.
    const post = Worker.prototype.postMessage as (this: Worker, ...args: unknown[]) => void;
    Object.defineProperty(window, '__solves', { value: [], writable: false });
    Object.defineProperty(Worker.prototype, 'postMessage', {
      value(this: Worker, ...args: unknown[]) {
        (window as unknown as { __solves: number[] }).__solves.push(Date.now());
        post.apply(this, args);
      },
    });
  });
  await page.goto(ROUTE_LAB);
  await plan(page, 'everything');
  const solves = () =>
    page.evaluate(() => (window as unknown as { __solves: number[] }).__solves.length);
  const before = await solves();
  // The first change, and once VROOM is planning it, nine more, 20 ms apart, made by the page
  // itself, as quick hands make them. Playwright's own actions can each take longer than the 150 ms
  // settle time on a loaded machine, so ten of them measured the runner's pace, not the page's:
  // two runs in sixteen failed that way under four workers on feat/route-lab (a1fac9a).
  await page.check('input[name="rl-vans"][value="1"]');
  await expect.poll(solves).toBe(before + 1);
  await page.evaluate(async () => {
    for (let k = 1; k < 10; k++) {
      document
        .querySelector<HTMLInputElement>(`input[name="rl-vans"][value="${(k % 4) + 1}"]`)
        ?.click();
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  });
  await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale', {
    timeout: 30_000,
  });
  await expect(status(page)).toHaveText(/^2 vans\./);
  await expect(page.locator('[data-rl-saved]')).toHaveText(/^VROOM saves /);
  // Ten changes, at most three solves: one in flight when they start, and one for where they end.
  expect((await solves()) - before).toBeLessThanOrEqual(3);
});

test('on a phone one map shows at a time, and a tap on VROOM’s map plans it there', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(ROUTE_LAB);
  const before = page.locator('[data-rl-plan="before"]');
  const after = page.locator('[data-rl-plan="after"]');
  await expect(after).toBeVisible();
  await expect(before).toBeHidden();
  await page.check('input[name="rl-view"][value="before"]');
  await expect(before).toBeVisible();
  await expect(after).toBeHidden();
  await page.check('input[name="rl-view"][value="after"]');
  const map = after.locator('svg[data-rl-map]');
  const box = await map.boundingBox();
  const scale = (box?.width ?? 0) / 2000;
  await map.click({ position: { x: 143 * scale + 1, y: 786 * scale + 1 } });
  await expect(status(page)).toHaveText(/^Added Discovery Park: .* Planned in /, {
    timeout: 20_000,
  });
  await expect(after.locator('.rl-num')).toHaveCount(21);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
});

test('a mouse over a place shows its name, its order and its stop', async ({ page }) => {
  await page.goto(ROUTE_LAB);
  const map = page.locator('[data-rl-plan="after"] svg[data-rl-map]');
  await map.scrollIntoViewIfNeeded();
  const box = await map.boundingBox();
  const scale = (box?.width ?? 0) / 2000;
  // Kerry Park, place 2, at (572, 1119): a stop on a busy Saturday. The first mouse over the demo
  // loads the app, so the mouse moves again until the tip answers, as a hand on a mouse does.
  const tip = page.locator('[data-rl-plan="after"] [data-rl-tip]');
  await expect(async () => {
    for (const nudge of [0, 1]) {
      await map.hover({ position: { x: 572 * scale + nudge, y: 1119 * scale } });
    }
    await expect(tip).toHaveAttribute('data-rl-show', '', { timeout: 500 });
  }).toPass({ timeout: 15_000 });
  await expect(tip).toHaveText(/^Kerry Park12 croissants with a view, 1 boxVan [A-C], stop \d+, /);
  await expect(map).toHaveAttribute('data-rl-near', '');
  await map.hover({ position: { x: 5, y: 5 } });
  await expect(tip).not.toHaveAttribute('data-rl-show');
});

test('without JavaScript the page is both plans, worked out at build, and no control shows', async ({
  browser,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(ROUTE_LAB);
  await expect(page.locator('svg.rl-map')).toHaveCount(2);
  for (const which of ['before', 'after']) {
    const figure = page.locator(`[data-rl-plan="${which}"]`);
    await expect(figure.locator('.rl-route')).toHaveCount(3);
    await expect(figure.locator('svg[data-rl-map]')).toBeVisible();
  }
  await expect(page.locator('[data-rl-plan="before"] [data-rl-time]')).toHaveText(
    `5${NBSP}h 34${NBSP}min`,
  );
  await expect(page.locator('[data-rl-plan="after"] [data-rl-time]')).toHaveText(
    `3${NBSP}h 12${NBSP}min`,
  );
  await expect(page.locator('[data-rl-saved]')).toHaveText(
    `VROOM saves 2${NBSP}h 22${NBSP}min of driving, 43% less, and 74.0${NBSP}mi.`,
  );
  await expect(page.locator('.rl-caption')).toBeVisible();
  await expect(page.locator('.rl-table')).toHaveCount(2);
  // Both maps show, stacked, whatever the width: the choice of one is a control, and hidden.
  await page.setViewportSize({ width: 390, height: 844 });
  for (const which of ['before', 'after'])
    await expect(page.locator(`[data-rl-plan="${which}"]`)).toBeVisible();
  for (const part of await page.locator('[data-rl-js]').all()) await expect(part).toBeHidden();
  const controls = await page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLElement>('#route-lab input, #route-lab button')].filter(
        (e) => e.checkVisibility(),
      ).length,
  );
  expect(controls).toBe(0);
  // axe runs as a script, so it cannot run here; a11y.spec.ts runs it on this page as served.
  await context.close();
});

for (const colorScheme of ['dark', 'light'] as const) {
  test(`axe finds no violation after a solve, ${colorScheme}, and every glyph is self-hosted`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme });
    await page.goto(ROUTE_LAB);
    await plan(page, 'lake');
    await page.locator('.rl-orders summary').click();
    const results = await new AxeBuilder({ page }).withTags(WCAG).analyze();
    expect(results.violations).toEqual([]);
    const { fallbacks, painted } = await fallbacksOn(page);
    expect(painted).toBeGreaterThan(50);
    expect(fallbacks).toEqual([]);
  });
}

/** Every element that would move: a transition longer than 0s, or an animation. */
const moving = (page: Page) =>
  page.evaluate(() => {
    const found: string[] = [];
    // The demo's own: the field behind the page has its own check (e2e/motion.spec.ts).
    for (const element of document.querySelectorAll('#route-lab *')) {
      for (const pseudo of [null, '::before', '::after']) {
        const style = getComputedStyle(element, pseudo);
        const moves =
          style.transitionDuration.split(',').some((d) => parseFloat(d) > 0) ||
          style.animationName.split(',').some((n) => n.trim() !== 'none');
        const name = element.getAttribute('class')?.split(' ')[0];
        if (moves)
          found.push(`${element.tagName.toLowerCase()}${name ? `.${name}` : ''}${pseudo ?? ''}`);
      }
    }
    return found;
  });

test('under reduce nothing moves before or after a solve; with no preference only the maps fade', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(ROUTE_LAB);
  expect(await moving(page)).toEqual([]);
  await plan(page, 'libraries');
  expect(await moving(page)).toEqual([]);
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  // The known answer: with no preference, the same scan finds the one motion the page has, an
  // opacity fade on each map as its plan changes, and nothing else.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto(ROUTE_LAB);
  await plan(page, 'quiet');
  expect(await moving(page)).toEqual(['svg.rl-map', 'svg.rl-map']);
  expect(
    await page.evaluate(
      () => getComputedStyle(document.querySelector('svg.rl-map') as Element).transitionProperty,
    ),
  ).toBe('opacity');
});

// The known answer for the worker's policy: served without 'wasm-unsafe-eval', the worker cannot
// compile the solver, and the page says so and keeps the plan worked out in advance. So the solve
// above passes because the header allows WebAssembly, and only there.
test('known answer: a worker whose policy refuses WebAssembly fails, and the page says so', async ({
  page,
  context,
}) => {
  await context.route(`**${SOLVER}vroom-worker.mjs`, async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: {
        ...response.headers(),
        'content-security-policy': SOLVER_POLICY.replace(" 'wasm-unsafe-eval'", ''),
      },
    });
  });
  const errors: string[] = [];
  page.on('worker', (worker) => worker.on('console', (m) => errors.push(m.text())));
  await page.goto(ROUTE_LAB);
  await page.check('input[name="rl-vans"][value="2"]');
  await expect(status(page)).toHaveText(`2 vans. ${FAILED}`, { timeout: 20_000 });
  const after = page.locator('[data-rl-plan="after"]');
  await expect(after.locator('[data-rl-time]')).toHaveText(`3${NBSP}h 12${NBSP}min`);
  // The plan on show is for the previous orders, and every part of the page says so.
  await expect(after).toHaveAttribute('data-rl-stale', '');
  await expect(after.locator('title')).toHaveText(/^Map of the bakery and the previous 20 orders/);
  await expect(page.locator('[data-rl-saved]')).toHaveText(
    'VROOM’s plan on the map is for the previous orders.',
  );
  expect(errors.join('\n')).toMatch(/WebAssembly|wasm-unsafe-eval|Content Security Policy/i);
});

// Forced colors: the maps keep their colors, as an image does, and so does their key, or the
// six band swatches would all be the page's own color (a11y review, 2026-10-25).
// Two small states the controls and the header keep: another number of vans lets go of the day's
// chip, so choosing the day again sets it back; and the header marks Lab on a page inside it.
test('another number of vans lets go of the day, and the header marks the Lab section', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  await expect(page.locator('.site-nav a[href="/lab/"]')).toHaveAttribute('aria-current', 'true');
  await plan(page, 'quiet');
  await page.check('input[name="rl-vans"][value="3"]');
  await expect(page.locator('input[name="rl-day"]:checked')).toHaveCount(0);
  // Choosing the day again sets its vans back. If VROOM's plan for that day is still the one on
  // show, the page says the day and plans nothing, so this waits for the controls, not an answer.
  await page.check('input[name="rl-day"][value="quiet"]');
  await expect(page.locator('input[name="rl-vans"][value="1"]')).toBeChecked();
  await expect(status(page)).toContainText('A quiet Tuesday: 8 orders, 1 van.');
});

// The controls are the panel's push-buttons (ADR 0025): a chosen day or number of vans shows a lit
// lamp before its words, its radio drawn as the lamp, and every other choice a hollow one; the
// chosen button is pressed in, raised, and no choice is filled with a colour or edged in another.
test('a chosen day or number of vans is a lit lamp, the others hollow, and no colour fills a button', async ({
  page,
}) => {
  await page.goto(ROUTE_LAB);
  const chips = () =>
    page.evaluate(() =>
      [...document.querySelectorAll<HTMLInputElement>('.rl-controls .rl-chip input')].map(
        (input) => {
          const lamp = getComputedStyle(input);
          const chip = getComputedStyle(input.closest('.rl-chip') as Element);
          return {
            value: `${input.name}=${input.value}`,
            checked: input.checked,
            size: [lamp.width, lamp.height, lamp.borderRadius],
            lamp: lamp.backgroundColor,
            edge: chip.borderTopColor,
            chip: chip.backgroundColor,
          };
        },
      ),
    );
  // A token as the page resolves it, read from a probe.
  const token = (name: string) =>
    page.evaluate((property) => {
      const probe = document.createElement('span');
      probe.style.setProperty('background-color', `var(${property})`);
      document.body.append(probe);
      const colour = getComputedStyle(probe).backgroundColor;
      probe.remove();
      return colour;
    }, name);
  const primary = await token('--primary');
  const raised = await token('--surface-2');
  expect(raised).not.toBe(primary);
  const check = async (chosen: string[]) => {
    const all = await chips();
    expect(all.filter((c) => c.checked).map((c) => c.value)).toEqual(chosen);
    for (const c of all) {
      expect(c.size, c.value).toEqual(['10px', '10px', '50%']);
      expect(c.lamp, c.value).toBe(c.checked ? primary : 'rgba(0, 0, 0, 0)');
      // No colour fills a button: the pressed one is raised, the others stand on the desk.
      expect(c.chip, c.value).toBe(c.checked ? raised : 'rgba(0, 0, 0, 0)');
    }
    // One edge for every button.
    expect(new Set(all.map((c) => c.edge)).size).toBe(1);
  };
  await check(['rl-day=busy', 'rl-vans=3']);
  // Another number of vans lets go of the day, once the app has the press.
  await page.check('input[name="rl-vans"][value="2"]');
  await expect(page.locator('input[name="rl-day"]:checked')).toHaveCount(0);
  await page.mouse.move(0, 0);
  await check(['rl-vans=2']);
});

// The readout holds its height (route-lab.css) before the first change and for each answer in a
// run of changes, so VROOM's answer never moves the maps: from 64rem, where it stands over them,
// the room line and the status line keep a line each. Below that it stands under the controls, and
// e2e/routes-layout.spec.ts holds what stands under it. Before 2026-10-25 the status line grew from
// nothing on the first change, and on a phone both took one line or more by the day, so the maps
// moved by 22 px or 44 px on most changes.
for (const width of [390, 1440]) {
  test(`at ${width} px the maps stay put from answer to answer`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(ROUTE_LAB);
    const top = () =>
      page.evaluate(() => {
        const shown = [...document.querySelectorAll('[data-rl-plan]')].find((map) =>
          map.checkVisibility(),
        );
        return (shown?.getBoundingClientRect().top ?? 0) + window.scrollY;
      });
    const tops = [await top()];
    for (const day of ['quiet', 'busy', 'everything']) {
      await plan(page, day);
      tops.push(await top());
    }
    await page.check('input[name="rl-vans"][value="2"]');
    await expect(status(page)).toHaveText(/^2 vans\. Planned in /, { timeout: 20_000 });
    tops.push(await top());
    await plan(page, 'quiet');
    tops.push(await top());
    // Discovery Park, from the list of places, which is folded away.
    await page
      .locator('input[name="rl-order"][value="3"]')
      .evaluate((box: HTMLInputElement) => box.click());
    await expect(status(page)).toHaveText(/^Added Discovery Park: .* Planned in /, {
      timeout: 20_000,
    });
    tops.push(await top());
    expect(new Set(tops).size, tops.join(', ')).toBe(1);
  });
}

// The first change of all: the app arrives with a day's chip already chosen and the opening day's
// places still ticked. Until 2026-11-02 the headline worked out a saving from those, one no plan on
// the page had, "VROOM saves 2 h 14 min of driving", and kept it until the solver had loaded.
test('while the first solve loads, the headline keeps what it said, until VROOM answers', async ({
  page,
  context,
}) => {
  let hold = true;
  await context.route(`**${SOLVER}vroom-worker.mjs`, async (route) => {
    while (hold) await new Promise((resolve) => setTimeout(resolve, 50));
    await route.continue();
  });
  await page.goto(ROUTE_LAB);
  const saved = page.locator('[data-rl-saved]');
  const opening = `VROOM saves 2${NBSP}h 22${NBSP}min of driving, 43% less, and 74.0${NBSP}mi.`;
  await expect(saved).toHaveText(opening);
  await page
    .locator('input[name="rl-day"][value="quiet"]')
    .evaluate((radio: HTMLInputElement) => radio.click());
  // The app is here and VROOM hasn't answered. Both figures and the headline still agree, on the plan
  // they were for, so a reader who checks the sum finds it right: until 2026-11-03 the plan as dealt
  // changed at once, and the headline stood beside figures it didn't add up to.
  const dealtTime = page.locator('[data-rl-plan="before"] [data-rl-time]');
  const solvedTime = page.locator('[data-rl-plan="after"] [data-rl-time]');
  await expect(page.locator('[data-rl-readout]')).toHaveAttribute('data-rl-stale', '');
  await expect(page.locator('[data-rl-status]')).toContainText('Loading the solver');
  await expect(dealtTime).toHaveText(`5${NBSP}h 34${NBSP}min`);
  await expect(solvedTime).toHaveText(`3${NBSP}h 12${NBSP}min`);
  await expect(saved).toHaveText(opening);
  hold = false;
  // All three change together.
  await expect(saved).toHaveText(
    `VROOM saves 52${NBSP}min of driving, 27% less, and 32.1${NBSP}mi.`,
    { timeout: 20_000 },
  );
  await expect(dealtTime).toHaveText(`3${NBSP}h 16${NBSP}min`);
  await expect(page.locator('[data-rl-readout]')).not.toHaveAttribute('data-rl-stale', '');
});

// A stop clicked away kept its order in the tip until the mouse moved, beside a line that said it was
// removed. Until 2026-11-03.
test('a stop clicked away says so in its tip, with the mouse still on it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(ROUTE_LAB);
  await page.locator('.rl-controls').hover();
  const map = page.locator('[data-rl-plan="after"] svg[data-rl-map]');
  await expect(status(page)).toHaveText('', { timeout: 20_000 });
  // A stop the day has an order for, where the map draws it.
  const at = await page
    .locator('input[name="rl-order"]:checked')
    .first()
    .evaluate((box) => {
      const { x, y } = (box as HTMLInputElement).dataset;
      const svg = document.querySelector(
        '[data-rl-plan="after"] svg[data-rl-map]',
      ) as SVGSVGElement;
      const point = new DOMPoint(Number(x), Number(y)).matrixTransform(
        svg.getScreenCTM() as DOMMatrix,
      );
      return { x: point.x, y: point.y };
    });
  await page.evaluate((y) => scrollTo(0, y), at.y - 300);
  const scrolled = await page.evaluate(() => scrollY);
  await page.mouse.move(at.x, at.y - scrolled);
  const tip = map.locator('[data-rl-tip] text');
  await expect(tip).not.toContainText('No order today');
  await page.mouse.down();
  await page.mouse.up();
  await expect(status(page)).toContainText(/^Removed /, { timeout: 20_000 });
  await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale', '', {
    timeout: 20_000,
  });
  await expect(tip).toContainText('No order today');
});

// Nothing moves when the boot module arrives: CSS shows the controls from the first paint wherever
// script runs (route-lab.css, the scripting media feature). On a phone on a slow network the module
// used to reveal them after the page had painted, a layout shift of 0.16 against a limit of 0.1.
test('on a slow phone the page does not shift when the demo’s script arrives', async ({
  browser,
}) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const devtools = await context.newCDPSession(page);
  await devtools.send('Network.enable');
  await devtools.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: 150,
    downloadThroughput: 1.6e6 / 8,
    uploadThroughput: 750e3 / 8,
  });
  await page.addInitScript(() => {
    const shifts = { total: 0 };
    Object.defineProperty(window, '__shifts', { value: shifts });
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as (PerformanceEntry & {
        value: number;
        hadRecentInput: boolean;
      })[])
        if (!entry.hadRecentInput) shifts.total += entry.value;
    }).observe({ type: 'layout-shift', buffered: true });
  });
  await page.goto(ROUTE_LAB, { waitUntil: 'load' });
  await expect(page.locator('.rl-controls')).toBeVisible();
  await page.waitForTimeout(1_000);
  const total = await page.evaluate(
    () => (window as unknown as { __shifts: { total: number } }).__shifts.total,
  );
  expect(total).toBeLessThan(0.05);
  await context.close();
});

// A load that fails says so (boot.ts, lib/lab/unloaded.ts): the route data's request is dropped once,
// the page says the lab did not load and leaves the maps on the day it opened with, and the next
// change fetches a fresh page, which loads and plans. Importing the file again can't work in WebKit
// (steady.spec.ts), and a deploy's new files have other names, so a retry on the page can't either.
test('a lab that failed to load says so, and the next change brings a fresh page that plans', async ({
  page,
  context,
}) => {
  let dropped = 0;
  await context.route('**/route-data*.json', (route) =>
    dropped++ === 0 ? route.abort() : route.continue(),
  );
  await page.goto(ROUTE_LAB);
  await page.check('input[name="rl-day"][value="quiet"]');
  await expect(status(page)).toHaveText('The lab did not load. Press any control to try again.');
  await expect(status(page)).toBeVisible();
  await expect(page.locator('[data-rl-say]')).toHaveText(
    'The lab did not load. Press any control to try again.',
  );
  await expect(page.locator('[data-rl-time]').first()).toHaveText(/^\d/);
  const loaded = page.waitForEvent('load');
  await page.locator('[data-rl-surprise]').click();
  await loaded;
  await expect(status(page)).toHaveText('');
  await page.check('input[name="rl-vans"][value="2"]');
  await expect(status(page)).toHaveText(PLANNED, { timeout: 20_000 });
  await expect(status(page)).toContainText('2 vans.');
  await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale');
});

// With no connection yet a fresh page can't come, so the page stays and says so again.
test('with no connection yet the Route Lab stays, and says so again', async ({ page }) => {
  await page.route('**/_astro/app.*.js', (route) => route.abort());
  await page.goto(ROUTE_LAB);
  await page.locator('[data-rl-surprise]').click();
  const words = 'The lab did not load. Press any control to try again.';
  await expect(status(page)).toHaveText(words);
  await page.route(ROUTE_LAB, (route) => route.abort());
  await page.evaluate(() => {
    (window as unknown as { stayed: boolean }).stayed = true;
    document.querySelector('[data-rl-status]')?.replaceChildren();
  });
  await page.locator('[data-rl-surprise]').click();
  await expect(status(page)).toHaveText(words);
  expect(await page.evaluate(() => (window as unknown as { stayed: boolean }).stayed)).toBe(true);
});

// A solve that runs out of time is not a broken solver (app.ts): the worker's script never
// arrives, the first solve's 60 s pass on the page's clock, the page says so, and the next change
// starts a new worker that plans. Before 2026-10-25 the first limit was 15 s with the download in
// it, and running out left the solver off for good.
test('a solver that does not answer in time is tried again on the next change', async ({
  page,
  context,
}) => {
  let hold = true;
  await context.route(`**${SOLVER}vroom-worker.mjs`, async (route) => {
    while (hold) await new Promise((resolve) => setTimeout(resolve, 100));
    await route.continue();
  });
  await page.clock.install();
  await page.goto(ROUTE_LAB);
  await page.check('input[name="rl-vans"][value="2"]');
  await expect(status(page)).toHaveText('2 vans. Loading the solver…');
  await page.clock.fastForward(59_000);
  await expect(status(page)).toHaveText('2 vans. Loading the solver…');
  await page.clock.fastForward(2_000);
  await expect(status(page)).toHaveText(
    '2 vans. The solver did not answer in time. Change anything to try again.',
  );
  await expect(page.locator('[data-rl-saved]')).toHaveText(
    'VROOM’s plan on the map is for the previous orders.',
  );
  hold = false;
  await page.check('input[name="rl-vans"][value="1"]');
  await expect(status(page)).toHaveText(PLANNED, { timeout: 20_000 });
  await expect(page.locator('[data-rl-plan="after"]')).not.toHaveAttribute('data-rl-stale');
});

test('in forced colors the band swatches keep their six colors', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active', colorScheme: 'light' });
  await page.goto(ROUTE_LAB);
  const fills = await page.evaluate(() => [
    getComputedStyle(document.body).backgroundColor,
    ...[...document.querySelectorAll('.rl-swatch')].map((s) => getComputedStyle(s).backgroundColor),
  ]);
  expect(new Set(fills).size).toBe(7);
});
