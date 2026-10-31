import { readLink, writeLink } from '../sim/link';
import { properties, type PropertyId } from './check';
import { DATABASE, firstUp, LOADS, millis, pageName, PAGES, seconds, type Load } from './core';
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

/** Where the browser plays a run from when the visitor starts it over, or runs one that still
 *  stands at the opening's moment: half a second before the menu expires, so the stampede the
 *  caption tells plays live, its lamps lighting and its line growing. */
export const REPLAY_FROM = (OPENING.config.menuExpires ?? 0) - 500;

const SWITCH = [false, true] as const;

/** The settings a link to a run names (lib/sim/link.ts), with the values the page offers and the
 *  opening's: the load, the placement, then the switches. Start over keeps them all. */
export const SETTINGS = {
  load: { values: Object.keys(LOADS) as Load[], opening: 'busy' },
  placement: { values: ['circle', 'modulo'], opening: 'circle' },
  coalesce: { values: SWITCH, opening: false },
  stale: { values: SWITCH, opening: false },
  early: { values: SWITCH, opening: false },
  jitter: { values: SWITCH, opening: false },
  invalidate: { values: SWITCH, opening: true },
} as const;

/** The link to a run's start: its seed, and each setting not the opening's, so it opens the run
 *  the page showed, switches and all (#seed-7&coalesce=on&stale=on). */
export const linkTo = (sim: Sim): string => writeLink(sim.seed, sim, SETTINGS);

/**
 * The run a link names, replayed to `until`: by default the opening's moment, where the build's
 * picture stands; Start over plays from REPLAY_FROM. Null when the hash links to no run. A link
 * names the seed, not the readers: every draw comes from one seeded stream, so a switch that
 * changes how many draws the run makes, as coalescing does by making fewer fetches, moves every
 * arrival after it. Two runs compare by their counts.
 */
export function openLink(hash: string, until: number = OPENING.until): Sim | null {
  const link = readLink(hash, SETTINGS);
  return (
    link && replay({ ...OPENING.config, ...link.values, seed: link.seed }, OPENING.actions, until)
  );
}

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

/** The three properties as the page names them beside their lamps, in PROPERTIES' order: the
 *  checker's names, said shorter. */
export const PROPERTY_NAMES: Record<PropertyId, string> = {
  'one-fetch': 'One fetch of a page at a time',
  'no-timeouts': 'No reader timed out',
  fresh: 'No reader got a page past its limit',
};

/** A property as the page shows it: its lamp, held or broken, its name, and a few words that count
 *  the breaks and say the worst of them. */
export interface PropertyLine {
  readonly id: PropertyId;
  readonly name: string;
  readonly held: boolean;
  readonly words: string;
}

export function propertyLines(sim: Sim): PropertyLine[] {
  return properties(sim).map((p) => {
    const worst = p.worst ?? 0;
    const broke =
      p.id === 'one-fetch'
        ? `Broken ${times(p.count)}, at worst ${count(worst)} fetches of one page at once`
        : p.id === 'no-timeouts'
          ? `Broken: ${reads(p.count)} timed out`
          : `Broken: ${reads(p.count)}, the worst ${millis(worst)} out of date`;
    return { id: p.id, name: PROPERTY_NAMES[p.id], held: p.held, words: p.held ? 'Held' : broke };
  });
}

/**
 * What a page's lamp shows, on the node that holds it: fresh until its entry expires, stale once it
 * has (an entry still held, which only stale-while-revalidate serves), or missing; and being
 * fetched, which outranks the rest, while any fetch of it is in flight.
 */
export type PageState = 'fresh' | 'stale' | 'missing' | 'fetching';

export function pageState(sim: Sim, key: number): PageState {
  if ((sim.flying[key]?.length ?? 0) > 0) return 'fetching';
  const entry = sim.nodes[sim.owners[key] ?? -1]?.entries.get(key);
  if (!entry) return 'missing';
  return sim.now < entry.expiresAt ? 'fresh' : 'stale';
}

/** The pages a node holds now, in page order: none while it is down. */
export function pagesOn(sim: Sim, node: number): number[] {
  const keys: number[] = [];
  if (!sim.nodes[node]?.up) return keys;
  for (const [key, owner] of sim.owners.entries()) if (owner === node) keys.push(key);
  return keys;
}

/** A node in a word or two: how many pages it holds, or that it is down. */
export function nodeWords(sim: Sim, node: number): string {
  if (!sim.nodes[node]?.up) return 'Down';
  const held = pagesOn(sim, node).length;
  return `${count(held)} ${held === 1 ? 'page' : 'pages'}`;
}

/** The menu beside its lamp: its state and when it changes, how many fetches of it are in flight
 *  in a herd, and the version its node still serves when the database holds a newer one. */
export function menuWords(sim: Sim): string {
  const flying = sim.flying[0]?.length ?? 0;
  const entry = sim.nodes[sim.owners[0] ?? -1]?.entries.get(0);
  const newest = sim.versions[0] ?? 1;
  const old = entry && entry.version < newest ? `, still version ${entry.version}` : '';
  const at = (ms: number) => `${(ms / 1000).toFixed(1)} s`;
  switch (pageState(sim, 0)) {
    case 'fetching':
      return flying > 1 ? `Menu, ${count(flying)} fetches at once` : `Menu, being fetched${old}`;
    case 'fresh':
      return `Menu, fresh until ${at(entry?.expiresAt ?? 0)}${old}`;
    case 'stale':
      return `Menu, expired at ${at(entry?.expiresAt ?? 0)}${old}`;
    default:
      return 'Menu, missing';
  }
}

/** Fetches waiting in line for a connection. */
export const waiting = (sim: Sim): number => sim.line.length - sim.lineHead;

/** The readers, as the picture labels them: how many pages they ask for a second. */
export const readersWords = (sim: Sim): string => `Readers, ${count(LOADS[sim.load])} a second`;

/** The picture's own name, for assistive technology: what its parts show now, the nodes' lamps
 *  counted by state and the database's connections and line. The caption under it tells the run,
 *  so the name does not repeat it. */
export function mapWords(sim: Sim): string {
  const lamps: Record<PageState, number> = { fresh: 0, stale: 0, missing: 0, fetching: 0 };
  for (let key = 0; key < PAGES; key++) lamps[pageState(sim, key)] += 1;
  const down = sim.nodes.filter((node) => !node.up).map((node) => `node ${node.id + 1}`);
  const line = waiting(sim);
  return `${readersWords(sim)}, four cache nodes${down.length > 0 ? `, ${and(down)} down,` : ''} and the database. The nodes’ pages: ${count(lamps.fresh)} fresh, ${count(lamps.stale)} expired, ${count(lamps.missing)} missing and ${count(lamps.fetching)} being fetched. ${menuWords(sim)}. The database: ${sim.running} of ${DATABASE.pool} connections busy and ${count(line)} ${line === 1 ? 'fetch' : 'fetches'} waiting.`;
}

/** The outcome strip in one sentence, for assistive technology: what the last 2 s of reads got. */
export function stripWords(sim: Sim): string {
  const total = { hit: 0, stale: 0, served: 0, timeout: 0, pending: 0 };
  for (const bucket of outcomeStrip(sim))
    for (const outcome of Object.keys(total) as (keyof typeof total)[])
      total[outcome] += bucket[outcome];
  const copies = total.stale === 1 ? 'stale copy' : 'stale copies';
  const fetches = total.served === 1 ? 'fresh fetch' : 'fresh fetches';
  return `In the last 2 s, readers got ${count(total.hit)} pages from the cache, ${count(total.stale)} ${copies} and ${count(total.served)} ${fetches}; ${reads(total.timeout)} timed out, and ${count(total.pending)} still ${total.pending === 1 ? 'waits' : 'wait'}.`;
}

/** The clock under the picture: the run's virtual time and its seed. */
export const clockWords = (sim: Sim): string =>
  `Virtual time ${seconds(sim.now)}, seed ${sim.seed}`;
