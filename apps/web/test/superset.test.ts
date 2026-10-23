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
 * the build's day (lib/build.ts, builtOn) in Home's readout and in the footer's build line, and
 * the year in the copyright. Each is matched in its exact context, so no other date is masked.
 */
const WALL_CLOCK: readonly [RegExp, string][] = [
  [
    /<dt class="label">Built<\/dt><dd><time datetime="\d{4}-\d{2}-\d{2}">\d{4}-\d{2}-\d{2}<\/time>/g,
    '<dt class="label">Built</dt><dd><time datetime="DAY">DAY</time>',
  ],
  [/ · built \d{4}-\d{2}-\d{2}</g, ' · built DAY<'],
  [/© \d{4} /g, '© YEAR '],
];

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
  const home = (day: string, year = '2026', posts = '') =>
    `<dl><div class="readout"><dt class="label">Built</dt><dd><time datetime="${day}">${day}</time></dd></div></dl>${posts}<p>© ${year} Joseph Peterson</p>`;
  const page = (day: string, published = '2026-10-15') =>
    `<time datetime="${published}">${published}</time><p>© 2026 Joseph Peterson · build abc1234 · built ${day}</p>`;

  test('the same files, plus pages, pass', () => {
    const files = { 'index.html': home('2026-10-23'), 'a/index.html': page('2026-10-23') };
    const preview = { ...files, 'draft/index.html': page('2026-10-23') };
    expect(supersetProblems(build(files), build(preview))).toEqual([]);
  });

  test('two builds either side of midnight differ only in the build day and the year: they pass', () => {
    const before = build({
      'index.html': home('2026-12-31', '2026'),
      'a/index.html': page('2026-12-31'),
    });
    const after = build({
      'index.html': home('2027-01-01', '2027'),
      'a/index.html': page('2027-01-01'),
    });
    expect(supersetProblems(before, after)).toEqual([]);
  });

  test('a missing file, a listed draft or any other date that differs is named', () => {
    const base = build({ 'index.html': home('2026-10-23'), 'a/index.html': page('2026-10-23') });
    expect(supersetProblems(base, build({ 'index.html': home('2026-10-23') }))).toEqual([
      'a/index.html: missing from the build with drafts',
    ]);
    const listsADraft = build({
      'index.html': home('2026-10-23', '2026', '<a href="/draft/">A draft</a>'),
      'a/index.html': page('2026-10-23'),
    });
    expect(supersetProblems(base, listsADraft)).toEqual(["index.html: differs from production's"]);
    const otherDate = build({
      'index.html': home('2026-10-23'),
      'a/index.html': page('2026-10-23', '2026-10-16'),
    });
    expect(supersetProblems(base, otherDate)).toEqual(["a/index.html: differs from production's"]);
  });

  test('a binary file is compared byte for byte, never through the clock', () => {
    const png = (last: number) => Buffer.from([0x89, 0x50, 0x4e, 0x47, last]).toString('latin1');
    const base = build({ 'index.html': home('2026-10-23'), 'og.png': png(1) });
    const superset = build({ 'index.html': home('2026-10-23'), 'og.png': png(2) });
    expect(supersetProblems(base, superset)).toEqual(["og.png: differs from production's"]);
  });
});

describe('the builds', () => {
  const pairs = [
    ['dist', dist, join(app, 'dist-preview')],
    ...['fixture-two', 'fixture-three', 'fixture-many'].map((name) => [
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
