import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import {
  cluster,
  CLUSTER,
  floorEllipse,
  fmt,
  frame,
  HEARTBEAT_S,
  prism,
  project,
  routePicture,
  stack,
  STACK,
  type P2,
} from '../src/lib/iso';

// Home's isometric drawings (lib/iso.ts; ADR 0023), with known answers. The pictures are SVG the
// build writes, and what moves in them is the stylesheet's, so the last block holds global.css to
// the geometry: a leg, a slab or a beat the module draws has the rule that moves it.

const css = readFileSync(new URL('../src/styles/global.css', import.meta.url), 'utf8');
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

  test('every follower gets a heartbeat, and each ends at its middle on the floor', () => {
    expect(scene.packets.map((p) => p.to)).toEqual([2, 3, 4, 5]);
    for (const packet of scene.packets) {
      const server = scene.servers.find((s) => s.id === packet.to);
      const end = through(packet.transform, 1, 0);
      // The middle of the follower's footprint, on the floor, is the middle of its roof's points
      // dropped by its height.
      const roof = (server?.faces.top ?? '').split(' ').map((p) => p.split(',').map(Number));
      const mx = roof.reduce((sum, [x = 0]) => sum + x, 0) / roof.length;
      const my = roof.reduce((sum, [, y = 0]) => sum + y, 0) / roof.length + CLUSTER.height;
      expect(close(end.x, mx, 0.2) && close(end.y, my, 0.2), `to ${packet.to}`).toBe(true);
    }
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

describe('the stack and the route picture', () => {
  test('a slab per principle, numbered from the foot, up to the most the stylesheet names', () => {
    expect(stack(5).slabs.map((s) => s.n)).toEqual([1, 2, 3, 4, 5]);
    expect(() => stack(STACK.most + 1)).toThrow(/up to 8 slabs/);
  });

  test("the van's legs run stop to stop and bring it home", () => {
    const picture = routePicture();
    expect(picture.legs).toHaveLength(6);
    const last = picture.legs.at(-1);
    const home = through(last?.transform ?? '', 1, 0);
    expect(close(home.x, picture.home.x, 0.2) && close(home.y, picture.home.y, 0.2)).toBe(true);
    const first = through(picture.legs[0]?.transform ?? '', 0, 0);
    expect(close(first.x, picture.home.x, 0.2) && close(first.y, picture.home.y, 0.2)).toBe(true);
  });
});

describe('global.css moves what the module draws', () => {
  test('a heartbeat lasts HEARTBEAT_S, in the hero and on the card', () => {
    const beats = [...css.matchAll(/animation-name: iso-beat;\s*animation-duration: ([\d.]+)s/g)];
    expect(beats.map(([, s]) => Number(s))).toEqual([HEARTBEAT_S]);
  });

  test('each of the van legs after the first waits its turn, and there is no rule for a seventh', () => {
    const { legs } = routePicture();
    const round = Number(/iso-leg;\s*animation-duration: ([\d.]+)s/.exec(css)?.[1]);
    for (let leg = 2; leg <= legs.length; leg++) {
      const delay = new RegExp(`data-leg='${leg}'\\]\\s*\\{\\s*animation-delay: ([\\d.]+)s`).exec(
        css,
      );
      expect(Number(delay?.[1]), `leg ${leg}`).toBeCloseTo(((leg - 1) * round) / legs.length, 5);
    }
    expect(css).not.toContain(`data-leg='${legs.length + 1}'`);
  });

  test('every slab the stack may draw has its principle’s timeline, and the section shares them', () => {
    for (let n = 1; n <= STACK.most; n++) {
      expect(css, `principle ${n}`).toContain(
        `.principle[data-step='${n}'] {\n        view-timeline-name: --principle-${n};`,
      );
      expect(css, `slab ${n}`).toMatch(
        new RegExp(
          `\\.iso-slab\\[data-step='${n}'\\] \\{[^}]*animation-timeline: --principle-${n};`,
        ),
      );
      expect(/timeline-scope:([^;]+);/.exec(css)?.[1], `scope ${n}`).toContain(`--principle-${n}`);
    }
    expect(css).not.toContain(`data-step='${STACK.most + 1}'`);
  });
});
