// Everything the pipeline decides, in one place. Change a value here and re-run `npm run build`.

export const REGION = {
  // The map the visitor sees: Seattle and the near Eastside, with Puget Sound, Elliott Bay, Lake
  // Union, Green Lake and Lake Washington in frame. [west, south, east, north], WGS84.
  display: [-122.44, 47.493, -122.16, 47.735],
  // Roads OSRM routes on: the display box plus about 750 m on three sides, so streets along the
  // edge are whole, and flush with it in the south, where the southernmost stops are, so no leg
  // leaves the picture for a faster road outside it. With the BBBike box (5-10 km of margin) 78
  // of 4,032 legs ran up to 4.8 km outside the frame.
  routing: [-122.45, 47.493, -122.15, 47.742],
  // Basemap features are read from a slightly larger box so lines run off the edge cleanly.
  features: [-122.46, 47.48, -122.14, 47.75],
};

export const SOURCES = [
  {
    name: 'Geofabrik, Washington',
    url: 'https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf',
    md5: 'https://download.geofabrik.de/north-america/us/washington-latest.osm.pbf.md5',
  },
  {
    // Same OSM data, cut by BBBike to a box around Seattle; used when Geofabrik is unreachable.
    name: 'BBBike, Seattle',
    url: 'https://download.bbbike.org/osm/bbbike/Seattle/Seattle.osm.pbf',
    md5: 'https://download.bbbike.org/osm/bbbike/Seattle/CHECKSUM.txt',
  },
];

export const VIEW_WIDTH = 2000; // viewBox width in units; height follows from the projection

export const ISOCHRONE = {
  minutes: [5, 10, 15, 20, 25, 30],
  gridMetres: 125, // sample spacing of the depot-to-grid travel-time table
  maxWalkMetres: 400, // a sample farther than this from a drivable street is not reachable
  walkSpeed: 1.4, // m/s, from the street to the sample point
};

// A fictional bakery. The point is snapped to the nearest ordinary street; no address is shown.
export const DEPOT = { label: 'The bakery', lon: -122.3383, lat: 47.6232 };

// Drop-off spots: public places, found in the OSM data by name and tag. The order line is what
// the van carries there; no place is the customer. qty is boxes, for van capacity.
export const STOPS = [
  {
    name: 'Gas Works Park',
    tag: 'leisure=park',
    label: 'Gas Works Park',
    order: '2 dozen maple bars for kite flyers',
    qty: 2,
  },
  {
    name: 'Kerry Park',
    tag: 'tourism=viewpoint',
    label: 'Kerry Park',
    order: '12 croissants with a view',
    qty: 1,
  },
  {
    name: 'Discovery Park',
    tag: 'leisure=park',
    label: 'Discovery Park',
    order: 'Trail mix cookies, 3 dozen',
    qty: 3,
  },
  {
    name: 'Golden Gardens Park',
    tag: 'leisure=park',
    label: 'Golden Gardens',
    order: 'S’mores bars for a beach fire',
    qty: 2,
  },
  {
    name: 'Carkeek Park',
    tag: 'leisure=park',
    label: 'Carkeek Park',
    order: '1 salmon-shaped sourdough',
    qty: 1,
  },
  {
    name: 'Hiram M. Chittenden Locks',
    tag: 'tourism=attraction',
    label: 'Ballard Locks',
    order: 'Cardamom buns, 18',
    qty: 2,
  },
  {
    name: 'The Seattle Public Library - Ballard Branch',
    tag: 'amenity=library',
    label: 'Ballard library',
    order: 'Quiet cookies, 2 dozen',
    qty: 2,
  },
  {
    name: 'Fremont Sunday Market',
    tag: 'amenity=marketplace',
    label: 'Fremont market',
    order: 'Bagels by the baker’s dozen, 3 bags',
    qty: 3,
  },
  {
    name: "Troll's Knoll Park",
    tag: 'leisure=park',
    label: 'Fremont Troll',
    order: '1 very large cinnamon roll',
    qty: 1,
  },
  {
    name: 'Woodland Park',
    tag: 'leisure=park',
    label: 'Woodland Park',
    order: 'Animal crackers, homemade, 4 tins',
    qty: 2,
  },
  {
    name: 'Green Lake Park',
    tag: 'leisure=park',
    label: 'Green Lake',
    order: 'Banana bread for the 3-mile loop',
    qty: 2,
  },
  {
    name: 'Ravenna Park',
    tag: 'leisure=park',
    label: 'Ravenna Park',
    order: 'Rye loaves, 6',
    qty: 2,
  },
  {
    name: 'University District Farmers Market',
    tag: 'amenity=marketplace',
    label: 'U District market',
    order: 'Marionberry hand pies, 2 dozen',
    qty: 3,
  },
  {
    name: 'Warren G. Magnuson Park',
    tag: 'leisure=park',
    label: 'Magnuson Park',
    order: 'Dog-safe peanut biscuits, 5 bags',
    qty: 2,
  },
  {
    name: 'Matthews Beach Park',
    tag: 'leisure=park',
    label: 'Matthews Beach',
    order: 'Lemon bars, 2 trays',
    qty: 2,
  },
  {
    name: 'The Seattle Public Library - Lake City Branch',
    tag: 'amenity=library',
    label: 'Lake City library',
    order: 'Bookmark shortbread, 3 dozen',
    qty: 2,
  },
  {
    name: 'The Seattle Public Library - Northgate Branch',
    tag: 'amenity=library',
    label: 'Northgate library',
    order: 'Pretzel knots, 20',
    qty: 2,
  },
  {
    name: 'Meadowbrook Pond',
    tag: 'leisure=park',
    label: 'Meadowbrook Pond',
    order: 'Duck-shaped sugar cookies, 2 dozen',
    qty: 1,
  },
  {
    name: 'The Seattle Public Library - Greenwood Branch',
    tag: 'amenity=library',
    label: 'Greenwood library',
    order: 'Morning buns, 16',
    qty: 2,
  },
  {
    name: 'The Seattle Public Library - Broadview Branch',
    tag: 'amenity=library',
    label: 'Broadview library',
    order: 'Oatmeal raisin cookies, 2 dozen',
    qty: 1,
  },
  {
    name: 'Washington Park Arboretum',
    tag: 'leisure=park',
    label: 'Arboretum',
    order: 'Matcha shortbread, 3 tins',
    qty: 1,
  },
  {
    name: 'Volunteer Park',
    tag: 'leisure=park',
    label: 'Volunteer Park',
    order: 'A tiered cake for a picnic',
    qty: 3,
  },
  {
    name: 'Cal Anderson Park',
    tag: 'leisure=park',
    label: 'Cal Anderson Park',
    order: 'Rainbow sprinkle doughnuts, 2 dozen',
    qty: 2,
  },
  {
    name: 'Smith Cove Park',
    tag: 'leisure=park',
    label: 'Smith Cove Park',
    order: 'Pain au chocolat, 15',
    qty: 2,
  },
  {
    name: 'International Fountain',
    tag: 'tourism=attraction',
    label: 'International Fountain',
    order: 'Mini cupcakes, 48',
    qty: 2,
  },
  {
    name: 'Olympic Sculpture Park',
    tag: 'leisure=park',
    label: 'Sculpture Park',
    order: 'Croissant sculpture, edible',
    qty: 1,
  },
  {
    name: 'Pike Place Market',
    tag: 'tourism=attraction',
    label: 'Pike Place Market',
    order: 'Sourdough rounds, 10',
    qty: 3,
  },
  {
    name: 'The Seattle Public Library - Central Library',
    tag: 'amenity=library',
    label: 'Central Library',
    order: 'Alphabet cookies, A to Z, twice',
    qty: 2,
  },
  {
    name: 'Mount Baker Park',
    tag: 'leisure=park',
    label: 'Mount Baker Park',
    order: 'Madeleines, 3 dozen',
    qty: 2,
  },
  {
    name: 'Pioneer Square',
    tag: 'leisure=park',
    label: 'Pioneer Square',
    order: 'Coffee cake, 4 loaves',
    qty: 2,
  },
  {
    name: 'Hing Hay Park',
    tag: 'leisure=park',
    label: 'Hing Hay Park',
    order: 'Pineapple buns, 2 dozen',
    qty: 2,
  },
  {
    name: 'Dr. Jose Rizal Park',
    tag: 'leisure=park',
    label: 'Rizal Park',
    order: 'Ube rolls, 12',
    qty: 1,
  },
  {
    name: 'Kinnear Park',
    tag: 'leisure=park',
    label: 'Kinnear Park',
    order: 'Scones and jam, 18',
    qty: 2,
  },
  {
    name: 'Magnolia Park',
    tag: 'leisure=park',
    label: 'Magnolia Park',
    order: 'Apple galettes, 4',
    qty: 2,
  },
  {
    name: 'Interlaken Park',
    tag: 'leisure=park',
    label: 'Interlaken Park',
    order: 'Trail bars, 30',
    qty: 2,
  },
  {
    name: 'Madison Park Beach',
    tag: 'natural=beach',
    label: 'Madison Park Beach',
    order: 'Fruit tart for 12',
    qty: 1,
  },
  {
    name: 'Madrona Park',
    tag: 'leisure=park',
    label: 'Madrona Park',
    order: 'Ginger molasses cookies, 2 dozen',
    qty: 1,
  },
  {
    name: 'Leschi Park',
    tag: 'leisure=park',
    label: 'Leschi Park',
    order: 'Focaccia slabs, 3',
    qty: 2,
  },
  {
    name: 'Judkins Park and Playfield',
    tag: 'leisure=park',
    label: 'Judkins Park',
    order: 'Brownies for a soccer team',
    qty: 2,
  },
  {
    name: 'Jefferson Park',
    tag: 'leisure=park',
    label: 'Jefferson Park',
    order: 'Hot cross buns, 18',
    qty: 2,
  },
  {
    name: 'Columbia City Farmers Market',
    tag: 'amenity=marketplace',
    label: 'Columbia City market',
    order: 'Conchas, 2 dozen',
    qty: 2,
  },
  {
    name: 'Seward Park',
    tag: 'leisure=park',
    label: 'Seward Park',
    order: 'Owl-shaped cookies, 20',
    qty: 1,
  },
  {
    name: 'Kubota Garden',
    tag: 'leisure=garden',
    label: 'Kubota Garden',
    order: 'Mochi doughnuts, 2 dozen',
    qty: 2,
  },
  {
    name: 'The Seattle Public Library - Rainier Beach Branch',
    tag: 'amenity=library',
    label: 'Rainier Beach library',
    order: 'Peach hand pies, 16',
    qty: 2,
  },
  {
    name: 'Pritchard Island Beach',
    tag: 'leisure=park',
    label: 'Pritchard Beach',
    order: 'Popsicle-stick shortbread, 3 dozen',
    qty: 1,
  },
  {
    name: 'The Seattle Public Library - South Park Branch',
    tag: 'amenity=library',
    label: 'South Park library',
    order: 'Empanadas, 30',
    qty: 3,
  },
  {
    name: 'Westcrest Park',
    tag: 'leisure=park',
    label: 'Westcrest Park',
    order: 'Dog biscuits, 6 bags',
    qty: 2,
  },
  {
    name: 'Lincoln Park',
    tag: 'leisure=park',
    label: 'Lincoln Park',
    order: 'Baguettes, 12',
    qty: 2,
  },
  {
    name: 'Fauntleroy Park',
    tag: 'leisure=park',
    label: 'Fauntleroy Park',
    order: 'Ferry-shaped butter cookies, 2 dozen',
    qty: 1,
  },
  {
    name: 'Alki Beach Park',
    tag: 'leisure=park',
    label: 'Alki Beach',
    order: 'Beach-day snickerdoodles, 3 dozen',
    qty: 2,
  },
  {
    name: 'Hamilton Viewpoint Park',
    tag: 'leisure=park',
    label: 'Hamilton Viewpoint',
    order: 'Skyline gingerbread, 1 slab',
    qty: 1,
  },
  {
    name: 'The Seattle Public Library - West Seattle Branch',
    tag: 'amenity=library',
    label: 'West Seattle library',
    order: 'Biscotti, 4 jars',
    qty: 1,
  },
  {
    name: 'The Seattle Public Library - Beacon Hill Branch',
    tag: 'amenity=library',
    label: 'Beacon Hill library',
    order: 'Egg tarts, 2 dozen',
    qty: 2,
  },
  {
    name: 'Luther Burbank Park',
    tag: 'leisure=park',
    label: 'Luther Burbank Park',
    order: 'Zucchini bread, 5 loaves',
    qty: 2,
  },
  {
    name: 'Mercer Island Library',
    tag: 'amenity=library',
    label: 'Mercer Island library',
    order: 'Palmiers, 3 dozen',
    qty: 1,
  },
  {
    name: 'Bellevue Downtown Park',
    tag: 'leisure=park',
    label: 'Bellevue Downtown Park',
    order: 'Kouign-amann, 12',
    qty: 2,
  },
  {
    name: 'Bellevue Botanical Garden',
    tag: 'leisure=garden',
    label: 'Bellevue Botanical Garden',
    order: 'Rosemary shortbread, 2 tins',
    qty: 1,
  },
  {
    name: 'Kelsey Creek Park',
    tag: 'leisure=park',
    label: 'Kelsey Creek Farm',
    order: 'Carrot cake, 2 (none for the goats)',
    qty: 1,
  },
  {
    name: 'Chism Beach Park',
    tag: 'leisure=park',
    label: 'Chism Beach',
    order: 'Peanut butter cookies, 2 dozen',
    qty: 1,
  },
  {
    name: 'Juanita Beach Park',
    tag: 'leisure=park',
    label: 'Juanita Beach',
    order: 'Cinnamon twists, 30',
    qty: 2,
  },
  {
    name: 'Heritage Park',
    tag: 'leisure=park',
    label: 'Heritage Park',
    order: 'Challah, 4 braids',
    qty: 1,
  },
  {
    name: 'Newcastle Beach Park',
    tag: 'leisure=park',
    label: 'Newcastle Beach',
    order: 'Blueberry muffins, 2 dozen',
    qty: 2,
  },
  {
    name: 'Georgetown Trailer Park Mall and Saturday Market',
    tag: 'amenity=marketplace',
    label: 'Georgetown market',
    order: 'Pumpkin loaves, 4',
    qty: 1,
  },
];

// Neighbourhood and water labels: names and positions from OSM place=* and natural=water/bay
// features, except Puget Sound, whose label point is placed by hand in open water.
export const LABELS = {
  places: [
    'Ballard',
    'Fremont',
    'Wallingford',
    'University District',
    'Capitol Hill',
    'Queen Anne',
    'Magnolia',
    'Belltown',
    'West Seattle',
    'Beacon Hill',
    'Columbia City',
    'Georgetown',
    'Northgate',
    'Lake City',
    'Greenwood',
    'Rainier Beach',
    'Madison Park',
    'Delridge',
    'South Lake Union',
    'Interbay',
    'Laurelhurst',
    'Sand Point',
  ],
  // place=city/town/island features (they are areas or nodes in OSM).
  areas: ['Mercer Island', 'Bellevue', 'Kirkland', 'Medina'],
  water: [
    'Lake Washington',
    'Lake Union',
    'Green Lake',
    'Elliott Bay',
    'Shilshole Bay',
    'Union Bay',
    'Portage Bay',
  ],
  fixed: [{ text: 'Puget Sound', lon: -122.425, lat: 47.6 }],
};

// Drawn road classes, widest first. Links and residential streets are left out of the picture.
export const ROAD_CLASSES = {
  motorway: ['motorway', 'trunk'],
  primary: ['primary'],
  secondary: ['secondary'],
  tertiary: ['tertiary'],
};

// Streets a stop or an isochrone sample may snap to: ordinary streets, never a freeway or a ramp.
export const SNAP_CLASSES = [
  'primary',
  'secondary',
  'tertiary',
  'unclassified',
  'residential',
  'living_street',
];

export const SIMPLIFY = {
  coast: 1.0, // viewBox units; 1 unit is about 10.5 m on the ground
  water: 1.2,
  parks: 1.6,
  roads: 1.4,
  legs: 0.9,
  isochrone: 1.5,
};

// Ready-made days for the demo. Stops are drawn at random (seeded) from STOPS and listed in the
// order the orders came in; capacity is boxes per van, set so every day fits with room to spare.
export const SCENARIOS = [
  { id: 'quiet', name: 'A quiet Tuesday', stops: 8, vans: 1 },
  { id: 'busy', name: 'A busy Saturday', stops: 20, vans: 3 },
  { id: 'everything', name: 'Every order at once', stops: 'all', vans: 4 },
];
export const SERVICE_SECONDS = 180; // time at each stop to hand over the boxes

export const MIN_AREA_M2 = { water: 25000, park: 30000 };
export const MIN_STOP_SPACING_M = 450;
export const SEED = 20261024;
