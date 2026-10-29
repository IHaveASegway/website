import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  cluster,
  CLUSTER,
  floorEllipse,
  fmt,
  frame,
  prism,
  project,
  STORY,
  type P2,
} from '../src/lib/iso';

// Home's isometric drawing (lib/iso.ts; ADR 0023, ADR 0024), with known answers. The picture is
// SVG the build writes, and what moves in it is Home's stylesheet's, so the last block holds
// home.css to the story the module tells: every act it draws has the rule that moves it, on the
// story's one loop.

const css = readFileSync(new URL('../src/styles/home.css', import.meta.url), 'utf8');
const close = (a: number, b: number, eps = 0.06) => Math.abs(a - b) <= eps;

/** Where a frame's matrix(a b c d e f) puts the local point (x, y). */
function through(transform: string, x: number, y: number): P2 {
  const [a = 0, b = 0, c = 0, d = 0, e = 0, f = 0] = (
    /matrix\(([^)]+)\)/.exec(transform)?.[1] ?? ''
  )
    .split(' ')
    .map(Number);
  return { x: a * x + c * y + e, y: b * x + d * y + f };
}

describe('the projection', () => {
  test('known answers: each floor axis 30° off the horizontal, z straight up', () => {
    const x = project({ x: 100, y: 0, z: 0 });
    expect(close(x.x, 86.6) && close(x.y, 50)).toBe(true);
    const y = project({ x: 0, y: 100, z: 0 });
    expect(close(y.x, -86.6) && close(y.y, 50)).toBe(true);
    expect(project({ x: 0, y: 0, z: 40 })).toEqual({ x: 0, y: -40 });
  });

  test('a number is written to one place, and never as -0', () => {
    expect(fmt(1.26)).toBe('1.3');
    expect(fmt(-0.01)).toBe('0');
    expect(fmt(-1.24)).toBe('-1.2');
  });

  test("a box's three faces share its front corner, and the roof sits h above the floor", () => {
    const faces = prism(0, 0, 0, 10, 10, 20);
    const front = project({ x: 10, y: 10, z: 0 });
    const corner = `${fmt(front.x)},${fmt(front.y)}`;
    expect(faces.left.split(' ')).toContain(corner);
    expect(faces.right.split(' ')).toContain(corner);
    const roof = project({ x: 10, y: 10, z: 20 });
    expect(faces.top.split(' ')).toContain(`${fmt(roof.x)},${fmt(roof.y)}`);
  });

  test('a floor circle is an ellipse √(3/2) wide and √(1/2) tall', () => {
    expect(floorEllipse(0, 0, 0, 10)).toEqual({ cx: '0', cy: '0', rx: '12.2', ry: '7.1' });
  });

  test('a frame maps one unit along x to its whole path, and a unit across it to a pixel', () => {
    const from = { x: 3, y: 4 };
    const to = { x: 63, y: -76 };
    const { transform, length } = frame(from, to);
    expect(length).toBe(100);
    const start = through(transform, 0, 0);
    const end = through(transform, 1, 0);
    expect(close(start.x, 3) && close(start.y, 4)).toBe(true);
    expect(close(end.x, 63) && close(end.y, -76)).toBe(true);
    const side = through(transform, 0, 1);
    expect(close(Math.hypot(side.x - 3, side.y - 4), 1, 1e-3)).toBe(true);
  });
});

describe("Home's cluster", () => {
  const scene = cluster();

  test('five servers, one leader, painted back to front', () => {
    expect(scene.servers).toHaveLength(5);
    expect(scene.servers.filter((s) => s.leader).map((s) => s.id)).toEqual([1]);
    const depths = scene.servers.map((s) => s.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
    // The leader stands at the back: painted first.
    expect(scene.servers[0]?.leader).toBe(true);
  });

  /** The middle of a server's footprint on the floor: its roof's points, dropped by its height. */
  const middle = (id: number): P2 => {
    const server = scene.servers.find((s) => s.id === id);
    const roof = (server?.faces.top ?? '').split(' ').map((p) => p.split(',').map(Number));
    return {
      x: roof.reduce((sum, [x = 0]) => sum + x, 0) / roof.length,
      y: roof.reduce((sum, [, y = 0]) => sum + y, 0) / roof.length + CLUSTER.height,
    };
  };

  test('every message ends at its receiver’s middle on the floor, and leaves from its sender’s side', () => {
    expect(scene.trips.length).toBeGreaterThan(0);
    for (const trip of scene.trips) {
      const end = through(trip.transform, 1, 0);
      const goal = middle(trip.to);
      expect(
        close(end.x, goal.x, 0.2) && close(end.y, goal.y, 0.2),
        `${trip.from}→${trip.to}`,
      ).toBe(true);
      // It starts nearer its sender than its receiver.
      const start = through(trip.transform, 0, 0);
      const from = middle(trip.from);
      expect(
        Math.hypot(start.x - from.x, start.y - from.y) <
          Math.hypot(start.x - goal.x, start.y - goal.y),
      ).toBe(true);
    }
  });

  test('the story is a Raft election: the fullest timer stands, and a majority elects it', () => {
    const acts = new Map(STORY.acts.map((a) => [a.act, a]));
    // The leader sends heartbeats to every other server.
    expect([...(acts.get('beat')?.to ?? [])].sort()).toEqual([2, 3, 4, 5]);
    // The candidate is the follower whose election timer stands fullest: it times out first.
    const dials: readonly number[] = CLUSTER.dials;
    const fullest = dials.indexOf(Math.max(...dials)) + 2;
    expect(STORY.candidate).toBe(fullest);
    expect(acts.get('ask')?.from).toEqual([STORY.candidate]);
    // It asks every other server, the crashed leader too, and wins with its own vote and those it
    // gets back: a majority of five, from servers that are up.
    const votes = acts.get('vote')?.from ?? [];
    expect(votes).not.toContain(STORY.leader);
    expect(votes.length + 1).toBeGreaterThan(5 / 2);
    expect(acts.get('vote')?.to).toEqual([STORY.candidate]);
    // Its heartbeats as leader reach every live follower, then the old leader once it is back.
    expect([...(acts.get('lead')?.to ?? []), ...(acts.get('rejoin')?.to ?? [])].sort()).toEqual([
      1, 2, 4, 5,
    ]);
    expect(STORY.terms[1]).toBe((STORY.terms[0] ?? 0) + 1);
  });

  test("the leader's log holds one entry more than a follower's, not yet committed", () => {
    const leader = scene.servers.find((s) => s.leader);
    expect(leader?.log.map((e) => e.committed)).toEqual([true, true, true, true, false]);
    for (const s of scene.servers.filter((s) => !s.leader))
      expect(s.log.every((e) => e.committed)).toBe(true);
  });

  test('the viewBox holds every point drawn', () => {
    const [x = 0, y = 0, w = 0, h = 0] = scene.viewBox.split(' ').map(Number);
    const all = [
      scene.platform.top,
      scene.platform.left,
      scene.platform.right,
      ...scene.servers.flatMap((s) => [s.faces.top, s.faces.left, s.faces.right]),
    ]
      .flatMap((points) => points.split(' '))
      .map((p) => p.split(',').map(Number));
    for (const [px = 0, py = 0] of all) {
      expect(px >= x && px <= x + w, `x ${px}`).toBe(true);
      expect(py >= y && py <= y + h, `y ${py}`).toBe(true);
    }
  });
});

describe('home.css moves what the module draws', () => {
  test('every act the cluster draws has its animation, and no rule names an act it does not', () => {
    for (const { act } of STORY.acts)
      expect(css, act).toMatch(
        new RegExp(`\\.iso-packet\\[data-act='${act}'\\] \\{\\s*animation-name: raft-${act};`),
      );
    const named = [...css.matchAll(/data-act='([a-z-]+)'/g)].map(([, act]) => act);
    expect(new Set(named)).toEqual(new Set(STORY.acts.map((a) => a.act)));
  });

  test('every part of the story runs on its one loop of STORY.seconds', () => {
    const durations = [...css.matchAll(/\.iso-cluster[^{]*\{\s*animation-duration: ([\d.]+)s;/g)];
    expect(durations.map(([, s]) => Number(s))).toEqual([STORY.seconds]);
    for (const name of css.matchAll(/animation-name: (raft-[a-z0-9-]+);/g))
      expect(css, name[1]).toContain(`@keyframes ${name[1]} {`);
  });
});
