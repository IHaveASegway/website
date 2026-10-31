import { expect, test, type Page } from '@playwright/test';
import { converter, formatHex } from 'culori';
import { NOT_FOUND_PAGE } from './expected';

// The theme and the back-forward cache (design-system.md, "Theme before first paint"). The cache
// keeps a page as it was when the visitor left it and shows it again without running the theme
// script. A choice made on another page in the meantime is in sessionStorage, so the script
// applies it again on pageshow when the page comes back from the cache (event.persisted). On
// 2026-10-24's build the page came back in the theme it was left in. Playwright launches Chromium
// with the cache turned off (--disable-back-forward-cache), and its default headless shell never
// restores from it, so this file runs full Chromium (in Playwright's image, as the shell is) with
// the cache on: launch options, which only a whole file can set.

test.use({
  channel: 'chromium',
  launchOptions: { ignoreDefaultArgs: ['--disable-back-forward-cache'] },
});

/** Every pageshow, in order, and whether this document was left before: set in the page. */
interface Visit {
  __shows?: boolean[];
  __left?: boolean;
}

/** The scheme the body paints, and whether the browser chrome takes its color. */
async function looks(page: Page) {
  const painted = await page.evaluate(() => ({
    background: getComputedStyle(document.body).backgroundColor,
    chrome:
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
        (meta) => matchMedia(meta.media).matches,
      )?.content ?? null,
  }));
  const lightness = converter('oklch')(painted.background)?.l ?? 0;
  return {
    scheme: lightness > 0.5 ? 'light' : 'dark',
    chromeIsBackground: painted.chrome === formatHex(painted.background),
  };
}

/** Records every pageshow, in every document the page opens. */
async function recordShows(page: Page) {
  await page.addInitScript(() =>
    addEventListener('pageshow', (event) => {
      const visit = window as unknown as Visit;
      visit.__shows = [...(visit.__shows ?? []), event.persisted];
    }),
  );
}

/** Marks Home as left, opens the 404, and runs what the visitor does there. */
async function leaveHome(page: Page, there: () => Promise<void>) {
  await page.evaluate(() => {
    (window as unknown as Visit).__left = true;
  });
  await page.goto(NOT_FOUND_PAGE);
  await there();
}

/** Goes back to Home, and proves it came from the cache: a fresh load would pass without the fix. */
async function backFromTheCache(page: Page) {
  // A page from the cache fires no load event, so the wait is for its pageshow instead.
  await page.goBack({ waitUntil: 'commit' });
  await page.waitForFunction(() => {
    const visit = window as unknown as Visit;
    return document.readyState === 'complete' && visit.__shows?.length === (visit.__left ? 2 : 1);
  });
  const visit = await page.evaluate(() => ({
    left: (window as unknown as Visit).__left,
    shows: (window as unknown as Visit).__shows,
  }));
  expect(visit, 'Home came back from the back-forward cache').toEqual({
    left: true,
    shows: [false, true],
  });
}

// Its name is the theme it shows, in the panel's words (ADR 0025): Theme: System, Day or Night.
const toggle = (page: Page) => page.getByRole('button', { name: /^Theme: / });

test('a page restored from the back-forward cache shows the choice made after leaving it', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await recordShows(page);
  await page.goto('/');
  await expect(toggle(page)).toHaveAccessibleName('Theme: System');
  expect(await looks(page)).toEqual({ scheme: 'dark', chromeIsBackground: true });

  await leaveHome(page, async () => {
    await toggle(page).click();
    await expect(toggle(page)).toHaveAccessibleName('Theme: Day');
  });
  await backFromTheCache(page);
  await expect(toggle(page)).toHaveAccessibleName('Theme: Day');
  expect(await looks(page)).toEqual({ scheme: 'light', chromeIsBackground: true });
});

// Storage that refuses a choice (private modes, blocked storage) leaves it to the page it was made
// on (design-system.md, "Theme before first paint"). The cache brings that page back as it was, so
// the choice still holds there: on the first fix of 2026-10-25, a restore that could not read
// storage reset it to System.
test('a page restored from the back-forward cache keeps a choice storage refused', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.addInitScript(() =>
    Object.defineProperty(window, 'sessionStorage', {
      get() {
        throw new DOMException('blocked', 'SecurityError');
      },
    }),
  );
  await recordShows(page);
  await page.goto('/');
  await toggle(page).click();
  await expect(toggle(page)).toHaveAccessibleName('Theme: Day');

  // The 404 is a new page, and nothing reached storage: it follows the OS.
  await leaveHome(page, () => expect(toggle(page)).toHaveAccessibleName('Theme: System'));
  await backFromTheCache(page);
  await expect(toggle(page)).toHaveAccessibleName('Theme: Day');
  expect(await looks(page)).toEqual({ scheme: 'light', chromeIsBackground: true });
});
