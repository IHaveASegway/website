import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { box, cylinder, ellipse, LIFT, project, system, UNIT } from '../src/lib/iso/system';

// Home's drawing (lib/iso/system.ts; docs/design/overhaul.md, "The isometric drawing"; ADR 0027):
// the five labs as one system, on one isometric plane. Known answers for the projection and the
// solids, then the model held to the labs it draws: as many workers, nodes, servers, vans and
// reports as each lab's opening run has, a part for each lab, every path inside the picture, and
// the exploded view's lifts the same in the model and in home.css.

const app = fileURLToPath(new URL('..', import.meta.url));
const COUNTS = { workers: 3, nodes: 4, servers: 5, leader: 2, vans: 3, days: 7 } as const;

/** Every point a path visits, from its absolute commands (the model writes no relative ones but
 *  the drop lines' v). */
function points(d: string): [number, number][] {
  const found: [number, number][] = [];
  for (const [, command = '', args = ''] of d.matchAll(/([MLQAHVZ])([^MLQAHVZ]*)/g)) {
    const n = (args.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
    if (command === 'A')
      for (let i = 0; i + 6 < n.length; i += 7) found.push([n[i + 5] ?? 0, n[i + 6] ?? 0]);
    else if (command === 'M' || command === 'L' || command === 'Q')
      for (let i = 0; i + 1 < n.length; i += 2) found.push([n[i] ?? 0, n[i + 1] ?? 0]);
  }
  return found;
}

describe('the projection', () => {
  test('known answers: 30° isometric, x to the lower right, y to the lower left, z up', () => {
    const [ox, oy] = project([0, 0, 0]);
    const [xx, xy] = project([1, 0, 0]);
    const [yx, yy] = project([0, 1, 0]);
    const [zx, zy] = project([0, 0, 1]);
    expect(xx - ox).toBeCloseTo(UNIT * Math.cos(Math.PI / 6), 0);
    expect(xy - oy).toBeCloseTo(UNIT / 2, 0);
    expect(yx - ox).toBeCloseTo(-UNIT * Math.cos(Math.PI / 6), 0);
    expect(yy - oy).toBeCloseTo(UNIT / 2, 0);
    expect(zx).toBe(ox);
    expect(zy).toBeLessThan(oy);
  });

  test("known answers: a box shows its top and its two near faces; a cylinder's top is an ellipse", () => {
    const b = box(0, 0, 0, 1, 1, 1);
    expect(points(b.top)).toHaveLength(4);
    expect(points(b.left)).toHaveLength(4);
    expect(points(b.right)).toHaveLength(4);
    // The top's nearest corner is the near faces' shared top corner.
    expect(points(b.left)).toContainEqual(project([1, 1, 1]));
    expect(points(b.right)).toContainEqual(project([1, 1, 1]));
    const { rx, ry } = ellipse(1);
    expect(rx / ry).toBeCloseTo(Math.sqrt(3), 2);
    const c = cylinder(2, 2, 0, 1, 1);
    expect(c.top).toContain(`A${rx} ${ry}`);
    expect(c.right).toBe('');
  });
});

describe('the system', () => {
  const model = system(COUNTS);
  const part = (lab: string) => model.parts.find((p) => p.lab === lab);

  test('a part for each of the five labs, each named, with a caption that counts it', () => {
    expect(model.parts.map((p) => p.lab).sort()).toEqual([
      'backfill',
      'cache',
      'queue',
      'raft',
      'routes',
    ]);
    expect(part('queue')?.caption).toBe('Broker and 3 workers');
    expect(part('cache')?.caption).toBe('4 nodes, coalescing');
    expect(part('raft')?.caption).toBe('5 servers, one database');
    expect(part('routes')?.caption).toBe('Planner and 3 vans');
    expect(part('backfill')?.caption).toBe('Nightly, 7 reports');
  });

  test("as many solids as the labs' opening runs have parts, and the leader marked", () => {
    // The broker and a box a worker; a box a cache node; a cylinder a server; three steps, the
    // warehouse and a sheet a report; the planner and its solver.
    expect(part('queue')?.solids).toHaveLength(1 + COUNTS.workers);
    expect(part('cache')?.solids).toHaveLength(COUNTS.nodes);
    expect(part('raft')?.solids.filter((s) => s.kind === 'cylinder')).toHaveLength(COUNTS.servers);
    expect(part('raft')?.solids.filter((s) => s.role === 'leader')).toHaveLength(1);
    expect(part('backfill')?.solids).toHaveLength(3 + 1 + COUNTS.days);
    expect(part('routes')?.solids).toHaveLength(2);
    // The heartbeats run from the leader to each follower; the vans are spaced by their count.
    expect(model.heartbeats).toHaveLength(COUNTS.servers - 1);
    expect(model.vans).toBe(`3.4 ${Math.round((100 / COUNTS.vans - 3.4) * 10) / 10}`);
    const other = system({ ...COUNTS, workers: 5, nodes: 2, servers: 3, vans: 1, days: 2 });
    const of = (lab: string) => other.parts.find((p) => p.lab === lab)?.solids ?? [];
    expect(of('queue')).toHaveLength(6);
    expect(of('cache')).toHaveLength(2);
    expect(of('raft')).toHaveLength(3);
    expect(of('backfill')).toHaveLength(3 + 1 + 2);
    expect(other.parts.find((p) => p.lab === 'routes')?.caption).toBe('Planner and 1 van');
  });

  test('every path, label and part stands inside the picture, with room for the highest lift', () => {
    const inside = ([x, y]: [number, number]) =>
      x >= 0 && x <= model.width && y >= 0 && y <= model.height;
    const paths = [
      model.plane,
      model.lattice,
      model.inlets,
      model.road,
      model.fetch,
      model.nightly,
      ...model.burst,
      ...model.heartbeats,
      ...model.wires.map((w) => w.d),
      ...model.parts.flatMap((p) => [
        p.pointer,
        ...p.solids.flatMap((s) => [s.top, s.left, s.right]),
      ]),
    ];
    for (const d of paths)
      for (const p of points(d)) expect(inside(p), `${p} in ${d.slice(0, 40)}`).toBe(true);
    for (const p of model.parts) {
      expect(p.bounds[1] - p.lift, `${p.lab} lifted`).toBeGreaterThanOrEqual(0);
      expect(inside([p.label.x, p.label.y]), p.lab).toBe(true);
    }
  });

  test('back to front: a part further back draws first', () => {
    const depth = model.parts.map((p) => Math.min(...p.solids.map((s) => s.depth)));
    expect(depth).toEqual([...depth].sort((a, b) => a - b));
  });

  test("each part's drop lines are as long as its lift, and home.css lifts it as far", () => {
    const css = readFileSync(join(app, 'src/styles/home.css'), 'utf8');
    for (const p of model.parts) {
      expect(p.lift).toBe(LIFT[p.lab]);
      for (const s of p.solids) expect(s.drop.endsWith(`v${p.lift}`), p.lab).toBe(true);
      const rule = new RegExp(`\\.iso-lift-${p.lab}\\b[^{]*\\{\\s*--lift: -(\\d+)px;`);
      const own = rule.exec(css);
      const shared = new RegExp(
        `\\.iso-lift-${p.lab},\\s*\\.iso-lift-\\w+\\s*\\{\\s*--lift: -(\\d+)px;|\\.iso-lift-\\w+,\\s*\\.iso-lift-${p.lab}\\s*\\{\\s*--lift: -(\\d+)px;`,
      ).exec(css);
      const px = Number(own?.[1] ?? shared?.[1] ?? shared?.[2]);
      expect(px, p.lab).toBe(p.lift);
    }
  });
});
