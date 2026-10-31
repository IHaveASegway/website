import { createAgenda, next, schedule, type Agenda, type Entry } from '../sim/agenda';
import { between, exponential, lognormal, seeded, type Random } from '../sim/random';
import { audit, invariant, type PropertyId, type Violation } from './check';

// A deterministic simulation of a work queue: a broker, the workers behind it, and the online
// orders of the bakery the Route Lab already serves. It follows the AMQP 0-9-1 model of a queue
// with manual acknowledgements: the broker pushes each ready order to a worker with room in its
// prefetch window, keeps every delivery it has not seen acknowledged, and puts those back at the
// head of the queue when the worker's connection closes. Time is virtual, in milliseconds; every
// random choice comes from one seeded stream (lib/sim/random.ts); events run in order of time and
// then of scheduling (lib/sim/agenda.ts). The same seed and the same recorded actions give the same
// run, event for event, in a test, at build and in the browser, as in the Raft Lab (ADR 0020).
//
// The lesson is the one Brandur Leach's "Implementing Stripe-like Idempotency Keys in Postgres"
// (2017) starts from: a broker delivers at least once, so whether a crash loses an order, prints
// it twice, or neither, is decided by when a worker acknowledges and whether its effect is
// idempotent. Unlike the Raft Lab, a broken property does not stop the run: a weak configuration
// breaking one is the lesson, so check.ts counts each break. Only conservation stops it, because
// an order that appears or disappears is a bug in this file.

/** Orders a second for each load the visitor can pick. Three workers print about 10 a second, so
 *  `busy` runs near capacity and `rush` above it, where the backlog keeps rising and every order
 *  waits longer: Little's Law (John D. C. Little, 1961), L = λW. */
export const LOADS = { calm: 5, busy: 9, rush: 14 } as const;
export type Load = keyof typeof LOADS;

/** When a worker's order is acknowledged: after its ticket prints (at-least-once), or as the
 *  broker delivers it, before the work (at-most-once, AMQP's automatic mode). A real broker
 *  ignores the prefetch window in automatic mode and sends without limit; here the worker returns
 *  its slot with a credit when it finishes, so a window holds the same number under both. A switch
 *  to `before` applies to the orders already sent as well (setAck), and a switch back to `after`
 *  from the next delivery: an acknowledgement cannot be taken back. */
export type Ack = 'after' | 'before';

/** What a failing order gets: straight back to the head of the queue, or retries with a backoff
 *  and then the dead-letter queue. */
export type Handling = 'requeue' | 'dead-letter';

export const MAX_WORKERS = 5;
export const MAX_PREFETCH = 10;

/** How long a worker's handler runs, in virtual ms: log-normal, so most orders take near the
 *  median and a few take several times longer. Its mean is 280 × e^(0.45² / 2), about 310 ms, so
 *  one worker prints about 3.2 orders a second and three about 9.7. */
export const SERVICE = { median: 280, spread: 0.45 } as const;

/** How many times longer a slow worker takes. */
export const SLOWDOWN = 10;

/** One-way latency between the broker and a worker, in virtual ms. */
export const LATENCY = [2, 6] as const;

/** The end of a handler, after its ticket prints: the worker logs the order and returns, and only
 *  then does its acknowledgement leave. A crash in this gap is the one that prints an order twice.
 *  Real handlers often keep it under a millisecond, but never at zero, and a consumer that
 *  acknowledges in batches stretches it to seconds. It is part of the service time above. */
export const WRAP_UP = [10, 40] as const;

/** Under dead-letter handling, a failing order waits this long before each retry, in a delay
 *  queue at the broker; when the last retry fails too, it goes to the dead-letter queue: four
 *  tries in all. */
export const BACKOFF = [200, 400, 800] as const;

/** How long the queue has to drain once the producer stops: the `drains` property. */
export const DRAIN_WITHIN = 30_000;

/** The history strip's interval, and how many samples it keeps: the last two minutes. */
export const SAMPLE_EVERY = 250;
const SAMPLES = 480;
const LINES = 200;

/**
 * Deliberately broken behaviours, for the tests only: each is a known bug the property sweep must
 * find (test/queue.test.ts). The page never sets any.
 * - `forgetRequeue`: when a crashed worker's connection closes, the broker drops the orders it
 *   still held for it instead of putting them back, so `no-loss` breaks under `after`. It counts
 *   each drop through lose(), as any loss must be counted: a drop that skipped it would break
 *   conservation and freeze the run. The sweep also finds the losses in the records alone.
 * - `effectBeforeCheck`: the idempotency key is checked and the ticket printed in one step, and
 *   the key recorded in another, when the handler returns. A crash between the two leaves a
 *   ticket with no record of it, so the redelivery prints it again: `once` breaks with the key on.
 *   In this model that is the key turned off by another name: the record lands as the ack
 *   leaves, and a crash before the ack prints twice with no key too. The race in Leach's post,
 *   two deliveries of one order checking the key at once, needs a redelivery that overtakes a
 *   worker that is only slow (a delivery timeout), which this broker does not have.
 * - `ackBeforeEffect`: under `after`, the worker acknowledges as it starts an order, before its
 *   ticket, so a crash during the work loses the order: `no-loss` breaks.
 */
export interface Faults {
  readonly forgetRequeue?: boolean;
  readonly effectBeforeCheck?: boolean;
  readonly ackBeforeEffect?: boolean;
}

export interface Config {
  readonly seed: number;
  readonly load?: Load;
  readonly workers?: number;
  readonly prefetch?: number;
  readonly ack?: Ack;
  /** The idempotency key: a worker records each order in a durable done set in the same atomic
   *  step as its ticket, and skips the ticket when the order is already there. */
  readonly key?: boolean;
  readonly handling?: Handling;
  readonly faults?: Faults;
}

/**
 * Where an order is. Every order is in exactly one place, and conservation (check.ts) counts each
 * place from its own store: the broker's queues, the wire, the windows, and the totals.
 * - `ready`: in the broker's queue.
 * - `retry`: waiting out a backoff in the broker's delay queue.
 * - `wire`: a delivery on its way to a worker.
 * - `window`: in a worker's prefetch window, waiting there or being worked on.
 * - `orphan`: dropped by a crashed worker, and still held by the broker, which puts it back once
 *   it sees the connection close.
 * - `reply`: the worker is finished with it, and its ack or nack is on the wire.
 * - `done`, `dead` (in the dead-letter queue) and `lost` (nobody holds it, and nobody will).
 */
export type Place =
  'ready' | 'retry' | 'wire' | 'window' | 'orphan' | 'reply' | 'done' | 'dead' | 'lost';

export interface Effect {
  readonly at: number;
  readonly worker: number;
}

export interface Job {
  readonly id: number;
  readonly published: number;
  /** A poison order fails on every try. */
  readonly poison: boolean;
  place: Place;
  /** The worker it was last sent to, or -1 before its first delivery. */
  worker: number;
  /** Counts its deliveries, so a delivery the broker has since taken back lands as nothing. */
  tag: number;
  /** The ack timing of its last delivery. */
  mode: Ack | null;
  /** Sent again after a crash or a failure, which the broker marks as AMQP's redelivered flag does. */
  redelivered: boolean;
  /** The broker will not put it back: its ack left, or the broker let it go on delivery. A crash
   *  that drops it now loses it. */
  ackSent: boolean;
  /** When the broker let go of it: its ack arrived, or (before) it was sent. */
  acked: number | null;
  failures: number;
  /** When each delivery of it reached a worker. */
  readonly delivered: number[];
  /** Each time its ticket printed, and by which worker: the effects ledger, by order. */
  readonly effects: Effect[];
  /** When it reached done, dead or lost. */
  ended: number | null;
}

export interface Worker {
  readonly id: number;
  /** Up, down after a crash until it restarts, or off: outside the pool. */
  state: 'up' | 'down' | 'off';
  /** Taken out of the pool while up: it takes no new orders, and goes off once it has finished
   *  the ones it holds. */
  leaving: boolean;
  slow: boolean;
  /** Its connection to the broker: a new one each time it starts. */
  conn: number;
  /** The orders it holds, in the order they arrived; while it works on one it is the first. */
  window: number[];
  /** The order in progress. Under `before` the worker stays busy through the wrap-up after the
   *  order is done and out of its window. */
  busy: number | null;
  started: number;
  /** The order in progress has been through its ticket step: printed, or skipped by the key. */
  ticketed: boolean;
  /** It already answered the broker for the order in progress (the `ackBeforeEffect` fault). */
  answered: boolean;
  /** Under `effectBeforeCheck`, the order whose ticket printed and whose key is not yet recorded. */
  unrecorded: number | null;
}

/** A worker's connection, as the broker keeps it. */
export interface Connection {
  readonly id: number;
  readonly worker: number;
  /** The broker counts it open until it sees the close, which comes after everything the worker
   *  sent before it, as on one TCP connection. */
  open: boolean;
  /** Deliveries the worker has not yet answered: its prefetch window, as the broker counts it. */
  outstanding: number;
  /** Deliveries the broker still holds, in the order it sent them: they go back on a close. */
  readonly unacked: Set<number>;
  /** Deliveries on the wire to it. */
  sending: number;
  /** When the last message each way arrives: a later one never overtakes it. */
  toWorker: number;
  toBroker: number;
}

export type Action =
  | { readonly at: number; readonly kind: 'crash' | 'restart'; readonly worker: number }
  | { readonly at: number; readonly kind: 'slow'; readonly worker: number; readonly on: boolean }
  | { readonly at: number; readonly kind: 'poison' | 'stop' | 'start' }
  | { readonly at: number; readonly kind: 'load'; readonly load: Load }
  | { readonly at: number; readonly kind: 'ack'; readonly ack: Ack }
  | { readonly at: number; readonly kind: 'key'; readonly on: boolean }
  | { readonly at: number; readonly kind: 'handling'; readonly handling: Handling }
  | { readonly at: number; readonly kind: 'prefetch' | 'workers'; readonly n: number };

export interface Line {
  readonly at: number;
  readonly text: string;
}

/** One point of the history strip. Its counts of orders add up to `published`. */
export interface Sample {
  readonly at: number;
  readonly published: number;
  readonly ready: number;
  readonly retrying: number;
  /** On the wire, in a window, dropped and awaiting requeue, or with its ack on the wire. */
  readonly inFlight: number;
  readonly done: number;
  readonly dead: number;
  readonly lost: number;
  /** Tickets printed beyond each order's first; not orders, so outside the sum. */
  readonly duplicates: number;
}

/** Each break of a property, counted, and the first one told. */
export interface Tally {
  count: number;
  first: { readonly at: number; readonly job: number; readonly detail: string } | null;
}

export interface Drain {
  /** Counts the waits, so the deadline of an earlier one is ignored. */
  wait: number;
  /** When the current wait for the queue to drain began, or null when none is running. */
  since: number | null;
  /** The current wait passed its deadline: counted once, and not again until it ends. */
  failed: boolean;
  /** How long the last wait that ended empty took. */
  last: number | null;
}

type Reply = 'ack' | 'nack' | 'credit';

type Event =
  | { readonly kind: 'arrival'; readonly gen: number }
  | { readonly kind: 'deliver'; readonly job: number; readonly tag: number; readonly conn: number }
  | {
      readonly kind: 'effect' | 'finish';
      readonly worker: number;
      readonly conn: number;
      readonly job: number;
    }
  | {
      readonly kind: 'reply';
      readonly conn: number;
      readonly job: number;
      readonly reply: Reply;
      readonly requeue: boolean;
    }
  | { readonly kind: 'closed'; readonly conn: number }
  | { readonly kind: 'retry'; readonly job: number }
  | { readonly kind: 'drain'; readonly wait: number };

export interface Sim {
  readonly seed: number;
  readonly faults: Faults;
  readonly random: Random;
  readonly agenda: Agenda<Event>;
  now: number;
  events: number;
  load: Load;
  producing: boolean;
  /** Counts the producer's schedules, so an arrival planned under an earlier one is ignored. */
  gen: number;
  ack: Ack;
  key: boolean;
  handling: Handling;
  prefetch: number;
  /** How many workers the pool holds: workers 0 to size - 1. */
  size: number;
  // The broker.
  readonly ready: number[];
  readonly retrying: Set<number>;
  readonly dead: number[];
  /** The connections it delivers to, in the order they subscribed, served round-robin. */
  readonly consumers: number[];
  turn: number;
  readonly connections: Connection[];
  readonly workers: Worker[];
  // Where the other orders are, each in its own store.
  readonly wire: Set<number>;
  readonly orphans: Set<number>;
  readonly replies: Set<number>;
  doneCount: number;
  lostCount: number;
  /** Every order published, by id - 1. */
  readonly jobs: Job[];
  /** The durable done set the idempotency key writes. */
  readonly doneSet: Set<number>;
  /** Tickets printed beyond each order's first, and tickets the key stopped. The `once` tally
   *  counts orders instead: an order printed three times is one break and two duplicates. */
  duplicates: number;
  skipped: number;
  readonly tallies: Record<PropertyId, Tally>;
  readonly drain: Drain;
  readonly samples: Sample[];
  nextSample: number;
  readonly lines: Line[];
  readonly actions: Action[];
  violation: Violation | null;
}

const clampTo = (n: number, low: number, high: number) =>
  Math.max(low, Math.min(high, Math.round(n)));

export const jobOf = (sim: Sim, id: number): Job => sim.jobs[id - 1] as Job;

export function createSim(config: Config): Sim {
  const sim: Sim = {
    seed: config.seed,
    faults: config.faults ?? {},
    random: seeded(config.seed),
    agenda: createAgenda<Event>(),
    now: 0,
    events: 0,
    load: config.load ?? 'calm',
    producing: true,
    gen: 0,
    ack: config.ack ?? 'after',
    key: config.key ?? false,
    handling: config.handling ?? 'requeue',
    prefetch: clampTo(config.prefetch ?? 1, 1, MAX_PREFETCH),
    size: clampTo(config.workers ?? 3, 1, MAX_WORKERS),
    ready: [],
    retrying: new Set(),
    dead: [],
    consumers: [],
    turn: 0,
    connections: [],
    workers: Array.from({ length: MAX_WORKERS }, (_, id) => ({
      id,
      state: 'off' as const,
      leaving: false,
      slow: false,
      conn: -1,
      window: [],
      busy: null,
      started: 0,
      ticketed: false,
      answered: false,
      unrecorded: null,
    })),
    wire: new Set(),
    orphans: new Set(),
    replies: new Set(),
    doneCount: 0,
    lostCount: 0,
    jobs: [],
    doneSet: new Set(),
    duplicates: 0,
    skipped: 0,
    tallies: {
      'no-loss': { count: 0, first: null },
      once: { count: 0, first: null },
      drains: { count: 0, first: null },
    },
    drain: { wait: 0, since: null, failed: false, last: null },
    samples: [],
    nextSample: 0,
    lines: [],
    actions: [],
    violation: null,
  };
  for (const w of sim.workers) if (w.id < sim.size) startWorker(sim, w);
  planArrival(sim);
  return sim;
}

const workerName = (k: number) => `worker ${k + 1}`;
const WorkerName = (k: number) => `Worker ${k + 1}`;

/** Order numbers in words: "order 3", "orders 3 and 5", "orders 3, 5, 8 and 2 more". */
export function ordersText(ids: readonly number[]): string {
  if (ids.length === 1) return `order ${ids[0]}`;
  if (ids.length <= 4) return `orders ${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}`;
  return `orders ${ids.slice(0, 3).join(', ')} and ${ids.length - 3} more`;
}

function say(sim: Sim, text: string): void {
  sim.lines.push({ at: sim.now, text });
  if (sim.lines.length > LINES) sim.lines.splice(0, sim.lines.length - LINES);
}

function tally(sim: Sim, property: PropertyId, job: number, detail: string): void {
  const t = sim.tallies[property];
  t.count += 1;
  t.first ??= { at: sim.now, job, detail };
}

const latency = (sim: Sim) => between(sim.random, LATENCY[0], LATENCY[1]);

/** Orders still in the system: queued, waiting to retry, or in flight. */
export function live(sim: Sim): number {
  let n = sim.ready.length + sim.retrying.size + sim.wire.size + sim.orphans.size;
  n += sim.replies.size;
  for (const w of sim.workers) n += w.window.length;
  return n;
}

function complete(sim: Sim, job: Job): void {
  job.place = 'done';
  job.ended = sim.now;
  sim.doneCount += 1;
}

/** The order is gone: the caller has already taken it out of the place it was in. */
function lose(sim: Sim, job: Job, cause: string): void {
  job.place = 'lost';
  job.ended = sim.now;
  sim.lostCount += 1;
  tally(sim, 'no-loss', job.id, `order ${job.id} was lost: ${cause}`);
}

function planArrival(sim: Sim): void {
  const gap = Math.round(exponential(sim.random, LOADS[sim.load]));
  schedule(sim.agenda, sim.now + gap, { kind: 'arrival', gen: sim.gen });
}

function publish(sim: Sim, poison: boolean): Job {
  const job: Job = {
    id: sim.jobs.length + 1,
    published: sim.now,
    poison,
    place: 'ready',
    worker: -1,
    tag: 0,
    mode: null,
    redelivered: false,
    ackSent: false,
    acked: null,
    failures: 0,
    delivered: [],
    effects: [],
    ended: null,
  };
  sim.jobs.push(job);
  sim.ready.push(job.id);
  return job;
}

function startWorker(sim: Sim, w: Worker): void {
  const conn: Connection = {
    id: sim.connections.length,
    worker: w.id,
    open: true,
    outstanding: 0,
    unacked: new Set(),
    sending: 0,
    toWorker: sim.now,
    toBroker: sim.now,
  };
  sim.connections.push(conn);
  w.state = 'up';
  w.leaving = false;
  w.conn = conn.id;
  w.window = [];
  w.busy = null;
  w.ticketed = false;
  w.answered = false;
  w.unrecorded = null;
  sim.consumers.push(conn.id);
  dispatch(sim);
}

function removeConsumer(sim: Sim, conn: number): void {
  const at = sim.consumers.indexOf(conn);
  if (at < 0) return;
  sim.consumers.splice(at, 1);
  if (at < sim.turn) sim.turn -= 1;
  if (sim.turn >= sim.consumers.length) sim.turn = 0;
}

/** The next consumer, round-robin, with a free slot in its window; null when every window is full. */
function nextConsumer(sim: Sim): Connection | null {
  const n = sim.consumers.length;
  for (let i = 0; i < n; i++) {
    const at = (sim.turn + i) % n;
    const conn = sim.connections[sim.consumers[at] as number] as Connection;
    if (conn.outstanding < sim.prefetch) {
      sim.turn = (at + 1) % n;
      return conn;
    }
  }
  return null;
}

/** The broker pushes ready orders, from the head of the queue, into every free window slot. */
function dispatch(sim: Sim): void {
  while (sim.ready.length > 0) {
    const conn = nextConsumer(sim);
    if (!conn) return;
    send(sim, conn, sim.ready.shift() as number);
  }
}

function send(sim: Sim, conn: Connection, id: number): void {
  const job = jobOf(sim, id);
  job.tag += 1;
  job.place = 'wire';
  job.worker = conn.worker;
  job.mode = sim.ack;
  sim.wire.add(id);
  conn.outstanding += 1;
  conn.sending += 1;
  if (sim.ack === 'before') {
    // Acknowledged on delivery, AMQP's automatic mode: the broker lets the order go as it sends.
    job.ackSent = true;
    job.acked = sim.now;
  } else {
    conn.unacked.add(id);
  }
  conn.toWorker = Math.max(sim.now + latency(sim), conn.toWorker);
  schedule(sim.agenda, conn.toWorker, { kind: 'deliver', job: id, tag: job.tag, conn: conn.id });
  if (job.redelivered && !job.poison)
    say(
      sim,
      `The broker sends order ${id} again, to ${workerName(conn.worker)}, marked redelivered`,
    );
}

/** A worker's answer to a delivery, on the wire to the broker: it frees the window slot. */
function answer(sim: Sim, w: Worker, job: number, reply: Reply, requeue = false): void {
  const conn = sim.connections[w.conn] as Connection;
  conn.toBroker = Math.max(sim.now + latency(sim), conn.toBroker);
  schedule(sim.agenda, conn.toBroker, { kind: 'reply', conn: conn.id, job, reply, requeue });
}

function takeOut(w: Worker, id: number): void {
  const at = w.window.indexOf(id);
  if (at >= 0) w.window.splice(at, 1);
}

/** The worker starts the first order in its window, if it is free to. */
function begin(sim: Sim, w: Worker): void {
  if (w.state !== 'up' || w.busy !== null || w.window.length === 0) return;
  const job = jobOf(sim, w.window[0] as number);
  const pace = w.slow ? SLOWDOWN : 1;
  const service = Math.max(
    2,
    Math.round(lognormal(sim.random, SERVICE.median, SERVICE.spread) * pace),
  );
  const wrapUp = Math.min(between(sim.random, WRAP_UP[0], WRAP_UP[1]) * pace, service - 1);
  w.busy = job.id;
  w.started = sim.now;
  w.ticketed = false;
  w.answered = false;
  if (sim.faults.ackBeforeEffect && !job.ackSent) {
    job.ackSent = true;
    w.answered = true;
    answer(sim, w, job.id, 'ack');
  }
  const at = { worker: w.id, conn: w.conn, job: job.id };
  if (!job.poison) schedule(sim.agenda, sim.now + service - wrapUp, { kind: 'effect', ...at });
  schedule(sim.agenda, sim.now + service, { kind: 'finish', ...at });
}

function print(sim: Sim, w: Worker, job: Job): void {
  job.effects.push({ at: sim.now, worker: w.id });
  const times = job.effects.length;
  if (times < 2) return;
  sim.duplicates += 1;
  const first = job.effects[0] as Effect;
  if (times === 2)
    tally(
      sim,
      'once',
      job.id,
      `order ${job.id} was printed by ${workerName(first.worker)} and again by ${workerName(w.id)}`,
    );
  say(
    sim,
    `${WorkerName(w.id)} prints order ${job.id}'s ticket again: order ${job.id} is printed ${times === 2 ? 'twice' : `${times} times`}`,
  );
}

/** The ticket: one effect per order, unless a crash made the broker send it again. */
function effect(sim: Sim, w: Worker, job: Job): void {
  w.ticketed = true;
  if (sim.key && sim.doneSet.has(job.id)) {
    sim.skipped += 1;
    say(
      sim,
      `${WorkerName(w.id)} finds order ${job.id} in the done set and does not print it again`,
    );
  } else {
    // With the key, the check, the ticket and the record are one atomic step (a transaction, in
    // Leach's post). The fault splits off the record, to the end of the handler.
    if (sim.key) {
      if (sim.faults.effectBeforeCheck) w.unrecorded = job.id;
      else sim.doneSet.add(job.id);
    }
    print(sim, w, job);
  }
  if (!job.ackSent) return;
  // The broker let it go already, so the ticket finishes the order: done, once the ack is in.
  takeOut(w, job.id);
  if (job.acked !== null) {
    complete(sim, job);
  } else {
    job.place = 'reply';
    sim.replies.add(job.id);
  }
}

/** The handler returns: the ack leaves (after), the failure is reported, or the slot is freed. */
function finish(sim: Sim, w: Worker, job: Job): void {
  w.busy = null;
  if (w.unrecorded !== null) {
    sim.doneSet.add(w.unrecorded);
    w.unrecorded = null;
  }
  if (job.poison) {
    takeOut(w, job.id);
    if (job.ackSent) {
      lose(sim, job, `it failed on ${workerName(w.id)} after its ack had left`);
      say(
        sim,
        `Order ${job.id} fails on ${workerName(w.id)} after its ack had left, so nobody holds it now: it is lost`,
      );
      if (!w.answered) answer(sim, w, job.id, 'credit');
    } else {
      job.place = 'reply';
      sim.replies.add(job.id);
      answer(sim, w, job.id, 'nack', sim.handling === 'requeue');
    }
  } else if (!job.ackSent) {
    takeOut(w, job.id);
    job.place = 'reply';
    sim.replies.add(job.id);
    job.ackSent = true;
    answer(sim, w, job.id, 'ack');
  } else if (!w.answered) {
    // Acknowledged on delivery: the broker counts the window slot taken until the worker says
    // it is free, the way a consumer that pulls asks for its next order.
    answer(sim, w, job.id, 'credit');
  }
  leaveIfDone(sim, w);
  begin(sim, w);
}

/** A worker leaving the pool goes off once it holds nothing and nothing is on its way to it. */
function leaveIfDone(sim: Sim, w: Worker): void {
  const conn = sim.connections[w.conn] as Connection;
  if (!w.leaving || w.busy !== null || w.window.length > 0 || conn.sending > 0) return;
  w.state = 'off';
  w.leaving = false;
  conn.toBroker = Math.max(sim.now + latency(sim), conn.toBroker);
  schedule(sim.agenda, conn.toBroker, { kind: 'closed', conn: conn.id });
  say(sim, `${WorkerName(w.id)} has finished its orders and leaves the pool`);
}

function land(sim: Sim, id: number, connId: number): void {
  const job = jobOf(sim, id);
  const conn = sim.connections[connId] as Connection;
  const w = sim.workers[conn.worker] as Worker;
  sim.wire.delete(id);
  conn.sending -= 1;
  if (w.state !== 'up' || w.conn !== conn.id) {
    // The worker crashed after the broker sent this, which the broker has not seen yet.
    if (job.ackSent) {
      lose(sim, job, `it reached ${workerName(w.id)} after the crash, acknowledged on delivery`);
      say(
        sim,
        `Order ${id} reaches ${workerName(w.id)} after the crash, and the broker let it go when it sent it: it is lost`,
      );
    } else {
      job.place = 'orphan';
      sim.orphans.add(id);
    }
    return;
  }
  job.place = 'window';
  job.delivered.push(sim.now);
  w.window.push(id);
  begin(sim, w);
}

/** A worker's answer reaches the broker. */
function received(sim: Sim, e: Extract<Event, { kind: 'reply' }>): void {
  const conn = sim.connections[e.conn] as Connection;
  const job = jobOf(sim, e.job);
  conn.outstanding -= 1;
  if (e.reply === 'ack') {
    conn.unacked.delete(job.id);
    job.acked = sim.now;
    if (job.place === 'reply') {
      sim.replies.delete(job.id);
      complete(sim, job);
    }
  } else if (e.reply === 'nack') {
    conn.unacked.delete(job.id);
    sim.replies.delete(job.id);
    job.failures += 1;
    job.redelivered = true;
    const failed = `Order ${job.id} fails on ${workerName(conn.worker)}, try ${job.failures}`;
    if (e.requeue) {
      job.place = 'ready';
      sim.ready.unshift(job.id);
      say(sim, `${failed}, and the broker puts it back at the head of the queue`);
    } else if (job.failures <= BACKOFF.length) {
      const wait = BACKOFF[job.failures - 1] as number;
      job.place = 'retry';
      sim.retrying.add(job.id);
      schedule(sim.agenda, sim.now + wait, { kind: 'retry', job: job.id });
      say(sim, `${failed}, and waits ${wait} ms before the next`);
    } else {
      job.place = 'dead';
      job.ended = sim.now;
      sim.dead.push(job.id);
      say(sim, `${failed}, and goes to the dead-letter queue`);
    }
  }
  dispatch(sim);
}

/** The broker sees a connection close: what it still held for that worker goes back to the head
 *  of the queue, in the order it was sent, marked redelivered. */
function closed(sim: Sim, connId: number): void {
  const conn = sim.connections[connId] as Connection;
  conn.open = false;
  removeConsumer(sim, conn.id);
  const back: number[] = [];
  const dropped: number[] = [];
  for (const id of conn.unacked) {
    const job = jobOf(sim, id);
    // A delivery still on the wire to the dead worker now lands as nothing.
    job.tag += 1;
    if (job.place === 'wire') {
      sim.wire.delete(id);
      conn.sending -= 1;
    } else {
      sim.orphans.delete(id);
    }
    if (sim.faults.forgetRequeue) {
      dropped.push(id);
      lose(sim, job, `the broker dropped it when ${workerName(conn.worker)}'s connection closed`);
    } else {
      back.push(id);
    }
  }
  conn.unacked.clear();
  conn.outstanding = 0;
  for (let i = back.length - 1; i >= 0; i--) {
    const job = jobOf(sim, back[i] as number);
    job.place = 'ready';
    job.redelivered = true;
    sim.ready.unshift(job.id);
  }
  const whose = `The broker sees ${workerName(conn.worker)}'s connection close`;
  if (back.length > 0)
    say(sim, `${whose} and puts ${ordersText(back)} back at the head of the queue`);
  if (dropped.length > 0)
    say(
      sim,
      `${whose} and drops ${ordersText(dropped)} instead of putting ${dropped.length === 1 ? 'it' : 'them'} back`,
    );
  dispatch(sim);
}

/** The queue must drain within 30 s of the producer stopping, while a worker is up to drain it. */
function watchDrain(sim: Sim): void {
  const d = sim.drain;
  const asked = !sim.producing && sim.workers.some((w) => w.state === 'up' && !w.leaving);
  if (!asked) {
    d.since = null;
    d.failed = false;
    return;
  }
  const left = live(sim);
  if (d.since === null) {
    if (left === 0) return;
    d.wait += 1;
    d.since = sim.now;
    d.failed = false;
    schedule(sim.agenda, sim.now + DRAIN_WITHIN, { kind: 'drain', wait: d.wait });
  } else if (left === 0) {
    const took = sim.now - d.since;
    say(
      sim,
      `Nothing is left in the queue or in flight: it drained in ${(took / 1000).toFixed(1)} s`,
    );
    d.last = took;
    d.since = null;
    d.failed = false;
  }
}

function drainDue(sim: Sim): void {
  sim.drain.failed = true;
  const left: number[] = [];
  for (const job of sim.jobs) if (job.ended === null) left.push(job.id);
  const stuck = left.find((id) => jobOf(sim, id).poison) ?? (left[0] as number);
  const n = left.length;
  const still = `${n} ${n === 1 ? 'order was' : 'orders were'} still queued or in flight`;
  tally(sim, 'drains', stuck, `${still} 30 s after the producer stopped`);
  say(sim, `30 s after the producer stopped, ${still}: the queue does not drain`);
}

/** An event is stale when what it was planned for has gone: the producer's schedule changed, the
 *  worker crashed, the broker took the delivery back, or the drain wait ended. Stale is for good,
 *  so dropping one never changes a run. */
function stale(sim: Sim, e: Event): boolean {
  switch (e.kind) {
    case 'arrival':
      return e.gen !== sim.gen;
    case 'deliver':
      return jobOf(sim, e.job).tag !== e.tag;
    case 'effect':
    case 'finish': {
      const w = sim.workers[e.worker] as Worker;
      return w.state !== 'up' || w.conn !== e.conn;
    }
    case 'drain':
      return e.wait !== sim.drain.wait || sim.drain.since === null || sim.drain.failed;
    default:
      return false;
  }
}

function handle(sim: Sim, e: Event): void {
  switch (e.kind) {
    case 'arrival':
      publish(sim, false);
      planArrival(sim);
      dispatch(sim);
      return;
    case 'deliver':
      return land(sim, e.job, e.conn);
    case 'effect':
      return effect(sim, sim.workers[e.worker] as Worker, jobOf(sim, e.job));
    case 'finish':
      return finish(sim, sim.workers[e.worker] as Worker, jobOf(sim, e.job));
    case 'reply':
      return received(sim, e);
    case 'closed':
      return closed(sim, e.conn);
    case 'retry': {
      const job = jobOf(sim, e.job);
      sim.retrying.delete(job.id);
      job.place = 'ready';
      sim.ready.push(job.id);
      return dispatch(sim);
    }
    case 'drain':
      return drainDue(sim);
  }
}

/** The history strip, up to `until`: a sample at a multiple of 250 ms holds the state after every
 *  event up to it. Each sample also audits every order (check.ts), which is too slow to do after
 *  every event of a long backlog. */
function sampleTo(sim: Sim, until: number, inclusive: boolean): void {
  if (!Number.isFinite(until)) return;
  while (!sim.violation && (sim.nextSample < until || (inclusive && sim.nextSample === until))) {
    let windows = 0;
    for (const w of sim.workers) windows += w.window.length;
    sim.samples.push({
      at: sim.nextSample,
      published: sim.jobs.length,
      ready: sim.ready.length,
      retrying: sim.retrying.size,
      inFlight: sim.wire.size + windows + sim.orphans.size + sim.replies.size,
      done: sim.doneCount,
      dead: sim.dead.length,
      lost: sim.lostCount,
      duplicates: sim.duplicates,
    });
    if (sim.samples.length > SAMPLES) sim.samples.splice(0, sim.samples.length - SAMPLES);
    sim.nextSample += SAMPLE_EVERY;
    sim.violation = audit(sim);
  }
}

/** After every event and action: the drain clock, then conservation. */
function settle(sim: Sim): void {
  watchDrain(sim);
  sim.violation ??= invariant(sim);
}

/** When the next event happens. Stale events at the top are dropped on the way. */
export function nextTime(sim: Sim): number {
  for (;;) {
    const top = sim.agenda.heap[0];
    if (!top) return Infinity;
    if (!stale(sim, top.event)) return top.at;
    next(sim.agenda);
  }
}

/** Processes the next event, if the run is not frozen. */
export function step(sim: Sim): boolean {
  if (sim.violation) return false;
  const at = nextTime(sim);
  if (!Number.isFinite(at)) return false;
  sampleTo(sim, at, false);
  if (sim.violation) return false;
  const entry = next(sim.agenda) as Entry<Event>;
  sim.now = Math.max(sim.now, entry.at);
  handle(sim, entry.event);
  sim.events += 1;
  settle(sim);
  return true;
}

/** Runs every event up to a virtual time, then stands at it. */
export function runUntil(sim: Sim, until: number, limit = Infinity): void {
  let left = limit;
  while (!sim.violation && left-- > 0 && nextTime(sim) <= until) step(sim);
  if (sim.violation || nextTime(sim) <= until) return;
  sim.now = Math.max(sim.now, until);
  sampleTo(sim, until, true);
}

/** Every action takes effect at the end of its millisecond, after the events still due in it and
 *  the history strip's samples up to it, before it even checks whether it applies. An action
 *  records only its time, and replay runs to that time before it acts, so this is the one place
 *  replay can put it. A run driven event by event (a Step button, a frame's budget of events)
 *  could otherwise act between two events of one millisecond, or before that millisecond's sample,
 *  and its replay would differ. Events in one millisecond happen at the same time, so an action
 *  that lands after them all still lands at the time it was taken. */
function catchUp(sim: Sim): void {
  runUntil(sim, sim.now);
}

function record(sim: Sim, action: Action): void {
  sim.actions.push(action);
}

/** Crashes worker k: it drops everything in its window. The broker hears of it only when the
 *  connection's close arrives, after everything the worker had already sent, so an ack on the
 *  wire still lands first. */
export function crash(sim: Sim, k: number): void {
  catchUp(sim);
  const w = sim.workers[k];
  if (!w || w.state !== 'up') return;
  record(sim, { at: sim.now, kind: 'crash', worker: k });
  const conn = sim.connections[w.conn] as Connection;
  const held = [...w.window];
  const kept: number[] = [];
  const gone: number[] = [];
  let printed: number | null = null;
  for (const id of held) {
    const job = jobOf(sim, id);
    if (job.ackSent) {
      gone.push(id);
      // Under `before` the broker let it go as it sent it, so before it arrived, or, for an order
      // the worker already held, at the switch to `before` (setAck).
      const sent = (job.acked ?? 0) < (job.delivered.at(-1) ?? Infinity);
      lose(
        sim,
        job,
        job.mode !== 'before'
          ? `${workerName(k)} crashed while working on it, after its ack had left`
          : sent
            ? `${workerName(k)} crashed holding it, and it was acknowledged on delivery`
            : `${workerName(k)} crashed holding it, and it was acknowledged at the switch, before its ticket printed`,
      );
    } else {
      job.place = 'orphan';
      sim.orphans.add(id);
      kept.push(id);
      const last = job.effects.at(-1);
      if (w.busy === id && last?.worker === k && last.at >= w.started) printed = id;
    }
  }
  w.window = [];
  w.busy = null;
  w.unrecorded = null;
  w.state = w.leaving ? 'off' : 'down';
  w.leaving = false;
  conn.toBroker = Math.max(sim.now + latency(sim), conn.toBroker);
  schedule(sim.agenda, conn.toBroker, { kind: 'closed', conn: conn.id });

  // One sentence for what the worker held, then one for each fate: named, unless it is all of them.
  const them = (ids: readonly number[]) =>
    ids.length === held.length ? (ids.length === 1 ? 'it' : 'them') : ordersText(ids);
  const pronoun = (ids: readonly number[]) => (ids.length === 1 ? 'it' : 'them');
  let text = `${WorkerName(k)} crashes ${held.length === 0 ? 'with an empty window' : `holding ${ordersText(held)}`}`;
  if (printed !== null)
    text += `, after ${held.length === 1 ? 'its' : `order ${printed}'s`} ticket printed and before its ack left`;
  if (kept.length > 0)
    text += `. The broker has no ack for ${them(kept)}, so it will send ${pronoun(kept)} again`;
  if (gone.length > 0)
    text += `. The broker had already let ${them(gone)} go, so ${gone.length === 1 ? 'it is' : 'they are'} lost`;
  say(sim, text);
  settle(sim);
}

/** Restarts a crashed worker, empty, on a new connection. */
export function restart(sim: Sim, k: number): void {
  catchUp(sim);
  const w = sim.workers[k];
  if (!w || w.state !== 'down') return;
  record(sim, { at: sim.now, kind: 'restart', worker: k });
  say(sim, `${WorkerName(k)} restarts with an empty window`);
  startWorker(sim, w);
  settle(sim);
}

/** Makes worker k ten times slower, or brings it back: it applies from the next order it starts. */
export function slow(sim: Sim, k: number, on: boolean): void {
  catchUp(sim);
  const w = sim.workers[k];
  if (!w || w.slow === on) return;
  record(sim, { at: sim.now, kind: 'slow', worker: k, on });
  w.slow = on;
  say(
    sim,
    on
      ? `${WorkerName(k)} slows down: each order now takes it ten times as long`
      : `${WorkerName(k)} is back to its usual speed`,
  );
  settle(sim);
}

/** Publishes one order that fails on every try. */
export function poison(sim: Sim): Job {
  catchUp(sim);
  record(sim, { at: sim.now, kind: 'poison' });
  const job = publish(sim, true);
  say(sim, `Order ${job.id} is published, and it is poison: it fails on every try`);
  dispatch(sim);
  settle(sim);
  return job;
}

export function setLoad(sim: Sim, load: Load): void {
  catchUp(sim);
  if (sim.load === load) return;
  record(sim, { at: sim.now, kind: 'load', load });
  sim.load = load;
  say(sim, `Orders now arrive at about ${LOADS[load]} a second (${load})`);
  // A Poisson process has no memory, so the next arrival can be drawn again from now.
  if (sim.producing) {
    sim.gen += 1;
    planArrival(sim);
  }
  settle(sim);
}

/**
 * When workers acknowledge. A switch to `before` applies at once to what the broker has already
 * sent: it lets go of every order on its way to a worker that is up or in its window, as if each
 * had been sent under `before`, so a crash right after the switch loses what the worker held. An
 * order whose ticket step has already run is done. A switch back to `after` applies from the next
 * delivery, since an acknowledgement cannot be taken back.
 */
export function setAck(sim: Sim, ack: Ack): void {
  catchUp(sim);
  if (sim.ack === ack) return;
  record(sim, { at: sim.now, kind: 'ack', ack });
  sim.ack = ack;
  if (ack === 'after') {
    say(
      sim,
      'From the next delivery, a worker acknowledges an order after its ticket prints: at-least-once',
    );
  } else {
    const gone = letGo(sim);
    const now = 'Orders are now acknowledged as they are delivered, before the work: at-most-once';
    say(
      sim,
      gone.length === 0
        ? now
        : `${now}. The broker lets go at once of what it has already sent: ${ordersText(gone)}`,
    );
  }
  settle(sim);
}

/** The switch to `before`: the broker lets go of each order it has sent to a worker that is up
 *  and not yet seen answered, worker by worker, in the order it sent them. An ack or a nack on
 *  its way settles an order its own way, so those are left to it. */
function letGo(sim: Sim): number[] {
  const gone: number[] = [];
  for (const w of sim.workers) {
    if (w.state !== 'up') continue;
    const conn = sim.connections[w.conn] as Connection;
    for (const id of [...conn.unacked]) {
      const job = jobOf(sim, id);
      if (job.ackSent || job.place === 'reply') continue;
      conn.unacked.delete(id);
      job.ackSent = true;
      job.acked = sim.now;
      job.mode = 'before';
      gone.push(id);
      // Past its ticket step it is finished, as effect() finishes an order under `before`; the
      // worker stays busy through the wrap-up, and its credit frees the slot.
      if (w.busy === id && w.ticketed) {
        takeOut(w, id);
        complete(sim, job);
      }
    }
  }
  return gone;
}

export function setKey(sim: Sim, on: boolean): void {
  catchUp(sim);
  if (sim.key === on) return;
  record(sim, { at: sim.now, kind: 'key', on });
  sim.key = on;
  say(
    sim,
    on
      ? 'The idempotency key is on: a worker records each order in the done set in the same step as its ticket'
      : 'The idempotency key is off: a worker prints whatever it is given',
  );
  settle(sim);
}

export function setPoisonHandling(sim: Sim, handling: Handling): void {
  catchUp(sim);
  if (sim.handling === handling) return;
  record(sim, { at: sim.now, kind: 'handling', handling });
  sim.handling = handling;
  say(
    sim,
    handling === 'requeue'
      ? 'A failing order now goes straight back to the head of the queue'
      : 'A failing order now waits 200, 400 and 800 ms between tries, then goes to the dead-letter queue',
  );
  settle(sim);
}

export function setPrefetch(sim: Sim, n: number): void {
  catchUp(sim);
  const prefetch = clampTo(n, 1, MAX_PREFETCH);
  if (sim.prefetch === prefetch) return;
  record(sim, { at: sim.now, kind: 'prefetch', n: prefetch });
  sim.prefetch = prefetch;
  say(
    sim,
    `Prefetch is now ${prefetch}: each worker holds up to ${prefetch} ${prefetch === 1 ? 'order' : 'orders'}`,
  );
  dispatch(sim);
  settle(sim);
}

/** Sets the pool's size. A worker added starts empty; a worker taken out finishes what it holds,
 *  then leaves, so scaling down loses nothing. */
export function setWorkers(sim: Sim, n: number): void {
  catchUp(sim);
  const size = clampTo(n, 1, MAX_WORKERS);
  if (sim.size === size) return;
  record(sim, { at: sim.now, kind: 'workers', n: size });
  sim.size = size;
  say(sim, `The pool now holds ${size} ${size === 1 ? 'worker' : 'workers'}`);
  for (const w of sim.workers) {
    if (w.id < size) {
      if (w.state === 'off') {
        startWorker(sim, w);
      } else if (w.leaving) {
        w.leaving = false;
        sim.consumers.push(w.conn);
      }
    } else if (w.state === 'down') {
      w.state = 'off';
    } else if (w.state === 'up' && !w.leaving) {
      w.leaving = true;
      removeConsumer(sim, w.conn);
      leaveIfDone(sim, w);
    }
  }
  dispatch(sim);
  settle(sim);
}

export function stopProducer(sim: Sim): void {
  catchUp(sim);
  if (!sim.producing) return;
  record(sim, { at: sim.now, kind: 'stop' });
  sim.producing = false;
  sim.gen += 1;
  say(sim, 'The producer stops: no new orders arrive');
  settle(sim);
}

export function startProducer(sim: Sim): void {
  catchUp(sim);
  if (sim.producing) return;
  record(sim, { at: sim.now, kind: 'start' });
  sim.producing = true;
  sim.gen += 1;
  planArrival(sim);
  say(sim, `The producer starts again, at about ${LOADS[sim.load]} orders a second`);
  settle(sim);
}

function apply(sim: Sim, action: Action): void {
  switch (action.kind) {
    case 'crash':
      return crash(sim, action.worker);
    case 'restart':
      return restart(sim, action.worker);
    case 'slow':
      return slow(sim, action.worker, action.on);
    case 'poison':
      poison(sim);
      return;
    case 'stop':
      return stopProducer(sim);
    case 'start':
      return startProducer(sim);
    case 'load':
      return setLoad(sim, action.load);
    case 'ack':
      return setAck(sim, action.ack);
    case 'key':
      return setKey(sim, action.on);
    case 'handling':
      return setPoisonHandling(sim, action.handling);
    case 'prefetch':
      return setPrefetch(sim, action.n);
    case 'workers':
      return setWorkers(sim, action.n);
  }
}

/** Replays recorded actions on a fresh run of the same seed: the run they came from, exactly. */
export function replay(config: Config, actions: readonly Action[], until: number): Sim {
  const sim = createSim(config);
  for (const action of actions) {
    runUntil(sim, action.at);
    apply(sim, action);
  }
  runUntil(sim, until);
  return sim;
}

export type { Violation };
