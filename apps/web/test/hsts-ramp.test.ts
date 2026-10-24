import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, test } from 'vitest';
import { app } from './support/dist';

// Row 8b of the weekly zone audit (operations.md, "HSTS ramp step"): which step of ADR 0011's ramp
// the zone serves, and whether the next one is late by the date the maintenance calendar records.
// The audit cannot reach the zone from here, so `verify-zone.sh --hsts-ramp <max-age>` runs the
// row alone, with a fixed day and a calendar written here: known answers, no network.

const script = join(app, '../../scripts/verify-zone.sh');
const realCalendar = join(app, '../../docs/operations.md');
const root = mkdtempSync(join(tmpdir(), 'hsts-ramp-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

let count = 0;
/** A calendar whose HSTS row's first cell is `when`, as operations.md writes the row. */
function calendar(when: string): string {
  const file = join(root, `calendar-${count++}.md`);
  writeFileSync(
    file,
    [
      '| When | Task | How | Minutes a month |',
      '|---|---|---|---|',
      '| Weekly, Monday | Zone audit | Automatic | 0 while green |',
      `| ${when} | The HSTS ramp: 300 s, 1 week, 1 month, 12 months | [HSTS ramp step](#hsts-ramp-step) | Once |`,
      '',
    ].join('\n'),
  );
  return file;
}

function row(age: string, today: string, file: string): { status: number | null; line: string } {
  const result = spawnSync('bash', [script, '--hsts-ramp', age], {
    encoding: 'utf8',
    env: { PATH: process.env['PATH'] ?? '', TODAY: today, HSTS_CALENDAR: file },
  });
  return { status: result.status, line: `${result.stdout}${result.stderr}`.trim() };
}

describe('known answers', () => {
  const due = calendar('After PR 2, about 5 weeks. Next: step 2, due 2026-10-23');
  const cases: [string, string, string, string, RegExp][] = [
    [
      'step 1, the day before the date',
      '300',
      '2026-10-22',
      due,
      /^PASS {2}8b {2}.*step 1 of 4.*step 2 \(max-age 604800\) is due 2026-10-23$/,
    ],
    ['step 1, on the date', '300', '2026-10-23', due, /^PASS {2}8b {2}.*is due 2026-10-23$/],
    [
      'step 1, a day after the date',
      '300',
      '2026-10-24',
      due,
      /^WARN {2}8b {2}.*step 1 of 4.*step 2 \(max-age 604800\) has been due since 2026-10-23/,
    ],
    [
      'step 1, a year after',
      '300',
      '2027-10-24',
      due,
      /^WARN {2}8b {2}.*has been due since 2026-10-23/,
    ],
    [
      'step 2 taken, the calendar not moved on',
      '604800',
      '2026-10-24',
      due,
      /^WARN {2}8b {2}.*step 2 of 4.*names step 2: no date recorded for step 3$/,
    ],
    [
      'step 1, no date in the row',
      '300',
      '2026-10-24',
      calendar('After PR 2, about 5 weeks'),
      /^WARN {2}8b {2}.*no date recorded for step 2/,
    ],
    [
      'step 1, a date written another way',
      '300',
      '2026-10-24',
      calendar('Next: step 2 on 23 October'),
      /^WARN {2}8b {2}.*no date recorded for step 2/,
    ],
    [
      'step 1, no calendar at all',
      '300',
      '2026-10-24',
      join(root, 'missing.md'),
      /^WARN {2}8b {2}.*no date recorded for step 2/,
    ],
    [
      'step 3, on time',
      '2592000',
      '2026-11-20',
      calendar('Next: step 4, due 2026-12-01'),
      /^PASS {2}8b {2}.*step 3 of 4.*step 4 \(max-age 31536000\) is due 2026-12-01$/,
    ],
    [
      'step 4, the last, whatever the calendar says',
      '31536000',
      '2030-01-01',
      due,
      /^PASS {2}8b {2}.*step 4 of 4.*the last; nothing is due/,
    ],
    ['a max-age off the ramp', '86400', '2026-10-24', due, /^SKIP {2}8b {2}.*serves no step/],
    ['no header at all', '', '2026-10-24', due, /^SKIP {2}8b {2}.*serves no step/],
  ];
  for (const [name, age, today, file, expected] of cases) {
    test(`${name}: one line, and never a failure`, () => {
      const { status, line } = row(age, today, file);
      expect(line).toMatch(expected);
      expect(line.split('\n')).toHaveLength(1);
      expect(status).toBe(0);
    });
  }
});

describe('the real calendar', () => {
  test('has one HSTS row, and any date in it is written the way the audit reads it', () => {
    const rows = readFileSync(realCalendar, 'utf8')
      .split('\n')
      .filter((l) => /^\|[^|]*\|\s*The HSTS ramp/.test(l));
    expect(rows).toHaveLength(1);
    const when = rows[0]?.split('|')[1] ?? '';
    if (/Next/.test(when)) expect(when).toMatch(/Next: step [2-4], due \d{4}-\d{2}-\d{2}/);
  });

  test('every step of the ramp gives one line the audit can print', () => {
    for (const age of ['300', '604800', '2592000', '31536000']) {
      const { status, line } = row(age, '2026-10-24', realCalendar);
      expect(line, age).toMatch(/^(PASS|WARN) {2}8b {2}HSTS ramp: at step [1-4] of 4/);
      expect(status, age).toBe(0);
    }
  });
});
