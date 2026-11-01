import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { decisionOf, figure, testsIn } from '../src/lib/home';
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

describe("the repository's record", () => {
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
