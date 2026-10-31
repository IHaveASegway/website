import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { activity, decisionOf, figure, readingMinutes, testsIn } from '../src/lib/home';
import { countTests, readCommitDays, readDecisions } from '../src/lib/home-sources';

// Home's figures (docs/design/overhaul.md, "Stats row"; ADR 0027): every number Home prints is
// worked out at build from its system of record (lib/home.ts, lib/home-sources.ts). Known answers
// for the rules, then each reader held to its record read another way, so a figure cannot drift
// from what it counts.

const app = fileURLToPath(new URL('..', import.meta.url));
const adr = join(app, '../../docs/adr');

describe('decision records', () => {
  test('known answers: a record is read by its heading and the first date on its Status line', () => {
    expect(
      decisionOf(
        '# ADR 0012: Public repository\n\nStatus: Accepted · 2026-10-25 (proposed 2026-10-22)',
      ),
    ).toEqual({ number: '0012', title: 'Public repository', day: '2026-10-25' });
    expect(decisionOf('# ADRs\n\nAn index.')).toBeNull();
    expect(decisionOf('# ADR 0001: No status line')).toBeNull();
  });

  test('every numbered file in docs/adr/ is counted once, in number order', () => {
    const numbered = readdirSync(adr).filter((name) => /^\d{4}-.+\.md$/.test(name));
    const read = readDecisions();
    expect(read.map((d) => d.number)).toEqual(numbered.map((name) => name.slice(0, 4)).sort());
    for (const d of read) expect(d.day, d.number).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('tests written', () => {
  test('known answers: a declaration counts once; a skip or a describe does not', () => {
    const source = [
      "test('a', () => {});",
      'test(`b ${x}`, () => {});',
      'it("c", () => {});',
      "test.describe('d', () => {});",
      "test.skip(true, 'not here');",
      "describe('e', () => {});",
      'for (const x of xs) test(`f ${x}`, () => {});',
      'latest(', // a word that ends in "test(" is not one
    ].join('\n');
    expect(testsIn(source)).toBe(4);
  });

  test('the count is the sum over every test file in test/ and e2e/', () => {
    const files = ['test', 'e2e'].flatMap((dir) =>
      readdirSync(join(app, dir), { recursive: true, encoding: 'utf8' })
        .filter((name) => /\.(spec|test)\.ts$/.test(name) && !name.startsWith('fixtures'))
        .map((name) => join(app, dir, name)),
    );
    const total = files.reduce((n, file) => n + testsIn(readFileSync(file, 'utf8')), 0);
    expect(total).toBeGreaterThan(0);
    expect(countTests()).toBe(total);
  });
});

describe('reading time', () => {
  test('known answers: 230 words a minute, rounded up, at least one', () => {
    expect(readingMinutes('')).toBe(1);
    expect(readingMinutes('word '.repeat(230))).toBe(1);
    expect(readingMinutes('word '.repeat(231))).toBe(2);
    // Punctuation and markup are not words; a contraction or a hyphenated word is one.
    expect(readingMinutes('## Heading\n\nIt’s a well-known - fact.')).toBe(1);
    expect(readingMinutes(`${'one-two '.repeat(460)}`)).toBe(2);
  });
});

describe('the activity calendar', () => {
  test('known answers: a column a week from Monday, ending on the latest commit', () => {
    // Wednesday 2026-10-21, Thursday 2026-10-22 twice, Saturday 2026-10-31 four times.
    const days = ['2026-10-21', '2026-10-22', '2026-10-22', ...Array(4).fill('2026-10-31')];
    const grid = activity(days, [{ number: '0001', title: 'A', day: '2026-10-22' }], 3);
    if (!grid) throw new Error('no calendar');
    expect(grid.commits).toBe(7);
    expect(grid.active).toBe(3);
    expect(grid.first).toBe('2026-10-21');
    expect(grid.last).toBe('2026-10-31');
    // Three weeks back from the week of 26 October: 12, 19 and 26 October, each from Monday.
    expect(grid.weeks.map((week) => week[0]?.day)).toEqual([
      '2026-10-12',
      '2026-10-19',
      '2026-10-26',
    ]);
    // The last week stops at Saturday, the latest commit: no day after it is drawn.
    expect(
      grid.weeks
        .at(-1)
        ?.map((d) => d.day)
        .at(-1),
    ).toBe('2026-10-31');
    expect(grid.weeks.at(-1)).toHaveLength(6);
    const day = (iso: string) => grid.weeks.flat().find((d) => d.day === iso);
    // A quarter of the busiest day's four commits a step.
    expect(day('2026-10-31')).toMatchObject({ commits: 4, level: 4 });
    expect(day('2026-10-22')).toMatchObject({
      commits: 2,
      level: 2,
      decisions: [{ number: '0001' }],
    });
    expect(day('2026-10-21')).toMatchObject({ commits: 1, level: 1, decisions: [] });
    expect(day('2026-10-20')).toMatchObject({ commits: 0, level: 0 });
    expect(grid.months).toEqual([{ name: 'Oct', column: 0 }]);
  });

  test('known answers: at most the weeks asked for, a month named at the column of its first day', () => {
    const grid = activity(['2026-01-01', '2026-03-04'], [], 1, 6);
    if (!grid) throw new Error('no calendar');
    expect(grid.weeks).toHaveLength(6);
    expect(grid.commits).toBe(2);
    expect(grid.weeks[0]?.[0]?.day).toBe('2026-01-26');
    // 26 January's week holds 1 February, so that column is February's; 1 March is in the fifth.
    expect(grid.months).toEqual([
      { name: 'Feb', column: 0 },
      { name: 'Mar', column: 4 },
    ]);
    expect(activity([], [])).toBeNull();
    expect(activity(['not a day'], [])).toBeNull();
  });

  test("the record is the repository's history: each commit's day in UTC, as git prints it", () => {
    const shallow = execFileSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: app,
      encoding: 'utf8',
    }).trim();
    // A shallow clone has no whole history to read, and the reader gives nothing there.
    if (shallow !== 'false') {
      expect(readCommitDays()).toEqual([]);
      return;
    }
    const log = execFileSync('git', ['log', '--format=%ct'], { cwd: app, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
      .map((seconds) => new Date(Number(seconds) * 1000).toISOString().slice(0, 10));
    expect(readCommitDays()).toEqual(log);
  });
});

test('known answers: a figure groups its thousands', () => {
  expect(figure(8600)).toBe('8,600');
  expect(figure(26)).toBe('26');
});
