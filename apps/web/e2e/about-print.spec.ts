import { expect, test, type Page } from '@playwright/test';

// /about/ on paper, the résumé (content.md, "Résumé"): one US Letter page, with nothing of the
// site's own chrome on it and every link's address printed after it. It runs on the site and on the
// writing fixture, whose profile holds ten roles and twelve skills, the schema's limits, and a card
// and posts, so the one-page rule holds for any profile the schema admits, not only today's. The
// site hosts no PDF: this prints the page in the browser and reads the result, as a visitor's Print
// button does. (At /resume/ until 2026-10-28; the file was resume.spec.ts.)

const RESUME = '/about/';

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

test('/about/ prints on exactly one US Letter page', async ({ page }) => {
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

// A larger default text size scales the printed type with it. The addresses stand beside the name
// while the two fit across the page, and go under it from a larger size, so the name breaks only
// between its words. Emulated print lays the page out at the viewport's width, so the viewport is
// the printed column: Letter less two half-inch margins.
for (const size of [16, 20, 24, 32]) {
  test(`on paper at ${size} px default text the name breaks only between its words`, async ({
    page,
  }) => {
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('Page.setFontSizes', {
      fontSizes: { standard: size, fixed: Math.round((size * 13) / 16) },
    });
    await page.setViewportSize({ width: 720, height: 1000 });
    await page.goto(RESUME);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.fonts.ready);
    const head = await page.evaluate(() => {
      const name = document.querySelector('.hero-name') as Element;
      const text = [...name.childNodes].find((n) => n.nodeType === Node.TEXT_NODE) as Text;
      const broken = [...(text.textContent ?? '').matchAll(/\S+/g)].filter((word) => {
        const range = document.createRange();
        range.setStart(text, word.index);
        range.setEnd(text, word.index + word[0].length);
        return new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1;
      });
      const box = (selector: string) =>
        (document.querySelector(selector) as Element).getBoundingClientRect();
      return {
        broken: broken.map(([word]) => word),
        beside: box('.resume-contact').left >= box('.hero-name').right,
      };
    });
    expect(head.broken).toEqual([]);
    expect(head.beside).toBe(size === 16);
  });
}

// On a phone the contact list puts each label above its address (global.css, the contact
// container), so an address has the list's whole width. Beside its label, LinkedIn's address took
// two lines at 390 px and the default size, and at 32 px the web address broke as "ihaveasegw / ay.com".
for (const size of [16, 32]) {
  test(`at 390 px and ${size} px default text the résumé's addresses keep their words`, async ({
    page,
  }) => {
    const devtools = await page.context().newCDPSession(page);
    await devtools.send('Page.setFontSizes', {
      fontSizes: { standard: size, fixed: Math.round((size * 13) / 16) },
    });
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(RESUME);
    await page.evaluate(() => document.fonts.ready);
    const lines = await page.evaluate(() =>
      [...document.querySelectorAll('.resume-contact dd a')].map((link) => {
        const range = document.createRange();
        range.selectNodeContents(link);
        // Each line's text, from the rects of the characters on it.
        const text = link.textContent ?? '';
        const rows = new Map<number, string>();
        const walker = document.createTreeWalker(link, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          for (let i = 0; i < (node.textContent ?? '').length; i++) {
            range.setStart(node, i);
            range.setEnd(node, i + 1);
            const rect = range.getBoundingClientRect();
            if (rect.width === 0) continue;
            const top = Math.round(rect.top);
            rows.set(top, (rows.get(top) ?? '') + (node.textContent ?? '')[i]);
          }
        }
        return { text: text.replace(/\s+/g, ''), rows: [...rows.values()] };
      }),
    );
    const [email, web, linkedIn] = lines;
    if (size === 16) {
      for (const address of lines) expect(address.rows, address.text).toHaveLength(1);
    } else {
      expect(web?.rows, web?.text).toHaveLength(1);
      // The email breaks only after its "@"; LinkedIn's, wider than the screen, may break anywhere.
      expect(email?.rows).toEqual(['hello@', 'ihaveasegway.com']);
      expect(linkedIn?.rows.length).toBeGreaterThan(1);
    }
  });
}

test('on screen the header links About, marked as the current page there, and no Résumé', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.site-nav a[href="/about/"]')).toHaveText('About');
  await expect(page.locator('a[href="/resume/"]')).toHaveCount(0);
  await page.goto(RESUME);
  await expect(page.locator('.site-nav a[href="/about/"]')).toHaveAttribute('aria-current', 'page');
});

// The bio prints its first paragraph, the summary a printed résumé opens with, and nothing else of
// it: the page stays one sheet whatever the profile holds (global.css, "The résumé on paper"). The
// fixture builds hold no bio, so there the check has nothing to read.
test('on paper the bio keeps its first paragraph only, and the Print button is gone', async ({
  page,
}) => {
  await page.goto(RESUME);
  await page.emulateMedia({ media: 'print' });
  const paper = await page.evaluate(() => ({
    bio: [...document.querySelectorAll('.bio .prose > *')].map((e) => e.checkVisibility()),
    button: [...document.querySelectorAll('[data-print]')].map((e) => e.checkVisibility()),
  }));
  if (paper.bio.length > 0) expect(paper.bio).toEqual(paper.bio.map((_, i) => i === 0));
  expect(paper.button).toEqual([false]);
});

// The Print button opens the browser's own print, whose dialog saves a PDF (content.md, "Résumé"):
// it shows once src/scripts/palette.js has bound it, and the command menu's Print row presses it.
test("the Print button, and the menu's Print row, open the browser's print", async ({ page }) => {
  await page.addInitScript(() => {
    (window as unknown as { printed: number }).printed = 0;
    window.print = () => void ((window as unknown as { printed: number }).printed += 1);
  });
  await page.goto(RESUME);
  const button = page.getByRole('button', { name: 'Print or save as PDF' });
  await expect(page.locator(':root[data-palette]')).toHaveCount(1);
  await expect(button).toBeVisible();
  await button.click();
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox').fill('pdf');
  await page.keyboard.press('Enter');
  await expect(page.locator('dialog[data-palette]')).not.toHaveAttribute('open');
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(2);
});
