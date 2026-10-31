import { openingRun as backfillOpening } from './backfill/view';
import { replay as replayCache } from './cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from './cache/view';
import { backfillFact, cacheFact, queueFact, routesFact } from './lines';
import { replay as replayQueue } from './queue/sim';
import { OPENING as QUEUE } from './queue/view';
import { openingRun as raftOpening, statusText } from './raft/view';
import { routeLabPicture } from './route-lab/picture';

// Each lab's one fact on its card (docs/design/overhaul.md, "Lab cards"): a sentence its own
// simulation writes at build from the run its page opens on, with the change its write-up tells
// the visitor to make first (lib/lines.ts), so no figure on a card is typed. Until ADR 0027 each
// lab's line on the Lab index wrote it (components/board/lines/); the sentences are the same.
// Build-time only.

const FACTS: Record<string, () => string | Promise<string>> = {
  queue: () => queueFact(replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until)),
  raft: () => statusText(raftOpening()),
  cache: () =>
    cacheFact(
      cacheOpening(),
      replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until),
    ),
  backfill: () => backfillFact(backfillOpening(), backfillOpening('overwrite')),
  routes: async () => {
    // Astro's root is the working directory (lib/route-lab/node-solver.ts).
    const picture = await routeLabPicture(process.cwd());
    return routesFact(picture.day, picture.before.measured, picture.after.measured);
  },
};

/** The fact on the card of the lab with this slug, or undefined for a lab that has none yet. */
export async function labFact(slug: string): Promise<string | undefined> {
  return FACTS[slug]?.();
}
