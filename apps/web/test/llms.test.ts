import { describe, expect, test } from 'vitest';
import { labArea } from '../src/lib/lab';
import { llmsText } from '../src/lib/llms';
import { isNoindex } from '../src/lib/noindex.mjs';
import { writingArea, type Post } from '../src/lib/posts';
import { checkedProfiles, homeDescription } from '../src/lib/profile';
import { CONTACT_EMAIL, ORIGIN } from '../src/lib/site';
import { files, kinds, profile, read } from './support/dist';
import { attribute, elementsOf } from './support/html';

// /llms.txt (content.md, "Files for crawlers"): the llms.txt convention's shape, every fact from
// the sources the pages read, and every page the sitemap lists, so the file can neither say what
// the site does not nor leave a page out. Then known answers on lib/llms.ts with posts of its own.

const text = read('llms.txt');
const lines = text.split('\n');
const LINK = /^- \[((?:\\.|[^\]\\])+)\]\(([^)\s]+)\)(?::\s(.+))?$/;
const links = lines.flatMap((l) => {
  const [, label = '', url = ''] = LINK.exec(l) ?? [];
  return url ? [{ label, url }] : [];
});
/** Each "## " section's link URLs, in order. */
const sections = new Map<string, string[]>();
let current = '';
for (const l of lines) {
  if (l.startsWith('## ')) sections.set((current = l.slice(3)), []);
  else if (LINK.test(l)) sections.get(current)?.push(LINK.exec(l)?.[2] ?? '');
}

const locs = (xml: string) => [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, loc = '']) => loc);
const sitemap = locs(read('sitemap-index.xml')).flatMap((index) =>
  locs(read(new URL(index).pathname.slice(1))),
);
const pageFile = (url: string) => `${new URL(url).pathname.slice(1)}index.html`;

describe('/llms.txt', () => {
  test('is UTF-8 text, so every text scan of dist/ reads it (hold list, readiness, timestamps)', () => {
    expect(kinds.get('llms.txt')).toBe('text');
  });

  test("opens with the name as its H1 and Home's own description as the blockquote", () => {
    const description = elementsOf(read('index.html'))
      .filter((e) => e.tagName === 'meta' && attribute(e, 'name') === 'description')
      .map((e) => attribute(e, 'content'));
    expect(description).toEqual([homeDescription(profile)]);
    expect(lines.slice(0, 4)).toEqual([
      `# ${profile.basics.name}`,
      '',
      `> ${homeDescription(profile)}`,
      '',
    ]);
  });

  test('holds only headings, blank lines and links after that, and ends with one newline', () => {
    for (const l of lines.slice(4, -1)) expect(l, l).toMatch(/^(?:## \S.*|- \[.+|)$/);
    for (const l of lines.filter((l) => l.startsWith('- '))) expect(l, l).toMatch(LINK);
    expect(text.endsWith('\n') && !text.endsWith('\n\n')).toBe(true);
    expect(text).not.toMatch(/[ \t]$/m);
  });

  test('Contact is the address and the checked profiles, as the footer has them', () => {
    expect(sections.get('Contact')).toEqual([
      `mailto:${CONTACT_EMAIL}`,
      ...checkedProfiles(profile).map((p) => p.url),
    ]);
  });

  test('every page the sitemap lists is here, and every link on the site is a page it lists', () => {
    const own = links.map((l) => l.url).filter((url) => url.startsWith(`${ORIGIN}/`));
    expect(sitemap.length).toBeGreaterThan(0);
    expect([...own].sort()).toEqual([...sitemap].sort());
    for (const url of own) {
      expect(files, url).toContain(pageFile(url));
      expect(isNoindex(read(pageFile(url))), url).toBe(false);
    }
  });

  test('no link names a page twice', () => {
    const urls = links.map((l) => l.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});

describe('known answers: lib/llms.ts', () => {
  const post = (slug: string, section: Post['section'], extra: Partial<Post> = {}): Post => ({
    section,
    slug,
    title: `Title of ${slug}`,
    summary: `Summary of ${slug}.`,
    published: new Date('2026-10-20T00:00:00Z'),
    updated: null,
    draft: false,
    tags: [],
    kind: section === 'notes' ? 'note' : 'essay',
    source: null,
    minutes: 1,
    ...extra,
  });
  const write = (posts: Post[], drafts = false) =>
    llmsText({
      profile,
      pages: [],
      area: writingArea(posts, drafts),
      lab: labArea([]),
      projects: [],
    });

  test('with no published post nothing about Writing is written, even with drafts included', () => {
    const out = write(
      [post('a', 'writing', { draft: true }), post('b', 'notes', { draft: true })],
      true,
    );
    expect(out).not.toContain('## Writing');
    expect(out).not.toMatch(/\/(writing|notes)\//);
  });

  test('at 1 the section lists its post and its index is a page', () => {
    const out = write([post('one', 'writing'), post('draft', 'writing', { draft: true })], true);
    expect(out).toContain(
      `## Writing\n\n- [Title of one](${ORIGIN}/writing/one/): Summary of one.`,
    );
    expect(out).toContain(`- [Writing](${ORIGIN}/writing/)`);
    expect(out).not.toContain('## Field notes');
    expect(out).not.toContain('draft');
  });

  test('a section lists its published posts, never a draft, and its index is a page', () => {
    const out = write(
      [
        post('one', 'writing'),
        post('two', 'writing'),
        post('three', 'notes'),
        post('draft', 'writing', { draft: true }),
      ],
      true,
    );
    expect(out).toContain(`- [Title of one](${ORIGIN}/writing/one/): Summary of one.`);
    expect(out).toContain(`## Field notes\n\n- [Title of three](${ORIGIN}/notes/three/)`);
    expect(out).toContain(`- [Field notes](${ORIGIN}/notes/)`);
    expect(out).not.toContain('draft');
  });

  test('a bracket in a title is escaped, a line break in a summary is not carried over', () => {
    const out = write([
      post('x', 'writing', { title: 'A [bracket] title', summary: 'One\nline.' }),
      post('y', 'writing'),
      post('z', 'writing'),
    ]);
    expect(out).toContain('- [A \\[bracket\\] title](');
    expect(out).toContain('/writing/x/): One line.');
  });

  test('a manifest item that names a file is not listed as a page; an empty section is left out', () => {
    const out = llmsText({
      profile,
      pages: [{ id: 'rss', label: 'RSS', href: '/rss.xml', footer: true }],
      area: writingArea([], false),
      lab: labArea([]),
      projects: [],
    });
    expect(out).not.toContain('rss.xml');
    expect(out).not.toContain('## Projects');
    expect(out).not.toContain('## Writing');
    expect(out).not.toContain('## Lab');
  });

  test('the Lab section lists each live demo with its summary, and its index is a page', () => {
    const out = llmsText({
      profile,
      pages: [{ id: 'lab', label: 'Lab', href: '/lab/', header: true }],
      area: writingArea([], false),
      lab: labArea([
        { slug: 'routes', title: 'A [demo]', summary: 'Its\nsummary.', decisions: [] },
      ]),
      projects: [],
    });
    expect(out).toContain(`- [Lab](${ORIGIN}/lab/)`);
    expect(out).toContain(`## Lab\n\n- [A \\[demo\\]](${ORIGIN}/lab/routes/): Its summary.`);
  });
});
