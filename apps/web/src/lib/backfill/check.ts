import {
  ATTEMPTS,
  count,
  DAYS,
  dayText,
  isFinal,
  TASK_WORD,
  TASKS,
  weekday,
  type Attempt,
  type Run,
  type Task,
  type TaskState,
  type Write,
} from './core';

// The Backfill Lab's three properties, and its conservation check. In the Raft Lab a broken
// property is a bug. Here a weak configuration is meant to break one, because that is the lesson:
// so a run keeps going when a property breaks, and each break is counted, with the time and the
// detail of the first. Conservation is different. Rows that appear or vanish without a write, or
// an attempt in two states, would be a bug in the simulation itself, so a conservation break
// freezes the run, as a violation does in the Raft Lab.

export const PROPERTIES = [
  { id: 'totals', name: "Every day's total matches the source" },
  { id: 'order', name: 'No task started before the tasks it depends on succeeded' },
  { id: 'limits', name: 'No more runs or loads at once than allowed' },
] as const;

export type PropertyId = (typeof PROPERTIES)[number]['id'];

export interface Break {
  readonly at: number;
  readonly detail: string;
}

export interface PropertyState {
  readonly id: PropertyId;
  readonly name: string;
  /** Whether it has held for the whole run so far. */
  readonly held: boolean;
  readonly count: number;
  readonly first?: Break;
}

export interface Checker {
  readonly tallies: Record<PropertyId, { count: number; first: Break | null }>;
  /** Days whose check has run: from then on the report vouches for their totals. */
  readonly checked: boolean[];
  /** Days whose total is wrong now. A day counts as one break each time it goes wrong. */
  readonly wrong: boolean[];
}

export const createChecker = (): Checker => ({
  tallies: {
    totals: { count: 0, first: null },
    order: { count: 0, first: null },
    limits: { count: 0, first: null },
  },
  checked: Array.from({ length: DAYS }, () => false),
  wrong: Array.from({ length: DAYS }, () => false),
});

function tally(c: Checker, id: PropertyId, at: number, detail: string): void {
  const t = c.tallies[id];
  t.count += 1;
  t.first ??= { at, detail };
}

const STATE_WORD: Record<TaskState, string> = {
  pending: 'still pending',
  queued: 'still queued',
  running: 'still running',
  'up-for-retry': 'waiting to retry',
  success: 'done',
  failed: 'failed',
  'upstream-failed': 'upstream-failed',
};

/** `order`, as an attempt starts: the task before it in the graph has succeeded. */
export function noteStart(c: Checker, run: Run, task: Task, at: number): void {
  const i = TASKS.indexOf(task.name);
  const up = i > 0 ? run.tasks[i - 1] : undefined;
  if (up && up.state !== 'success')
    tally(
      c,
      'order',
      at,
      `${weekday(run.day)}'s ${TASK_WORD[task.name]} started while its ${TASK_WORD[up.name]} was ${STATE_WORD[up.state]}`,
    );
}

/** `limits`, as a run or a load is let in: the count it joins stays within its limit. It is
 *  checked at the door, not after every event, because lowering the limit of runs while more are
 *  active is the visitor's choice, and a scheduler rightly lets those runs finish. */
export function noteAdmission(
  c: Checker,
  what: 'runs' | 'loads',
  active: number,
  limit: number,
  at: number,
): void {
  if (active <= limit) return;
  tally(
    c,
    'limits',
    at,
    what === 'runs'
      ? `${active} runs were active at once, with room for ${limit}`
      : `${active} loads ran at once, with ${limit} warehouse slots`,
  );
}

/** A day's check has run: its total is the report's promise from now on. */
export function noteChecked(c: Checker, day: number): void {
  c.checked[day] = true;
}

/**
 * `totals`, after every event: each day whose check has run holds as many orders in the report as
 * in the source. Watching after every event, not only when a check runs, catches a total that
 * goes wrong later: a rerun that appends a checked day's rows again, or an overwrite that deletes
 * a day and fails before it inserts. A reader of the report sees those days wrong, check or no
 * check.
 */
export function observeTotals(
  c: Checker,
  report: readonly number[],
  source: readonly number[],
  at: number,
): void {
  for (let day = 0; day < source.length; day++) {
    if (!c.checked[day]) continue;
    const held = report[day] ?? 0;
    const truth = source[day] ?? 0;
    const wrong = held !== truth;
    if (wrong && !c.wrong[day])
      tally(
        c,
        'totals',
        at,
        `${weekday(day)}'s report holds ${count(held)} orders and the source ${count(truth)}`,
      );
    c.wrong[day] = wrong;
  }
}

/** Each property: whether it held, how often it broke, and the first break. */
export function properties(sim: { readonly checker: Checker }): PropertyState[] {
  return PROPERTIES.map(({ id, name }) => {
    const { count: n, first } = sim.checker.tallies[id];
    const state = { id, name, held: n === 0, count: n };
    return first ? { ...state, first } : state;
  });
}

export interface Violation {
  readonly at: number;
  readonly detail: string;
}

/** What the conservation check reads: the simulator's state, as plain data. */
export interface Books {
  readonly now: number;
  readonly source: readonly number[];
  readonly runs: readonly Run[];
  readonly attempts: readonly Attempt[];
  readonly report: readonly number[];
  readonly writes: readonly Write[];
}

/** The rows a load attempt that ended leaves in its partition: all of the day's orders if it
 *  succeeded, the share it wrote before failing if it appends, and none if an overwrite failed,
 *  atomic or not (a broken one deletes, but inserts nothing). */
function rowsLeft(attempt: Attempt, orders: number): number {
  if (attempt.outcome === 'success') return orders;
  return attempt.mode === 'append' ? Math.floor((orders * attempt.percent) / 100) : 0;
}

/**
 * Conservation, after every event: nothing appears or disappears.
 * - Every attempt is in one place, the history of the task its day and name say, and in one
 *   state, which agrees with its task's: a task is running exactly when its last attempt is.
 * - Every run's state agrees with its tasks': it is done exactly when all of them are.
 * - Every row in the report was put there by a write, and every write by a load attempt that ran
 *   to its end, with the rows that attempt had to leave. An overwrite deletes the whole partition
 *   it replaces; an append deletes nothing.
 * A break is a bug in the simulator, whatever the configuration and whatever test-only fault.
 */
export function invariant(books: Books): Violation | null {
  const fail = (detail: string): Violation => ({ at: books.now, detail });
  let listed = 0;
  for (const run of books.runs) {
    const name = weekday(run.day);
    if (run.tasks.length !== TASKS.length)
      return fail(`${name}'s run has ${run.tasks.length} tasks, not ${TASKS.length}`);
    for (const [i, task] of run.tasks.entries()) {
      const where = `${name}'s ${TASK_WORD[task.name]}`;
      if (task.name !== TASKS[i]) return fail(`${where} is out of the graph's order`);
      for (const [k, attempt] of task.attempts.entries()) {
        listed++;
        if (
          books.attempts[attempt.id] !== attempt ||
          attempt.day !== run.day ||
          attempt.task !== task.name
        )
          return fail(`attempt ${attempt.id} is listed under ${where}, where it does not belong`);
        const open = attempt.outcome === 'running';
        if (open !== (attempt.end === null))
          return fail(`${where}'s attempt ${attempt.n} is ${attempt.outcome} but its end says not`);
        if (open && (k !== task.attempts.length - 1 || task.state !== 'running'))
          return fail(`${where} has an attempt running while the task is ${task.state}`);
      }
      const last = task.attempts.at(-1)?.outcome;
      const agrees =
        task.state === 'running'
          ? last === 'running'
          : task.state === 'success'
            ? last === 'success'
            : task.state === 'failed'
              ? last === 'failed'
              : task.state === 'up-for-retry'
                ? last === 'failed' && task.tries < ATTEMPTS
                : true;
      if (!agrees) return fail(`${where} is ${task.state}, and its last attempt says otherwise`);
    }
    const done = run.tasks.every((t) => isFinal(t.state));
    if (done !== (run.state === 'success' || run.state === 'failed'))
      return fail(
        `${name}'s run is ${run.state} while ${done ? 'every task is' : 'a task is not'} done`,
      );
    if (run.state === 'success' && !run.tasks.every((t) => t.state === 'success'))
      return fail(`${name}'s run succeeded with a task that did not`);
    if (run.state === 'queued' && run.tasks.some((t) => t.state === 'running'))
      return fail(`${name}'s run is queued with a task running`);
  }
  if (listed !== books.attempts.length)
    return fail(`${books.attempts.length} attempts were started, and the runs list ${listed}`);

  const net: number[] = [];
  const wrote = new Set<number>();
  for (const write of books.writes) {
    const attempt = books.attempts[write.attempt];
    if (
      !attempt ||
      attempt.task !== 'load' ||
      attempt.partition !== write.partition ||
      attempt.outcome === 'running' ||
      attempt.outcome === 'stopped' ||
      wrote.has(attempt.id)
    )
      return fail(`a write of ${count(write.inserted)} rows has no load behind it that ended`);
    wrote.add(attempt.id);
    const rows = rowsLeft(attempt, books.source[attempt.day] ?? 0);
    if (write.inserted !== rows || attempt.wrote !== rows)
      return fail(
        `${weekday(attempt.day)}'s load attempt ${attempt.n} wrote ${count(write.inserted)} rows, not ${count(rows)}`,
      );
    const before = net[write.partition] ?? 0;
    if (write.deleted !== (attempt.mode === 'overwrite' ? before : 0))
      return fail(
        `a write deleted ${count(write.deleted)} rows from a partition of ${count(before)}`,
      );
    net[write.partition] = before - write.deleted + write.inserted;
  }
  for (const attempt of books.attempts)
    if (attempt.task === 'load' && attempt.outcome === 'success' && !wrote.has(attempt.id))
      return fail(
        `${weekday(attempt.day)}'s load attempt ${attempt.n} succeeded and wrote nothing`,
      );
  for (let p = 0; p < Math.max(net.length, books.report.length); p++) {
    const held = books.report[p] ?? 0;
    const sum = net[p] ?? 0;
    if (held !== sum)
      return fail(
        `the report holds ${count(held)} rows for ${dayText(p)}, and its writes add up to ${count(sum)}`,
      );
  }
  return null;
}
