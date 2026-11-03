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
];

/** Words only a lab with its own vocabulary keeps: "safety properties" is Raft's, and the others
 *  have checks. */
const PROPERTIES = /\bpropert(?:y|ies)\b/i;
const CHECKS_LABS = ['lab/queue/', 'lab/cache/', 'lab/backfill/'];

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
