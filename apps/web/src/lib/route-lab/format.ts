// How the Route Lab writes a time, in a module of its own, so a page that only writes a time (Home's
// card facts, lib/lab-facts.ts) loads this alone, not the whole of plan.ts with it. Until ADR 0027
// Home's scene (scripts/route-scene.ts, removed) counted the day with it in the browser.
// plan.ts re-exports it, so the lab's own imports read as before.

/** The space between a figure and its unit: a no-break space, so the two never part. */
export const NBSP = '\u00a0';

/** A time as the page writes it: "3 h 12 min", "52 min", whole minutes, rounded. */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}${NBSP}h ${m}${NBSP}min` : `${m}${NBSP}min`;
}

/** Where the day stands, in the sentence Home's caption says beside the scene: "20 min into the
 *  day: 6 of 20 orders delivered." The build writes it for the day's end, which its picture shows,
 *  and the scene's clock (scripts/route-scene.ts) counts it as the vans drive. One form at every
 *  moment, so with tabular figures the day's end is the widest it gets, and the clock, which keeps
 *  that sentence's room, never moves the words after it. */
export const dayLine = (seconds: number, delivered: number, orders: number): string =>
  `${formatDuration(seconds)} into the day: ${delivered} of ${orders} orders delivered.`;
