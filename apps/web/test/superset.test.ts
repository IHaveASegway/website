import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { app, dist, filesIn } from './support/dist';

// The superset contract (ADR 0015): a build with drafts holds every file of the same commit's
// production build, byte for byte, and only adds pages. A pull request's e2e runs on its preview,
// dist-preview/, so dist/, the build that deploys, is tested there only through this premise.
// Known answers on small builds written here, then the real pair and each fixture pair.

/**
 * The values a build reads from the clock, the only bytes two builds of one commit may differ in:
 * the year in the footer's copyright. No page prints the build's day any more. The year is matched
 * in its exact context, so no other date is masked.
 */
const WALL_CLOCK: readonly [RegExp, string][] = [[/© \d{4} /g, '© YEAR ']];

const withoutClock = (text: string) =>
  WALL_CLOCK.reduce((out, [pattern, placeholder]) => out.replace(pattern, placeholder), text);

/** Why `superset` does not hold every file of `base` byte for byte, one line per file. */
export function supersetProblems(base: string, superset: string): string[] {
  const has = new Set(filesIn(superset));
  return filesIn(base).flatMap((file) => {
    if (!has.has(file)) return [`${file}: missing from the build with drafts`];
    const a = readFileSync(join(base, file));
    const b = readFileSync(join(superset, file));
    if (a.equals(b)) return [];
    if (
      file.endsWith('.html') &&
      withoutClock(a.toString('utf8')) === withoutClock(b.toString('utf8'))
    )
      return [];
    return [`${file}: differs from production's`];
  });
}

describe('known answers', () => {
  const root = mkdtempSync(join(tmpdir(), 'superset-'));
  afterAll(() => rmSync(root, { recursive: true, force: true }));
  let count = 0;
  function build(files: Record<string, string>): string {
    const dir = join(root, String(count++));
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
    return dir;
  }
  const home = (year = '2026', posts = '') =>
    `<h1>Joseph Peterson</h1>${posts}<p class="fine-print">© ${year} Joseph Peterson</p>`;
  const page = (year = '2026', published = '2026-10-15') =>
    `<time datetime="${published}">${published}</time><p class="fine-print">© ${year} Joseph Peterson</p>`;

  test('the same files, plus pages, pass', () => {
    const files = { 'index.html': home(), 'a/index.html': page() };
    const preview = { ...files, 'draft/index.html': page() };
    expect(supersetProblems(build(files), build(preview))).toEqual([]);
  });

  test('two builds either side of New Year differ only in the year: they pass', () => {
    const before = build({ 'index.html': home('2026'), 'a/index.html': page('2026') });
    const after = build({ 'index.html': home('2027'), 'a/index.html': page('2027') });
    expect(supersetProblems(before, after)).toEqual([]);
  });

  test('a missing file, a listed draft or any other date that differs is named', () => {
    const base = build({ 'index.html': home(), 'a/index.html': page() });
    expect(supersetProblems(base, build({ 'index.html': home() }))).toEqual([
      'a/index.html: missing from the build with drafts',
    ]);
    const listsADraft = build({
      'index.html': home('2026', '<a href="/draft/">A draft</a>'),
      'a/index.html': page(),
    });
    expect(supersetProblems(base, listsADraft)).toEqual(["index.html: differs from production's"]);
    const otherDate = build({ 'index.html': home(), 'a/index.html': page('2026', '2026-10-16') });
    expect(supersetProblems(base, otherDate)).toEqual(["a/index.html: differs from production's"]);
  });

  test('a binary file is compared byte for byte, never through the clock', () => {
    const png = (last: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, last]).toString('latin1');
    const base = build({ 'index.html': home(), 'og.png': png(1) });
    const superset = build({ 'index.html': home(), 'og.png': png(2) });
    expect(supersetProblems(base, superset)).toEqual(["og.png: differs from production's"]);
  });
});

describe('the builds', () => {
  const pairs = [
    ['dist', dist, join(app, 'dist-preview')],
    ...['fixture-none', 'fixture-one', 'fixture-many'].map((name) => [
      name,
      join(app, '.fixtures', name),
      join(app, '.fixtures', `${name}-preview`),
    ]),
  ] as const;

  for (const [name, base, superset] of pairs) {
    test(`${name}: its build with drafts holds every file of it, byte for byte`, () => {
      expect(filesIn(base).length).toBeGreaterThan(10);
      expect(supersetProblems(base, superset)).toEqual([]);
    });
  }
});
