import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

// Each lab's line (ADR 0025) is the component in ./lines/ named by its slug, drawn on Home's board
// and on the Lab index alike, so a new lab joins both by adding its line there and nothing else.
// A lab without one is left off the board and listed on the index without a drawing.
const LINES = import.meta.glob<{ default: AstroComponentFactory }>('./lines/*.astro', {
  eager: true,
});

/** Where a line is drawn: a band of Home's board, or a row of the Lab index, large, with its
 *  stations named. Each place has its own sizes and its own words under the line. */
export type LineAt = 'board' | 'index';

/** The line component of the lab with this slug, if it has one. */
export const lineOf = (slug: string): AstroComponentFactory | undefined =>
  LINES[`./lines/${slug}.astro`]?.default;
