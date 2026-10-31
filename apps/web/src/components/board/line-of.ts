import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

// Each lab's line (ADR 0025) is the component in ./lines/ named by its slug, drawn on Home's board
// and on the Lab index alike, so a new lab joins both by adding its line there, with its shape in
// lib/line-shapes.ts, and nothing else.
// A lab without one is left off the board and listed on the index without a drawing.
const LINES = import.meta.glob<{ default: AstroComponentFactory }>('./lines/*.astro', {
  eager: true,
});

/** Where a line is drawn (lib/line-shapes.ts, which holds each place's sizes). */
export type { LineAt } from '../../lib/line-shapes';

/** The line component of the lab with this slug, if it has one. */
export const lineOf = (slug: string): AstroComponentFactory | undefined =>
  LINES[`./lines/${slug}.astro`]?.default;
