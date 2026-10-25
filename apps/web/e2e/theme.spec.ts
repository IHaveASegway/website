import { expect, test, type Page } from '@playwright/test';
import { converter, formatHex, wcagContrast } from 'culori';

// The theme before first paint, the toggle, and the fail-safe (design-system.md, "Theme before
// first paint"). The OS is the fail-safe: with no choice made in this tab, storage that throws, or
// no JavaScript at all, the page follows prefers-color-scheme. A choice lasts for the tab
// (sessionStorage), never longer, so the toggle needs no notice about storage (security.md). The
// browser chrome follows the page: in every state below, the theme-color the browser would use is
// the body's background.

type Scheme = 'dark' | 'light';
type Stored = 'nothing' | 'light' | 'dark' | 'storage that throws';

/** Records <html>'s theme, the body's background and the browser chrome's color in the first
 *  frame that can paint the body. */
async function watchFirstFrame(page: Page, stored: Stored) {
  await page.addInitScript((choice) => {
    if (choice === 'storage that throws') {
      Object.defineProperty(window, 'sessionStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    } else if (choice !== 'nothing') {
      sessionStorage.setItem('theme', choice);
    }
    const record = (): void => {
      if (!document.body) {
        requestAnimationFrame(record);
        return;
      }
      Object.defineProperty(window, '__firstFrame', {
        value: {
          theme: document.documentElement.dataset['theme'] ?? null,
          background: getComputedStyle(document.body).backgroundColor,
          // The first theme-color meta whose media matches is the one a browser uses (HTML).
          chrome:
            [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
              (meta) => matchMedia(meta.media).matches,
            )?.content ?? null,
        },
      });
    };
    requestAnimationFrame(record);
  }, stored);
}

/** Dark or light, from a computed color's OKLCH lightness: the two themes sit near 0.23 and 0.98. */
const oklch = converter('oklch');
function schemeOf(color: string): Scheme {
  const converted = oklch(color);
  if (!converted) throw new Error(`not a color: ${color}`);
  return converted.l > 0.5 ? 'light' : 'dark';
}

const background = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
/** The browser chrome's color: the first theme-color meta whose media matches (HTML). */
const chrome = (page: Page) =>
  page.evaluate(
    () =>
      [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')].find(
        (meta) => matchMedia(meta.media).matches,
      )?.content ?? null,
  );
/** The browser chrome shows the page's own background, as #rrggbb (lib/tokens.ts, chromeColor). */
async function expectChromeIsBackground(page: Page) {
  expect(await chrome(page)).toBe(formatHex(await background(page)));
}
// The toggle shows an icon; its name is the one state span CSS leaves displayed.
const toggle = (page: Page) => page.getByRole('button', { name: /^Theme: / });

const CASES: { os: Scheme; stored: Stored; theme: string; looks: Scheme }[] = [
  { os: 'dark', stored: 'nothing', theme: 'system', looks: 'dark' },
  { os: 'dark', stored: 'light', theme: 'light', looks: 'light' },
  { os: 'dark', stored: 'dark', theme: 'dark', looks: 'dark' },
  { os: 'dark', stored: 'storage that throws', theme: 'system', looks: 'dark' },
  { os: 'light', stored: 'nothing', theme: 'system', looks: 'light' },
  { os: 'light', stored: 'light', theme: 'light', looks: 'light' },
  { os: 'light', stored: 'dark', theme: 'dark', looks: 'dark' },
  { os: 'light', stored: 'storage that throws', theme: 'system', looks: 'light' },
];

for (const { os, stored, theme, looks } of CASES) {
  test(`OS ${os}, ${stored} stored: the first frame is already ${looks}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: os });
    await watchFirstFrame(page, stored);
    await page.goto('/');
    const first = await page.waitForFunction(
      () => (window as unknown as { __firstFrame?: object }).__firstFrame,
    );
    const frame = (await first.jsonValue()) as {
      theme: string;
      background: string;
      chrome: string | null;
    };
    // The script runs in <head>, so by the first frame that can paint <body> it has always run,
    // however the HTML arrives. In <body> it had a gap, seen on the first Worker Preview.
    expect(frame.theme).toBe(theme);
    expect(schemeOf(frame.background)).toBe(looks);
    expect(frame.chrome, 'the browser chrome in the first frame').toBe(formatHex(frame.background));
    await expect(toggle(page)).toHaveAccessibleName(`Theme: ${theme}`);
  });
}

// From System the first press picks the theme the OS is not showing, so every press changes the
// page except the last, the return to System. On a dark OS (the site is dark-first) a first press
// that changed nothing would read as a broken control.
for (const os of ['dark', 'light'] as const) {
  const other = os === 'dark' ? 'light' : 'dark';
  test(`on a ${os} OS the toggle cycles System, ${other}, ${os}, and every press but the last changes the page`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: os });
    await page.goto('/');
    const button = toggle(page);
    await expect(button).toHaveAccessibleName('Theme: system');
    expect(schemeOf(await background(page))).toBe(os);

    await button.click();
    await expect(button).toHaveAccessibleName(`Theme: ${other}`);
    expect(await page.evaluate(() => sessionStorage.getItem('theme'))).toBe(other);
    expect(schemeOf(await background(page))).toBe(other);
    await expectChromeIsBackground(page);

    await button.click();
    await expect(button).toHaveAccessibleName(`Theme: ${os}`);
    expect(await page.evaluate(() => sessionStorage.getItem('theme'))).toBe(os);
    expect(schemeOf(await background(page))).toBe(os);
    await expectChromeIsBackground(page);

    await button.click();
    await expect(button).toHaveAccessibleName('Theme: system');
    expect(await page.evaluate(() => sessionStorage.getItem('theme'))).toBeNull();
    expect(schemeOf(await background(page))).toBe(os);
    await expectChromeIsBackground(page);

    // theme is the only key the site stores, and only for the tab: nothing reaches localStorage
    // (security.md, "Privacy and data inventory").
    await button.click();
    expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(['theme']);
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
  });
}

// The toggle shows which state it is in (design-system.md, "Theme before first paint"): an icon of
// its own for System, Light and Dark, so every press changes what it shows, the return to System
// included, which on 2026-10-24's build changed nothing visible. A pointer anywhere over it shows a
// title with the same words as its name.
test('every press changes what the toggle shows, and its title says what its name says', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  const button = toggle(page);
  const pictures: Buffer[] = [];
  const titles: Record<string, (string | null | undefined)[]> = {};
  for (const theme of ['system', 'light', 'dark']) {
    await expect(button).toHaveAccessibleName(`Theme: ${theme}`);
    await page.mouse.move(0, 0);
    // The title a pointer would show: at two corners and at the center of the button.
    titles[`Theme: ${theme}`] = await button.evaluate((element) => {
      const box = element.getBoundingClientRect();
      return [
        [box.left + 1, box.top + 1],
        [box.left + box.width / 2, box.top + box.height / 2],
        [box.right - 1, box.bottom - 1],
      ].map(([x = 0, y = 0]) =>
        document.elementFromPoint(x, y)?.closest('[title]')?.getAttribute('title'),
      );
    });
    pictures.push(await button.screenshot());
    await button.click();
  }
  await expect(button).toHaveAccessibleName('Theme: system');
  // System and Dark both paint a dark page on a dark OS: only the icon tells them apart.
  const [system, light, dark] = pictures;
  expect(system?.equals(dark ?? Buffer.alloc(0)), 'System and Dark look the same').toBe(false);
  expect(system?.equals(light ?? Buffer.alloc(0)), 'System and Light look the same').toBe(false);
  expect(light?.equals(dark ?? Buffer.alloc(0)), 'Light and Dark look the same').toBe(false);
  for (const [name, seen] of Object.entries(titles)) expect(seen, name).toEqual([name, name, name]);
});

// Forced colors (a Windows contrast theme) replace both themes with the visitor's own colors, so
// the toggle would change nothing there: it is not shown, and Tab never reaches it.
test('in forced colors the toggle is not shown, since it would change nothing', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' });
  await page.goto('/');
  expect(await page.evaluate(() => document.documentElement.dataset['theme'])).toBe('system');
  await expect(page.locator('[data-theme-toggle]')).toBeHidden();
  await page.emulateMedia({ forcedColors: 'none' });
  await expect(toggle(page)).toBeVisible();
});

test('a choice survives a reload and lasts for the tab only; storage that refuses it still applies it to the page', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await toggle(page).click();
  await page.reload();
  await expect(toggle(page)).toHaveAccessibleName('Theme: light');

  // A new tab starts from the OS again: nothing outlives the tab.
  const fresh = await page.context().newPage();
  await fresh.emulateMedia({ colorScheme: 'dark' });
  await fresh.goto('/');
  await expect(toggle(fresh)).toHaveAccessibleName('Theme: system');

  const blocked = await page.context().newPage();
  await blocked.emulateMedia({ colorScheme: 'dark' });
  await watchFirstFrame(blocked, 'storage that throws');
  await blocked.goto('/');
  await toggle(blocked).click();
  await expect(toggle(blocked)).toHaveAccessibleName('Theme: light');
  expect(await blocked.evaluate(() => document.documentElement.dataset['theme'])).toBe('light');
});

test('System follows an OS change live, with no reload and no listener', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  expect(schemeOf(await background(page))).toBe('dark');
  await page.emulateMedia({ colorScheme: 'light' });
  expect(schemeOf(await background(page))).toBe('light');
  await expectChromeIsBackground(page);
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(schemeOf(await background(page))).toBe('dark');
  await expectChromeIsBackground(page);
});

// Paper is white, and browsers drop backgrounds by default, so every label must read in ink on
// white with or without the fills: the Email button prints as an outline, and the toggle not at all.
for (const stored of ['dark', 'light'] as const) {
  test(`a stored ${stored} theme prints black on white, the Email button included`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: stored === 'dark' ? 'light' : 'dark' });
    await watchFirstFrame(page, stored);
    await page.goto('/');
    expect(schemeOf(await background(page))).toBe(stored);
    await page.emulateMedia({ media: 'print' });
    const colors = await page.evaluate(() => {
      const button = getComputedStyle(document.querySelector('.btn-primary') as Element);
      return {
        background: getComputedStyle(document.body).backgroundColor,
        text: getComputedStyle(document.body).color,
        button: button.color,
        fill: button.backgroundColor,
      };
    });
    expect(schemeOf(colors.background)).toBe('light');
    expect(schemeOf(colors.text)).toBe('dark');
    // The label against white paper, whether or not its fill prints; and no fill to drop.
    expect(wcagContrast(colors.button, 'white')).toBeGreaterThanOrEqual(4.5);
    expect(converter('rgb')(colors.fill)?.alpha ?? 1).toBe(0);
    await expect(page.locator('[data-theme-toggle]')).toBeHidden();
  });
}

test('more contrast applies over a stored theme: hairlines take the 3:1 border', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark', contrast: 'more' });
  await watchFirstFrame(page, 'light');
  await page.goto('/');
  const tokens = await page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return {
      border: style.getPropertyValue('--border').trim(),
      input: style.getPropertyValue('--input').trim(),
      subtle: style.getPropertyValue('--subtle-foreground').trim(),
      muted: style.getPropertyValue('--muted-foreground').trim(),
    };
  });
  expect(tokens.border).toBe(tokens.input);
  expect(tokens.subtle).toBe(tokens.muted);
});

for (const os of ['dark', 'light'] as const) {
  test(`without JavaScript the page follows the OS (${os}) and shows no toggle`, async ({
    browser,
  }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, colorScheme: os });
    const page = await context.newPage();
    await page.goto('/');
    expect(await page.evaluate(() => document.documentElement.hasAttribute('data-theme'))).toBe(
      false,
    );
    expect(schemeOf(await background(page))).toBe(os);
    await expectChromeIsBackground(page);
    await expect(page.locator('[data-theme-toggle]')).toBeHidden();
    await context.close();
  });
}
