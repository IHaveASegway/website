// out/README.md, written from what the build measured, so every number in it is this build's.

const kb = (n) => `${(n / 1000).toFixed(1)} KB`;
const int = (n) => n.toLocaleString('en-US');
const min = (s) => `${(s / 60).toFixed(1)} min`;
const km = (m) => `${(m / 1000).toFixed(1)} km`;

export function readme({ provenance: p, sizes, parts, config: C, routeData, run }) {
  const served = ['basemap.json', 'isochrones.json', 'route-data.json'];
  const total = served.reduce(
    (s, f) => ({ raw: s.raw + sizes[f].raw, gzip: s.gzip + sizes[f].gzip }),
    { raw: 0, gzip: 0 },
  );
  const [, , W, H] = p.viewBox;
  const N = p.points.length;
  const src = p.source;
  const failed = (src.failedFirst ?? [])
    .map((a) => `${a.name} (${a.url}) failed first from the build machine: \`${a.failed}\`.`)
    .join(' ');
  const base = p.baseline;
  const baseSec = base.vans.reduce((s, v) => s + v.seconds, 0);
  const baseM = base.vans.reduce((s, v) => s + v.metres, 0);
  const busy = p.scenarios.find((s) => s.id === base.scenario);
  const row = (cells) => `| ${cells.join(' | ')} |`;

  return `# Route Lab map data

Static map data for the Route Lab demo: a fictional bakery in Seattle sends vans to ${N - 1} public
places, and VROOM, compiled to WebAssembly, plans the routes in the visitor's browser. Everything
here is computed offline from OpenStreetMap by \`pipeline/build.mjs\`; nothing is computed on a
server at runtime.

The three JSON files are what the site serves: ${kb(total.raw)} raw, **${kb(total.gzip)} gzip -9**
together, against a target of 250 KB gzip for everything the page loads except the WASM.

## Files

${row(['File', 'What', 'Served', 'Raw', 'gzip -9'])}
${row(['---', '---', '---', '---:', '---:'])}
${row(['`basemap.json`', 'Water, parks, roads by class, labels: SVG path data in viewBox units', 'yes, or inlined at build', kb(sizes['basemap.json'].raw), kb(sizes['basemap.json'].gzip)])}
${row(['`isochrones.json`', `Areas the bakery reaches within ${C.ISOCHRONE.minutes.join(', ')} minutes`, 'yes, or inlined at build', kb(sizes['isochrones.json'].raw), kb(sizes['isochrones.json'].gzip)])}
${row(['`route-data.json`', 'Points, ready-made days, the duration and distance matrix, packed leg geometry', 'yes, fetched by the page', kb(sizes['route-data.json'].raw), kb(sizes['route-data.json'].gzip)])}
${row(['`preview.svg`', 'Every layer and the naive plan for one day, for a human eye', 'no', kb(sizes['preview.svg'].raw), kb(sizes['preview.svg'].gzip)])}
${row(['`provenance.json`', 'Source checksums, tool versions, every point with its OSM element and coordinates', 'no: it has coordinates and a timestamp', '', ''])}
${row(['`sizes.json`', 'The sizes above, and raw characters per layer', 'no', '', ''])}
${row(['`fresh-run.json`', 'Time and disk use of the last fresh run, quoted under Rebuild', 'no', '', ''])}

SHA-256 of the served files: ${served.map((f) => `\`${f}\` \`${sizes[f].sha256}\``).join('; ')}. Two runs over
the same OSRM graph write byte-identical files. OSRM's multi-threaded preprocessing is not
bit-stable: over three fresh runs on 2026-10-25, one of the 4,096 distances (Westcrest Park to
Northgate library) came out 24,625 m once and 24,626 m twice; every duration and every leg
matched.

Raw characters per layer: ${Object.entries(parts)
    .map(([k, v]) => `${k} ${int(v)}`)
    .join('; ')}.

## Sources, licences and attribution

- **Map data:** © OpenStreetMap contributors, under the Open Database License 1.0 (ODbL). The page
  must show the text "© OpenStreetMap contributors", linked to
  https://www.openstreetmap.org/copyright, next to the map (ODbL 4.3, the notice for a Produced
  Work). The served JSON files are a derivative database, so they are under the ODbL too (4.4):
  each says \`"license": "ODbL-1.0"\` and carries the attribution and the link. Serving them at
  public URLs, with this pipeline as the method that made them, is the offer ODbL 4.6 asks for.
- **Extract:** ${src.name}: ${src.url}. OSM replication timestamp ${src.replicationTimestamp};
  ${int(src.bytes)} bytes; MD5 \`${src.md5sum}\`, which matches the publisher's checksum file;
  SHA-256 \`${src.sha256}\`; fetched ${src.fetchedOn}.
  ${failed ? `${failed} ` : ''}The pipeline tries Geofabrik's Washington extract first and falls back to
  BBBike's Seattle cut, which holds the same OSM data for a box around Seattle.
- **Build-time tools** (nothing from them ships): Node ${p.tools.node}; ${p.tools.osmium}
  (GPL-3.0); OSRM ${p.tools.osrm} through \`@project-osrm/osrm\` (BSD-2-Clause), car profile;
  d3-contour ${p.tools['d3-contour']} (ISC); polygon-clipping ${p.tools['polygon-clipping']} (MIT).
  OSRM is 26.6.5, not the newest 26.10.0: the 26.7.3, 26.9.0 and 26.10.0 binaries need glibc
  2.43, Ubuntu 24.04 has 2.39, and 26.6.5 is the newest release checked that runs on it.
- **The solver** is VROOM (BSD-2-Clause), built separately; this data feeds it.
- **Names and order lines:** place names are OSM's \`name\` tags (ODbL), shortened into labels; the
  bakery and every order line are made up.

## Region and projection

- Display box (what the visitor sees), WGS84 west, south, east, north: ${C.REGION.display.join(', ')}.
  Seattle from Carkeek Park to Rainier Beach, West Seattle to Bellevue, with Puget Sound, Elliott
  Bay, Lake Union, Green Lake and Lake Washington.
- Routing box (roads OSRM uses): ${C.REGION.routing.join(', ')}. About 750 m wider than the display
  box on three sides and flush with it in the south, so no leg leaves the picture. In a trial
  build on 2026-10-24 with BBBike's whole box, 78 of 4,032 legs ran up to 4.8 km outside the frame.
- Feature box (basemap lines run off the edge cleanly): ${C.REGION.features.join(', ')}.
- Projection: Web Mercator, north up, into \`viewBox="0 0 ${W} ${H}"\`. One unit is
  ${p.metresPerUnit} m on the ground at the box's middle latitude. Every served coordinate is an
  integer in these units; no served file has a longitude or a latitude.

## Points

Point 0 is the bakery: fictional, snapped to an ordinary street, with no address shown. Stops are
public places: parks, gardens, beaches, viewpoints, libraries, markets and landmarks, found in the
OSM data by name and tag. Each is snapped to the nearest ordinary street (primary to residential,
never a freeway or a ramp) that OSRM can reach from downtown and route back from, at least 40 units
inside the frame. No two points are closer than ${C.MIN_STOP_SPACING_M} m. A place is a drop-off
spot; no place is presented as the customer. \`qty\` is boxes, for van capacity.

${row(['i', 'Label', 'Kind', 'Order', 'Boxes', 'OSM element', 'Snapped lon, lat', 'Street'])}
${row(['---:', '---', '---', '---', '---:', '---', '---', '---'])}
${p.points.map((q) => row([q.i, q.label, q.kind, q.order ?? '', q.qty || '', q.osm ? `${q.osm} (${q.name})` : 'none: fictional', q.lonlat.map((v) => v.toFixed(5)).join(', '), q.street || '(unnamed)'])).join('\n')}

## Formats

All path data is SVG: absolute \`M\` for the first subpath, relative \`m\` and \`l\` after it,
integers only. Fill closed shapes with \`fill-rule="evenodd"\`.

### basemap.json

- \`water\`: Puget Sound and Elliott Bay (land is built from \`natural=coastline\` ways, land on
  the left, clipped to the frame) united with lakes and rivers of 2.5 ha or more
  (\`natural=water\`, \`waterway=riverbank\`, \`landuse=reservoir\`). Islands are holes.
- \`parks\`: \`leisure=park|garden|nature_reserve\` of 3 ha or more, united.
- \`roads\`: open paths for stroking, by class: \`motorway\` (motorway and trunk), \`primary\`,
  \`secondary\`, \`tertiary\`, and \`tunnel\` (any of those in a tunnel, such as SR 99 under
  downtown; draw it dashed or faint). Links and residential streets are left out.
- \`labels\`: \`{text, x, y, kind}\`, kind \`place\` (OSM \`place=suburb|neighbourhood\`), \`area\`
  (\`place=city|town|island\`) or \`water\`. "Puget Sound" is placed by hand in open water.
- Suggested order, bottom to top: land (the page background), parks, isochrone bands, water, the
  leg network (below), roads from tertiary up to motorway, tunnels, routes, stops, labels, and the
  attribution.

### isochrones.json

- \`depot\`: the bakery's [x, y]. \`minutes\`: ${JSON.stringify(C.ISOCHRONE.minutes)}.
- \`within[k]\`: path data for the area reachable within \`minutes[k]\`. The areas are nested, so
  draw them largest first. One colour at low opacity per band shades nearer areas darker without a
  second colour. The areas are not clipped to land: draw water above them.
- How: an OSRM table from the bakery to a ${C.ISOCHRONE.gridMetres} m grid (${int(p.isochrone.grid.cols)} x
  ${int(p.isochrone.grid.rows)} samples). A sample's time is the drive to the nearest ordinary
  street plus a walk from it at ${C.ISOCHRONE.walkSpeed} m/s; a sample more than
  ${C.ISOCHRONE.maxWalkMetres} m from a street is unreached, which is why park interiors, port
  terminals and open water stay uncoloured. Contoured with d3-contour, smoothed twice with
  Chaikin's corner cutting, simplified at ${C.SIMPLIFY.isochrone} units; rings under 4 ha dropped.
- Spread of the samples: 10% within ${p.isochrone.grid.p10} min, half within ${p.isochrone.grid.p50},
  90% within ${p.isochrone.grid.p90}, the farthest ${p.isochrone.grid.max}. That is why the bands are
  5 minutes apart and stop at 30: bands at 10, 20, 30 and 40 minutes would colour nearly the whole
  map in two shades.

### route-data.json

One value per line: every array value and every object member is on its own line, with no
indentation (\`formatRouteData\` in \`pipeline/lib/format.mjs\`). On one line, adjacent numbers run
together as digits and commas, and by chance a run can read as one longer number, such as a phone
number or an ID; the content firewall flagged such runs in the one-line file. On its own line, each
number stands alone. Strings are as JSON.stringify writes them. \`apps/web/test/route-lab.test.ts\`
checks that no line holds two numbers and that the file is exactly what \`formatRouteData\` writes.

- \`points\`: \`{i, label, kind, order?, qty?, x, y}\`; \`i\` is the matrix index, 0 is the bakery.
- \`serviceSeconds\`: ${C.SERVICE_SECONDS}, the time at each stop.
- \`scenarios\`: ready-made days, \`{id, name, vans, capacity, stops}\`. \`stops\` is in the order the
  orders came in (a seeded shuffle, seed ${C.SEED}); \`capacity\` is boxes per van, 1.3 times the
  day's boxes divided by the vans. ${routeData.scenarios.map((s) => `"${s.name}": ${s.stops.length} stops, ${s.vans} van${s.vans > 1 ? 's' : ''}, ${s.capacity} boxes each.`).join(' ')}
- \`durations\`, \`distances\`: ${N} x ${N}, row-major (from i to j is \`[i * ${N} + j]\`), whole seconds
  and metres, OSRM's car profile. The longest leg is ${min(Math.max(...routeData.durations))},
  ${km(Math.max(...routeData.distances))}. These are free-flow times with no traffic; the page
  should say so.
- \`legs\`: road geometry for all ${int(N * (N - 1))} ordered pairs, packed as the union graph of the
  OSRM routes: ${int(p.legs.vertices)} vertices, ${int(p.legs.segments)} segments, and
  ${int(p.legs.digits)} choice digits in all (${(p.legs.digits / (N * (N - 1))).toFixed(1)} a leg).
  - \`verts\`: vertex x, y pairs, each the difference from the previous vertex (z-order).
  - \`segs\`: per segment \`a, b, flags, m\`, then \`m\` inner points as differences, starting from
    vertex \`a\`'s position; the segment runs a, inner points, b. \`flags\` bit 1: some leg drives it
    from a to b; bit 2: from b to a. Segments are numbered most-used first.
  - \`starts\`: each point's vertex.
  - \`legs\`: one string, comma-separated, for (0,1), (0,2) ... (0,${N - 1}), (1,0), (1,2) ...; leg
    (i, j) is entry \`i * ${N - 1} + (j < i ? j : j - 1)\`. Walk from \`starts[i]\`. At each vertex
    list the ways on: a segment whose end \`a\` is this vertex and whose flags have bit 1, leaving
    from a; or whose end \`b\` is this vertex with bit 2, leaving from b; sorted by segment number,
    then a before b. With one way on, take it; with more, read the next base-36 digit as the index.
    Stop at \`starts[j]\`. \`decodeLegs\` in \`pipeline/lib/legs.mjs\` is the reference, ${run.decoderLines} lines;
    the build decodes every leg and fails if one does not join its two points or strays more than
    ${(C.SIMPLIFY.legs + 1.5).toFixed(1)} units from OSRM's geometry (worst this build:
    ${p.legs.worstDecodeDriftUnits} units, about ${Math.round(p.legs.worstDecodeDriftUnits * p.metresPerUnit)} m).
  - Draw every segment once, faint, as the street layer the legs run on: the basemap leaves
    residential streets out, so without it a leg can look off-road. The decoded legs stay inside
    the frame: x ${p.legs.extent[0]} to ${p.legs.extent[2]}, y ${p.legs.extent[1]} to ${p.legs.extent[3]}.
  - OSRM's route and table agree: the worst gap between a route's duration and its table entry is
    ${p.legs.worstRouteVsTableGapSeconds} s.

### Feeding VROOM

\`\`\`json
{
  "vehicles": [{ "id": 1, "profile": "car", "start_index": 0, "end_index": 0, "capacity": [CAPACITY] }],
  "jobs": [{ "id": STOP_I, "location_index": STOP_I, "delivery": [QTY], "service": ${C.SERVICE_SECONDS} }],
  "matrices": { "car": { "durations": ROWS_OF_DURATIONS, "distances": ROWS_OF_DISTANCES } }
}
\`\`\`

The matrix can be cut to the bakery and the chosen stops, with indices remapped, or passed whole.

### The naive plan, for "before"

One plain rule for "in the order the orders came in": deal the orders to the vans in turn as they
arrive (order 1 to van 1, order 2 to van 2, ...), and each van drives its orders in that order,
from the bakery and back. For "${busy.name}" (${busy.stops.length} stops, ${busy.vans} vans) that is
${min(baseSec)} of driving and handing over in all, ${km(baseM)}:
${base.vans.map((v, k) => `van ${k + 1} ${min(v.seconds)}, ${km(v.metres)}, ${v.stops.length} stops`).join('; ')}.
VROOM's plan for the same day is the page's to compute; \`preview.svg\` draws the naive one.

## Rebuild

\`\`\`sh
cd pipeline
npm ci                       # OSRM 26.6.5 (its install script fetches the binary), d3-contour, polygon-clipping
sudo apt-get install osmium-tool curl   # osmium-tool 1.16.0 was used
node build.mjs --fresh       # ${run.seconds} s for the last fresh run on 4 CPUs; --clean deletes the work files after
\`\`\`

Work files go to \`$ROUTE_WORK\` (default /tmp/route-work; ${Math.round(run.workBytes / 1e6)} MB with the OSRM graph) and the
download to \`$ROUTE_DOWNLOADS\` (default /tmp/route-dl; ${Math.round(run.downloadBytes / 1e6)} MB). Without \`--fresh\`, a step
whose output exists is skipped. Everything the pipeline decides is in \`pipeline/config.mjs\`: the
boxes, the bakery, the stops and their order lines, the labels, the bands, the simplification
tolerances and the seed.

## Checks the build runs

- The download's MD5 matches the publisher's.
- Every stop is found in OSM by name and tag, inside the frame, reachable both ways, and at least
  ${C.MIN_STOP_SPACING_M} m from every other point.
- Every pair has a route; every packed leg decodes, joins its points and stays within tolerance.
- The served files have no decimal number (so no coordinates), nothing that reads as a time of
  day, no exclamation mark, and only characters both of the site's font subsets carry.

## Open questions for review

- **The city.** docs/lab.md, "Rules for every demo", says the map extract is "a city with no tie to
  where Joseph lives or works, or a synthetic grid, chosen in an ASK review", and content.md classes
  the city as NEVER by default. Joseph's request named the Washington State area; Seattle is the
  pick inside it. Publishing needs his clearance in writing. Moving the map is one edit to
  \`config.mjs\` (boxes, bakery, stops, labels) and a re-run.
- **Labels that name the city:** "West Seattle" among the places, and stop labels such as "West
  Seattle library". Drop them from \`config.mjs\` if the city is held.
- **Free-flow times.** OSRM's car profile knows speed limits, not traffic. The page should say
  "minutes without traffic", or scale the matrix by a stated factor.
`;
}
