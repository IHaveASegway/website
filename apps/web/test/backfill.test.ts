import { describe, expect, test } from 'vitest';
import { invariant, properties, type PropertyId } from '../src/lib/backfill/check';
import {
  countOf,
  DAY,
  DAYS,
  dayOf,
  dayText,
  DURATION,
  isoDate,
  SENSOR_TIMEOUT,
  TASKS,
  WEEK_END,
  when,
  type Attempt,
  type Faults,
  type Run,
  type Task,
  type TaskName,
} from '../src/lib/backfill/core';
import {
  clear,
  createSim,
  failNextLoad,
  finished,
  lateFile,
  replay,
  runUntil,
  setMaxActiveRuns,
  setMode,
  setPartition,
  start,
  step,
  type Config,
  type Sim,
} from '../src/lib/backfill/sim';
import {
  board,
  OPENING,
  openingRun,
  SEEDS_IN_CI,
  statusText,
  strays,
  summary,
} from '../src/lib/backfill/view';
import { seeded } from '../src/lib/sim/random';

// The Backfill Lab's core: known answers for each rule of the model (the week, the job graph,
// the sensor, retries, the load modes, the partition key and clears), then a property sweep. The
// sweep runs many seeded backfills with failures, late files, reruns and changes of the run limit,
// and checks conservation after every event. With overwrite and the run's own day, the safe
// design, every property holds; with append or today, `totals` breaks, as the lesson says; and
// three deliberately broken schedulers show the sweep can find a real bug.

const runOf = (sim: Sim, day: number) => sim.runs[day] as Run;
const taskOf = (sim: Sim, day: number, name: TaskName) =>
  runOf(sim, day).tasks[TASKS.indexOf(name)] as Task;
const attemptsOf = (sim: Sim, day: number, name: TaskName) => taskOf(sim, day, name).attempts;
const property = (sim: Sim, id: PropertyId) =>
  properties(sim).find((p) => p.id === id) as ReturnType<typeof properties>[number];
const running = (sim: Sim) => countOf(sim.runs, (r) => r.state === 'running');
const loadsRunning = (sim: Sim) =>
  countOf(sim.runs, (r) => (r.tasks[TASKS.indexOf('load')] as Task).state === 'running');

/** A whole backfill: the graph switched on as the week ends, after `before`, and every run left
 *  to finish. */
function backfill(config: Config, before: (sim: Sim) => void = () => {}): Sim {
  const sim = createSim(config);
  before(sim);
  start(sim);
  runUntil(sim, Infinity);
  return sim;
}

/** No failure but the ones a test asks for. */
const quiet = { seed: 5, failRate: 0 } as const;

describe('the week', () => {
  test("each day's orders are 140 to 420, and its file lands after the midnight that ends it", () => {
    const delays: number[] = [];
    for (let seed = 1; seed <= 500; seed++) {
      const sim = createSim({ seed });
      for (let day = 0; day < DAYS; day++) {
        const orders = sim.source[day] as number;
        expect(orders).toBeGreaterThanOrEqual(140);
        expect(orders).toBeLessThanOrEqual(420);
        const delay = (sim.files[day] as number) - (day + 1) * DAY;
        expect(delay).toBeGreaterThanOrEqual(1);
        delays.push(delay);
      }
    }
    // Log-normal with a median of 40 minutes: half the files land within 40 minutes of midnight.
    delays.sort((a, b) => a - b);
    const median = delays[delays.length >> 1] as number;
    expect(median).toBeGreaterThanOrEqual(36);
    expect(median).toBeLessThanOrEqual(44);
  });

  test('the dates: day 0 is Monday 19 October 2026, and the clock reads Monday 26 October as the week ends', () => {
    expect(isoDate(0)).toBe('2026-10-19');
    expect(dayText(2)).toBe('Wednesday 21 October');
    expect(dayText(6)).toBe('Sunday 25 October');
    expect(dayText(dayOf(WEEK_END))).toBe('Monday 26 October');
    expect(isoDate(13)).toBe('2026-11-01');
    expect(dayText(13)).toBe('Sunday 1 November');
    expect(when(WEEK_END + 130)).toBe('02:10 on Monday 26 October');
  });

  test('nothing happens before the graph is switched on but files landing', () => {
    const sim = createSim({ seed: 5 });
    runUntil(sim, WEEK_END + 600);
    expect(sim.runs).toEqual([]);
    expect(sim.attempts).toEqual([]);
    expect(board(sim).every((row) => row.run === null && row.cells.every((c) => !c.state))).toBe(
      true,
    );
    expect(summary(sim)).toMatch(/^The job graph is off\./);
  });
});

describe('a run', () => {
  test("its tasks run in the graph's order, each once the one before it succeeds, each within its duration", () => {
    const sim = backfill({ ...quiet, maxActiveRuns: 7 });
    for (const run of sim.runs) {
      expect(run.state).toBe('success');
      let ready = run.started as number;
      for (const task of run.tasks) {
        expect(task.attempts).toHaveLength(1);
        const a = task.attempts[0] as Attempt;
        expect(a.start).toBeGreaterThanOrEqual(ready);
        if (task.name !== 'wait') {
          const [low, high] = DURATION[task.name];
          expect((a.end as number) - a.start).toBeGreaterThanOrEqual(low);
          expect((a.end as number) - a.start).toBeLessThanOrEqual(high);
        }
        ready = a.end as number;
      }
    }
    expect(properties(sim).every((p) => p.held)).toBe(true);
  });

  test.each([1, 3, 7])(
    'catch-up creates all 7 runs at once, and at most %i run at a time, oldest day first',
    (limit) => {
      const sim = createSim({ ...quiet, maxActiveRuns: limit });
      start(sim);
      expect(sim.runs.map((r) => r.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
      let most = running(sim);
      while (step(sim)) most = Math.max(most, running(sim));
      expect(most).toBe(limit);
      expect(finished(sim)).toBe(true);
      const started = [...sim.runs].sort(
        (a, b) => (a.started as number) - (b.started as number) || a.day - b.day,
      );
      expect(started.map((r) => r.day)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    },
  );

  test('raising the limit lets waiting runs in at once; lowering it lets the active ones finish', () => {
    const sim = createSim({ ...quiet, maxActiveRuns: 1 });
    start(sim);
    expect(running(sim)).toBe(1);
    setMaxActiveRuns(sim, 4);
    expect(running(sim)).toBe(4);
    setMaxActiveRuns(sim, 2);
    expect(running(sim)).toBe(4);
    runUntil(sim, Infinity);
    expect(finished(sim)).toBe(true);
    expect(property(sim, 'limits').held).toBe(true);
  });

  test('the warehouse runs 2 loads at once: a third waits, queued, until a slot frees', () => {
    const sim = createSim({ ...quiet, maxActiveRuns: 7 });
    start(sim);
    let most = 0;
    let queued = 0;
    while (step(sim)) {
      most = Math.max(most, loadsRunning(sim));
      queued = Math.max(
        queued,
        countOf(sim.runs, (r) => (r.tasks[TASKS.indexOf('load')] as Task).state === 'queued'),
      );
    }
    expect(most).toBe(2);
    expect(queued).toBeGreaterThan(0);
    expect(sim.lines.some((l) => /load gets a warehouse slot after waiting/.test(l.text))).toBe(
      true,
    );
  });
});

describe('the sensor', () => {
  test('looks every 10 minutes: a file held back 4 h 55 min is found at the first look after it lands', () => {
    const sim = backfill({ ...quiet, maxActiveRuns: 7 }, (s) => lateFile(s, 3, 295));
    // Thursday's file had landed days ago, so it lands 295 minutes from now.
    expect(sim.files[3]).toBe(WEEK_END + 295);
    const [look] = attemptsOf(sim, 3, 'wait');
    expect(look).toMatchObject({ start: WEEK_END, end: WEEK_END + 300, outcome: 'success' });
    expect(runOf(sim, 3).state).toBe('success');
  });

  test('a file that never lands: the sensor gives up after 6 hours, the tasks after it are upstream-failed, and the run fails', () => {
    const sim = backfill({ ...quiet, maxActiveRuns: 7 }, (s) => lateFile(s, 3, 'never'));
    const [look] = attemptsOf(sim, 3, 'wait') as [Attempt];
    expect(look.outcome).toBe('failed');
    expect((look.end as number) - look.start).toBe(SENSOR_TIMEOUT);
    expect(runOf(sim, 3).tasks.map((t) => t.state)).toEqual([
      'failed',
      'upstream-failed',
      'upstream-failed',
      'upstream-failed',
      'upstream-failed',
    ]);
    expect(runOf(sim, 3).state).toBe('failed');
    // The other days go on; a day whose check never ran is not a broken total.
    expect(countOf(sim.runs, (r) => r.state === 'success')).toBe(6);
    expect(properties(sim).every((p) => p.held)).toBe(true);
  });

  test('a clear after the timeout waits again, and finds a file that has landed since', () => {
    const sim = backfill({ ...quiet, maxActiveRuns: 7 }, (s) => lateFile(s, 3, 400));
    expect(runOf(sim, 3).state).toBe('failed');
    clear(sim, 3);
    runUntil(sim, Infinity);
    const looks = attemptsOf(sim, 3, 'wait');
    expect(looks.map((a) => a.outcome)).toEqual(['failed', 'success']);
    expect(runOf(sim, 3).state).toBe('success');
  });
});

describe('retries', () => {
  test('a load that fails 3 times waits 5, then 10 minutes between attempts, then fails, and so does its run', () => {
    const sim = backfill({ ...quiet, maxActiveRuns: 1 }, (s) => {
      for (let i = 0; i < 3; i++) failNextLoad(s, 2);
    });
    const [a, b, c] = attemptsOf(sim, 2, 'load') as [Attempt, Attempt, Attempt];
    expect([a, b, c].map((x) => x.outcome)).toEqual(['failed', 'failed', 'failed']);
    expect(b.start - (a.end as number)).toBe(5);
    expect(c.start - (b.end as number)).toBe(10);
    expect(taskOf(sim, 2, 'load').state).toBe('failed');
    expect(taskOf(sim, 2, 'check').state).toBe('upstream-failed');
    expect(runOf(sim, 2).state).toBe('failed');
    expect(sim.failNext[2]).toBe(0);
  });

  test('extract and load attempts fail on their own about 8% of the time; the other tasks never do', () => {
    let tries = 0;
    let failures = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const sim = backfill({ seed, maxActiveRuns: 7 });
      for (const a of sim.attempts) {
        if (a.task === 'extract' || a.task === 'load') {
          tries++;
          if (a.outcome === 'failed') failures++;
        } else if (a.task !== 'wait') expect(a.outcome).toBe('success');
      }
    }
    expect(failures / tries).toBeGreaterThan(0.065);
    expect(failures / tries).toBeLessThan(0.095);
  });
});

describe('loads', () => {
  test.each(['append', 'overwrite'] as const)(
    '%s: a load that fails part way, then succeeds on its retry',
    (mode) => {
      const sim = backfill({ ...quiet, mode }, (s) => failNextLoad(s, 2));
      const [failed, retry] = attemptsOf(sim, 2, 'load') as [Attempt, Attempt];
      const orders = sim.source[2] as number;
      expect(failed.outcome).toBe('failed');
      expect(retry.outcome).toBe('success');
      expect(failed.percent).toBeGreaterThanOrEqual(20);
      expect(failed.percent).toBeLessThanOrEqual(80);
      if (mode === 'append') {
        // Its share of rows stays, and the retry appends the whole day again.
        expect(failed.wrote).toBe(Math.floor((orders * failed.percent) / 100));
        expect(sim.report[2]).toBe(orders + failed.wrote);
        expect(runOf(sim, 2).verdict).toMatchObject({
          report: orders + failed.wrote,
          source: orders,
        });
        expect(property(sim, 'totals').count).toBe(1);
      } else {
        // One atomic step: the failed attempt left nothing, the retry the day exactly.
        expect(failed.wrote).toBe(0);
        expect(sim.report[2]).toBe(orders);
        expect(property(sim, 'totals').held).toBe(true);
      }
      for (const day of [0, 1, 3, 4, 5, 6]) expect(sim.report[day]).toBe(sim.source[day]);
    },
  );

  test.each([
    ['append', 2],
    ['overwrite', 1],
  ] as const)(
    'a clear reruns a finished day: under %s its orders are counted %i times',
    (mode, n) => {
      const sim = backfill({ ...quiet, mode });
      clear(sim, 1);
      // The sensor keeps its success; the rest starts over at once, as no other run is active.
      expect(taskOf(sim, 1, 'wait').state).toBe('success');
      expect(taskOf(sim, 1, 'extract').state).toBe('running');
      runUntil(sim, Infinity);
      expect(attemptsOf(sim, 1, 'load')).toHaveLength(2);
      expect(sim.report[1]).toBe(n * (sim.source[1] as number));
      expect(property(sim, 'totals').held).toBe(mode === 'overwrite');
    },
  );

  test('a clear stops an attempt under way before it writes', () => {
    const sim = createSim({ ...quiet, mode: 'append' });
    start(sim);
    while (taskOf(sim, 0, 'load').state !== 'running') step(sim);
    clear(sim, 0);
    const [stopped] = attemptsOf(sim, 0, 'load') as [Attempt];
    expect(stopped.outcome).toBe('stopped');
    expect(stopped.wrote).toBe(0);
    runUntil(sim, Infinity);
    expect(sim.report[0]).toBe(sim.source[0]);
    expect(properties(sim).every((p) => p.held)).toBe(true);
  });

  test("today: every day of the backfill lands on Monday 26 October, the clock's day", () => {
    const sim = backfill({ ...quiet, mode: 'append', partition: 'today' });
    const total = sim.source.reduce((sum, n) => sum + n, 0);
    expect(sim.report.slice(0, DAYS)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    expect(strays(sim)).toEqual([
      { day: 7, date: '2026-10-26', name: 'Monday 26 October', rows: total },
    ]);
    expect(property(sim, 'totals').count).toBe(7);
    expect(summary(sim)).toMatch(
      /7 days show no orders in the report, because their rows were filed under Monday 26 October/,
    );
  });

  test("today with overwrite: each load replaces the one before, so the clock's day holds one day's orders", () => {
    const sim = backfill({ ...quiet, mode: 'overwrite', partition: 'today' });
    expect(sim.source).toContain(sim.report[7]);
    expect(property(sim, 'totals').count).toBe(7);
  });
});

describe('the test-only faults, one run each', () => {
  test('ignoreDependencies: a task starts while the one before it is still running', () => {
    const sim = backfill({ ...quiet, faults: { ignoreDependencies: true } });
    expect(property(sim, 'order').first?.detail).toBe(
      "Monday's extract started while its sensor was still running",
    );
    expect(sim.violation).toBeNull();
  });

  test('poolOverrun: a third load runs beside the two the warehouse allows', () => {
    const sim = backfill({ ...quiet, maxActiveRuns: 7, faults: { poolOverrun: true } });
    expect(property(sim, 'limits').first?.detail).toBe(
      '3 loads ran at once, with 2 warehouse slots',
    );
    expect(sim.violation).toBeNull();
  });

  test("nonAtomicOverwrite: a rerun's load that fails leaves its checked day empty until the retry", () => {
    const rerun = (faults: Faults) => {
      const sim = backfill({ ...quiet, mode: 'overwrite', faults });
      failNextLoad(sim, 2);
      clear(sim, 2);
      runUntil(sim, Infinity);
      return sim;
    };
    const safe = rerun({});
    expect(safe.report[2]).toBe(safe.source[2]);
    expect(property(safe, 'totals').held).toBe(true);
    const broken = rerun({ nonAtomicOverwrite: true });
    expect(broken.writes.some((w) => w.partition === 2 && w.inserted === 0 && w.deleted > 0)).toBe(
      true,
    );
    expect(property(broken, 'totals').first?.detail).toBe(
      `Wednesday's report holds 0 orders and the source ${broken.source[2]}`,
    );
    // The retry puts the day right again; the break was what readers saw in between.
    expect(broken.report[2]).toBe(broken.source[2]);
    expect(broken.violation).toBeNull();
  });
});

describe('the conservation check', () => {
  test('holds on a run, and sees rows from nowhere, an attempt in two places, and a state its attempts deny', () => {
    const sim = backfill(quiet, (s) => failNextLoad(s, 2));
    expect(invariant(sim)).toBeNull();

    sim.report[4] = (sim.report[4] as number) + 1;
    expect(invariant(sim)?.detail).toMatch(/holds \d+ rows for Friday 23 October, and its writes/);
    sim.report[4] = (sim.report[4] as number) - 1;

    const write = sim.writes[0] as { inserted: number };
    write.inserted += 1;
    expect(invariant(sim)?.detail).toMatch(/wrote \d+ rows, not \d+/);
    write.inserted -= 1;

    const extra = sim.attempts[0] as Attempt;
    taskOf(sim, 1, 'wait').attempts.push(extra);
    expect(invariant(sim)?.detail).toMatch(/does not belong/);
    taskOf(sim, 1, 'wait').attempts.pop();

    taskOf(sim, 6, 'check').state = 'running';
    expect(invariant(sim)?.detail).toMatch(/Sunday's check is running/);
    taskOf(sim, 6, 'check').state = 'success';

    runOf(sim, 6).state = 'running';
    expect(invariant(sim)?.detail).toMatch(/Sunday's run is running while every task is done/);
    runOf(sim, 6).state = 'success';
    expect(invariant(sim)).toBeNull();
  });

  test('a break freezes the run, and the status line says it is a bug', () => {
    const sim = createSim({ seed: 5 });
    start(sim);
    sim.report[0] = 5;
    expect(step(sim)).toBe(true);
    expect(sim.violation?.detail).toMatch(/the report holds 5 rows for Monday 19 October/);
    const events = sim.events;
    expect(step(sim)).toBe(false);
    runUntil(sim, Infinity);
    expect(sim.events).toBe(events);
    expect(statusText(sim)).toMatch(/^Stopped at 00:\d\d on Monday 26 October: conservation broke/);
  });
});

/** A seeded backfill with faults: before the graph is switched on, some days' loads are set to
 *  fail and one file may be late or never land; then, every 15–90 minutes for 8 hours, the
 *  visitor clears a day, sets a load to fail, changes how many runs may be active, or holds a file
 *  back. Then every run is left to finish. */
function faultyRun(seed: number, over: Partial<Config> = {}): Sim {
  const pick = seeded(seed * 7919 + 17);
  const sim = createSim({
    seed,
    mode: 'overwrite',
    partition: 'run-day',
    maxActiveRuns: 1 + Math.floor(pick() * DAYS),
    ...over,
  });
  for (let day = 0; day < DAYS; day++) if (pick() < 0.15) failNextLoad(sim, day);
  if (pick() < 0.3) lateFile(sim, Math.floor(pick() * DAYS), pick() < 0.5 ? 300 : 'never');
  start(sim);
  for (let t = sim.now; t < WEEK_END + 8 * 60 && !sim.violation;) {
    t += 15 + Math.floor(pick() * 75);
    runUntil(sim, t);
    const roll = pick();
    const day = Math.floor(pick() * DAYS);
    if (roll < 0.4) clear(sim, day);
    else if (roll < 0.7) failNextLoad(sim, day);
    else if (roll < 0.85) setMaxActiveRuns(sim, 1 + Math.floor(pick() * DAYS));
    else lateFile(sim, day, pick() < 0.5 ? 300 : 'never');
  }
  runUntil(sim, Infinity);
  return sim;
}

/** How many seeds the sweep runs: about 1.3 s of the suite on a laptop, measured on 2026-10-30.
 *  Over 3,000 seeds the faults are caught in 3,000 (ignoreDependencies), 2,170 (poolOverrun) and
 *  1,720 (nonAtomicOverwrite); append breaks totals in 2,986 and today in all 3,000. */
const SEEDS = SEEDS_IN_CI;

// As in the Raft Lab, the limit only catches a hang: a broken scheduler that stops being caught
// fails its assertion, not the clock.
describe('the property sweep', { timeout: 30_000 }, () => {
  test(`${SEEDS} faulty backfills with overwrite and the run's own day: conservation and every property hold, and every run finishes`, () => {
    const broken: string[] = [];
    let events = 0;
    let clears = 0;
    let failures = 0;
    let failedRuns = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = faultyRun(seed);
      events += sim.events;
      clears += countOf(sim.actions, (a) => a.kind === 'clear');
      failures += countOf(sim.attempts, (a) => a.outcome === 'failed');
      failedRuns += countOf(sim.runs, (r) => r.state === 'failed');
      if (sim.violation) broken.push(`seed ${seed}: conservation: ${sim.violation.detail}`);
      for (const p of properties(sim))
        if (!p.held) broken.push(`seed ${seed}: ${p.id}: ${p.first?.detail}`);
      if (!finished(sim)) broken.push(`seed ${seed}: a run never finished`);
    }
    expect(broken).toEqual([]);
    // The sweep did real work: reruns, failed attempts, and whole runs that failed.
    expect(events).toBeGreaterThan(SEEDS * 50);
    expect(clears).toBeGreaterThan(SEEDS);
    expect(failures).toBeGreaterThan(SEEDS);
    expect(failedRuns).toBeGreaterThan(0);
  });

  test('with append, the same backfills break totals: a retry or a rerun counts a day twice', () => {
    let caught: string | null = null;
    for (let seed = 1; seed <= SEEDS && !caught; seed++) {
      const sim = faultyRun(seed, { mode: 'append' });
      expect(sim.violation).toBeNull();
      const totals = property(sim, 'totals');
      if (!totals.held) caught = `seed ${seed}: ${totals.first?.detail}`;
    }
    expect(caught).not.toBeNull();
  });

  test("with today, every one of them breaks totals: the week's rows land on the clock's day", () => {
    const missed: string[] = [];
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = faultyRun(seed, { partition: 'today' });
      if (sim.violation) missed.push(`seed ${seed}: conservation: ${sim.violation.detail}`);
      else if (property(sim, 'totals').held) missed.push(`seed ${seed}: totals held`);
    }
    expect(missed).toEqual([]);
  });

  test.each([
    ['starts a task while the one before it runs', { ignoreDependencies: true }, 'order'],
    ['ignores the warehouse slots', { poolOverrun: true }, 'limits'],
    ['overwrites in two steps, delete then insert', { nonAtomicOverwrite: true }, 'totals'],
  ] as const)('a scheduler that %s is caught within the sweep', (_name, faults, id) => {
    let caught: string | null = null;
    for (let seed = 1; seed <= SEEDS && !caught; seed++) {
      const sim = faultyRun(seed, { faults });
      expect(sim.violation).toBeNull();
      const p = property(sim, id);
      if (!p.held) caught = `seed ${seed}: ${p.first?.detail}`;
    }
    expect(caught).not.toBeNull();
  });
});

test('determinism: the same seed and actions give the same run, event for event', () => {
  const until = WEEK_END + 600;
  const run = () => {
    const sim = createSim({ seed: 42 });
    failNextLoad(sim, 4);
    lateFile(sim, 5, 300);
    start(sim);
    runUntil(sim, WEEK_END + 30);
    setMode(sim, 'overwrite');
    clear(sim, 0);
    runUntil(sim, WEEK_END + 60);
    setPartition(sim, 'today');
    setMaxActiveRuns(sim, 6);
    runUntil(sim, until);
    return sim;
  };
  const a = run();
  const b = run();
  const again = replay({ seed: 42 }, a.actions, until);
  const shape = (s: Sim) =>
    JSON.stringify([s.events, s.runs, s.report, s.writes, s.lines, properties(s)]);
  expect(shape(b)).toBe(shape(a));
  expect(shape(again)).toBe(shape(a));
  expect(a.actions.map((x) => x.kind)).toEqual([
    'fail-next-load',
    'late-file',
    'start',
    'mode',
    'clear',
    'partition',
    'max-active-runs',
  ]);
});

const BANNED =
  /\b(seamless|robust|blazing|leverage|cutting-edge|world-class|best-in-class|game-changing|revolutionary|next-generation|synergy|passionate)\b/i;

test('the lines: at most 200, each one plain sentence, with no banned word and no exclamation mark', () => {
  const sim = createSim({ seed: 11 });
  failNextLoad(sim, 3);
  lateFile(sim, 6, 'never');
  start(sim);
  // Every line ever said: each 20 minutes says far fewer than 200, so none is dropped unseen.
  const lines = new Set<string>();
  for (let i = 0; i < 60; i++) {
    runUntil(sim, WEEK_END + 20 * (i + 1));
    if (i === 20) setPartition(sim, 'today');
    if (i === 40) setMode(sim, 'overwrite');
    clear(sim, i % DAYS);
    for (const line of sim.lines) lines.add(line.text);
  }
  runUntil(sim, Infinity);
  for (const line of sim.lines) lines.add(line.text);
  // More than 200 were said, and the oldest went.
  expect(sim.lines).toHaveLength(200);
  expect(sim.lines[0]?.at).toBeGreaterThan(WEEK_END);
  for (const text of lines) {
    expect(text).toMatch(/^[A-Z]/);
    expect(text).not.toMatch(/[.;:,]$/);
    expect(text).not.toContain('. ');
  }
  const texts = [
    ...lines,
    summary(sim),
    statusText(sim),
    ...properties(sim).flatMap((p) => [p.name, p.first?.detail ?? '']),
  ];
  for (const text of texts) {
    expect(text).not.toMatch(BANNED);
    expect(text).not.toContain('!');
    expect(text).not.toMatch(/undefined|NaN|Infinity|null/);
  }
});

describe('the opening the page draws', () => {
  test('Wednesday: a failed load leaves 96 of its 179 rows, the retry appends all 179 again, and the check finds 96 too many', () => {
    const sim = openingRun();
    expect(sim.violation).toBeNull();
    expect(sim.now).toBe(OPENING.until);
    expect(sim.runs.map((r) => r.state)).toEqual(Array.from({ length: DAYS }, () => 'success'));
    // The last run finishes at the minute the picture stands at: 02:10 on Monday 26 October.
    expect(Math.max(...sim.runs.map((r) => r.ended ?? 0))).toBe(OPENING.until);
    const [failed, retry] = attemptsOf(sim, 2, 'load') as [Attempt, Attempt];
    expect(failed).toMatchObject({ outcome: 'failed', wrote: 96 });
    expect(retry).toMatchObject({ outcome: 'success', wrote: 179 });
    const rows = board(sim);
    expect(rows[2]).toMatchObject({
      name: 'Wednesday',
      source: 179,
      report: 275,
      difference: 96,
      verdict: 'mismatch',
    });
    // The difference is exactly what the failed attempt left behind.
    expect(rows[2]?.difference).toBe(failed.wrote);
    for (const row of rows)
      if (row.day !== 2) expect(row).toMatchObject({ difference: 0, verdict: 'match' });
    // Wednesday's is the week's only failure, so nothing else blurs the story.
    expect(countOf(sim.attempts, (a) => a.outcome === 'failed')).toBe(1);
    // Sunday's file lands after the week ends, and its sensor is seen waiting for it.
    expect(
      sim.lines.some((l) => l.text === "Sunday's sensor finds the export file after 1 hour"),
    ).toBe(true);
    expect(summary(sim)).toBe(
      "Every run has finished, and all 7 succeeded. Wednesday's report counts 275 orders, 96 more than the source: a failed load left 96 rows behind, and the retry appended all 179 again; the other 6 days match.",
    );
    expect(statusText(sim)).toMatch(
      /^Day totals broke once, first at 00:41 on Monday 26 October \(Wednesday's report holds 275 orders and the source 179\); task order and the limits held/,
    );
    // Replayed, it is the same run: the browser takes over where the picture stands.
    expect(JSON.stringify(openingRun().runs)).toBe(JSON.stringify(sim.runs));
  });

  test('the same week with overwrite: every day matches', () => {
    const sim = openingRun('overwrite');
    expect(sim.violation).toBeNull();
    for (const row of board(sim)) expect(row).toMatchObject({ difference: 0, verdict: 'match' });
    expect(properties(sim).every((p) => p.held)).toBe(true);
    expect(summary(sim)).toBe(
      "Every run has finished, and all 7 succeeded. Every day's total matches the source: 2,012 orders in all.",
    );
  });
});
