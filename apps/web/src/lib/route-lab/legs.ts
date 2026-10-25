import type { PackedLegs } from './data';

// Road geometry for the Route Lab's legs, unpacked. The pipeline stores every leg between two of
// the 64 places as the union graph of all OSRM routes plus a few base-36 digits per leg: at each
// vertex with more than one way on, the digit says which way the leg takes. This is a port of the
// reference decoder, decodeLegs in tools/route-data/pipeline/lib/legs.mjs, which the pipeline runs
// over every leg; test/route-lab.test.ts checks this one against the same rules. It runs at build,
// for the picture without JavaScript, and in the browser, for every plan a visitor makes.

/** A polyline as flat viewBox coordinates: x0, y0, x1, y1, ... */
export type Line = number[];

interface Segment {
  readonly a: number;
  readonly b: number;
  readonly line: Line;
}

/** The segments of the union graph, each with its own points from end a to end b. */
function segments({ verts, segs }: PackedLegs): { segments: Segment[]; flags: number[] } {
  const vx: number[] = [];
  const vy: number[] = [];
  for (let k = 0, x = 0, y = 0; k < verts.length; k += 2) {
    vx.push((x += verts[k] ?? 0));
    vy.push((y += verts[k + 1] ?? 0));
  }
  const out: Segment[] = [];
  const flags: number[] = [];
  for (let k = 0; k < segs.length;) {
    const a = segs[k] ?? 0;
    const b = segs[k + 1] ?? 0;
    flags.push(segs[k + 2] ?? 0);
    const inner = segs[k + 3] ?? 0;
    k += 4;
    let x = vx[a] ?? 0;
    let y = vy[a] ?? 0;
    const line = [x, y];
    for (let p = 0; p < inner; p++, k += 2) line.push((x += segs[k] ?? 0), (y += segs[k + 1] ?? 0));
    line.push(vx[b] ?? 0, vy[b] ?? 0);
    out.push({ a, b, line });
  }
  return { segments: out, flags };
}

/** The line a segment draws from the other end: the same points, back to front. */
function reversed(line: Line): Line {
  const out: Line = [];
  for (let k = line.length - 2; k >= 0; k -= 2) out.push(line[k] ?? 0, line[k + 1] ?? 0);
  return out;
}

/**
 * Unpacks the legs. Returns leg(i, j), the road from place i to place j as one line. Throws on a
 * leg that does not arrive, so damaged data fails loudly instead of drawing nonsense.
 */
export function decodeLegs(packed: PackedLegs): (i: number, j: number) => Line {
  const { segments: segs, flags } = segments(packed);
  // The ways on from each vertex: a segment leaving from end a (flag 1) or from end b (flag 2),
  // in segment order, a before b.
  const ways: [number, 0 | 1][][] = [];
  segs.forEach(({ a, b }, index) => {
    if ((flags[index] ?? 0) & 1) (ways[a] ??= []).push([index, 0]);
    if ((flags[index] ?? 0) & 2) (ways[b] ??= []).push([index, 1]);
  });
  const codes = packed.legs.split(',');
  const n = packed.starts.length;
  return (i, j) => {
    const digits = codes[i * (n - 1) + (j < i ? j : j - 1)] ?? '';
    const goal = packed.starts[j];
    let v = packed.starts[i] ?? -1;
    let d = 0;
    const out: Line = [];
    do {
      const options = ways[v] ?? [];
      const way = options.length > 1 ? options[parseInt(digits[d++] ?? '', 36)] : options[0];
      const segment = way && segs[way[0]];
      if (!way || !segment || out.length > 1e5) throw new Error(`leg ${i} to ${j} does not arrive`);
      const line = way[1] === 0 ? segment.line : reversed(segment.line);
      out.push(...(out.length === 0 ? line : line.slice(2)));
      v = way[1] === 0 ? segment.b : segment.a;
    } while (v !== goal);
    return out;
  };
}

/** One route through places in order, as one line: each leg, end to end. */
export function routeLine(leg: (i: number, j: number) => Line, places: readonly number[]): Line {
  const out: Line = [];
  for (let k = 1; k < places.length; k++) {
    const line = leg(places[k - 1] ?? 0, places[k] ?? 0);
    out.push(...(out.length === 0 ? line : line.slice(2)));
  }
  return out;
}

/** The steps of a line after its first point, each as a move from the last: "l" and each move
 *  that is not zero. */
function steps(line: Line): string {
  let d = 'l';
  let first = true;
  for (let k = 2; k < line.length; k += 2) {
    const dx = (line[k] ?? 0) - (line[k - 2] ?? 0);
    const dy = (line[k + 1] ?? 0) - (line[k - 1] ?? 0);
    if (dx === 0 && dy === 0) continue;
    d += `${!first && dx >= 0 ? ' ' : ''}${dx}${dy >= 0 ? ' ' : ''}${dy}`;
    first = false;
  }
  return d;
}

/** A line as SVG path data: the first point in full, then each step as a move from the last, as
 *  integers. */
export function pathData(line: Line): string {
  const step = steps(line);
  return step === 'l' ? '' : `M${line[0]} ${line[1]}${step}`;
}

/**
 * Every segment of the graph once, as one path: the streets the legs run on, which the basemap
 * leaves out (it draws tertiary roads and up). Segments go in the vertices' z-order, each starting
 * with a move from where the last one ended, so neighbours sit together and the moves stay short:
 * a sixth fewer bytes after gzip than a full move to each segment, in segment order.
 */
export function networkPath(packed: PackedLegs): string {
  const { segments: segs } = segments(packed);
  let d = '';
  let x = 0;
  let y = 0;
  for (const { line } of [...segs].sort((p, q) => p.a - q.a)) {
    const step = steps(line);
    if (step === 'l') continue; // a segment of zero length draws nothing
    const [sx = 0, sy = 0] = line;
    const dy = sy - y;
    d += d === '' ? `M${sx} ${sy}` : `m${sx - x}${dy >= 0 ? ' ' : ''}${dy}`;
    d += step;
    x = line[line.length - 2] ?? 0;
    y = line[line.length - 1] ?? 0;
  }
  return d;
}
