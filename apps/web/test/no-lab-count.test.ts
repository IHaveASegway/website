import { describe, expect, test } from 'vitest';
import { read, textFiles } from './support/dist';

// No page says how many labs there are (ADR 0031): Joseph will keep making more, so a number beside
// "labs" goes stale the day one ships. Read from what the build wrote, every text file a reader or a
// crawler can get, the printed sheet's words among them, since paper is the same page. An HTML file is
// read for its words, its JSON-LD and what its tags say outside them: a description, a link preview's
// alt, a label. On every build vitest.config.ts names.

const NUMBER = '(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|dozen|\\d+)';

/** A number beside "labs": before it, with at most one word between ("five small labs"), or after
 *  it ("labs: 5"). "The first labs" says no count, and one lab is one lab. */
const COUNT = new RegExp(
  `\\b${NUMBER}(?:\\s+[\\w-]+)?\\s+labs\\b|\\blabs\\s*[:(]?\\s*${NUMBER}\\b`,
  'i',
);

const SAID = /\b(?:aria-label|alt|title|content|placeholder)="([^"]*)"/g;

/** A file's words, as the check reads them. */
export function wordsOf(file: string, text: string): string {
  if (!file.endsWith('.html')) return text;
  const told = [...text.matchAll(SAID)].map(([, value]) => value);
  return `${text
    .replace(/<script\b(?![^>]*application\/ld\+json)[\s\S]*?<\/script>/g, ' ')
    .replace(/<(style|svg)\b[\s\S]*?<\/\1>/g, ' ')
    .replace(/<[^>]+>/g, ' ')} ${told.join(' ')}`
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Each count of the labs a file's words hold. */
export const countsIn = (file: string, text: string): string[] =>
  [...wordsOf(file, text).matchAll(new RegExp(COUNT, 'gi'))].map(([found]) => found);

describe('no page counts the labs', () => {
  for (const file of textFiles) {
    test(file, () => {
      expect(countsIn(file, read(file))).toEqual([]);
    });
  }

  test('known answers: what it catches, wherever it stands, and what it passes', () => {
    expect(countsIn('a.html', '<a>Try all five labs</a>')).toEqual(['five labs']);
    expect(countsIn('a.html', '<p>All <b>5</b> labs</p>')).toEqual(['5 labs']);
    expect(countsIn('a.html', '<p>Five small labs.</p>')).toEqual(['Five small labs']);
    expect(countsIn('a.html', '<meta name="description" content="Six labs in all">')).toEqual([
      'Six labs',
    ]);
    expect(
      countsIn('a.html', '<script type="application/ld+json">{"name":"All 5 labs"}</script>'),
    ).toEqual(['5 labs']);
    expect(countsIn('a.txt', 'labs: 5')).toEqual(['labs: 5']);
    for (const fine of [
      '<p>the first labs were live</p>',
      '<p>Try all the labs</p>',
      '<p>Each lab explains one part.</p>',
      '<p>One lab at a time.</p>',
      '<p>Queue Lab Three workers</p>',
      '<script>let a = "five labs"</script>',
    ])
      expect(countsIn('a.html', fine), fine).toEqual([]);
  });
});
