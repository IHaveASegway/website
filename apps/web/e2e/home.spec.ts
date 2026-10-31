import { expect, test, type Page } from '@playwright/test';
import { pages } from './expected';

// Home (docs/design/overhaul.md, "Home"; ADR 0027): the name, the role and the ways to reach him;
// the drawing of the five labs as one system, each part a link to its lab; the figures; the
// activity calendar; the lab cards; the dated writing; the address again. Until ADR 0027 Home ran
// the Route Lab's scene on a canvas and drew the board (e2e/rail-and-scene.spec.ts and
// e2e/scene-covers-nothing.spec.ts, which these checks replace): what they held for the scene,
// that it moves only as asked, pauses on request (SC 2.2.2), holds still under reduced motion,
// shifts nothing and covers no word, these hold for the drawing.

const drawing = (page: Page) => page.locator('figure.iso');
const toggle = (page: Page) => page.locator('[data-motion-toggle]');
const LABS = ['backfill', 'cache', 'queue', 'raft', 'routes'] as const;

/** Each lab's page this build writes, by slug. */
async function labsBuilt(page: Page): Promise<string[]> {
  const found: string[] = [];
  for (const slug of LABS)
    if ((await page.request.get(`/lab/${slug}/`)).status() === 200) found.push(slug);
  return found;
}

/** The running animations inside the drawing, by their state. */
const animationStates = (page: Page) =>
  page.evaluate(() => [
    ...new Set(
      [...document.querySelectorAll('figure.iso *')].flatMap((element) =>
        element
          .getAnimations()
          .filter((a) => !(a.timeline && 'source' in a.timeline))
          .map((a) => a.playState),
      ),
    ),
  ]);

test.describe("Home's opening", () => {
  for (const width of [320, 390, 1440]) {
    test(`at ${width} px the name is one line of capitals, its role and both ways to reach him under it`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/');
      await page.evaluate(() => document.fonts.ready);
      const name = page.locator('h1.nameplate');
      await expect(name).toHaveText('Joseph Peterson');
      await expect(name).toHaveCSS('text-transform', 'uppercase');
      const lines = await name.evaluate((h1) => {
        const range = document.createRange();
        range.selectNodeContents(h1);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size;
      });
      // From 390 px the name is one line; at 320 px it may take two, never breaking a word.
      expect(lines).toBeLessThanOrEqual(width >= 390 ? 1 : 2);
      await expect(page.locator('.intro-role')).toHaveText('Senior Software Engineer. Remote, US.');
      const email = page.locator('.intro-actions .btn-primary');
      await expect(email).toHaveAttribute('href', 'mailto:hello@ihaveasegway.com');
      await expect(page.locator('.intro-actions .btn:not(.btn-primary)')).toHaveText(['LinkedIn']);
      // The bio's blocks, by their names, in the bio's order.
      await expect(page.locator('.bio-block > .block-label')).toHaveText([
        'Now',
        'What I build',
        'Working toward',
      ]);
    });
  }
});

test.describe("Home's drawing", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('each part is a link to the lab that runs it, named for it, in the order it is drawn', async ({
    page,
  }) => {
    await page.goto('/');
    const built = await labsBuilt(page);
    const links = drawing(page).locator('a.iso-node');
    await expect(links).toHaveCount(built.length);
    for (const slug of built) {
      const link = drawing(page).locator(`a.iso-node[data-line="${slug}"]`);
      await expect(link).toHaveAttribute('href', `/lab/${slug}/`);
      // Named by the words it shows, the part's name first (SC 2.5.3).
      const shown = (await link.locator('.iso-name').textContent())?.trim() ?? '';
      expect(shown.length, slug).toBeGreaterThan(0);
      await expect(link).toHaveAccessibleName(new RegExp(`^${shown}\\b`));
    }
    await expect(drawing(page).locator('figcaption')).toHaveText(
      'The five labs as one system. Each part opens the lab that runs it.',
    );
  });

  test("a part under the pointer or with focus lights its lab's wires in its colour, at once", async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    const built = await labsBuilt(page);
    test.skip(built.length === 0, 'this build has no lab');
    const wireColours = (slug: string) =>
      page.evaluate(
        (lab) =>
          [...document.querySelectorAll(`figure.iso .iso-wire[data-line="${lab}"]`)].map(
            (wire) => getComputedStyle(wire).stroke,
          ),
        slug,
      );
    const lineOf = (slug: string) =>
      page.evaluate((lab) => {
        const probe = document.querySelector(`figure.iso .iso-node[data-line="${lab}"]`);
        return probe ? getComputedStyle(probe).getPropertyValue('--line').trim() : '';
      }, slug);
    for (const slug of built) {
      const atRest = await wireColours(slug);
      expect(atRest.length, slug).toBeGreaterThan(0);
      const node = drawing(page).locator(`a.iso-node[data-line="${slug}"]`);
      // Over one of its solids: the part's box holds the plane between its solids too.
      await node.locator('.iso-face-top').last().hover();
      const lit = await wireColours(slug);
      expect(lit, slug).not.toEqual(atRest);
      expect(new Set(lit).size, slug).toBe(1);
      expect(await lineOf(slug), slug).not.toBe('');
      await page.mouse.move(0, 0);
      expect(await wireColours(slug), slug).toEqual(atRest);
      await node.focus();
      expect(await wireColours(slug), slug).toEqual(lit);
      // Its name turns to the accent and is underlined: focus is seen in more than a colour.
      await expect(node.locator('.iso-name')).toHaveCSS('text-decoration-line', 'underline');
      await node.blur();
    }
  });

  test('it runs once the page has painted, pauses and plays from the bar, and the choice lasts the tab', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await expect(toggle(page)).toBeVisible();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    expect(await animationStates(page)).toEqual(['running']);

    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    expect(await animationStates(page)).toEqual(['paused']);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBe('paused');

    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'paused');
    await expect(toggle(page)).toHaveAccessibleName('Play motion');
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Pause motion');
    expect(await animationStates(page)).toEqual(['running']);
    expect(await page.evaluate(() => sessionStorage.getItem('motion'))).toBeNull();
  });

  test('under reduced motion it is a still drawing: nothing runs, nothing lifts, and there is no button', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(300);
    await expect(page.locator('html')).not.toHaveAttribute('data-motion');
    await expect(page.locator('.motion-item')).toBeHidden();
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    const lift = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('figure.iso .iso-lift')].map((g) =>
          Math.round(
            g.getBoundingClientRect().top - (g.closest('svg')?.getBoundingClientRect().top ?? 0),
          ),
        ),
      );
    const before = await lift();
    await page.evaluate(() => scrollTo(0, 400));
    await page.waitForTimeout(100);
    expect(await lift()).toEqual(before);
  });

  test('scrolling lifts its parts into an exploded view, and scrolling back sets them down', async ({
    page,
  }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    test.skip(
      !(await page.evaluate(() => CSS.supports('animation-timeline: scroll()'))),
      'this browser has no scroll timelines, so the drawing stays assembled',
    );
    const offsets = () =>
      page.evaluate(() =>
        [...document.querySelectorAll('figure.iso .iso-lift')].map((g) => {
          const svg = g.closest('svg');
          return Math.round(
            g.getBoundingClientRect().top - (svg?.getBoundingClientRect().top ?? 0),
          );
        }),
      );
    const settle = () =>
      page.evaluate(
        () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
      );
    const assembled = await offsets();
    await page.evaluate(() => scrollTo(0, 500));
    await settle();
    const exploded = await offsets();
    // Each part higher in its box than it was, by its own amount.
    exploded.forEach((top, i) => expect(top, `part ${i}`).toBeLessThan(assembled[i] ?? 0));
    expect(new Set(exploded.map((top, i) => (assembled[i] ?? 0) - top)).size).toBeGreaterThan(1);
    await page.evaluate(() => scrollTo(0, 0));
    await settle();
    expect(await offsets()).toEqual(assembled);
  });

  test('it shifts nothing as it loads and runs, and its box is the same with and without its motion', async ({
    page,
  }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { shifts: number };
      w.shifts = 0;
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as (PerformanceEntry & { value: number })[])
          w.shifts += entry.value;
      }).observe({ type: 'layout-shift', buffered: true });
    });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => (window as unknown as { shifts: number }).shifts)).toBe(0);
    const running = await drawing(page).boundingBox();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.reload();
    expect(await drawing(page).boundingBox()).toEqual(running);
  });

  test('no other page has the drawing or the motion button', async ({ page }) => {
    for (const path of pages().filter((p) => p !== '/')) {
      await page.goto(path);
      await expect(drawing(page), path).toHaveCount(0);
      await expect(toggle(page), path).toHaveCount(0);
    }
  });
});

// A section's picture belongs to that section: nothing the drawing draws covers a word, at any
// width or scroll, and nothing of it stands still on the screen while the page scrolls.
const SIZES = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
] as const;

/** Elements that hold words. */
const WORDS = 'h1, h2, h3, p, li, a, dd, dt, figcaption';

for (const viewport of SIZES) {
  test(`at ${viewport.width} × ${viewport.height} the drawing covers no word at any scroll`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    test.skip((await drawing(page).count()) === 0, 'this build has no lab to draw');
    const end = await page.evaluate(
      () => document.documentElement.scrollHeight - document.documentElement.clientHeight,
    );
    const step = Math.round(viewport.height / 2);
    let steps = 0;
    for (let y = 0; ; y = Math.min(y + step, end)) {
      await page.evaluate((to) => scrollTo(0, to), y);
      const found = await page.evaluate((selector) => {
        const svg = document.querySelector<SVGSVGElement>('figure.iso svg');
        if (!svg) throw new Error('no drawing');
        const s = svg.getBoundingClientRect();
        const crossing: string[] = [];
        for (const element of document.querySelectorAll<HTMLElement>(selector)) {
          if (
            element.closest('figure.iso') ||
            !element.checkVisibility({ visibilityProperty: true })
          )
            continue;
          const b = element.getBoundingClientRect();
          if (b.width <= 1 || b.height <= 1) continue;
          const overlap =
            Math.min(b.right, s.right) - Math.max(b.left, s.left) > 0.5 &&
            Math.min(b.bottom, s.bottom) - Math.max(b.top, s.top) > 0.5;
          if (overlap)
            crossing.push(`${element.localName}: ${element.textContent?.trim().slice(0, 40)}`);
        }
        return { crossing, position: getComputedStyle(svg.closest('figure') as Element).position };
      }, WORDS);
      expect(found.crossing, `at scroll ${y}`).toEqual([]);
      expect(['sticky', 'fixed'], `at scroll ${y}`).not.toContain(found.position);
      steps += 1;
      if (y >= end) break;
    }
    expect(steps).toBeGreaterThan(4);
  });
}

test.describe("Home's figures and activity", () => {
  test('four figures, each a count with its caption, the labs as many as their cards', async ({
    page,
  }) => {
    await page.goto('/');
    const stats = page.locator('.stats .stat');
    await expect(page.locator('.stats .stat-caption')).toHaveText([
      'live labs to break',
      'seeded runs on every pull request',
      'decision records',
      'tests written',
    ]);
    const values = await stats
      .locator('data')
      .evaluateAll((all) =>
        all.map((d) => ({ value: Number(d.getAttribute('value')), text: d.textContent })),
      );
    for (const { value, text } of values) {
      expect(value).toBeGreaterThan(0);
      expect(text).toBe(value.toLocaleString('en-US'));
    }
    expect(values[0]?.value).toBe(await page.locator('.lab-card').count());
  });

  test("the calendar's total is its days' commits, a column a week, Monday first", async ({
    page,
  }) => {
    await page.goto('/');
    const calendar = page.locator('.activity');
    test.skip((await calendar.count()) === 0, 'this build has no history to read');
    const read = await calendar.evaluate((root) => {
      const days = [...root.querySelectorAll('rect[data-day]')];
      const columns = new Map<string, string[]>();
      for (const day of days) {
        const x = day.getAttribute('x') ?? '';
        columns.set(x, [...(columns.get(x) ?? []), day.getAttribute('data-day') ?? '']);
      }
      return {
        total: Number(root.querySelector('.activity-figure data')?.getAttribute('value')),
        sum: days.reduce((n, d) => n + Number(d.getAttribute('data-commits')), 0),
        titled: days.every((d) => d.querySelector('title')?.textContent?.includes(':')),
        weeks: [...columns.values()],
        dots: root.querySelectorAll('.activity-grid .activity-decision').length,
        words: root.querySelector('.activity-words')?.textContent ?? '',
      };
    });
    expect(read.total).toBeGreaterThan(0);
    expect(read.sum).toBeLessThanOrEqual(read.total);
    expect(read.titled).toBe(true);
    for (const week of read.weeks.slice(0, -1)) {
      expect(week).toHaveLength(7);
      expect(new Date(`${week[0]}T00:00:00Z`).getUTCDay()).toBe(1);
    }
    expect(read.words).toContain('commits to this site');
    expect(read.dots).toBeGreaterThan(0);
  });
});

// Home's rows are /writing/'s list (components/PostList.astro), so a post's day, kind and reading
// time read the same on both. Until the overhaul's merge Home drew its own rows and counted 230
// words a minute while /writing/ counted 220, and one post could read "6 min" on one page and
// "7 min" on the other.
test("Home's writing rows: the day, the title as the row's link, its summary, its kind and reading time, as /writing/ says them", async ({
  page,
}) => {
  await page.goto('/');
  const rows = page.locator('#writing .post-row');
  test.skip((await rows.count()) === 0, 'this build lists no post');
  const home = new Map<string, string>();
  for (const row of await rows.all()) {
    await expect(row.locator('.post-date time')).toHaveText(/^\d{1,2} [A-Z][a-z]{2} \d{4}$/);
    const link = row.locator('.post-title a');
    await expect(link).toHaveAttribute('href', /^\/(writing|notes)\/.+\/$/);
    await expect(row.locator('.post-summary')).not.toBeEmpty();
    await expect(row.locator('.post-kind')).toHaveText(/\d+ min read$/);
    home.set((await link.getAttribute('href')) ?? '', (await row.innerText()).trim());
  }
  for (const section of new Set([...home.keys()].map((href) => href.split('/')[1]))) {
    await page.goto(`/${section}/`);
    for (const row of await page.locator('main .post-row').all()) {
      const href = (await row.locator('.post-title a').getAttribute('href')) ?? '';
      if (home.has(href)) expect((await row.innerText()).trim(), href).toBe(home.get(href));
    }
  }
});

test("Home closes with the address at a title's size and LinkedIn", async ({ page }) => {
  await page.goto('/');
  const closing = page.locator('#contact');
  await expect(closing.locator('.closing-mail')).toHaveAttribute(
    'href',
    'mailto:hello@ihaveasegway.com',
  );
  await expect(closing.locator('.closing-mail')).toHaveText('hello@ihaveasegway.com');
  await expect(closing.locator('.btn')).toHaveText(['LinkedIn']);
});
