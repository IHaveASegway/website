#!/usr/bin/env node
// Route Lab map data, built offline from OpenStreetMap.
//
//   node build.mjs [--fresh]
//
// Steps, each skipped when its output already exists in the work directory (--fresh redoes all):
//   1. fetch     the Washington extract from Geofabrik (or BBBike's Seattle cut when Geofabrik is
//                unreachable), checked against the publisher's MD5
//   2. clip      osmium: a routing box, and a feature box for the basemap
//   3. osrm      osrm-extract (car profile) and osrm-contract
//   4. features  osmium tags-filter + export to GeoJSON: coastline, water, parks, roads, places
//   5. points    the depot and the stops: found by name in OSM, snapped to an ordinary street
//   6. matrix    OSRM table: durations (s) and distances (m) between every pair of points
//   7. legs      OSRM route for every ordered pair, packed as one graph (lib/legs.mjs)
//   8. isochrones OSRM table from the depot to a grid, contoured with d3-contour
//   9. basemap   land from coastline, water, parks, roads by class, labels, as SVG path data
//  10. write     out/*.json, out/preview.svg, out/README.md with sizes raw and gzip
//
// Needs: Node >= 20.17, osmium-tool (1.16.0 used), curl, and `npm ci` here (OSRM 26.6.5).

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { contours } from 'd3-contour';
import polygonClipping from 'polygon-clipping';
import OSRM from '@project-osrm/osrm';
import * as C from './config.mjs';
import { joinWays, landRings } from './lib/coast.mjs';
import {
  chaikinRing,
  clipPolyline,
  dedupe,
  haversine,
  labelPoint,
  makeProjection,
  pathData,
  ringArea,
  simplify,
  simplifyRing,
} from './lib/geom.mjs';
import { formatRouteData } from './lib/format.mjs';
import { decodeLegs, encodeLegs } from './lib/legs.mjs';
import { readme } from './lib/readme.mjs';

const STARTED = Date.now();
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', 'out');
const WORK = process.env.ROUTE_WORK ?? '/tmp/route-work';
const DL = process.env.ROUTE_DOWNLOADS ?? '/tmp/route-dl';
const FRESH = process.argv.includes('--fresh');
const OSRM_BIN = join(HERE, 'node_modules/@project-osrm/osrm/lib/binding_napi_v8');
const OSRM_PROFILE = join(HERE, 'node_modules/@project-osrm/osrm/profiles/car.lua');
for (const d of [OUT, WORK, DL]) mkdirSync(d, { recursive: true });

const log = (...a) => console.log(`[route-data]`, ...a);
const run = (cmd, args) => {
  log('$', cmd.split('/').at(-1), args.join(' '));
  execFileSync(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
};
const need = (file) => FRESH || !existsSync(file);
const bboxArg = (b) => b.join(',');
const md5 = (file) => createHash('md5').update(readFileSync(file)).digest('hex');
const sha256 = (file) => createHash('sha256').update(readFileSync(file)).digest('hex');
const readSeq = (file) =>
  readFileSync(file, 'utf8')
    .split('\n')
    // osmium writes GeoJSON text sequences (RFC 8142): each record starts with a record separator.
    .map((l) => l.replace(new RegExp(`^${String.fromCharCode(0x1e)}`), ''))
    .filter(Boolean)
    .map((l) => JSON.parse(l));
const tool = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8' }).trim();

// ---------------------------------------------------------------------------------------------
// 1. fetch
const SOURCE_PBF = join(DL, 'source.osm.pbf');
const SOURCE_META = join(WORK, 'source.json');
if (need(SOURCE_META) || !existsSync(SOURCE_PBF)) {
  let used = null;
  const attempts = [];
  for (const src of C.SOURCES) {
    try {
      log('fetch', src.url);
      const sums = execFileSync('curl', ['-fsSL', '--retry', '2', '-m', '60', src.md5], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const base = src.url.split('/').at(-1);
      const line = sums.split('\n').find((l) => l.trim().endsWith(base)) ?? sums.split('\n')[0];
      const expected = line.trim().split(/\s+/)[0];
      execFileSync('curl', ['-fSL', '--retry', '3', '-m', '1800', '-o', SOURCE_PBF, src.url], {
        stdio: 'inherit',
      });
      const got = md5(SOURCE_PBF);
      if (got !== expected) throw new Error(`md5 ${got}, publisher says ${expected}`);
      used = { ...src, md5sum: got };
      break;
    } catch (err) {
      const reason =
        String(err.stderr ?? '')
          .trim()
          .split('\n')
          .at(-1) || String(err.message).split('\n')[0];
      attempts.push({ name: src.name, url: src.url, failed: reason });
      log(`  ${src.name} failed: ${reason}`);
    }
  }
  if (!used) throw new Error('no OSM source could be downloaded');
  const info = JSON.parse(tool('osmium', ['fileinfo', '-j', SOURCE_PBF]));
  used.replicationTimestamp =
    info.header?.option?.osmosis_replication_timestamp ?? info.header?.option?.timestamp;
  used.headerBbox = info.header?.boxes?.[0];
  used.bytes = statSync(SOURCE_PBF).size;
  used.sha256 = sha256(SOURCE_PBF);
  used.fetchedOn = new Date().toISOString().slice(0, 10);
  used.failedFirst = attempts;
  writeFileSync(SOURCE_META, JSON.stringify(used, null, 2));
}
const SOURCE = JSON.parse(readFileSync(SOURCE_META, 'utf8'));
log('source', SOURCE.name, SOURCE.replicationTimestamp);

// ---------------------------------------------------------------------------------------------
// 2. clip
const ROUTING_PBF = join(WORK, 'routing.osm.pbf');
const FEATURES_PBF = join(WORK, 'features-area.osm.pbf');
if (need(ROUTING_PBF)) {
  run('osmium', [
    'extract',
    '-b',
    bboxArg(C.REGION.routing),
    '-s',
    'complete_ways',
    '--overwrite',
    '-o',
    ROUTING_PBF,
    SOURCE_PBF,
  ]);
}
if (need(FEATURES_PBF)) {
  run('osmium', [
    'extract',
    '-b',
    bboxArg(C.REGION.features),
    '-s',
    'smart',
    '--overwrite',
    '-o',
    FEATURES_PBF,
    SOURCE_PBF,
  ]);
}

// ---------------------------------------------------------------------------------------------
// 3. osrm
const OSRM_FILE = join(WORK, 'routing.osrm');
if (need(`${OSRM_FILE}.hsgr`)) {
  run(join(OSRM_BIN, 'osrm-extract'), ['-p', OSRM_PROFILE, '-t', '4', ROUTING_PBF]);
  run(join(OSRM_BIN, 'osrm-contract'), ['-t', '4', OSRM_FILE]);
}
const osrm = new OSRM({ path: OSRM_FILE, algorithm: 'CH' });
const call = (fn, args) =>
  new Promise((res, rej) => osrm[fn](args, (e, r) => (e ? rej(e) : res(r))));

// ---------------------------------------------------------------------------------------------
// 4. features
const FEATURES = join(WORK, 'features.geojsonseq');
const COAST = join(WORK, 'coast.geojsonseq');
if (need(FEATURES)) {
  const filtered = join(WORK, 'features.osm.pbf');
  run('osmium', [
    'tags-filter',
    '--overwrite',
    '-o',
    filtered,
    FEATURES_PBF,
    'wr/natural=water',
    'wr/waterway=riverbank',
    'wr/landuse=reservoir',
    'wr/leisure=park,garden,nature_reserve',
    'nwr/natural=beach,bay,strait',
    'w/highway=motorway,trunk,primary,secondary,tertiary,unclassified,residential,living_street',
    'nwr/tourism=viewpoint,attraction',
    'nwr/amenity=library,marketplace',
    'nwr/place=suburb,neighbourhood,quarter,city,town,village,island,sea,bay',
  ]);
  run('osmium', [
    'export',
    '--overwrite',
    '-f',
    'geojsonseq',
    '-a',
    'type,id',
    '-o',
    FEATURES,
    filtered,
  ]);
  const coastPbf = join(WORK, 'coast.osm.pbf');
  const cfg = join(WORK, 'coast-export.json');
  writeFileSync(
    cfg,
    JSON.stringify({ attributes: { type: true, id: true }, linear_tags: true, area_tags: false }),
  );
  run('osmium', [
    'tags-filter',
    '--overwrite',
    '-o',
    coastPbf,
    FEATURES_PBF,
    'w/natural=coastline',
  ]);
  run('osmium', ['export', '--overwrite', '-c', cfg, '-f', 'geojsonseq', '-o', COAST, coastPbf]);
}
const features = readSeq(FEATURES);
log('features', features.length);

const P = makeProjection(C.REGION.display, C.VIEW_WIDTH);
const W = P.width;
const H = P.height;
const MPU = P.metresPerUnit;
log(`viewBox 0 0 ${W} ${H}; ${MPU.toFixed(2)} m per unit`);
const proj = (c) => P.project(c);
const projRing = (ring) => ring.map(proj);
const polys = (g) =>
  g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
const areaM2 = (polygon) => Math.abs(ringArea(projRing(polygon[0]))) * MPU * MPU;
const insideView = ([x, y]) => x >= 0 && x <= W && y >= 0 && y <= H;

// Street index for snapping: SNAP_CLASSES segments in viewBox units, bucketed.
const BUCKET = 40;
const buckets = new Map();
for (const f of features) {
  if (f.geometry.type !== 'LineString' || !C.SNAP_CLASSES.includes(f.properties.highway)) continue;
  if (f.properties.access === 'private' || f.properties.access === 'no') continue;
  const pts = f.geometry.coordinates.map(proj);
  for (let k = 1; k < pts.length; k++) {
    const a = pts[k - 1];
    const b = pts[k];
    const minX = Math.floor(Math.min(a[0], b[0]) / BUCKET);
    const maxX = Math.floor(Math.max(a[0], b[0]) / BUCKET);
    const minY = Math.floor(Math.min(a[1], b[1]) / BUCKET);
    const maxY = Math.floor(Math.max(a[1], b[1]) / BUCKET);
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by <= maxY; by++) {
        const key = `${bx},${by}`;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push([a, b]);
      }
    }
  }
}
/** Street points within maxUnits of p, nearest first, one per street segment. */
function streetCandidates(p, maxUnits) {
  const found = [];
  const r = Math.ceil(maxUnits / BUCKET);
  const bx0 = Math.floor(p[0] / BUCKET);
  const by0 = Math.floor(p[1] / BUCKET);
  const seen = new Set();
  for (let bx = bx0 - r; bx <= bx0 + r; bx++) {
    for (let by = by0 - r; by <= by0 + r; by++) {
      for (const seg of buckets.get(`${bx},${by}`) ?? []) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        const [a, b] = seg;
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = dx * dx + dy * dy;
        let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
        t = Math.max(0, Math.min(1, t));
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d <= maxUnits) found.push({ point: q, metres: d * MPU });
      }
    }
  }
  return found.sort((x, y) => x.metres - y.metres);
}
function nearestStreet(p, maxUnits) {
  let best = null;
  let bestD = maxUnits * maxUnits;
  const r = Math.ceil(maxUnits / BUCKET);
  const bx0 = Math.floor(p[0] / BUCKET);
  const by0 = Math.floor(p[1] / BUCKET);
  for (let bx = bx0 - r; bx <= bx0 + r; bx++) {
    for (let by = by0 - r; by <= by0 + r; by++) {
      for (const [a, b] of buckets.get(`${bx},${by}`) ?? []) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const len = dx * dx + dy * dy;
        let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
        t = Math.max(0, Math.min(1, t));
        const q = [a[0] + t * dx, a[1] + t * dy];
        const d = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2;
        if (d < bestD) {
          bestD = d;
          best = q;
        }
      }
    }
  }
  return best ? { point: best, metres: Math.sqrt(bestD) * MPU } : null;
}

// ---------------------------------------------------------------------------------------------
// 5. points
const kindOf = (tag) =>
  ({
    'leisure=park': 'park',
    'leisure=garden': 'garden',
    'natural=beach': 'beach',
    'tourism=viewpoint': 'viewpoint',
    'amenity=library': 'library',
    'amenity=marketplace': 'market',
    'tourism=attraction': 'landmark',
  })[tag] ?? 'place';

// A point every stop must reach and be reached from: downtown, on the main road network.
const REFERENCE = (await call('nearest', { coordinates: [[-122.3321, 47.6062]], number: 1 }))
  .waypoints[0];

/** Snap to the nearest ordinary street that OSRM can route to and from (not a gated loop). */
async function snapPoint(lonlat, label) {
  const tried = [];
  const margin = 40; // keep a marker clear of the frame's edge
  for (const s of streetCandidates(proj(lonlat), 600 / MPU)) {
    const [sx, sy] = s.point;
    if (sx < margin || sy < margin || sx > W - margin || sy > H - margin) continue;
    if (tried.some((t) => Math.hypot(t[0] - s.point[0], t[1] - s.point[1]) * MPU < 20)) continue;
    tried.push(s.point);
    if (tried.length > 12) break;
    const near = await call('nearest', { coordinates: [P.unproject(s.point)], number: 1 });
    const wp = near.waypoints[0];
    const t = await call('table', {
      coordinates: [wp.location, REFERENCE.location],
      hints: [wp.hint, REFERENCE.hint],
      annotations: ['duration'],
    });
    if (t.durations[0][1] === null || t.durations[1][0] === null) continue;
    if (wp.distance > 25)
      log(`  warn: ${label}: OSRM snapped ${wp.distance.toFixed(0)} m from the street point`);
    if (tried.length > 1)
      log(`  ${label}: street ${tried.length} by distance was the first OSRM can reach`);
    return { location: wp.location, hint: wp.hint, street: wp.name, offStreetM: s.metres };
  }
  throw new Error(`${label}: no routable ordinary street within 600 m`);
}

const points = [];
{
  const depot = await snapPoint([C.DEPOT.lon, C.DEPOT.lat], C.DEPOT.label);
  points.push({
    label: C.DEPOT.label,
    kind: 'depot',
    order: null,
    qty: 0,
    osm: null,
    source: [C.DEPOT.lon, C.DEPOT.lat],
    ...depot,
  });
  for (const s of C.STOPS) {
    const [k, v] = s.tag.split('=');
    const matches = features.filter((f) => f.properties.name === s.name && f.properties[k] === v);
    const areas = matches.filter((f) => polys(f.geometry).length);
    const nodes = matches.filter((f) => f.geometry.type === 'Point');
    let lonlat;
    let osm;
    if (areas.length) {
      const f = areas.sort(
        (a, b) =>
          Math.max(...polys(b.geometry).map(areaM2)) - Math.max(...polys(a.geometry).map(areaM2)),
      )[0];
      const largest = polys(f.geometry).sort((a, b) => areaM2(b) - areaM2(a))[0];
      lonlat = P.unproject(labelPoint(largest.map(projRing)));
      osm = `${f.properties['@type']}/${f.properties['@id']}`;
    } else if (nodes.length) {
      lonlat = nodes[0].geometry.coordinates;
      osm = `${nodes[0].properties['@type']}/${nodes[0].properties['@id']}`;
    } else {
      throw new Error(`stop not found in OSM: ${s.name} (${s.tag})`);
    }
    if (!insideView(proj(lonlat))) throw new Error(`${s.name} is outside the display box`);
    const snapped = await snapPoint(lonlat, s.label);
    points.push({
      label: s.label,
      name: s.name,
      kind: kindOf(s.tag),
      order: s.order,
      qty: s.qty,
      osm,
      source: lonlat,
      ...snapped,
    });
  }
  const close = [];
  for (let a = 0; a < points.length; a++) {
    for (let b = a + 1; b < points.length; b++) {
      const d = haversine(points[a].location, points[b].location);
      if (d < C.MIN_STOP_SPACING_M)
        close.push(`${points[a].label} and ${points[b].label} are ${d.toFixed(0)} m apart`);
    }
  }
  if (close.length)
    throw new Error(`stops too close for the map to tell apart:\n  ${close.join('\n  ')}`);
  log('points', points.length);
}
const N = points.length;

// ---------------------------------------------------------------------------------------------
// 6. matrix
const table = await call('table', {
  coordinates: points.map((p) => p.location),
  hints: points.map((p) => p.hint),
  annotations: ['duration', 'distance'],
});
const durations = [];
const distances = [];
for (let i = 0; i < N; i++) {
  for (let j = 0; j < N; j++) {
    const t = table.durations[i][j];
    const d = table.distances[i][j];
    if (t === null || d === null)
      throw new Error(`no route ${points[i].label} -> ${points[j].label}`);
    durations.push(Math.round(t));
    distances.push(Math.round(d));
  }
}
log(`matrix ${N}x${N}; longest leg ${Math.max(...durations)} s, ${Math.max(...distances)} m`);

// ---------------------------------------------------------------------------------------------
// 7. legs
const routes = new Map();
let worstGap = 0;
{
  const jobs = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (i !== j) jobs.push([i, j]);
  let next = 0;
  const worker = async () => {
    while (next < jobs.length) {
      const k = next++;
      const [i, j] = jobs[k];
      const r = await call('route', {
        coordinates: [points[i].location, points[j].location],
        hints: [points[i].hint, points[j].hint],
        overview: 'full',
        geometries: 'geojson',
        steps: false,
      });
      const route = r.routes[0];
      worstGap = Math.max(worstGap, Math.abs(route.duration - table.durations[i][j]));
      const coords = route.geometry.coordinates;
      const ids = [`S${i}`];
      const pts = [proj(points[i].location)];
      for (let k = 1; k < coords.length - 1; k++) {
        const id = `${coords[k][0]},${coords[k][1]}`;
        if (id === ids.at(-1)) continue;
        ids.push(id);
        pts.push(proj(coords[k]));
      }
      ids.push(`S${j}`);
      pts.push(proj(points[j].location));
      results[k] = { ids, pts };
    }
  };
  const results = [];
  await Promise.all(Array.from({ length: 4 }, worker));
  // Insert in pair order, not completion order, so the packing is the same on every run.
  jobs.forEach(([i, j], k) => routes.set(`${i},${j}`, results[k]));
  log(`legs ${routes.size}; route vs table duration, worst gap ${worstGap.toFixed(1)} s`);
}
let legExtent;
let legDecodeWorst;
const { packed: legs, stats: legStats } = encodeLegs(routes, N, { tolerance: C.SIMPLIFY.legs });
log('leg graph', legStats);
{
  // Round trip: every decoded leg must start and end at its points and follow its OSRM route.
  const leg = decodeLegs(legs);
  let worst = 0;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      if (i === j) continue;
      const line = leg(i, j);
      const ref = routes.get(`${i},${j}`).pts;
      const a = proj(points[i].location).map(Math.round);
      const b = proj(points[j].location).map(Math.round);
      if (
        line[0][0] !== a[0] ||
        line[0][1] !== a[1] ||
        line.at(-1)[0] !== b[0] ||
        line.at(-1)[1] !== b[1]
      ) {
        throw new Error(`leg ${i}->${j} does not join its points`);
      }
      // Every OSRM vertex of the leg lies within tolerance + rounding of the decoded line.
      for (let k = 0; k < ref.length; k += 3) worst = Math.max(worst, distToLine(ref[k], line));
    }
  }
  log(
    `legs decode: worst distance from an OSRM point to its decoded leg ${worst.toFixed(2)} units`,
  );
  const all = segmentLines(legs).flat();
  legExtent = [
    Math.min(...all.map((p) => p[0])),
    Math.min(...all.map((p) => p[1])),
    Math.max(...all.map((p) => p[0])),
    Math.max(...all.map((p) => p[1])),
  ];
  legDecodeWorst = Number(worst.toFixed(2));
  log('leg extent', legExtent);
  if (worst > C.SIMPLIFY.legs + 1.5) throw new Error('decoded legs drift from OSRM');
}
/** Every segment of the packed leg graph as a polyline (for drawing the leg network). */
function segmentLines({ verts, segs }) {
  const vx = [];
  const vy = [];
  for (let k = 0, x = 0, y = 0; k < verts.length; k += 2) {
    x += verts[k];
    y += verts[k + 1];
    vx.push(x);
    vy.push(y);
  }
  const lines = [];
  for (let k = 0; k < segs.length;) {
    const [a, b, , m] = segs.slice(k, k + 4);
    k += 4;
    const line = [[vx[a], vy[a]]];
    let [x, y] = [vx[a], vy[a]];
    for (let p = 0; p < m; p++, k += 2) {
      x += segs[k];
      y += segs[k + 1];
      line.push([x, y]);
    }
    line.push([vx[b], vy[b]]);
    lines.push(line);
  }
  return lines;
}
function distToLine(p, line) {
  let best = Infinity;
  for (let k = 1; k < line.length; k++) {
    const [a, b] = [line[k - 1], line[k]];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = dx * dx + dy * dy;
    let t = len ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len : 0;
    t = Math.max(0, Math.min(1, t));
    best = Math.min(best, Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]));
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// 8. isochrones
const iso = { minutes: C.ISOCHRONE.minutes, bands: [] };
let isoStats;
{
  const step = C.ISOCHRONE.gridMetres / MPU;
  const cols = Math.ceil(W / step) + 1;
  const rows = Math.ceil(H / step) + 1;
  const BIG = 1e6;
  const values = new Float64Array(cols * rows).fill(-BIG);
  const samples = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = [c * step, r * step];
      const s = nearestStreet(p, C.ISOCHRONE.maxWalkMetres / MPU);
      if (s) samples.push({ index: r * cols + c, at: P.unproject(s.point), walk: s.metres });
    }
  }
  const depot = points[0];
  const CHUNK = 2000;
  const chunks = [];
  for (let k = 0; k < samples.length; k += CHUNK) chunks.push(samples.slice(k, k + CHUNK));
  let reached = 0;
  await Promise.all(
    chunks.map(async (chunk) => {
      const t = await call('table', {
        coordinates: [depot.location, ...chunk.map((s) => s.at)],
        sources: [0],
        destinations: chunk.map((_, k) => k + 1),
        annotations: ['duration'],
      });
      chunk.forEach((s, k) => {
        const d = t.durations[0][k];
        if (d === null) return;
        reached++;
        values[s.index] = -(d + s.walk / C.ISOCHRONE.walkSpeed);
      });
    }),
  );
  const minutesOf = [...values]
    .filter((v) => v > -BIG)
    .map((v) => -v / 60)
    .sort((a, b) => a - b);
  const q = (f) => minutesOf[Math.floor(f * (minutesOf.length - 1))].toFixed(1);
  isoStats = {
    cols,
    rows,
    samples: samples.length,
    reached,
    p10: q(0.1),
    p50: q(0.5),
    p90: q(0.9),
    max: q(1),
  };
  log('isochrone grid', isoStats);
  const gen = contours().size([cols, rows]).smooth(true);
  for (const m of C.ISOCHRONE.minutes) {
    const geo = gen.contour(values, -m * 60);
    const rings = [];
    for (const polygon of geo.coordinates) {
      for (const ring of polygon) {
        const view = ring.map(([x, y]) => [(x - 0.5) * step, (y - 0.5) * step]);
        if (Math.abs(ringArea(view)) * MPU * MPU < 40000) continue; // drop specks under 4 ha
        const smooth = chaikinRing(simplifyRing(view, 0.3), 2);
        const simple = simplifyRing(smooth, C.SIMPLIFY.isochrone).map((p) => p.map(Math.round));
        rings.push(simple);
      }
    }
    iso.bands.push(pathData(rings, { closed: true }));
  }
}

// ---------------------------------------------------------------------------------------------
// 9. basemap
const rectRing = [
  [0, 0],
  [W, 0],
  [W, H],
  [0, H],
];
const toPC = (rings) => [rings.map((r) => [...r, r[0]])]; // polygon-clipping polygon, closed rings
let water;
let landRingsY;
{
  // Coastline in a y-up frame (y -> -y) so "land on the left" holds.
  const coast = readSeq(COAST).filter((f) => f.geometry.type === 'LineString');
  const chains = joinWays(coast.map((f) => f.geometry.coordinates)).map((c) =>
    c.map(proj).map(([x, y]) => [x, -y]),
  );
  const { land, water: inlandSea } = landRings(chains, [0, -H, W, 0]);
  landRingsY = land.map((r) => r.map(([x, y]) => [x, -y]));
  const sea = polygonClipping.difference(toPC([rectRing]), ...landRingsY.map((r) => toPC([r])));
  const lakes = [];
  for (const f of features) {
    const p = f.properties;
    const isWater =
      p.natural === 'water' || p.waterway === 'riverbank' || p.landuse === 'reservoir';
    if (!isWater) continue;
    for (const polygon of polys(f.geometry)) {
      if (areaM2(polygon) < C.MIN_AREA_M2.water) continue;
      lakes.push(polygon.map((ring) => projRing(ring)));
    }
  }
  const seaInland = inlandSea.map((r) => toPC([r.map(([x, y]) => [x, -y])]));
  const union = polygonClipping.union(
    sea,
    ...lakes.map((pg) => [pg.map((r) => [...r, r[0]])]),
    ...seaInland,
  );
  water = polygonClipping.intersection(union, toPC([rectRing]));
  log('water polygons', water.length, 'lakes', lakes.length);
}
const polygonsPath = (mp, tol, minM2 = 0) => {
  const rings = [];
  for (const polygon of mp) {
    polygon.forEach((ring) => {
      const a = Math.abs(ringArea(ring)) * MPU * MPU;
      if (a < minM2) return;
      const s = simplifyRing(ring, tol).map((p) => p.map(Math.round));
      if (s.length >= 3) rings.push(s);
    });
  }
  return pathData(rings, { closed: true });
};
const waterPath = polygonsPath(water, C.SIMPLIFY.water, 2000);

let parksPath;
{
  const parks = [];
  for (const f of features) {
    const l = f.properties.leisure;
    if (l !== 'park' && l !== 'garden' && l !== 'nature_reserve') continue;
    for (const polygon of polys(f.geometry)) {
      if (areaM2(polygon) < C.MIN_AREA_M2.park) continue;
      const rings = polygon
        .map((ring) => simplifyRing(projRing(ring), 0.5))
        .filter((r) => r.length >= 3);
      if (rings.length) parks.push([rings.map((r) => [...r, r[0]])]);
    }
  }
  const merged = polygonClipping.intersection(polygonClipping.union(...parks), toPC([rectRing]));
  parksPath = polygonsPath(merged, C.SIMPLIFY.parks, 8000);
  log('parks', parks.length);
}

const roads = {};
const drawn = Object.values(C.ROAD_CLASSES).flat();
const isTunnel = (p) =>
  p.tunnel === 'yes' || p.tunnel === 'building_passage' || p.covered === 'yes';
for (const [cls, values] of Object.entries({ ...C.ROAD_CLASSES, tunnel: drawn })) {
  const lines = features
    .filter((f) => f.geometry.type === 'LineString' && values.includes(f.properties.highway))
    .filter((f) => (cls === 'tunnel') === isTunnel(f.properties))
    .map((f) => f.geometry.coordinates);
  // Join ways that meet end to end (either direction) into longer lines.
  const joined = joinUndirected(lines).map((l) => l.map(proj));
  const pieces = joined.flatMap((l) => clipPolyline(l, [-2, -2, W + 2, H + 2]));
  const simple = pieces
    .map((l) => dedupe(simplify(l, C.SIMPLIFY.roads).map((p) => p.map(Math.round))))
    .filter(
      (l) =>
        l.length > 1 && Math.hypot(l.at(-1)[0] - l[0][0], l.at(-1)[1] - l[0][1]) + l.length > 4,
    );
  roads[cls] = pathData(simple, { closed: false });
}
function joinUndirected(lines) {
  const key = (p) => `${p[0]},${p[1]}`;
  const ends = new Map();
  lines.forEach((l, i) => {
    for (const k of [key(l[0]), key(l.at(-1))]) {
      if (!ends.has(k)) ends.set(k, []);
      ends.get(k).push(i);
    }
  });
  const used = new Set();
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (used.has(i)) continue;
    used.add(i);
    let line = lines[i].slice();
    for (const dir of [1, -1]) {
      for (;;) {
        const endKey = key(dir === 1 ? line.at(-1) : line[0]);
        const cands = (ends.get(endKey) ?? []).filter((k) => !used.has(k));
        if (cands.length !== 1 || (ends.get(endKey) ?? []).length !== 2) break;
        const k = cands[0];
        used.add(k);
        let next = lines[k].slice();
        if (dir === 1) {
          if (key(next[0]) !== endKey) next.reverse();
          line = line.concat(next.slice(1));
        } else {
          if (key(next.at(-1)) !== endKey) next.reverse();
          line = next.concat(line.slice(1));
        }
      }
    }
    out.push(line);
  }
  return out;
}

const labels = [];
{
  const byName = (name, test) =>
    features.filter((f) => f.properties.name === name && test(f.properties));
  const place = (name) =>
    byName(name, (p) => ['suburb', 'neighbourhood', 'quarter'].includes(p.place)).find(
      (f) => f.geometry.type === 'Point',
    );
  const area = (name) =>
    byName(name, (p) => ['city', 'town', 'village', 'island'].includes(p.place));
  const waterBody = (name) =>
    byName(name, (p) => p.natural === 'water' || p.natural === 'bay' || p.place === 'bay');
  const push = (text, xy, kind) => {
    if (!xy || !insideView(xy)) {
      log(`  label skipped (outside or missing): ${text}`);
      return;
    }
    labels.push({ text, x: Math.round(xy[0]), y: Math.round(xy[1]), kind });
  };
  const pointOf = (fs) => {
    const node = fs.find((f) => f.geometry.type === 'Point');
    if (node) return proj(node.geometry.coordinates);
    const withArea = fs.filter((f) => polys(f.geometry).length);
    if (!withArea.length) return null;
    const largest = withArea
      .flatMap((f) => polys(f.geometry))
      .sort((a, b) => areaM2(b) - areaM2(a))[0];
    return labelPoint(largest.map(projRing));
  };
  for (const name of C.LABELS.places)
    push(name, place(name) && proj(place(name).geometry.coordinates), 'place');
  for (const name of C.LABELS.areas) push(name, pointOf(area(name)), 'area');
  for (const name of C.LABELS.water) push(name, pointOf(waterBody(name)), 'water');
  for (const f of C.LABELS.fixed) push(f.text, proj([f.lon, f.lat]), 'water');
}

// ---------------------------------------------------------------------------------------------
// 10. write
const viewBox = [0, 0, W, H];
// Every served file says what it is derived from and under which licence (ODbL 4.3 and 4.6).
const LICENSE = {
  license: 'ODbL-1.0',
  attribution: '© OpenStreetMap contributors',
  copyright: 'https://www.openstreetmap.org/copyright',
};
const basemap = { ...LICENSE, viewBox, water: waterPath, parks: parksPath, roads, labels };
const isochrones = {
  ...LICENSE,
  viewBox,
  depot: proj(points[0].location).map(Math.round),
  minutes: iso.minutes,
  within: iso.bands,
};

// Ready-made days: a seeded shuffle of the stops is the order the orders came in.
function mulberry32(a) {
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const scenarios = C.SCENARIOS.map((s, k) => {
  const rand = mulberry32(C.SEED + k);
  const ids = [...Array(N).keys()].slice(1);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  const stops = s.stops === 'all' ? ids : ids.slice(0, s.stops);
  const boxes = stops.reduce((sum, i) => sum + points[i].qty, 0);
  return {
    id: s.id,
    name: s.name,
    vans: s.vans,
    capacity: Math.ceil((boxes / s.vans) * 1.3),
    stops,
  };
});

const routeData = {
  ...LICENSE,
  viewBox,
  serviceSeconds: C.SERVICE_SECONDS,
  points: points.map((p, i) => ({
    i,
    label: p.label,
    kind: p.kind,
    ...(p.order ? { order: p.order, qty: p.qty } : {}),
    x: Math.round(proj(p.location)[0]),
    y: Math.round(proj(p.location)[1]),
  })),
  scenarios,
  durations,
  distances,
  legs,
};
const files = {
  'basemap.json': JSON.stringify(basemap),
  'isochrones.json': JSON.stringify(isochrones),
  // One value per line, so no two numbers run together (lib/format.mjs says why).
  'route-data.json': formatRouteData(routeData),
};

// Checks on what the site will serve (the site's own scans run again when the files land there).
{
  const TEXT_OK = /^[\x20-\x7e‘’“”–—…·©]*$/; // in both of the site's font subsets
  const texts = [
    ...labels.map((l) => l.text),
    ...routeData.points.flatMap((p) => [p.label, p.order ?? '']),
    ...scenarios.map((s) => s.name),
  ];
  const problems = [];
  for (const t of texts) {
    if (!TEXT_OK.test(t)) problems.push(`character outside the site's fonts: ${t}`);
    if (t.includes('!')) problems.push(`exclamation mark: ${t}`);
  }
  for (const [name, body] of Object.entries(files)) {
    if (/\d\.\d/.test(body.replace('"ODbL-1.0"', '')))
      problems.push(`${name}: a decimal number (coordinates must be integer viewBox units)`);
    if (/\d:\d/.test(body)) problems.push(`${name}: something that reads as a time of day`);
  }
  if (problems.length) throw new Error(`served files fail the checks:\n  ${problems.join('\n  ')}`);
}
for (const [name, body] of Object.entries(files)) writeFileSync(join(OUT, name), body);

// Preview: every layer, and the busy day driven the naive way: orders dealt to the vans in turn
// as they came in, each van driving its orders in that order. VROOM's plan is the page's job.
let baseline;
{
  const leg = decodeLegs(legs);
  const day = scenarios.find((s) => s.id === 'busy');
  const vans = Array.from({ length: day.vans }, () => []);
  day.stops.forEach((stop, k) => vans[k % day.vans].push(stop));
  const at = (i, j) => i * N + j;
  baseline = {
    scenario: day.id,
    vans: vans.map((stops) => {
      const tour = [0, ...stops, 0];
      let seconds = 0;
      let metres = 0;
      for (let k = 1; k < tour.length; k++) {
        seconds += durations[at(tour[k - 1], tour[k])];
        metres += distances[at(tour[k - 1], tour[k])];
      }
      seconds += stops.length * C.SERVICE_SECONDS;
      return {
        stops,
        seconds,
        metres,
        path: pathData(
          tour.slice(1).map((j, k) => leg(tour[k], j)),
          { closed: false },
        ),
      };
    }),
  };
  // The streets the legs use, drawn faintly, so every leg runs on a drawn street.
  const legNetwork = pathData(segmentLines(legs), { closed: false });
  const vanColour = ['#c2185b', '#6a1b9a', '#ef6c00', '#2e7d32'];
  const bandFill = ['#1f6f8b', '#2c8aa8', '#4aa3be', '#7cbdd1', '#b3d8e4', '#d4e8ee'];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W / 2}" height="${H / 2}">
<rect width="${W}" height="${H}" fill="#f2efe6"/>
<path d="${parksPath}" fill="#d5e5c4" fill-rule="evenodd"/>
${[...iso.bands]
  .reverse()
  .map(
    (d, k) =>
      `<path d="${d}" fill="${bandFill[iso.bands.length - 1 - k]}" fill-opacity="0.3" fill-rule="evenodd"/>`,
  )
  .join('\n')}
<path d="${waterPath}" fill="#a9cfe0" fill-rule="evenodd"/>
<path d="${legNetwork}" fill="none" stroke="#ffffff" stroke-opacity="0.7" stroke-width="1.2" stroke-linejoin="round"/>
<path d="${roads.tertiary}" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round"/>
<path d="${roads.secondary}" fill="none" stroke="#ffffff" stroke-width="2.4" stroke-linejoin="round"/>
<path d="${roads.primary}" fill="none" stroke="#fbf7ee" stroke-width="3.2" stroke-linejoin="round"/>
<path d="${roads.tunnel}" fill="none" stroke="#b59a74" stroke-width="2.4" stroke-dasharray="6 6"/>
<path d="${roads.motorway}" fill="none" stroke="#e8b26b" stroke-width="4.5" stroke-linejoin="round"/>
${baseline.vans.map((v, k) => `<path d="${v.path}" fill="none" stroke="${vanColour[k]}" stroke-width="4" stroke-opacity="0.85" stroke-linejoin="round" stroke-linecap="round"/>`).join('\n')}
${routeData.points.map((p) => `<circle cx="${p.x}" cy="${p.y}" r="${p.kind === 'depot' ? 14 : 8}" fill="${p.kind === 'depot' ? '#c2185b' : day.stops.includes(p.i) ? '#222' : '#999'}" stroke="#fff" stroke-width="3"/>`).join('\n')}
${labels.map((l) => `<text x="${l.x}" y="${l.y}" font-family="sans-serif" font-size="${l.kind === 'water' ? 30 : 24}" fill="${l.kind === 'water' ? '#3d7a96' : '#555'}" text-anchor="middle" font-style="${l.kind === 'water' ? 'italic' : 'normal'}">${l.text}</text>`).join('\n')}
<text x="${W - 16}" y="${H - 16}" font-family="sans-serif" font-size="22" fill="#333" text-anchor="end">© OpenStreetMap contributors</text>
</svg>`;
  writeFileSync(join(OUT, 'preview.svg'), svg);
}

// Provenance for the README (not served: it carries coordinates and a timestamp).
const provenance = {
  source: SOURCE,
  regions: C.REGION,
  viewBox,
  metresPerUnit: Number(MPU.toFixed(3)),
  isochrone: { ...C.ISOCHRONE, grid: isoStats },
  legs: {
    ...legStats,
    worstRouteVsTableGapSeconds: Number(worstGap.toFixed(1)),
    worstDecodeDriftUnits: legDecodeWorst,
    extent: legExtent,
  },
  baseline: {
    scenario: baseline.scenario,
    vans: baseline.vans.map(({ stops, seconds, metres }) => ({ stops, seconds, metres })),
  },
  scenarios,
  points: points.map((p, i) => ({
    i,
    label: p.label,
    name: p.name ?? null,
    osm: p.osm,
    kind: p.kind,
    order: p.order,
    qty: p.qty,
    lonlat: p.location,
    street: p.street,
  })),
  tools: {
    node: process.version,
    osmium: tool('osmium', ['--version']).split('\n')[0].replace('osmium version', 'osmium-tool'),
    osrm:
      OSRM.version ??
      JSON.parse(readFileSync(join(HERE, 'node_modules/@project-osrm/osrm/package.json'), 'utf8'))
        .version,
    'd3-contour': JSON.parse(
      readFileSync(join(HERE, 'node_modules/d3-contour/package.json'), 'utf8'),
    ).version,
    'polygon-clipping': JSON.parse(
      readFileSync(join(HERE, 'node_modules/polygon-clipping/package.json'), 'utf8'),
    ).version,
  },
};
writeFileSync(join(OUT, 'provenance.json'), JSON.stringify(provenance, null, 2));

const sizes = {};
for (const name of ['basemap.json', 'isochrones.json', 'route-data.json', 'preview.svg']) {
  const buf = readFileSync(join(OUT, name));
  sizes[name] = {
    raw: buf.length,
    gzip: gzipSync(buf, { level: 9 }).length,
    sha256: createHash('sha256').update(buf).digest('hex'),
  };
}
const parts = {
  'basemap.water': waterPath.length,
  'basemap.parks': parksPath.length,
  ...Object.fromEntries(Object.entries(roads).map(([k, v]) => [`basemap.roads.${k}`, v.length])),
  'route-data.legs': JSON.stringify(legs).length,
  'route-data.matrix': JSON.stringify([durations, distances]).length,
};
writeFileSync(join(OUT, 'sizes.json'), JSON.stringify({ sizes, parts }, null, 2));
const duBytes = (dir) =>
  Number(execFileSync('du', ['-sb', dir], { encoding: 'utf8' }).split(/\s/)[0]);
const legsSource = readFileSync(join(HERE, 'lib/legs.mjs'), 'utf8');
const decoderLines =
  legsSource.slice(legsSource.indexOf('export function decodeLegs')).split('\n').length - 1;
// The README quotes the last fresh run (download, OSRM preprocessing and all), not a cached one.
const PREV = join(OUT, 'fresh-run.json');
let run_ = {
  seconds: Math.round((Date.now() - STARTED) / 1000),
  workBytes: duBytes(WORK),
  downloadBytes: duBytes(DL),
};
if (FRESH) writeFileSync(PREV, JSON.stringify(run_, null, 2));
else if (existsSync(PREV)) run_ = JSON.parse(readFileSync(PREV, 'utf8'));
run_.decoderLines = decoderLines;
writeFileSync(
  join(OUT, 'README.md'),
  readme({ provenance, sizes, parts, config: C, routeData, run: run_ }),
);
log('run', run_);
log('sizes', sizes);
log('parts (raw chars)', parts);
if (process.argv.includes('--clean')) {
  rmSync(WORK, { recursive: true, force: true });
  rmSync(DL, { recursive: true, force: true });
}
