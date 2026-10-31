import { properties, type PropertyId } from './check';
import {
  count,
  countOf,
  DAYS,
  dayText,
  isoDate,
  TASKS,
  WEEK_END,
  weekday,
  when,
  type Mode,
  type Outcome,
  type RunState,
  type TaskName,
  type TaskState,
} from './core';
import { replay, type Action, type Config, type Sim } from './sim';

// What the Backfill Lab shows, as data and text, from a run's state: no markup yet. The page will
// use it twice, as the Raft Lab's does: at build, to draw the opening run so the demo is complete
// without JavaScript, and in the browser, on every frame of a run.

/**
 * The opening: the week's backfill with appends, Wednesday's first load attempt set to fail part
 * way, and every run left to finish, at 02:10. The story: Wednesday's load fails after writing 96
 * of its 179 rows, the retry appends all 179 again, and Wednesday's check finds 96 too many, while
 * the other six days match. Sunday's file lands at 01:34, after Sunday's run has started, so its
 * sensor is seen waiting for it. The browser replays it to take over where the picture stands.
 *
 * Seed 9, not the 7 the Raft Lab opens with: under seed 7 Thursday's load also fails on its own
 * (each extract and load attempt has an 8% chance), and under 8 Saturday's does, so two days come
 * out wrong and the story blurs. 9 is the first seed after 7 where Wednesday's failure is the
 * week's only one.
 */
export const OPENING = {
  seed: 9,
  config: { seed: 9, mode: 'append', partition: 'run-day', maxActiveRuns: 3 } as Config,
  // Both come before the run's first event, so before its first step.
  actions: [
    { at: WEEK_END, steps: 0, kind: 'fail-next-load', day: 2 },
    { at: WEEK_END, steps: 0, kind: 'start' },
  ] as readonly Action[],
  until: WEEK_END + 130,
} as const;

/** The opening run, or the same week with another load mode: with `overwrite`, every day matches. */
export const openingRun = (mode: Mode = 'append'): Sim =>
  replay({ ...OPENING.config, mode }, OPENING.actions, OPENING.until);

/** How many seeded runs the property sweep in test/backfill.test.ts makes: the page says the
 *  number. It is the Raft Lab's count, run six times (overwrite, append, the clock's day, and each
 *  of the three test-only faults): about 3.8 s of the suite on a laptop. */
export const SEEDS_IN_CI = 3_000;

export interface BoardAttempt {
  readonly n: number;
  readonly start: number;
  readonly end: number | null;
  readonly outcome: Outcome;
  readonly wrote: number;
}

export interface BoardCell {
  readonly task: TaskName;
  /** Null until the graph is switched on and the day has a run. */
  readonly state: TaskState | null;
  readonly attempts: readonly BoardAttempt[];
}

/** One day on the run board: its run, each task's state and attempts, and its totals. */
export interface BoardRow {
  readonly day: number;
  readonly name: string;
  readonly date: string;
  readonly run: RunState | null;
  readonly cells: readonly BoardCell[];
  /** When the day's export file lands, as a virtual minute; Infinity when it never does. */
  readonly file: number;
  readonly source: number;
  readonly report: number;
  /** The report's count less the source's: above 0, orders counted twice; below, orders missing. */
  readonly difference: number;
  /** What the run's last check found, or null when it has not run since the run last started. */
  readonly verdict: 'match' | 'mismatch' | null;
}

/** The run board: a row for each day of the week, a cell for each task. */
export function board(sim: Sim): BoardRow[] {
  return Array.from({ length: DAYS }, (_, day) => {
    const run = sim.runs[day];
    const report = sim.report[day] ?? 0;
    const source = sim.source[day] ?? 0;
    return {
      day,
      name: weekday(day),
      date: isoDate(day),
      run: run?.state ?? null,
      cells: TASKS.map((task, i) => {
        const t = run?.tasks[i];
        return {
          task,
          state: t?.state ?? null,
          attempts: (t?.attempts ?? []).map(({ n, start, end, outcome, wrote }) => ({
            n,
            start,
            end,
            outcome,
            wrote,
          })),
        };
      }),
      file: sim.files[day] ?? Infinity,
      source,
      report,
      difference: report - source,
      verdict: run?.verdict
        ? run.verdict.report === run.verdict.source
          ? 'match'
          : 'mismatch'
        : null,
    };
  });
}

/** Rows filed under a day outside the week: where a backfill lands with the `today` key. */
export function strays(sim: Sim): { day: number; date: string; name: string; rows: number }[] {
  return sim.report.flatMap((rows, day) =>
    day >= DAYS && rows > 0 ? [{ day, date: isoDate(day), name: dayText(day), rows }] : [],
  );
}

const joinAnd = (items: readonly string[]): string =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`);

const upperFirst = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/**
 * Why a day's total is wrong, read from its loads, or null when they do not account for every row
 * the day holds. A reason that explains only part of the gap reads as the whole story and
 * misleads, so the plain numbers stand alone instead: after an overwrite and then appends, say.
 */
function cause(sim: Sim, day: number): string | null {
  let left = 0;
  let failed = 0;
  let appends = 0;
  let elsewhere: number | null = null;
  for (const a of sim.attempts) {
    if (a.task !== 'load' || a.day !== day) continue;
    if (a.partition !== day) {
      if (a.outcome === 'success') elsewhere = a.partition;
    } else if (a.mode === 'append') {
      if (a.outcome === 'failed') {
        left += a.wrote;
        failed += 1;
      }
      if (a.outcome === 'success') appends += 1;
    }
  }
  const orders = sim.source[day] ?? 0;
  const held = sim.report[day] ?? 0;
  if (appends > 0 && left + appends * orders === held) {
    const all = count(orders);
    if (left === 0) return appends > 1 ? `its ${all} rows were appended ${times(appends)}` : null;
    const behind = `${failed === 1 ? 'a failed load' : `${failed} failed loads`} left ${count(left)} rows behind`;
    return appends === 1
      ? `${behind}, and the retry appended all ${all} again`
      : `${behind}, and all ${all} were appended ${times(appends)}`;
  }
  if (elsewhere !== null && held === 0) return `its rows were filed under ${dayText(elsewhere)}`;
  return null;
}

/** One or two sentences for the picture's caption: how far the backfill has got, and whether
 *  the days it has checked add up. */
export function summary(sim: Sim): string {
  if (!sim.on)
    return `The job graph is off. Switched on, it creates a run for each day from ${dayText(0)} to ${dayText(DAYS - 1)} at once, and lets ${sim.maxActiveRuns} run at a time.`;
  const failed = sim.runs.flatMap((r) => (r.state === 'failed' ? [weekday(r.day)] : []));
  const done = countOf(sim.runs, (r) => r.state === 'success' || r.state === 'failed');
  const running = countOf(sim.runs, (r) => r.state === 'running');
  const progress =
    done === DAYS
      ? failed.length === 0
        ? `Every run has finished, and all ${DAYS} succeeded.`
        : `Every run has finished, and ${joinAnd(failed)}'s failed.`
      : `${done} of ${DAYS} runs ${done === 1 ? 'has' : 'have'} finished; ${running} running and ${DAYS - done - running} waiting for a run slot.`;

  const checked: number[] = [];
  for (let day = 0; day < DAYS; day++) if (sim.checker.checked[day]) checked.push(day);
  const wrong = checked.flatMap((day) =>
    (sim.report[day] ?? 0) !== (sim.source[day] ?? 0) ? [day] : [],
  );
  if (checked.length === 0) return progress;
  if (wrong.length === 0) {
    const total = checked.reduce((sum, day) => sum + (sim.source[day] ?? 0), 0);
    return checked.length === DAYS
      ? `${progress} Every day's total matches the source: ${count(total)} orders in all.`
      : checked.length === 1
        ? `${progress} ${weekday(checked[0] as number)}'s total, the only one checked so far, matches the source.`
        : `${progress} The ${checked.length} days checked so far match the source.`;
  }
  const others = checked.length - wrong.length;
  const rest =
    others === 0
      ? ''
      : checked.length === DAYS
        ? `; the other ${others} ${others === 1 ? 'day matches' : 'days match'}`
        : `; the other ${others} checked so far ${others === 1 ? 'matches' : 'match'}`;
  if (wrong.length === 1) {
    const day = wrong[0] as number;
    const held = sim.report[day] ?? 0;
    const gap = held - (sim.source[day] ?? 0);
    const why = cause(sim, day);
    return `${progress} ${weekday(day)}'s report counts ${count(held)} orders, ${count(Math.abs(gap))} ${gap > 0 ? 'more' : 'fewer'} than the source${why ? `: ${why}` : ''}${rest}.`;
  }
  const lost = strays(sim);
  if (lost.length > 0 && wrong.every((day) => (sim.report[day] ?? 0) === 0))
    return `${progress} ${wrong.length} days show no orders in the report, because their rows were filed under ${joinAnd(lost.map((s) => s.name))}, the clock's day${rest}.`;
  const gaps = wrong.map((day) => {
    const gap = (sim.report[day] ?? 0) - (sim.source[day] ?? 0);
    return `${weekday(day)}'s by ${count(Math.abs(gap))} too ${gap > 0 ? 'many' : 'few'}`;
  });
  return `${progress} ${wrong.length} days' totals are wrong: ${joinAnd(gaps)}${rest}.`;
}

const SHORT: Record<PropertyId, string> = {
  totals: 'day totals',
  order: 'task order',
  limits: 'the limits',
};

/** The status line: the three properties as one sentence, or the conservation break that froze
 *  the run. */
export function statusText(sim: Sim): string {
  if (sim.violation)
    return `Stopped at ${when(sim.violation.at)}: conservation broke, which is a bug in the simulation. ${upperFirst(sim.violation.detail)}.`;
  const all = properties(sim);
  const events = `${count(sim.events)} ${sim.events === 1 ? 'event' : 'events'}`;
  const broken = all.flatMap((p) =>
    p.first
      ? [`${SHORT[p.id]} broke ${times(p.count)}, first at ${when(p.first.at)} (${p.first.detail})`]
      : [],
  );
  if (broken.length === 0)
    return `All three properties held over ${events}: every checked day's total matched the source, no task started before its upstream succeeded, and no limit was passed.`;
  const held = all.flatMap((p) => (p.held ? [SHORT[p.id]] : []));
  const tail = held.length > 0 ? `; ${joinAnd(held)} held` : '';
  return `${upperFirst(broken.join('; '))}${tail}, over ${events}.`;
}
