import { openingRun as backfillOpening } from './backfill/view';
import { replay as replayCache } from './cache/sim';
import { OPENING as CACHE, openingRun as cacheOpening } from './cache/view';
import { backfillFact, cacheFact, figureWords, queueFact, raftFailover } from './lines';
import { replay as replayQueue } from './queue/sim';
import { OPENING as QUEUE } from './queue/view';
import { replay as replayRaft } from './raft/sim';
import { landingStory, OPENING as RAFT } from './raft/view';
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
// arithmetic twice. Since 2026-11-02 the two say the same sentence for every lab.

const queue = () =>
  queueFact(replayQueue({ ...QUEUE.config, key: true }, QUEUE.actions, QUEUE.until));
const cache = () =>
  cacheFact(
    cacheOpening(),
    replayCache({ ...CACHE.config, coalesce: true }, CACHE.actions, CACHE.until),
  );
const backfill = () => backfillFact(backfillOpening(), backfillOpening('overwrite'));

// The Raft Lab: the failover its write-up asks the visitor to cause, crash the leader, in both
// places. Until 2026-11-02 the Lab index said every safety property held over the opening run, which
// is true and shows nothing: 249 events, one election, three writes and no fault to survive, on a
// card that tells the visitor to crash the servers. That sentence stays the lab's own status line.
// The crash is the one the run a visitor lands on plays (raft/view.ts, landingStory), so the card
// names the server and the time the page then shows. Which server wins depends on the moment: until
// 2026-11-03 this crashed the leader where the opening stands, 100 ms earlier, and the card named
// server 5 after 221 ms over a page that showed server 3 after 196 ms.
function raftFailedOver(): string {
  const [crash] = landingStory();
  if (!crash) throw new Error('lab-facts: the Raft story has no crash');
  return raftFailover(
    replayRaft({ seed: RAFT.seed }, RAFT.actions, crash.at),
    replayRaft({ seed: RAFT.seed }, [...RAFT.actions, crash], crash.at),
  );
}

// The Route Lab: its figures say what they measure against and that the bakery is made up, in the
// words the hero said them in until ADR 0027 (lib/lines.ts, figureWords). Home took those words after
// the visitor review of 2026-10-31; until 2026-11-02 the Lab index kept a shorter sentence, "A busy
// Saturday: 3 h 12 min of driving instead of 5 h 34 min", which said neither.
async function routes(): Promise<string> {
  // Astro's root is the working directory (lib/route-lab/node-solver.ts).
  const { day, before, after } = await routeLabPicture(process.cwd());
  return `${formatDuration(after.measured.drive)} ${figureWords(day)}, against ${formatDuration(before.measured.drive)} as the orders came in.`;
}

const FACTS: Record<string, () => string | Promise<string>> = {
  queue,
  raft: raftFailedOver,
  cache,
  backfill,
  routes,
};

/** What each lab's fact on Home is about. Home names the made-up bakery nowhere else, and its facts
 *  talk of order 18 and the menu: without this a reader who has not opened the lab can't tell what
 *  prints or whose menu it is. The Route Lab's fact says so itself, and the Raft Lab's has none. */
const BAKERY: Record<string, string> = { queue: 'orders', cache: 'menu', backfill: 'report' };

/** The line over a lab's fact on Home: where it comes from, and what it is about. */
export function factSource(slug: string, name: string): string {
  const about = BAKERY[slug];
  return `Simulated in the ${name}${about ? `, with a made-up bakery’s ${about}` : ''}`;
}

/** The fact on the card of the lab with this slug, or undefined for a lab that has none yet. */
export async function labFact(slug: string): Promise<string | undefined> {
  return FACTS[slug]?.();
}
