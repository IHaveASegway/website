import { readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { openingRun as backfillOpening } from '../src/lib/backfill/view';
import { openingRun as cacheOpening } from '../src/lib/cache/view';
import {
  backfillGlyph,
  box,
  cylinder,
  glyph,
  project,
  queueGlyph,
  raftGlyph,
  routesGlyph,
  tile,
  UNIT,
  wire,
  type Glyph,
  type Paint,
} from '../src/lib/iso/glyph';
import { GLYPH_SLUGS, labGlyph } from '../src/lib/iso/lab-glyphs';
import { labFact } from '../src/lib/lab-facts';
import { openingRun as queueOpening } from '../src/lib/queue/view';
import { leaderOf } from '../src/lib/raft/sim';
import { openingRun as raftOpening } from '../src/lib/raft/view';

// The labs' glyphs (docs/design/overhaul.md, "Lab cards"; lib/iso/glyph.ts): each lab's system as
// an isometric model, drawn at build from the run its page opens on, so a card and its lab cannot
// disagree. These hold the projection, the solids, and each lab's model to its opening.

const LABS = readdirSync(new URL('../src/content/lab/', import.meta.url))
  .filter((file) => file.endsWith('.md'))
  .map((file) => file.replace(/\.md$/, ''))
  .sort();

/** Every mark of a glyph that is painted so. */
const painted = (g: Glyph, paint: Paint) =>
  [...g.ground, ...g.wires, ...g.solids.flatMap((s) => s.marks)].filter((m) => m.paint === paint);

/** Every point a glyph's lines and moves reach. */
const points = (g: Glyph) =>
  [...g.ground, ...g.wires, ...g.solids.flatMap((s) => s.marks)].flatMap(({ d }) =>
    [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]),
  );

describe('the projection', () => {
  test('known answers: 30° isometric, x to the right and down, y to the left and down, z up', () => {
    const c = Math.cos(Math.PI / 6) * UNIT;
    const close = ([x, y]: [number, number], [ex, ey]: [number, number]) => {
      expect(x).toBeCloseTo(ex, 9);
      expect(y).toBeCloseTo(ey, 9);
    };
    close(project([1, 0, 0]), [c, UNIT / 2]);
    close(project([0, 1, 0]), [-c, UNIT / 2]);
    close(project([0, 0, 1]), [0, -UNIT]);
  });

  test('a box shows its top and its two near faces; a box that is down is one dashed outline', () => {
    expect(box([0, 0, 0], [1, 1, 1]).marks.map((m) => m.paint)).toEqual(['left', 'right', 'top']);
    expect(box([0, 0, 0], [1, 1, 1], { lit: true }).marks.map((m) => m.paint)).toEqual([
      'left',
      'right',
      'lit',
    ]);
    expect(box([0, 0, 0], [1, 1, 1], { off: true }).marks.map((m) => m.paint)).toEqual(['off']);
    expect(box([0, 0, 0], [1, 1, 1], { ghost: true }).marks.map((m) => m.paint)).toEqual(['ghost']);
  });

  test('a cylinder is its body, its rings and its lid, in that order', () => {
    expect(cylinder([0, 0, 0], 1, 2, { bands: 2 }).marks.map((m) => m.paint)).toEqual([
      'left',
      'band',
      'band',
      'top',
    ]);
  });

  test('solids are drawn back to front, and the box holds everything drawn', () => {
    const near = box([4, 4, 0], [1, 1, 1]);
    const far = box([0, 0, 0], [1, 1, 1]);
    const g = glyph(
      tile(6, 6),
      [
        wire([
          [0, 0, 0],
          [6, 6, 0],
        ]),
      ],
      [near, far],
    );
    expect(g.solids).toEqual([far, near]);
    const [x, y, w, h] = g.box;
    for (const [px = 0, py = 0] of points(g)) {
      expect(px).toBeGreaterThanOrEqual(x);
      expect(px).toBeLessThanOrEqual(x + w);
      expect(py).toBeGreaterThanOrEqual(y);
      expect(py).toBeLessThanOrEqual(y + h);
    }
  });

  test('a cylinder’s lid, which bulges above its arcs’ ends, is inside the box', () => {
    const g = glyph(tile(2, 2), [], [cylinder([1, 1, 0], 1, 2)]);
    const [, top] = project([1, 1, 2]);
    const ry = Math.SQRT2 * Math.sin(Math.PI / 6) * UNIT;
    expect(g.box[1]).toBeLessThanOrEqual(top - ry);
  });
});

describe("each lab's glyph, from the run its page opens on", () => {
  test('every live lab has a glyph and a fact, and no glyph is for a lab that is not live', async () => {
    expect([...GLYPH_SLUGS].sort()).toEqual(LABS);
    for (const slug of LABS) {
      expect(await labGlyph(slug), slug).toBeDefined();
      expect(await labFact(slug), slug).toMatch(/\S.*\.$/);
    }
    expect(await labGlyph('nothing')).toBeUndefined();
  });

  // One module writes every card's fact, Home's and the Lab index's (lib/lab-facts.ts). Until the
  // overhaul's merge Home worked out its own copy beside it. The places agree but for the two
  // sentences that differ on purpose: Home's Raft card crashes the leader, and its Route Lab card
  // says the bakery is made up.
  test("Home's facts are the Lab index's, but Raft's failover and the made-up bakery", async () => {
    for (const slug of LABS) {
      const [home, index] = [await labFact(slug, 'home'), await labFact(slug, 'index')];
      expect(home, slug).toMatch(/\S.*\.$/);
      if (slug === 'raft')
        expect(home).toMatch(/^Crash server \d, and server \d leads term \d+ after/);
      else if (slug === 'routes') expect(home).toContain('made-up bakery');
      else expect(home, slug).toBe(index);
    }
    expect(await labFact('raft')).toBe(await labFact('raft', 'index'));
  });

  test('the queue: a lit plate per order waiting, up to eight; a worker that is down is dashed, its wire cut', () => {
    const sim = queueOpening();
    const pool = sim.workers.slice(0, sim.size);
    const down = pool.filter((w) => w.state !== 'up').length;
    expect(down).toBeGreaterThan(0); // worker 2, crashed at the opening
    const g = queueGlyph({
      waiting: sim.ready.length,
      workers: pool.map((w) => ({ down: w.state !== 'up' })),
    });
    expect(painted(g, 'lit')).toHaveLength(Math.min(8, sim.ready.length));
    expect(painted(g, 'off')).toHaveLength(down);
    expect(painted(g, 'cut')).toHaveLength(down);
    expect(painted(queueGlyph({ waiting: 30, workers: [{ down: false }] }), 'lit')).toHaveLength(8);
  });

  test('raft: the leader is the one lit server, with a wire to each other server', () => {
    const sim = raftOpening();
    const leader = leaderOf(sim);
    expect(leader).not.toBeNull();
    const g = raftGlyph({
      servers: sim.servers.map((s) => ({ leader: s === leader, down: !s.up })),
    });
    expect(painted(g, 'lit')).toHaveLength(1);
    expect(painted(g, 'wire').length + painted(g, 'cut').length).toBe(sim.servers.length - 1);
  });

  test('the cache: a node per cache node, the down ones dashed', async () => {
    const sim = cacheOpening();
    const g = await labGlyph('cache');
    if (!g) throw new Error('no cache glyph');
    expect(painted(g, 'off')).toHaveLength(sim.nodes.filter((n) => !n.up).length);
    // Five readers, the nodes, and the database.
    expect(g.solids).toHaveLength(5 + sim.nodes.length + 1);
  });

  test('the backfill: a partition a day, as tall as its source, and a dashed block over each day the report counts past it', () => {
    const sim = backfillOpening();
    const over = sim.source.filter((n, k) => (sim.report[k] ?? 0) > n).length;
    expect(over).toBeGreaterThan(0); // Wednesday, counted twice at the opening
    const g = backfillGlyph({ source: sim.source, report: sim.report });
    expect(painted(g, 'ghost')).toHaveLength(over);
    // A taller day stands taller: its top is higher on the page.
    const tops = sim.source.map((n) =>
      Math.min(...points(backfillGlyph({ source: [n], report: [n] })).map(([, y = 0]) => y)),
    );
    const most = sim.source.indexOf(Math.max(...sim.source));
    expect(Math.min(...tops)).toBe(tops[most]);
  });

  test('the routes: a pin per stop, the bakery lit, a route per van with stops, each leg along the grid', async () => {
    const g = routesGlyph({
      bakery: [0, 0],
      routes: [
        [
          [3, 1],
          [5, 4],
        ],
        [],
        [[1, 6]],
      ],
    });
    expect(painted(g, 'lit')).toHaveLength(1);
    expect(painted(g, 'wire')).toHaveLength(2);
    expect(g.solids).toHaveLength(3 + 1);
    // Along the grid: every segment runs along x or along y, so on the page it slopes at ±30°.
    for (const { d } of painted(g, 'wire')) {
      const at = [...d.matchAll(/(-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (let k = 1; k < at.length; k += 1) {
        const [x0 = 0, y0 = 0] = at[k - 1] ?? [];
        const [x1 = 0, y1 = 0] = at[k] ?? [];
        if (x0 === x1 && y0 === y1) continue;
        expect(Math.abs((y1 - y0) / (x1 - x0))).toBeCloseTo(Math.tan(Math.PI / 6), 1);
      }
    }
    const real = await labGlyph('routes');
    expect(real && painted(real, 'wire').length).toBeGreaterThan(0);
  });
});
