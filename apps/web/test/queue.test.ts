import { describe, expect, test } from 'vitest';
import { audit, invariant, properties, type PropertyId } from '../src/lib/queue/check';
import {
  BACKOFF,
  createSim,
  crash,
  DRAIN_WITHIN,
  jobOf,
  LATENCY,
  LOADS,
  MAX_WORKERS,
  nextTime,
  poison,
  replay,
  restart,
  runUntil,
  setAck,
  setKey,
  setLoad,
  setPoisonHandling,
  setPrefetch,
  setWorkers,
  slow,
  startProducer,
  step,
  stopProducer,
  WRAP_UP,
  type Ack,
  type Config,
  type Faults,
  type Handling,
  type Job,
  type Load,
  type Sim,
  type Worker,
} from '../src/lib/queue/sim';
import {
  history,
  lifecycles,
  OPENING,
  openingRun,
  SEEDS_IN_CI,
  statusText,
  summary,
  workerText,
} from '../src/lib/queue/view';
import { seeded } from '../src/lib/sim/random';

// The Queue Lab's core: known answers for each rule of the model (delivery, the prefetch window,
// a crash and what the broker puts back, the idempotency key, a slow worker, a poison order, the
// pool's size), Little's Law as a check on the history strip, conservation, then a property sweep.
// The sweep runs many seeded runs from the safe configuration (acknowledge after the ticket, with
// the idempotency key) with crashes, restarts and slow spells, and requires every property to hold.
// Two weak configurations and three deliberately broken behaviours show the sweep can see a break.

const workerOf = (sim: Sim, k: number) => sim.workers[k] as Worker;

/** Steps a run until `reached` holds; fails the test if it never does by `limit` ms. */
function stepUntil(sim: Sim, reached: (sim: Sim) => boolean, limit = 60_000): void {
  while (!reached(sim)) {
    if (sim.now > limit || !step(sim)) throw new Error('the state the test waits for never came');
  }
}

/** Worker k's ticket for the order it works on has printed, and its ack has not left. */
function betweenTicketAndAck(sim: Sim, k: number): boolean {
  const w = workerOf(sim, k);
  if (w.busy === null) return false;
  const job = jobOf(sim, w.busy);
  const last = job.effects.at(-1);
  return !job.ackSent && last?.worker === k && last.at >= w.started;
}

const property = (sim: Sim, id: PropertyId) =>
  properties(sim).find((p) => p.id === id) as ReturnType<typeof properties>[number];

describe('delivery', () => {
  test('the broker sends orders round-robin, one way in 2 to 6 ms, and the ack leaves after the ticket', () => {
    const sim = createSim({ seed: 1, load: 'calm' });
    runUntil(sim, 5_000);
    const [a, b, c] = sim.jobs as [Job, Job, Job];
    expect([a.worker, b.worker, c.worker]).toEqual([0, 1, 2]);
    // The first order meets an idle worker, so the time to it is the wire's.
    const wire = (a.delivered[0] as number) - a.published;
    expect(wire).toBeGreaterThanOrEqual(LATENCY[0]);
    expect(wire).toBeLessThanOrEqual(LATENCY[1]);
    let done = 0;
    for (const job of sim.jobs) {
      if (job.place !== 'done') continue;
      done += 1;
      expect(job.effects).toHaveLength(1);
      // The wrap-up, then the wire: the ack reaches the broker 12 to 46 ms after the ticket.
      const after = (job.acked as number) - (job.effects[0]?.at as number);
      expect(after).toBeGreaterThanOrEqual(WRAP_UP[0] + LATENCY[0]);
      expect(after).toBeLessThanOrEqual(WRAP_UP[1] + LATENCY[1]);
      expect(job.ended).toBe(job.acked);
    }
    expect(done).toBeGreaterThan(20);
  });

  test.each([1, 4])(
    'prefetch %i: a worker never holds more orders than its window, and fills it under rush',
    (prefetch) => {
      const sim = createSim({ seed: 2, load: 'rush', prefetch });
      let most = 0;
      while (nextTime(sim) <= 10_000) {
        step(sim);
        for (const w of sim.workers) most = Math.max(most, w.window.length);
      }
      expect(most).toBe(prefetch);
    },
  );

  test('the producer publishes at the load’s rate, a new load takes over at once, and a stop stops it', () => {
    const sim = createSim({ seed: 3, load: 'calm' });
    const published = (from: number, to: number) =>
      sim.jobs.reduce((n, job) => n + (job.published >= from && job.published < to ? 1 : 0), 0);
    runUntil(sim, 30_000);
    setLoad(sim, 'rush');
    runUntil(sim, 60_000);
    stopProducer(sim);
    runUntil(sim, 70_000);
    // A Poisson count over 30 s: within 12% of the rate, about two standard deviations at calm.
    for (const [rate, from] of [
      [LOADS.calm, 0],
      [LOADS.rush, 30_000],
    ] as const) {
      expect(published(from, from + 30_000) / 30).toBeGreaterThan(rate * 0.88);
      expect(published(from, from + 30_000) / 30).toBeLessThan(rate * 1.12);
    }
    expect(published(60_000, 70_000)).toBe(0);
    startProducer(sim);
    runUntil(sim, 72_000);
    expect(published(70_000, 72_000)).toBeGreaterThan(10);
  });
});

describe('a crash', () => {
  test('between the ticket and the ack, under after: the order is sent again, and without the key it prints twice', () => {
    for (const key of [false, true]) {
      const sim = createSim({ seed: 5, load: 'busy', key });
      stepUntil(sim, (s) => betweenTicketAndAck(s, 0));
      const job = jobOf(sim, workerOf(sim, 0).busy as number);
      crash(sim, 0);
      expect(job.place).toBe('orphan');
      runUntil(sim, sim.now + 3_000);
      expect(job.redelivered).toBe(true);
      expect(job.delivered).toHaveLength(2);
      expect(job.place).toBe('done');
      expect(job.effects).toHaveLength(key ? 1 : 2);
      expect([sim.duplicates, sim.skipped, sim.lostCount]).toEqual(key ? [0, 1, 0] : [1, 0, 0]);
      expect(property(sim, 'once').held).toBe(key);
      if (!key)
        expect(property(sim, 'once').first?.detail).toMatch(
          new RegExp(`^order ${job.id} was printed by worker 1 and again by worker \\d$`),
        );
    }
  });

  test('the broker puts back what the worker held at the head of the queue, in the order it sent it, and a restart starts empty', () => {
    const sim = createSim({ seed: 3, load: 'rush', workers: 1, prefetch: 4 });
    stepUntil(sim, (s) => workerOf(s, 0).window.length === 4);
    const held = [...workerOf(sim, 0).window];
    crash(sim, 0);
    expect(workerText(sim, 0)).toBe('Worker 1, down');
    // The broker hears of the crash when the connection's close arrives, a few ms later.
    stepUntil(sim, (s) => !(s.connections[0] as { open: boolean }).open);
    expect(sim.ready.slice(0, 4)).toEqual(held);
    expect(held.every((id) => jobOf(sim, id).redelivered)).toBe(true);
    restart(sim, 0);
    expect(workerOf(sim, 0).conn).toBe(1);
    runUntil(sim, sim.now + 20);
    expect(workerOf(sim, 0).window).toEqual(held);
  });

  test('under before, a crash loses what the worker held: the broker let it go on delivery', () => {
    const sim = createSim({ seed: 3, load: 'rush', prefetch: 3, ack: 'before' });
    stepUntil(sim, (s) => workerOf(s, 0).window.length === 3);
    const held = [...workerOf(sim, 0).window];
    crash(sim, 0);
    expect(held.map((id) => jobOf(sim, id).place)).toEqual(['lost', 'lost', 'lost']);
    runUntil(sim, sim.now + 2_000);
    expect(held.every((id) => jobOf(sim, id).delivered.length === 1)).toBe(true);
    const noLoss = property(sim, 'no-loss');
    expect(noLoss.held).toBe(false);
    expect(noLoss.count).toBe(sim.lostCount);
    expect(noLoss.count).toBeGreaterThanOrEqual(3);
    expect(noLoss.first?.detail).toBe(
      `order ${held[0]} was lost: worker 1 crashed holding it, and it was acknowledged on delivery`,
    );
  });

  test('an ack already on the wire still lands: the order is done, sent once and printed once', () => {
    const sim = createSim({ seed: 4, load: 'busy' });
    const ackOnWire = (s: Sim) => [...s.replies].find((id) => jobOf(s, id).worker === 0);
    stepUntil(sim, (s) => ackOnWire(s) !== undefined);
    const job = jobOf(sim, ackOnWire(sim) as number);
    crash(sim, 0);
    runUntil(sim, sim.now + 1_000);
    expect(job.place).toBe('done');
    expect([job.delivered.length, job.effects.length, job.redelivered]).toEqual([1, 1, false]);
  });

  test.each(['after', 'before'] as const)(
    'under %s, a delivery that reaches a crashed worker goes back to the queue, or is lost',
    (ack) => {
      const sim = createSim({ seed: 6, load: 'rush', prefetch: 2, ack });
      const onWire = (s: Sim) => [...s.wire].find((id) => jobOf(s, id).worker === 0);
      stepUntil(sim, (s) => onWire(s) !== undefined);
      const job = jobOf(sim, onWire(sim) as number);
      crash(sim, 0);
      runUntil(sim, sim.now + 3_000);
      if (ack === 'after') {
        expect([job.place, job.redelivered, job.delivered.length]).toEqual(['done', true, 1]);
      } else {
        expect([job.place, job.delivered.length]).toEqual(['lost', 0]);
      }
    },
  );
});

describe('the test-only faults, one known answer each', () => {
  test('forgetRequeue: the broker drops what a crashed worker held instead of putting it back', () => {
    const sim = createSim({ seed: 3, load: 'rush', prefetch: 3, faults: { forgetRequeue: true } });
    stepUntil(sim, (s) => workerOf(s, 0).window.length === 3);
    const held = [...workerOf(sim, 0).window];
    crash(sim, 0);
    runUntil(sim, sim.now + 1_000);
    expect(held.map((id) => jobOf(sim, id).place)).toEqual(['lost', 'lost', 'lost']);
  });

  test('effectBeforeCheck: with the key on, a crash between the ticket and the record prints twice', () => {
    const sim = createSim({
      seed: 5,
      load: 'busy',
      key: true,
      faults: { effectBeforeCheck: true },
    });
    stepUntil(sim, (s) => betweenTicketAndAck(s, 0));
    const job = jobOf(sim, workerOf(sim, 0).busy as number);
    crash(sim, 0);
    runUntil(sim, sim.now + 3_000);
    expect(job.effects).toHaveLength(2);
    expect(property(sim, 'once').held).toBe(false);
  });

  test('ackBeforeEffect: under after, a crash during the work loses the order', () => {
    const sim = createSim({ seed: 5, load: 'busy', faults: { ackBeforeEffect: true } });
    runUntil(sim, 3_000);
    stepUntil(sim, (s) => {
      const busy = workerOf(s, 0).busy;
      return busy !== null && jobOf(s, busy).effects.length === 0;
    });
    const job = jobOf(sim, workerOf(sim, 0).busy as number);
    crash(sim, 0);
    runUntil(sim, sim.now + 1_000);
    expect([job.place, job.effects.length]).toEqual(['lost', 0]);
  });
});

describe('a slow worker', () => {
  /** Calm load, three workers, worker 1 ten times slower from the start, for 20 s. */
  function slowRun(prefetch: number) {
    const sim = createSim({ seed: 1, load: 'calm', prefetch });
    slow(sim, 0, true);
    let most = 0;
    let hoarding = false;
    while (nextTime(sim) <= 20_000) {
      step(sim);
      const held = workerOf(sim, 0).window.length;
      most = Math.max(most, held);
      const idle = sim.workers.some((w) => w.id > 0 && w.busy === null && w.window.length === 0);
      if (held === 10 && idle) hoarding = true;
    }
    let slowest = 0;
    for (const job of sim.jobs)
      if (job.worker === 0 && job.ended !== null)
        slowest = Math.max(slowest, job.ended - job.published);
    return { most, hoarding, slowest };
  }

  test('with prefetch 10 it hoards nine orders behind the one it works on, while another worker idles', () => {
    const { most, hoarding, slowest } = slowRun(10);
    expect(most).toBe(10);
    expect(hoarding).toBe(true);
    expect(slowest).toBeGreaterThan(12_000);
  });

  test('with prefetch 1 it holds one order at a time, and the other workers take the load', () => {
    const { most, hoarding, slowest } = slowRun(1);
    expect(most).toBe(1);
    expect(hoarding).toBe(false);
    expect(slowest).toBeLessThan(8_000);
  });
});

describe('a poison order', () => {
  /** Calm load; a poison order at 1 s; the producer stops at 2 s; 35 s more. */
  function poisoned(handling: Handling, ack: Ack = 'after') {
    const sim = createSim({ seed: 3, load: 'calm', handling, ack });
    runUntil(sim, 1_000);
    const job = poison(sim);
    runUntil(sim, 2_000);
    stopProducer(sim);
    runUntil(sim, 2_000 + DRAIN_WITHIN + 5_000);
    return { sim, job, drains: property(sim, 'drains') };
  }

  test('under requeue it comes straight back on every failure, so the queue never drains', () => {
    const { sim, job, drains } = poisoned('requeue');
    expect(job.place).not.toBe('dead');
    expect(job.failures).toBeGreaterThan(100);
    expect(drains).toMatchObject({ held: false, count: 1, first: { at: 2_000 + DRAIN_WITHIN } });
    expect(summary(sim)).toMatch(
      new RegExp(`^The queue did not drain: .*poison order ${job.id} kept failing`),
    );
    expect(statusText(sim)).toBe(
      'No order was lost and no order was printed twice, but the queue did not drain within 30 s.',
    );
  });

  test('under dead-letter it is tried four times, waiting 200, 400 and 800 ms, then dead-lettered, and the queue drains', () => {
    const { sim, job, drains } = poisoned('dead-letter');
    expect([job.place, job.failures, job.delivered.length]).toEqual(['dead', 4, 4]);
    const failures = sim.lines.flatMap((l) =>
      l.text.startsWith(`Order ${job.id} fails`) ? [l.text.replace(/^.*, try \d, and /, '')] : [],
    );
    expect(failures).toEqual([
      ...BACKOFF.map((ms) => `waits ${ms} ms before the next`),
      'goes to the dead-letter queue',
    ]);
    for (const [i, ms] of BACKOFF.entries())
      expect((job.delivered[i + 1] as number) - (job.delivered[i] as number)).toBeGreaterThan(ms);
    expect(drains.held).toBe(true);
    expect(sim.drain.last).toBeLessThan(5_000);
  });

  test('under before it is lost at its first failure: nobody holds it to try again', () => {
    const { job } = poisoned('dead-letter', 'before');
    expect([job.place, job.failures, job.delivered.length]).toEqual(['lost', 0, 1]);
  });
});

test('a worker taken out of the pool finishes what it holds, then leaves: nothing lost, nothing sent again', () => {
  const sim = createSim({ seed: 2, load: 'rush', prefetch: 5 });
  runUntil(sim, 3_000);
  const held = [...workerOf(sim, 2).window];
  expect(held).toHaveLength(5);
  setWorkers(sim, 2);
  expect(workerText(sim, 2)).toMatch(
    /^Worker 3, leaving the pool, working on order \d+, 4 waiting$/,
  );
  runUntil(sim, 10_000);
  expect(workerOf(sim, 2).state).toBe('off');
  expect(held.every((id) => jobOf(sim, id).place === 'done' && !jobOf(sim, id).redelivered)).toBe(
    true,
  );
  expect(sim.lostCount).toBe(0);
  setWorkers(sim, 3);
  expect(workerOf(sim, 2).state).toBe('up');
});

describe('Little’s Law', () => {
  test.each(['calm', 'busy'] as const)(
    '%s: the strip’s average number in the system is the arrival rate times the average time in it',
    (load) => {
      const sim = createSim({ seed: 1, load });
      runUntil(sim, 60_000);
      const samples = history(sim);
      const inSystem = samples.reduce((n, s) => n + s.ready + s.retrying + s.inFlight, 0);
      const L = inSystem / samples.length;
      let ended = 0;
      let time = 0;
      for (const job of sim.jobs) {
        if (job.ended === null) continue;
        ended += 1;
        time += job.ended - job.published;
      }
      const lambda = sim.jobs.length / 60;
      const W = time / ended / 1000;
      expect(L / (lambda * W)).toBeCloseTo(1, 1);
    },
  );

  test('rush is above capacity: the backlog and the wait keep rising', () => {
    const sim = createSim({ seed: 1, load: 'rush' });
    runUntil(sim, 20_000);
    const ready = (at: number) => history(sim).find((s) => s.at === at)?.ready as number;
    expect(ready(10_000)).toBeGreaterThan(ready(5_000));
    expect(ready(20_000)).toBeGreaterThan(ready(10_000) + 20);
    const wait = (from: number, to: number) => {
      let n = 0;
      let sum = 0;
      for (const job of sim.jobs)
        if (job.published >= from && job.published < to && job.delivered.length > 0) {
          n += 1;
          sum += (job.delivered[0] as number) - job.published;
        }
      return sum / n;
    };
    expect(wait(10_000, 15_000)).toBeGreaterThan(2 * wait(0, 5_000));
  });
});

describe('conservation', () => {
  test('the checker catches an order that disappears, and the run freezes there', () => {
    const sim = createSim({ seed: 1, load: 'rush' });
    runUntil(sim, 3_000);
    expect([invariant(sim), audit(sim)]).toEqual([null, null]);
    sim.ready.pop();
    expect(invariant(sim)?.detail).toMatch(
      /^\d+ orders were published, and \d+ are accounted for$/,
    );
    runUntil(sim, 5_000);
    expect(sim.violation).not.toBeNull();
    const events = sim.events;
    expect(step(sim)).toBe(false);
    runUntil(sim, 6_000);
    expect(sim.events).toBe(events);
    expect(sim.now).toBeLessThan(5_000);
    expect(statusText(sim)).toMatch(/^Stopped at 3\.\d{3} s: an order appeared or disappeared/);
  });

  test('the audit catches an order whose record names another place, or that is in two places', () => {
    const sim = createSim({ seed: 1, load: 'rush' });
    runUntil(sim, 3_000);
    const id = sim.ready[0] as number;
    jobOf(sim, id).place = 'wire';
    expect(invariant(sim)).toBeNull();
    expect(audit(sim)?.detail).toBe(`order ${id} is in ready, but its record says wire`);
    jobOf(sim, id).place = 'ready';
    sim.orphans.add(id);
    sim.doneCount -= 1;
    expect(invariant(sim)).toBeNull();
    expect(audit(sim)?.detail).toBe(`order ${id} is in two places at once: ready and orphan`);
  });

  test('every sample of the history strip adds up to the orders published by then', () => {
    const sim = createSim({ seed: 8, load: 'rush', prefetch: 3, ack: 'before' });
    runUntil(sim, 2_000);
    crash(sim, 1);
    poison(sim);
    runUntil(sim, 4_000);
    restart(sim, 1);
    runUntil(sim, 10_000);
    for (const s of history(sim))
      expect(s.ready + s.retrying + s.inFlight + s.done + s.dead + s.lost).toBe(s.published);
    expect(history(sim).map((s) => s.at)).toEqual(Array.from({ length: 41 }, (_, i) => i * 250));
  });
});

/** A run that takes every action, twice over for some. */
function everyAction(): Sim {
  const sim = createSim({ seed: 42, load: 'busy', prefetch: 2 });
  runUntil(sim, 1_000);
  crash(sim, 1);
  runUntil(sim, 1_700);
  restart(sim, 1);
  slow(sim, 2, true);
  setKey(sim, true);
  runUntil(sim, 2_500);
  poison(sim);
  setPoisonHandling(sim, 'dead-letter');
  setLoad(sim, 'rush');
  runUntil(sim, 3_300);
  setAck(sim, 'before');
  crash(sim, 0);
  setPrefetch(sim, 5);
  runUntil(sim, 4_000);
  restart(sim, 0);
  setWorkers(sim, 5);
  setAck(sim, 'after');
  runUntil(sim, 5_000);
  setWorkers(sim, 2);
  stopProducer(sim);
  runUntil(sim, 6_000);
  startProducer(sim);
  slow(sim, 2, false);
  setPoisonHandling(sim, 'requeue');
  poison(sim);
  runUntil(sim, 8_000);
  return sim;
}

test('determinism: the same seed and actions give the same run, event for event', () => {
  const a = everyAction();
  const b = everyAction();
  const again = replay({ seed: 42, load: 'busy', prefetch: 2 }, a.actions, 8_000);
  const shape = (s: Sim) =>
    JSON.stringify([s.events, s.jobs, s.workers, s.lines, s.samples, s.tallies]);
  expect(a.violation).toBeNull();
  expect(new Set(a.actions.map((x) => x.kind)).size).toBe(12);
  expect(shape(b)).toBe(shape(a));
  expect(shape(again)).toBe(shape(a));
});

describe('the event lines', () => {
  // docs/content.md: words that claim a quality instead of showing it.
  const BANNED = [
    'seamless',
    'robust',
    'blazing',
    'leverage',
    'cutting-edge',
    'world-class',
    'best-in-class',
    'game-changing',
    'revolutionary',
    'next-generation',
    'synergy',
    'passionate',
  ];

  test('each is a plain sentence, with no exclamation mark and none of the banned words', () => {
    const runs = [everyAction(), openingRun(), createSim({ seed: 1 })];
    for (const handling of ['requeue', 'dead-letter'] as const) {
      const sim = createSim({ seed: 9, load: 'rush', ack: 'before', handling });
      poison(sim);
      runUntil(sim, 1_000);
      crash(sim, 2);
      runUntil(sim, 3_000);
      runs.push(sim);
    }
    let lines = 0;
    for (const sim of runs)
      for (const { text } of [...sim.lines, { text: summary(sim) }, { text: statusText(sim) }]) {
        lines += 1;
        expect(text).toMatch(/^[A-Z0-9]/);
        expect(text).not.toContain('!');
        for (const word of BANNED) expect(text.toLowerCase()).not.toContain(word);
      }
    expect(lines).toBeGreaterThan(50);
  });

  test('a run keeps its last 200 lines', () => {
    const sim = createSim({ seed: 3, load: 'calm' });
    poison(sim);
    stopProducer(sim);
    runUntil(sim, 120_000);
    expect(sim.lines).toHaveLength(200);
    expect(sim.lines.at(-1)?.at).toBeGreaterThan(115_000);
  });
});

test('the opening the page draws: worker 2 crashes between a ticket and its ack, order 18 is printed twice, and nothing is lost', () => {
  const sim = openingRun();
  expect(sim.violation).toBeNull();
  expect([sim.lostCount, sim.duplicates]).toEqual([0, 1]);
  const twice = sim.jobs.find((job) => job.effects.length > 1) as Job;
  expect(twice.id).toBe(18);
  expect(twice.effects).toEqual([
    { at: 2_371, worker: 1 },
    { at: 2_873, worker: 0 },
  ]);
  expect(summary(sim)).toBe(
    'Order 18 was printed twice: worker 2 crashed after printing its ticket and before its ack left, so the broker sent it again and worker 1 printed it a second time. Nothing was lost; 25 orders are done and 13 are queued or with a worker.',
  );
  expect(statusText(sim)).toBe(
    'No order was lost and the queue drains, but 1 ticket was printed twice.',
  );
  expect(workerText(sim, 1)).toBe('Worker 2, down');
  const life = lifecycles(sim).find((l) => l.id === 18);
  expect(life).toMatchObject({ outcome: 'done', redelivered: true, delivered: [2_265, 2_450] });
  expect(history(sim)).toHaveLength(OPENING.until / 250 + 1);
  // With the idempotency key, the same seed and the same crash print every order once.
  const keyed = replay({ ...OPENING.config, key: true }, OPENING.actions, OPENING.until);
  expect([keyed.lostCount, keyed.duplicates, keyed.skipped]).toEqual([0, 0, 1]);
  // Replayed, it is the same run: the browser takes over where the picture stands.
  expect(JSON.stringify(openingRun().jobs)).toBe(JSON.stringify(sim.jobs));
});

const LOAD_NAMES: readonly Load[] = ['calm', 'busy', 'rush'];

/**
 * A seeded run with faults, from the safe configuration unless `over` changes it: a random load,
 * 3 to 5 workers and a prefetch of 1 to 10, then for 20 s an action every 150 to 1,500 ms: a crash
 * (and a restart 0.2 to 2 s later), a slow spell of 0.5 to 3.5 s, a new prefetch or a new pool
 * size. At 20 s the producer stops, every worker restarts at its usual speed and the pool grows to
 * five, so the next 30 s test whether the queue drains, not whether a worker was left down. A rush
 * on three workers leaves about 200 orders, which five drain in about 15 s.
 */
function faultyRun(seed: number, over: Partial<Config> = {}): Sim {
  const pick = seeded(seed * 7919 + 17);
  const workers = 3 + Math.floor(pick() * 3);
  const sim = createSim({
    seed,
    load: LOAD_NAMES[Math.floor(pick() * 3)] as Load,
    workers,
    prefetch: 1 + Math.floor(pick() * 10),
    ack: 'after',
    key: true,
    ...over,
  });
  const plan: { at: number; act: () => void }[] = [];
  const gap = () => 150 + Math.floor(pick() * 1_350);
  for (let t = gap(); t < 20_000; t += gap()) {
    const k = Math.floor(pick() * workers);
    const roll = pick();
    if (roll < 0.6) {
      plan.push({ at: t, act: () => crash(sim, k) });
      plan.push({ at: t + 200 + Math.floor(pick() * 1_800), act: () => restart(sim, k) });
    } else if (roll < 0.85) {
      plan.push({ at: t, act: () => slow(sim, k, true) });
      plan.push({ at: t + 500 + Math.floor(pick() * 3_000), act: () => slow(sim, k, false) });
    } else if (roll < 0.93) {
      const n = 1 + Math.floor(pick() * 10);
      plan.push({ at: t, act: () => setPrefetch(sim, n) });
    } else {
      const n = 3 + Math.floor(pick() * 3);
      plan.push({ at: t, act: () => setWorkers(sim, n) });
    }
  }
  plan.sort((a, b) => a.at - b.at);
  for (const { at, act } of plan) {
    if (at >= 20_000 || sim.violation) break;
    runUntil(sim, at);
    act();
  }
  runUntil(sim, 20_000);
  stopProducer(sim);
  setWorkers(sim, MAX_WORKERS);
  for (let k = 0; k < MAX_WORKERS; k++) {
    restart(sim, k);
    slow(sim, k, false);
  }
  runUntil(sim, 20_000 + DRAIN_WITHIN);
  return sim;
}

/** How many seeds the sweep runs: about 1.2 s of the suite on a laptop. */
const SEEDS = SEEDS_IN_CI;
/** How many seeds each weak configuration and each broken behaviour runs. */
const KNOWN = 200;

// The work is the same on every machine, but the wall clock is not: the limit only catches a hang,
// as in test/raft.test.ts. A property that stops holding fails its assertion, not the clock.
describe('the property sweep', { timeout: 30_000 }, () => {
  test(`${SEEDS} faulty runs from the safe configuration: no order lost or printed twice, the queue drains, and conservation holds after every event`, () => {
    const broken: string[] = [];
    let events = 0;
    let crashes = 0;
    let redelivered = 0;
    let skipped = 0;
    let slowestDrain = 0;
    for (let seed = 1; seed <= SEEDS; seed++) {
      const sim = faultyRun(seed);
      events += sim.events;
      skipped += sim.skipped;
      for (const action of sim.actions) if (action.kind === 'crash') crashes += 1;
      for (const job of sim.jobs) if (job.redelivered) redelivered += 1;
      slowestDrain = Math.max(slowestDrain, sim.drain.last ?? 0);
      if (sim.violation) broken.push(`seed ${seed}: ${sim.violation.detail}`);
      for (const p of properties(sim))
        if (!p.held) broken.push(`seed ${seed}: ${p.name}: ${p.first?.detail}`);
    }
    expect(broken).toEqual([]);
    // The sweep did real work: crashes that sent orders again, and second tickets the key stopped.
    expect(events).toBeGreaterThan(SEEDS * 500);
    expect(crashes).toBeGreaterThan(SEEDS * 8);
    expect(redelivered).toBeGreaterThan(SEEDS * 20);
    expect(skipped).toBeGreaterThan(SEEDS / 2);
    // And no queue came near the limit: the drain tests the queue, not the margin.
    expect(slowestDrain).toBeLessThan(20_000);
  });

  test.each([
    ['acknowledges on delivery, before the work', 'no-loss', { ack: 'before' }],
    ['has no idempotency key', 'once', { key: false }],
  ] as const)(
    'a configuration that %s breaks %s in some seeds, and conservation still holds',
    (_name, id, over) => {
      let breaks = 0;
      for (let seed = 1; seed <= KNOWN; seed++) {
        const sim = faultyRun(seed, over);
        expect(sim.violation).toBeNull();
        if (!property(sim, id).held) breaks += 1;
      }
      expect(breaks).toBeGreaterThan(KNOWN / 5);
    },
  );

  test.each([
    [
      'drops a crashed worker’s orders instead of putting them back',
      'no-loss',
      { forgetRequeue: true },
    ],
    ['records the key in a second step after the ticket', 'once', { effectBeforeCheck: true }],
    ['acknowledges as it starts an order, before the ticket', 'no-loss', { ackBeforeEffect: true }],
  ] as const)(
    'a broker or worker that %s breaks %s within the sweep',
    (_name, id, faults: Faults) => {
      let caught = 0;
      for (let seed = 1; seed <= KNOWN; seed++) {
        const sim = faultyRun(seed, { faults });
        expect(sim.violation).toBeNull();
        if (!property(sim, id).held) caught += 1;
      }
      expect(caught).toBeGreaterThan(KNOWN / 5);
    },
  );
});
