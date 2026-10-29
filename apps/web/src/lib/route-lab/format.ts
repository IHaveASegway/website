// How the Route Lab writes a time, in a module of its own: Home's scene (scripts/route-scene.ts)
// counts the day in the lab's words and loads this alone, not the whole of plan.ts with it.
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
