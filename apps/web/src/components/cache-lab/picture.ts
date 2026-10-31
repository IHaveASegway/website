import type { Sim } from '../../lib/cache/sim';
import { menuWords, pageState, pagesOn, type Bucket } from '../../lib/cache/view';

// The Cache Lab's picture as markup, the one piece of it that is not plain text: the build writes
// it into the page for the opening run (CacheLab.astro), and the browser writes the same markup as
// the run moves (app.ts), so the page the app takes over is the page the build drew. The words come
// from lib/cache/view.ts; the shapes and their places are here.

/** A node's lamps, one a page it holds, in page order: the menu first where it lives, with its
 *  words beside its lamp, since it is the page every stampede is about. */
export function pageLamps(sim: Sim, node: number): string {
  return pagesOn(sim, node)
    .map((key) =>
      key === 0
        ? `<span class="cl-menu"><span class="cl-lamp cl-menu-lamp" data-state="${pageState(sim, 0)}"></span><span class="cl-menu-words" data-cl-menu>${menuWords(sim)}</span></span>`
        : `<span class="cl-lamp" data-state="${pageState(sim, key)}"></span>`,
    )
    .join('');
}

/** The outcome strip's four lanes, top to bottom, as their labels name them. Reads still waiting
 *  are drawn hollow in the fresh fetch's lane: what they will get is not known yet. */
export const LANES = [
  { outcome: 'hit', name: 'Cache' },
  { outcome: 'stale', name: 'Stale copy' },
  { outcome: 'served', name: 'Fresh fetch' },
  { outcome: 'timeout', name: 'Timed out' },
] as const;

/** The strip's geometry in its own units: a lane 25 tall, a bucket 10 wide, a bar 8 wide and at
 *  most 21 tall. The strip stretches to its box, so only the proportions matter. */
export const STRIP = { width: 400, lane: 25, step: 10, bar: 8, tall: 21 } as const;

/** A bar's height for a count of reads: log-scaled, so a single timeout among a busy bucket's
 *  fifteen hits still shows, and full from fifteen reads a bucket up. */
const barHeight = (n: number): number =>
  n <= 0 ? 0 : Math.round(Math.min(1, Math.log2(1 + n) / 4) * STRIP.tall * 100) / 100;

const base = (lane: number): number => STRIP.lane * (lane + 1) - 2;

/** The strip's bars as path data: one path a lane, a closed bar a bucket, and an open frame over
 *  the fresh fetch's bars for the reads still waiting. */
export function stripPaths(buckets: readonly Bucket[]): Record<string, string> {
  const paths: Record<string, string> = {
    hit: '',
    stale: '',
    served: '',
    timeout: '',
    pending: '',
  };
  buckets.forEach((bucket, i) => {
    const x = i * STRIP.step + (STRIP.step - STRIP.bar) / 2;
    LANES.forEach(({ outcome }, lane) => {
      const h = barHeight(bucket[outcome]);
      if (h > 0) paths[outcome] += `M${x} ${base(lane)}v${-h}h${STRIP.bar}v${h}z`;
    });
    if (bucket.pending > 0) {
      const h = barHeight(bucket.served + bucket.pending);
      paths['pending'] += `M${x} ${base(2)}v${-h}h${STRIP.bar}v${h}`;
    }
  });
  return paths;
}

/** The lanes' base lines, drawn once. */
export const STRIP_BASES = LANES.map((_, lane) => `M0 ${base(lane)}H${STRIP.width}`).join('');

/** Where the strip starts and ends, in seconds of virtual time: the first bucket's start and now. */
export const stripEnds = (buckets: readonly Bucket[], now: number): [string, string] => [
  `${((buckets[0]?.from ?? 0) / 1000).toFixed(2)} s`,
  `${(now / 1000).toFixed(2)} s`,
];

/**
 * The readers' fan and the lines to the database, in units of a box 100 wide and 400 tall, a band
 * of 100 a node. Each node takes three readers' lines, which run in from the left and join as
 * tracks join at points, into one line that meets its middle; from its middle one line runs on to
 * the database, centred on the four.
 */
export function fanPath(node: number): string {
  const mid = node * 100 + 50;
  return [mid - 30, mid, mid + 30].map((y) => `M0 ${y}H24L62 ${mid}H100`).join('');
}

export const linkPath = (node: number): string => `M0 ${node * 100 + 50}H40L100 200`;
