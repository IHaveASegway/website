// The Backfill Lab's model: the bakery's weekly sales report, made by a job graph that runs once
// for each day of data. Virtual time here counts whole minutes, not the milliseconds the other
// labs count: minute 0 is 00:00 on Monday 19 October 2026, the first day the report covers, and a
// day is 1,440 minutes. Every name and number of the model is in this file; the simulator (sim.ts)
// moves it and the checker (check.ts) judges it.
//
// The lesson is Maxime Beauchemin's, in "Functional Data Engineering: a modern paradigm for batch
// data processing" (2018): a task that runs once per day of data must leave the same result
// however many times it runs for that day, because retries, reruns and backfills all run a day
// again. So each day's rows live in a partition of their own, a load overwrites its day's
// partition in one atomic step, and a partition is named for the day the data is about, never for
// the day the task happened to run. An append counts orders twice after a retry; a partition named
// for the clock's day files a whole backfill on one date.
//
// The scheduling follows the data-interval model of scheduled pipelines: each run covers one day,
// from its midnight to the next, and is created once that day is over. A graph switched on late,
// with catch-up, creates every missed day's run at once. That is a backfill.

/** Minutes in a day. */
export const DAY = 1_440;
/** The days the report covers: day 0 is Monday 19 October 2026, day 6 is Sunday 25 October. */
export const DAYS = 7;
/** When the week is over and the graph is switched on: 00:00 on Monday 26 October. */
export const WEEK_END = DAYS * DAY;

const WEEKDAYS = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
] as const;

/** A day number's weekday: day 0 is a Monday. */
export const weekday = (day: number): string => WEEKDAYS[((day % 7) + 7) % 7] as string;

/** A day number's date, counted from 19 October without a Date object. It is right for every day
 *  from 1 October to 30 November, far more than a run can reach. */
function calendar(day: number): { readonly month: number; readonly date: number } {
  const date = 19 + day;
  return date <= 31 ? { month: 10, date } : { month: 11, date: date - 31 };
}

/** "Wednesday 21 October": how the lines and the page name a day. */
export function dayText(day: number): string {
  const { month, date } = calendar(day);
  return `${weekday(day)} ${date} ${month === 10 ? 'October' : 'November'}`;
}

/** "2026-10-21": a day as the partition's key. */
export function isoDate(day: number): string {
  const { month, date } = calendar(day);
  return `2026-${month}-${String(date).padStart(2, '0')}`;
}

/** The day a virtual minute falls on: the clock's day. */
export const dayOf = (at: number): number => Math.floor(at / DAY);

/** "00:40": the clock's time of day at a virtual minute. */
export function clock(at: number): string {
  const minute = ((Math.floor(at) % DAY) + DAY) % DAY;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
}

/** "00:40 on Monday 26 October". */
export const when = (at: number): string => `${clock(at)} on ${dayText(dayOf(at))}`;

/** "5 minutes", "1 hour", "5 hours 10 minutes". */
export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const part = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;
  if (hours === 0) return part(rest, 'minute');
  return rest === 0 ? part(hours, 'hour') : `${part(hours, 'hour')} ${part(rest, 'minute')}`;
}

/** A whole number as the page writes it: "1,912". */
export const count = (n: number): string => n.toLocaleString('en-US');

/** How many items of a list pass a test. */
export function countOf<T>(list: readonly T[], test: (item: T) => boolean): number {
  let n = 0;
  for (const item of list) if (test(item)) n++;
  return n;
}

/**
 * The job graph each day's run follows, one task after another: a sensor that waits for the day's
 * export file, then extract, convert, load and check. The middle three are the E, T and L of every
 * batch pipeline. The T goes by a synonym here: Tailwind reads every word under src/ as a possible
 * class name, and its usual name is also a utility's.
 */
export const TASKS = ['wait', 'extract', 'convert', 'load', 'check'] as const;
export type TaskName = (typeof TASKS)[number];

/** How a line names each task: the first one is a sensor, not a step that does work. */
export const TASK_WORD: Record<TaskName, string> = {
  wait: 'sensor',
  extract: 'extract',
  convert: 'convert',
  load: 'load',
  check: 'check',
};

/** How long an attempt of each task takes, in whole minutes, both bounds included. */
export const DURATION = {
  extract: [4, 9],
  convert: [3, 7],
  load: [5, 12],
  check: [1, 2],
} as const satisfies Record<Exclude<TaskName, 'wait'>, readonly [number, number]>;

/** The sensor looks for the day's export file every 10 minutes, and gives up after 6 hours. Its
 *  timeout is final: a retry would only wait for the same file again. */
export const POKE_EVERY = 10;
export const SENSOR_TIMEOUT = 360;

/** The chance that an extract or a load attempt fails on its own: a transient fault, such as a
 *  dropped connection, that a retry usually gets past. */
export const FAIL_RATE = 0.08;
/** A failing attempt fails after this share of its work, in percent; a load has written the same
 *  share of its rows by then. */
export const PARTIAL = [20, 80] as const;
/** The waits before the two retries, in minutes. After the third failed attempt the task fails,
 *  and every task after it is marked upstream-failed. */
export const BACKOFF = [5, 10] as const;
export const ATTEMPTS = BACKOFF.length + 1;

/** The warehouse runs 2 loads at once: a pool of slots, so a backfill cannot crowd out the rest
 *  of the warehouse's work (a bulkhead). A load that finds both slots taken waits, queued. */
export const LOAD_SLOTS = 2;

/** How many runs may be active at once unless the visitor says otherwise: from 1 to all 7. */
export const MAX_ACTIVE_RUNS = 3;

/** Each day's orders in the source of truth, both bounds included. */
export const ORDERS = [140, 420] as const;
/** How long after the midnight that ends a day its export file lands, in minutes: log-normal. */
export const FILE_DELAY = { median: 40, spread: 0.6 } as const;

/** How a load writes: `append` inserts its rows; `overwrite` replaces the partition it writes in
 *  one atomic step, so running it twice leaves what running it once does. */
export type Mode = 'append' | 'overwrite';

/** Which partition a load writes: the run's own data day, or the day on the clock as the task
 *  starts. The second is the classic mistake: every day of a backfill lands on the same date. */
export type PartitionKey = 'run-day' | 'today';

/**
 * A task's state, one at a time. `pending`: its upstream has not succeeded yet. `queued`: a load
 * that is ready and waits for a warehouse slot. `up-for-retry`: an attempt failed, and the next
 * starts when the backoff ends. `upstream-failed`: a task before it failed, so it never runs.
 */
export type TaskState =
  'pending' | 'queued' | 'running' | 'up-for-retry' | 'success' | 'failed' | 'upstream-failed';

/** What became of one attempt. `stopped`: a clear ended it before it finished, and it wrote
 *  nothing. */
export type Outcome = 'running' | 'success' | 'failed' | 'stopped';

/** A run waits, `queued`, until fewer than the limit of runs are active. */
export type RunState = 'queued' | 'running' | 'success' | 'failed';

export interface Attempt {
  readonly id: number;
  readonly day: number;
  readonly task: TaskName;
  /** Its number since the run last started over: 1, 2 or 3. */
  readonly n: number;
  readonly start: number;
  end: number | null;
  outcome: Outcome;
  /** Decided as it starts: whether it fails, and after what share of its work, in percent. */
  readonly fails: boolean;
  readonly percent: number;
  /** A load's partition, as a day number, and how it writes; null for the other tasks. */
  readonly partition: number | null;
  readonly mode: Mode | null;
  /** The rows a load attempt left in the report. */
  wrote: number;
}

export interface Task {
  readonly name: TaskName;
  state: TaskState;
  /** Attempts since the run last started over: the retries count from here. */
  tries: number;
  /** When a load joined the queue for a warehouse slot. */
  queuedAt: number;
  readonly attempts: Attempt[];
}

/** What a run's check found: the report's count for the run's day, and the source's. */
export interface Verdict {
  readonly at: number;
  readonly report: number;
  readonly source: number;
}

export interface Run {
  readonly day: number;
  state: RunState;
  /** The tasks, in the graph's order. */
  readonly tasks: Task[];
  started: number | null;
  ended: number | null;
  verdict: Verdict | null;
}

/** One write the report committed: the rows a load inserted into a partition, and the rows it
 *  deleted first, which only an overwrite does. */
export interface Write {
  readonly at: number;
  readonly attempt: number;
  readonly partition: number;
  readonly inserted: number;
  readonly deleted: number;
}

/**
 * Deliberately broken schedulers and loads, for the tests only: each one is a known bug the
 * property sweep must find (test/backfill.test.ts). The page never sets any of them.
 * - `ignoreDependencies`: a task starts once the task before it is running, not once it has
 *   succeeded. `order` must break.
 * - `poolOverrun`: a load starts without waiting for one of the 2 warehouse slots. `limits` must
 *   break.
 * - `nonAtomicOverwrite`: an overwrite deletes the partition in one step and inserts in another,
 *   and a failure between the two leaves the day empty. `totals` must break under `overwrite`.
 */
export interface Faults {
  readonly ignoreDependencies?: boolean;
  readonly poolOverrun?: boolean;
  readonly nonAtomicOverwrite?: boolean;
}

/** Whether a task is done for this run: nothing more happens to it unless the run is cleared. */
export const isFinal = (state: TaskState): boolean =>
  state === 'success' || state === 'failed' || state === 'upstream-failed';

export function createRun(day: number): Run {
  return {
    day,
    state: 'queued',
    tasks: TASKS.map((name) => ({ name, state: 'pending', tries: 0, queuedAt: 0, attempts: [] })),
    started: null,
    ended: null,
    verdict: null,
  };
}
