import { expect, test } from '@playwright/test';
import { wcagContrast } from 'culori';
import { NOT_FOUND_PAGE, pages } from './expected';

// Every page on paper (global.css, "Every page on paper"; design-system.md, "Print"): no control,
// each link's address printed after it, hairlines a printer keeps whatever the screen showed, and
// inline code without the padding that reads as a stray space. It runs on the site and on the
// writing fixture, whose posts hold every kind of link and code a post can.

const ROUTES = [...pages(), NOT_FOUND_PAGE];

/** Links that print no address of their own: the name in the header, a button (Home's, the
 *  404's way home), and the résumé's notes, whose addresses the footer or the contact list prints;
 *  the map's attribution, whose address the write-up's credits print; and the parts of Home's
 *  drawing, SVG links that cannot print text after them, whose addresses the lab cards under the
 *  drawing print (ADR 0027). */
const PRINTS_ELSEWHERE = '.wordmark, .btn, .resume-notes a, .rl-attribution a, .iso-node';

for (const path of ROUTES) {
  test(`${path} on paper: no control, and every link prints its address`, async ({ page }) => {
    await page.goto(path);
    await page.emulateMedia({ media: 'print' });
    const paper = await page.evaluate((elsewhere) => {
      const shown = (e: Element) => e.checkVisibility();
      const links = [...document.querySelectorAll<HTMLAnchorElement>('a[href]')].filter(shown);
      return {
        controls: [
          ...document.querySelectorAll(
            '.skip-link, .site-nav, .theme-toggle, .palette-item, .print-item',
          ),
        ]
          .filter(shown)
          .map((e) => e.className),
        header: [...document.querySelectorAll('.site-header')].filter(shown).length,
        links: links
          .filter((a) => !a.matches(elsewhere))
          .map((a) => ({
            href: a.getAttribute('href') ?? '',
            text: a.textContent?.replace(/\s+/g, '') ?? '',
            after: getComputedStyle(a, '::after').content,
          })),
      };
    }, PRINTS_ELSEWHERE);
    expect(paper.controls).toEqual([]);
    // Home's header holds nothing but controls, and /about/'s head carries the name, so neither
    // prints one; every other page prints the name.
    expect(paper.header).toBe(path === '/' || path === '/about/' ? 0 : 1);
    for (const { href, text, after } of paper.links) {
      const address = href.startsWith('/')
        ? `ihaveasegway.com${href}`
        : href.replace(/^mailto:/, '');
      if (href.startsWith('#')) {
        // A link within the page has nowhere to send paper.
        expect(after, href).toBe('none');
      } else if (text.includes(address.replace(/^https:\/\/(www\.)?/, '').replace(/\/$/, ''))) {
        // The words are the address already: the footer's email, the résumé's contact list.
        expect(after, href).toBe('none');
      } else {
        expect(after, href).toBe(`"${address}"`);
      }
    }
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`on paper the hairlines and underlines are the same gray from a ${theme} screen`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: theme });
    await page.goto('/');
    await page.emulateMedia({ media: 'print' });
    const tokens = await page.evaluate(() => {
      const probe = document.createElement('div');
      document.body.append(probe);
      const resolve = (token: string) => {
        probe.style.color = `var(${token})`;
        return getComputedStyle(probe).color;
      };
      return { border: resolve('--border'), input: resolve('--input') };
    });
    // A rule a printer keeps, and an underline at 3:1 against the paper (SC 1.4.11).
    expect(wcagContrast(tokens.border, 'white')).toBeGreaterThanOrEqual(2);
    expect(wcagContrast(tokens.input, 'white')).toBeGreaterThanOrEqual(3);
    expect(tokens).toEqual({ border: 'oklch(0.75 0 0)', input: 'oklch(0.55 0 0)' });
  });
}

test('inline code has no padding on paper or in forced colors, and keeps it on screen', async ({
  page,
}) => {
  const posts = pages().filter((path) => /^\/(writing|notes)\/[^/]+\/$/.test(path));
  test.skip(posts.length === 0, 'no post in this build');
  /** The padding of each piece of inline code on the page, in the media emulated now. */
  const paddings = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.prose :not(pre) > code')].map(
        (code) => getComputedStyle(code).paddingInline,
      ),
    );
  let seen = 0;
  for (const post of posts) {
    await page.emulateMedia({ media: 'screen', forcedColors: 'none' });
    await page.goto(post);
    const screen = await paddings();
    seen += screen.length;
    for (const padding of screen) expect(padding, post).not.toBe('0px');
    await page.emulateMedia({ media: 'print' });
    for (const padding of await paddings()) expect(padding, post).toBe('0px');
    await page.emulateMedia({ media: 'screen', forcedColors: 'active' });
    for (const padding of await paddings()) expect(padding, post).toBe('0px');
  }
  // Every build with a post has one with inline code, so this check always has something to read.
  expect(seen).toBeGreaterThan(0);
});

// Home on paper is its opening in one column, each part as tall as it draws (home.css): a page is
// narrower than 64rem, so the phone's rows apply on paper, the name, the role and the buttons, then
// the drawing, then the bio's blocks, with no gap between them wider than a line. Until ADR 0027 the
// check was that the scene's row held nothing on paper; until 2026-10-30 it kept its 18.75rem, a
// blank gap of 300 px between the buttons and the bio's opening.
test('Home on paper keeps no gap between the buttons, the drawing and the blocks', async ({
  page,
}) => {
  await page.setViewportSize({ width: 816, height: 1056 });
  await page.goto('/');
  await page.emulateMedia({ media: 'print' });
  const gaps = await page.evaluate(() => {
    const box = (selector: string) => document.querySelector(selector)?.getBoundingClientRect();
    const [actions, drawing, blocks] = ['.intro-actions', 'figure.iso', '.bio-blocks'].map(box);
    return actions && drawing && blocks
      ? [drawing.top - actions.bottom, blocks.top - drawing.bottom]
      : null;
  });
  test.skip(gaps === null, 'Home has no drawing or bio here');
  for (const gap of gaps ?? []) {
    expect(gap).toBeGreaterThanOrEqual(0);
    expect(gap).toBeLessThan(48);
  }
});
