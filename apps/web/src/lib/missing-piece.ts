// The 404's drawing (docs/design/overhaul.md, "404"; ADR 0027): the system Home draws, small, with
// one solid missing and its place drawn dashed in the accent, the piece a visitor came for. A
// request comes in at the left, lit in the accent, through Routes, and stops at the dashed contour
// where the Queue should stand; the rest stands as built, wired along the plane's axes. Isometric:
// the plane's two axes run 30° either side of the horizontal, and height is straight up.
//
// Drawn at build, as SVG, by this pure module: the same call gives the same markup, byte for byte,
// so the page changes only when the drawing does. No library: a box, a cylinder and a wire are a
// few lines of projection each. When Home's drawing (components/iso/System.astro) lands, the 404
// can draw that one with a solid left out, and this module goes; until then it is the 404's own.

/** Grid units to the drawing's units: one cell of the plane. */
const UNIT = 24;
const COS = Math.cos(Math.PI / 6);
const SIN = 0.5;

/** A point on the drawing, from a point in the model: x and y on the plane, z up. */
export function project(x: number, y: number, z = 0): readonly [number, number] {
  return [(x - y) * COS * UNIT, (x + y) * SIN * UNIT - z * UNIT];
}

const n = (value: number) => Math.round(value * 10) / 10;
const pt = ([x, y]: readonly [number, number]) => `${n(x)} ${n(y)}`;
const poly = (points: readonly (readonly [number, number])[]) => `M${points.map(pt).join('L')}Z`;

/** One shape the page draws, by its role: the plane, a wire, a face of a solid, the missing
 *  solid's contour, or a label. */
export type PieceRole = 'plane' | 'lattice' | 'wire' | 'lit' | 'top' | 'left' | 'right' | 'missing';

export interface PiecePath {
  readonly role: PieceRole;
  readonly d: string;
}

export interface PieceLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  /** Which end of the text stands at x. */
  readonly anchor: 'start' | 'end';
}

export interface MissingPiece {
  /** The viewBox, fitted to what is drawn with a margin. */
  readonly box: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly paths: readonly PiecePath[];
  readonly labels: readonly PieceLabel[];
}

interface Solid {
  readonly name: string;
  readonly shape: 'box' | 'cylinder';
  /** The footprint's back corner (a box) or its centre (a cylinder), on the plane. */
  readonly x: number;
  readonly y: number;
  /** A box's sides along x and y, or a cylinder's diameter (both the same). */
  readonly w: number;
  readonly d: number;
  readonly h: number;
  readonly missing?: boolean;
  /** Its label stands left of its front corner, where a wire runs past the right. */
  readonly labelLeft?: boolean;
}

/** The model, the labs as Home wires them, smaller: requests through Routes into the Queue, the
 *  Queue on to Raft and to the Cache, the Cache in front of the database, and the nightly Backfill
 *  from the database to the warehouse. The plane is 15 by 10 cells. */
const PLANE = { w: 15, d: 10 } as const;
const SOLIDS: readonly Solid[] = [
  { name: 'Routes', shape: 'box', x: 1, y: 1.5, w: 2, d: 2, h: 1, labelLeft: true },
  { name: 'Queue', shape: 'box', x: 6, y: 1.5, w: 2, d: 2, h: 1.5, missing: true },
  { name: 'Raft', shape: 'box', x: 11, y: 1.5, w: 2, d: 2, h: 2 },
  { name: 'Cache', shape: 'box', x: 1, y: 6.5, w: 2, d: 2, h: 0.75 },
  { name: 'Database', shape: 'cylinder', x: 7, y: 7.5, w: 2, d: 2, h: 1.5 },
  { name: 'Backfill', shape: 'cylinder', x: 12, y: 7.5, w: 2, d: 2, h: 1 },
];
/** The wires, as runs of points on the plane; the lit run is the request's way in. */
const LIT: readonly (readonly [number, number])[] = [
  [-1.5, 2.5],
  [1, 2.5],
  [3, 2.5],
  [6, 2.5],
];
const WIRES: readonly (readonly (readonly [number, number])[])[] = [
  [
    [8, 2.5],
    [11, 2.5],
  ],
  [
    [7, 3.5],
    [7, 5],
    [2, 5],
    [2, 6.5],
  ],
  [
    [3, 7.5],
    [6, 7.5],
  ],
  [
    [8, 7.5],
    [11, 7.5],
  ],
];

const line = (points: readonly (readonly [number, number])[]) =>
  `M${points.map(([x, y]) => pt(project(x, y))).join('L')}`;

/** A box's three faces a viewer sees, lit from the top left: its top, its left front (y + d) and
 *  its right front (x + w). */
function box(s: Solid): PiecePath[] {
  const top = s.h;
  const faces: PiecePath[] = [
    {
      role: 'left',
      d: poly([
        project(s.x, s.y + s.d),
        project(s.x + s.w, s.y + s.d),
        project(s.x + s.w, s.y + s.d, top),
        project(s.x, s.y + s.d, top),
      ]),
    },
    {
      role: 'right',
      d: poly([
        project(s.x + s.w, s.y),
        project(s.x + s.w, s.y + s.d),
        project(s.x + s.w, s.y + s.d, top),
        project(s.x + s.w, s.y, top),
      ]),
    },
    {
      role: 'top',
      d: poly([
        project(s.x, s.y, top),
        project(s.x + s.w, s.y, top),
        project(s.x + s.w, s.y + s.d, top),
        project(s.x, s.y + s.d, top),
      ]),
    },
  ];
  if (!s.missing) return faces;
  // The missing box: every edge of it, the hidden ones too, as one dashed contour and no fill.
  const c = (x: number, y: number, z: number) => pt(project(x, y, z));
  const { x, y, w, d } = s;
  let edges = '';
  for (const z of [0, top])
    edges += `M${c(x, y, z)}L${c(x + w, y, z)}L${c(x + w, y + d, z)}L${c(x, y + d, z)}Z`;
  for (const [ex, ey] of [
    [x, y],
    [x + w, y],
    [x + w, y + d],
    [x, y + d],
  ] as const)
    edges += `M${c(ex, ey, 0)}L${c(ex, ey, top)}`;
  return [{ role: 'missing', d: edges }];
}

/** A cylinder: its side, its top and a band a third of the way down, a database's drum. */
function cylinder(s: Solid): PiecePath[] {
  const r = s.w / 2;
  const [cx, cy] = project(s.x, s.y);
  const rx = Math.SQRT2 * r * COS * UNIT;
  const ry = Math.SQRT2 * r * SIN * UNIT;
  const top = cy - s.h * UNIT;
  const band = cy - (s.h * UNIT) / 3;
  const arc = (y: number) => `M${n(cx - rx)} ${n(y)}A${n(rx)} ${n(ry)} 0 0 0 ${n(cx + rx)} ${n(y)}`;
  return [
    {
      role: 'left',
      d: `M${n(cx - rx)} ${n(top)}L${n(cx - rx)} ${n(cy)}A${n(rx)} ${n(ry)} 0 0 0 ${n(cx + rx)} ${n(cy)}L${n(cx + rx)} ${n(top)}Z${arc(band)}`,
    },
    {
      role: 'top',
      d: `M${n(cx - rx)} ${n(top)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx + rx)} ${n(top)}A${n(rx)} ${n(ry)} 0 1 0 ${n(cx - rx)} ${n(top)}Z`,
    },
  ];
}

/** Where a solid's label stands: under its front corner on the plane, to the right, or for a box
 *  whose right a wire leaves from, under its left corner, ending there. */
function labelOf(s: Solid): PieceLabel {
  if (s.labelLeft) {
    const [x, y] = project(s.x, s.y + s.d);
    return { text: s.name, x: n(x - 4), y: n(y + 16), anchor: 'end' };
  }
  const [x, y] = s.shape === 'box' ? project(s.x + s.w, s.y + s.d) : project(s.x, s.y);
  const dy = s.shape === 'box' ? 18 : Math.SQRT2 * (s.w / 2) * SIN * UNIT + 16;
  return { text: s.name, x: n(x + (s.shape === 'box' ? 6 : -14)), y: n(y + dy), anchor: 'start' };
}

/** The 404's drawing: the plane and its lattice, the wires, the request's lit way in, then the solids
 *  back to front, so a nearer one covers a farther one, and a label under each solid but the
 *  missing one. */
export function missingPiece(): MissingPiece {
  const paths: PiecePath[] = [];
  const corners = [
    project(0, 0),
    project(PLANE.w, 0),
    project(PLANE.w, PLANE.d),
    project(0, PLANE.d),
  ] as const;
  paths.push({ role: 'plane', d: poly(corners) });
  let lattice = '';
  for (let i = 1; i < PLANE.w; i++) lattice += `M${pt(project(i, 0))}L${pt(project(i, PLANE.d))}`;
  for (let j = 1; j < PLANE.d; j++) lattice += `M${pt(project(0, j))}L${pt(project(PLANE.w, j))}`;
  paths.push({ role: 'lattice', d: lattice });
  for (const wire of WIRES) paths.push({ role: 'wire', d: line(wire) });
  paths.push({ role: 'lit', d: line(LIT) });
  const order = [...SOLIDS].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const s of order) paths.push(...(s.shape === 'box' ? box(s) : cylinder(s)));
  const labels = SOLIDS.filter((s) => !s.missing).map(labelOf);
  // The box: everything drawn, the plane's corners, the tallest solid and the labels, plus room.
  const xs = [
    ...corners.map(([x]) => x),
    ...labels.map((l) => (l.anchor === 'start' ? l.x + 60 : l.x - 60)),
    project(-1.5, 2.5)[0],
  ];
  const ys = [
    ...corners.map(([, y]) => y),
    ...SOLIDS.map((s) => project(s.x, s.y, s.h + (s.shape === 'cylinder' ? 1 : 0))[1]),
    ...labels.map((l) => l.y + 4),
  ];
  const margin = 8;
  const minX = Math.floor(Math.min(...xs)) - margin;
  const minY = Math.floor(Math.min(...ys)) - margin;
  return {
    box: {
      x: minX,
      y: minY,
      width: Math.ceil(Math.max(...xs)) + margin - minX,
      height: Math.ceil(Math.max(...ys)) + margin - minY,
    },
    paths,
    labels,
  };
}
