import { openingRun as backfillOpening } from './backfill/view';
import { replay as replayCache } from './cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from './cache/view';
import { backfillFact, cacheFact, figureWords, queueFact, raftFailover, routesFact } from './lines';
import { replay as replayQueue } from './queue/sim';
import { OPENING as QUEUE } from './queue/view';
import { leaderOf, replay as replayRaft } from './raft/sim';
import { OPENING as RAFT, openingRun as raftOpening, statusText } from './raft/view';
import { formatDuration } from './route-lab/format';
import { routeLabPicture } from './route-lab/picture';

// Each lab's one fact on its card (docs/design/overhaul.md, "Lab cards"): a sentence its own
// simulation writes at build from the run its page opens on, with the change its write-up tells
// the visitor to make first (lib/lines.ts), so no figure on a card is typed. Until ADR 0027 each
// lab's line wrote it (components/board/lines/, now removed), on Home's board and on the Lab index;
// the sentences are the same, each in its place. Build-time only.
//
// One module owns the facts for both places: until the overhaul's branches were merged, Home
// worked out its own copy of the Queue's, the Cache's and the Backfill's beside this one, the same
// arithmetic twice. Where the places differ they differ on purpose, and say so below.

/** Where a card stands: Home's Selected work, or the Lab index. */
export type FactPlace = 'home' | 'index';

const queue = () =>
  queueFact(replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until));
const cache = () =>
  cacheFact(
    cacheOpening(),
    replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until),
  );
const backfill = () => backfillFact(backfillOpening(), backfillOpening('overwrite'));

// The Raft Lab: on the Lab index, that every property held over the opening run; on Home, what the
// board said, the failover its write-up asks the visitor to cause: crash the leader.
const raftHeld = () => statusText(raftOpening());
function raftFailedOver(): string {
  const opening = raftOpening();
  const leader = leaderOf(opening);
  if (!leader) throw new Error('lab-facts: the Raft opening has no leader to crash');
  const crashed = replayRaft(
    { seed: RAFT.seed },
    [...RAFT.actions, { at: RAFT.until, kind: 'crash', node: leader.id }],
    RAFT.until,
  );
  return raftFailover(opening, crashed);
}

// The Route Lab: on Home its figures say what they measure against and that the bakery is made up
// (the visitor review of 2026-10-31), in the words the hero said them in until ADR 0027
// (lib/lines.ts, figureWords); the Lab index keeps the line's shorter sentence, as it had before.
async function routes(place: FactPlace): Promise<string> {
  // Astro's root is the working directory (lib/route-lab/node-solver.ts).
  const { day, before, after } = await routeLabPicture(process.cwd());
  return place === 'home'
    ? `${formatDuration(after.measured.drive)} ${figureWords(day)}, against ${formatDuration(before.measured.drive)} as the orders came in.`
    : routesFact(day, before.measured, after.measured);
}

const FACTS: Record<string, (place: FactPlace) => string | Promise<string>> = {
  queue,
  raft: (place) => (place === 'home' ? raftFailedOver() : raftHeld()),
  cache,
  backfill,
  routes,
};

/** The fact on the card of the lab with this slug in this place (the Lab index unless named), or
 *  undefined for a lab that has none yet. */
export async function labFact(
  slug: string,
  place: FactPlace = 'index',
): Promise<string | undefined> {
  return FACTS[slug]?.(place);
}
