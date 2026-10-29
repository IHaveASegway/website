import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { CONTACT_EMAIL } from '../src/lib/site';
import { NOT_FOUND_PAGE, pages } from './expected';

// The command menu (design-system.md, "The command menu"; components/Palette.astro and
// src/scripts/palette.js), driven as a visitor drives it: the keys and the footer's button, the
// filter, the arrows and Enter, each action, the backdrop, and the checks every page gets, with the
// menu open. test/palette.test.ts holds its rows on every built page.

const menu = (page: Page) => page.locator('dialog[data-palette]');
const input = (page: Page) => page.getByRole('combobox', { name: 'Find a page or an action' });
/** The button that opens it where the test runs: the rail's search field from 80rem (ADR 0022),
 *  the header row's button below. */
const opener = (page: Page) =>
  page.getByRole('button', { name: /^(Command menu|Search) / }).filter({ visible: true });
const said = (page: Page) => page.locator('[data-palette-say]');
const note = (page: Page) => page.locator('[data-palette-note]');

/** A page whose menu is bound: its script has run, and its button shows. */
async function ready(page: Page, path = '/'): Promise<void> {
  await page.goto(path);
  await expect(page.locator('html')).toHaveAttribute('data-palette', '');
}

/** The ids of the rows the filter leaves, in order, and the one selected. */
async function rows(page: Page): Promise<{ shown: string[]; active: string | null }> {
  return page.evaluate(() => {
    const dialog = document.querySelector('dialog[data-palette]');
    const options = [...(dialog?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])];
    return {
      shown: options.filter((o) => o.checkVisibility()).map((o) => o.id),
      active: dialog?.querySelector('input')?.getAttribute('aria-activedescendant') ?? null,
    };
  });
}

test('Ctrl+K and ⌘K open it at once, with focus in its input; Esc closes it', async ({ page }) => {
  // With motion allowed, as most visitors have it: the menu still opens with no animation, its
  // backdrop's included (design-system.md, "Motion"). Home's titles rise on scroll timelines, and
  // the Raft Lab's election runs with Home's scene (ADR 0024), whatever the menu does,
  // so only an animation of the menu's own is counted.
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await ready(page);
  for (const keys of ['Control+k', 'Meta+k']) {
    await page.keyboard.press(keys);
    await expect(menu(page)).toHaveJSProperty('open', true);
    expect(
      await page.evaluate(
        () =>
          document.getAnimations().filter((a) => {
            const target = (a.effect as KeyframeEffect | null)?.target;
            return target != null && target.closest('dialog') !== null;
          }).length,
      ),
    ).toBe(0);
    await expect(input(page)).toBeFocused();
    await expect(input(page)).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(menu(page)).toHaveJSProperty('open', false);
  }
  // The same keys close it from inside, and a bare K opens nothing (SC 2.1.4).
  await page.keyboard.press('Control+k');
  await page.keyboard.press('Control+k');
  await expect(menu(page)).toHaveJSProperty('open', false);
  await page.keyboard.press('k');
  await expect(menu(page)).toHaveJSProperty('open', false);
});

// The button names the keys of the keyboard it runs on: here a PC's, whatever machine runs the test.
// One button shows at a time: the rail's search field from 80rem, the header row's below.
for (const { width, name } of [
  { width: 1280, name: 'Search' },
  { width: 1024, name: 'Command menu' },
]) {
  test(`at ${width} px its one button, ${name}, opens it, and focus goes back to it when it closes`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.addInitScript(() =>
      Object.defineProperty(navigator, 'platform', { get: () => 'Linux x86_64' }),
    );
    await ready(page);
    await expect(opener(page)).toHaveCount(1);
    await expect(opener(page)).toHaveAccessibleName(`${name} Ctrl K`);
    await opener(page).focus();
    await page.keyboard.press('Enter');
    await expect(input(page)).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(opener(page)).toBeFocused();
    await opener(page).click();
    await expect(menu(page)).toHaveJSProperty('open', true);
  });
}

test('on an Apple keyboard the button names ⌘K', async ({ page }) => {
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' }),
  );
  await ready(page);
  await expect(opener(page)).toHaveAccessibleName(/ ⌘K$/);
});

// ADR 0022: the rail's search finds every demo and post, by its title or a word of its summary, and
// Enter goes to the row that holds the query whole: "bak" is the bakery, though "Break a Raft
// cluster" holds b, a and k in order.
test('the search finds a demo by its title or its summary, and Enter opens the whole match', async ({
  page,
}) => {
  const demos = pages().filter((path) => /^\/lab\/[^/]+\/$/.test(path));
  test.skip(!demos.includes('/lab/routes/'), 'this build has no Route Lab');
  await ready(page, '/about/');
  await opener(page).click();
  await input(page).fill('vroom');
  expect((await rows(page)).shown).toEqual(['palette-lab-routes']);
  await input(page).fill('bak');
  expect((await rows(page)).active).toBe('palette-lab-routes');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/lab\/routes\/$/);
});

test('typing filters the rows by subsequence, hides empty groups, and selects the first match', async ({
  page,
}) => {
  await ready(page);
  await page.keyboard.press('Control+k');
  await expect
    .poll(() => rows(page))
    .toEqual({
      shown: expect.arrayContaining(['palette-home', 'palette-copy', 'palette-theme']),
      active: 'palette-home',
    });
  // Opening says nothing: not the count either, once the pause before it has passed.
  await page.waitForTimeout(700);
  await expect(said(page)).toHaveText('');
  await page.keyboard.type('rsm');
  expect(await rows(page)).toEqual({ shown: ['palette-about'], active: 'palette-about' });
  await expect(page.getByRole('group', { name: 'Actions' })).toBeHidden();
  await expect(said(page)).toHaveText('1 result');
  // Its keywords count too, and accents do not.
  await input(page).fill('cv');
  expect((await rows(page)).shown).toEqual(['palette-about']);
  await input(page).fill('zzzz');
  expect(await rows(page)).toEqual({ shown: [], active: null });
  await expect(page.locator('[data-palette-empty]')).toBeVisible();
  await expect(said(page)).toHaveText('No matches');
});

test('the arrows move the selection, wrapping at the ends, and Enter goes to the page', async ({
  page,
}) => {
  await ready(page);
  await page.keyboard.press('Control+k');
  const { shown } = await rows(page);
  await page.keyboard.press('ArrowUp');
  expect((await rows(page)).active).toBe(shown.at(-1));
  await page.keyboard.press('ArrowDown');
  expect((await rows(page)).active).toBe(shown[0]);
  await page.keyboard.press('ArrowDown');
  expect((await rows(page)).active).toBe(shown[1]);
  // The selected row is the one the input names, and the only one marked selected.
  await expect(page.locator('[aria-selected="true"]')).toHaveCount(1);
  await expect(page.locator(`#${shown[1]}`)).toHaveAttribute('aria-selected', 'true');
  // The menu closes before the browser leaves, so no snapshot of the page carries it open: as the
  // page starts to unload (before pagehide, whose handler would close it anyway), it is closed.
  // window.name outlives the page, within this origin.
  await page.evaluate(() =>
    addEventListener('beforeunload', () => {
      window.name = String(document.querySelector('dialog')?.open);
    }),
  );
  await input(page).fill('resume');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/about\/$/);
  expect(await page.evaluate(() => window.name)).toBe('false');
});

test('a click on a row goes there, and a click on the backdrop closes the menu', async ({
  page,
}) => {
  await ready(page);
  await page.keyboard.press('Control+k');
  await input(page).click();
  await expect(menu(page)).toHaveJSProperty('open', true);
  // A click on a heading leaves focus in the input, where the keys work.
  await page.locator('#palette-go').click();
  await expect(input(page)).toBeFocused();
  await page.mouse.click(4, 4);
  await expect(menu(page)).toHaveJSProperty('open', false);
  await page.keyboard.press('Control+k');
  await page.getByRole('option', { name: 'Writing' }).click();
  await expect(page).toHaveURL(/\/writing\/$/);
});

test('Copy email address copies it and says so; the menu stays open', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await ready(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('copy');
  await page.keyboard.press('Enter');
  await expect(note(page)).toHaveText('Copied');
  await expect(said(page)).toHaveText('Copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CONTACT_EMAIL);
  await expect(input(page)).toBeFocused();
  // By pointer, and focus goes back to the input.
  await page.getByRole('option', { name: /^Copy email address/ }).click();
  await expect(input(page)).toBeFocused();
});

test('when the browser refuses the copy, the line shows the address to copy by hand', async ({
  page,
}) => {
  await page.addInitScript(() => {
    navigator.clipboard.writeText = () => Promise.reject(new DOMException('no', 'NotAllowedError'));
  });
  await ready(page);
  await page.keyboard.press('Control+k');
  await page.keyboard.type('copy');
  await page.keyboard.press('Enter');
  await expect(note(page)).toHaveText(`Could not copy. The address is ${CONTACT_EMAIL}.`);
});

test('the theme entry presses the toggle, and its name follows the toggle’s', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await ready(page);
  const toggle = page.getByRole('button', { name: /^Theme: / });
  await page.keyboard.press('Control+k');
  await page.keyboard.type('theme');
  const entry = page.getByRole('option', { name: /^Theme: / });
  await expect(entry).toHaveAccessibleName('Theme: system');
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(entry).toHaveAccessibleName('Theme: light');
  await expect(said(page)).toHaveText('Theme: light');
  await page.keyboard.press('Escape');
  await expect(toggle).toHaveAccessibleName('Theme: light');
  expect(await page.evaluate(() => Object.keys(sessionStorage))).toEqual(['theme']);
  expect(await page.evaluate(() => Object.keys(localStorage))).toEqual([]);
});

test('in forced colors the theme entry is gone, as the toggle is', async ({ page }) => {
  await page.emulateMedia({ forcedColors: 'active' });
  await ready(page);
  await page.keyboard.press('Control+k');
  expect((await rows(page)).shown).not.toContain('palette-theme');
  // Not only unseen: no row is selected, the menu says so, and Enter presses nothing.
  await input(page).fill('theme');
  expect(await rows(page)).toEqual({ shown: [], active: null });
  await expect(page.locator('[data-palette-empty]')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'system');
});

// Where the button shows: on a page whose script runs, under a pointer that can hover. A phone has
// the nav and the footer for everything the menu holds, and the keys still open it.
test.describe('on a touch screen', () => {
  test.use({ hasTouch: true, isMobile: true });
  test('the button is not there, and the keys still open the menu', async ({ page }) => {
    await ready(page);
    // Not there at all, so it holds no place in the footer's row.
    expect(await page.locator('.palette-item').boundingBox()).toBeNull();
    await page.keyboard.press('Control+k');
    await expect(menu(page)).toHaveJSProperty('open', true);
  });
});

test.describe('without JavaScript', () => {
  test.use({ javaScriptEnabled: false });
  test('the button is not there either', async ({ page }) => {
    await page.goto('/');
    expect(await page.locator('.palette-item').boundingBox()).toBeNull();
    await expect(page.locator('html')).not.toHaveAttribute('data-palette');
  });
});

for (const path of [...pages(), NOT_FOUND_PAGE]) {
  test(`${path}: open, the menu passes axe in light, dark and forced colors, with no policy violation or motion`, async ({
    page,
  }) => {
    const violations: string[] = [];
    page.on('console', (m) => {
      if (/content security policy/i.test(m.text())) violations.push(m.text());
    });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await ready(page, path);
    await page.keyboard.press('Control+k');
    await expect(menu(page)).toHaveJSProperty('open', true);
    expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
    for (const media of [
      { colorScheme: 'dark' as const },
      { colorScheme: 'light' as const },
      { colorScheme: 'light' as const, forcedColors: 'active' as const },
    ]) {
      await page.emulateMedia(media);
      const { violations: found } = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
        .analyze();
      expect(found.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
    }
    expect(violations).toEqual([]);
  });
}

test('at 320 px and 32 px default text the open menu fits the screen', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  const devtools = await page.context().newCDPSession(page);
  await devtools.send('Page.setFontSizes', { fontSizes: { standard: 32, fixed: 26 } });
  await ready(page);
  await page.keyboard.press('Control+k');
  const box = await menu(page).boundingBox();
  expect(box).not.toBeNull();
  expect((box?.x ?? -1) >= 0 && (box?.x ?? 0) + (box?.width ?? 0) <= 320).toBe(true);
  expect((box?.y ?? -1) >= 0 && (box?.y ?? 0) + (box?.height ?? 0) <= 640).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  // Each row's label stays inside the menu.
  const overflow = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('dialog[data-palette] [role="option"]')]
      .filter((o) => o.checkVisibility() && o.scrollWidth > o.clientWidth + 1)
      .map((o) => o.id),
  );
  expect(overflow).toEqual([]);
});
