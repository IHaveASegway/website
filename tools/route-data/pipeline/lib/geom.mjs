// Geometry helpers: Web Mercator into a fixed viewBox, simplification, smoothing, polygon
// measures and compact SVG path data. Every coordinate the site ships is in viewBox units, never
// longitude and latitude.

const R = 6378137;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export const mercX = (lon) => R * rad(lon);
export const mercY = (lat) => R * Math.log(Math.tan(Math.PI / 4 + rad(lat) / 2));

/** A projection from [lon, lat] to viewBox [x, y] (y down) for a bbox [west, south, east, north]. */
export function makeProjection(bbox, width) {
  const [w, s, e, n] = bbox;
  const x0 = mercX(w);
  const x1 = mercX(e);
  const y0 = mercY(s);
  const y1 = mercY(n);
  const k = width / (x1 - x0);
  const height = Math.round((y1 - y0) * k);
  // Ground metres per viewBox unit at the bbox's middle latitude.
  const metresPerUnit = 1 / k / (1 / Math.cos(rad((s + n) / 2)));
  return {
    width,
    height,
    metresPerUnit,
    project: ([lon, lat]) => [(mercX(lon) - x0) * k, (y1 - mercY(lat)) * k],
    unproject: ([x, y]) => [
      deg(x / k / R + rad(w)),
      deg(2 * Math.atan(Math.exp((y1 - y / k) / R)) - Math.PI / 2),
    ],
  };
}

/** Haversine distance in metres. */
export function haversine([lon1, lat1], [lon2, lat2]) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a));
}

function segDist2(p, a, b) {
  let [x, y] = a;
  let dx = b[0] - x;
  let dy = b[1] - y;
  if (dx !== 0 || dy !== 0) {
    const t = ((p[0] - x) * dx + (p[1] - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) [x, y] = b;
    else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }
  dx = p[0] - x;
  dy = p[1] - y;
  return dx * dx + dy * dy;
}

/** Douglas-Peucker on an open polyline; keeps both ends. */
export function simplify(points, tolerance) {
  if (points.length <= 2) return points.slice();
  const tol2 = tolerance * tolerance;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop();
    let max = 0;
    let index = 0;
    for (let i = first + 1; i < last; i++) {
      const d = segDist2(points[i], points[first], points[last]);
      if (d > max) {
        max = d;
        index = i;
      }
    }
    if (max > tol2) {
      keep[index] = 1;
      stack.push([first, index], [index, last]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** Simplify a closed ring (first point repeated at the end or not); returns an open ring. */
export function simplifyRing(ring, tolerance) {
  const pts = samePoint(ring[0], ring[ring.length - 1]) ? ring.slice(0, -1) : ring.slice();
  if (pts.length < 4) return pts;
  // Split at the point farthest from the first, so both halves have fixed ends.
  let far = 0;
  let best = -1;
  for (let i = 1; i < pts.length; i++) {
    const d = (pts[i][0] - pts[0][0]) ** 2 + (pts[i][1] - pts[0][1]) ** 2;
    if (d > best) {
      best = d;
      far = i;
    }
  }
  const a = simplify(pts.slice(0, far + 1), tolerance);
  const b = simplify([...pts.slice(far), pts[0]], tolerance);
  return [...a, ...b.slice(1, -1)];
}

export const samePoint = (a, b) => a[0] === b[0] && a[1] === b[1];

/** Chaikin corner cutting on a closed ring (open form, no repeated point). */
export function chaikinRing(ring, iterations = 2) {
  let pts = ring;
  for (let it = 0; it < iterations; it++) {
    const out = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const q = pts[(i + 1) % pts.length];
      out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
      out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
    }
    pts = out;
  }
  return pts;
}

/** Signed area of a ring (shoelace), positive when counter-clockwise in a y-up frame. */
export function ringArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1]);
  }
  return a / 2;
}

/** A point well inside a polygon (outer ring + holes): the best of a coarse grid search. */
export function labelPoint(polygon) {
  const outer = polygon[0];
  let [minX, minY, maxX, maxY] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of outer) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let best = null;
  let bestD = -Infinity;
  const steps = 24;
  for (let i = 0; i <= steps; i++) {
    for (let j = 0; j <= steps; j++) {
      const p = [minX + ((maxX - minX) * i) / steps, minY + ((maxY - minY) * j) / steps];
      if (!insidePolygon(p, polygon)) continue;
      let d = Infinity;
      for (const ring of polygon) {
        for (let k = 0, l = ring.length - 1; k < ring.length; l = k++)
          d = Math.min(d, segDist2(p, ring[l], ring[k]));
      }
      if (d > bestD) {
        bestD = d;
        best = p;
      }
    }
  }
  return best ?? outer[0];
}

export function insideRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export const insidePolygon = (p, polygon) =>
  insideRing(p, polygon[0]) && !polygon.slice(1).some((hole) => insideRing(p, hole));

export const quantise = (p, q = 1) => [Math.round(p[0] / q), Math.round(p[1] / q)];

/** Drop consecutive duplicates. */
export function dedupe(points) {
  const out = [];
  for (const p of points) if (!out.length || !samePoint(out[out.length - 1], p)) out.push(p);
  return out;
}

/**
 * Compact SVG path data from integer polylines/rings: absolute M for the first subpath, relative
 * m for the rest, relative l with implicit repetition, and z for rings. Numbers are joined the
 * shortest legal way (a minus sign separates without a space).
 */
export function pathData(subpaths, { closed }) {
  let out = '';
  let cx = 0;
  let cy = 0;
  let first = true;
  const num = (n, prev) => {
    const s = String(n);
    if (prev === undefined) return s;
    return s[0] === '-' ? s : ` ${s}`;
  };
  for (const raw of subpaths) {
    const pts = dedupe(raw);
    if (pts.length < (closed ? 3 : 2)) continue;
    const [x0, y0] = pts[0];
    if (first) {
      out += `M${x0}${num(y0, x0)}`;
      first = false;
    } else {
      const dx = x0 - cx;
      const dy = y0 - cy;
      out += `m${dx}${num(dy, dx)}`;
    }
    let px = x0;
    let py = y0;
    out += 'l';
    let prev;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i][0] - px;
      const dy = pts[i][1] - py;
      out += num(dx, prev) + num(dy, dx);
      prev = dy;
      px = pts[i][0];
      py = pts[i][1];
    }
    if (closed) {
      out += 'z';
      cx = x0;
      cy = y0;
    } else {
      cx = px;
      cy = py;
    }
  }
  return out;
}

/** Clip an open polyline to an axis-aligned rect; returns the inside pieces (Liang-Barsky). */
export function clipPolyline(points, [minX, minY, maxX, maxY]) {
  const pieces = [];
  let cur = [];
  for (let i = 1; i < points.length; i++) {
    const seg = clipSegment(points[i - 1], points[i], minX, minY, maxX, maxY);
    if (!seg) {
      if (cur.length) pieces.push(cur);
      cur = [];
      continue;
    }
    const [a, b, aIn, bIn] = seg;
    if (!cur.length || !aIn) {
      if (cur.length) pieces.push(cur);
      cur = [a];
    }
    cur.push(b);
    if (!bIn) {
      pieces.push(cur);
      cur = [];
    }
  }
  if (cur.length) pieces.push(cur);
  return pieces.filter((p) => p.length > 1);
}

function clipSegment(a, b, minX, minY, maxX, maxY) {
  let t0 = 0;
  let t1 = 1;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const checks = [
    [-dx, a[0] - minX],
    [dx, maxX - a[0]],
    [-dy, a[1] - minY],
    [dy, maxY - a[1]],
  ];
  for (const [p, q] of checks) {
    if (p === 0) {
      if (q < 0) return null;
    } else {
      const t = q / p;
      if (p < 0) {
        if (t > t1) return null;
        if (t > t0) t0 = t;
      } else {
        if (t < t0) return null;
        if (t < t1) t1 = t;
      }
    }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy], t0 === 0, t1 === 1];
}
