// Home's figures (docs/design/overhaul.md, "Stats row"; ADR 0027): every number Home prints is
// worked out at build from the system of record it counts, never typed. This module is pure: the
// rules that turn the records into figures, with known answers in test/home.test.ts. Reading the
// records (the repository's history, docs/adr/, the test files) is lib/home-sources.ts.

const MS_PER_DAY = 86_400_000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A decision record as Home counts and marks it: its number, its title and the day it was
 *  decided, the first date on its Status line. */
export interface Decision {
  readonly number: string;
  readonly title: string;
  readonly day: string;
}

/**
 * A decision record from its file's text, or null for a file that is not one (the index, a
 * template): its "# ADR nnnn: title" heading and the first YYYY-MM-DD on its "Status:" line. An
 * accepted record that was proposed earlier is dated by the first date, when it was decided.
 */
export function decisionOf(text: string): Decision | null {
  const head = /^# ADR (\d{4}): (.+)$/m.exec(text);
  const status = /^Status:.*?(\d{4}-\d{2}-\d{2})/m.exec(text);
  if (!head || !status) return null;
  return { number: head[1] ?? '', title: (head[2] ?? '').trim(), day: status[1] ?? '' };
}

/** Test declarations in a test file's source: each `test('…'` or `it('…'`, written once however
 *  many times a loop runs it. `test.skip(condition, …)` and `test.describe(…)` are not tests. */
export function testsIn(source: string): number {
  return (
    source.match(/(?<![\w.])(?:test|it)(?:\.(?:only|fails|concurrent))?\(\s*[`'"]/g)?.length ?? 0
  );
}

/** A post's reading time in whole minutes, at 230 words a minute, at least one. */
export function readingMinutes(text: string): number {
  const words = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;
  return Math.max(1, Math.ceil(words / 230));
}

/** One day of the activity calendar. */
export interface ActivityDay {
  readonly day: string;
  readonly commits: number;
  /** 0 for no commit, then 1 to 4, a quarter of the busiest day's commits each. */
  readonly level: 0 | 1 | 2 | 3 | 4;
  /** The decision records dated that day. */
  readonly decisions: readonly Decision[];
}

/** The calendar: a column a week, Monday to Sunday, the last column the week of the latest commit. A
 *  day after the latest commit is not drawn. */
export interface Activity {
  readonly weeks: readonly (readonly ActivityDay[])[];
  /** The months, each at the first column whose week holds its first day (or the calendar's first). */
  readonly months: readonly { readonly name: string; readonly column: number }[];
  readonly commits: number;
  /** The days with at least one commit. */
  readonly active: number;
  readonly first: string;
  readonly last: string;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const at = (day: string): number => Date.parse(`${day}T00:00:00Z`);
const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
/** The Monday on or before a day. */
const monday = (ms: number): number => ms - ((new Date(ms).getUTCDay() + 6) % 7) * MS_PER_DAY;

/**
 * The activity calendar from each commit's day (YYYY-MM-DD, UTC, one entry a commit) and the decision
 * records: from the week of the first commit, or `least` weeks back if that is later, to the week
 * of the last, and never more than `most` weeks.
 */
export function activity(
  commitDays: readonly string[],
  decisions: readonly Decision[],
  least = 26,
  most = 53,
): Activity | null {
  const days = commitDays.filter((day) => DAY.test(day) && !Number.isNaN(at(day))).sort();
  const first = days[0];
  const last = days.at(-1);
  if (first === undefined || last === undefined) return null;
  const counts = new Map<string, number>();
  for (const day of days) counts.set(day, (counts.get(day) ?? 0) + 1);
  const busiest = Math.max(...counts.values());
  const end = monday(at(last));
  const span = Math.round((end - monday(at(first))) / (7 * MS_PER_DAY)) + 1;
  const columns = Math.min(most, Math.max(least, span));
  const start = end - (columns - 1) * 7 * MS_PER_DAY;

  const weeks: ActivityDay[][] = [];
  const months: { name: string; column: number }[] = [];
  for (let column = 0; column < columns; column++) {
    const week: ActivityDay[] = [];
    for (let row = 0; row < 7; row++) {
      const ms = start + (column * 7 + row) * MS_PER_DAY;
      if (ms > at(last)) break;
      const day = iso(ms);
      const commits = counts.get(day) ?? 0;
      const level = (
        commits === 0 ? 0 : Math.ceil((4 * commits) / busiest)
      ) as ActivityDay['level'];
      week.push({ day, commits, level, decisions: decisions.filter((d) => d.day === day) });
      const date = new Date(ms);
      if (date.getUTCDate() === 1 || (column === 0 && row === 0))
        months.push({ name: MONTHS[date.getUTCMonth()] ?? '', column });
    }
    weeks.push(week);
  }
  // A month that starts in the calendar's first week is named once, at its own first day.
  const named = months.filter(
    (month, i) => i === months.length - 1 || months[i + 1]?.column !== month.column,
  );
  return { weeks, months: named, commits: days.length, active: counts.size, first, last };
}

/** A count in figures with thousands separated: "8,600". */
export const figure = (n: number): string => n.toLocaleString('en-US');
