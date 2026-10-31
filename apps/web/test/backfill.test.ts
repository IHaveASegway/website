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
  weekday,
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
  nextTime,
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
  beforeSwitch,
  board,
  boardView,
  holdFile,
  LATE_BY,
  lineTime,
  linkTo,
  moment,
  OPENING,
  openingRun,
  openingWeek,
  openLink,
  PROPERTY_NAMES,
  propertyViews,
  SEEDS_IN_CI,
  SETTINGS,
  shortDay,
  startOver,
  statusText,
  STRIP_HEIGHT,
  stripLabel,
  stripMarkup,
  strays,
  summary,
  type Lamp,
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

  test('a day a clear sends back to the queue goes before later days still waiting', () => {
    const sim = createSim({ ...quiet, maxActiveRuns: 1 });
    start(sim);
    while (runOf(sim, 4).state !== 'running') step(sim);
    // Tuesday had finished; cleared, it waits for the one run slot again, with Saturday and Sunday.
    clear(sim, 1);
    runUntil(sim, Infinity);
    const after = [1, 5, 6].map((day) => runOf(sim, day).started as number);
    expect(after).toEqual([...after].sort((a, b) => a - b));
    expect(after[0]).toBeGreaterThanOrEqual(runOf(sim, 4).ended as number);
  });

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

  test('a hold of no minutes changes nothing, so it is not recorded and no file lands twice', () => {
    const plain = backfill({ ...quiet, maxActiveRuns: 7 });
    const held = backfill({ ...quiet, maxActiveRuns: 7 }, (s) => {
      // Sunday's file is still on its way as the week ends; Monday's landed a week ago.
      lateFile(s, 6, 0);
      lateFile(s, 0, 0);
    });
    expect(held.actions.map((a) => a.kind)).toEqual(['start']);
    expect(held.lines.filter((l) => /export file lands/.test(l.text))).toHaveLength(1);
    expect(held.events).toBe(plain.events);
    expect(held.files).toEqual(plain.files);
  });

  test('a file that will never land cannot be held back further: the hold is not recorded, and says nothing', () => {
    const sim = createSim(quiet);
    lateFile(sim, 3, 'never');
    lateFile(sim, 3, 300);
    lateFile(sim, 3, 'never');
    expect(sim.files[3]).toBe(Infinity);
    expect(sim.actions).toHaveLength(1);
    expect(sim.lines.map((l) => l.text)).toEqual([
      "Thursday's export file is held back, and will never land",
    ]);
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

  test('a forced failure is used up only by an attempt that fails: a clear that stops the attempt first leaves it for the rerun', () => {
    const sim = createSim({ ...quiet, maxActiveRuns: 7 });
    failNextLoad(sim, 2);
    start(sim);
    while (taskOf(sim, 2, 'load').state !== 'running') step(sim);
    clear(sim, 2);
    expect(sim.failNext[2]).toBe(1);
    runUntil(sim, Infinity);
    const loads = attemptsOf(sim, 2, 'load');
    expect(loads.map((a) => a.outcome)).toEqual(['stopped', 'failed', 'success']);
    expect(sim.failNext[2]).toBe(0);
  });

  test('extract and load attempts fail on their own about 8% of the time; convert never fails, and a check only when it finds the totals apart', () => {
    let tries = 0;
    let failures = 0;
    for (let seed = 1; seed <= 300; seed++) {
      const sim = backfill({ seed, maxActiveRuns: 7 });
      for (const a of sim.attempts) {
        if (a.task === 'extract' || a.task === 'load') {
          tries++;
          if (a.outcome === 'failed') failures++;
        } else if (a.task === 'check') {
          // No clear here, so each day's one check is the one its verdict records.
          const verdict = runOf(sim, a.day).verdict;
          expect(a.outcome).toBe(verdict?.report === verdict?.source ? 'success' : 'failed');
        } else if (a.task !== 'wait') expect(a.outcome).toBe('success');
      }
    }
    expect(failures / tries).toBeGreaterThan(0.065);
    expect(failures / tries).toBeLessThan(0.095);
  });
});

// A check reads the report and the source as it ends, and fails when their totals differ, as a
// data check in a scheduler does. A retry would read the same rows, so it is not retried, and the
// run it belongs to fails.
describe('the check', () => {
  test('a check that finds the totals apart fails, is not retried, and fails its run; the other days’ checks pass', () => {
    const sim = backfill({ ...quiet, mode: 'append' }, (s) => failNextLoad(s, 2));
    const check = taskOf(sim, 2, 'check');
    expect(check.state).toBe('failed');
    expect(check.attempts.map((a) => a.outcome)).toEqual(['failed']);
    expect(runOf(sim, 2).state).toBe('failed');
    expect(runOf(sim, 2).verdict).toMatchObject({ report: 319, source: 201 });
    for (const day of [0, 1, 3, 4, 5, 6]) {
      expect(taskOf(sim, day, 'check').state, weekday(day)).toBe('success');
      expect(runOf(sim, day).state, weekday(day)).toBe('success');
    }
    const texts = sim.lines.map((l) => l.text);
    const at = (text: string) => texts.indexOf(text);
    expect(
      at(
        "Wednesday's check finds 319 orders in the report and 201 in the source: 118 too many, so it fails and is not retried",
      ),
    ).toBeGreaterThan(-1);
    expect(at("Wednesday's run fails: its check found the totals differ")).toBe(
      at(
        "Wednesday's check finds 319 orders in the report and 201 in the source: 118 too many, so it fails and is not retried",
      ) + 1,
    );
    expect(texts.at(-1)).toBe('Every run has finished: 6 succeeded and 1 failed');
    expect(texts.filter((t) => /retried in/.test(t))).toEqual([
      "Wednesday's load fails after appending 118 of its 201 rows, and they stay in the report; it is retried in 5 minutes",
    ]);
    // Failing the check changes what the run is called, never when anything happens: the same
    // week with a check that only looked would have the same events, at the same minutes.
    expect(sim.events).toBe(
      backfill({ ...quiet, mode: 'overwrite' }, (s) => failNextLoad(s, 2)).events,
    );
    expect(invariant(sim)).toBeNull();
    expect(finished(sim)).toBe(true);
  });

  test('a check that finds the totals equal succeeds, and so does its run', () => {
    const sim = backfill({ ...quiet, mode: 'overwrite' }, (s) => failNextLoad(s, 2));
    expect(sim.runs.map((r) => r.state)).toEqual(Array.from({ length: DAYS }, () => 'success'));
    expect(sim.lines.map((l) => l.text)).toContain(
      "Wednesday's check finds 201 orders in the report, as in the source",
    );
    expect(sim.lines.at(-1)?.text).toBe(`Every run has finished, and all ${DAYS} succeeded`);
  });

  test('under today every check finds its day empty, so all seven runs fail, and the log says so', () => {
    const sim = backfill({ ...quiet, partition: 'today' });
    expect(sim.runs.map((r) => r.state)).toEqual(Array.from({ length: DAYS }, () => 'failed'));
    expect(sim.runs.map((r) => taskOf(sim, r.day, 'check').attempts.length)).toEqual(
      Array.from({ length: DAYS }, () => 1),
    );
    expect(sim.lines.at(-1)?.text).toBe(`Every run has finished, and all ${DAYS} failed`);
    expect(summary(sim)).toMatch(
      /^Every run has finished, and all 7 failed\. 7 days show no orders/,
    );
  });

  test('a rerun whose check finds the day right again succeeds: the run is judged by its last check', () => {
    const sim = backfill({ ...quiet, mode: 'append' }, (s) => failNextLoad(s, 2));
    expect(runOf(sim, 2).state).toBe('failed');
    setMode(sim, 'overwrite');
    clear(sim, 2);
    runUntil(sim, Infinity);
    expect(runOf(sim, 2).state).toBe('success');
    // The day's history keeps the first run's failed check; the rerun's passed.
    expect(taskOf(sim, 2, 'check').attempts.map((a) => a.outcome)).toEqual(['failed', 'success']);
    expect(sim.lines.at(-1)?.text).toBe(`Every run has finished, and all ${DAYS} succeeded`);
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

describe('the summary', () => {
  test('one run finished and one day checked: both said in the singular', () => {
    const sim = createSim({ ...quiet, maxActiveRuns: 1 });
    start(sim);
    while (!sim.checker.checked.some(Boolean)) step(sim);
    expect(summary(sim)).toBe(
      "1 of 7 runs has finished; 1 running and 5 waiting for a run slot. Monday's total, the only one checked so far, matches the source.",
    );
  });

  test('a rerun under append after a failed load: the cause counts the rows left behind and each append', () => {
    const sim = backfill({ ...quiet, mode: 'append' }, (s) => failNextLoad(s, 2));
    clear(sim, 2);
    runUntil(sim, Infinity);
    // 118 left behind by the failed attempt, then all 201 from the retry and 201 from the rerun.
    expect(sim.report[2]).toBe(118 + 2 * 201);
    expect(summary(sim)).toBe(
      "Every run has finished, and Wednesday's failed. Wednesday's report counts 520 orders, 319 more than the source: a failed load left 118 rows behind, and all 201 were appended twice; the other 6 days match.",
    );
  });

  test('a cause the loads do not fully account for is left out, and the plain gap stands', () => {
    const sim = backfill({ ...quiet, mode: 'overwrite' });
    setMode(sim, 'append');
    failNextLoad(sim, 2);
    clear(sim, 2);
    runUntil(sim, Infinity);
    // The overwrite's 201, then 104 left behind and the retry's 201: the appends explain only part.
    expect(sim.report[2]).toBe(201 + 104 + 201);
    expect(summary(sim)).toBe(
      "Every run has finished, and Wednesday's failed. Wednesday's report counts 506 orders, 305 more than the source; the other 6 days match.",
    );
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

/** How many seeds each pass of the sweep runs: its six passes take about 3.8 s of the suite on a
 *  laptop, measured on 2026-10-30. Over 3,000 seeds the faults are caught in 3,000
 *  (ignoreDependencies), 2,172 (poolOverrun) and 1,709 (nonAtomicOverwrite); append breaks totals
 *  in 2,986 and today in all 3,000; conservation holds in every pass. Since a check fails when it
 *  finds its day's total wrong, 15,326 checks fail under append and none under overwrite. */
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
      // The safe design's checks always find their day right: its runs fail only when a file
      // never lands or a step fails three times.
      for (const a of sim.attempts)
        if (a.task === 'check' && a.outcome === 'failed')
          broken.push(`seed ${seed}: ${a.day}'s check found its total wrong`);
    }
    expect(broken).toEqual([]);
    // The sweep did real work: reruns, failed attempts, and whole runs that failed.
    expect(events).toBeGreaterThan(SEEDS * 50);
    expect(clears).toBeGreaterThan(SEEDS);
    expect(failures).toBeGreaterThan(SEEDS);
    expect(failedRuns).toBeGreaterThan(0);
  });

  // Conservation must hold in every configuration, so each pass below checks it on every seed,
  // not only up to the first seed that breaks the property the pass is about.
  test('with append, the same backfills break totals: a retry or a rerun counts a day twice, and its check fails', () => {
    const broken: string[] = [];
    let caught = 0;
    let failedChecks = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = faultyRun(seed, { mode: 'append' });
      if (sim.violation) broken.push(`seed ${seed}: conservation: ${sim.violation.detail}`);
      if (!property(sim, 'totals').held) caught++;
      failedChecks += countOf(sim.attempts, (a) => a.task === 'check' && a.outcome === 'failed');
    }
    expect(broken).toEqual([]);
    expect(caught).toBeGreaterThan(0);
    expect(failedChecks).toBeGreaterThan(0);
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
    const broken: string[] = [];
    let caught = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = faultyRun(seed, { faults });
      if (sim.violation) broken.push(`seed ${seed}: conservation: ${sim.violation.detail}`);
      if (!property(sim, id).held) caught++;
    }
    expect(broken).toEqual([]);
    expect(caught).toBeGreaterThan(0);
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

// Virtual time counts whole minutes, so several events often share one, and a visitor's action
// can fall between two of them. Replay has to put each action back at that same place.
describe('replay, with actions between the events of one minute', () => {
  const shape = (s: Sim) =>
    JSON.stringify([s.events, s.runs, s.report, s.writes, s.lines, properties(s)]);
  /** The visitor's run to its end, and the same actions replayed on a fresh run of the seed. */
  function both(config: Config, play: (sim: Sim) => void): [string, string] {
    const sim = createSim(config);
    play(sim);
    runUntil(sim, Infinity);
    return [shape(sim), shape(replay(config, sim.actions, Infinity))];
  }

  test('a step, then an action while another event is still due that minute', () => {
    for (const seed of [1, 2, 3])
      for (let day = 0; day < DAYS; day++) {
        const [live, again] = both({ seed, maxActiveRuns: 3 }, (sim) => {
          start(sim);
          while (step(sim)) if (sim.now > WEEK_END && nextTime(sim) === sim.now) break;
          clear(sim, day);
        });
        expect(again).toBe(live);
      }
  });

  test('two actions in one minute, where the first books an event at that minute', () => {
    for (const seed of [1, 2, 3]) {
      // Switching the graph on books each running sensor's first look for this minute.
      const [live, again] = both({ seed }, (sim) => {
        start(sim);
        clear(sim, 0);
      });
      expect(again).toBe(live);
      // So does raising the limit, for each run it lets in.
      const [live2, again2] = both({ seed, maxActiveRuns: 1 }, (sim) => {
        start(sim);
        runUntil(sim, WEEK_END + 50);
        setMaxActiveRuns(sim, 7);
        clear(sim, 6);
      });
      expect(again2).toBe(live2);
    }
  });

  test('a run moved in frames of a few events each: a frame cut short stands at its last event', () => {
    const sim = createSim({ seed: 1 });
    start(sim);
    runUntil(sim, WEEK_END + 60, 1);
    // One sensor looked; the other looks due before minute 60 still wait, and the clock waits too.
    expect(sim.now).toBe(WEEK_END);
    expect(nextTime(sim)).toBe(WEEK_END);
    for (let seed = 1; seed <= 10; seed++) {
      const [live, again] = both({ seed }, (s) => {
        start(s);
        while (s.now < WEEK_END + 2_000) runUntil(s, s.now + 5, 4);
      });
      expect(again).toBe(live);
    }
  });
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

test('the lines for held-back files read as plain sentences, whatever holds come in whatever order', () => {
  const HOLDS = [0, 5, 300, 'never'] as const;
  const pick = seeded(23);
  for (let seed = 1; seed <= 200; seed++) {
    const sim = createSim({ seed });
    const hold = () =>
      lateFile(
        sim,
        Math.floor(pick() * DAYS),
        HOLDS[Math.floor(pick() * HOLDS.length)] as (typeof HOLDS)[number],
      );
    for (let i = 0; i < 4; i++) hold();
    start(sim);
    for (let t = WEEK_END; t < WEEK_END + 600; t += 30) {
      runUntil(sim, t);
      if (pick() < 0.3) hold();
    }
    runUntil(sim, Infinity);
    for (const { text } of sim.lines) expect(text).not.toMatch(/undefined|NaN|Infinity|null/);
  }
});

describe('the opening the page draws', () => {
  test('Wednesday: a failed load leaves 96 of its 179 rows, the retry appends all 179 again, and the check finds 96 too many', () => {
    const sim = openingRun();
    expect(sim.violation).toBeNull();
    expect(sim.now).toBe(OPENING.until);
    // Wednesday's check finds its total wrong, so it fails, and Wednesday's run with it.
    expect(sim.runs.map((r) => r.state)).toEqual([
      'success',
      'success',
      'failed',
      'success',
      'success',
      'success',
      'success',
    ]);
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
    // Wednesday's load and its check are the week's only failures, so nothing else blurs the story.
    expect(sim.attempts.filter((a) => a.outcome === 'failed').map((a) => [a.day, a.task])).toEqual([
      [2, 'load'],
      [2, 'check'],
    ]);
    expect(sim.lines.at(-1)?.text).toBe('Every run has finished: 6 succeeded and 1 failed');
    // Sunday's file lands after the week ends, and its sensor is seen waiting for it.
    expect(
      sim.lines.some((l) => l.text === "Sunday's sensor finds the export file after 1 hour"),
    ).toBe(true);
    expect(summary(sim)).toBe(
      "Every run has finished, and Wednesday's failed. Wednesday's report counts 275 orders, 96 more than the source: a failed load left 96 rows behind, and the retry appended all 179 again; the other 6 days match.",
    );
    expect([sim.events, when(sim.now)]).toEqual([44, '02:10 on Monday 26 October']);
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

// The page (components/backfill-lab) draws what view.ts says, at build and in the browser, so the
// lab entry's "Three things to try" are checked here first, on the same functions, with the same
// seeds, times and numbers the entry gives; e2e/backfill.spec.ts plays them on the page.
describe('what the page draws, and the three things to try', () => {
  const lamps = (sim: Sim, step: number) => boardView(sim).days.map((d) => d.steps[step]?.lamp);
  const CHECK = TASKS.indexOf('check');
  const LOAD = TASKS.indexOf('load');
  /** The opening's week under some settings, before the job is switched on. */
  const off = (config: Partial<Config> = {}) =>
    beforeSwitch(openingWeek({ ...OPENING.config, ...config }));
  /** That week switched on, after `before`, and played to its end. */
  const week = (config: Partial<Config>, before: (sim: Sim) => void = () => {}) => {
    const sim = off(config);
    before(sim);
    start(sim);
    runUntil(sim, Infinity);
    return sim;
  };

  test("start over and a link to a seed show the opening's week, on that seed and under the chosen settings, standing where a played week stops", () => {
    const opening = openingRun();
    const again = startOver(opening);
    expect(again).not.toBe(opening);
    expect(again.now).toBe(OPENING.until);
    expect(JSON.stringify(again.runs)).toBe(JSON.stringify(opening.runs));
    // Seed 12's week ends at 01:19: its link stands there, as a week switched on at 00:00 and
    // played does, not at the opening's 02:10 past every bar.
    const twelve = openingWeek({ ...OPENING.config, seed: 12 });
    const played = week({ seed: 12 });
    expect(when(twelve.now)).toBe('01:19 on Monday 26 October');
    expect(twelve.now).toBe(played.now);
    expect(twelve.events).toBe(played.events);
    expect(JSON.stringify(twelve.runs)).toBe(JSON.stringify(played.runs));
    // Its board is its own week's, the source column too.
    const view = boardView(twelve);
    expect(view.days[2]).toMatchObject({ report: '415', source: '303', difference: '+112' });
    expect(view.week).toEqual({ report: '2,203', difference: '+455', source: '1,748' });
    expect(propertyViews(twelve)[0]?.word).toBe(
      "Broke 3 times, first at 00:28: Wednesday's report holds 415 orders and the source 303.",
    );
  });

  test('a link to a week: Start over’s names the seed and each setting the visitor changed, and opens the week Start over did; one that names none is the build’s', () => {
    const shape = (sim: Sim) =>
      JSON.stringify([sim.now, sim.events, sim.runs, sim.report, sim.writes, sim.lines]);
    const settings = (sim: Sim | null) => [
      sim?.seed,
      sim?.mode,
      sim?.partition,
      sim?.maxActiveRuns,
    ];
    // Each setting a link names opens as the opening's week has it.
    const opening = openingRun();
    expect([opening.mode, opening.partition, opening.maxActiveRuns]).toEqual([
      SETTINGS.mode.opening,
      SETTINGS.partition.opening,
      SETTINGS.runs.opening,
    ]);
    expect(SETTINGS.runs.values).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(linkTo(opening)).toBe('#seed-9');
    expect(shape(openLink('#seed-9') as Sim)).toBe(shape(opening));

    setMode(opening, 'overwrite');
    setMaxActiveRuns(opening, 1);
    const again = startOver(opening);
    expect(linkTo(again)).toBe('#seed-9&mode=overwrite&runs=1');
    const linked = openLink(linkTo(again)) as Sim;
    expect(shape(linked)).toBe(shape(again));
    expect(linkTo(linked)).toBe(linkTo(again));

    // Every value the page offers reads back as written.
    for (const mode of SETTINGS.mode.values)
      for (const partition of SETTINGS.partition.values)
        for (const runs of SETTINGS.runs.values) {
          const link = linkTo({ ...createSim({ seed: 4 }), mode, partition, maxActiveRuns: runs });
          expect(settings(openLink(link)), link).toEqual([4, mode, partition, runs]);
        }
    // A name the lab does not have, or a value it cannot take, is dropped.
    expect(
      settings(openLink('#seed-12&runs=9&mode=delete&partition=yesterday&colour=red')),
    ).toEqual([12, 'append', 'run-day', 3]);
    expect(settings(openLink('#seed-12&runs=0&partition=today'))).toEqual([
      12,
      'append',
      'today',
      3,
    ]);
    for (const hash of ['', '#main', '#seed-', '#seed-1234567']) expect(openLink(hash)).toBeNull();
  });

  test('before the switch: the job off at the minute the week ends, under the chosen settings, with what was set before the switch; switched on, it is the opening again', () => {
    const before = off();
    expect(before.on).toBe(false);
    expect(before.now).toBe(WEEK_END);
    expect(before.failNext).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(summary(before)).toMatch(/^The job graph is off\./);
    expect(boardView(before).days.every((d) => d.run === '' && d.report === '')).toBe(true);
    expect(lamps(before, 0)).toEqual(Array.from({ length: DAYS }, () => 'hollow'));
    expect(stripMarkup(before)).toContain('The job is off');
    expect(JSON.stringify(week({}).runs)).toBe(JSON.stringify(openingRun().runs));
    // A setting chosen after the switch carries back; so does a file made late before it.
    const sim = off();
    lateFile(sim, 3, LATE_BY);
    start(sim);
    setMaxActiveRuns(sim, 5);
    runUntil(sim, Infinity);
    const back = beforeSwitch(sim);
    expect(back.maxActiveRuns).toBe(5);
    expect(back.files).toEqual(sim.files);
    expect(back.actions.map((a) => a.kind)).toEqual(['fail-next-load', 'late-file']);
  });

  test('watch Wednesday count twice: 96 of 179 rows, then all 179, and a check that finds 275; overwrite the day and start over, and every day matches: 2,012 orders', () => {
    const opening = openingRun();
    const wednesday = boardView(opening).days[2];
    expect(wednesday).toMatchObject({
      short: 'Wed 21',
      run: 'failed',
      report: '275',
      difference: '+96',
      source: '179',
    });
    expect(wednesday?.steps[CHECK]).toEqual({
      lamp: 'cross',
      word: 'failed: the totals differ',
      retry: '',
    });
    expect(lamps(opening, CHECK).filter((lamp) => lamp === 'cross')).toHaveLength(1);
    expect(boardView(opening).week).toEqual({
      report: '2,108',
      difference: '+96',
      source: '2,012',
    });
    // A check that found its total wrong failed, and so did its run: the caption names it.
    expect(summary(opening)).toMatch(
      /^Every run has finished, and Wednesday's failed\. Wednesday's report counts 275/,
    );
    expect(boardView(opening).days.filter((d) => d.run === 'failed')).toHaveLength(1);
    setMode(opening, 'overwrite');
    const fixed = startOver(opening);
    expect(fixed.mode).toBe('overwrite');
    expect(boardView(fixed).days.every((d) => d.difference === '' && d.report === d.source)).toBe(
      true,
    );
    expect(lamps(fixed, CHECK)).toEqual(Array.from({ length: DAYS }, () => 'filled'));
    expect(boardView(fixed).week).toEqual({ report: '2,012', difference: '', source: '2,012' });
    expect(summary(fixed)).toBe(
      "Every run has finished, and all 7 succeeded. Every day's total matches the source: 2,012 orders in all.",
    );
    expect(propertyViews(fixed).every((p) => p.held)).toBe(true);
    expect([when(fixed.now), fixed.events]).toEqual(['02:10 on Monday 26 October', 44]);
  });

  test("write to today: every day's orders land on Monday 26 October, and every check fails", () => {
    const opening = openingRun();
    setPartition(opening, 'today');
    const today = startOver(opening);
    const view = boardView(today);
    expect(view.stray).toEqual({ short: 'Mon 26', long: 'Monday 26 October', rows: '2,108' });
    expect(view.days.every((d) => d.report === '0' && d.difference.startsWith('−'))).toBe(true);
    expect(lamps(today, CHECK)).toEqual(Array.from({ length: DAYS }, () => 'cross'));
    expect(view.week).toEqual({ report: '0', difference: '−2,012', source: '2,012' });
    expect(summary(today)).toBe(
      "Every run has finished, and all 7 failed. 7 days show no orders in the report, because their rows were filed under Monday 26 October, the clock's day.",
    );
    expect(view.days.map((d) => d.run)).toEqual(Array.from({ length: DAYS }, () => 'failed'));
    expect(today.lines.at(-1)?.text).toBe('Every run has finished, and all 7 failed');
  });

  test("rerun a finished day: with append Tuesday's total doubles; with overwrite nothing changes", () => {
    const appended = openingRun();
    clear(appended, 1);
    runUntil(appended, Infinity);
    expect(boardView(appended).days[1]).toMatchObject({
      run: 'failed',
      report: '758',
      difference: '+379',
      source: '379',
    });
    expect(summary(appended)).toBe(
      "Every run has finished, and Tuesday's and Wednesday's failed. 2 days' totals are wrong: Tuesday's by 379 too many and Wednesday's by 96 too many; the other 5 days match.",
    );
    const opening = openingRun();
    setMode(opening, 'overwrite');
    const replaced = startOver(opening);
    const before = boardView(replaced).days[1];
    clear(replaced, 1);
    runUntil(replaced, Infinity);
    expect(boardView(replaced).days[1]).toMatchObject({
      run: 'done',
      report: before?.report,
      difference: '',
    });
    expect(before?.report).toBe('379');
  });

  test("a cleared day's difference waits for its rerun's check, as the first run's waits for the first: a load half written is not the answer", () => {
    const sim = openingRun();
    failNextLoad(sim, 1);
    clear(sim, 1);
    while (boardView(sim).days[1]?.steps[LOAD]?.lamp !== 'clock') step(sim);
    // The failed load left rows behind: the report holds more than the source, unchecked yet.
    const rerun = boardView(sim);
    expect(rerun.days[1]).toMatchObject({ report: '576', difference: '', source: '379' });
    expect(rerun.days[1]?.steps[CHECK]?.lamp).toBe('hollow');
    expect(rerun.week).toEqual({ report: '2,305', difference: '', source: '2,012' });
    expect(summary(sim)).not.toContain('Tuesday');
    runUntil(sim, Infinity);
    expect(boardView(sim).days[1]).toMatchObject({ report: '955', difference: '+576' });
    expect(summary(sim)).toMatch(
      /^Every run has finished, and Tuesday's and Wednesday's failed\. 2 days' totals are wrong: Tuesday's by 576/,
    );
  });

  test("then Monday's file five hours late with one run at a time: the week goes back to before the switch, and waits behind it", () => {
    const opening = openingRun();
    setMaxActiveRuns(opening, 1);
    const sim = holdFile(opening, 0);
    // Monday's sensor had found its file, so a later file would change nothing in this week: no
    // landing is booked on it, and the week goes back to before the switch instead.
    expect(sim).not.toBe(opening);
    expect(nextTime(opening)).toBe(Infinity);
    expect(sim).toMatchObject({ on: false, now: WEEK_END, maxActiveRuns: 1 });
    expect(sim.failNext).toEqual([0, 0, 1, 0, 0, 0, 0]);
    expect(sim.lines.at(-1)?.text).toBe(
      "Monday's export file is held back 5 hours: it lands at 05:00 on Monday 26 October",
    );
    start(sim);
    runUntil(sim, WEEK_END + 120);
    const view = boardView(sim);
    expect(view.days.map((d) => d.run)).toEqual([
      'running',
      ...Array.from({ length: 6 }, () => 'waiting'),
    ]);
    expect(view.days[0]?.steps[0]).toEqual({ lamp: 'lit', word: 'running', retry: '' });
    expect(summary(sim)).toBe('0 of 7 runs have finished; 1 running and 6 waiting for a run slot.');
    // Sunday's sensor has not looked yet, so its file is late in the same week.
    expect(holdFile(sim, 6)).toBe(sim);
    expect(sim.files[6]).toBe(WEEK_END + 420);
    runUntil(sim, Infinity);
    expect(
      sim.lines.some((l) => l.text === "Monday's sensor finds the export file after 5 hours"),
    ).toBe(true);
    expect(when(sim.now)).toBe('07:56 on Monday 26 October');
  });

  test('each lamp has its shape and its words: a retry carries its time, a load waiting for a slot is hollow, a step after a failure is a dash', () => {
    const retry = off();
    start(retry);
    runUntil(retry, WEEK_END + 17);
    expect(boardView(retry).days[2]?.steps[LOAD]).toEqual({
      lamp: 'hollow',
      word: 'waiting for a warehouse slot',
      retry: '',
    });
    runUntil(retry, WEEK_END + 26);
    expect(boardView(retry).days[2]?.steps[LOAD]).toEqual({
      lamp: 'clock',
      word: 'failed, tries again at 00:29',
      retry: '00:29',
    });
    // Wednesday's partial rows are in the report before its check, with no difference yet.
    expect(boardView(retry).days[2]).toMatchObject({ report: '96', difference: '' });
    const never = week({}, (sim) => lateFile(sim, 0, 'never'));
    const monday = boardView(never).days[0];
    expect(monday?.run).toBe('failed');
    expect(monday?.steps.map((s) => s.lamp)).toEqual([
      'cross',
      'dash',
      'dash',
      'dash',
      'dash',
    ] satisfies Lamp[]);
    expect(monday?.steps[1]?.word).toBe('not run: a step before it failed');
  });

  test("the properties carry the page's words, and each break its first time and detail", () => {
    expect(propertyViews(openingRun())).toEqual([
      {
        id: 'totals',
        name: PROPERTY_NAMES.totals,
        held: false,
        word: "Broke once, first at 00:41: Wednesday's report holds 275 orders and the source 179.",
      },
      { id: 'order', name: 'No step started before the steps it needs', held: true, word: 'Held.' },
      {
        id: 'limits',
        name: 'No more runs or loads at once than allowed',
        held: true,
        word: 'Held.',
      },
    ]);
  });

  test('the strip: a lane a day, a cross for each failed attempt, the now line, and whole hours across', () => {
    const opening = openingRun();
    const markup = stripMarkup(opening);
    expect(markup.match(/class="bf-strip-track"/g)).toHaveLength(DAYS);
    // Wednesday's failed load and its failed check.
    expect(markup.match(/class="bf-strip-x"/g)).toHaveLength(2);
    expect([...markup.matchAll(/class="bf-strip-time"[^>]*>([^<]+)</g)].map(([, t]) => t)).toEqual([
      '00:00',
      '01:00',
      '02:00',
      '03:00',
    ]);
    // Every position across is a share of the width, inside it.
    for (const [, x] of markup.matchAll(/ x[12]?="([^"]+)"/g))
      if (x !== '0') expect(Number(/^([\d.]+)%$/.exec(x ?? '')?.[1])).toBeLessThanOrEqual(100);
    expect(markup).toMatch(/class="bf-strip-now" x1="(\d+\.\d\d)%" x2="\1%"/);
    // Heights are in em of the strip's text, so a larger text size gives the lanes room.
    expect(STRIP_HEIGHT).toMatch(/^\d+(\.\d+)?em$/);
    expect(markup).not.toMatch(/ (y|y1|y2|height)="[\d.-]+"/);
    expect(stripLabel(opening)).toBe("Each day's steps over time, from 00:00 to 02:10");
    // A week that runs past midnight, a day and more, still reads plainly: no file ever lands, and
    // each sensor waits its 6 hours, one run at a time.
    const late = week({ maxActiveRuns: 1 }, (sim) => {
      for (let day = 0; day < DAYS; day++) lateFile(sim, day, 'never');
    });
    expect(late.now).toBeGreaterThan(WEEK_END + DAY);
    for (const text of [stripMarkup(late), stripLabel(late), summary(late)])
      expect(text).not.toMatch(/undefined|NaN|Infinity|null/);
    expect(stripLabel(late)).toMatch(/to \d\d:\d\d on Tuesday 27 October$/);
  });

  test('times and days as the page writes them', () => {
    expect([shortDay(0), shortDay(6), shortDay(7)]).toEqual(['Mon 19', 'Sun 25', 'Mon 26']);
    expect(lineTime(WEEK_END + 41)).toBe('00:41');
    expect(lineTime(WEEK_END + DAY + 10)).toBe('Tue 00:10');
    expect(moment(WEEK_END + 41)).toBe('00:41');
    expect(moment(WEEK_END + DAY + 10)).toBe(when(WEEK_END + DAY + 10));
  });
});
