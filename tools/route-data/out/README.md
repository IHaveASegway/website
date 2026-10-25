# Route Lab map data

Static map data for the Route Lab demo: a fictional bakery in Seattle sends vans to 63 public
places, and VROOM, compiled to WebAssembly, plans the routes in the visitor's browser. Everything
here is computed offline from OpenStreetMap by `pipeline/build.mjs`; nothing is computed on a
server at runtime.

The three JSON files are what the site serves: 313.6 KB raw, **94.7 KB gzip -9**
together, against a target of 250 KB gzip for everything the page loads except the WASM.

## Files

| File | What | Served | Raw | gzip -9 |
| --- | --- | --- | ---: | ---: |
| `basemap.json` | Water, parks, roads by class, labels: SVG path data in viewBox units | yes, or inlined at build | 65.2 KB | 29.0 KB |
| `isochrones.json` | Areas the bakery reaches within 5, 10, 15, 20, 25, 30 minutes | yes, or inlined at build | 23.6 KB | 8.3 KB |
| `route-data.json` | Points, ready-made days, the duration and distance matrix, packed leg geometry | yes, fetched by the page | 224.9 KB | 57.4 KB |
| `preview.svg` | Every layer and the naive plan for one day, for a human eye | no | 140.4 KB | 55.7 KB |
| `provenance.json` | Source checksums, tool versions, every point with its OSM element and coordinates | no: it has coordinates and a timestamp |  |  |
| `sizes.json` | The sizes above, and raw characters per layer | no |  |  |
| `fresh-run.json` | Time and disk use of the last fresh run, quoted under Rebuild | no |  |  |

SHA-256 of the served files: `basemap.json` `48819c6a1e2301ac34ed0e8117eac756dc1330900a7161deb1d79e7aad3e99ea`; `isochrones.json` `579c54d95f37e60ceb6b5bdc9d9b06eb44cd91f83df5c642d02c8327f3b912af`; `route-data.json` `9a1eb680ac2ebf875a50c42214e6c4e74a306cf79bde22fe93132c8cd1b6fcbd`. Two runs over
the same OSRM graph write byte-identical files. OSRM's multi-threaded preprocessing is not
bit-stable: over three fresh runs on 2026-10-25, one of the 4,096 distances (Westcrest Park to
Northgate library) came out 24,625 m once and 24,626 m twice; every duration and every leg
matched.

Raw characters per layer: basemap.water 9,385; basemap.parks 11,820; basemap.roads.motorway 3,362; basemap.roads.primary 8,897; basemap.roads.secondary 11,504; basemap.roads.tertiary 17,290; basemap.roads.tunnel 786; route-data.legs 149,863; route-data.matrix 41,795.

## Sources, licences and attribution

- **Map data:** © OpenStreetMap contributors, under the Open Database License 1.0 (ODbL). The page
  must show the text "© OpenStreetMap contributors", linked to
  https://www.openstreetmap.org/copyright, next to the map (ODbL 4.3, the notice for a Produced
  Work). The served JSON files are a derivative database, so they are under the ODbL too (4.4):
  each says `"license": "ODbL-1.0"` and carries the attribution and the link. Serving them at
  public URLs, with this pipeline as the method that made them, is the offer ODbL 4.6 asks for.
- **Extract:** BBBike, Seattle: https://download.bbbike.org/osm/bbbike/Seattle/Seattle.osm.pbf. OSM replication timestamp 2026-10-16T23:00:00Z;
  69,405,184 bytes; MD5 `983f27c6eddf4cb369254cb5e9daedd6`, which matches the publisher's checksum file;
  SHA-256 `b479708056b5a26fc09f399991818d9f6f799e02012d97ce3112554d9f56d3bc`; fetched 2026-10-25.
  Geofabrik, Washington (https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf) failed first from the build machine: `curl: (35) Recv failure: Connection reset by peer`. The pipeline tries Geofabrik's Washington extract first and falls back to
  BBBike's Seattle cut, which holds the same OSM data for a box around Seattle.
- **Build-time tools** (nothing from them ships): Node v26.12.1; osmium-tool 1.16.0
  (GPL-3.0); OSRM 26.6.5 through `@project-osrm/osrm` (BSD-2-Clause), car profile;
  d3-contour 4.0.2 (ISC); polygon-clipping 0.15.7 (MIT).
  OSRM is 26.6.5, not the newest 26.10.0: the 26.7.3, 26.9.0 and 26.10.0 binaries need glibc
  2.43, Ubuntu 24.04 has 2.39, and 26.6.5 is the newest release checked that runs on it.
- **The solver** is VROOM (BSD-2-Clause), built separately; this data feeds it.
- **Names and order lines:** place names are OSM's `name` tags (ODbL), shortened into labels; the
  bakery and every order line are made up.

## Region and projection

- Display box (what the visitor sees), WGS84 west, south, east, north: -122.44, 47.493, -122.16, 47.735.
  Seattle from Carkeek Park to Rainier Beach, West Seattle to Bellevue, with Puget Sound, Elliott
  Bay, Lake Union, Green Lake and Lake Washington.
- Routing box (roads OSRM uses): -122.45, 47.493, -122.15, 47.742. About 750 m wider than the display
  box on three sides and flush with it in the south, so no leg leaves the picture. In a trial
  build on 2026-10-24 with BBBike's whole box, 78 of 4,032 legs ran up to 4.8 km outside the frame.
- Feature box (basemap lines run off the edge cleanly): -122.46, 47.48, -122.14, 47.75.
- Projection: Web Mercator, north up, into `viewBox="0 0 2000 2564"`. One unit is
  10.506 m on the ground at the box's middle latitude. Every served coordinate is an
  integer in these units; no served file has a longitude or a latitude.

## Points

Point 0 is the bakery: fictional, snapped to an ordinary street, with no address shown. Stops are
public places: parks, gardens, beaches, viewpoints, libraries, markets and landmarks, found in the
OSM data by name and tag. Each is snapped to the nearest ordinary street (primary to residential,
never a freeway or a ramp) that OSRM can reach from downtown and route back from, at least 40 units
inside the frame. No two points are closer than 450 m. A place is a drop-off
spot; no place is presented as the customer. `qty` is boxes, for van capacity.

| i | Label | Kind | Order | Boxes | OSM element | Snapped lon, lat | Street |
| ---: | --- | --- | --- | ---: | --- | --- | --- |
| 0 | The bakery | depot |  |  | none: fictional | -122.33830, 47.62322 | Republican Street |
| 1 | Gas Works Park | park | 2 dozen maple bars for kite flyers | 2 | relation/1047789 (Gas Works Park) | -122.33483, 47.64684 | North Northlake Way |
| 2 | Kerry Park | viewpoint | 12 croissants with a view | 1 | node/693337509 (Kerry Park) | -122.35992, 47.62958 | West Highland Drive |
| 3 | Discovery Park | park | Trail mix cookies, 3 dozen | 3 | relation/4874562 (Discovery Park) | -122.41993, 47.66092 | Discovery Park Boulevard |
| 4 | Golden Gardens | park | S’mores bars for a beach fire | 2 | way/159483662 (Golden Gardens Park) | -122.40105, 47.69331 | Golden Gardens Drive Northwest |
| 5 | Carkeek Park | park | 1 salmon-shaped sourdough | 1 | way/9108781 (Carkeek Park) | -122.37667, 47.71139 | (unnamed) |
| 6 | Ballard Locks | landmark | Cardamom buns, 18 | 2 | way/292961531 (Hiram M. Chittenden Locks) | -122.39791, 47.66757 | Northwest 54th Street |
| 7 | Ballard library | library | Quiet cookies, 2 dozen | 2 | way/37056567 (The Seattle Public Library - Ballard Branch) | -122.38474, 47.66989 | 22nd Avenue Northwest |
| 8 | Fremont market | market | Bagels by the baker’s dozen, 3 bags | 3 | node/3502347374 (Fremont Sunday Market) | -122.35290, 47.65014 | North 34th Street |
| 9 | Fremont Troll | park | 1 very large cinnamon roll | 1 | way/295288784 (Troll's Knoll Park) | -122.34666, 47.65117 | Winslow Place North |
| 10 | Woodland Park | park | Animal crackers, homemade, 4 tins | 2 | way/8097142 (Woodland Park) | -122.34007, 47.66807 | Green Lake Way North |
| 11 | Green Lake | park | Banana bread for the 3-mile loop | 2 | relation/6580044 (Green Lake Park) | -122.32610, 47.67902 | East Green Lake Way North |
| 12 | Ravenna Park | park | Rye loaves, 6 | 2 | relation/12733905 (Ravenna Park) | -122.30487, 47.67269 | Northeast 61st Street |
| 13 | U District market | market | Marionberry hand pies, 2 dozen | 3 | way/700585355 (University District Farmers Market) | -122.31306, 47.66644 | Northeast 52nd Street |
| 14 | Magnuson Park | park | Dog-safe peanut biscuits, 5 bags | 2 | relation/6618625 (Warren G. Magnuson Park) | -122.26018, 47.68100 | Sportsfield Drive Northeast |
| 15 | Matthews Beach | park | Lemon bars, 2 trays | 2 | relation/454191 (Matthews Beach Park) | -122.27415, 47.69589 | Northeast 93rd Street |
| 16 | Lake City library | library | Bookmark shortbread, 3 dozen | 2 | way/37058522 (The Seattle Public Library - Lake City Branch) | -122.29770, 47.71961 | 28th Avenue Northeast |
| 17 | Northgate library | library | Pretzel knots, 20 | 2 | way/34151057 (The Seattle Public Library - Northgate Branch) | -122.32316, 47.70596 | 5th Avenue Northeast |
| 18 | Meadowbrook Pond | park | Duck-shaped sugar cookies, 2 dozen | 1 | way/31712713 (Meadowbrook Pond) | -122.28814, 47.70476 | Northeast 105th Street |
| 19 | Greenwood library | library | Morning buns, 16 | 2 | way/34151528 (The Seattle Public Library - Greenwood Branch) | -122.35466, 47.68767 | North 81st Street |
| 20 | Broadview library | library | Oatmeal raisin cookies, 2 dozen | 1 | way/37056853 (The Seattle Public Library - Broadview Branch) | -122.35605, 47.72324 | North 130th Street |
| 21 | Arboretum | park | Matcha shortbread, 3 tins | 1 | relation/241864 (Washington Park Arboretum) | -122.29707, 47.63785 | Lake Washington Boulevard East |
| 22 | Volunteer Park | park | A tiered cake for a picnic | 3 | way/13800188 (Volunteer Park) | -122.31524, 47.63049 | Volunteer Park Road |
| 23 | Cal Anderson Park | park | Rainbow sprinkle doughnuts, 2 dozen | 2 | way/158721036 (Cal Anderson Park) | -122.32006, 47.61703 | Nagle Place |
| 24 | Smith Cove Park | park | Pain au chocolat, 15 | 2 | relation/453685 (Smith Cove Park) | -122.38699, 47.63220 | 23rd Avenue West |
| 25 | International Fountain | landmark | Mini cupcakes, 48 | 2 | way/35352476 (International Fountain) | -122.35411, 47.62327 | Warren Avenue North |
| 26 | Sculpture Park | park | Croissant sculpture, edible | 1 | relation/7406606 (Olympic Sculpture Park) | -122.35390, 47.61659 | Western Avenue |
| 27 | Pike Place Market | landmark | Sourdough rounds, 10 | 3 | way/363400641 (Pike Place Market) | -122.34275, 47.61000 | Pike Place |
| 28 | Central Library | library | Alphabet cookies, A to Z, twice | 2 | way/37056442 (The Seattle Public Library - Central Library) | -122.33214, 47.60690 | 5th Avenue |
| 29 | Mount Baker Park | park | Madeleines, 3 dozen | 2 | relation/537288 (Mount Baker Park) | -122.28806, 47.57910 | Lake Park Drive South |
| 30 | Pioneer Square | park | Coffee cake, 4 loaves | 2 | way/52781879 (Pioneer Square) | -122.33413, 47.60200 | 1st Avenue |
| 31 | Hing Hay Park | park | Pineapple buns, 2 dozen | 2 | way/26397746 (Hing Hay Park) | -122.32572, 47.59837 | South King Street |
| 32 | Rizal Park | park | Ube rolls, 12 | 1 | way/26398092 (Dr. Jose Rizal Park) | -122.31728, 47.59237 | 12th Avenue South |
| 33 | Kinnear Park | park | Scones and jam, 18 | 2 | way/49321099 (Kinnear Park) | -122.36589, 47.62759 | West Olympic Place |
| 34 | Magnolia Park | park | Apple galettes, 4 | 2 | relation/812874 (Magnolia Park) | -122.39865, 47.63270 | West Galer Street |
| 35 | Interlaken Park | park | Trail bars, 30 | 2 | relation/6057934 (Interlaken Park) | -122.30743, 47.63494 | Interlaken Drive East |
| 36 | Madison Park Beach | beach | Fruit tart for 12 | 1 | way/42729416 (Madison Park Beach) | -122.27714, 47.63509 | 43rd Avenue East |
| 37 | Madrona Park | park | Ginger molasses cookies, 2 dozen | 1 | relation/537269 (Madrona Park) | -122.28290, 47.61010 | Lake Washington Boulevard |
| 38 | Leschi Park | park | Focaccia slabs, 3 | 2 | relation/2518718 (Leschi Park) | -122.28564, 47.60083 | Lakeside Avenue South |
| 39 | Judkins Park | park | Brownies for a soccer team | 2 | relation/4758992 (Judkins Park and Playfield) | -122.30325, 47.59458 | South Charles Street |
| 40 | Jefferson Park | park | Hot cross buns, 18 | 2 | relation/537386 (Jefferson Park) | -122.31130, 47.56744 | (unnamed) |
| 41 | Columbia City market | market | Conchas, 2 dozen | 2 | way/1289733279 (Columbia City Farmers Market) | -122.28751, 47.55866 | South Edmunds Street |
| 42 | Seward Park | park | Owl-shaped cookies, 20 | 1 | relation/971480 (Seward Park) | -122.25095, 47.55240 | Seward Park Road |
| 43 | Kubota Garden | garden | Mochi doughnuts, 2 dozen | 2 | way/42006992 (Kubota Garden) | -122.26473, 47.51309 | 55th Avenue South |
| 44 | Rainier Beach library | library | Peach hand pies, 16 | 2 | way/228294299 (The Seattle Public Library - Rainier Beach Branch) | -122.27000, 47.52142 | Rainier Avenue South |
| 45 | Pritchard Beach | park | Popsicle-stick shortbread, 3 dozen | 1 | way/50275556 (Pritchard Island Beach) | -122.26220, 47.52889 | Island Drive South |
| 46 | South Park library | library | Empanadas, 30 | 3 | way/37058770 (The Seattle Public Library - South Park Branch) | -122.32258, 47.52647 | South Cloverdale Street |
| 47 | Westcrest Park | park | Dog biscuits, 6 bags | 2 | way/31870890 (Westcrest Park) | -122.34019, 47.52279 | 4th Avenue Southwest |
| 48 | Lincoln Park | park | Baguettes, 12 | 2 | way/31065701 (Lincoln Park) | -122.39270, 47.53045 | Fauntleroy Way Southwest |
| 49 | Fauntleroy Park | park | Ferry-shaped butter cookies, 2 dozen | 1 | way/31112354 (Fauntleroy Park) | -122.38043, 47.51930 | Southwest Cambridge Street |
| 50 | Alki Beach | park | Beach-day snickerdoodles, 3 dozen | 2 | relation/3195464 (Alki Beach Park) | -122.40886, 47.57967 | Alki Avenue Southwest |
| 51 | Hamilton Viewpoint | park | Skyline gingerbread, 1 slab | 1 | way/52496966 (Hamilton Viewpoint Park) | -122.38564, 47.59287 | Palm Avenue Southwest |
| 52 | West Seattle library | library | Biscotti, 4 jars | 1 | way/35093782 (The Seattle Public Library - West Seattle Branch) | -122.38512, 47.58270 | 42nd Avenue Southwest |
| 53 | Beacon Hill library | library | Egg tarts, 2 dozen | 2 | way/37056852 (The Seattle Public Library - Beacon Hill Branch) | -122.31144, 47.57774 | South Forest Street |
| 54 | Luther Burbank Park | park | Zucchini bread, 5 loaves | 2 | way/258709927 (Luther Burbank Park) | -122.22693, 47.58908 | Southeast 24th Street |
| 55 | Mercer Island library | library | Palmiers, 3 dozen | 1 | way/92831921 (Mercer Island Library) | -122.22160, 47.56693 | 88th Avenue Southeast |
| 56 | Bellevue Downtown Park | park | Kouign-amann, 12 | 2 | way/24547844 (Bellevue Downtown Park) | -122.20449, 47.61380 | Northeast 4th Street |
| 57 | Bellevue Botanical Garden | garden | Rosemary shortbread, 2 tins | 1 | relation/19654064 (Bellevue Botanical Garden) | -122.17828, 47.60453 | Lake Hills Connector |
| 58 | Kelsey Creek Farm | park | Carrot cake, 2 (none for the goats) | 1 | way/47397585 (Kelsey Creek Park) | -122.16684, 47.60274 | 130th Place Southeast |
| 59 | Chism Beach | park | Peanut butter cookies, 2 dozen | 1 | way/59147914 (Chism Beach Park) | -122.21013, 47.60097 | Southeast 11th Street |
| 60 | Juanita Beach | park | Cinnamon twists, 30 | 2 | way/26802962 (Juanita Beach Park) | -122.21463, 47.70539 | Northeast Juanita Drive |
| 61 | Heritage Park | park | Challah, 4 braids | 1 | way/33721382 (Heritage Park) | -122.21046, 47.67871 | Waverly Way |
| 62 | Newcastle Beach | park | Blueberry muffins, 2 dozen | 2 | relation/5909985 (Newcastle Beach Park) | -122.18873, 47.56545 | Southeast 50th Street |
| 63 | Georgetown market | market | Pumpkin loaves, 4 | 1 | way/1216391551 (Georgetown Trailer Park Mall and Saturday Market) | -122.31891, 47.55068 | South Homer Street |

## Formats

All path data is SVG: absolute `M` for the first subpath, relative `m` and `l` after it,
integers only. Fill closed shapes with `fill-rule="evenodd"`.

### basemap.json

- `water`: Puget Sound and Elliott Bay (land is built from `natural=coastline` ways, land on
  the left, clipped to the frame) united with lakes and rivers of 2.5 ha or more
  (`natural=water`, `waterway=riverbank`, `landuse=reservoir`). Islands are holes.
- `parks`: `leisure=park|garden|nature_reserve` of 3 ha or more, united.
- `roads`: open paths for stroking, by class: `motorway` (motorway and trunk), `primary`,
  `secondary`, `tertiary`, and `tunnel` (any of those in a tunnel, such as SR 99 under
  downtown; draw it dashed or faint). Links and residential streets are left out.
- `labels`: `{text, x, y, kind}`, kind `place` (OSM `place=suburb|neighbourhood`), `area`
  (`place=city|town|island`) or `water`. "Puget Sound" is placed by hand in open water.
- Suggested order, bottom to top: land (the page background), parks, isochrone bands, water, the
  leg network (below), roads from tertiary up to motorway, tunnels, routes, stops, labels, and the
  attribution.

### isochrones.json

- `depot`: the bakery's [x, y]. `minutes`: [5,10,15,20,25,30].
- `within[k]`: path data for the area reachable within `minutes[k]`. The areas are nested, so
  draw them largest first. One colour at low opacity per band shades nearer areas darker without a
  second colour. The areas are not clipped to land: draw water above them.
- How: an OSRM table from the bakery to a 125 m grid (170 x
  217 samples). A sample's time is the drive to the nearest ordinary
  street plus a walk from it at 1.4 m/s; a sample more than
  400 m from a street is unreached, which is why park interiors, port
  terminals and open water stay uncoloured. Contoured with d3-contour, smoothed twice with
  Chaikin's corner cutting, simplified at 1.5 units; rings under 4 ha dropped.
- Spread of the samples: 10% within 9.2 min, half within 16.7,
  90% within 24.7, the farthest 41.5. That is why the bands are
  5 minutes apart and stop at 30: bands at 10, 20, 30 and 40 minutes would colour nearly the whole
  map in two shades.

### route-data.json

One value per line: every array value and every object member is on its own line, with no
indentation (`formatRouteData` in `pipeline/lib/format.mjs`). On one line, adjacent numbers run
together as digits and commas, and by chance a run can read as one longer number, such as a phone
number or an ID; the content firewall flagged such runs in the one-line file. On its own line, each
number stands alone. Strings are as JSON.stringify writes them. `apps/web/test/route-lab.test.ts`
checks that no line holds two numbers and that the file is exactly what `formatRouteData` writes.

- `points`: `{i, label, kind, order?, qty?, x, y}`; `i` is the matrix index, 0 is the bakery.
- `serviceSeconds`: 180, the time at each stop.
- `scenarios`: ready-made days, `{id, name, vans, capacity, stops}`. `stops` is in the order the
  orders came in (a seeded shuffle, seed 20261024); `capacity` is boxes per van, 1.3 times the
  day's boxes divided by the vans. "A quiet Tuesday": 8 stops, 1 van, 19 boxes each. "A busy Saturday": 20 stops, 3 vans, 19 boxes each. "Every order at once": 63 stops, 4 vans, 37 boxes each.
- `durations`, `distances`: 64 x 64, row-major (from i to j is `[i * 64 + j]`), whole seconds
  and metres, OSRM's car profile. The longest leg is 42.5 min,
  40.1 km. These are free-flow times with no traffic; the page
  should say so.
- `legs`: road geometry for all 4,032 ordered pairs, packed as the union graph of the
  OSRM routes: 1,483 vertices, 2,348 segments, and
  97,543 choice digits in all (24.2 a leg).
  - `verts`: vertex x, y pairs, each the difference from the previous vertex (z-order).
  - `segs`: per segment `a, b, flags, m`, then `m` inner points as differences, starting from
    vertex `a`'s position; the segment runs a, inner points, b. `flags` bit 1: some leg drives it
    from a to b; bit 2: from b to a. Segments are numbered most-used first.
  - `starts`: each point's vertex.
  - `legs`: one string, comma-separated, for (0,1), (0,2) ... (0,63), (1,0), (1,2) ...; leg
    (i, j) is entry `i * 63 + (j < i ? j : j - 1)`. Walk from `starts[i]`. At each vertex
    list the ways on: a segment whose end `a` is this vertex and whose flags have bit 1, leaving
    from a; or whose end `b` is this vertex with bit 2, leaving from b; sorted by segment number,
    then a before b. With one way on, take it; with more, read the next base-36 digit as the index.
    Stop at `starts[j]`. `decodeLegs` in `pipeline/lib/legs.mjs` is the reference, 53 lines;
    the build decodes every leg and fails if one does not join its two points or strays more than
    2.4 units from OSRM's geometry (worst this build:
    1.26 units, about 13 m).
  - Draw every segment once, faint, as the street layer the legs run on: the basemap leaves
    residential streets out, so without it a leg can look off-road. The decoded legs stay inside
    the frame: x 143 to 1951, y 125 to 2515.
  - OSRM's route and table agree: the worst gap between a route's duration and its table entry is
    0 s.

### Feeding VROOM

```json
{
  "vehicles": [{ "id": 1, "profile": "car", "start_index": 0, "end_index": 0, "capacity": [CAPACITY] }],
  "jobs": [{ "id": STOP_I, "location_index": STOP_I, "delivery": [QTY], "service": 180 }],
  "matrices": { "car": { "durations": ROWS_OF_DURATIONS, "distances": ROWS_OF_DISTANCES } }
}
```

The matrix can be cut to the bakery and the chosen stops, with indices remapped, or passed whole.

### The naive plan, for "before"

One plain rule for "in the order the orders came in": deal the orders to the vans in turn as they
arrive (order 1 to van 1, order 2 to van 2, ...), and each van drives its orders in that order,
from the bakery and back. For "A busy Saturday" (20 stops, 3 vans) that is
394.0 min of driving and handing over in all, 239.4 km:
van 1 120.0 min, 67.4 km, 7 stops; van 2 173.4 min, 126.0 km, 7 stops; van 3 100.5 min, 46.0 km, 6 stops.
VROOM's plan for the same day is the page's to compute; `preview.svg` draws the naive one.

## Rebuild

```sh
cd pipeline
npm ci                       # OSRM 26.6.5 (its install script fetches the binary), d3-contour, polygon-clipping
sudo apt-get install osmium-tool curl   # osmium-tool 1.16.0 was used
node build.mjs --fresh       # 162 s for the last fresh run on 4 CPUs; --clean deletes the work files after
```

Work files go to `$ROUTE_WORK` (default /tmp/route-work; 215 MB with the OSRM graph) and the
download to `$ROUTE_DOWNLOADS` (default /tmp/route-dl; 69 MB). Without `--fresh`, a step
whose output exists is skipped. Everything the pipeline decides is in `pipeline/config.mjs`: the
boxes, the bakery, the stops and their order lines, the labels, the bands, the simplification
tolerances and the seed.

## Checks the build runs

- The download's MD5 matches the publisher's.
- Every stop is found in OSM by name and tag, inside the frame, reachable both ways, and at least
  450 m from every other point.
- Every pair has a route; every packed leg decodes, joins its points and stays within tolerance.
- The served files have no decimal number (so no coordinates), nothing that reads as a time of
  day, no exclamation mark, and only characters both of the site's font subsets carry.

## Open questions for review

- **The city.** docs/lab.md, "Rules for every demo", says the map extract is "a city with no tie to
  where Joseph lives or works, or a synthetic grid, chosen in an ASK review", and content.md classes
  the city as NEVER by default. Joseph's request named the Washington State area; Seattle is the
  pick inside it. Publishing needs his clearance in writing. Moving the map is one edit to
  `config.mjs` (boxes, bakery, stops, labels) and a re-run.
- **Labels that name the city:** "West Seattle" among the places, and stop labels such as "West
  Seattle library". Drop them from `config.mjs` if the city is held.
- **Free-flow times.** OSRM's car profile knows speed limits, not traffic. The page should say
  "minutes without traffic", or scale the matrix by a stated factor.
