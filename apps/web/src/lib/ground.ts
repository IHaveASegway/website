// Page geometry (design-system.md, "Page geometry"): the fine lines behind a page's top right, drawn
// once at build from the page's own subject. Each section has its own: travel-time contours on Home,
// a ruled sheet in Writing, two street plans that meet at an angle in the Lab, two wheels on About,
// and on the 404 the one stop no route reaches. The drawing is generated, not traced from the Route
// Lab's map data, so it carries no OpenStreetMap notice and costs a few hundred bytes, not the map's
// 30 KB. This module is pure: the same kind and seed give the same paths, byte for byte, so a
// page's markup changes only when its drawing does.

/** Which drawing a page carries. The résumé carries none: it is read and printed, not browsed. */
export type GroundKind = 'home' | 'writing' | 'lab' | 'about' | 'lost';

/** One shape: a line in --ground, a heavier line (an index contour, a margin rule), or the one
 *  mark in the accent, which e2e/ground.spec.ts keeps clear of every line of text. */
export interface GroundPath {
  readonly d: string;
  readonly kind: 'line' | 'index' | 'mark';
}

export interface Ground {
  readonly kind: GroundKind;
  readonly paths: readonly GroundPath[];
  /** A region, in the drawing's units, the lines are cut to. Only the Lab's second plan has one. */
  readonly clip?: string;
  /** The paths drawn inside `clip`. */
  readonly clipped?: readonly GroundPath[];
}

/** The drawing's box: anchored to the page's top right corner and never scaled up. */
export const GROUND_BOX = { width: 1200, height: 900 } as const;

/** A seeded generator (mulberry32 over an FNV-1a hash of the seed), so a page's drawing is fixed. */
export function seeded(seed: string): () => number {
  let h = 2166136261;
  for (const char of seed) h = Math.imul(h ^ char.charCodeAt(0), 16777619);
  let state = h >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r = (value: number) => Math.round(value);

/** A closed path through points, in whole units, each move measured from the point before. */
export function closed(points: readonly (readonly [number, number])[]): string {
  const [first, ...rest] = points.map(([x, y]) => [r(x), r(y)] as const);
  if (!first) return '';
  let [px, py] = first;
  let d = `M${px} ${py}`;
  for (const [x, y] of rest) {
    d += `l${x - px} ${y - py}`;
    [px, py] = [x, y];
  }
  return `${d}z`;
}

/** Contours of travel time around a depot: each one a little wobbly, as real ones are, and every
 *  third one heavier, as index contours are on a survey map. */
function home(random: () => number): Ground {
  const [cx, cy] = [1130, 170];
  const phase = [random() * 6, random() * 6, random() * 6];
  const paths: GroundPath[] = [];
  for (let k = 1; k <= 13; k++) {
    const points: [number, number][] = [];
    for (let a = 0; a < 72; a++) {
      const t = (a / 72) * Math.PI * 2;
      const wobble =
        1 +
        0.12 * Math.sin(3 * t + k * 0.35 + (phase[0] ?? 0)) +
        0.06 * Math.sin(5 * t + (phase[1] ?? 0)) +
        0.03 * Math.sin(9 * t + k * 0.2 + (phase[2] ?? 0));
      const radius = 62 * k * wobble;
      points.push([cx + radius * Math.cos(t), cy + radius * 0.8 * Math.sin(t)]);
    }
    paths.push({ d: closed(points), kind: k % 3 === 0 ? 'index' : 'line' });
  }
  paths.push({ d: `M${cx - 7} ${cy - 7}h14v14h-14z`, kind: 'mark' });
  return { kind: 'home', paths };
}

/** A ruled sheet: a baseline every 24 units, a heavier line every fourth, a margin rule, and crop
 *  marks at the corners of the sheet. */
function writing(): Ground {
  const paths: GroundPath[] = [];
  for (let y = 120, i = 0; y <= GROUND_BOX.height; y += 24, i++) {
    paths.push({ d: `M480 ${y}H1200`, kind: i % 4 === 0 ? 'index' : 'line' });
  }
  paths.push({ d: 'M600 0V900', kind: 'index' });
  const crop = (x: number, y: number, sx: number, sy: number) =>
    `M${x} ${y + sy * 14}v${sy * 26}M${x + sx * 14} ${y}h${sx * 26}`;
  paths.push({
    d: [crop(1140, 80, 1, -1), crop(660, 80, -1, -1), crop(1140, 860, 1, 1)].join(''),
    kind: 'index',
  });
  return { kind: 'writing', paths };
}

/** Two street plans that meet at a seam, the second turned 32 degrees, as a downtown's blocks
 *  often are against the blocks around it. */
function streets(): Ground {
  const step = 40;
  const paths: GroundPath[] = [];
  let d = '';
  for (let x = 440; x <= GROUND_BOX.width; x += step) d += `M${x} 0V900`;
  for (let y = 0; y <= GROUND_BOX.height; y += step) d += `M440 ${y}H1200`;
  paths.push({ d, kind: 'line' });
  // Where the turned plan is, the straight one is not: the seam's region is cut out of the first
  // by drawing the second over a page-colored fill (the --background fill, in global.css).
  const seam = 'M760 420L1200 300V900H860Z';
  paths.push({ d: seam, kind: 'index' });
  const angle = (-32 * Math.PI) / 180;
  const [cos, sin] = [Math.cos(angle), Math.sin(angle)];
  const turn = (x: number, y: number) =>
    `${r(980 + (x - 980) * cos - (y - 600) * sin)} ${r(600 + (x - 980) * sin + (y - 600) * cos)}`;
  let turned = '';
  for (let x = 380; x <= 1580; x += step) turned += `M${turn(x, 0)}L${turn(x, 1200)}`;
  for (let y = 0; y <= 1200; y += step) turned += `M${turn(380, y)}L${turn(1580, y)}`;
  return { kind: 'lab', paths, clip: seam, clipped: [{ d: turned, kind: 'line' }] };
}

/** Two wheels with 36 spokes each and the T of a handlebar: the site's scooter, as geometry. */
function about(): Ground {
  const paths: GroundPath[] = [];
  const wheel = (cx: number, cy: number, radius: number) => {
    const circle = (rr: number) =>
      `M${cx - rr} ${cy}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0`;
    paths.push({ d: circle(radius), kind: 'index' });
    paths.push({ d: circle(r(radius * 0.86)) + circle(r(radius * 0.12)), kind: 'line' });
    let spokes = '';
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const b = a + 0.9;
      spokes += `M${r(cx + radius * 0.12 * Math.cos(a))} ${r(cy + radius * 0.12 * Math.sin(a))}`;
      spokes += `L${r(cx + radius * 0.86 * Math.cos(b))} ${r(cy + radius * 0.86 * Math.sin(b))}`;
    }
    paths.push({ d: spokes, kind: 'line' });
  };
  wheel(780, 640, 135);
  wheel(1060, 640, 135);
  paths.push({ d: 'M920 640V240M830 240H1010', kind: 'index' });
  return { kind: 'about', paths };
}

/** A field of stops, a route through the nearest of them that turns back short, and the one stop
 *  it never reaches, which VROOM would report as unassigned. */
function lost(random: () => number): Ground {
  const stops: [number, number][] = [];
  for (let k = 0; k < 40; k++) stops.push([560 + random() * 620, 40 + random() * 820]);
  const depot: [number, number] = [700, 760];
  // A van's day by nearest neighbour: from the depot, always the closest stop not yet served.
  const left = [...stops];
  const route: [number, number][] = [depot];
  for (let k = 0; k < 12 && left.length > 0; k++) {
    const [x, y] = route[route.length - 1] ?? depot;
    let best = 0;
    left.forEach(([sx, sy], i) => {
      const [bx, by] = left[best] ?? [sx, sy];
      if (Math.hypot(sx - x, sy - y) < Math.hypot(bx - x, by - y)) best = i;
    });
    route.push(...left.splice(best, 1));
  }
  const [ux, uy] = [1120, 150];
  // The last leg heads for the unassigned stop and stops short of it.
  const [lx, ly] = route[route.length - 1] ?? depot;
  route.push([lx + (ux - lx) * 0.6, ly + (uy - ly) * 0.6]);
  const dots = stops.map(([x, y]) => `M${r(x) - 3} ${r(y) - 3}h6v6h-6z`).join('');
  return {
    kind: 'lost',
    paths: [
      { d: dots, kind: 'line' },
      { d: closed(route).slice(0, -1), kind: 'index' },
      { d: `M${ux - 9} ${uy - 9}h18v18h-18z`, kind: 'mark' },
    ],
  };
}

/** The drawing for a kind, from a seed: a page's path, so two pages of a kind could differ. */
export function groundFor(kind: GroundKind, seed: string): Ground {
  const random = seeded(`${kind}:${seed}`);
  switch (kind) {
    case 'home':
      return home(random);
    case 'writing':
      return writing();
    case 'lab':
      return streets();
    case 'about':
      return about();
    case 'lost':
      return lost(random);
  }
}

/** The drawing a page path carries, or null for a page outside the five, such as /colophon/. */
export function groundKindFor(path: string | undefined): GroundKind | null {
  if (path === undefined) return 'lost';
  if (path === '/') return 'home';
  if (path.startsWith('/writing/') || path.startsWith('/notes/')) return 'writing';
  if (path.startsWith('/lab/')) return 'lab';
  if (path.startsWith('/about/')) return 'about';
  return null;
}
