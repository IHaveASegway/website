import type { Job, Place, Sim } from './sim';

// What the Queue Lab promises, and what it counts. Three properties a visitor can break with a
// weak configuration: each break is counted, and the run goes on, because the break is the lesson.
// One invariant nobody can break from the page: every order published is in exactly one place.
// An order that appears or disappears is a bug in sim.ts, so it freezes the run, like a broken
// safety property in the Raft Lab.

export const PROPERTIES = [
  { id: 'no-loss', name: 'No order was lost' },
  { id: 'once', name: 'No order was printed twice' },
  { id: 'drains', name: 'The queue drains' },
] as const;

export type PropertyId = (typeof PROPERTIES)[number]['id'];

export interface PropertyState {
  readonly id: PropertyId;
  readonly name: string;
  readonly held: boolean;
  readonly count: number;
  readonly first?: { readonly at: number; readonly detail: string };
}

/**
 * Each property, whether it held, how many times it broke, and the first break.
 * - `no-loss`: every order published ends done, in flight, queued or dead-lettered. A break is an
 *   order the broker had let go when its worker crashed: acknowledged on delivery (`before`).
 * - `once`: no order's ticket printed twice. A break is a redelivered order printed again: its
 *   worker crashed after the ticket and before its ack left, and no idempotency key stopped it.
 *   Each such order counts once, however many times it printed; sim.duplicates counts tickets.
 * - `drains`: once the producer stops, with a worker up, the queue empties within 30 s. A poison
 *   order under `requeue` comes straight back on every failure and keeps it from ever emptying.
 *   It also rests on capacity, whatever the ack timing or the key: a backlog more than the
 *   workers up can finish in 30 s breaks it in any configuration.
 */
export function properties(sim: Sim): PropertyState[] {
  return PROPERTIES.map(({ id, name }) => {
    const { count, first } = sim.tallies[id];
    const state = { id, name, held: count === 0, count };
    return first ? { ...state, first: { at: first.at, detail: first.detail } } : state;
  });
}

export interface Violation {
  readonly at: number;
  readonly detail: string;
}

/** Conservation, after every event: published = queued + in flight + done + dead + lost, each
 *  term counted from its own store, so an order dropped from one place and never added to
 *  another, or added to two, shows. A few additions, not a walk over every order. */
export function invariant(sim: Sim): Violation | null {
  let held = sim.ready.length + sim.retrying.size;
  held += sim.wire.size + sim.orphans.size + sim.replies.size;
  for (const w of sim.workers) held += w.window.length;
  held += sim.doneCount + sim.dead.length + sim.lostCount;
  if (held === sim.jobs.length) return null;
  return {
    at: sim.now,
    detail: `${sim.jobs.length} orders were published, and ${held} are accounted for`,
  };
}

/** The same law, order by order: each order is in exactly one store, the one its own record names,
 *  and the totals of done and lost orders match the records. Run at every sample of the history
 *  strip, where a walk over every order costs little. */
export function audit(sim: Sim): Violation | null {
  const fail = (detail: string): Violation => ({ at: sim.now, detail });
  const seen = new Map<number, Place>();
  const stores: [Iterable<number>, Place][] = [
    [sim.ready, 'ready'],
    [sim.retrying, 'retry'],
    [sim.wire, 'wire'],
    ...sim.workers.map((w): [Iterable<number>, Place] => [w.window, 'window']),
    [sim.orphans, 'orphan'],
    [sim.replies, 'reply'],
    [sim.dead, 'dead'],
  ];
  for (const [ids, place] of stores) {
    for (const id of ids) {
      const job = sim.jobs[id - 1] as Job | undefined;
      if (!job) return fail(`order ${id} is in the ${place} store but was never published`);
      const there = seen.get(id);
      if (there) return fail(`order ${id} is in two places at once: ${there} and ${place}`);
      if (job.place !== place)
        return fail(`order ${id} is in ${place}, but its record says ${job.place}`);
      seen.set(id, place);
    }
  }
  let done = 0;
  let lost = 0;
  for (const job of sim.jobs) {
    if (seen.has(job.id)) continue;
    if (job.place === 'done') done += 1;
    else if (job.place === 'lost') lost += 1;
    else return fail(`order ${job.id}'s record says ${job.place}, but it is not there`);
  }
  if (done !== sim.doneCount || lost !== sim.lostCount)
    return fail(
      `the records hold ${done} done and ${lost} lost orders, the totals ${sim.doneCount} and ${sim.lostCount}`,
    );
  return null;
}
