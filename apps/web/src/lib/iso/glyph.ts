// A lab's glyph (docs/design/overhaul.md, "Lab cards" and "The isometric drawing"): its system as a
// small isometric model, boxes, cylinders and wires on one ground tile, projected to SVG paths at
// build. Pure, with no DOM, so the unit tests ask it what the pages draw (test/iso-glyph.test.ts).
// The components draw it (components/iso/Glyph.astro); styles/iso-glyph.css paints it from the
// tokens: the three faces of a solid in --iso-top, --iso-left and --iso-right, lit from the top
// left, edged in the ink; the tile's mesh in --iso-grid; the lab's own wires in its line's colour.
//
// The model is in tile units on the ground plane: x runs to the right and down the page, y to the
// left and down, z up. One unit is UNIT px before the picture is scaled to its box.

/** Pixels per tile unit, before the picture is scaled to its box. */
export const UNIT = 14;
const COS = Math.cos(Math.PI / 6);
const SIN = Math.sin(Math.PI / 6);

/** A point in the model: across, along and up, in tile units. */
export type At = readonly [x: number, y: number, z: number];

/** Where a point of the model lands on the page, in px. */
export function project([x, y, z]: At): [number, number] {
  return [(x - y) * COS * UNIT, (x + y) * SIN * UNIT - z * UNIT];
}

/** What a mark is, which styles/iso-glyph.css paints. */
export type Paint =
  | 'plane' // the tile's edge
  | 'mesh' // a line of the tile's mesh
  | 'top' // a solid's top face
  | 'left' // its face toward the lower left
  | 'right' // its face toward the lower right
  | 'lit' // a top face in the lab's colour: the leader, a message waiting
  | 'off' // the silhouette of a solid that is down, dashed, with no fill
  | 'ghost' // rows a run wrote twice, dashed in the lab's colour
  | 'band' // a ring round a cylinder
  | 'wire' // the lab's path, in its colour
  | 'cut' // a wire to a solid that is down, dashed
  | 'node'; // a junction on a wire, a dot in the lab's colour

/** One SVG path and what it is. */
export interface Mark {
  readonly paint: Paint;
  readonly d: string;
}

/** A solid of the model, drawn as one group: its marks, how far back it stands (drawn back to
 *  front), and its layer, 1 on the ground and up, which a lab's card lifts it by as the card comes
 *  into view (styles/lab-cards.css). */
export interface Solid {
  readonly marks: readonly Mark[];
  readonly depth: number;
  readonly layer: number;
}

/** A glyph: what the tile and the wires draw under the solids, the solids, and the box round all
 *  of it, in px. */
export interface Glyph {
  readonly ground: readonly Mark[];
  readonly wires: readonly Mark[];
  readonly solids: readonly Solid[];
  readonly box: readonly [x: number, y: number, width: number, height: number];
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const pt = (at: At) => project(at).map(r2).join(' ');
const poly = (points: readonly At[], close = true) =>
  `M${points.map(pt).join('L')}${close ? 'Z' : ''}`;

/** The tile: its edge and a line of its mesh every unit, w units across and d along. */
export function tile(w: number, d: number): Mark[] {
  const marks: Mark[] = [];
  for (let x = 1; x < w; x += 1)
    marks.push({
      paint: 'mesh',
      d: poly(
        [
          [x, 0, 0],
          [x, d, 0],
        ],
        false,
      ),
    });
  for (let y = 1; y < d; y += 1)
    marks.push({
      paint: 'mesh',
      d: poly(
        [
          [0, y, 0],
          [w, y, 0],
        ],
        false,
      ),
    });
  marks.push({
    paint: 'plane',
    d: poly([
      [0, 0, 0],
      [w, 0, 0],
      [w, d, 0],
      [0, d, 0],
    ]),
  });
  return marks;
}

export interface BoxOptions {
  /** Its top in the lab's colour. */
  readonly lit?: boolean;
  /** Down: its silhouette dashed, with no fill. */
  readonly off?: boolean;
  /** Rows written twice: dashed in the lab's colour, with no fill. */
  readonly ghost?: boolean;
  readonly layer?: number;
}

/** A box w across, d along and h tall, standing with its least corner at x, y, z. */
export function box(
  [x, y, z]: At,
  [w, d, h]: readonly [number, number, number],
  { lit = false, off = false, ghost = false, layer = 1 }: BoxOptions = {},
): Solid {
  const [x1, y1, z1] = [x + w, y + d, z + h];
  const top = poly([
    [x, y, z1],
    [x1, y, z1],
    [x1, y1, z1],
    [x, y1, z1],
  ]);
  const left = poly([
    [x, y1, z],
    [x1, y1, z],
    [x1, y1, z1],
    [x, y1, z1],
  ]);
  const right = poly([
    [x1, y, z],
    [x1, y1, z],
    [x1, y1, z1],
    [x1, y, z1],
  ]);
  const depth = x + y + (w + d) / 2 + z / 100;
  if (off || ghost) {
    // The silhouette and the near edges, dashed: the place where the solid stands when it is up.
    const paint = ghost ? 'ghost' : 'off';
    const silhouette = poly([
      [x, y, z1],
      [x1, y, z1],
      [x1, y, z],
      [x1, y1, z],
      [x, y1, z],
      [x, y1, z1],
    ]);
    const edges = poly(
      [
        [x, y1, z1],
        [x1, y1, z1],
        [x1, y, z1],
      ],
      false,
    );
    const post = poly(
      [
        [x1, y1, z1],
        [x1, y1, z],
      ],
      false,
    );
    return { marks: [{ paint, d: `${silhouette}${edges}${post}` }], depth, layer };
  }
  return {
    marks: [
      { paint: 'left', d: left },
      { paint: 'right', d: right },
      { paint: lit ? 'lit' : 'top', d: top },
    ],
    depth,
    layer,
  };
}

/** A cylinder of radius r standing at x, y on z, h tall, with `bands` rings round it, as a
 *  database's disks are drawn. */
export function cylinder(
  [x, y, z]: At,
  r: number,
  h: number,
  { bands = 0, layer = 1 }: { readonly bands?: number; readonly layer?: number } = {},
): Solid {
  // A circle on the ground projects to an ellipse √2 cos 30° wide and √2 sin 30° tall per unit of
  // radius, its axes level with the page.
  const rx = r2(r * Math.SQRT2 * COS * UNIT);
  const ry = r2(r * Math.SQRT2 * SIN * UNIT);
  const [cx, bottom] = project([x, y, z]).map(r2) as [number, number];
  const top = r2(bottom - h * UNIT);
  const [l, rr] = [r2(cx - rx), r2(cx + rx)];
  // Left down the side, along the near half of the base, up the right side, back along the near
  // half of the top.
  const body = `M${l} ${top}L${l} ${bottom}A${rx} ${ry} 0 0 0 ${rr} ${bottom}L${rr} ${top}A${rx} ${ry} 0 0 1 ${l} ${top}Z`;
  const lid = `M${l} ${top}A${rx} ${ry} 0 1 1 ${rr} ${top}A${rx} ${ry} 0 1 1 ${l} ${top}Z`;
  const marks: Mark[] = [{ paint: 'left', d: body }];
  for (let k = 1; k <= bands; k += 1) {
    const at = r2(top + ((bottom - top) * k) / (bands + 1));
    marks.push({ paint: 'band', d: `M${l} ${at}A${rx} ${ry} 0 0 0 ${rr} ${at}` });
  }
  marks.push({ paint: 'top', d: lid });
  return { marks, depth: x + y + z / 100, layer };
}

/** A wire along the ground through its points: the lab's path, or one cut. */
export const wire = (points: readonly At[], paint: 'wire' | 'cut' = 'wire'): Mark => ({
  paint,
  d: poly(points, false),
});

/** A junction on a wire. */
export function node(at: At, radius = 2.75): Mark {
  const [cx, cy] = project(at).map(r2) as [number, number];
  return {
    paint: 'node',
    d: `M${r2(cx - radius)} ${cy}a${radius} ${radius} 0 1 0 ${radius * 2} 0a${radius} ${radius} 0 1 0 ${-radius * 2} 0Z`,
  };
}

/** Every number a path names, in pairs: the points it reaches and its arcs' corners. */
function extent(marks: readonly Mark[]): [number, number, number, number] {
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const { d } of marks) {
    // Absolute moves and lines name points. An arc here is half an ellipse level with the page,
    // from one end of its width to the other, so it bulges at most its vertical radius above or
    // below its ends: both are taken.
    for (const [, cmd, args] of d.matchAll(/([MLA])([^MLAZa]*)/g)) {
      const n = (args ?? '')
        .trim()
        .split(/[\s,]+/)
        .map(Number);
      const ry = n[1] ?? 0;
      const pairs =
        cmd === 'A'
          ? [
              [n[5], (n[6] ?? 0) - ry],
              [n[5], (n[6] ?? 0) + ry],
            ]
          : [[n[0], n[1]]];
      for (const [px, py] of pairs) {
        if (px === undefined || py === undefined || Number.isNaN(px) || Number.isNaN(py)) continue;
        [minX, minY, maxX, maxY] = [
          Math.min(minX, px),
          Math.min(minY, py),
          Math.max(maxX, px),
          Math.max(maxY, py),
        ];
      }
    }
  }
  return [minX, minY, maxX, maxY];
}

/** A glyph from its tile, its wires and its solids: the solids sorted back to front, and its box
 *  round everything with room for a stroke. */
export function glyph(
  ground: readonly Mark[],
  wires: readonly Mark[],
  solids: readonly Solid[],
): Glyph {
  const all = [...ground, ...wires, ...solids.flatMap((s) => s.marks)];
  const [minX, minY, maxX, maxY] = extent(all);
  const pad = 6;
  const x = r2(minX - pad);
  const y = r2(minY - pad);
  return {
    ground,
    wires,
    solids: [...solids].sort((a, b) => a.depth - b.depth),
    box: [x, y, r2(maxX + pad - x), r2(maxY + pad - y)],
  };
}

// ---------------------------------------------------------------------------------------------
// The five labs, each from its own opening run (lib/iso/lab-glyphs.ts reads them).

/** The Queue Lab: the publisher, the broker's queue with a lit plate for each order waiting, and a
 *  wire forking to each worker; a worker that is down is its dashed silhouette, its wire cut. */
export function queueGlyph(input: {
  readonly waiting: number;
  readonly workers: readonly { readonly down: boolean }[];
}): Glyph {
  const W = 14;
  const D = 8.5;
  const solids: Solid[] = [];
  const wires: Mark[] = [];
  const middle = 3.5;
  solids.push(box([0.75, middle - 0.75, 0], [1.5, 1.5, 1.5]));
  solids.push(box([3.25, middle - 1, 0], [3.75, 2, 1]));
  // The orders waiting, two rows of plates along the queue's top, at most eight.
  const shown = Math.min(input.waiting, 8);
  for (let k = 0; k < shown; k += 1) {
    const col = Math.floor(k / 2);
    const row = k % 2;
    solids.push(
      box([3.55 + col * 0.85, middle - 0.8 + row * 0.95, 1], [0.6, 0.6, 0.22], {
        lit: true,
        layer: 2,
      }),
    );
  }
  wires.push(
    wire([
      [2.25, middle, 0],
      [3.25, middle, 0],
    ]),
  );
  const fork: At = [8.4, middle, 0];
  wires.push(wire([[7, middle, 0], fork]));
  // The workers spread along the tile's far edge, 0.4 to 6.6 units along.
  const count = input.workers.length;
  input.workers.forEach((worker, k) => {
    const y = count === 1 ? middle - 0.75 : 0.4 + (k * 6.2) / (count - 1);
    const mid = y + 0.75;
    wires.push(wire([fork, [fork[0], mid, 0], [11, mid, 0]], worker.down ? 'cut' : 'wire'));
    solids.push(box([11, y, 0], [1.5, 1.5, 2], { off: worker.down, layer: 2 }));
  });
  wires.push(node(fork));
  return glyph(tile(W, D), wires, solids);
}

/** The Raft Lab: five servers on a circle, the leader taller with its top lit, a wire from it to
 *  each follower; a server that is down is its dashed silhouette, its wire cut. */
export function raftGlyph(input: {
  readonly servers: readonly { readonly leader: boolean; readonly down: boolean }[];
}): Glyph {
  const W = 9;
  const D = 9;
  const [cx, cy, radius] = [4.5, 4.5, 3.1];
  const side = 1.3;
  const at = input.servers.map((_, k) => {
    const angle = -Math.PI / 2 + (k * 2 * Math.PI) / input.servers.length - Math.PI / 4;
    return [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)] as const;
  });
  const leader = input.servers.findIndex((s) => s.leader);
  const wires: Mark[] = [];
  const solids: Solid[] = [];
  input.servers.forEach((server, k) => {
    const [x, y] = at[k] ?? [cx, cy];
    if (leader >= 0 && k !== leader) {
      const [lx, ly] = at[leader] ?? [cx, cy];
      wires.push(
        wire(
          [
            [lx, ly, 0],
            [x, y, 0],
          ],
          server.down ? 'cut' : 'wire',
        ),
      );
    }
    solids.push(
      box([x - side / 2, y - side / 2, 0], [side, side, k === leader ? 2.6 : 1.5], {
        lit: k === leader,
        off: server.down,
        layer: k === leader ? 3 : 2,
      }),
    );
  });
  return glyph(tile(W, D), wires, solids);
}

/** The Cache Lab: readers fanning in to the cache nodes, and the nodes to the database behind
 *  them; a node that is down is its dashed silhouette, its wires cut. */
export function cacheGlyph(input: {
  readonly nodes: readonly { readonly down: boolean }[];
}): Glyph {
  const W = 12.5;
  const D = 9;
  const wires: Mark[] = [];
  const solids: Solid[] = [];
  const readers = 5;
  const inBus = 3.2;
  const outBus = 7.9;
  for (let k = 0; k < readers; k += 1) {
    const y = 0.6 + k * 1.65;
    solids.push(box([0.7, y, 0], [0.8, 0.8, 0.8]));
    wires.push(
      wire([
        [1.5, y + 0.4, 0],
        [inBus, y + 0.4, 0],
      ]),
    );
  }
  wires.push(
    wire([
      [inBus, 1, 0],
      [inBus, 7.6, 0],
    ]),
  );
  const count = input.nodes.length;
  input.nodes.forEach((n, k) => {
    const y = 0.4 + (k * 6.6) / Math.max(1, count - 1);
    const mid = y + 0.8;
    const paint = n.down ? 'cut' : 'wire';
    wires.push(
      wire(
        [
          [inBus, mid, 0],
          [4.7, mid, 0],
        ],
        paint,
      ),
    );
    wires.push(
      wire(
        [
          [6.3, mid, 0],
          [outBus, mid, 0],
        ],
        paint,
      ),
    );
    solids.push(box([4.7, y, 0], [1.6, 1.6, 0.9], { off: n.down, layer: 2 }));
  });
  wires.push(
    wire([
      [outBus, 1.2, 0],
      [outBus, 7.8, 0],
    ]),
  );
  wires.push(
    wire([
      [outBus, 4.5, 0],
      [9.2, 4.5, 0],
    ]),
  );
  wires.push(node([inBus, 4.5, 0]), node([outBus, 4.5, 0]));
  solids.push(cylinder([10.5, 4.5, 0], 1.3, 2.4, { bands: 2, layer: 3 }));
  return glyph(tile(W, D), wires, solids);
}

/** The Backfill Lab: a partition for each day of the week, as tall as the source's orders that
 *  day, rows the report holds past the source dashed on top, and a wire from each day to the
 *  warehouse. */
export function backfillGlyph(input: {
  readonly source: readonly number[];
  readonly report: readonly number[];
}): Glyph {
  const W = 12.5;
  const D = 8.5;
  const most = Math.max(1, ...input.source, ...input.report);
  const scale = (n: number) => (2.6 * n) / most;
  const wires: Mark[] = [];
  const solids: Solid[] = [];
  const bus = 3.6;
  const warehouse: At = [6.25, 6.4, 0];
  input.source.forEach((orders, k) => {
    const x = 0.55 + k * 1.65;
    const h = Math.max(0.3, scale(orders));
    solids.push(box([x, 0.8, 0], [1.15, 1.15, h], { layer: 2 }));
    const extra = (input.report[k] ?? 0) - orders;
    if (extra > 0)
      solids.push(box([x, 0.8, h], [1.15, 1.15, scale(extra)], { ghost: true, layer: 3 }));
    wires.push(
      wire([
        [x + 0.575, 1.95, 0],
        [x + 0.575, bus, 0],
      ]),
    );
  });
  const first = 0.55 + 0.575;
  const last = 0.55 + (input.source.length - 1) * 1.65 + 0.575;
  wires.push(
    wire([
      [first, bus, 0],
      [last, bus, 0],
    ]),
  );
  wires.push(
    wire([
      [warehouse[0], bus, 0],
      [warehouse[0], warehouse[1], 0],
    ]),
  );
  wires.push(node([warehouse[0], bus, 0]));
  solids.push(cylinder(warehouse, 1.35, 1.9, { bands: 1, layer: 1 }));
  return glyph(tile(W, D), wires, solids);
}

/** The Route Lab: the day's places on the tile, the bakery a box among them in the lab's colour,
 *  each order a pin, and each van's route from the bakery through its stops and back along the
 *  tile's blocks, in the lab's colour. The places keep their order across and along the map,
 *  west to east and north to south, but are spread evenly, as a schematic map spreads a city's
 *  crowded middle, so a stop in town does not sit on the next. */
export function routesGlyph(input: {
  readonly bakery: readonly [number, number];
  readonly routes: readonly (readonly (readonly [number, number])[])[];
}): Glyph {
  const W = 12;
  const D = 9;
  const room = 1;
  const places = [input.bakery, ...input.routes.flat()];
  // Each place by its rank across and its rank along, ties sharing a rank.
  const ranks = (values: readonly number[]) => {
    const sorted = [...new Set(values)].sort((a, b) => a - b);
    const last = Math.max(1, sorted.length - 1);
    return (v: number) => sorted.indexOf(v) / last;
  };
  const across = ranks(places.map(([x]) => x));
  const along = ranks(places.map(([, y]) => y));
  const on = ([x, y]: readonly [number, number]): At => [
    room + across(x) * (W - 2 * room),
    room + along(y) * (D - 2 * room),
    0,
  ];
  const home = on(input.bakery);
  const wires: Mark[] = [];
  const solids: Solid[] = [];
  // Each leg along the tile's lines, across and then along, as a van drives a city's blocks.
  const blocks = (stops: readonly At[]): At[] =>
    stops.flatMap((at, k) => {
      const from = stops[k - 1];
      return from ? [[at[0], from[1], 0] as At, at] : [at];
    });
  input.routes.forEach((route) => {
    if (route.length > 0) wires.push(wire(blocks([home, ...route.map(on), home])));
  });
  for (const stop of input.routes.flat()) solids.push(cylinder(on(stop), 0.22, 0.55, { layer: 2 }));
  solids.push(box([home[0] - 0.6, home[1] - 0.6, 0], [1.2, 1.2, 1.4], { lit: true, layer: 3 }));
  return glyph(tile(W, D), wires, solids);
}
