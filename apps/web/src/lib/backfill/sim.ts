import { createAgenda, next, peekTime, schedule, type Agenda } from '../sim/agenda';
import { between, lognormal, seeded, type Random } from '../sim/random';
import {
  createChecker,
  invariant,
  noteAdmission,
  noteChecked,
  noteStart,
  observeTotals,
  type Checker,
  type Violation,
} from './check';
import {
  ATTEMPTS,
  BACKOFF,
  count,
  countOf,
  createRun,
  DAY,
  DAYS,
  dayOf,
  dayText,
  DURATION,
  FAIL_RATE,
  FILE_DELAY,
  isFinal,
  LOAD_SLOTS,
  MAX_ACTIVE_RUNS,
  minutesText,
  ORDERS,
  PARTIAL,
  POKE_EVERY,
  SENSOR_TIMEOUT,
  TASK_WORD,
  TASKS,
  WEEK_END,
  weekday,
  when,
  type Attempt,
  type Faults,
  type Mode,
  type Outcome,
  type PartitionKey,
  type Run,
  type Task,
  type Write,
} from './core';

// A deterministic simulation of the bakery's report pipeline, in the style of the Raft Lab (ADR
// 0020): virtual time, in minutes here; one seeded random stream for every count, duration,
// failure and delay; an agenda that gives events back by time and then by the order they were
// booked; and the visitor's actions recorded at the virtual minute and the step they happened. The
// same seed and the same actions give the same run, event for event, in a test, at build and in
// the browser.
//
// After every event the scheduler's loop runs, as a real scheduler's does on each pass: it lets
// queued runs in, oldest day first, while fewer than the limit are active, starts each task whose
// upstream has succeeded (or marks it upstream-failed), gives free warehouse slots to waiting
// loads, and ends a run once every task in it is done. Then the checker looks at what changed.

/** What a visitor did, before record() adds where in the run it happened. */
type Deed =
  | { readonly kind: 'start' }
  | { readonly kind: 'fail-next-load' | 'clear'; readonly day: number }
  | { readonly kind: 'late-file'; readonly day: number; readonly minutes: number | 'never' }
  | { readonly kind: 'mode'; readonly mode: Mode }
  | { readonly kind: 'partition'; readonly partition: PartitionKey }
  | { readonly kind: 'max-active-runs'; readonly runs: number };

/**
 * A visitor's action and its place in the run: the virtual minute, and how many steps the run had
 * taken. The minute alone does not place it. Several events often share a minute, and an action
 * can fall between two of them: after a step, or after another action that booked an event for
 * that same minute. So replay goes to the same step first, and then stands at the same minute.
 */
export type Action = Deed & { readonly at: number; readonly steps: number };

export interface Line {
  readonly at: number;
  readonly text: string;
}

export interface Config {
  readonly seed: number;
  readonly mode?: Mode;
  readonly partition?: PartitionKey;
  readonly maxActiveRuns?: number;
  /** The chance an extract or a load attempt fails on its own: 0.08, unless a test needs none. */
  readonly failRate?: number;
  readonly faults?: Faults;
}

/** What happens next: a file landing, a sensor's look, an attempt's end, or a backoff's end. */
type Event =
  | { readonly kind: 'file'; readonly day: number }
  | { readonly kind: 'poke' | 'end' | 'retry'; readonly attempt: number };

export interface Sim {
  readonly seed: number;
  readonly faults: Faults;
  readonly failRate: number;
  readonly random: Random;
  readonly agenda: Agenda<Event>;
  /** The source of truth: each day's orders. */
  readonly source: readonly number[];
  /** When each day's export file lands, as a virtual minute; Infinity when it never does. */
  readonly files: number[];
  /** Load failures still to come for each day, from failNextLoad. */
  readonly failNext: number[];
  /** One run per day, in day order, once the graph is switched on. */
  readonly runs: Run[];
  /** Every attempt ever started, by id. */
  readonly attempts: Attempt[];
  /** The report: rows in each partition, by day number. Past the week's 7 days, a partition holds
   *  rows filed on the wrong day. */
  readonly report: number[];
  /** Every write the report committed, in order. */
  readonly writes: Write[];
  readonly checker: Checker;
  mode: Mode;
  partition: PartitionKey;
  maxActiveRuns: number;
  /** Whether the job graph is switched on. */
  on: boolean;
  now: number;
  /** Events that still mattered when they came up: the count the status line gives. */
  events: number;
  /** Every event step() has taken from the agenda, void ones too: an action's place in the run. */
  steps: number;
  lines: Line[];
  readonly actions: Action[];
  violation: Violation | null;
}

const LINES = 200;
const LOAD = TASKS.indexOf('load');

const clampRuns = (n: number): number => Math.min(DAYS, Math.max(1, Math.round(n)));
const isDay = (day: number): boolean => Number.isInteger(day) && day >= 0 && day < DAYS;

/** A run before anything happens: the week is over, and the graph is still off. */
export function createSim(config: Config): Sim {
  const random = seeded(config.seed);
  // The week's orders and its files come first from the stream, so they depend on the seed alone.
  const source = Array.from({ length: DAYS }, () => between(random, ORDERS[0], ORDERS[1]));
  const files = Array.from(
    { length: DAYS },
    (_, day) =>
      (day + 1) * DAY +
      Math.max(1, Math.round(lognormal(random, FILE_DELAY.median, FILE_DELAY.spread))),
  );
  const sim: Sim = {
    seed: config.seed,
    faults: config.faults ?? {},
    failRate: config.failRate ?? FAIL_RATE,
    random,
    agenda: createAgenda<Event>(),
    source,
    files,
    failNext: Array.from({ length: DAYS }, () => 0),
    runs: [],
    attempts: [],
    report: Array.from({ length: DAYS }, () => 0),
    writes: [],
    checker: createChecker(),
    mode: config.mode ?? 'append',
    partition: config.partition ?? 'run-day',
    maxActiveRuns: clampRuns(config.maxActiveRuns ?? MAX_ACTIVE_RUNS),
    on: false,
    now: WEEK_END,
    events: 0,
    steps: 0,
    lines: [],
    actions: [],
    violation: null,
  };
  // Only Sunday's file is still on its way when the week ends; the others landed days ago.
  for (const [day, at] of files.entries())
    if (at > sim.now) schedule(sim.agenda, at, { kind: 'file', day });
  return sim;
}

function say(sim: Sim, text: string): void {
  sim.lines.push({ at: sim.now, text });
  if (sim.lines.length > LINES) sim.lines.splice(0, sim.lines.length - LINES);
}

const activeRuns = (sim: Sim): number => countOf(sim.runs, (r) => r.state === 'running');
const loadsRunning = (sim: Sim): number =>
  countOf(sim.runs, (r) => (r.tasks[LOAD] as Task).state === 'running');

/** Whether every run has finished: the graph is on, and no run is queued or running. */
export const finished = (sim: Sim): boolean =>
  sim.on && sim.runs.every((r) => r.state === 'success' || r.state === 'failed');

function close(attempt: Attempt, at: number, outcome: Outcome): void {
  attempt.end = at;
  attempt.outcome = outcome;
}

/** Starts a task's next attempt. What it will do is decided now, from the run's random stream:
 *  how long it takes, and whether it fails and how far through. */
function begin(sim: Sim, run: Run, task: Task): void {
  noteStart(sim.checker, run, task, sim.now);
  const id = sim.attempts.length;
  task.tries += 1;
  let fails = false;
  let forced = false;
  let percent = 100;
  let partition: number | null = null;
  let mode: Mode | null = null;
  if (task.name === 'wait') {
    // Its first look is at once; each look that finds nothing books the next.
    schedule(sim.agenda, sim.now, { kind: 'poke', attempt: id });
  } else {
    const [low, high] = DURATION[task.name];
    const minutes = between(sim.random, low, high);
    if (task.name === 'extract' || task.name === 'load') {
      // Both draws happen on every attempt, whether it fails or not.
      const roll = sim.random();
      const share = between(sim.random, PARTIAL[0], PARTIAL[1]);
      // A forced failure is used up as this attempt fails, in complete(), not as it starts: a
      // clear that stops the attempt first leaves the failure for the day's next load.
      forced = task.name === 'load' && (sim.failNext[run.day] ?? 0) > 0;
      fails = forced || roll < sim.failRate;
      if (fails) percent = share;
    }
    if (task.name === 'load') {
      // A task reads the date it writes as it starts: this is where `today` goes wrong.
      partition = sim.partition === 'run-day' ? run.day : dayOf(sim.now);
      mode = sim.mode;
      if (sim.now > task.queuedAt)
        say(
          sim,
          `${weekday(run.day)}'s load gets a warehouse slot after waiting ${minutesText(sim.now - task.queuedAt)}`,
        );
    }
    const takes = fails ? Math.max(1, Math.round((minutes * percent) / 100)) : minutes;
    schedule(sim.agenda, sim.now + takes, { kind: 'end', attempt: id });
  }
  const attempt: Attempt = {
    id,
    day: run.day,
    task: task.name,
    n: task.tries,
    start: sim.now,
    end: null,
    outcome: 'running',
    fails,
    forced,
    percent,
    partition,
    mode,
    wrote: 0,
  };
  task.state = 'running';
  task.attempts.push(attempt);
  sim.attempts.push(attempt);
  if (task.name === 'load')
    noteAdmission(sim.checker, 'loads', loadsRunning(sim), LOAD_SLOTS, sim.now);
}

/** A sensor's look for its day's export file. */
function poke(sim: Sim, run: Run, task: Task, attempt: Attempt): void {
  const name = weekday(run.day);
  const waited = sim.now - attempt.start;
  if (sim.now >= (sim.files[run.day] ?? Infinity)) {
    close(attempt, sim.now, 'success');
    task.state = 'success';
    say(
      sim,
      waited === 0
        ? `${name}'s export file is already there, so its sensor succeeds at its first look`
        : `${name}'s sensor finds the export file after ${minutesText(waited)}`,
    );
  } else if (waited >= SENSOR_TIMEOUT) {
    close(attempt, sim.now, 'failed');
    task.state = 'failed';
    say(sim, `${name}'s sensor gives up after ${minutesText(waited)} without the export file`);
  } else {
    schedule(sim.agenda, sim.now + POKE_EVERY, { kind: 'poke', attempt: attempt.id });
  }
}

/**
 * What a load attempt leaves in the report as it ends. An append's rows are in as soon as each is
 * written, so a load that fails part way leaves its share behind, and a retry or a rerun appends
 * the whole day again. An overwrite replaces the partition in one atomic step: all of it, or, if
 * the attempt fails, nothing at all. The test-only `nonAtomicOverwrite` deletes first, as a step
 * of its own, and a failure then leaves the partition empty.
 *
 * The model commits those rows at the attempt's end, the minute it fails or succeeds. So an
 * attempt that a clear stops before then writes nothing, even an append, which in a real
 * warehouse would leave the rows it had written so far. That is a chosen simplification: a clear
 * stays a clean rerun, and every row counted twice comes from a failed load or a whole append,
 * the two causes the lesson is about.
 */
function commit(sim: Sim, attempt: Attempt): Write | null {
  const p = attempt.partition ?? attempt.day;
  const orders = sim.source[attempt.day] ?? 0;
  while (sim.report.length <= p) sim.report.push(0);
  const before = sim.report[p] ?? 0;
  let inserted = 0;
  let deleted = 0;
  if (attempt.mode === 'append')
    inserted = attempt.fails ? Math.floor((orders * attempt.percent) / 100) : orders;
  else if (!attempt.fails) {
    deleted = before;
    inserted = orders;
  } else if (sim.faults.nonAtomicOverwrite) deleted = before;
  if (inserted === 0 && deleted === 0) return null;
  sim.report[p] = before - deleted + inserted;
  attempt.wrote = inserted;
  const write: Write = { at: sim.now, attempt: attempt.id, partition: p, inserted, deleted };
  sim.writes.push(write);
  return write;
}

/** The line for a load that succeeded. */
function loaded(sim: Sim, run: Run, attempt: Attempt): string {
  const name = weekday(run.day);
  const p = attempt.partition ?? run.day;
  const rows = count(attempt.wrote);
  if (attempt.mode === 'append')
    return p === run.day
      ? `${name}'s load appends ${rows} rows: the report now holds ${count(sim.report[p] ?? 0)} for ${name}`
      : `${name}'s load appends ${rows} rows under ${dayText(p)}, the clock's day, not under ${dayText(run.day)}`;
  return p === run.day
    ? `${name}'s load replaces ${name}'s partition with its ${rows} rows in one step`
    : `${name}'s load replaces the partition of ${dayText(p)}, the clock's day, with ${name}'s ${rows} rows`;
}

/** The line for a load that failed, before what happens next. */
function failedLoad(sim: Sim, run: Run, attempt: Attempt, write: Write | null): string {
  const name = weekday(run.day);
  const p = attempt.partition ?? run.day;
  const under = p === run.day ? '' : ` under ${dayText(p)}`;
  if (attempt.mode === 'append')
    return `${name}'s load fails after appending ${count(attempt.wrote)} of its ${count(sim.source[run.day] ?? 0)} rows${under}, and they stay in the report`;
  if (write)
    return `${name}'s load deletes the ${count(write.deleted)} rows of ${dayText(p)} and then fails before inserting any`;
  return `${name}'s load fails part way, and as its overwrite is one atomic step, the report is as it was`;
}

/** A run's check: the report's count for the run's own day against the source's, read as the
 *  check ends. Says whether the two agree. */
function judge(sim: Sim, run: Run): boolean {
  const name = weekday(run.day);
  const held = sim.report[run.day] ?? 0;
  const truth = sim.source[run.day] ?? 0;
  run.verdict = { at: sim.now, report: held, source: truth };
  noteChecked(sim.checker, run.day);
  const gap = held - truth;
  say(
    sim,
    gap === 0
      ? `${name}'s check finds ${count(held)} orders in the report, as in the source`
      : `${name}'s check finds ${count(held)} orders in the report and ${count(truth)} in the source: ${count(Math.abs(gap))} too ${gap > 0 ? 'many' : 'few'}, so it fails and is not retried`,
  );
  return gap === 0;
}

/**
 * An attempt's end, as it was planned when the attempt started; a check's, as it finds the data.
 * A check fails when the totals it reads differ, as a data check in a scheduler fails its task,
 * and it is not retried: a retry would read the same rows and find the same totals, since only a
 * load changes them. Its run fails with it. Retries are for transient faults, such as an extract's
 * or a load's dropped connection, which the next attempt may not meet.
 */
function complete(sim: Sim, run: Run, task: Task, attempt: Attempt): void {
  const write = attempt.task === 'load' ? commit(sim, attempt) : null;
  if (attempt.task === 'check' && !judge(sim, run)) {
    close(attempt, sim.now, 'failed');
    task.state = 'failed';
    return;
  }
  if (!attempt.fails) {
    close(attempt, sim.now, 'success');
    task.state = 'success';
    if (attempt.task === 'load') say(sim, loaded(sim, run, attempt));
    return;
  }
  close(attempt, sim.now, 'failed');
  if (attempt.forced) sim.failNext[run.day] = (sim.failNext[run.day] ?? 0) - 1;
  const what =
    attempt.task === 'load'
      ? failedLoad(sim, run, attempt, write)
      : `${weekday(run.day)}'s ${TASK_WORD[attempt.task]} fails on attempt ${attempt.n}`;
  if (task.tries < ATTEMPTS) {
    const wait = BACKOFF[task.tries - 1] ?? 0;
    task.state = 'up-for-retry';
    schedule(sim.agenda, sim.now + wait, { kind: 'retry', attempt: attempt.id });
    say(sim, `${what}; it is retried in ${minutesText(wait)}`);
  } else {
    task.state = 'failed';
    say(sim, `${what}; that was its last attempt, so the task fails`);
  }
}

/** Handles one event, and says whether it still mattered: a clear or a late file makes some
 *  booked events void, and the agenda has no way to take them back. */
function happen(sim: Sim, event: Event): boolean {
  if (event.kind === 'file') {
    if (sim.files[event.day] !== sim.now) return false;
    say(sim, `${weekday(event.day)}'s export file lands`);
    return true;
  }
  const attempt = sim.attempts[event.attempt] as Attempt;
  const run = sim.runs[attempt.day] as Run;
  const task = run.tasks[TASKS.indexOf(attempt.task)] as Task;
  if (event.kind === 'retry') {
    if (task.state !== 'up-for-retry' || task.attempts.at(-1) !== attempt) return false;
    task.state = 'pending';
    return true;
  }
  if (attempt.outcome !== 'running') return false;
  if (event.kind === 'poke') poke(sim, run, task, attempt);
  else complete(sim, run, task, attempt);
  return true;
}

/** Ends a run whose tasks are all done. */
function finish(sim: Sim, run: Run): void {
  const failed = run.tasks.find((t) => t.state === 'failed');
  run.state = failed ? 'failed' : 'success';
  run.ended = sim.now;
  const life = run.lives.at(-1);
  if (life) life.to = sim.now;
  const name = weekday(run.day);
  say(
    sim,
    !failed
      ? `${name}'s run succeeds`
      : failed.name === 'wait'
        ? `${name}'s run fails: its sensor gave up`
        : failed.name === 'check'
          ? `${name}'s run fails: its check found the totals differ`
          : `${name}'s run fails: its ${TASK_WORD[failed.name]} failed ${failed.tries} times`,
  );
  if (finished(sim)) {
    const ok = countOf(sim.runs, (r) => r.state === 'success');
    say(
      sim,
      ok === DAYS
        ? `Every run has finished, and all ${DAYS} succeeded`
        : ok === 0
          ? `Every run has finished, and all ${DAYS} failed`
          : `Every run has finished: ${ok} succeeded and ${DAYS - ok} failed`,
    );
  }
}

/** The load that has waited longest for a warehouse slot; on a tie, the earliest day's. */
function waitingLoad(sim: Sim): { run: Run; task: Task } | null {
  let best: { run: Run; task: Task } | null = null;
  for (const run of sim.runs) {
    const task = run.tasks[LOAD] as Task;
    if (task.state === 'queued' && (!best || task.queuedAt < best.task.queuedAt))
      best = { run, task };
  }
  return best;
}

/** The queued run for the oldest day. Schedulers on the data-interval model let runs in by the
 *  day they cover, so a day that a clear sent back to the queue goes before later days. */
const waitingRun = (sim: Sim): Run | undefined => sim.runs.find((r) => r.state === 'queued');

/**
 * The scheduler's loop, until nothing more can move at this minute. Each pass lets runs in while
 * there is room, oldest day first, then moves each running run's tasks, then gives free warehouse
 * slots to waiting loads. Runs are let in before the pass over the runs, not as it reaches each
 * one: a run that finishes part way through the pass would otherwise hand its slot to the next
 * day after it, ahead of an earlier day that a clear had sent back to the queue.
 */
function dispatch(sim: Sim): void {
  if (!sim.on) return;
  for (let moved = true; moved;) {
    moved = false;
    for (
      let run = waitingRun(sim);
      run && activeRuns(sim) < sim.maxActiveRuns;
      run = waitingRun(sim)
    ) {
      run.state = 'running';
      run.started = sim.now;
      noteAdmission(sim.checker, 'runs', activeRuns(sim), sim.maxActiveRuns, sim.now);
      say(sim, `${weekday(run.day)}'s run starts`);
    }
    for (const run of sim.runs) {
      if (run.state !== 'running') continue;
      for (const [i, task] of run.tasks.entries()) {
        if (task.state !== 'pending') continue;
        const up = i > 0 ? (run.tasks[i - 1] as Task) : null;
        if (up?.state === 'failed' || up?.state === 'upstream-failed') {
          task.state = 'upstream-failed';
          moved = true;
        } else if (
          !up ||
          up.state === 'success' ||
          (sim.faults.ignoreDependencies === true && up.state === 'running')
        ) {
          if (task.name === 'load') {
            task.state = 'queued';
            task.queuedAt = sim.now;
          } else begin(sim, run, task);
          moved = true;
        }
      }
      if (run.tasks.every((t) => isFinal(t.state))) {
        finish(sim, run);
        moved = true;
      }
    }
    for (
      let load = waitingLoad(sim);
      load && (loadsRunning(sim) < LOAD_SLOTS || sim.faults.poolOverrun === true);
      load = waitingLoad(sim)
    ) {
      begin(sim, load.run, load.task);
      moved = true;
    }
  }
}

/** After every event and action: the scheduler moves what it can, then the checker looks. */
function settle(sim: Sim): void {
  dispatch(sim);
  observeTotals(sim.checker, sim.report, sim.source, sim.now);
  sim.violation ??= invariant(sim);
}

/** When the next event happens, or Infinity when nothing is booked. */
export const nextTime = (sim: Sim): number => peekTime(sim.agenda);

/** Handles the next event, in the agenda's order: by time, then by the order it was booked. */
export function step(sim: Sim): boolean {
  if (sim.violation) return false;
  const entry = next(sim.agenda);
  if (!entry) return false;
  sim.steps += 1;
  sim.now = Math.max(sim.now, entry.at);
  if (happen(sim, entry.event)) sim.events += 1;
  settle(sim);
  return true;
}

/**
 * Runs every event up to a virtual minute, then stands at it. With Infinity it runs until nothing
 * is booked, and stands at the last event. An empty agenda's next time is Infinity, so the loop
 * asks for a finite time, or Infinity would always be due. A call that its limit of events cuts
 * short, as a page's frame may, stands at its last event instead: moving the clock past events
 * still due would handle them late, and the run would no longer be the one replay rebuilds.
 */
export function runUntil(sim: Sim, until: number, limit = Infinity): void {
  for (let left = limit; left > 0 && !sim.violation; left--) {
    const at = nextTime(sim);
    if (!Number.isFinite(at) || at > until) break;
    step(sim);
  }
  if (!sim.violation && Number.isFinite(until) && nextTime(sim) > until)
    sim.now = Math.max(sim.now, until);
}

/** Keeps an action with its place in the run, for replay. */
function record(sim: Sim, deed: Deed): void {
  sim.actions.push({ at: sim.now, steps: sim.steps, ...deed });
}

/** Switches the job graph on, with catch-up: a run for each day of the week, all at once. */
export function start(sim: Sim): void {
  if (sim.on) return;
  record(sim, { kind: 'start' });
  sim.on = true;
  for (let day = 0; day < DAYS; day++) sim.runs.push(createRun(day, sim.now));
  say(
    sim,
    `The job graph is switched on with catch-up, which creates all ${DAYS} days' runs at once; ${sim.maxActiveRuns} may run at a time`,
  );
  settle(sim);
}

/**
 * Reruns a day's run from extract, as a person does after a fix: every task from extract on
 * starts over, and an attempt under way is stopped before it writes. The sensor keeps its
 * success, as the file is still there; if it never found the file, it starts over too. A run
 * that had finished waits for a free run slot again.
 */
export function clear(sim: Sim, day: number): void {
  const run = sim.runs[day];
  if (!run) return;
  const keep = (task: Task) => task.name === 'wait' && task.state === 'success';
  if (run.tasks.every((t) => keep(t) || (t.state === 'pending' && t.tries === 0))) return;
  record(sim, { kind: 'clear', day });
  const from = keep(run.tasks[0] as Task) ? 'extract' : 'its sensor';
  for (const task of run.tasks) {
    if (keep(task)) continue;
    const last = task.attempts.at(-1);
    if (last?.outcome === 'running') close(last, sim.now, 'stopped');
    task.state = 'pending';
    task.tries = 0;
  }
  run.verdict = null;
  if (run.state === 'success' || run.state === 'failed') {
    run.state = 'queued';
    run.ended = null;
    run.lives.push({ from: sim.now, to: null });
  }
  say(sim, `${dayText(day)} is cleared, and its run starts again from ${from}`);
  settle(sim);
}

/** Makes the next load attempt for a day fail part way, after writing part of its rows. Each call
 *  adds one more such failure. */
export function failNextLoad(sim: Sim, day: number): void {
  if (!isDay(day)) return;
  record(sim, { kind: 'fail-next-load', day });
  sim.failNext[day] = (sim.failNext[day] ?? 0) + 1;
  say(sim, `${weekday(day)}'s next load attempt will fail part way through`);
}

/**
 * Holds a day's export file back: it lands `minutes` later than it would have (counted from now
 * if it had already landed), or never. A sensor still looking for it keeps looking, up to its
 * timeout; one that has found it already goes on as before. A hold that would change nothing is
 * not recorded and says nothing: one of no minutes, which would book a second landing at the same
 * minute, and any hold on a file that will never land, which stays that way.
 */
export function lateFile(sim: Sim, day: number, minutes: number | 'never'): void {
  if (!isDay(day)) return;
  const due = sim.files[day] as number;
  const by = minutes === 'never' ? Infinity : Math.max(0, Math.round(minutes));
  if (by === 0 || !Number.isFinite(due)) return;
  record(sim, { kind: 'late-file', day, minutes });
  const at = Math.max(due, sim.now) + by;
  sim.files[day] = at;
  if (Number.isFinite(at)) schedule(sim.agenda, at, { kind: 'file', day });
  say(
    sim,
    Number.isFinite(at)
      ? `${weekday(day)}'s export file is held back ${minutesText(by)}: it lands at ${when(at)}`
      : `${weekday(day)}'s export file is held back, and will never land`,
  );
}

export function setMode(sim: Sim, mode: Mode): void {
  if (sim.mode === mode) return;
  record(sim, { kind: 'mode', mode });
  sim.mode = mode;
  say(
    sim,
    mode === 'append'
      ? 'Loads now append their rows to the report'
      : "Loads now overwrite their day's partition in one atomic step",
  );
}

export function setPartition(sim: Sim, partition: PartitionKey): void {
  if (sim.partition === partition) return;
  record(sim, { kind: 'partition', partition });
  sim.partition = partition;
  say(
    sim,
    partition === 'run-day'
      ? "Loads now file their rows under the run's own day"
      : "Loads now file their rows under the clock's day as they start",
  );
}

export function setMaxActiveRuns(sim: Sim, runs: number): void {
  const n = clampRuns(runs);
  if (sim.maxActiveRuns === n) return;
  record(sim, { kind: 'max-active-runs', runs: n });
  sim.maxActiveRuns = n;
  say(sim, `Up to ${n} ${n === 1 ? 'run' : 'runs'} may now be active at once`);
  settle(sim);
}

/** Replays recorded actions on a fresh run of the same seed: the run they came from, exactly.
 *  Each action goes back to its place: after as many steps as the run had taken, and then at its
 *  minute, as the clock may have stood past the last event. */
export function replay(config: Config, actions: readonly Action[], until: number): Sim {
  const sim = createSim(config);
  for (const action of actions) {
    while (sim.steps < action.steps) if (!step(sim)) break;
    sim.now = Math.max(sim.now, action.at);
    switch (action.kind) {
      case 'start':
        start(sim);
        break;
      case 'fail-next-load':
        failNextLoad(sim, action.day);
        break;
      case 'clear':
        clear(sim, action.day);
        break;
      case 'late-file':
        lateFile(sim, action.day, action.minutes);
        break;
      case 'mode':
        setMode(sim, action.mode);
        break;
      case 'partition':
        setPartition(sim, action.partition);
        break;
      case 'max-active-runs':
        setMaxActiveRuns(sim, action.runs);
        break;
    }
  }
  runUntil(sim, until);
  return sim;
}

export type { Violation };
