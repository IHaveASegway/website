import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ORIGIN, SITE_PAGES, WRITING_FIXTURE_PAGES } from '../e2e/expected';
import { app, dist, files, fixture } from './support/dist';

// The URL scheme as a fitness function over the build output (ADR 0005, delivery.md "Quality
// gates"): every internal link ends in "/", page URLs carry no capital, extension or date, the
// sitemap lists exactly the built pages, /lab/api/ stays reserved for the lab Worker, and a URL
// once published never leaves without a 301. Run on a fixture build too (support/dist.ts), where
// the ledger checks give way to the fixture's own page list.
const html = files.filter((file) => file.endsWith('.html'));

const NOINDEX = '<meta name="robots" content="noindex">';
const noindex = (page: string) =>
  readFileSync(join(dist, page.slice(1), 'index.html'), 'utf8').includes(NOINDEX);

/** URL path of each built page: "index.html" is "/", "a/b/index.html" is "/a/b/". */
const pages = html
  .filter((file) => file.endsWith('index.html'))
  .map((file) => `/${file.slice(0, -'index.html'.length)}`);

/** The pages a reader and a crawler can find: every page but a draft, which is noindex and exists
 *  only in a pull request preview (lib/posts.ts). The sitemap, the e2e list and the ledger hold
 *  these. */
const indexable = pages.filter((page) => !noindex(page));

/** Every href in a document, with the element and rel it came from. */
function links(file: string): { tag: string; rel: string; href: string }[] {
  const source = readFileSync(join(dist, file), 'utf8');
  return [...source.matchAll(/<(a|link)\b([^>]*)>/gi)].flatMap(([, tag = '', attributes = '']) => {
    const href = /\shref="([^"]*)"/i.exec(attributes)?.[1];
    const rel = /\srel="([^"]*)"/i.exec(attributes)?.[1] ?? '';
    return href === undefined ? [] : [{ tag: tag.toLowerCase(), rel, href }];
  });
}

/** The path of an internal URL, or null for an external one (mailto:, another host). */
function internalPath(href: string): string | null {
  if (href.startsWith('#')) return null;
  const url = new URL(href, `${ORIGIN}/`);
  return url.origin === ORIGIN ? url.pathname : null;
}

const SEGMENT = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE = /(^|\/)\d{4}(\/|-\d{2})/;

describe('page URLs', () => {
  test('there is a home page and a 404 page', () => {
    expect(pages).toContain('/');
    expect(files).toContain('404.html');
  });

  for (const page of pages) {
    test(`${page} is lowercase words joined by hyphens, with no extension or date`, () => {
      const segments = page.split('/').filter(Boolean);
      for (const segment of segments) expect(segment, page).toMatch(SEGMENT);
      expect(page).not.toMatch(DATE);
    });
  }

  test('/lab/api/ is reserved for the lab Worker: no page, no lab entry named api', () => {
    expect(pages.filter((page) => page.startsWith('/lab/api/'))).toEqual([]);
    const lab = join(app, 'src', 'content', 'lab');
    const entries = existsSync(lab) ? readdirSync(lab) : [];
    expect(entries.filter((name) => /^api\./i.test(name))).toEqual([]);
    expect(existsSync(join(app, 'src', 'pages', 'lab', 'api'))).toBe(false);
  });
});

describe('links in the built pages', () => {
  for (const file of html) {
    test(`${file}: internal links end in "/" unless they name a file`, () => {
      for (const { tag, href } of links(file)) {
        const path = internalPath(href);
        if (path === null) continue;
        // Files keep their extensions (robots.txt, the icons, a feed); everything else is a page.
        const namesAFile = /\.[a-z0-9]+$/i.test(path) && files.includes(path.slice(1));
        if (!namesAFile) expect(path.endsWith('/'), `<${tag} href="${href}">`).toBe(true);
      }
    });
  }

  for (const file of html.filter((f) => f.endsWith('index.html'))) {
    test(`${file}: the canonical URL is absolute, on the site, and ends in "/"`, () => {
      const canonical = links(file).filter(({ rel }) => rel === 'canonical');
      expect(canonical).toHaveLength(1);
      const href = canonical[0]?.href ?? '';
      expect(href.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(href.endsWith('/')).toBe(true);
      expect(`/${file.slice(0, -'index.html'.length)}`).toBe(new URL(href).pathname);
    });
  }
});

describe('the sitemap', () => {
  const index = readFileSync(join(dist, 'sitemap-index.xml'), 'utf8');
  const locs = (xml: string) =>
    [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc = '']) => loc);
  const listed = locs(index).flatMap((sitemap) => {
    const name = new URL(sitemap).pathname.slice(1);
    return locs(readFileSync(join(dist, name), 'utf8'));
  });

  test('every URL is absolute on the site and ends in "/"', () => {
    for (const url of listed) {
      expect(url.startsWith(`${ORIGIN}/`), url).toBe(true);
      expect(url.endsWith('/'), url).toBe(true);
    }
  });

  test('it lists exactly the indexable pages: never the 404, never a draft', () => {
    expect(listed.map((url) => new URL(url).pathname).sort()).toEqual([...indexable].sort());
  });
});

describe('the page list the e2e checks walk', () => {
  test('e2e/expected.ts lists exactly the indexable pages, so none skips axe, CSP or the smoke', () => {
    expect([...(fixture ? WRITING_FIXTURE_PAGES : SITE_PAGES)].sort()).toEqual(
      [...indexable].sort(),
    );
  });

  test('the 404 page is noindex, and no page in the sitemap is', () => {
    expect(readFileSync(join(dist, '404.html'), 'utf8')).toContain(NOINDEX);
    for (const page of indexable) {
      const file = join(dist, page.slice(1), 'index.html');
      expect(readFileSync(file, 'utf8'), page).not.toMatch(/<meta name="robots"/i);
    }
  });

  test('a noindex page is a draft, and a production build has none (DRAFTS, lib/posts.ts)', () => {
    for (const page of pages.filter(noindex)) {
      expect(page, 'only posts can be drafts').toMatch(/^\/(writing|notes)\/[a-z0-9-]+\/$/);
      expect(readFileSync(join(dist, page.slice(1), 'index.html'), 'utf8')).toContain(
        '<p class="label">Draft · ',
      );
    }
    if (process.env['DRAFTS'] !== 'include') expect(pages.filter(noindex)).toEqual([]);
  });
});

// ADR 0005: "Slugs never change. A rename adds a 301." Production's sitemap is not reachable from
// verify, which has no network by design, so the URLs once published are kept in a ledger beside
// the site instead: appended to, never edited, and read here. A fixture build publishes nothing.
describe.skipIf(fixture)('a URL once published never leaves without a 301', () => {
  const lines = (text: string) =>
    text
      .split('\n')
      .map((line) => line.replace(/#.*/, '').trim())
      .filter(Boolean);
  const ledger = lines(readFileSync(join(app, 'published-urls.txt'), 'utf8'));
  const redirectsFile = join(app, 'public', '_redirects');
  const redirects = existsSync(redirectsFile)
    ? lines(readFileSync(redirectsFile, 'utf8')).map((line) => line.split(/\s+/))
    : [];
  /** A 301's source covers a URL exactly, or, ending in "*", as a prefix. */
  const covered = (url: string) =>
    redirects.some(
      ([from = '', , status]) =>
        status === '301' && (from.endsWith('*') ? url.startsWith(from.slice(0, -1)) : from === url),
    );

  test('the ledger lists each URL once, each in the page URL form', () => {
    expect(new Set(ledger).size).toBe(ledger.length);
    for (const url of ledger) expect(url).toMatch(/^\/([a-z0-9]+(-[a-z0-9]+)*\/)*$/);
  });

  test('every built page is in published-urls.txt: once deployed, its URL is public for good', () => {
    expect(indexable.filter((page) => !ledger.includes(page))).toEqual([]);
  });

  test('every URL in the ledger is still a page, or the source of a 301 in public/_redirects', () => {
    expect(ledger.filter((url) => !indexable.includes(url) && !covered(url))).toEqual([]);
  });

  test('every redirect states its status, since the default is a temporary 302', () => {
    for (const [from, to, status] of redirects) {
      expect(status, `${from} -> ${to}`).toMatch(/^(301|302|303|307|308)$/);
    }
  });
});
