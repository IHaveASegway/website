import { expect, test } from '@playwright/test';
import { NOT_FOUND_PAGE } from './expected';

// The command menu stops the page behind it scrolling by taking the window's scrollbar away
// (global.css). Where a scrollbar takes room, as on Windows or Linux, the page behind would jump
// sideways by its width unless the gutter stands either way. Headless Chromium hides its scrollbars
// unless asked, and a browser's launch options apply to a whole file, so this one is on its own. A
// tall page has a scrollbar to lose, and a short one has none: both must hold still.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

for (const [path, height] of [
  ['/about/', 700],
  [NOT_FOUND_PAGE, 2400],
] as const) {
  test(`on ${path} at ${height} px tall the open menu moves nothing behind it`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height });
    await page.goto(path);
    await expect(page.locator('html')).toHaveAttribute('data-palette', '');
    const place = () =>
      page.evaluate(() => ({
        main: (document.querySelector('main') as Element).getBoundingClientRect().width,
        title: (document.querySelector('h1') as Element).getBoundingClientRect().left,
      }));
    const before = await place();
    await page.keyboard.press('Control+k');
    await expect(page.locator('dialog[data-palette]')).toHaveJSProperty('open', true);
    expect(await place()).toEqual(before);
  });
}
