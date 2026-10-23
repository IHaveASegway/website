import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { ORIGIN, SITE_PAGES, WRITING_FIXTURE_PAGES } from '../e2e/expected';
import { app, dist, files, fixture, previewBuild } from './support/dist';

// The URL scheme as a fitness function over the build output (ADR 0005, delivery.md "Quality
// gates"): every internal link ends in "/", page URLs carry no capital, extension or date, the
// sitemap lists exactly the built pages, /lab/api/ stays reserved for the lab Worker, and a URL
// once published never leaves without a 301. Run on the preview build and the fixture builds too
// (support/dist.ts); on a fixture the ledger checks give way to the fixture's own page list.
const html = files.filter((file) => file.endsWith('.html'));
const fixtureBuild = fixture?.startsWith('.fixtures/') ?? false;

const NOINDEX = '<meta name="robots" content="noindex">';
const noindex = (page: string) =>
  readFileSync(join(dist, page.slice(1), 'index.html'), 'utf8').includes(NOINDEX);

/** URL path of each built page: "index.html" is "/", "a/b/index.html" is "/a/b/". */
const pages = html
  .filter((file) => file.endsWith('index.html'))
  .map((file) => `/${file.slice(0, -'index.html'.length)}`);

/** The pages a reader and a crawler can find: every page but a draft or an unlisted post, which are
 *  noindex and exist only in a preview build (lib/posts.ts). The sitemap, the e2e list and the
 *  ledger hold these. */
const indexable = pages.filter((page) => !noindex(page));

/** The indexable pages this build must write: the ledger's for dist/ and dist-preview/, the
 *  fixture's for fixture-many (with drafts or without), and Home alone below 3 posts. */
const EXPECTED = fixture?.includes('fixture-many')
  ? WRITING_FIXTURE_PAGES
  : fixture?.includes('fixture-two')
    ? ['/']
    : SITE_PAGES;

/** Every href in a document, with the element and rel it came from. */
function links(file: string): { tag: string; rel: string; href: string }[] {
  const source = readFileSync(join(dist, file), 'utf8');
  return [...source.matchAll(/<(a|link)\b([^>]*)>/gi)].flatMap(([, tag = '', attributes = '']) => {
    const href = /\shref="([^"]*)"/i.exec(attributes)?.[1];
    const rel = /\srel="([^"]*)"/i.exec(attributes)?.[1] ?? '';
    return href === undefined ? [] : [{ tag: tag.toLowerCase(), rel, href }];
  });
}

/** The URL a built file is served at, so a relative link resolves as a browser resolves it there.
 *  The 404 page answers at any missing path, so its links resolve from the root. */
const pageUrl = (file: string) =>
  `${ORIGIN}/${file === '404.html' ? '' : file.replace(/index\.html$/, '')}`;

/** The path an href on a page leads to, or null for a fragment or an external URL (mailto:,
 *  another host). Resolved against the page's own URL: "../b/" on /writing/a/ is /writing/b/. */
function internalPath(href: string, base: string): string | null {
  if (href.startsWith('#')) return null;
  const url = new URL(href, base);
  return url.origin === ORIGIN ? url.pathname : null;
}

/** A built page as the draft-link rule reads it: its URL, whether it is a draft, and its links. */
interface LinkedPage {
  readonly url: string;
  readonly draft: boolean;
  readonly hrefs: readonly string[];
}

/**
 * Each link from a page that is not a draft to a draft: "<from> links <to>". The guarantee: no
 * page but a draft links a draft, whatever the post count, so no published post does, listed or
 * unlisted below 3 posts. Only a preview build holds drafts, so that is where it bites; a draft is
 * told by its label, not by noindex, which an unlisted post has too.
 */
function draftLinks(built: readonly LinkedPage[]): string[] {
  const drafts = new Set(built.filter((p) => p.draft).map((p) => new URL(p.url).pathname));
  return built
    .filter((page) => !page.draft)
    .flatMap((page) =>
      page.hrefs
        .map((href) => internalPath(href, page.url))
        .filter((path): path is string => path !== null && drafts.has(path))
        .map((path) => `${new URL(page.url).pathname} links ${path}`),
    );
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
        const path = internalPath(href, pageUrl(file));
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
  test('the indexable pages are exactly the expected ones: the ledger, or the fixture list', () => {
    expect([...EXPECTED].sort()).toEqual([...indexable].sort());
  });

  test('the 404 page is noindex, and no page in the sitemap is', () => {
    expect(readFileSync(join(dist, '404.html'), 'utf8')).toContain(NOINDEX);
    for (const page of indexable) {
      const file = join(dist, page.slice(1), 'index.html');
      expect(readFileSync(file, 'utf8'), page).not.toMatch(/<meta name="robots"/i);
    }
  });

  test('a noindex page is a draft or an unlisted post, and only a preview build has one', () => {
    for (const page of pages.filter(noindex)) {
      expect(page, 'only posts can be drafts').toMatch(/^\/(writing|notes)\/[a-z0-9-]+\/$/);
      expect(readFileSync(join(dist, page.slice(1), 'index.html'), 'utf8')).toMatch(
        /<p class="label">(Draft|Unlisted) · /,
      );
    }
    // The backstop: dist/ is the build that deploys, so it holds none whatever DRAFTS says.
    if (!previewBuild) expect(pages.filter(noindex), 'a draft in a production build').toEqual([]);
  });
});

describe('every internal link resolves in this build', () => {
  /** The file an internal path is served from: a page's index.html, or the file it names. */
  const target = (path: string) =>
    path.endsWith('/') ? `${path.slice(1)}index.html` : path.slice(1);

  for (const file of html) {
    test(`${file}: every internal link names a page or a file this build writes`, () => {
      for (const { tag, href } of links(file)) {
        const path = internalPath(href, pageUrl(file));
        if (path === null) continue;
        expect(files.includes(target(path)), `<${tag} href="${href}">`).toBe(true);
      }
    });
  }

  // A preview builds drafts, so a published page linking one resolves there, and below 3 posts
  // dist/ builds no post at all. So the rule is checked on every build, by label.
  test('no page but a draft links a draft: no published post does, listed or unlisted', () => {
    const built = html.map((file) => ({
      url: pageUrl(file),
      draft: readFileSync(join(dist, file), 'utf8').includes('<p class="label">Draft · '),
      hrefs: links(file).map(({ href }) => href),
    }));
    expect(draftLinks(built)).toEqual([]);
  });

  test('known answers: what the draft-link rule flags, at any post count', () => {
    const page = (path: string, draft: boolean, ...hrefs: string[]) => ({
      url: `${ORIGIN}${path}`,
      draft,
      hrefs,
    });
    const draft = page(
      '/writing/part-two/',
      true,
      '/writing/part-one/',
      '../../notes/other-draft/',
    );
    const otherDraft = page('/notes/other-draft/', true);
    // A listed post, Home or an index linking a draft, absolutely or relatively.
    expect(draftLinks([draft, page('/writing/part-one/', false, '/writing/part-two/')])).toEqual([
      '/writing/part-one/ links /writing/part-two/',
    ]);
    expect(draftLinks([draft, page('/writing/part-one/', false, '../part-two/')])).toEqual([
      '/writing/part-one/ links /writing/part-two/',
    ]);
    expect(draftLinks([draft, page('/', false, 'writing/part-two/#a')])).toEqual([
      '/ links /writing/part-two/',
    ]);
    // Below 3 posts a published post is unlisted, and noindex, and still may not link a draft.
    expect(draftLinks([draft, page('/notes/cool-uris/', false, '/writing/part-two/')])).toEqual([
      '/notes/cool-uris/ links /writing/part-two/',
    ]);
    // A draft may link anything, a published page links published pages, and fragments are local.
    expect(
      draftLinks([draft, otherDraft, page('/writing/part-one/', false, '../a/', '#x')]),
    ).toEqual([]);
    // The relative form resolves from the page, not from the root: "../b/" on /writing/a/.
    expect(internalPath('../b/', `${ORIGIN}/writing/a/`)).toBe('/writing/b/');
    expect(internalPath('b/', `${ORIGIN}/writing/a/`)).toBe('/writing/a/b/');
    expect(internalPath('mailto:hello@ihaveasegway.com', `${ORIGIN}/`)).toBeNull();
  });
});

// ADR 0005: "Slugs never change. A rename adds a 301." Production's sitemap is not reachable from
// verify, which has no network by design, so the URLs once published are kept in a ledger beside
// the site instead: appended to, never edited, and read here. A fixture build publishes nothing.
describe.skipIf(fixtureBuild)('a URL once published never leaves without a 301', () => {
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
