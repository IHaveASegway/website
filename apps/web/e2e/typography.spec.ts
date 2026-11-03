import { expect, test } from '@playwright/test';
import { pages } from './expected';

// One kind of apostrophe, in the browser (lib/typeset.mjs). test/typography.test.ts reads what the
// build wrote. A lab writes its own lines once it runs, from strings in its simulation, and a line
// drawn at build shouldn't change its mark when the run takes it over. So this reads each lab's words
// after it has played, as a visitor who lands on it sees them.

/** What a page's main shows, its words split on what they touch: a straight mark beside a word. */
const straightMarks = (page: import('@playwright/test').Page) =>
  page.locator('main').evaluate((main) =>
    [...main.querySelectorAll('*')]
      .filter((element) => !element.closest('code, pre, kbd, samp, var, script, style'))
      .flatMap((element) =>
        [...element.childNodes]
          .filter((node) => node.nodeType === Node.TEXT_NODE)
          .map((node) => node.textContent ?? ''),
      )
      .filter((text) => /\w['"]|['"]\w/.test(text)),
  );

const LABS = ['raft', 'queue', 'cache', 'backfill'];

for (const slug of LABS) {
  test(`the ${slug} lab keeps one kind of apostrophe once it runs`, async ({ page }) => {
    const path = `/lab/${slug}/`;
    test.skip(!pages().includes(path), 'this build has no such lab');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto(path);
    expect(await straightMarks(page), 'as the build drew it').toEqual([]);
    // It runs by itself where motion is allowed (ADR 0030). Let it write a good few lines, then
    // press its own Next event too, which writes through the words the page says aloud.
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'on');
    await page.waitForTimeout(2_500);
    expect(await straightMarks(page), 'running').toEqual([]);
    const next = page.getByRole('button', { name: 'Next event' });
    if (await next.isVisible()) {
      await next.click();
      await page.waitForTimeout(100);
      expect(await straightMarks(page), 'after a press').toEqual([]);
    }
  });
}

// The known answer: the same reading finds a straight mark in a line, and passes one inside code.
test('known answer: a straight mark beside a word is found, and code is left alone', async ({
  page,
}) => {
  await page.goto('/about/');
  await page.evaluate(() => {
    const main = document.querySelector('main') as Element;
    main.insertAdjacentHTML('beforeend', "<p>it's <code>don't</code></p>");
  });
  expect(await straightMarks(page)).toEqual(["it's "]);
});

// What follows inline code reads as following it: on a ground that hardly showed, the chip's padding
// read as a stray space, "action . It reads side . So", in an essay about precision.
test('inline code shows as a chip, with little padding before what follows it', async ({ page }) => {
  const path = '/writing/trading-bot-teardown/';
  test.skip(!pages().includes(path), 'this build has no such post');
  await page.goto(path);
  const chip = await page.locator('.prose :not(pre) > code').first().evaluate((code) => {
    const style = getComputedStyle(code);
    const probe = document.createElement('div');
    probe.style.setProperty('background-color', 'var(--surface-2)');
    document.body.append(probe);
    const surface = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { padding: parseFloat(style.paddingInlineEnd), ground: style.backgroundColor, surface };
  });
  expect(chip.padding).toBeLessThanOrEqual(4);
  expect(chip.ground).toBe(chip.surface);
});
