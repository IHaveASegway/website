import { properties, type PropertyState } from './check';
import {
  jobOf,
  live,
  replay,
  type Action,
  type Config,
  type Effect,
  type Place,
  type Sample,
  type Sim,
  type Worker,
} from './sim';

// What the Queue Lab says about a run, as words and series, with no markup: the page draws them
// at build, for the opening run, so the demo is complete without JavaScript, and in the browser on
// every frame of a run, which it drives with runUntil, as replay does. Pure functions of the run.

/**
 * The opening, the page's first picture: the bakery's orders at `busy`, three workers, prefetch 1,
 * acknowledgements after the ticket and no idempotency key. Worker 2 crashes at 2,400 ms between
 * an order's ticket and its ack, so the broker sends the order again and it is printed twice;
 * nothing is lost. The browser replays it to take over exactly where the picture stands.
 *
 * Seed 7 has worker 2 still working at 2,400 ms, its ticket not yet printed, so the order would be
 * sent again and printed once: no story. Seed 28 is the first seed from 7 whose worker 2 is then
 * between a ticket and its ack (order 18's ticket printed at 2,371 ms).
 */
export const OPENING: {
  readonly seed: number;
  readonly config: Config;
  readonly actions: readonly Action[];
  readonly until: number;
} = {
  seed: 28,
  config: { seed: 28, load: 'busy', workers: 3, prefetch: 1, ack: 'after', key: false },
  actions: [{ at: 2_400, kind: 'crash', worker: 1 }],
  until: 4_000,
};

export const openingRun = (): Sim => replay(OPENING.config, OPENING.actions, OPENING.until);

/** How many seeded runs the property sweep in test/queue.test.ts makes: the page says the number. */
export const SEEDS_IN_CI = 2_000;

export const seconds = (ms: number): string => `${(ms / 1000).toFixed(3)} s`;

const firstUp = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
const firstDown = (text: string) => text.charAt(0).toLowerCase() + text.slice(1);

/** "a", "a and b", "a, b and c". */
function list(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join('');
  return `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}`;
}

function brokenWords(p: PropertyState): string {
  const n = p.count;
  switch (p.id) {
    case 'no-loss':
      return `${n} ${n === 1 ? 'order was' : 'orders were'} lost`;
    case 'once':
      return `${n} ${n === 1 ? 'ticket was' : 'tickets were'} printed twice`;
    case 'drains':
      return `the queue did not drain within 30 s${n === 1 ? '' : `, ${n} times`}`;
  }
}

/** The status line: the three properties as one sentence, or the bug that froze the run. */
export function statusText(sim: Sim): string {
  if (sim.violation)
    return `Stopped at ${seconds(sim.violation.at)}: an order appeared or disappeared, which is a bug. ${firstUp(sim.violation.detail)}.`;
  const all = properties(sim);
  const held = all.flatMap((p) => (p.held ? [firstDown(p.name)] : []));
  const broken = all.flatMap((p) => (p.held ? [] : [brokenWords(p)]));
  if (broken.length === 0)
    return `All three held over ${sim.events.toLocaleString('en-US')} events: ${list(held)}.`;
  if (held.length === 0) return `${firstUp(list(broken))}.`;
  return `${firstUp(list(held))}, but ${list(broken)}.`;
}

/** The run's story in one sentence: the first order printed twice, else the first order lost,
 *  else the queue that did not drain. A printed order goes back to the broker only when its
 *  worker crashed before its ack left, so a second ticket always has that story. */
function story(sim: Sim): string | null {
  const twice = sim.tallies.once.first;
  if (twice) {
    const job = jobOf(sim, twice.job);
    const [a, b] = job.effects as [Effect, Effect];
    const again =
      a.worker === b.worker
        ? `worker ${b.worker + 1} printed it a second time after its restart`
        : `worker ${b.worker + 1} printed it a second time`;
    return `Order ${job.id} was printed twice: worker ${a.worker + 1} crashed after printing its ticket and before its ack left, so the broker sent it again and ${again}.`;
  }
  const lost = sim.tallies['no-loss'].first;
  if (lost) return `${firstUp(lost.detail)}.`;
  const stuck = sim.tallies.drains.first;
  if (stuck) {
    const job = jobOf(sim, stuck.job);
    const poison = job.poison
      ? `, while poison order ${job.id} kept failing and going back to the head of the queue`
      : '';
    return `The queue did not drain: ${stuck.detail}${poison}.`;
  }
  return null;
}

function totals(sim: Sim): string {
  if (sim.jobs.length === 0) return 'No orders yet.';
  const lost = sim.lostCount;
  const head =
    lost === 0 ? 'Nothing was lost' : `${lost} ${lost === 1 ? 'order was' : 'orders were'} lost`;
  const parts = [`${sim.doneCount} ${sim.doneCount === 1 ? 'order is' : 'orders are'} done`];
  const open = live(sim);
  if (open > 0) parts.push(`${open} ${open === 1 ? 'is' : 'are'} queued or with a worker`);
  const dead = sim.dead.length;
  if (dead > 0) parts.push(`${dead} ${dead === 1 ? 'is' : 'are'} in the dead-letter queue`);
  return `${head}; ${list(parts)}.`;
}

/** One or two sentences for the picture's caption: what went wrong first, then the totals. */
export function summary(sim: Sim): string {
  if (sim.violation)
    return `The run stopped at ${seconds(sim.violation.at)}, because an order appeared or disappeared: ${sim.violation.detail}.`;
  const told = story(sim);
  return told ? `${told} ${totals(sim)}` : totals(sim);
}

/** A worker's one-line state, for its button and the text beside the picture. */
export function workerText(sim: Sim, k: number): string {
  const w = sim.workers[k] as Worker;
  const name = `Worker ${k + 1}`;
  if (w.state !== 'up') return `${name}, ${w.state}`;
  const parts = [name];
  if (w.slow) parts.push('slow');
  if (w.leaving) parts.push('leaving the pool');
  parts.push(w.busy === null ? 'idle' : `working on order ${w.busy}`);
  const waiting = w.window.length - (w.busy !== null && w.window[0] === w.busy ? 1 : 0);
  if (waiting > 0) parts.push(`${waiting} waiting`);
  return parts.join(', ');
}

/** The history strip: a sample every 250 ms of the last two minutes (sim.ts, Sample). */
export const history = (sim: Sim): readonly Sample[] => sim.samples;

export type Outcome = 'queued' | 'in-flight' | 'done' | 'dead' | 'lost';

const OUTCOME: Record<Place, Outcome> = {
  ready: 'queued',
  retry: 'queued',
  wire: 'in-flight',
  window: 'in-flight',
  orphan: 'in-flight',
  reply: 'in-flight',
  done: 'done',
  dead: 'dead',
  lost: 'lost',
};

/** One order's life, for the strip of the last orders: when it was published, each delivery, each
 *  ticket, when the broker let it go, and where it is now. */
export interface Lifecycle {
  readonly id: number;
  readonly poison: boolean;
  readonly published: number;
  readonly delivered: readonly number[];
  readonly effects: readonly Effect[];
  readonly acked: number | null;
  readonly ended: number | null;
  readonly redelivered: boolean;
  readonly outcome: Outcome;
}

export function lifecycles(sim: Sim, count = 120): Lifecycle[] {
  return sim.jobs.slice(-count).map((job) => ({
    id: job.id,
    poison: job.poison,
    published: job.published,
    delivered: [...job.delivered],
    effects: [...job.effects],
    acked: job.acked,
    ended: job.ended,
    redelivered: job.redelivered,
    outcome: OUTCOME[job.place],
  }));
}
