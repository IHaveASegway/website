import { describe, expect, test } from 'vitest';
import { audit, invariant, properties, type PropertyId } from '../src/lib/queue/check';
import {
  BACKOFF,
  createSim,
  crash,
  DRAIN_WITHIN,
  jobOf,
  LATENCY,
  live,
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
  capacityWords,
  LAYOUTS,
  lifecycles,
  linkTo,
  mapMarkup,
  OPENING,
  openingRun,
  openLink,
  PREFETCHES,
  propertyWords,
  SEEDS_IN_CI,
  SETTINGS,
  startOver,
  statusText,
  strip,
  stripWords,
  summary,
  waitWords,
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

/**
 * What the records alone say became of the orders, without the totals, places and tallies sim.ts
 * keeps: an order no store holds is done when its ticket printed and the broker had its ack (or let
 * it go on delivery, under before), and lost otherwise. The sweep requires it to agree with the
 * run's totals, so a loss has a second witness besides the lose() that counted it, and an order
 * marked done that never printed shows.
 */
function ledger(sim: Sim): { done: number; lost: number } {
  const held = new Set([
    ...sim.ready,
    ...sim.retrying,
    ...sim.wire,
    ...sim.workers.flatMap((w) => w.window),
    ...sim.orphans,
    ...sim.replies,
    ...sim.dead,
  ]);
  let done = 0;
  let lost = 0;
  for (const job of sim.jobs) {
    if (held.has(job.id)) continue;
    if (job.effects.length > 0 && job.acked !== null) done += 1;
    else lost += 1;
  }
  return { done, lost };
}

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

  test('an order printed three times is one order printed more than once, with two tickets too many', () => {
    const sim = createSim({ seed: 1, load: 'rush', workers: 2, key: false });
    stepUntil(sim, (s) => betweenTicketAndAck(s, 0));
    const job = jobOf(sim, workerOf(sim, 0).busy as number);
    crash(sim, 0);
    restart(sim, 0);
    // Whichever worker prints it again crashes in the same gap.
    const holder = (s: Sim) =>
      s.workers.find((w) => w.busy === job.id && betweenTicketAndAck(s, w.id));
    stepUntil(sim, (s) => holder(s) !== undefined);
    crash(sim, (holder(sim) as Worker).id);
    runUntil(sim, sim.now + 3_000);
    expect([job.place, job.effects.length]).toEqual(['done', 3]);
    expect(sim.jobs.filter((j) => j.effects.length > 1)).toEqual([job]);
    expect([sim.duplicates, property(sim, 'once').count]).toEqual([2, 1]);
    expect(statusText(sim)).toBe(
      'No order was lost, but 1 order was printed more than once. Whether the queue drains is checked once orders stop.',
    );
    expect(summary(sim)).toMatch(new RegExp(`^Order ${job.id} was printed 3 times: worker 1 `));
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

  // The write-up's second thing to try, as written: switch, then crash at once.
  test('switching to before lets go of what the broker has sent: a crash right after loses it, never printed', () => {
    const sim = openingRun();
    setAck(sim, 'before');
    expect(sim.lines.at(-1)?.text).toBe(
      'Orders are now acknowledged as they are delivered, before the work: at-most-once. The broker lets go at once of what it has already sent: orders 26 and 27',
    );
    crash(sim, 0);
    const job = jobOf(sim, 26);
    expect([job.place, job.effects.length]).toEqual(['lost', 0]);
    expect(sim.lines.at(-1)?.text).toBe(
      'Worker 1 crashes holding order 26. The broker had already let it go, so it is lost',
    );
    expect(property(sim, 'no-loss').first?.detail).toBe(
      'order 26 was lost: worker 1 crashed holding it, and it was acknowledged at the switch, before its ticket printed',
    );
    runUntil(sim, sim.now + 3_000);
    // Nobody sends it again, and conservation holds.
    expect([job.place, job.delivered.length, sim.violation]).toEqual(['lost', 1, null]);
    // A switch back applies from the next delivery: what the broker let go stays let go.
    setAck(sim, 'after');
    expect(sim.lines.at(-1)?.text).toBe(
      'From the next delivery, a worker acknowledges an order after its ticket prints: at-least-once',
    );
    // An order still on its way at the switch is let go too, and reaches the crashed worker lost.
    const sent = createSim({ seed: 6, load: 'rush', prefetch: 2 });
    const onWire = (s: Sim) => [...s.wire].find((id) => jobOf(s, id).worker === 0);
    stepUntil(sent, (s) => onWire(s) !== undefined);
    const coming = jobOf(sent, onWire(sent) as number);
    setAck(sent, 'before');
    crash(sent, 0);
    runUntil(sent, sent.now + 3_000);
    expect([coming.place, coming.delivered.length, sent.violation]).toEqual(['lost', 0, null]);
  });

  test('an order past its ticket step at the switch is done, printed once, and never worked on again', () => {
    // Printed, its ack not yet left.
    const printed = createSim({ seed: 5, load: 'busy' });
    stepUntil(printed, (s) => betweenTicketAndAck(s, 0));
    const job = jobOf(printed, workerOf(printed, 0).busy as number);
    setAck(printed, 'before');
    expect(job.place).toBe('done');
    crash(printed, 0);
    runUntil(printed, printed.now + 3_000);
    expect([job.place, job.effects.length, job.delivered.length]).toEqual(['done', 1, 1]);
    expect([printed.lostCount, printed.violation]).toEqual([0, null]);
    // Sent again after a crash, its ticket skipped by the key, its ack not yet left.
    const skipped = createSim({ seed: 5, load: 'busy', key: true });
    stepUntil(skipped, (s) => betweenTicketAndAck(s, 0));
    const again = jobOf(skipped, workerOf(skipped, 0).busy as number);
    crash(skipped, 0);
    stepUntil(skipped, (s) => s.workers.some((w) => w.busy === again.id && w.ticketed));
    expect(skipped.skipped).toBe(1);
    setAck(skipped, 'before');
    expect(again.place).toBe('done');
    runUntil(skipped, skipped.now + 3_000);
    expect([again.effects.length, again.delivered.length, skipped.skipped]).toEqual([1, 2, 1]);
    expect(skipped.violation).toBeNull();
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

  test('prefetch lowered mid-run takes back nothing a worker holds, and the log says so', () => {
    const sim = createSim({ seed: 1, load: 'calm', prefetch: 10 });
    slow(sim, 0, true);
    runUntil(sim, 10_000);
    const held = workerOf(sim, 0).window.length;
    expect(held).toBe(10);
    setPrefetch(sim, 1);
    expect(sim.lines.at(-1)?.text).toBe(
      'Prefetch is now 1: each worker is sent orders until it holds 1. Worker 1 holds 10 already, and keeps them',
    );
    expect(workerOf(sim, 0).window).toHaveLength(held);
    // With no worker holding more than the new prefetch, the line says the prefetch alone.
    setPrefetch(sim, 10);
    expect(sim.lines.at(-1)?.text).toBe(
      'Prefetch is now 10: each worker is sent orders until it holds 10',
    );
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

  test('switched to dead-letter while it loops under requeue, its tries so far count: it goes at its next failure, as the switch says', () => {
    const sim = createSim({ seed: 3, load: 'calm' });
    runUntil(sim, 1_000);
    const job = poison(sim);
    runUntil(sim, 2_000);
    stopProducer(sim);
    runUntil(sim, 3_000);
    const tries = job.failures;
    expect(tries).toBeGreaterThan(BACKOFF.length);
    setPoisonHandling(sim, 'dead-letter');
    expect(sim.lines.at(-1)?.text).toBe(
      `A failing order now waits 200, 400 and 800 ms between tries, then goes to the dead-letter queue. Order ${job.id} has failed ${tries} times already, so its next failure sends it there`,
    );
    runUntil(sim, 4_000);
    expect([job.place, job.failures]).toEqual(['dead', tries + 1]);
    // With no order past its tries, the switch says the waits alone.
    const fresh = createSim({ seed: 3, load: 'calm' });
    setPoisonHandling(fresh, 'dead-letter');
    expect(fresh.lines.at(-1)?.text).toBe(
      'A failing order now waits 200, 400 and 800 ms between tries, then goes to the dead-letter queue',
    );
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
      // The arrival rate, λ in L = λW, in orders a second.
      const rate = sim.jobs.length / 60;
      const W = time / ended / 1000;
      expect(L / (rate * W)).toBeCloseTo(1, 1);
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

  test('the records catch an order marked done that never printed, which the totals, the audit and the tallies all miss', () => {
    const sim = createSim({ seed: 1, load: 'rush' });
    runUntil(sim, 3_000);
    expect(ledger(sim)).toEqual({ done: sim.doneCount, lost: 0 });
    const job = jobOf(sim, sim.ready.shift() as number);
    job.place = 'done';
    sim.doneCount += 1;
    expect([invariant(sim), audit(sim)]).toEqual([null, null]);
    expect(properties(sim).every((p) => p.held)).toBe(true);
    expect(ledger(sim)).toEqual({ done: sim.doneCount - 1, lost: 1 });
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

/** A run's whole state, to compare two runs: events, orders, workers, connections, words, history. */
const shape = (s: Sim) =>
  JSON.stringify([
    s.events,
    s.jobs,
    s.workers,
    s.connections.map((c) => ({ ...c, unacked: [...c.unacked] })),
    s.lines,
    s.samples,
    s.tallies,
  ]);

test('determinism: the same seed and actions give the same run, event for event', () => {
  const a = everyAction();
  const b = everyAction();
  const again = replay({ seed: 42, load: 'busy', prefetch: 2 }, a.actions, 8_000);
  expect(a.violation).toBeNull();
  expect(new Set(a.actions.map((x) => x.kind)).size).toBe(12);
  expect(shape(b)).toBe(shape(a));
  expect(shape(again)).toBe(shape(a));
});

test('determinism: an action taken between two events of one millisecond lands at its end, where replay puts it', () => {
  // Driven event by event, as a Step button, or a frame's budget of events, drives a run. An
  // action records only its time, so it must not land where replay, which runs to that time
  // before it acts, cannot put it: before another event of the same millisecond, or before the
  // history strip's sample of it.
  for (let seed = 1; seed <= 10; seed++) {
    const config: Config = { seed, load: 'busy', prefetch: 2 };
    const sim = createSim(config);
    runUntil(sim, 1_000);
    // Another event is still due in the millisecond the run stands at.
    stepUntil(sim, (s) => nextTime(s) === s.now);
    crash(sim, 1);
    // The run stands at a multiple of 250 ms whose sample is not yet taken.
    stepUntil(sim, (s) => s.nextSample === s.now);
    poison(sim);
    const until = sim.now + 3_000;
    runUntil(sim, until);
    expect(shape(replay(config, sim.actions, until))).toBe(shape(sim));
  }
  // Two actions in one millisecond: seed 19's new load draws its first arrival for that same
  // millisecond, and the crash after it comes after that arrival, as in replay.
  const config: Config = { seed: 19, load: 'calm' };
  const sim = createSim(config);
  runUntil(sim, 1_000);
  setLoad(sim, 'rush');
  expect(nextTime(sim)).toBe(1_000);
  crash(sim, 0);
  runUntil(sim, 4_000);
  expect(shape(replay(config, sim.actions, 4_000))).toBe(shape(sim));
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
    const switched = openingRun();
    setAck(switched, 'before');
    crash(switched, 0);
    const runs = [everyAction(), openingRun(), createSim({ seed: 1 }), switched];
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
    'No order was lost, but 1 order was printed twice. Whether the queue drains is checked once orders stop.',
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

/** The producer runs for 20 s; then the queue has 30 s to drain. */
const PRODUCING = 20_000;

/**
 * A seeded run with faults, from the safe configuration unless `over` changes it: a random load,
 * 3 to 5 workers and a prefetch of 1 to 10, then for 50 s an action every 150 to 1,500 ms: a crash
 * (and a restart 0.2 to 2 s later), a slow spell of 0.5 to 3.5 s, a new prefetch or, while the
 * producer runs, a new pool size. At 20 s the producer stops and the pool grows to five, and the
 * faults go on: the next 30 s test whether the queue drains through crashes and slow spells.
 *
 * Whether a queue drains depends on capacity, not on the ack or the key. Stopped with the pool it
 * had, the queue misses the 30 s in 53 of these 2,000 seeds, every one a rush (a slow worker
 * hoarding a full window is about 30 s of work on its own; counted 2026-10-31). So the drain gets
 * five workers, as an operator would scale up for it. A rush on three workers leaves about 200
 * orders, which five drain in about 15 s, or 24 s at worst here.
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
  for (let t = gap(); t < PRODUCING + DRAIN_WITHIN; t += gap()) {
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
      if (t < PRODUCING) plan.push({ at: t, act: () => setWorkers(sim, n) });
    }
  }
  plan.push({
    at: PRODUCING,
    act: () => {
      stopProducer(sim);
      setWorkers(sim, MAX_WORKERS);
    },
  });
  plan.sort((a, b) => a.at - b.at);
  for (const { at, act } of plan) {
    if (sim.violation) break;
    runUntil(sim, at);
    act();
  }
  runUntil(sim, PRODUCING + DRAIN_WITHIN);
  // Every worker down at once pauses the drain, whose 30 s start again when one is back.
  if (sim.drain.since !== null) runUntil(sim, sim.drain.since + DRAIN_WITHIN);
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
      const books = ledger(sim);
      if (books.done !== sim.doneCount || books.lost !== sim.lostCount)
        broken.push(`seed ${seed}: the records hold ${books.done} done and ${books.lost} lost`);
      if (live(sim) > 0) broken.push(`seed ${seed}: ${live(sim)} orders never drained`);
    }
    expect(broken).toEqual([]);
    // The sweep did real work: crashes that sent orders again, and second tickets the key stopped.
    expect(events).toBeGreaterThan(SEEDS * 500);
    expect(crashes).toBeGreaterThan(SEEDS * 8);
    expect(redelivered).toBeGreaterThan(SEEDS * 20);
    expect(skipped).toBeGreaterThan(SEEDS / 2);
    // And no queue came within 3 s of the limit: the drain tests the queue, not the margin.
    expect(slowestDrain).toBeLessThan(DRAIN_WITHIN - 3_000);
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
        expect(ledger(sim)).toEqual({ done: sim.doneCount, lost: sim.lostCount });
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
        // A loss is seen in the records too, not only where the fault itself calls lose().
        expect(ledger(sim)).toEqual({ done: sim.doneCount, lost: sim.lostCount });
        if (!property(sim, id).held) caught += 1;
      }
      expect(caught).toBeGreaterThan(KNOWN / 5);
    },
  );

  // effectBeforeCheck records the key as the ack leaves, so a crash before the record is a crash
  // before the ack, which prints twice with no key at all. Workers here only crash or stop, so no
  // second delivery of an order runs while the first is still at work, and the fault is the key
  // turned off by another name. The race it stands for needs a redelivery that overtakes a worker
  // that is only slow (a delivery timeout), which this model does not have.
  test('a worker that records the key in a second step catches what turning the key off does, in the same seeds, and no more', () => {
    for (let seed = 1; seed <= KNOWN; seed++) {
      const split = faultyRun(seed, { faults: { effectBeforeCheck: true } });
      const off = faultyRun(seed, { key: false });
      expect(split.skipped).toBe(0);
      expect(split.tallies).toEqual(off.tallies);
    }
  });
});

// The page (components/queue-lab): what it says and draws of a run, from lib/queue/view.ts.
describe('the page', () => {
  test('the note under Load says how many workers are up and what they print: two at the opening, below a busy hour', () => {
    const sim = openingRun();
    expect(capacityWords(sim)).toBe('Two workers are up and print about 6.5.');
    restart(sim, 1);
    expect(capacityWords(sim)).toBe('Three workers are up and print about 9.7.');
    // A slow worker prints a tenth as many, and the picture says which one is slow.
    slow(sim, 0, true);
    expect(capacityWords(sim)).toBe('Three workers are up and print about 6.8.');
    slow(sim, 1, true);
    slow(sim, 2, true);
    expect(capacityWords(sim)).toBe('Three workers are up and print about 1.0.');
    crash(sim, 0);
    crash(sim, 1);
    expect(capacityWords(sim)).toBe('One worker is up and prints about 0.3.');
    crash(sim, 2);
    expect(capacityWords(sim)).toBe('No worker is up, so no order is printed.');
  });

  test('Start over replays the opening with the visitor’s settings: with the key on, order 18 is printed once', () => {
    const sim = openingRun();
    runUntil(sim, 9_000);
    crash(sim, 0);
    setKey(sim, true);
    const again = startOver(sim);
    // The same seed, the same crash of worker 2 at 2.4 s, and the key on from the start; the
    // crash at 9 s belonged to the old run.
    expect([again.seed, again.now, again.key]).toEqual([28, OPENING.until, true]);
    expect(again.workers.slice(0, 3).map((w) => w.state)).toEqual(['up', 'down', 'up']);
    expect(jobOf(again, 18).effects).toEqual([{ at: 2_371, worker: 1 }]);
    expect(jobOf(again, 18).delivered).toEqual([2_265, 2_450]);
    expect([again.duplicates, again.skipped, again.lostCount]).toEqual([0, 1, 0]);
    expect(summary(again)).toBe(
      'Order 18 was sent twice and printed once: worker 2 crashed after printing its ticket and before its ack left, so the broker sent it again, and worker 1 found it in the done set and skipped the ticket. Nothing was lost; 25 orders are done and 13 are queued or with a worker.',
    );
    expect(statusText(again)).toBe(
      'No order was lost and no order was printed twice over 143 events. Whether the queue drains is checked once orders stop.',
    );
    // A link to a run opens the same opening on its own seed.
    const eight = openLink('#seed-8');
    expect([eight?.seed, eight?.now]).toEqual([8, OPENING.until]);
  });

  test('a link to a run: Start over’s names the seed and each setting the visitor changed, and opens the run Start over did', () => {
    // Each setting the link names opens as the opening's run has it, and takes the page's values.
    const opening = openingRun();
    for (const [name, setting] of Object.entries(SETTINGS))
      expect(opening[name as keyof typeof SETTINGS], name).toBe(setting.opening);
    expect(SETTINGS.load.values).toEqual(Object.keys(LOADS));
    expect(SETTINGS.prefetch.values).toEqual(PREFETCHES);
    // A link that names no setting is the build's picture for its seed.
    expect(linkTo(opening)).toBe('#seed-28');
    expect(shape(openLink('#seed-28') as Sim)).toBe(shape(opening));

    const sim = openingRun();
    runUntil(sim, 6_000);
    setKey(sim, true);
    setPoisonHandling(sim, 'dead-letter');
    setPrefetch(sim, 5);
    setLoad(sim, 'rush');
    poison(sim);
    const again = startOver(sim);
    expect(linkTo(again)).toBe('#seed-28&load=rush&prefetch=5&key=on&handling=dead-letter');
    // Opened, the link gives the run Start over gave, event for event, and the same link again.
    const linked = openLink(linkTo(again)) as Sim;
    expect(shape(linked)).toBe(shape(again));
    expect(linkTo(linked)).toBe(linkTo(again));
    expect([linked.now, linked.actions]).toEqual([OPENING.until, OPENING.actions]);

    // Every value the page offers reads back as written.
    for (const load of SETTINGS.load.values)
      for (const prefetch of SETTINGS.prefetch.values)
        for (const ack of SETTINGS.ack.values)
          for (const key of SETTINGS.key.values)
            for (const handling of SETTINGS.handling.values) {
              const run = openLink(
                linkTo({ ...opening, seed: 3, load, prefetch, ack, key, handling }),
              );
              expect([
                run?.seed,
                run?.load,
                run?.prefetch,
                run?.ack,
                run?.key,
                run?.handling,
              ]).toEqual([3, load, prefetch, ack, key, handling]);
            }
  });

  test('a link’s unknown names and values the lab cannot take are dropped: the run keeps the opening’s', () => {
    const odd = openLink('#seed-28&load=storm&prefetch=3&ack=never&key=yes&workers=5&colour=red');
    expect(odd && shape(odd)).toBe(shape(openingRun()));
    const some = openLink('#seed-9&ack=before&prefetch=4&handling=dead-letter');
    expect([some?.seed, some?.ack, some?.prefetch, some?.handling]).toEqual([
      9,
      'before',
      1,
      'dead-letter',
    ]);
    for (const hash of ['', '#main', '#seed-', '#seed-1234567']) expect(openLink(hash)).toBeNull();
  });

  test('the caption tells the latest break: acknowledging first, a crash loses order 26 after order 18 printed twice', () => {
    const sim = openingRun();
    setAck(sim, 'before');
    crash(sim, 0);
    expect(summary(sim)).toBe(
      'Order 26 was lost: worker 1 crashed holding it, and it was acknowledged at the switch, before its ticket printed. 1 order was lost; 25 orders are done and 12 are queued or with a worker.',
    );
    expect(statusText(sim)).toBe(
      '1 order was lost and 1 order was printed twice. Whether the queue drains is checked once orders stop.',
    );
    expect(properties(sim).map((p) => propertyWords(sim, p))).toEqual([
      'Broken: 1 order lost',
      'Broken: 1 order printed twice',
      'Holds; checked once orders stop',
    ]);
  });

  test('while a poison order fails under requeue, the caption tells it, and no line claims the queue drains until that is known', () => {
    const sim = openingRun();
    poison(sim);
    runUntil(sim, 6_000);
    expect(summary(sim)).toMatch(
      /^Poison order 39 has failed \d+ times?: each time it comes straight back to the head of the queue and keeps a worker busy\. Nothing was lost;/,
    );
    expect(statusText(sim)).toBe(
      'No order was lost, but 1 order was printed twice. Whether the queue drains is checked once orders stop.',
    );
    stopProducer(sim);
    const deadline = (sim.drain.since as number) + DRAIN_WITHIN;
    expect(statusText(sim)).toBe(
      `No order was lost, but 1 order was printed twice. Whether the queue drains is checked at ${(deadline / 1000).toFixed(1)} s.`,
    );
    expect(propertyWords(sim, property(sim, 'drains'))).toBe(
      `Holds; checked at ${(deadline / 1000).toFixed(1)} s`,
    );
    runUntil(sim, deadline);
    expect(statusText(sim)).toBe(
      'No order was lost, but 1 order was printed twice and the queue did not drain within 30 s.',
    );
    // With every worker down, the 30 s start again when one is up.
    const down = openingRun();
    stopProducer(down);
    crash(down, 0);
    crash(down, 2);
    expect(propertyWords(down, property(down, 'drains'))).toBe(
      'Holds; checked 30 s after a worker is up',
    );
    // Once it has drained, it is claimed.
    const drained = openingRun();
    stopProducer(drained);
    runUntil(drained, 10_000);
    expect(statusText(drained)).toBe(
      'No order was lost and the queue drains, but 1 order was printed twice.',
    );
  });

  test('the strip: the orders waiting over the first 30 s, on a scale of 20, with worker 2’s crash at 2.4 s', () => {
    const sim = openingRun();
    const shown = strip(sim);
    expect([shown.from, shown.to, shown.peak, shown.most]).toEqual([0, 30_000, 11, 20]);
    expect(shown.crashes).toEqual([{ x: 24, at: 2_400, worker: 1 }]);
    expect(shown.points.split(' ')).toHaveLength(OPENING.until / 250 + 1);
    expect(stripWords(sim)).toBe(
      'Orders waiting from 0.0 s to 30.0 s: at most 11, 11 now. Worker 2 crashed at 2.400 s.',
    );
    expect(waitWords(sim)).toBe('11 waiting, the oldest for 1.0 s');
    // Past 30 s it keeps the last 30 s, and the crash leaves it.
    runUntil(sim, 40_000);
    const later = strip(sim);
    expect([later.from, later.to, later.crashes]).toEqual([10_000, 40_000, []]);
    expect(later.points.split(' ')).toHaveLength(121);
  });

  test('whether the queue drains is checked once orders stop, and a drain that fails is said, counted', () => {
    const sim = openingRun();
    expect(propertyWords(sim, property(sim, 'drains'))).toBe('Holds; checked once orders stop');
    poison(sim);
    stopProducer(sim);
    expect(propertyWords(sim, property(sim, 'drains'))).toBe('Holds; checked at 34.0 s');
    runUntil(sim, OPENING.until + DRAIN_WITHIN + 1_000);
    expect(propertyWords(sim, property(sim, 'drains'))).toBe(
      'Broken: not empty 30 s after orders stopped',
    );
  });

  test('the picture of the opening: worker 2 hollow and down, orders 1 to 25 printed, order 18 twice, 11 waiting', () => {
    for (const layout of Object.values(LAYOUTS)) {
      const markup = mapMarkup(openingRun(), layout);
      const count = (pattern: RegExp) => markup.match(pattern)?.length ?? 0;
      expect(count(/class="qu-gap"/g), layout.name).toBe(1);
      expect(markup).toContain('Worker 2<tspan class="qu-state" dx="6">Down</tspan>');
      expect(count(/class="qu-ticket" data-state="printed"/g)).toBe(25);
      expect(markup.match(/class="qu-again" data-order="\d+"/g)).toEqual([
        'class="qu-again" data-order="18"',
      ]);
      // Each a hollow round lamp, as on the board: no order is a square (design-system.md, "Lamps:
      // one meaning per mark").
      expect(count(/<circle class="qu-order" data-state="ready"/g)).toBe(11);
      expect(markup).not.toContain('<rect class="qu-order"');
      expect(markup.match(/data-state="working" data-worker="\d" data-order="\d+"/g)).toEqual([
        'data-state="working" data-worker="0" data-order="26"',
        'data-state="working" data-worker="2" data-order="27"',
      ]);
      // Each row of tickets ends in the last order it shows: the third holds 21 to 25.
      if (layout.tickets.numbered)
        expect([...markup.matchAll(/qu-count"[^>]*>(\d+)</g)].map(([, n]) => n)).toEqual([
          '10',
          '20',
          '25',
        ]);
      // Classes and attributes only: the page's policy refuses inline styles.
      expect(markup).not.toMatch(/style=/);
    }
  });

  test('whatever a run draws, it draws inside the picture, with only the classes the opening draws', () => {
    // The stylesheet may style only classes a built page carries (test/css-classes.test.ts), and
    // the opening is the page as built: a lamp a later run lights must be one it already has.
    const runs: Sim[] = [];
    let sim = openingRun();
    setPoisonHandling(sim, 'dead-letter');
    poison(sim);
    stopProducer(sim);
    runUntil(sim, 6_300);
    runs.push(sim); // a poison order waiting out a backoff, and the producer stopped
    sim = openingRun();
    restart(sim, 1);
    setLoad(sim, 'rush');
    setPrefetch(sim, 10);
    slow(sim, 0, true);
    runUntil(sim, 30_000);
    runs.push(sim); // more than the tank holds, full windows, a slow worker
    sim = openingRun();
    setPoisonHandling(sim, 'dead-letter');
    for (let k = 0; k < 3; k++) poison(sim);
    stopProducer(sim);
    runUntil(sim, 20_000);
    runs.push(sim); // three dead letters on the siding
    sim = openingRun();
    setAck(sim, 'before');
    setPrefetch(sim, 5);
    setLoad(sim, 'rush');
    runUntil(sim, 6_000);
    crash(sim, 0);
    runs.push(sim); // lost orders, crossed
    sim = openingRun();
    setPrefetch(sim, 5);
    setLoad(sim, 'rush');
    runUntil(sim, 6_000);
    crash(sim, 0);
    runs.push(sim); // orders taken, not yet acknowledged, dropped by a crash
    const classes = (markup: string) =>
      new Set(
        [...markup.matchAll(/class="([^"]+)"/g)].flatMap(([, names = '']) => names.split(' ')),
      );
    const states = new Set<string>();
    for (const layout of Object.values(LAYOUTS)) {
      const opening = classes(mapMarkup(openingRun(), layout));
      for (const run of runs) {
        const markup = mapMarkup(run, layout);
        expect([...classes(markup)].filter((name) => !opening.has(name))).toEqual([]);
        for (const [, state = ''] of markup.matchAll(/data-state="([^"]+)"/g)) states.add(state);
        const across = [...markup.matchAll(/ (?:cx|x)="([\d.-]+)"/g)].map(([, x]) => Number(x));
        const down = [...markup.matchAll(/ (?:cy|y)="([\d.-]+)"/g)].map(([, y]) => Number(y));
        for (const [, points = ''] of markup.matchAll(/points="([^"]+)"/g))
          for (const point of points.split(' ')) {
            const [x, y] = point.split(',').map(Number);
            across.push(x as number);
            down.push(y as number);
          }
        expect(
          across.every((x) => x >= 0 && x <= layout.width),
          layout.name,
        ).toBe(true);
        expect(
          down.every((y) => y >= 0 && y <= layout.height),
          layout.name,
        ).toBe(true);
      }
      expect(mapMarkup(runs[1] as Sim, layout)).toMatch(/>\d+ waiting</);
      expect(mapMarkup(runs[1] as Sim, layout)).toContain('>Slow</tspan>');
    }
    expect([...states].sort()).toEqual([
      'dead',
      'lost',
      'printed',
      'ready',
      'retry',
      'room',
      'taken',
      'waiting',
      'working',
    ]);
  });

  test('an order waiting out a backoff is the clock lamp: its lamp and its hands, one path', () => {
    const sim = openingRun();
    setPoisonHandling(sim, 'dead-letter');
    poison(sim);
    stopProducer(sim);
    runUntil(sim, 6_300);
    for (const layout of Object.values(LAYOUTS)) {
      const retry = /<path class="qu-order" data-state="retry"[^>]* d="([^"]+)"/.exec(
        mapMarkup(sim, layout),
      );
      // The poison order's diamond, closed, then the hands: up to twelve and across to three.
      expect(retry?.[1], layout.name).toMatch(/ZM[\d.]+ [\d.]+V[\d.]+h[\d.]+$/);
    }
  });
});
