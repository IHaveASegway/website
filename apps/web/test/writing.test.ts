import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { WRITING_FIXTURE_PAGES } from '../e2e/expected';
import { findHeld, parseHolds } from '../src/lib/held-names';
import {
  asDay,
  draftsIncluded,
  essaySchema,
  feedItems,
  isSlug,
  MIN_POSTS,
  newestFirst,
  noteSchema,
  postsBase,
  TAGS,
  writingArea,
  type Post,
} from '../src/lib/posts';
import { app, dist, files as distFiles, filesIn } from './support/dist';

// Writing (roadmap.md, PR 5): the rules in lib/posts.ts with known answers, then the three
// test-only fixture builds that scripts/build-fixtures.mjs writes, then the real build and the
// real posts. The "writing fixture" project in vitest.config.ts runs every other check over the
// build on fixture-three as well; this file holds what only a known set of posts can prove.

/** Every fixture post's summary carries this; no file the real build writes may. */
const SENTINEL = 'A test fixture, never published';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
function post(slug: string, over: Partial<Post> = {}): Post {
  return {
    section: 'writing',
    slug,
    title: `Title ${slug}`,
    summary: `Summary ${slug}`,
    published: day('2026-10-20'),
    updated: null,
    draft: false,
    tags: [],
    kind: 'essay',
    source: null,
    ...over,
  };
}
const note = (slug: string, over: Partial<Post> = {}) =>
  post(slug, { section: 'notes', kind: 'note', ...over });
const slugs = (posts: readonly Post[]) => posts.map((p) => p.slug);

describe(`the ${MIN_POSTS}-post rule (content.md, "Sitemap and phases")`, () => {
  test('0 and 2 published posts render nothing: no index, no page, no feed', () => {
    for (const posts of [[], [post('a'), note('b')]]) {
      const area = writingArea(posts, false);
      expect(area.visible).toBe(false);
      expect(area.sections).toEqual([]);
      expect(area.pages).toEqual([]);
      expect(feedItems(area)).toEqual([]);
    }
  });

  test('3 render it: /writing/, /notes/ once a note is published, and a page per post', () => {
    const essays = writingArea([post('a'), post('b'), post('c')], false);
    expect(essays.visible).toBe(true);
    expect(essays.sections).toEqual(['writing']);
    expect(slugs(essays.pages).sort()).toEqual(['a', 'b', 'c']);
    const mixed = writingArea([post('a'), post('b'), note('c')], false);
    expect(mixed.sections).toEqual(['writing', 'notes']);
  });

  test('a draft never counts toward the rule, even where drafts are included', () => {
    const posts = [post('a'), note('b'), post('c', { draft: true })];
    expect(writingArea(posts, false).visible).toBe(false);
    expect(writingArea(posts, true).visible).toBe(false);
  });

  test('a draft gets a page only where drafts are included, and is listed nowhere', () => {
    const posts = [post('a'), post('b'), note('c'), note('d', { draft: true })];
    expect(slugs(writingArea(posts, false).pages)).not.toContain('d');
    const preview = writingArea(posts, true);
    expect(slugs(preview.pages)).toContain('d');
    expect(slugs(preview.published)).not.toContain('d');
    expect(feedItems(preview).map((i) => i.link)).not.toContain('/notes/d/');
    // Below the rule, a preview still builds the draft's own page, so its author can read it.
    expect(slugs(writingArea([post('a'), note('d', { draft: true })], true).pages)).toEqual(['d']);
  });

  test("newest first, and a day's posts by slug, so the order never depends on the disk", () => {
    const order = newestFirst([
      post('b', { published: day('2026-10-20') }),
      post('c', { published: day('2026-10-22') }),
      post('a', { published: day('2026-10-20') }),
    ]);
    expect(slugs(order)).toEqual(['c', 'a', 'b']);
  });

  test("a summary reaches the feed as HTML, as RSS's description is: escaped, not interpreted", () => {
    const area = writingArea(
      [post('a', { summary: 'p99 < 2 s & "fast"' }), post('b'), post('c')],
      false,
    );
    expect(feedItems(area).find((i) => i.link === '/writing/a/')?.description).toBe(
      'p99 &lt; 2 s &amp; "fast"',
    );
  });

  test('the feed lists published posts, newest first, each linking to its page', () => {
    const area = writingArea(
      [
        post('a', { published: day('2026-10-18'), tags: ['go'] }),
        note('b', { published: day('2026-10-22') }),
        post('c', { published: day('2026-10-20') }),
      ],
      false,
    );
    expect(feedItems(area)).toEqual([
      {
        title: 'Title b',
        link: '/notes/b/',
        pubDate: day('2026-10-22'),
        description: 'Summary b',
        categories: [],
      },
      {
        title: 'Title c',
        link: '/writing/c/',
        pubDate: day('2026-10-20'),
        description: 'Summary c',
        categories: [],
      },
      {
        title: 'Title a',
        link: '/writing/a/',
        pubDate: day('2026-10-18'),
        description: 'Summary a',
        categories: ['go'],
      },
    ]);
  });
});

describe('front matter is validated when the site builds (schema-on-write)', () => {
  const base = {
    title: 'A title',
    summary: 'A summary.',
    published: '2026-10-20',
    tags: ['go'],
    firewall_reviewed: '2026-10-20',
  };
  const essay = { ...base, kind: 'essay' };
  const fails = (schema: typeof essaySchema | typeof noteSchema, data: object) =>
    !schema.safeParse(data).success;

  test('a valid essay parses: draft defaults to false, and a day is midnight UTC', () => {
    const parsed = essaySchema.parse(essay);
    expect(parsed.draft).toBe(false);
    expect(parsed.published).toEqual(day('2026-10-20'));
    expect(essaySchema.parse({ ...essay, published: day('2026-10-20') }).published).toEqual(
      day('2026-10-20'),
    );
  });

  test('a day with a time or an offset fails, since an offset names a time zone', () => {
    expect(asDay('2026-10-20')).toEqual(day('2026-10-20'));
    expect(asDay(new Date(Date.UTC(2026, 9, 20)))).toEqual(day('2026-10-20'));
    for (const value of [
      '2026-10-20T10:00:00Z',
      '2026-10-20T00:00:00-06:00',
      new Date('2026-10-20T06:00:00Z'),
      '2026-02-30',
      '20/10/2026',
      'yesterday',
    ]) {
      expect(asDay(value), String(value)).toBeNull();
      expect(fails(essaySchema, { ...essay, published: value }), String(value)).toBe(true);
    }
  });

  test('an unknown key fails, a slug field among them: the file name is the slug', () => {
    expect(fails(essaySchema, { ...essay, slug: 'other' })).toBe(true);
    expect(fails(essaySchema, { ...essay, author: 'someone' })).toBe(true);
    expect(fails(essaySchema, { ...essay, firewall_reviewed: undefined })).toBe(true);
  });

  test('tags come from the fixed list of 10, at most 3, each once', () => {
    expect(TAGS).toHaveLength(10);
    expect(fails(essaySchema, { ...essay, tags: ['not-a-tag'] })).toBe(true);
    expect(fails(essaySchema, { ...essay, tags: ['go', 'data', 'tools', 'security'] })).toBe(true);
    expect(fails(essaySchema, { ...essay, tags: ['go', 'go'] })).toBe(true);
  });

  test('a title is at most 70 characters, and a summary at most 160', () => {
    expect(fails(essaySchema, { ...essay, title: 'x'.repeat(70) })).toBe(false);
    expect(fails(essaySchema, { ...essay, title: 'x'.repeat(71) })).toBe(true);
    expect(fails(essaySchema, { ...essay, summary: 'x'.repeat(161) })).toBe(true);
  });

  test('a note has no kind, and its source, if any, is https', () => {
    expect(fails(noteSchema, base)).toBe(false);
    expect(fails(noteSchema, { ...base, source: 'https://example.com/a' })).toBe(false);
    expect(fails(noteSchema, { ...base, source: 'http://example.com/a' })).toBe(true);
    expect(fails(noteSchema, { ...base, source: 'javascript:alert(1)' })).toBe(true);
    expect(fails(noteSchema, essay)).toBe(true);
  });

  test('updated comes on or after published', () => {
    expect(fails(essaySchema, { ...essay, updated: '2026-10-21' })).toBe(false);
    expect(fails(essaySchema, { ...essay, updated: '2026-10-19' })).toBe(true);
  });
});

describe('drafts: in astro dev and pull request previews, never in production', () => {
  test('only DRAFTS=include, or astro dev, includes them; anything else is a production build', () => {
    expect(draftsIncluded({}, false)).toBe(false);
    expect(draftsIncluded({ DRAFTS: 'exclude' }, false)).toBe(false);
    for (const value of ['true', '1', 'yes', 'INCLUDE', ' include']) {
      expect(draftsIncluded({ DRAFTS: value }, false), value).toBe(false);
    }
    expect(draftsIncluded({ DRAFTS: 'include' }, false)).toBe(true);
    expect(draftsIncluded({}, true)).toBe(true);
  });

  test('CI includes drafts for pull requests alone, and the deploy builds nothing of its own', () => {
    const ci = readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8');
    const set = [...ci.matchAll(/^\s*DRAFTS:\s*(.+)$/gm)].map(([, value = '']) => value.trim());
    expect(set).toEqual(["${{ github.event_name == 'pull_request' && 'include' || 'exclude' }}"]);
    // Production ships the dist/ that verify built on main, where the expression says exclude.
    const deploy = ci.slice(ci.indexOf('\n  deploy:'), ci.indexOf('\n  rollback:'));
    expect(deploy).toContain('name: dist');
    expect(deploy).not.toMatch(/astro build|pnpm (run )?build\b/);
    // No workflow names a fixture set: only scripts/build-fixtures.mjs does, for its own builds.
    expect(ci).not.toContain('POST_FIXTURES');
  });

  test('the fixture switch is off unless a set is named, and names only a set', () => {
    expect(postsBase(undefined)).toBe('./src/content');
    expect(postsBase('')).toBe('./src/content');
    expect(postsBase('three')).toBe('./test/fixtures/posts/three');
    expect(() => postsBase('../../etc')).toThrow(/not a fixture set/);
  });
});

/** One fixture build: its files, its page URLs, its sitemap and a reader for its text. */
function fixtureBuild(name: string) {
  const dir = join(app, '.fixtures', name);
  if (!existsSync(join(dir, 'index.html'))) {
    throw new Error(
      `apps/web/.fixtures/${name}/ is missing: build the fixtures first (pnpm --filter web build:fixtures)`,
    );
  }
  const files = filesIn(dir);
  const text = (file: string) => readFileSync(join(dir, file), 'utf8');
  const pages = files
    .filter((f) => f.endsWith('index.html'))
    .map((f) => `/${f.slice(0, -'index.html'.length)}`)
    .sort();
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, l = '']) => l);
  const sitemap = locs(text('sitemap-index.xml'))
    .flatMap((index) => locs(text(new URL(index).pathname.slice(1))))
    .map((loc) => new URL(loc).pathname)
    .sort();
  const html = files.filter((f) => f.endsWith('.html'));
  return { files, text, pages, sitemap, html };
}

/** The header nav's links on a page. */
const headerLinks = (page: string) =>
  [
    ...(/<nav class="site-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? '').matchAll(/href="([^"]+)"/g),
  ].map(([, href = '']) => href);

describe('fixture-two: two published posts and a draft, built for production', () => {
  const build = fixtureBuild('fixture-two');

  test('Writing builds nothing: only Home, no index, no post, no feed', () => {
    expect(build.pages).toEqual(['/']);
    expect(build.files.filter((f) => /^(writing|notes)\//.test(f) || f === 'rss.xml')).toEqual([]);
    expect(build.sitemap).toEqual(['/']);
  });

  test('and nothing points at it: no header link, no Home row, no feed link', () => {
    for (const file of build.html) {
      const page = build.text(file);
      expect(headerLinks(page), file).toEqual([]);
      expect(page, file).not.toContain('/rss.xml');
      expect(page, file).not.toContain('id="writing"');
    }
  });
});

describe('fixture-three: three published posts and a draft, built for production', () => {
  const build = fixtureBuild('fixture-three');
  const home = build.text('index.html');

  test('exactly Home, both indexes and the three posts; the draft has no page', () => {
    expect(build.pages).toEqual([...WRITING_FIXTURE_PAGES].sort());
    expect(build.files.filter((f) => f.includes('unfinished-thought'))).toEqual([]);
    expect(build.html.filter((f) => build.text(f).includes('An unfinished thought'))).toEqual([]);
  });

  test('the sitemap lists every page, and each page but Home has its card beside it', () => {
    expect(build.sitemap).toEqual([...WRITING_FIXTURE_PAGES].sort());
    for (const page of WRITING_FIXTURE_PAGES) {
      expect(build.files, page).toContain(`${page.slice(1)}og.png`);
    }
  });

  test('the header links Writing on every page, and the footer and <head> link the feed', () => {
    for (const file of build.html.filter((f) => f !== '404.html')) {
      const page = build.text(file);
      expect(headerLinks(page), file).toEqual(['/writing/']);
      expect(page, file).toMatch(/<ul class="footer-links">[\s\S]*?href="\/rss\.xml"/);
      expect(page, file).toContain(
        '<link rel="alternate" type="application/rss+xml" title="Joseph Peterson: writing" href="/rss.xml">',
      );
    }
  });

  test("Home's Writing row lists the three latest posts, newest first", () => {
    const row = /<section class="section" id="writing"[\s\S]*?<\/section>/.exec(home)?.[0] ?? '';
    expect(
      [...row.matchAll(/<h3 class="post-title"><a href="([^"]+)"/g)].map(([, h]) => h),
    ).toEqual([
      '/notes/trailing-slashes/',
      '/writing/measure-first/',
      '/writing/retries-and-back-off/',
    ]);
    expect(row).toContain('href="/writing/"');
    expect(row).toContain('href="/rss.xml"');
  });

  test('/writing/ lists every post and /notes/ the notes alone', () => {
    const listed = (file: string) =>
      [...build.text(file).matchAll(/<h2 class="post-title"><a href="([^"]+)"/g)].map(([, h]) => h);
    expect(listed('writing/index.html')).toEqual([
      '/notes/trailing-slashes/',
      '/writing/measure-first/',
      '/writing/retries-and-back-off/',
    ]);
    expect(listed('notes/index.html')).toEqual(['/notes/trailing-slashes/']);
  });

  describe('/rss.xml', () => {
    const feed = build.text('rss.xml');
    const items = [...feed.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(([, item = '']) => item);
    const field = (item: string, name: string) =>
      new RegExp(`<${name}[^>]*>([^<]*)</${name}>`).exec(item)?.[1];

    test('RSS 2.0, naming the site, its language and its own URL', () => {
      expect(feed.startsWith('<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"')).toBe(
        true,
      );
      expect(feed).toContain('<title>Joseph Peterson</title>');
      expect(feed).toContain('<link>https://ihaveasegway.com/</link>');
      expect(feed).toContain('<language>en</language>');
      expect(feed).toContain(
        '<atom:link href="https://ihaveasegway.com/rss.xml" rel="self" type="application/rss+xml"/>',
      );
      // No build time: the same posts make the same bytes on any day.
      expect(feed).not.toContain('lastBuildDate');
    });

    test('three items, newest first, never the draft, each with an absolute link and a day', () => {
      expect(items.map((i) => field(i, 'link'))).toEqual([
        'https://ihaveasegway.com/notes/trailing-slashes/',
        'https://ihaveasegway.com/writing/measure-first/',
        'https://ihaveasegway.com/writing/retries-and-back-off/',
      ]);
      for (const item of items) {
        expect(field(item, 'guid')).toBe(field(item, 'link'));
        expect(item).toContain('<guid isPermaLink="true">');
        expect(field(item, 'pubDate')).toMatch(
          /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} 00:00:00 GMT$/,
        );
        expect(field(item, 'description')).toContain(SENTINEL);
      }
      expect(feed).not.toContain('unfinished-thought');
    });

    test('known answer: "&", quotation marks and "<" arrive escaped', () => {
      expect(feed).toContain(
        '<title>Retries &amp; back-off, or why &quot;later&quot; beats &quot;now&quot;</title>',
      );
      // The summary is HTML-escaped as RSS's description requires, then escaped for XML.
      expect(feed).toContain('so p99 &amp;lt; 2 s holds under load');
      expect(feed).toContain('<category>architecture</category><category>testing</category>');
    });
  });
});

describe('fixture-three-preview: the same posts, with drafts included as a preview builds them', () => {
  const build = fixtureBuild('fixture-three-preview');
  const draft = 'notes/unfinished-thought/index.html';

  test('the draft has a page, and every other page is the production set', () => {
    expect(build.pages).toEqual([...WRITING_FIXTURE_PAGES, '/notes/unfinished-thought/'].sort());
  });

  test('the draft page is noindex, says Draft, and carries no preview card or structured data', () => {
    const page = build.text(draft);
    expect(page).toContain('<meta name="robots" content="noindex">');
    expect(page).toContain('<p class="label">Draft · Field note</p>');
    expect(page).not.toContain('property="og:');
    expect(page).not.toContain('application/ld+json');
    expect(build.files).not.toContain('notes/unfinished-thought/og.png');
  });

  test('nothing links to the draft or lists it: no index, no Home row, no feed, no sitemap', () => {
    for (const file of build.files.filter((f) => f !== draft && /\.(html|xml)$/.test(f))) {
      expect(build.text(file), file).not.toContain('unfinished-thought');
    }
    expect(build.sitemap).toEqual([...WRITING_FIXTURE_PAGES].sort());
  });
});

describe('the real build', () => {
  const read = (file: string) => readFileSync(join(dist, file), 'utf8');
  const home = read('index.html');

  test('Writing is all or nothing: index, feed, header link, Home row and feed link together', () => {
    const parts = {
      index: distFiles.includes('writing/index.html'),
      feed: distFiles.includes('rss.xml'),
      header: headerLinks(home).includes('/writing/'),
      row: home.includes('id="writing"'),
      alternate: home.includes('type="application/rss+xml"'),
    };
    expect(new Set(Object.values(parts)).size, JSON.stringify(parts)).toBe(1);
    if (parts.index) {
      const listed = read('writing/index.html').match(/<h2 class="post-title">/g) ?? [];
      expect(listed.length).toBeGreaterThanOrEqual(MIN_POSTS);
    }
  });

  test('no fixture reaches it: not its text, and not its slugs', () => {
    const fixtureSlugs = ['two', 'three'].flatMap((set) =>
      ['writing', 'notes'].flatMap((section) =>
        readdirSync(join(app, 'test/fixtures/posts', set, section)).map((f) =>
          f.replace(/\.md$/, ''),
        ),
      ),
    );
    expect(fixtureSlugs.length).toBeGreaterThan(0);
    for (const file of distFiles.filter((f) => /\.(html|xml|txt|css|json)$/.test(f))) {
      expect(read(file), file).not.toContain(SENTINEL);
    }
    expect(distFiles.filter((f) => fixtureSlugs.some((slug) => f.includes(`/${slug}/`)))).toEqual(
      [],
    );
  });
});

/** Level-1 headings in a post's body, outside fenced code: the title is the page's one <h1>. */
function bodyHeadings(markdown: string): string[] {
  const body = markdown.replace(/^---\n[\s\S]*?\n---\n/, '').replace(/^```[\s\S]*?^```/gm, '');
  return [...body.matchAll(/^#[ \t]+(.+)$/gm)].map(([, text = '']) => text);
}

describe('the real posts, drafts included, before anything renders them', () => {
  const holds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));
  const sources = ['writing', 'notes'].flatMap((section) => {
    const dir = join(app, 'src/content', section);
    return existsSync(dir) ? readdirSync(dir).map((name) => ({ section, name, dir })) : [];
  });

  test('each file is <slug>.md, the slug lowercase words joined by hyphens (ADR 0005)', () => {
    for (const { section, name } of sources) {
      expect(name, `${section}/${name}`).toMatch(/\.md$/);
      expect(isSlug(name.replace(/\.md$/, '')), `${section}/${name}`).toBe(true);
    }
  });

  test('no held name in any post, a draft included: drafts reach public previews', () => {
    for (const { section, name, dir } of sources) {
      expect(findHeld(readFileSync(join(dir, name), 'utf8'), holds), `${section}/${name}`).toEqual(
        [],
      );
    }
  });

  test("no level-1 heading in a body: the post's title is the page's one <h1>", () => {
    for (const { section, name, dir } of sources) {
      expect(bodyHeadings(readFileSync(join(dir, name), 'utf8')), `${section}/${name}`).toEqual([]);
    }
  });

  test('known answers: the fixtures pass these checks, and the heading check sees an h1', () => {
    for (const set of ['two', 'three']) {
      for (const section of ['writing', 'notes']) {
        const dir = join(app, 'test/fixtures/posts', set, section);
        for (const name of readdirSync(dir)) {
          const text = readFileSync(join(dir, name), 'utf8');
          expect(isSlug(name.replace(/\.md$/, '')), name).toBe(true);
          expect(findHeld(text, holds), name).toEqual([]);
          expect(bodyHeadings(text), name).toEqual([]);
        }
      }
    }
    expect(bodyHeadings('---\ntitle: x\n---\n\n# Another title\n\n## A section\n')).toEqual([
      'Another title',
    ]);
    expect(bodyHeadings('```sh\n# a comment, not a heading\n```\n')).toEqual([]);
    expect(isSlug('My_Post')).toBe(false);
    expect(isSlug('caches-and-queues')).toBe(true);
  });
});
