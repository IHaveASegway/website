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
];

/** A page's words: its markup with scripts, styles and tags taken out. */
const words = (page: string) =>
  page
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');

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
      const found = retiredIn(words(read(file))).filter(
        (hit) => !(onLabPage(file) && hit.startsWith('\\bseeded runs')),
      );
      expect(found).toEqual([]);
    });
  }

  test('known answers: a retired phrase is named with what to say instead', () => {
    expect(retiredIn('The lines where agents write the code')).toEqual([
      'lines? where agents: say "coding agents"',
    ]);
    expect(retiredIn('I build backend systems.')).toEqual([]);
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
      .map((hit) => `${file}: ${hit}`),
  );
  expect(found).toEqual([]);
});
