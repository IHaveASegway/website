import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { findHeld, parseHolds } from '../src/lib/held-names';
import { NOT_FOUND_PAGE, pages } from './expected';

// The hold list (not-on-site.txt), read off the page as the browser draws it. test/not-on-site.test.ts
// scans every file in dist/, reading markup by each element's default display; CSS can change a
// display, and only the browser knows what a reader finally sees. So this reads the rendered text,
// the title included, and fails on any held name in it.

const holds = parseHolds(readFileSync(new URL('../not-on-site.txt', import.meta.url), 'utf8'));

/** What a reader sees of the page: its title and the rendered text of its body. */
const seen = (page: Page) =>
  page.evaluate(() => [document.title, document.body.innerText].join('\n'));

for (const path of [...pages(), NOT_FOUND_PAGE]) {
  test(`no held name in the text ${path} draws`, async ({ page }) => {
    await page.goto(path);
    expect(findHeld(await seen(page), holds)).toEqual([]);
  });
}

test('known answer: a name split across two blocks that CSS sets inline is seen', async ({
  page,
}) => {
  const sample = parseHolds('zqquil|mox  any  throwaway: a one-word name\n');
  await page.goto('/');
  await page.evaluate(() => {
    const box = document.createElement('div');
    for (const part of ['zqquil', 'mox']) {
      const block = document.createElement('div');
      block.textContent = part;
      block.style.display = 'inline'; // the CSS object model, which the policy allows
      box.append(block);
    }
    document.querySelector('main')?.append(box);
  });
  expect(findHeld(await seen(page), sample)).toEqual(['zqquilmox']);
});
