import { properties, type PropertyId } from './check';
import { firstUp, millis, pageName, seconds } from './core';
import { replay, type Action, type Config, type Outcome, type Sample, type Sim } from './sim';

// What the Cache Lab says about a run, as text and numbers, never markup: the page stage draws
// them. Like the Raft Lab's view, it serves twice: at build, to describe the opening run so the
// page is complete without JavaScript, and in the browser, on every frame of a live run.

/**
 * The opening: seed 7 at a busy hour, every mitigation off. The cache is warm, and the menu's entry
 * expires at 3 s: its readers all miss, the database fetches it twenty-odd times at once, its 8
 * connections fill, and readers start to give up. The browser replays it to take over exactly
 * where the picture stands.
 */
export const OPENING = {
  seed: 7,
  config: { seed: 7, load: 'busy', menuExpires: 3_000 } as Config,
  actions: [] as readonly Action[],
  until: 5_000,
} as const;

export const openingRun = (): Sim => replay(OPENING.config, OPENING.actions, OPENING.until);

/** How many seeded runs the property sweep in test/cache.test.ts makes: the page says the number. */
export const SEEDS_IN_CI = 600;

const count = (n: number): string => n.toLocaleString('en-US');
const times = (n: number): string => (n === 1 ? 'once' : n === 2 ? 'twice' : `${count(n)} times`);
const reads = (n: number): string => `${count(n)} ${n === 1 ? 'read' : 'reads'}`;

/** A list in a sentence: "a", "a and b", "a, b and c". */
function and(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Two sentences for the picture's caption: how much the cache served, then what went wrong, if
 *  anything: the worst herd, the readers who gave up, and any reads older than they may be. */
export function summary(sim: Sim): string {
  const c = sim.counts;
  const ended = c.hit + c.stale + c.served + c.timeout;
  const share = ended > 0 ? `${((100 * (c.hit + c.stale)) / ended).toFixed(1)}%` : 'none';
  const served = `${reads(c.reads)} in ${(sim.now / 1000).toFixed(1)} s, ${share} from the cache.`;
  const herd = sim.tally.herd;
  const findings: string[] = [];
  if (herd && herd.size >= 2) {
    const page = pageName(herd.key);
    const size = `${times(herd.size)} at once`;
    findings.push(
      herd.expired === null
        ? `at ${(herd.from / 1000).toFixed(1)} s the database fetched ${page} ${size}`
        : `when ${page} expired at ${(herd.expired / 1000).toFixed(1)} s, the database fetched it ${size}`,
    );
  } else findings.push('no page was fetched twice at once');
  findings.push(c.timeout === 0 ? 'no reader timed out' : `${reads(c.timeout)} timed out`);
  const t = sim.tally;
  if (t.staleReads > 0)
    findings.push(
      `${reads(t.staleReads)} got a page older than the stale limit allows (the worst by ${millis(t.worstStale)})`,
    );
  return `${served} ${firstUp(and(findings))}.`;
}

interface Clause {
  readonly broke: (n: number) => string;
  readonly held: string;
}

/** Each property as a clause of the status line: what happened, counted, when it broke, and what
 *  never happened when it held. A property's name read as "no timeouts broke twice" says the
 *  opposite of what it means. */
const CLAUSES: Record<PropertyId, Clause> = {
  'one-fetch': {
    broke: (n) =>
      `${count(n)} ${n === 1 ? 'fetch' : 'fetches'} began while the same page was already being fetched`,
    held: 'no page was fetched twice at once',
  },
  'no-timeouts': { broke: (n) => `${reads(n)} timed out`, held: 'no reader timed out' },
  fresh: {
    broke: (n) => `${reads(n)} got a page older than the stale limit allows`,
    held: 'no reader got a page older than the stale limit allows',
  },
};

/** The status line: the three properties in one sentence, or the conservation bug that froze the
 *  run, and where. */
export function statusText(sim: Sim): string {
  if (sim.violation)
    return `Broken at ${seconds(sim.violation.at)}: conservation. ${sim.violation.detail}.`;
  const held: string[] = [];
  const broke: string[] = [];
  for (const p of properties(sim)) {
    if (p.held) held.push(CLAUSES[p.id].held);
    else broke.push(CLAUSES[p.id].broke(p.count));
  }
  if (broke.length === 0) return `All three properties held over ${reads(sim.counts.reads)}.`;
  return `${firstUp(and(broke))}${held.length > 0 ? `; ${and(held)}` : ''}.`;
}

/** The history strip's points, one every 100 ms, the last minute of them. */
export const series = (sim: Sim): readonly Sample[] => sim.samples;

export const BUCKET_MS = 50;
export const BUCKETS = 40;

/** How the reads that began in one 50 ms span ended, or that they still wait. */
export type Bucket = { readonly from: number } & Record<Outcome | 'pending', number>;

/**
 * The last 2 s of reads, in 50 ms buckets by when each began, counted by how it ended: an
 * op-color strip, after Aphyr, "Op color plots" (2025). A stampede shows as a
 * band of misses and then of readers giving up, a second after the expiry that set it off.
 */
export function outcomeStrip(sim: Sim): Bucket[] {
  const last = Math.floor(sim.now / BUCKET_MS) * BUCKET_MS;
  const first = last - (BUCKETS - 1) * BUCKET_MS;
  const buckets = Array.from({ length: BUCKETS }, (_, i) => ({
    from: first + i * BUCKET_MS,
    hit: 0,
    stale: 0,
    served: 0,
    timeout: 0,
    pending: 0,
  }));
  for (const read of sim.recent) {
    const bucket = buckets[Math.floor((read.at - first) / BUCKET_MS)];
    if (bucket) bucket[read.outcome] += 1;
  }
  return buckets;
}
