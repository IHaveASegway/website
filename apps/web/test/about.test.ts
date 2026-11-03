import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  ABOUT_HEADINGS,
  aboutParts,
  aboutSchema,
  openingSentence,
  sectionOf,
  withLinks,
} from '../src/lib/about';
import { LAB_NAMES } from '../src/lib/lab';
import { fixture, profile, read } from './support/dist';

// /about/ (lib/about.ts): the bio, Joseph's words from src/content/about.md, then the résumé, which
// test/resume.test.ts checks. Every build writes the page; the bio is there exactly where its entry
// is, and the fixture builds, Writing's test builds, hold none. The entry holds the review stamp and
// nothing else: the nav names the page, and profile.json states every fact the résumé shows, so no
// fact has a second copy to fall out of date.

const fixtureBuild = fixture?.startsWith('.fixtures/') ?? false;
const page = read('about/index.html');
const entry = readFileSync(join(import.meta.dirname, '../src/content/about.md'), 'utf8');
const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(entry)?.[1] ?? '';
const body = entry.slice(entry.indexOf('\n---\n') + 5);

test('the entry carries the review stamp and no other field', () => {
  const keys = [...frontMatter.matchAll(/^([a-z_]+):/gm)].map(([, key]) => key);
  expect(keys).toEqual(Object.keys(aboutSchema.shape));
  expect(keys).toEqual(['firewall_reviewed']);
});

// /about/ lays the bio out as named blocks (ADR 0031): its opening, then each of its sections under
// its own heading, the words as about.md has them; the tools and the close stand after the résumé's
// paper-only sections, so the close is the last thing on the screen. Until 2026-10-31 it rendered the
// Markdown whole, under "About me".
const decode = (text: string) =>
  text
    .replace(/<[^>]+>/g, '')
    .replace(/&#39;|&#x27;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/'/g, '’')
    .replace(/\s+/g, ' ')
    .trim();

/** The text of each element with this class, in page order. */
const texts = (html: string, tag: string, name: string) =>
  [
    ...html.matchAll(
      new RegExp(`<${tag} class="[^"]*\\b${name}\\b[^"]*">([\\s\\S]*?)</${tag}>`, 'g'),
    ),
  ].map(([, text = '']) => decode(text));

const bioOf = () => /<section class="bio"[\s\S]*?<\/section>/.exec(page)?.[0];

test('the bio renders exactly where its entry is, as named blocks in its own words, before Background', () => {
  const bio = bioOf();
  if (fixtureBuild) {
    expect(bio).toBeUndefined();
    return;
  }
  expect(bio).toBeDefined();
  expect(bio).toContain('aria-label="About me"');
  const parts = aboutParts(body);
  const later: string[] = [ABOUT_HEADINGS.tools, ABOUT_HEADINGS.idea];
  const here = parts.sections.filter((section) => !later.includes(section.heading));
  // A block a part: the opening with no label, then the bio's own headings, each over its block.
  expect(texts(bio ?? '', 'h2', 'block-label')).toEqual(here.map((s) => decode(s.heading)));
  // The opening, the paragraph that prints, as the entry has it.
  expect(texts(bio ?? '', 'p', 'bio-lede')).toEqual([decode(parts.lede[0] ?? '')]);
  // Every bold line and every sentence after it, word for word; the open source row is one sentence
  // the code composes, its name at the heading's size.
  const items = here.flatMap((section) => section.principles);
  const source = sectionOf(parts, ABOUT_HEADINGS.source)?.paragraphs ?? [];
  const row = (paragraph: string) => {
    const at = paragraph.indexOf(': ');
    return { lead: paragraph.slice(0, at + 1), text: paragraph.slice(at + 2) };
  };
  expect(texts(bio ?? '', 'h3', 'bio-item-lead')).toEqual(
    [...items.map((p) => p.lead), ...source.map((p) => row(p).lead)].map(decode),
  );
  expect(texts(bio ?? '', 'p', 'bio-item-text')).toEqual(
    [...items.map((p) => p.text), ...source.map((p) => row(p).text)].map(decode),
  );
  // Every other paragraph, in order, with what it names linked inside it.
  expect(texts(bio ?? '', 'p', 'bio-text')).toEqual(
    here
      .filter((section) => section.heading !== ABOUT_HEADINGS.source)
      .flatMap((s) => s.paragraphs)
      .map(decode),
  );
  expect(page.indexOf('class="bio"')).toBeLessThan(page.indexOf('id="experience-title"'));
});

test('the tools line says what profile.json says, under its heading, and the close comes last', () => {
  if (fixtureBuild) return;
  const parts = aboutParts(body);
  const tools = sectionOf(parts, ABOUT_HEADINGS.tools);
  expect(tools?.paragraphs).toEqual([profile.tools]);
  expect(decode(/<h2 id="tools-title"[^>]*>([\s\S]*?)<\/h2>/.exec(page)?.[1] ?? '')).toBe(
    decode(tools?.heading ?? ''),
  );
  expect(texts(page, 'p', 'skills-tools')).toEqual([decode(profile.tools ?? '')]);
  // The close: the bio's last section, the last thing on the page before the footer.
  const idea = sectionOf(parts, ABOUT_HEADINGS.idea);
  const close = /<section class="section contact"[\s\S]*?<\/section>/.exec(page)?.[0] ?? '';
  expect(decode(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(close)?.[1] ?? '')).toBe(
    decode(idea?.heading ?? ''),
  );
  expect(texts(close, 'p', 'contact-words')).toEqual(idea?.paragraphs.map(decode));
  expect(page.indexOf('class="section contact"')).toBeGreaterThan(
    page.indexOf('id="writing-title"'),
  );
  expect(page.indexOf('class="section contact"')).toBeLessThan(page.indexOf('<footer'));
});

// The open source row's name links to its repository, from the record's own check (lib/profile.ts,
// projectCards): about.md holds no link, since Home reads it as plain text.
test('stillhere’s row links its name to its repository, from the checked record', () => {
  if (fixtureBuild) return;
  const record = profile.projects.find((p) => p.name === 'stillhere');
  expect(record?.checked).toBeDefined();
  const row = /<li class="bio-row">([\s\S]*?)<\/li>/.exec(page)?.[1] ?? '';
  expect(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(row)?.[1]).toBe(
    `<a href="${record?.url}">stillhere</a>:`,
  );
  expect(row.match(/<a\b/g)).toHaveLength(1);
});

// The labs' rows (ADR 0031): the whole row is a link to its lab, by the bold line, and each stands
// under its lab's own line from its link card, not the isometric glyph: Joseph asked for no isometric
// drawing beside the bio.
test('each lab the bio lists is a row: its link, its bold line and its own line in its colour', () => {
  if (fixtureBuild) return;
  const rows = [
    ...page.matchAll(/<li class="bio-row"[^>]*data-line="([a-z]+)"[^>]*>([\s\S]*?)<\/li>/g),
  ];
  const items = sectionOf(aboutParts(body), ABOUT_HEADINGS.tryIt)?.principles ?? [];
  expect(rows.map(([, slug]) => slug)).toEqual(['cache', 'queue', 'backfill', 'routes', 'raft']);
  rows.forEach(([, slug, row = ''], i) => {
    expect([...row.matchAll(/<a\b[^>]*href="([^"]*)"/g)].map(([, href]) => href)).toEqual([
      `/lab/${slug}/`,
    ]);
    expect(decode(/<h3[^>]*>([\s\S]*?)<\/h3>/.exec(row)?.[1] ?? '')).toBe(
      decode(items[i]?.lead ?? ''),
    );
    expect(row).toMatch(
      new RegExp(`<svg class="lab-line" data-line="${slug}"[^>]*aria-hidden="true"`),
    );
    // Drawn from the page's tokens, so it follows the theme, and it holds no word.
    expect(row).toContain('var(--line)');
    expect(/<svg[\s\S]*<\/svg>/.exec(row)?.[0]).not.toMatch(/<text\b/);
  });
  expect(page).not.toContain('iso-glyph');
});

// The bio names the essay and the Lab, and until 2026-11-02 only Home linked the essay: this is the
// page for readers who want more, so each opens its page here too.
test('the essay and the Lab the bio names open their pages, as the labs do', () => {
  if (fixtureBuild) return;
  const bio = bioOf() ?? '';
  expect(bio).toContain('<a href="/writing/coding-by-hand/">essay</a>');
  expect(bio).toContain('<a href="/lab/">The Lab</a>');
});

test('the page has one Print button, and no PDF is written for it', () => {
  expect(page.match(/<button\b[^>]*\bdata-print\b/g)).toHaveLength(1);
  expect(page).not.toMatch(/href="[^"]*\.pdf"/);
});

// Home tells the bio in parts (ADR 0023, ADR 0031): its opening, the things to try and the last thing
// built, read by aboutParts from the same file /about/ renders whole.
describe('aboutParts: Home reads the bio it does not own', () => {
  test('the real bio: an opening, then its sections, in the order the page tells them', () => {
    const parts = aboutParts(body);
    expect(parts.lede).toHaveLength(1);
    expect(parts.lede[0]).toMatch(/^I take an idea and build the entire system\./);
    // Home and /about/ find their parts by these headings, so the bio keeps them, in this order.
    expect(parts.sections.map((s) => s.heading)).toEqual(Object.values(ABOUT_HEADINGS));
    expect(parts.sections.map((s) => s.heading)).toEqual([
      'How I got here',
      'The biggest thing I’ve built',
      'Things I built that you can try',
      'Open source',
      'The last thing I built',
      'What came from me',
      'What I’ve worked with',
      'If you’ve got an idea',
    ]);
    const tryIt = sectionOf(parts, ABOUT_HEADINGS.tryIt);
    expect(tryIt?.principles).toHaveLength(5);
    expect(tryIt?.principles[0]?.lead).toBe(
      'Everyone wants the menu right when its saved copy runs out.',
    );
    expect(tryIt?.paragraphs).toHaveLength(1);
    // The paragraph that prints over Selected work, by its place in the section.
    expect(sectionOf(parts, ABOUT_HEADINGS.story)?.paragraphs[1]).toMatch(
      /^I didn’t type this site’s code\./,
    );
    // Only the labs' section is a list.
    expect(parts.sections.filter((s) => s.principles.length > 0)).toEqual([tryIt]);
  });

  test("openingSentence: Home's hero says the opening's first sentence, /about/ the whole", () => {
    const opening = aboutParts(body).lede[0] ?? '';
    expect(openingSentence(opening)).toBe('I take an idea and build the entire system.');
    expect(opening.startsWith(openingSentence(opening))).toBe(true);
    // Known answers: the first of several, a lone sentence whole, no end at a lower-case word or
    // inside a number.
    expect(openingSentence('One. Two! Three?')).toBe('One.');
    expect(openingSentence('Is it one? Yes.')).toBe('Is it one?');
    expect(openingSentence('Just one.')).toBe('Just one.');
    expect(openingSentence('It ran 3.5 s. then stopped.')).toBe('It ran 3.5 s. then stopped.');
    expect(openingSentence('No full stop')).toBe('No full stop');
  });

  test('sectionOf: a section by its heading, wherever it stands, and none by another name', () => {
    const parts = aboutParts('Hi.\n\n### A\n\n- **One.** Two.\n\n### B\n\n- **Three.** Four.\n');
    expect(sectionOf(parts, 'B')?.principles).toEqual([{ lead: 'Three.', text: 'Four.' }]);
    expect(sectionOf(parts, 'C')).toBeUndefined();
  });

  test('known answers: a bold lead and its sentence, lines joined', () => {
    expect(aboutParts('Hi.\n\n### Work\n\n- **One.** Two\n  three.\n- **Four.** Five.\n')).toEqual({
      lede: ['Hi.'],
      sections: [
        {
          heading: 'Work',
          principles: [
            { lead: 'One.', text: 'Two three.' },
            { lead: 'Four.', text: 'Five.' },
          ],
          paragraphs: [],
        },
      ],
    });
  });

  test('known answers: the bio takes the typographer a post gets, in every part', () => {
    expect(aboutParts("It's Joseph's.\n\n### What I'm at\n\n- **I've one.** It's two.\n")).toEqual({
      lede: ['It’s Joseph’s.'],
      sections: [
        {
          heading: 'What I’m at',
          principles: [{ lead: 'I’ve one.', text: 'It’s two.' }],
          paragraphs: [],
        },
      ],
    });
  });

  test('markup Home would print as characters stops the build, rather than reach the page', () => {
    expect(() => aboutParts('See [the lab](/lab/).')).toThrow(/plain text only/);
    expect(() => aboutParts('### A\n\n- **One.** Has `code`.')).toThrow(/plain text only/);
    expect(() => aboutParts('### A\n\n- No bold lead.')).toThrow(/bold line/);
  });

  test('withLinks: the first mention of each name becomes its link, the rest stays text', () => {
    const names = [
      { name: 'Route Lab', href: '/lab/routes/' },
      { name: 'Raft Lab', href: '/lab/raft/' },
    ];
    expect(withLinks('The Route Lab and the Raft Lab; the Route Lab again.', names)).toEqual([
      'The ',
      { text: 'Route Lab', href: '/lab/routes/' },
      ' and the ',
      { text: 'Raft Lab', href: '/lab/raft/' },
      '; the Route Lab again.',
    ]);
    expect(withLinks('Nothing here.', names)).toEqual(['Nothing here.']);
    expect(withLinks('Route Lab', [])).toEqual(['Route Lab']);
  });

  test('withLinks: every lab the bio names links where its words are, the five of them', () => {
    const names = LAB_NAMES.map(({ slug, name }) => ({ name, href: `/lab/${slug}/` }));
    expect(LAB_NAMES.map((n) => n.name)).toEqual([
      'Route Lab',
      'Queue Lab',
      'Cache Lab',
      'Backfill Lab',
      'Raft Lab',
    ]);
    expect(withLinks('The Queue Lab, the Cache Lab and the Backfill Lab.', names)).toEqual([
      'The ',
      { text: 'Queue Lab', href: '/lab/queue/' },
      ', the ',
      { text: 'Cache Lab', href: '/lab/cache/' },
      ' and the ',
      { text: 'Backfill Lab', href: '/lab/backfill/' },
      '.',
    ]);
    // Each name the real bio holds, wherever it stands, becomes a link once.
    const text = aboutParts(body)
      .sections.flatMap((s) => [...s.principles.map((p) => p.text), ...s.paragraphs])
      .join(' ');
    const linked = withLinks(text, names).filter((run) => typeof run !== 'string');
    expect(linked.map((run) => run.text).sort()).toEqual(LAB_NAMES.map((n) => n.name).sort());
  });
});
