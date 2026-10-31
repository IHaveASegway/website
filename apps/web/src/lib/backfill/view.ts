import { properties, type PropertyId } from './check';
import {
  BACKOFF,
  clock,
  count,
  countOf,
  DAYS,
  dayOf,
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

// What the Backfill Lab shows, as data and text, from a run's state. The page uses it twice, as the
// Raft Lab's does: at build, to draw the opening run so the demo is complete without JavaScript,
// and in the browser, on every frame of a run (components/backfill-lab). The run board, the
// properties and the strip below are that data; only the strip comes as markup, an SVG's inside.

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

// The page (components/backfill-lab): the run board, the properties and the strip, as the build
// draws them and the browser redraws them, from the same functions, so the two never disagree.

/**
 * Start over: the same week and the opening's preset, Wednesday's next load set to fail, under the
 * visitor's settings, at the minute the week ends, with the graph still off. The visitor switches
 * it on, so a late file or a limit of one run can be set before any run starts, and the opening's
 * story plays again under whatever load mode they chose.
 */
export const weekOff = (config: Config): Sim =>
  replay(
    config,
    OPENING.actions.filter((a) => a.kind !== 'start'),
    WEEK_END,
  );

/** How much later "make its file late" makes a day's export file land: 5 hours, in minutes. */
export const LATE_BY = 300;

/** A time as the page writes it: the clock alone on the day the week ends, where every week but a
 *  very slow one stays, and the clock and its day after that. */
export const moment = (at: number): string =>
  dayOf(at) === dayOf(WEEK_END) ? clock(at) : when(at);

/** An event line's time, short enough for its column: "00:41", or "Tue 00:10" a day later. */
export const lineTime = (at: number): string =>
  dayOf(at) === dayOf(WEEK_END) ? clock(at) : `${weekday(dayOf(at)).slice(0, 3)} ${clock(at)}`;

/** "Mon 19": a day as the run board's rows name it. */
export function shortDay(day: number): string {
  const [name = '', date = ''] = dayText(day).split(' ');
  return `${name.slice(0, 3)} ${date}`;
}

/** A lamp's shape (ADR 0025: state is a shape and a word): not started, running, succeeded, failed,
 *  waiting to retry, or never run because a step before it failed. */
export type Lamp = 'hollow' | 'lit' | 'filled' | 'cross' | 'clock' | 'dash';

export interface StepView {
  readonly lamp: Lamp;
  /** What the lamp means, in words: assistive technology reads these. */
  readonly word: string;
  /** When a step waiting to retry tries again, "00:29"; empty otherwise. */
  readonly retry: string;
}

export interface DayView {
  readonly day: number;
  /** "Mon 19", and "Monday 19 October". */
  readonly short: string;
  readonly long: string;
  /** The run's state in a word; empty while the graph is off and the day has no run. */
  readonly run: string;
  readonly steps: readonly StepView[];
  /** The report's count, once a load has written rows for the day or its check has run. */
  readonly report: string;
  /** The report less the source, signed, once the day's check has run and the two differ. */
  readonly difference: string;
  readonly source: string;
}

export interface BoardView {
  readonly days: readonly DayView[];
  /** Rows filed under a day after the week, the clock's day: what `today` does to a backfill. */
  readonly stray: { readonly short: string; readonly long: string; readonly rows: string } | null;
  /** The week's totals, and their difference once every day's check has run. */
  readonly week: { readonly report: string; readonly difference: string; readonly source: string };
}

const RUN_WORD: Record<RunState, string> = {
  queued: 'waiting',
  running: 'running',
  success: 'done',
  failed: 'failed',
};

const signed = (n: number): string => (n > 0 ? `+${count(n)}` : `−${count(-n)}`);

/** One lamp. A check that ran and found the totals apart is drawn failed, as the lesson reads it,
 *  though the task itself succeeded: it did its job, and the run goes on to its end. */
function stepView(sim: Sim, day: number, i: number): StepView {
  const run = sim.runs[day];
  const task = run?.tasks[i];
  const last = task?.attempts.at(-1);
  switch (task?.state) {
    case 'running':
      return { lamp: 'lit', word: 'running', retry: '' };
    case 'up-for-retry': {
      const at = (last?.end ?? sim.now) + (BACKOFF[(last?.n ?? 1) - 1] ?? 0);
      return { lamp: 'clock', word: `failed, tries again at ${moment(at)}`, retry: clock(at) };
    }
    case 'success':
      if (task.name !== 'check') return { lamp: 'filled', word: 'succeeded', retry: '' };
      return run?.verdict && run.verdict.report !== run.verdict.source
        ? { lamp: 'cross', word: 'failed: the totals differ', retry: '' }
        : { lamp: 'filled', word: 'succeeded: the totals match', retry: '' };
    case 'failed':
      return { lamp: 'cross', word: 'failed', retry: '' };
    case 'upstream-failed':
      return { lamp: 'dash', word: 'not run: a step before it failed', retry: '' };
    case 'queued':
      return { lamp: 'hollow', word: 'waiting for a warehouse slot', retry: '' };
    default:
      return { lamp: 'hollow', word: 'not started', retry: '' };
  }
}

/** The run board: a row for each day, a lamp for each step, and the day's totals. */
export function boardView(sim: Sim): BoardView {
  let held = 0;
  let truth = 0;
  let any = false;
  let all = true;
  const days = Array.from({ length: DAYS }, (_, day): DayView => {
    const run = sim.runs[day];
    const report = sim.report[day] ?? 0;
    const source = sim.source[day] ?? 0;
    const checked = sim.checker.checked[day] === true;
    held += report;
    truth += source;
    any ||= checked || report > 0;
    all &&= checked;
    return {
      day,
      short: shortDay(day),
      long: dayText(day),
      run: run ? RUN_WORD[run.state] : '',
      steps: TASKS.map((_, i) => stepView(sim, day, i)),
      report: checked || report > 0 ? count(report) : '',
      difference: checked && report !== source ? signed(report - source) : '',
      source: count(source),
    };
  });
  const lost = strays(sim);
  const [first, last] = [lost[0], lost.at(-1)];
  const span = (name: (day: number) => string) =>
    first && last && first !== last
      ? `${name(first.day)} to ${name(last.day)}`
      : name(first?.day ?? 0);
  return {
    days,
    stray: first
      ? {
          short: span(shortDay),
          long: span(dayText),
          rows: count(lost.reduce((sum, s) => sum + s.rows, 0)),
        }
      : null,
    week: {
      report: any ? count(held) : '',
      difference: all && held !== truth ? signed(held - truth) : '',
      source: count(truth),
    },
  };
}

/** The properties as the page names them: of steps, as the run board draws them, not of tasks. */
export const PROPERTY_NAMES: Record<PropertyId, string> = {
  totals: "Every day's total matches the source",
  order: 'No step started before the steps it needs',
  limits: 'No more runs or loads at once than allowed',
};

export interface PropertyView {
  readonly id: PropertyId;
  readonly name: string;
  readonly held: boolean;
  /** "Held.", or how often it broke and the first time, with what was wrong then. */
  readonly word: string;
}

export const propertyViews = (sim: Sim): PropertyView[] =>
  properties(sim).map((p) => ({
    id: p.id,
    name: PROPERTY_NAMES[p.id],
    held: p.held,
    word: p.first
      ? `Broke ${times(p.count)}, first at ${moment(p.first.at)}: ${p.first.detail}.`
      : 'Held.',
  }));

/** "44 events". */
export const eventsText = (sim: Sim): string =>
  `${count(sim.events)} ${sim.events === 1 ? 'event' : 'events'}`;

/**
 * The strip under the run board: each day's steps over time, a lane a day (the page names the days
 * beside it, in a column as wide as their names), from the minute the
 * graph was switched on. A sensor waiting for its file is a hollow bar, a step at work a filled
 * one, and an attempt that failed ends in a cross; the dotted track is the run's life, from the
 * switch to its end, so a run waiting for a slot is a track with nothing on it; the upright line
 * is now. The span grows by whole hours, so the picture rescales once an hour,
 * not on every frame. Across, everything is in percent, so the strip fills any width; down, it is in
 * em of the strip's own text, so a larger text size makes the strip taller and its words never meet.
 */
const STRIP = { left: 0, right: 100, top: 0.5, lane: 1.25, bar: 0.5 } as const;
const AXIS = STRIP.top + DAYS * STRIP.lane + 0.25;
const em = (n: number): string => `${Number(n.toFixed(3))}em`;

/** The strip's height: the seven lanes, the axis and its times. */
export const STRIP_HEIGHT = em(AXIS + 1.625);

function stripSpan(sim: Sim): { from: number; hours: number } {
  const from = sim.actions.find((a) => a.kind === 'start')?.at ?? WEEK_END;
  return { from, hours: Math.max(2, Math.ceil((sim.now - from) / 60)) };
}

export function stripMarkup(sim: Sim): string {
  const { from, hours } = stripSpan(sim);
  const share = (at: number) =>
    STRIP.left + ((Math.max(at, from) - from) / (hours * 60)) * (STRIP.right - STRIP.left);
  const x = (at: number) => `${share(at).toFixed(2)}%`;
  const out: string[] = [];
  for (let day = 0; day < DAYS; day++) {
    const y = STRIP.top + day * STRIP.lane + STRIP.lane / 2;
    const run = sim.runs[day];
    if (!run) continue;
    out.push(
      `<line class="bf-strip-track" x1="${x(from)}" x2="${x(run.ended ?? sim.now)}" y1="${em(y)}" y2="${em(y)}"/>`,
    );
    for (const task of run.tasks)
      for (const a of task.attempts) {
        const end = a.end ?? sim.now;
        const width = share(end) - share(a.start);
        if (width > 0)
          out.push(
            `<rect class="${task.name === 'wait' ? 'bf-strip-wait' : 'bf-strip-work'}" x="${x(a.start)}" y="${em(y - STRIP.bar / 2)}" width="${width.toFixed(2)}%" height="${em(STRIP.bar)}"/>`,
          );
        if (a.outcome === 'failed')
          out.push(
            `<svg class="bf-strip-x" x="${x(end)}" y="${em(y)}" overflow="visible"><path d="M-3.5-3.5l7 7m0-7-7 7"/></svg>`,
          );
      }
  }
  const step = hours <= 4 ? 1 : hours <= 8 ? 2 : hours <= 16 ? 4 : 8;
  out.push(
    `<line class="bf-strip-axis" x1="${STRIP.left}%" x2="${STRIP.right}%" y1="${em(AXIS)}" y2="${em(AXIS)}"/>`,
  );
  for (let h = 0; h <= hours; h++) {
    const at = from + h * 60;
    out.push(
      `<line class="bf-strip-tick" x1="${x(at)}" x2="${x(at)}" y1="${em(AXIS)}" y2="${em(AXIS + 0.3)}"/>`,
    );
    if (h % step === 0)
      out.push(
        `<text class="bf-strip-time" x="${x(at)}" y="${em(AXIS + 1.3)}" text-anchor="${h === 0 ? 'start' : h === hours ? 'end' : 'middle'}">${clock(at)}</text>`,
      );
  }
  if (!sim.on)
    out.push(
      `<text class="bf-strip-off" x="${(STRIP.left + STRIP.right) / 2}%" y="${em(STRIP.top + 3.5 * STRIP.lane + 0.35)}" text-anchor="middle">The job is off</text>`,
    );
  out.push(
    `<line class="bf-strip-now" x1="${x(sim.now)}" x2="${x(sim.now)}" y1="${em(STRIP.top - 0.3)}" y2="${em(AXIS)}"/>`,
  );
  return out.join('');
}

/** The strip's name for assistive technology. */
export function stripLabel(sim: Sim): string {
  if (!sim.on) return "Each day's steps over time: none yet, as the job is off";
  return `Each day's steps over time, from ${moment(stripSpan(sim).from)} to ${moment(sim.now)}`;
}
