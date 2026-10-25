// Road geometry for every ordered pair of points, packed as one small graph plus a few digits per
// leg.
//
// Every leg is an OSRM route. Together they cover a few thousand street segments, and most legs
// share most of their streets, so the geometry is stored once, as the union graph of all legs:
// vertices where legs split or join, and segments between them. A leg is then its start point and,
// at each vertex where more than one way on is used by some leg, the index of the way it takes.
// Ways on are listed in segment order, and segments are numbered most-used first, so most digits
// are 0. The decoder (decodeLegs, below) is the reference the browser code ports; the pipeline
// decodes every leg it encodes and fails on any difference.

import { dedupe, simplify } from './geom.mjs';

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz';

/**
 * routes: Map "i,j" -> { ids: string[] node ids (first `S<i>`, last `S<j>`), pts: [x, y][] }.
 * starts: per point, its virtual vertex id `S<i>`.
 */
export function encodeLegs(routes, n, { tolerance }) {
  const pos = new Map(); // node id -> [x, y] (float viewBox)
  const edges = new Map(); // "a|b" sorted -> { a, b, fwd, bwd, count }
  const adj = new Map(); // node -> Set(node)
  const uturn = new Set();
  const ekey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const { ids, pts } of routes.values()) {
    for (let k = 0; k < ids.length; k++) {
      if (!pos.has(ids[k])) pos.set(ids[k], pts[k]);
      if (k + 2 < ids.length && ids[k] === ids[k + 2]) uturn.add(ids[k + 1]);
      if (k === 0) continue;
      const a = ids[k - 1];
      const b = ids[k];
      if (a === b) throw new Error(`repeated node ${a}`);
      const key = ekey(a, b);
      let e = edges.get(key);
      if (!e) {
        e = { a: a < b ? a : b, b: a < b ? b : a, fwd: false, bwd: false };
        edges.set(key, e);
      }
      if (a === e.a) e.fwd = true;
      else e.bwd = true;
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    }
  }
  const isVertex = (id) => id.startsWith('S') || uturn.has(id) || adj.get(id).size !== 2;

  // Segments: walk from every vertex along every edge to the next vertex.
  const segOfEdge = new Map(); // edge key -> segment
  const segments = [];
  for (const v of adj.keys()) {
    if (!isVertex(v)) continue;
    for (const first of adj.get(v)) {
      if (segOfEdge.has(ekey(v, first))) continue;
      const nodes = [v, first];
      while (!isVertex(nodes.at(-1))) {
        const cur = nodes.at(-1);
        const prev = nodes.at(-2);
        const [next] = [...adj.get(cur)].filter((x) => x !== prev);
        nodes.push(next);
      }
      const seg = { nodes, fwd: false, bwd: false, uses: 0 };
      for (let k = 1; k < nodes.length; k++) {
        const e = edges.get(ekey(nodes[k - 1], nodes[k]));
        const forward = nodes[k - 1] === e.a;
        seg.fwd ||= forward ? e.fwd : e.bwd;
        seg.bwd ||= forward ? e.bwd : e.fwd;
        segOfEdge.set(ekey(nodes[k - 1], nodes[k]), seg);
      }
      segments.push(seg);
    }
  }

  // Count uses, then number segments most-used first.
  const walk = (ids, visit) => {
    let k = 0;
    while (k < ids.length - 1) {
      const seg = segOfEdge.get(ekey(ids[k], ids[k + 1]));
      const forward = seg.nodes[0] === ids[k] && seg.nodes[1] === ids[k + 1];
      const len = seg.nodes.length - 1;
      for (let s = 0; s <= len; s++) {
        const expect = forward ? seg.nodes[s] : seg.nodes[len - s];
        if (ids[k + s] !== expect) throw new Error('a leg leaves a segment in its middle');
      }
      visit(seg, forward, k);
      k += len;
    }
  };
  for (const { ids } of routes.values()) walk(ids, (seg) => seg.uses++);
  const segKey = (s) => `${s.nodes[0]}>${s.nodes.at(-1)}>${s.nodes[1]}`;
  segments.sort((a, b) => b.uses - a.uses || (segKey(a) < segKey(b) ? -1 : 1));

  // Vertices: z-order so neighbours sit near each other in the list.
  const vertexIds = [...new Set(segments.flatMap((s) => [s.nodes[0], s.nodes.at(-1)]))];
  const q = (id) => pos.get(id).map(Math.round);
  const morton = ([x, y]) => {
    let m = 0n;
    for (let b = 0; b < 16; b++)
      m |= (BigInt((x >> b) & 1) << BigInt(2 * b)) | (BigInt((y >> b) & 1) << BigInt(2 * b + 1));
    return m;
  };
  vertexIds.sort((a, b) => {
    const d = morton(q(a)) - morton(q(b));
    return d < 0n ? -1 : d > 0n ? 1 : a < b ? -1 : 1;
  });
  const vIndex = new Map(vertexIds.map((id, i) => [id, i]));

  // Packed arrays.
  const verts = [];
  let [px, py] = [0, 0];
  for (const id of vertexIds) {
    const [x, y] = q(id);
    verts.push(x - px, y - py);
    [px, py] = [x, y];
  }
  const segs = [];
  segments.forEach((seg, index) => {
    seg.index = index;
    const line = dedupe(
      simplify(
        seg.nodes.map((id) => pos.get(id)),
        tolerance,
      ).map((p) => p.map(Math.round)),
    );
    const a = q(seg.nodes[0]);
    const b = q(seg.nodes.at(-1));
    line[0] = a;
    line[line.length - 1] = b;
    const inner = dedupe(line).slice(1, -1);
    const flags = (seg.fwd ? 1 : 0) | (seg.bwd ? 2 : 0);
    segs.push(vIndex.get(seg.nodes[0]), vIndex.get(seg.nodes.at(-1)), flags, inner.length);
    let [cx, cy] = a;
    for (const [x, y] of inner) {
      segs.push(x - cx, y - cy);
      [cx, cy] = [x, y];
    }
  });

  // Ways on from each vertex, in segment order, as [segment index, leaving from end 0 or 1].
  const ways = new Map(vertexIds.map((id) => [vIndex.get(id), []]));
  for (const seg of segments) {
    const a = vIndex.get(seg.nodes[0]);
    const b = vIndex.get(seg.nodes.at(-1));
    if (seg.fwd) ways.get(a).push([seg.index, 0]);
    if (seg.bwd) ways.get(b).push([seg.index, 1]);
  }
  for (const list of ways.values()) list.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  const legs = [];
  let maxDigit = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const route = routes.get(`${i},${j}`);
      let digits = '';
      walk(route.ids, (seg, forward, k) => {
        const from = vIndex.get(route.ids[k]);
        const options = ways.get(from);
        if (options.length > 1) {
          const pick = options.findIndex(
            ([s, end]) => s === seg.index && end === (forward ? 0 : 1),
          );
          if (pick < 0) throw new Error('a way on is missing');
          maxDigit = Math.max(maxDigit, pick);
          digits += DIGITS[pick];
        }
      });
      legs.push(digits);
    }
  }
  if (maxDigit >= DIGITS.length) throw new Error('a vertex has more than 36 ways on');

  const starts = Array.from({ length: n }, (_, i) => vIndex.get(`S${i}`));
  return {
    packed: { verts, segs, starts, legs: legs.join(',') },
    stats: {
      vertices: vertexIds.length,
      segments: segments.length,
      digits: legs.reduce((s, l) => s + l.length, 0),
      maxDigit,
    },
  };
}

/**
 * The reference decoder. Returns leg(i, j) -> [x, y][] in viewBox units. The browser code ports
 * this function; the pipeline runs it over every leg.
 */
export function decodeLegs({ verts, segs, starts, legs }) {
  const vx = [];
  const vy = [];
  for (let k = 0, x = 0, y = 0; k < verts.length; k += 2) {
    x += verts[k];
    y += verts[k + 1];
    vx.push(x);
    vy.push(y);
  }
  const seg = [];
  for (let k = 0; k < segs.length;) {
    const a = segs[k];
    const b = segs[k + 1];
    const flags = segs[k + 2];
    const m = segs[k + 3];
    k += 4;
    const pts = [[vx[a], vy[a]]];
    let x = vx[a];
    let y = vy[a];
    for (let p = 0; p < m; p++, k += 2) {
      x += segs[k];
      y += segs[k + 1];
      pts.push([x, y]);
    }
    pts.push([vx[b], vy[b]]);
    seg.push({ a, b, flags, pts });
  }
  const ways = vx.map(() => []);
  seg.forEach((s, index) => {
    if (s.flags & 1) ways[s.a].push([index, 0]);
    if (s.flags & 2) ways[s.b].push([index, 1]);
  });
  for (const list of ways) list.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  const codes = legs.split(',');
  const n = starts.length;
  return (i, j) => {
    const digits = codes[i * (n - 1) + (j < i ? j : j - 1)];
    const goal = starts[j];
    let v = starts[i];
    let d = 0;
    const out = [[vx[v], vy[v]]];
    while (v !== goal || out.length === 1) {
      const options = ways[v];
      const [index, end] = options.length > 1 ? options[parseInt(digits[d++], 36)] : options[0];
      const s = seg[index];
      const pts = end === 0 ? s.pts : s.pts.slice().reverse();
      out.push(...pts.slice(1));
      v = end === 0 ? s.b : s.a;
      if (out.length > 1e5) throw new Error('leg does not end');
    }
    return out;
  };
}
