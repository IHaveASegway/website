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
  /** Its lazy JavaScript budget: every chunk its module can load, in bytes, gzip -9. */
  readonly lazyJavaScript: number;
}

/**
 * One row per simulated lab. The Raft Lab kept the 8,000 B of ADR 0020 until 2026-11-02, when a run
 * that lands with a story to tell, a caption that says who only thinks it leads and a row for each
 * property took it to 8,451 B (its postscript): 8,500 B, rounded up to the next 500 B as the others
 * are. The others' budgets are proposed in ADR 0026, each its lab's measure rounded up to the next
 * 500 B, so the next growth past it is a decision and not a default.
 *
 * Measured on 2026-10-31 on the labs' review fixes merged with the signal box, every chunk a lab's
 * module can load, gzip -9:
 * - the Raft Lab 7,343 B: its app, 7,016 B, and the link's chunk, 327 B;
 * - the Queue Lab 12,474 B (budget 12,500 B): its app, 11,555 B, the link's chunk and lib/sim's
 *   other chunk, the agenda and the seeded stream, 592 B;
 * - the Cache Lab 11,166 B (11,500 B): its app, 10,247 B, and the same two;
 * - the Backfill Lab 11,572 B (12,000 B): its app, 10,653 B, and the same two.
 * The merge moved each app by 13 to 44 B, and no budget.
 * The Cache and Backfill Labs' branches set 11,000 B each. The link the three share took them past
 * it on 2026-10-31, to 11,005 and 11,319 B, and the Queue Lab past 12,000 B, to 12,048 B; then the
 * Raft Lab's link joined it, and the bundler gave the link a chunk of its own, 78 B more for each
 * of the three. Of the Queue Lab's app, the test-only faults are about 118 B and resizing the pool
 * 111 B, which no control reaches: ADR 0026 takes them out before any budget is raised again. The
 * Backfill Lab's map class is its board's.
 *
 * Raised on 2026-11-02 for one set of controls in the three labs (docs/lab.md, "The controls"): the
 * line that says what a press did, the shared event log and a setting that replays the run. Measured
 * then, each with its 2,035 B of shared chunks: the Queue Lab 13,796 B, the Cache Lab 12,437 B, the
 * Backfill Lab 12,943 B, against their 13,200, 12,000 and 12,500 B, each rounded up to the next 500 B.
 * ADR 0026 asks for the test-only faults to go first. They are about 118 B of the Queue Lab's app,
 * too little to stay inside any of these, and the build-time constant that would drop them ties the
 * core to the bundler: e2e specs import these modules outside it. That one is left for Joseph.
 *
 * With the same day's other fixes merged, the helper that sets an apostrophe (lib/typeset.mjs) stands
 * in the chunk all four share, so the three's shared chunks, 2,098 B, import it. Measured then: the
 * Raft Lab 8,490 B, the Queue Lab 13,857 B, the Cache Lab 12,482 B, the Backfill Lab 12,989 B. The
 * Cache and Backfill Labs came in over by 23 and 29 B and were trimmed back, with no budget moved.
 *
 * Then the Raft Lab took the same controls, the log and the line, and they moved to the chunk all four
 * share, 1,338 B. It paid for them by trimming (ADR 0020's postscript), with no budget moved. Measured
 * then: the Raft Lab 8,449 B, the Queue Lab 13,662 B, the Cache Lab 12,310 B, the Backfill Lab 12,790 B.
 *
 * On 2026-11-03 the top bar's button reached a run that's the visitor's, Back left a run alone, and the
 * summary line under the checks went, with no budget moved (ADR 0020's and ADR 0030's postscripts).
 */
export const SIMULATED_LABS = [
  { slug: 'raft', bundle: 'RaftLab', map: 'rf-map', lazyJavaScript: 8_500 },
  { slug: 'queue', bundle: 'QueueLab', map: 'qu-map', lazyJavaScript: 14_000 },
  { slug: 'cache', bundle: 'CacheLab', map: 'cl-map', lazyJavaScript: 12_500 },
  { slug: 'backfill', bundle: 'BackfillLab', map: 'bf-board', lazyJavaScript: 13_000 },
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
