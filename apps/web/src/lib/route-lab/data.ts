// The Route Lab's data, as tools/route-data/pipeline/build.mjs writes it from OpenStreetMap
// (tools/route-data/out/README.md has every field). This module only names the shapes; the page
// imports the files at build, and the browser fetches route-data.json on first use. Every
// coordinate is an integer in the map's viewBox units, never a longitude or a latitude.

/** A place on the map. Point 0 is the bakery; every other point is a drop-off spot with an order. */
export interface Point {
  /** The index into the matrices. */
  readonly i: number;
  readonly label: string;
  readonly kind: string;
  /** What the van carries there; the bakery has none. */
  readonly order?: string;
  /** Boxes, for van capacity. */
  readonly qty?: number;
  readonly x: number;
  readonly y: number;
}

/** A ready-made day from the pipeline: its orders in the order they came in. */
export interface Scenario {
  readonly id: string;
  readonly name: string;
  readonly vans: number;
  readonly capacity: number;
  readonly stops: readonly number[];
}

/** The road geometry of every leg, packed as one graph (tools/route-data/pipeline/lib/legs.mjs). */
export interface PackedLegs {
  readonly verts: readonly number[];
  readonly segs: readonly number[];
  readonly starts: readonly number[];
  readonly legs: string;
}

/** route-data.json: the places, the days, the travel matrices and the legs. */
export interface RouteData {
  readonly license: string;
  readonly attribution: string;
  readonly copyright: string;
  readonly viewBox: readonly [number, number, number, number];
  /** Seconds at each stop to hand the order over. */
  readonly serviceSeconds: number;
  readonly points: readonly Point[];
  readonly scenarios: readonly Scenario[];
  /** Seconds from i to j at [i * n + j]: OSRM's car profile, without traffic. */
  readonly durations: readonly number[];
  /** Metres from i to j at [i * n + j]. */
  readonly distances: readonly number[];
  readonly legs: PackedLegs;
}

/** basemap.json: SVG path data per layer, and the labels. */
export interface Basemap {
  readonly viewBox: readonly [number, number, number, number];
  readonly water: string;
  readonly parks: string;
  readonly roads: Readonly<
    Record<'motorway' | 'primary' | 'secondary' | 'tertiary' | 'tunnel', string>
  >;
  readonly labels: readonly {
    readonly text: string;
    readonly x: number;
    readonly y: number;
    readonly kind: 'place' | 'area' | 'water';
  }[];
}

/** isochrones.json: the areas the bakery reaches within each number of minutes, nested. */
export interface Isochrones {
  readonly depot: readonly [number, number];
  readonly minutes: readonly number[];
  readonly within: readonly string[];
}
