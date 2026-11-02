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
