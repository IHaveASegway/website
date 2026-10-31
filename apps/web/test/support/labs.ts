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
 * One row per simulated lab. The Raft Lab keeps the 8,000 B of ADR 0020. The others' budgets are
 * proposed in ADR 0026, each its lab's measure rounded up to the next 500 B, so the next growth
 * past it is a decision and not a default.
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
 * The Cache Lab's retry storm, 2026-10-31 (ADR 0026, postscript of that date): 11,848 B, its app
 * 10,929 B and the same two chunks, so its budget is 12,000 B. Two settings, what a reader does
 * when it times out and whether the pool drops a fetch nobody waits for, with their controls, the
 * event log's lines and the retries beside the readers, added about 760 B to the app, 682 B net:
 * first, as ADR 0026 asks before any budget is raised, the test-only fault branches left the
 * shipped chunk (sim.ts, TESTING), about 80 B. The rest carries the lesson, and 12,000 B is the
 * measure rounded up to the next 500 B. The review's fixes the same day, the event log telling a
 * reader who asked again from one who gave up and the retries said as a rate, took it to 11,963 B,
 * 37 B under: the next change to the Cache Lab's app meets its budget first.
 */
export const SIMULATED_LABS = [
  { slug: 'raft', bundle: 'RaftLab', map: 'rf-map', lazyJavaScript: 8_000 },
  { slug: 'queue', bundle: 'QueueLab', map: 'qu-map', lazyJavaScript: 12_500 },
  { slug: 'cache', bundle: 'CacheLab', map: 'cl-map', lazyJavaScript: 12_000 },
  { slug: 'backfill', bundle: 'BackfillLab', map: 'bf-board', lazyJavaScript: 12_000 },
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
