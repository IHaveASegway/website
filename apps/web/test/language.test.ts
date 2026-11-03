import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { html, read } from './support/dist';

// One language across the site (docs/content.md, "The site's language"; ADR 0029). A word the site
// invented, and that a reader had to translate, is retired here, so it cannot drift back one page at
// a time. In domain-driven design this is the ubiquitous language (Evans, Domain-Driven Design,
// chapter 2); the test is its fitness function. A longer list would move to a prose linter such as
// Vale, which can read the same words.

/** Each retired phrase, and what the site says instead. */
export const RETIRED: readonly (readonly [RegExp, string])[] = [
  [/the systems work flows through/i, 'the backend systems other software runs on'],
  [/lines? where agents/i, 'coding agents'],
  [/\bspecs, walls\b/i, 'scoped permissions'],
  [/\bkeeps its judgment\b/i, 'people still make the decisions that matter'],
  [/\bthe lesson:/i, 'say the thing plainly'],
  [/two-way doors?/i, 'I go fast when a choice is easy to undo'],
  [/\blamps?\b/i, 'dots'],
  [/\bbuffer stops?\b/i, 'the dead-letter queue'],
  [/\bsiding\b/i, 'the dead-letter queue'],
  [/\brules live in the build\b/i, 'I turn rules into tests'],
  [/\bseeded runs\b/i, 'simulated runs, on Home and About'],
  [/\bfield notes?\b/i, 'essays'],
  [/\bcolour\b/i, 'US English: color'],
  [/\bdemos?\b/i, 'lab, for the page'],
  [/\bpart way\b/i, 'partway, one word'],
];

/** Words only a lab with its own vocabulary keeps: "safety properties" is Raft's, and the others
 *  have checks. */
const PROPERTIES = /\bpropert(?:y|ies)\b/i;
const CHECKS_LABS = ['lab/queue/', 'lab/cache/', 'lab/backfill/'];

/** Raft's word is server, the paper's and the glossary's: a node is the Cache Lab's. What the app
 *  writes in the browser is held by e2e/raft.spec.ts and test/raft.test.ts. */
const NODE = /\bnodes?\b/i;
const SERVER_LABS = ['lab/raft/'];

/** The Route Lab's term, which its write-up says too. "Of driving" is another thing, what a plan
 *  does; this is how far a place is. */
const DRIVING_TIME = /\bdriving times?\b/i;

/**
 * Retired words that still stand in a write-up with a review stamp: changing them needs Joseph's read,
 * so an agent can't. Each is the exact file and word, and the test below fails once it has gone, so
 * the list can only shrink. They're in the report of the pass that found them.
 */
const AWAITING_HIS_READ: Readonly<Record<string, readonly string[]>> = {
  'lab/routes/index.html': ['colour'],
  'lab/routes.md': ['colour'],
  'lab/raft/index.html': ['demo'],
  'lab/raft.md': ['demo'],
  'lab/cache/index.html': ['propert'],
  'lab/cache.md': ['propert'],
  'lab/backfill/index.html': ['propert'],
  'lab/backfill.md': ['propert'],
};

const awaiting = (file: string, hit: string) =>
  (AWAITING_HIS_READ[file] ?? []).some((word) => hit.includes(word));

/** The words a page says outside its text: what a screen reader announces, a tooltip shows and a
 *  link preview quotes. Until 2026-11-02 this test stripped them with the tags, so "What the lamps
 *  mean" stood on one lab, in an aria-label, long after "lamps" retired. */
const SAID_IN = /\b(?:aria-label|alt|title)="([^"]*)"|<meta\b[^>]*\bcontent="([^"]*)"/g;

/** A page's words: its markup with scripts, styles and tags taken out, and the words in its tags'
 *  attributes kept. */
export const words = (page: string) => {
  const told = [...page.matchAll(SAID_IN)].map(([, attribute, meta]) => attribute ?? meta);
  return `${page
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')} ${told.join(' ')}`.replace(/\s+/g, ' ');
};

/** What a page's words retire, by phrase. */
export const retiredIn = (text: string) =>
  RETIRED.filter(([phrase]) => phrase.test(text)).map(
    ([phrase, instead]) => `${phrase.source}: say "${instead}"`,
  );

describe('the words the site retired stay retired', () => {
  // The labs' own pages may say "seeded" and "seed": that is where the term is defined and used.
  const onLabPage = (file: string) => /^lab\/[a-z]+\//.test(file);
  for (const file of html) {
    test(file, () => {
      const text = words(read(file));
      const found = [
        ...retiredIn(text),
        ...(CHECKS_LABS.some((lab) => file.startsWith(lab)) && PROPERTIES.test(text)
          ? ['propert: say "checks", which outside Raft is the word']
          : []),
        ...(SERVER_LABS.some((lab) => file.startsWith(lab)) && NODE.test(text)
          ? ['node: say "server", which on the Raft Lab is the word']
          : []),
        ...(DRIVING_TIME.test(text) ? ['driving time: say "drive time"'] : []),
      ].filter(
        (hit) => !(onLabPage(file) && hit.startsWith('\\bseeded runs')) && !awaiting(file, hit),
      );
      expect(found).toEqual([]);
    });
  }

  test('known answers: a retired phrase is named with what to say instead', () => {
    expect(retiredIn('The lines where agents write the code')).toEqual([
      'lines? where agents: say "coding agents"',
    ]);
    expect(retiredIn('I build backend systems.')).toEqual([]);
    // In an attribute a screen reader announces, or a tag a link preview quotes, it counts too.
    expect(retiredIn(words('<ul aria-label="What the lamps mean"></ul>'))).toEqual([
      '\\blamps?\\b: say "dots"',
    ]);
    expect(retiredIn(words('<meta name="description" content="Field notes by me">'))).toEqual([
      '\\bfield notes?\\b: say "essays"',
    ]);
    expect(retiredIn(words('<ul aria-label="What the dots mean"></ul>'))).toEqual([]);
  });
});

// What a search result and a link preview show, which a page's body doesn't. "Lab" is the page's
// name in the site's language, and until 2026-11-02 /lab/'s description said "Demos by". A lab's
// write-up is stamped text, so the word is held here in what page code writes, not yet in its body.
describe("a page's description and its link preview call a lab a lab", () => {
  /** The strings a page's head gives a search result and a link preview. */
  const head = (page: string) =>
    [
      ...page.matchAll(
        /<(?:meta (?:name="description"|property="og:(?:title|description)"|property="og:image:alt") content="([^"]*)"|title>([^<]*)<\/title)/g,
      ),
    ].flatMap(([, content, title]) => [content ?? title ?? '']);
  const demo = /\bdemos?\b/i;

  for (const file of html) {
    test(file, () => {
      const strings = head(read(file));
      expect(strings.length).toBeGreaterThan(0);
      expect(strings.filter((text) => demo.test(text))).toEqual([]);
    });
  }

  test('known answers: the head is read, and the old description is what this finds', () => {
    const page =
      '<title>Lab</title><meta name="description" content="Demos by Joseph Peterson that run in your browser.">';
    expect(head(page)).toEqual(['Lab', 'Demos by Joseph Peterson that run in your browser.']);
    expect(head(page).filter((text) => demo.test(text))).toHaveLength(1);
  });
});

// "written decisions, then decision records (ADRs) once" (content.md, "The site's language"): a
// recruiter gets the plain words first, and a tech lead still finds the term. Home's record says it,
// and says what its test count counts: tests as written, once each, since CI runs loops of them and
// shows a number about nine times larger. Fixture builds hold no bio, so no record.
test.runIf(html.includes('lab/index.html'))(
  "the site names decision records once, on Home's record, and counts tests as written",
  () => {
    const said = html.filter((file) => /decision records \(ADRs\)/.test(words(read(file))));
    expect(said).toEqual(['index.html']);
    const record = /This site so far: [^.]*\./.exec(words(read('index.html')))?.[0];
    expect(record).toMatch(/^This site so far: \d+ decision records \(ADRs\), /);
    expect(record).toMatch(
      /, [\d,]+ tests written and [\d,]+ simulated runs on every pull request\.$/,
    );
  },
);

test('the content files say the same: a draft does not bring a retired word back', () => {
  const root = join(process.cwd(), 'src/content');
  const entries = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((file) =>
    file.endsWith('.md'),
  );
  expect(entries.length).toBeGreaterThan(3);
  const found = entries.flatMap((file) =>
    retiredIn(readFileSync(join(root, file), 'utf8'))
      .filter((hit) => !(file.startsWith('lab/') && hit.startsWith('\\bseeded runs')))
      .filter((hit) => !awaiting(file, hit))
      .map((hit) => `${file}: ${hit}`),
  );
  expect(found).toEqual([]);
});

test('the Raft Lab’s write-up says server, never node', () => {
  const text = readFileSync(join(process.cwd(), 'src/content/lab/raft.md'), 'utf8');
  expect(text).toMatch(/\bservers?\b/i);
  expect(text).not.toMatch(NODE);
});

test('every word waiting for his read still stands where the list says, so the list can only shrink', () => {
  const root = join(process.cwd(), 'src/content');
  for (const [file, waiting] of Object.entries(AWAITING_HIS_READ)) {
    const text = file.endsWith('.md')
      ? readFileSync(join(root, file), 'utf8')
      : html.includes(file)
        ? words(read(file))
        : null;
    if (text === null) continue;
    for (const word of waiting)
      expect(new RegExp(`\\b${word}`, 'i').test(text), `${file}: ${word}`).toBe(true);
  }
});
