import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { isAlias, isScalar } from 'yaml';
import { WRITING_FIXTURE_PAGES } from '../e2e/expected';
import { findHeld, parseHolds } from '../src/lib/held-names';
import { isNoindex, NOINDEX } from '../src/lib/noindex.mjs';
import {
  asDay,
  draftsIncluded,
  essaySchema,
  feedItems,
  isSlug,
  MIN_POSTS,
  newestFirst,
  noteSchema,
  postLabel,
  postsBase,
  TAGS,
  writingArea,
  type Post,
  type PostPage,
} from '../src/lib/posts';
import { app, dist, files as distFiles, filesIn, kindOf } from './support/dist';
import { frontMatter, indirection, valueNode } from './support/front-matter';

// Writing (roadmap.md, PR 5): the rules in lib/posts.ts with known answers, then the test-only
// fixture builds that scripts/build-fixtures.mjs writes, then the real build and the real posts.
// vitest.config.ts runs every other check over a build on fixture-many, fixture-many-preview and
// fixture-one-preview as well; this file holds what only a known set of posts can prove.

/** Every fixture post's summary carries this; no file the real builds write may. */
const SENTINEL = 'A test fixture, never published';
/** Every fixture post's slug starts with this, and no real post's may (the source checks below). */
const FIXTURE_PREFIX = 'fixture-';

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
const pageSlugs = (pages: readonly PostPage[]) => pages.map((p) => `${p.post.slug}:${p.exposure}`);

describe(`the ${MIN_POSTS}-post rule (content.md, "Sitemap and phases")`, () => {
  test('the rule is one published post: Writing renders from the first', () => {
    expect(MIN_POSTS).toBe(1);
  });

  test('0 published posts, without drafts, build nothing: no index, no page, no feed', () => {
    const area = writingArea([], false);
    expect(area.visible).toBe(false);
    expect(area.sections).toEqual([]);
    expect(area.pages).toEqual([]);
    expect(feedItems(area)).toEqual([]);
  });

  test('1 renders it: /writing/, /notes/ once a note is published, and a listed page per post', () => {
    const one = writingArea([post('a')], false);
    expect(one.visible).toBe(true);
    expect(one.sections).toEqual(['writing']);
    expect(pageSlugs(one.pages)).toEqual(['a:listed']);
    expect(feedItems(one).map((i) => i.link)).toEqual(['/writing/a/']);
    // A note alone renders Writing too, with both indexes: /writing/ lists everything.
    expect(writingArea([note('b')], false).sections).toEqual(['writing', 'notes']);
    expect(writingArea([post('a'), post('b'), note('c')], false).sections).toEqual([
      'writing',
      'notes',
    ]);
  });

  test('a draft never counts toward the rule, even where drafts are included', () => {
    const posts = [post('a', { draft: true }), note('b', { draft: true })];
    expect(writingArea(posts, false).visible).toBe(false);
    expect(writingArea(posts, false).pages).toEqual([]);
    expect(writingArea(posts, true).visible).toBe(false);
    expect(writingArea(posts, true).sections).toEqual([]);
    expect(pageSlugs(writingArea(posts, true).pages)).toEqual(['a:draft', 'b:draft']);
  });

  test('with drafts, a build is a superset of production: the same pages, plus the drafts', () => {
    const cases: Post[][] = [
      [],
      [post('a')],
      [post('a'), note('b', { draft: true })],
      [post('a'), post('b'), note('c'), note('d', { draft: true })],
      [post('a'), post('b'), note('c', { draft: true }), post('e', { draft: true })],
      [post('a', { draft: true }), note('c', { draft: true })],
    ];
    for (const posts of cases) {
      const production = pageSlugs(writingArea(posts, false).pages);
      const preview = pageSlugs(writingArea(posts, true).pages);
      expect(preview, JSON.stringify(slugs(posts))).toEqual(expect.arrayContaining(production));
      const drafts = posts.filter((p) => p.draft).map((p) => `${p.slug}:draft`);
      expect(preview).toEqual(expect.arrayContaining(drafts));
    }
    // At one published post it is listed in both builds, so a draft's link to it resolves, and
    // the draft is the only addition.
    const at = writingArea([post('a'), note('d', { draft: true })], true);
    expect(pageSlugs(at.pages)).toEqual(['a:listed', 'd:draft']);
    expect(at.visible).toBe(true);
  });

  test('a page says what it is: the kind, with Draft first on a draft', () => {
    expect(postLabel({ post: post('a'), exposure: 'listed' })).toBe('Essay');
    expect(postLabel({ post: note('a'), exposure: 'listed' })).toBe('Field note');
    expect(postLabel({ post: post('a', { kind: 'pattern' }), exposure: 'draft' })).toBe(
      'Draft · Pattern',
    );
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
        post('d', { published: day('2026-10-23'), draft: true }),
      ],
      true,
    );
    expect(feedItems(area).map((i) => [i.link, i.categories])).toEqual([
      ['/notes/b/', []],
      ['/writing/c/', []],
      ['/writing/a/', ['go']],
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

  test('a day written with a time or an offset fails, and so does an instant off midnight UTC', () => {
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
    // What YAML hands the schema for an unquoted 2026-10-20T20:00:00-04:00: midnight UTC, which
    // passes here. The source check below refuses the text itself.
    expect(asDay(new Date('2026-10-20T20:00:00-04:00'))).toEqual(day('2026-10-21'));
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

  test('dist/ is built without drafts by construction, and only the preview build writes them', () => {
    const scripts = (
      JSON.parse(readFileSync(join(app, 'package.json'), 'utf8')) as {
        scripts: Record<string, string>;
      }
    ).scripts;
    expect(scripts['build']).toBe('DRAFTS=exclude astro build');
    expect(scripts['build:preview']).toBe('DRAFTS=include astro build --outDir dist-preview');
    // astro dev reads the command Astro runs, not NODE_ENV, which any environment can set.
    const content = readFileSync(join(app, 'src/lib/content.ts'), 'utf8');
    expect(content).toContain("__ASTRO_COMMAND__ === 'dev'");
    expect(content).not.toMatch(/import\.meta\.env\.(DEV|PROD|MODE)|process\.env\.NODE_ENV/);
  });

  test('CI ships dist-preview/ to pull requests alone, and the deploy refuses a noindex page', () => {
    const ci = readFileSync(join(app, '../../.github/workflows/ci.yml'), 'utf8');
    expect(ci).toContain(
      "path: ${{ github.event_name == 'pull_request' && 'apps/web/dist-preview' || 'apps/web/dist' }}",
    );
    const deploy = ci.slice(ci.indexOf('\n  deploy:'), ci.indexOf('\n  rollback:'));
    expect(deploy).toContain('name: dist');
    expect(deploy).not.toMatch(/astro build|pnpm (run )?build\b/);
    expect(deploy).toContain('Refuse a build that holds a noindex page');
    // No workflow names a fixture set: only scripts/build-fixtures.mjs does, for its own builds.
    expect(ci).not.toContain('POST_FIXTURES');
  });

  test('the fixture switch is off unless a set is named, and names only a set', () => {
    expect(postsBase(undefined)).toBe('./src/content');
    expect(postsBase('')).toBe('./src/content');
    expect(postsBase('one')).toBe('./test/fixtures/posts/one');
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
  const textFiles = files.filter((file) => kindOf(readFileSync(join(dir, file))) === 'text');
  const noindex = (file: string) => isNoindex(text(file));
  const pages = files
    .filter((f) => f.endsWith('index.html'))
    .map((f) => `/${f.slice(0, -'index.html'.length)}`)
    .sort();
  const indexable = files
    .filter((f) => f.endsWith('index.html') && !noindex(f))
    .map((f) => `/${f.slice(0, -'index.html'.length)}`)
    .sort();
  const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, l = '']) => l);
  const sitemap = locs(text('sitemap-index.xml'))
    .flatMap((index) => locs(text(new URL(index).pathname.slice(1))))
    .map((loc) => new URL(loc).pathname)
    .sort();
  const html = files.filter((f) => f.endsWith('.html'));
  return { files, text, textFiles, pages, indexable, sitemap, html };
}

/** The header nav's links on a page. */
const headerLinks = (page: string) =>
  [
    ...(/<nav class="site-nav"[\s\S]*?<\/nav>/.exec(page)?.[0] ?? '').matchAll(/href="([^"]+)"/g),
  ].map(([, href = '']) => href);
/** The post titles a list links to, in order. */
const listed = (page: string, level: 2 | 3) =>
  [...page.matchAll(new RegExp(`<h${level} class="post-title"><a href="([^"]+)"`, 'g'))].map(
    ([, href = '']) => href,
  );

/** The fixture drafts, read from their front matter as Astro reads it (a quoted title is the title,
 *  not the title in quotes): what must never reach a production build. */
const FIXTURE_DRAFTS = (['none', 'one', 'many'] as const).flatMap((set) =>
  ['writing', 'notes'].flatMap((section) => {
    const dir = join(app, 'test/fixtures/posts', set, section);
    return readdirSync(dir).flatMap((name) => {
      const read = frontMatter(readFileSync(join(dir, name), 'utf8'));
      if ('problem' in read) throw new Error(`${set}/${section}/${name}: ${read.problem}`);
      if (read.data['draft'] !== true) return [];
      const slug = name.replace(/\.md$/, '');
      const { title, summary } = read.data;
      return [{ set, page: `${section}/${slug}/index.html`, slug, title, summary }];
    });
  }),
);

/** The forms a draft's text takes in a build: as written, and escaped for HTML or XML. */
const escaped = (text: string) =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const holds = (text: string, needle: unknown) =>
  typeof needle === 'string' && [needle, escaped(needle)].some((form) => text.includes(form));

/** The preview build of each fixture set: where its draft renders. */
const PREVIEW_OF = {
  none: 'fixture-none-preview',
  one: 'fixture-one-preview',
  many: 'fixture-many-preview',
} as const;

describe('the fixture drafts', () => {
  test('there are drafts in every set, each with a title and a summary to look for', () => {
    expect(new Set(FIXTURE_DRAFTS.map((d) => d.set))).toEqual(new Set(['none', 'one', 'many']));
    for (const draft of FIXTURE_DRAFTS) {
      expect(String(draft.title).length, draft.slug).toBeGreaterThan(5);
      expect(String(draft.summary).length, draft.slug).toBeGreaterThan(5);
    }
  });

  // The positive control: the same needles, matched the same way, are found where the draft does
  // render, its page in the set's preview build. A needle that can never match (a title read with
  // its quotes, or escaped differently from the build) fails here, instead of passing below.
  test('positive control: each draft is found, by the same needles, on its page in a preview', () => {
    for (const draft of FIXTURE_DRAFTS) {
      const page = fixtureBuild(PREVIEW_OF[draft.set]).text(draft.page);
      for (const needle of [draft.title, draft.summary, draft.slug]) {
        expect(holds(page, needle), `${draft.page}: ${String(needle)}`).toBe(true);
      }
    }
  });

  test('known answers: a needle is found as written and escaped, and a quoted title as its text', () => {
    expect(holds('<h1>Retries &amp; back-off</h1>', 'Retries & back-off')).toBe(true);
    expect(holds('<title>A &quot;quoted&quot; title</title>', 'A "quoted" title')).toBe(true);
    expect(holds('<h1>Another title</h1>', 'A title')).toBe(false);
    expect(holds('<h1>A title</h1>', undefined)).toBe(false);
    const quoted = frontMatter('---\ntitle: "An unfinished thought"\ndraft: true\n---\n');
    expect('data' in quoted && quoted.data['title']).toBe('An unfinished thought');
  });

  // Every text file a production build writes, whatever its kind (HTML, XML, JSON, text), for
  // every draft's title, summary and slug: a draft that reached a data file or a feed is caught
  // as surely as one that reached a page.
  for (const name of ['fixture-none', 'fixture-none-node-env', 'fixture-one', 'fixture-many']) {
    test(`${name}, built for production, holds no draft's title, summary or slug anywhere`, () => {
      const build = fixtureBuild(name);
      expect(build.textFiles.length).toBeGreaterThan(5);
      for (const draft of FIXTURE_DRAFTS) {
        expect(
          build.files.filter((f) => f.includes(draft.slug)),
          draft.slug,
        ).toEqual([]);
        for (const file of build.textFiles) {
          const text = build.text(file);
          for (const needle of [draft.title, draft.summary, draft.slug]) {
            expect(holds(text, needle), `${file}: ${String(needle)}`).toBe(false);
          }
        }
      }
    });
  }
});

describe('fixture-none: two drafts and nothing published, built for production', () => {
  for (const name of ['fixture-none', 'fixture-none-node-env']) {
    test(`${name}: Writing builds nothing, NODE_ENV=development or not: only Home`, () => {
      const build = fixtureBuild(name);
      expect(build.pages).toEqual(['/']);
      expect(build.files.filter((f) => /^(writing|notes)\//.test(f) || f === 'rss.xml')).toEqual(
        [],
      );
      expect(build.sitemap).toEqual(['/']);
      for (const file of build.html) {
        const page = build.text(file);
        expect(headerLinks(page), file).toEqual([]);
        expect(page, file).not.toContain('/rss.xml');
        expect(page, file).not.toContain('id="writing"');
      }
    });
  }
});

describe('fixture-none-preview: the same drafts, with drafts included', () => {
  const build = fixtureBuild('fixture-none-preview');

  test('both drafts build, noindex and labelled Draft, and nothing else does', () => {
    expect(build.pages).toEqual([
      '/',
      '/notes/fixture-unfinished-thought/',
      '/writing/fixture-draft-essay/',
    ]);
    expect(build.indexable).toEqual(['/']);
    expect(build.text('writing/fixture-draft-essay/index.html')).toContain(
      '<p class="label">Draft · Essay</p>',
    );
    expect(build.text('notes/fixture-unfinished-thought/index.html')).toContain(
      '<p class="label">Draft · Field note</p>',
    );
  });

  test('nothing lists them: no index, no feed, no header link, no Home row, no card', () => {
    expect(
      build.files.filter(
        (f) => f === 'rss.xml' || /^(writing|notes)\/(index\.html|og\.png)$/.test(f),
      ),
    ).toEqual([]);
    expect(build.files.filter((f) => f.endsWith('og.png') && f !== 'og.png')).toEqual([]);
    expect(build.sitemap).toEqual(['/']);
    const home = build.text('index.html');
    expect(headerLinks(home)).toEqual([]);
    expect(home).not.toContain('id="writing"');
    expect(home).not.toContain('fixture-');
  });
});

describe('fixture-one: one published post and two drafts, built for production', () => {
  const build = fixtureBuild('fixture-one');

  test('Writing renders at the minimum: /writing/, the one listed post and the feed, no /notes/', () => {
    expect(build.pages).toEqual(['/', '/writing/', '/writing/fixture-measure-first/']);
    expect(build.indexable).toEqual(build.pages);
    expect(build.sitemap).toEqual(build.pages);
    expect(build.files).toContain('rss.xml');
    expect(headerLinks(build.text('index.html'))).toEqual(['/writing/']);
    const row =
      /<section class="section" id="writing"[\s\S]*?<\/section>/.exec(
        build.text('index.html'),
      )?.[0] ?? '';
    expect(listed(row, 3)).toEqual(['/writing/fixture-measure-first/']);
  });
});

describe('fixture-one-preview: the same posts, with drafts included', () => {
  const build = fixtureBuild('fixture-one-preview');

  test('the published post is listed as in production, and the two drafts are added, noindex', () => {
    expect(build.pages).toEqual([
      '/',
      '/notes/fixture-unfinished-thought/',
      '/writing/',
      '/writing/fixture-draft-essay/',
      '/writing/fixture-measure-first/',
    ]);
    expect(build.indexable).toEqual(['/', '/writing/', '/writing/fixture-measure-first/']);
    expect(build.text('writing/fixture-measure-first/index.html')).toContain(
      '<p class="label">Essay</p>',
    );
  });

  test("the draft's link to the listed post resolves in the preview", () => {
    expect(build.text('writing/fixture-draft-essay/index.html')).toContain(
      'href="/writing/fixture-measure-first/"',
    );
    expect(build.files).toContain('writing/fixture-measure-first/index.html');
  });
});

describe('fixture-many: five published posts and a draft, built for production', () => {
  const build = fixtureBuild('fixture-many');
  const home = build.text('index.html');

  test('exactly Home, both indexes and the five posts; the draft has no page', () => {
    expect(build.pages).toEqual([...WRITING_FIXTURE_PAGES].sort());
    expect(build.indexable).toEqual(build.pages);
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

  test("Home's Writing row lists the three latest of the five, newest first", () => {
    const row = /<section class="section" id="writing"[\s\S]*?<\/section>/.exec(home)?.[0] ?? '';
    expect(listed(row, 3)).toEqual([
      '/notes/fixture-trailing-slashes/',
      '/writing/fixture-measure-first/',
      '/writing/fixture-retries-and-back-off/',
    ]);
    expect(row).toContain('href="/writing/"');
    expect(row).toContain('href="/rss.xml"');
  });

  test('/writing/ lists all five and /notes/ the two notes', () => {
    expect(listed(build.text('writing/index.html'), 2)).toEqual([
      '/notes/fixture-trailing-slashes/',
      '/writing/fixture-measure-first/',
      '/writing/fixture-retries-and-back-off/',
      '/writing/fixture-markdown-tour/',
      '/notes/fixture-small-note/',
    ]);
    expect(listed(build.text('notes/index.html'), 2)).toEqual([
      '/notes/fixture-trailing-slashes/',
      '/notes/fixture-small-note/',
    ]);
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

    test('all five items, newest first, each with an absolute slash-form link and a day', () => {
      expect(items.map((i) => field(i, 'link'))).toEqual([
        'https://ihaveasegway.com/notes/fixture-trailing-slashes/',
        'https://ihaveasegway.com/writing/fixture-measure-first/',
        'https://ihaveasegway.com/writing/fixture-retries-and-back-off/',
        'https://ihaveasegway.com/writing/fixture-markdown-tour/',
        'https://ihaveasegway.com/notes/fixture-small-note/',
      ]);
      for (const item of items) {
        expect(field(item, 'guid')).toBe(field(item, 'link'));
        expect(item).toContain('<guid isPermaLink="true">');
        expect(field(item, 'pubDate')).toMatch(
          /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Z][a-z]{2} \d{4} 00:00:00 GMT$/,
        );
        expect(field(item, 'description')).toContain(SENTINEL);
      }
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

describe('fixture-many-preview: the same posts, with drafts included as a preview builds them', () => {
  const build = fixtureBuild('fixture-many-preview');
  const draft = 'notes/fixture-unfinished-thought/index.html';

  test('the draft has a page, and every other page is the production set, listed as there', () => {
    expect(build.pages).toEqual(
      [...WRITING_FIXTURE_PAGES, '/notes/fixture-unfinished-thought/'].sort(),
    );
    expect(build.indexable).toEqual([...WRITING_FIXTURE_PAGES].sort());
  });

  test('the draft page is noindex, says Draft, and carries no preview card or structured data', () => {
    const page = build.text(draft);
    expect(page).toContain(NOINDEX);
    expect(page).toContain('<p class="label">Draft · Field note</p>');
    expect(page).not.toContain('property="og:');
    expect(page).not.toContain('application/ld+json');
    expect(build.files).not.toContain('notes/fixture-unfinished-thought/og.png');
  });

  test('nothing links to the draft or lists it: no index, no Home row, no feed, no sitemap', () => {
    for (const file of build.textFiles.filter((f) => f !== draft)) {
      expect(build.text(file), file).not.toContain('fixture-unfinished-thought');
    }
    expect(build.sitemap).toEqual([...WRITING_FIXTURE_PAGES].sort());
  });
});

describe('the real builds: dist/ and dist-preview/', () => {
  const preview = join(app, 'dist-preview');
  if (!existsSync(join(preview, 'index.html'))) {
    throw new Error(
      'apps/web/dist-preview/ is missing: build it before running these tests (pnpm --filter web build:preview)',
    );
  }
  const builds = [
    { name: 'dist', dir: dist, files: distFiles },
    { name: 'dist-preview', dir: preview, files: filesIn(preview) },
  ];

  for (const { name, dir, files } of builds) {
    test(`${name}: Writing is all or nothing, index, feed, header link, Home row and feed link`, () => {
      const read = (file: string) => readFileSync(join(dir, file), 'utf8');
      const home = read('index.html');
      const parts = {
        index: files.includes('writing/index.html'),
        feed: files.includes('rss.xml'),
        header: headerLinks(home).includes('/writing/'),
        row: home.includes('id="writing"'),
        alternate: home.includes('type="application/rss+xml"'),
      };
      expect(new Set(Object.values(parts)).size, JSON.stringify(parts)).toBe(1);
      if (parts.index) {
        expect(listed(read('writing/index.html'), 2).length).toBeGreaterThanOrEqual(MIN_POSTS);
      }
    });

    test(`${name}: no fixture reaches it, not its text and not a fixture- slug`, () => {
      for (const file of files) {
        const data = readFileSync(join(dir, file));
        if (kindOf(data) === 'text') expect(data.toString('utf8'), file).not.toContain(SENTINEL);
      }
      expect(files.filter((f) => f.includes(`/${FIXTURE_PREFIX}`))).toEqual([]);
    });
  }
});

/** A post's body with its front matter, fenced code and inline code removed: what a reader reads
 *  as prose and markup. */
function prose(markdown: string): string {
  return markdown
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^(```|~~~)[\s\S]*?^\1[^\n]*$/gm, '')
    .replace(/`[^`\n]*`/g, '');
}

const DATE_KEYS = ['published', 'updated', 'firewall_reviewed'] as const;
const BARE_DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Why a post's dates are not each written as a bare day, YYYY-MM-DD, one line per problem. It reads
 * the front matter as Astro does (support/front-matter.ts), so a date is found however the YAML
 * writes it: a flow mapping, a value on the next line, an alias or a merge key, none of which a line
 * of text shows. Then each date's source text must be a bare day, and the value Astro hands the
 * schema must be that day: an unquoted 2026-10-20T20:00:00-04:00 is midnight UTC on the 21st.
 */
function dateProblems(source: string): string[] {
  const read = frontMatter(source);
  if ('problem' in read) return [read.problem];
  const problems = indirection(read.doc).map((what) => `${what}: write each value out in full`);
  for (const key of DATE_KEYS) {
    const node = valueNode(read.doc, key);
    if (node === undefined) continue;
    if (!isScalar(node) || typeof node.source !== 'string' || !BARE_DAY.test(node.source)) {
      const written = isScalar(node)
        ? `"${String(node.source)}"`
        : isAlias(node)
          ? 'as an alias'
          : 'as a list or a mapping';
      problems.push(`${key} is written ${written}, not as a bare day, YYYY-MM-DD`);
      continue;
    }
    const value = read.data[key];
    const day = value instanceof Date ? value.toISOString().slice(0, 10) : value;
    if (day !== node.source) problems.push(`${key} reads as ${String(day)}, not ${node.source}`);
  }
  return problems;
}

/** The images a post's source names inline: Markdown images, and HTML images or pictures. An early,
 *  readable message only: a shortcut reference (![a chart], defined elsewhere) passes it, so
 *  test/prose.test.ts reads the rendered body on every build, which catches every form Markdown
 *  writes. Neither refuses raw HTML, which can show an image another way. */
function imagesIn(markdown: string): string[] {
  return [...prose(markdown).matchAll(/!\[[^\]]*\]\s*[([]|<(img|picture|source)\b/gi)].map(
    ([match]) => match,
  );
}

const NO_IMAGES =
  'images in posts are not supported yet: they need a WebP check, an image budget and an asset ' +
  'pipeline that keeps a draft\'s images out of production (content.md, "Not yet"). Describe the ' +
  'picture in words, or wait for that pull request.';

describe('the real posts, drafts included, before anything renders them', () => {
  const holds = parseHolds(readFileSync(join(app, 'not-on-site.txt'), 'utf8'));
  const sources = ['writing', 'notes'].flatMap((section) => {
    const dir = join(app, 'src/content', section);
    return existsSync(dir)
      ? readdirSync(dir).map((name) => ({ name: `${section}/${name}`, path: join(dir, name) }))
      : [];
  });
  const read = (path: string) => readFileSync(path, 'utf8');

  test('each file is <slug>.md, the slug lowercase words joined by hyphens (ADR 0005)', () => {
    for (const { name } of sources) {
      const file = name.split('/')[1] ?? '';
      expect(file, name).toMatch(/\.md$/);
      expect(isSlug(file.replace(/\.md$/, '')), name).toBe(true);
      expect(
        file.startsWith(FIXTURE_PREFIX),
        `${name}: the fixture- prefix is reserved for test posts`,
      ).toBe(false);
    }
  });

  test('no held name in any post, a draft included: drafts reach public previews', () => {
    for (const { name, path } of sources) expect(findHeld(read(path), holds), name).toEqual([]);
  });

  test('every date is written as a bare day: a time or an offset in the file names a time zone', () => {
    for (const { name, path } of sources) expect(dateProblems(read(path)), name).toEqual([]);
  });

  test('no images in posts yet', () => {
    for (const { name, path } of sources) {
      expect(imagesIn(read(path)), `${name}: ${NO_IMAGES}`).toEqual([]);
    }
  });

  test('known answers: the fixtures pass, and each check sees what it looks for', () => {
    for (const set of ['none', 'one', 'many']) {
      for (const section of ['writing', 'notes']) {
        const dir = join(app, 'test/fixtures/posts', set, section);
        for (const file of readdirSync(dir)) {
          const text = read(join(dir, file));
          expect(isSlug(file.replace(/\.md$/, '')), file).toBe(true);
          expect(file.startsWith(FIXTURE_PREFIX), file).toBe(true);
          expect(findHeld(text, holds), file).toEqual([]);
          expect(dateProblems(text), file).toEqual([]);
          expect(imagesIn(text), file).toEqual([]);
        }
      }
    }
    const front = (yaml: string) => `---\ntitle: x\n${yaml}\n---\n\nBody.\n`;
    expect(dateProblems(front('published: 2026-10-20'))).toEqual([]);
    expect(dateProblems(front("published: '2026-10-20'"))).toEqual([]);
    expect(dateProblems(front('published: 2026-10-20 # read twice'))).toEqual([]);
    expect(dateProblems(front('published: 2026-10-20T20:00:00-04:00'))).toHaveLength(1);
    expect(dateProblems(front('updated: 2026-10-20 09:00'))).toHaveLength(1);
    // What a line of text does not show: each of these hands the schema midnight UTC on the 21st.
    expect(
      dateProblems('---\n{title: x, published: 2026-10-20T20:00:00-04:00}\n---\n'),
    ).toHaveLength(1);
    expect(dateProblems(front('published:\n  2026-10-20T20:00:00-04:00'))).toHaveLength(1);
    expect(dateProblems(front('x: &d 2026-10-20T20:00:00-04:00\npublished: *d'))).toEqual([
      'an anchor, &d: write each value out in full',
      'an alias, *d: write each value out in full',
      'published is written as an alias, not as a bare day, YYYY-MM-DD',
    ]);
    expect(dateProblems(front('<<: {published: 2026-10-20T20:00:00-04:00}'))).toEqual([
      'a merge key, <<: write each value out in full',
    ]);
    // Front matter Astro would read another way, or not at all, is refused rather than skipped.
    expect(dateProblems('+++\npublished = 2026-10-20T20:00:00-04:00\n+++\n')).toHaveLength(1);
    expect(dateProblems('\n---\npublished: 2026-10-20\n---\n')).toHaveLength(1);
    expect(dateProblems(front('published: 2026-10-20\npublished: 2026-10-21'))).toHaveLength(1);
    expect(imagesIn('---\ntitle: x\n---\n\n![a chart](./chart.png)\n')).toHaveLength(1);
    expect(imagesIn('Text <img src="/a.webp" alt=""> text')).toHaveLength(1);
    expect(
      imagesIn('A [link](/a/), `![in code](x.png)` and:\n\n```md\n![also code](y.png)\n```\n'),
    ).toEqual([]);
    expect(isSlug('My_Post')).toBe(false);
    expect(isSlug('caches-and-queues')).toBe(true);
  });
});
