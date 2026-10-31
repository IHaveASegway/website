import { openingRun as backfillOpening } from '../backfill/view';
import { openingRun as cacheOpening } from '../cache/view';
import { openingRun as queueOpening } from '../queue/view';
import { leaderOf } from '../raft/sim';
import { openingRun as raftOpening } from '../raft/view';
import { routeData, routeLabPicture } from '../route-lab/picture';
import { BAKERY } from '../route-lab/plan';
import { backfillGlyph, cacheGlyph, queueGlyph, raftGlyph, routesGlyph, type Glyph } from './glyph';

// Each lab's glyph from the run its own page opens on, so the card and the lab cannot disagree:
// the Queue Lab's worker 2 is down, the Backfill Lab's Wednesday is counted twice, the Route Lab's
// vans drive VROOM's plan for the default day. Build-time only: it runs the simulations and the
// Route Lab's solver in Node.

const where = (i: number): [number, number] => {
  const point = routeData.points[i];
  if (!point) throw new Error(`iso: the route data has no point ${i}`);
  return [point.x, point.y];
};

const GLYPHS: Record<string, () => Glyph | Promise<Glyph>> = {
  queue: () => {
    const sim = queueOpening();
    return queueGlyph({
      waiting: sim.ready.length,
      workers: sim.workers.slice(0, sim.size).map((w) => ({ down: w.state !== 'up' })),
    });
  },
  raft: () => {
    const sim = raftOpening();
    const leader = leaderOf(sim);
    return raftGlyph({
      servers: sim.servers.map((s) => ({ leader: s === leader, down: !s.up })),
    });
  },
  cache: () => cacheGlyph({ nodes: cacheOpening().nodes.map((n) => ({ down: !n.up })) }),
  backfill: () => {
    const sim = backfillOpening();
    return backfillGlyph({ source: sim.source, report: sim.report.slice(0, sim.source.length) });
  },
  routes: async () => {
    // Astro's root is the working directory (lib/route-lab/node-solver.ts).
    const { after } = await routeLabPicture(process.cwd());
    return routesGlyph({
      bakery: where(BAKERY),
      routes: after.plan.routes.map((route) => route.filter((i) => i !== BAKERY).map(where)),
    });
  },
};

/** The glyph of the lab with this slug, or undefined for a lab that has none yet. */
export async function labGlyph(slug: string): Promise<Glyph | undefined> {
  return GLYPHS[slug]?.();
}

/** The labs that have a glyph. */
export const GLYPH_SLUGS: readonly string[] = Object.keys(GLYPHS);
