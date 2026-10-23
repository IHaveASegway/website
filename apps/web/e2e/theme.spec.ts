import { expect, test, type Page } from '@playwright/test';
import { converter, wcagContrast } from 'culori';

// The theme before first paint, the toggle, and the fail-safe (design-system.md, "Theme before
// first paint"). The OS is the fail-safe: with no stored choice, storage that throws, or no
// JavaScript at all, the page follows prefers-color-scheme.

type Scheme = 'dark' | 'light';
type Stored = 'nothing' | 'light' | 'dark' | 'storage that throws';

/** Records <html>'s theme and the body's background in the first frame that can paint the body. */
async function watchFirstFrame(page: Page, stored: Stored) {
  await page.addInitScript((choice) => {
    if (choice === 'storage that throws') {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    } else if (choice !== 'nothing') {
      localStorage.setItem('theme', choice);
    }
    const record = (): void => {
      if (!document.body) {
        requestAnimationFrame(record);
        return;
      }
      Object.defineProperty(window, '__firstFrame', {
        value: {
          theme: document.documentElement.dataset['theme'] ?? null,
          saved: document.documentElement.hasAttribute('data-saved'),
          background: getComputedStyle(document.body).backgroundColor,
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
// Chromium joins the toggle's visible spans with a space where it skips a hidden one, so the
// accessible name can carry two spaces before the dot; the words are what is checked.
const toggle = (page: Page) => page.getByRole('button', { name: /^Theme: / });

const CASES: { os: Scheme; stored: Stored; theme: string; saved: boolean; looks: Scheme }[] = [
  { os: 'dark', stored: 'nothing', theme: 'system', saved: false, looks: 'dark' },
  { os: 'dark', stored: 'light', theme: 'light', saved: true, looks: 'light' },
  { os: 'dark', stored: 'dark', theme: 'dark', saved: true, looks: 'dark' },
  { os: 'dark', stored: 'storage that throws', theme: 'system', saved: false, looks: 'dark' },
  { os: 'light', stored: 'nothing', theme: 'system', saved: false, looks: 'light' },
  { os: 'light', stored: 'light', theme: 'light', saved: true, looks: 'light' },
  { os: 'light', stored: 'dark', theme: 'dark', saved: true, looks: 'dark' },
  { os: 'light', stored: 'storage that throws', theme: 'system', saved: false, looks: 'light' },
];

for (const { os, stored, theme, saved, looks } of CASES) {
  test(`OS ${os}, ${stored} stored: the first frame is already ${looks}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: os });
    await watchFirstFrame(page, stored);
    await page.goto('/');
    const first = await page.waitForFunction(
      () => (window as unknown as { __firstFrame?: object }).__firstFrame,
    );
    const frame = (await first.jsonValue()) as {
      theme: string;
      saved: boolean;
      background: string;
    };
    // The script runs in <head>, so by the first frame that can paint <body> it has always run,
    // however the HTML arrives. In <body> it had a gap, seen on the first Worker Preview.
    expect(frame.theme).toBe(theme);
    expect(frame.saved).toBe(saved);
    expect(schemeOf(frame.background)).toBe(looks);
    const name = saved
      ? new RegExp(`^Theme: ${theme}\\s+·\\s+saved in this browser$`)
      : `Theme: ${theme}`;
    await expect(toggle(page)).toHaveAccessibleName(name);
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
    await expect(button).toHaveAccessibleName(
      new RegExp(`^Theme: ${other}\\s+·\\s+saved in this browser$`),
    );
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(other);
    expect(schemeOf(await background(page))).toBe(other);

    await button.click();
    await expect(button).toHaveAccessibleName(
      new RegExp(`^Theme: ${os}\\s+·\\s+saved in this browser$`),
    );
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(os);
    expect(schemeOf(await background(page))).toBe(os);

    await button.click();
    await expect(button).toHaveAccessibleName('Theme: system');
    expect(await page.evaluate(() => localStorage.getItem('theme'))).toBeNull();
    expect(schemeOf(await background(page))).toBe(os);

    // theme is the only key the site stores (security.md, "Privacy and data inventory").
    await button.click();
    expect(await page.evaluate(() => Object.keys(localStorage))).toEqual(['theme']);
  });
}

test('a choice survives a reload, and storage that refuses it is never called saved', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await toggle(page).click();
  await page.reload();
  await expect(toggle(page)).toHaveAccessibleName(/^Theme: light\s+·\s+saved/);

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
  await page.emulateMedia({ colorScheme: 'dark' });
  expect(schemeOf(await background(page))).toBe('dark');
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
    await expect(page.locator('[data-theme-toggle]')).toBeHidden();
    await context.close();
  });
}
