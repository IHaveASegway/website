// The simulated labs (ADR 0020, ADR 0026): each runs its system in virtual time in the browser,
// from an app its page's own module loads on intent, and draws it with a sheet of its own. Such a
// lab joins the checks over the build by one row in the table below:
//   scripts.test.ts  allows its module on its page only, from /_astro/, never inline;
//   budgets.test.ts  holds its lazy JavaScript and its page's first view to their budgets;
//   tokens.test.ts   finds its sheet by its map class and refuses any motion in it.
// Its page also puts its slug in OWN_PAGE (src/lib/lab.ts) and its URL in published-urls.txt.
// The Route Lab and Home's scene keep entries of their own (support/measure.ts FEATURES), since
// WebAssembly, route data and the scene make them differ.

export interface SimulatedLab {
  /** Its slug: its page is /lab/<slug>/, and its verdict and its feature are <slug>-lab. */
  readonly slug: string;
  /** Its component, whose name Astro gives the bundle it builds from the component's script. */
  readonly bundle: string;
  /** A class only its own sheet holds, by which the checks find that sheet in the build. */
  readonly map: string;
  /** Its lazy JavaScript budget, in bytes, gzip -9. */
  readonly lazyJavaScript: number;
}

/**
 * One row per simulated lab. The Raft Lab keeps the 8,000 B of ADR 0020. The builders of the other
 * three pages raised theirs over it, for ADR 0026 to accept or refuse, each to fit its own app
 * chunk as measured on 2026-10-30: the Queue Lab's 11,524 B, of which the test-only faults are
 * 118 B and resizing the pool 111 B, which no control reaches; the Cache Lab's 10,686 B, still
 * 7,718 B with every string emptied; and the Backfill Lab's 10,631 B, about 6,200 B of it the
 * simulator, its checker and the model. The Backfill Lab's map class is its board's.
 */
export const SIMULATED_LABS = [
  { slug: 'raft', bundle: 'RaftLab', map: 'rf-map', lazyJavaScript: 8_000 },
  { slug: 'queue', bundle: 'QueueLab', map: 'qu-map', lazyJavaScript: 12_000 },
  { slug: 'cache', bundle: 'CacheLab', map: 'cl-map', lazyJavaScript: 11_000 },
  { slug: 'backfill', bundle: 'BackfillLab', map: 'bf-board', lazyJavaScript: 11_000 },
] as const satisfies readonly SimulatedLab[];

type Row = (typeof SIMULATED_LABS)[number];

/** The names the simulated labs' script verdicts and features go by. */
export type SimulatedLabName = `${Row['slug']}-lab`;

/** The name a lab's script verdict and its feature go by: "queue-lab". */
export const labName = <L extends Row>(lab: L): `${L['slug']}-lab` => `${lab.slug}-lab`;

/** How a test names a lab: "the Queue Lab". */
export const labTitle = (lab: SimulatedLab): string => `the ${lab.bundle.replace(/Lab$/, ' Lab')}`;

/** A lab's page in the build. */
export const labPage = (lab: SimulatedLab): string => `lab/${lab.slug}/index.html`;

const bundle = (lab: SimulatedLab): string =>
  `_astro/${lab.bundle}\\.astro_astro_type_script_index_0_lang\\.[\\w-]+\\.js`;

/** A lab's module as a file in the build. */
export const labEntry = (lab: SimulatedLab): RegExp => new RegExp(`^${bundle(lab)}$`);

/** A lab's module as its page names it, from /_astro/. */
export const labSrc = (lab: SimulatedLab): RegExp => new RegExp(`^/${bundle(lab)}$`);
