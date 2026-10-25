import { expect, test, type Page } from '@playwright/test';

// The résumé on paper (content.md, "Résumé"): one US Letter page, with nothing of the site's own
// chrome on it and every link's address printed after it. It runs on the site and on the writing
// fixture, whose profile holds ten roles and twelve skills, the schema's limits, and a card and
// posts, so the one-page rule holds for any profile the schema admits, not only today's. The site
// hosts no PDF: this prints the page in the browser and reads the result.

const RESUME = '/resume/';

/** The page printed as Chromium prints it, Letter unless the page's CSS names a size. */
async function print(page: Page): Promise<{ pages: number; boxes: string[] }> {
  await page.evaluate(() => document.fonts.ready);
  const pdf = (await page.pdf({ format: 'Letter', preferCSSPageSize: true })).toString('latin1');
  return {
    pages: (pdf.match(/\/Type\s*\/Page(?!s)/g) ?? []).length,
    boxes: [
      ...new Set([...pdf.matchAll(/\/MediaBox\s*\[([^\]]*)\]/g)].map(([, box = '']) => box.trim())),
    ],
  };
}

test('/resume/ prints on exactly one US Letter page', async ({ page }) => {
  await page.goto(RESUME);
  const printed = await print(page);
  expect(printed.pages).toBe(1);
  expect(printed.boxes).toEqual(['0 0 612 792']);
});

// The known answer: a check that counted pages wrongly would pass every résumé. Forty roles, four
// times the schema's limit, cannot fit one page, and the count must say so.
test('known answer: forty roles print on more than one page, and the count says so', async ({
  page,
}) => {
  await page.goto(RESUME);
  await page.evaluate(() => {
    const notes = document.querySelector('.resume-notes');
    if (!notes) throw new Error('the résumé has no Experience notes');
    const row =
      '<li><p class="role-years">2019–2024</p><h3 class="role-title">A role added by the test</h3></li>';
    notes.insertAdjacentHTML('beforebegin', `<ol class="roles" role="list">${row.repeat(40)}</ol>`);
  });
  expect((await print(page)).pages).toBeGreaterThan(1);
});

test('on paper the site chrome is gone, the name is at a print size, and links show their address', async ({
  page,
}) => {
  await page.goto(RESUME);
  await page.emulateMedia({ media: 'print' });
  const paper = await page.evaluate(() => {
    const shown = (selector: string) =>
      [...document.querySelectorAll(selector)].filter((e) => getComputedStyle(e).display !== 'none')
        .length;
    const after = (a: Element) => getComputedStyle(a, '::after').content;
    const linked = [
      ...document.querySelectorAll<HTMLAnchorElement>(
        '.resume :is(.card-more, .post-title a, .post-links a)',
      ),
    ];
    return {
      chrome: shown('.site-header, .skip-link, body > footer, .theme-toggle, .skills dd'),
      name: parseFloat(getComputedStyle(document.querySelector('.hero-name') as Element).fontSize),
      addresses: linked.map((a) => [a.getAttribute('href'), after(a)]),
      contact: [...document.querySelectorAll('.resume-contact a, .resume-notes a')].map(after),
    };
  });
  expect(paper.chrome).toBe(0);
  expect(paper.name).toBeLessThanOrEqual(48);
  for (const [href, content] of paper.addresses) {
    // A page on the site prints with the domain; a repository with its own address.
    const address = href?.startsWith('/') ? `ihaveasegway.com${href}` : href;
    expect(content, String(href)).toBe(`"${address}"`);
  }
  // The contact list and the notes already show their addresses as their text.
  for (const content of paper.contact) expect(content).toBe('none');
});

test('on screen the header links the résumé, marked as the current page there', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.site-nav a[href="/resume/"]')).toHaveText('Résumé');
  await page.goto(RESUME);
  await expect(page.locator('.site-nav a[href="/resume/"]')).toHaveAttribute(
    'aria-current',
    'page',
  );
});
