// Land polygons from OpenStreetMap coastline ways, clipped to a rectangle.
//
// OSM draws natural=coastline with the land on the left of the way's direction. Ways are joined
// end to start into chains; closed chains inside the rectangle are islands; open chains are
// clipped to the rectangle, and each piece that leaves the rectangle is joined to the next piece
// that enters it, walking the rectangle's edge counter-clockwise, which keeps the land on the
// left. This is the method osmcoastline and most tile pipelines use, cut down to one rectangle.

import { clipPolyline, ringArea } from './geom.mjs';

const key = (p) => `${p[0]},${p[1]}`;

/** Join ways (arrays of [lon, lat]) end-to-start into maximal chains. */
export function joinWays(ways) {
  const byStart = new Map();
  for (const w of ways) {
    const k = key(w[0]);
    if (!byStart.has(k)) byStart.set(k, []);
    byStart.get(k).push(w);
  }
  const used = new Set();
  const chains = [];
  const startsOfEnds = new Set(ways.map((w) => key(w[w.length - 1])));
  // Start chains at ways nothing leads into, then sweep up the rings.
  const order = [...ways].sort(
    (a, b) => Number(startsOfEnds.has(key(a[0]))) - Number(startsOfEnds.has(key(b[0]))),
  );
  for (const w of order) {
    if (used.has(w)) continue;
    used.add(w);
    let chain = w.slice();
    for (;;) {
      const end = key(chain[chain.length - 1]);
      if (end === key(chain[0]) && chain.length > 2) break;
      const next = (byStart.get(end) ?? []).find((c) => !used.has(c));
      if (!next) break;
      used.add(next);
      chain = chain.concat(next.slice(1));
    }
    chains.push(chain);
  }
  return chains;
}

/**
 * Land rings, y-up, for chains already projected into a y-up frame, clipped to rect
 * [minX, minY, maxX, maxY]. Returns { land: rings (CCW), water: rings (CW islands of water) }.
 */
export function landRings(chains, rect) {
  const [minX, minY, maxX, maxY] = rect;
  const w = maxX - minX;
  const h = maxY - minY;
  const eps = 1e-6 * Math.max(w, h);
  const inside = ([x, y]) => x > minX && x < maxX && y > minY && y < maxY;
  const perim = ([x, y]) => {
    if (Math.abs(y - minY) < eps) return (x - minX) / w;
    if (Math.abs(x - maxX) < eps) return 1 + (y - minY) / h;
    if (Math.abs(y - maxY) < eps) return 2 + (maxX - x) / w;
    if (Math.abs(x - minX) < eps) return 3 + (maxY - y) / h;
    throw new Error(`point ${x},${y} is not on the rectangle's edge`);
  };
  const corner = (k) =>
    [
      [minX, minY],
      [maxX, minY],
      [maxX, maxY],
      [minX, maxY],
    ][k % 4];

  const land = [];
  const water = [];
  const pieces = [];
  for (const chain of chains) {
    const closed =
      chain.length > 3 && chain[0][0] === chain.at(-1)[0] && chain[0][1] === chain.at(-1)[1];
    if (closed && chain.every(inside)) {
      const ring = chain.slice(0, -1);
      (ringArea(ring) > 0 ? land : water).push(ring);
      continue;
    }
    let line = chain;
    if (closed) {
      // Rotate a ring that crosses the edge so it starts outside.
      const i = chain.findIndex((p) => !inside(p));
      line = [...chain.slice(i, -1), ...chain.slice(0, i + 1)];
    } else if (inside(chain[0]) || inside(chain.at(-1))) {
      throw new Error(
        'a coastline chain ends inside the rectangle: the extract is missing coastline',
      );
    }
    for (const piece of clipPolyline(line, rect)) {
      pieces.push({ pts: piece, tIn: perim(piece[0]), tOut: perim(piece.at(-1)) });
    }
  }

  const used = new Set();
  for (const start of pieces) {
    if (used.has(start)) continue;
    const ring = [];
    let cur = start;
    for (let guard = 0; guard <= pieces.length; guard++) {
      used.add(cur);
      ring.push(...cur.pts);
      let next = null;
      let best = Infinity;
      for (const p of pieces) {
        if (used.has(p) && p !== start) continue;
        const d = (p.tIn - cur.tOut + 4) % 4;
        if (d < best) {
          best = d;
          next = p;
        }
      }
      if (!next) throw new Error('coastline pieces do not close');
      for (let k = Math.floor(cur.tOut) + 1; k <= cur.tOut + best; k++) ring.push(corner(k));
      if (next === start) break;
      cur = next;
    }
    land.push(ring);
  }
  return { land, water };
}
