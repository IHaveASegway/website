import { expect, test, type Page } from '@playwright/test';
import { pages } from './expected';

// The top bar (ADR 0027; docs/design/overhaul.md, "Top nav"), which replaced the rail of ADRs 0021
// to 0023 on every width: a band across the top of every page, 56 px, one row from 390 px, never
// fixed to the window; the wordmark, Lab, Writing and About, then Search and the theme. The page's
// section is marked by a 2 px rule in the accent under its item. The frame is centred, so on a wide
// screen the room it adds goes to both margins.

/** Every page's bar, measured: its box, the masthead's and main's, and whether its items share a
 *  row. */
const bar = (page: Page) =>
  page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const masthead = box('.masthead');
    const header = box('.site-header');
    const main = box('main');
    const tops = [
      box('.site-header .wordmark'),
      box('.site-header .site-nav'),
      box('.site-header .header-tools'),
    ].map((b) => Math.round((b?.top ?? 0) + (b?.height ?? 0) / 2));
    return {
      x: masthead?.x ?? -1,
      width: masthead?.width ?? -1,
      height: Math.round(header?.height ?? 0),
      oneRow: new Set(tops).size === 1,
      mainBelow: (main?.y ?? 0) >= (masthead?.bottom ?? 0) - 0.5,
      position: getComputedStyle(document.querySelector('.masthead') as Element).position,
    };
  });

test('the bar spans the window above main on every page, one row 56 px tall from 390 px', async ({
  page,
}) => {
  for (const width of [390, 768, 1024, 1440, 2560]) {
    await page.setViewportSize({ width, height: 900 });
    for (const path of pages()) {
      await page.goto(path);
      const at = await bar(page);
      expect(at, `${path} at ${width}`).toEqual({
        x: 0,
        width,
        height: 56,
        oneRow: true,
        mainBelow: true,
        position: 'relative',
      });
    }
  }
});

test('the bar is not fixed: it scrolls away with the page, so it never covers what has focus', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/about/');
  await page.mouse.wheel(0, 1200);
  await page.waitForFunction(() => scrollY > 600);
  const header = await page.locator('.masthead').boundingBox();
  expect((header?.y ?? 0) + (header?.height ?? 0)).toBeLessThanOrEqual(0);
});

test("the page's section is marked by a 2 px rule in the accent under its item, and aria-current", async ({
  page,
}) => {
  const marks = () =>
    page.locator('.site-nav a').evaluateAll((links) =>
      links.map((link) => {
        const rule = getComputedStyle(link, '::after');
        const accent = getComputedStyle(document.documentElement).getPropertyValue('--primary');
        const probe = document.createElement('i');
        probe.style.color = accent;
        document.body.append(probe);
        const resolved = getComputedStyle(probe).color;
        probe.remove();
        return {
          href: link.getAttribute('href'),
          current: link.getAttribute('aria-current'),
          rule: rule.content !== 'none' && rule.backgroundColor === resolved ? rule.height : null,
        };
      }),
    );
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/about/');
    expect(await marks(), `${width}`).toContainEqual({
      href: '/about/',
      current: 'page',
      rule: '2px',
    });
    expect((await marks()).filter((m) => m.rule !== null)).toHaveLength(1);
    const demo = pages().find((path) => /^\/lab\/[^/]+\/$/.test(path));
    if (demo) {
      await page.goto(demo);
      expect(await marks(), `${demo} at ${width}`).toContainEqual({
        href: '/lab/',
        current: 'true',
        rule: '2px',
      });
    }
  }
});

test('the bar holds no drop-down: each item is one link, and the pages under it are on its index and in Search', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const path of pages()) {
    await page.goto(path);
    expect(await page.locator('.site-header details').count(), path).toBe(0);
    const hrefs = await page
      .locator('.site-nav a')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href')));
    expect(
      hrefs.every((href) => /^\/[a-z]+\/$/.test(href ?? '')),
      path,
    ).toBe(true);
  }
});

// Tab goes through the bar in the order it stands, left to right: the skip link, the wordmark, the
// nav, Search, then the theme, and into main.
test('Tab goes from the skip link through the bar, left to right, then into main', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const demo = pages().find((path) => /^\/lab\/[^/]+\/$/.test(path)) ?? '/lab/';
  await page.goto(demo);
  await page.waitForFunction(() => 'palette' in document.documentElement.dataset);
  const stops: { name: string; x: number }[] = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    stops.push(
      await page.evaluate(() => {
        const at = document.activeElement;
        if (!at || at.closest('main')) return { name: 'main', x: 0 };
        const read = at.cloneNode(true) as Element;
        for (const hidden of read.querySelectorAll('[aria-hidden="true"]')) hidden.remove();
        return {
          name: (at.getAttribute('aria-label') ?? read.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim(),
          x: at.getBoundingClientRect().x,
        };
      }),
    );
    if (stops.at(-1)?.name === 'main') break;
  }
  const names = stops.map((stop) => stop.name);
  const items = ['Lab', 'Writing', 'About'].filter(
    (step) => step !== 'Writing' || pages().includes('/writing/'),
  );
  expect(names.slice(0, 2 + items.length)).toEqual([
    'Skip to content',
    'Joseph Peterson',
    ...items,
  ]);
  expect(names[2 + items.length]).toMatch(/^Search( Ctrl)? K$/);
  expect(names.at(-1)).toBe('main');
  // Each stop after the skip link stands right of the one before it.
  const xs = stops.slice(1, -1).map((stop) => stop.x);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
});

test('on a phone the wordmark is its tile and Search its glass, each still named in words', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/about/');
  await page.waitForFunction(() => 'palette' in document.documentElement.dataset);
  await expect(page.locator('.wordmark')).toHaveAccessibleName('Joseph Peterson');
  await expect(page.locator('.search-open')).toHaveAccessibleName(/^Search/);
  for (const words of ['.wordmark-name', '.search-word'])
    expect((await page.locator(words).boundingBox())?.width ?? 0, words).toBeLessThanOrEqual(1);
  await expect(page.locator('.wordmark-tile')).toBeVisible();
  await expect(page.locator('.search-glass')).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  for (const words of ['.wordmark-name', '.search-word'])
    expect((await page.locator(words).boundingBox())?.width ?? 0, words).toBeGreaterThan(20);
});

// The frame is centred (ADR 0027): 81rem wide with 2.5rem of padding, so at 2560 px a page's words,
// its bar and its footer start 672 px in, the same distance from both of the window's edges. Home's
// stage reaches the window's edges by design (home.css), so there the bar and the footer are read.
test('at 2560 px every page stands in the centred frame, and so do its bar and its footer', async ({
  page,
}) => {
  await page.setViewportSize({ width: 2560, height: 1440 });
  const START = (2560 - 81 * 16) / 2 + 2.5 * 16;
  for (const path of pages()) {
    await page.goto(path);
    const at = await page.evaluate(() => {
      const content = (selector: string) => {
        const element = document.querySelector(selector) as HTMLElement;
        const style = getComputedStyle(element);
        const box = element.getBoundingClientRect();
        return {
          start: Math.round(box.left + parseFloat(style.paddingLeft)),
          end: Math.round(innerWidth - box.right + parseFloat(style.paddingRight)),
        };
      };
      return {
        main: content('main.frame'),
        bar: content('.masthead > .frame'),
        footer: content('.site-footer'),
      };
    });
    expect(at.bar, path).toEqual({ start: START, end: START });
    expect(at.footer, path).toEqual({ start: START, end: START });
    if (path !== '/') expect(at.main, path).toEqual({ start: START, end: START });
  }
});
