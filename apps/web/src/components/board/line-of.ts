import type { AstroComponentFactory } from 'astro/runtime/server/index.js';

// Each lab's line (ADR 0025) is the component in ./lines/ named by its slug, drawn on Home's board,
// so a new lab joins it by adding its line there, with its shape in lib/line-shapes.ts, and
// nothing else. A lab without one is left off the board. Until ADR 0027 the Lab index drew the
// same lines; it draws each lab's glyph now (components/iso/Glyph.astro).
const LINES = import.meta.glob<{ default: AstroComponentFactory }>('./lines/*.astro', {
  eager: true,
});

/** The line component of the lab with this slug, if it has one. */
export const lineOf = (slug: string): AstroComponentFactory | undefined =>
  LINES[`./lines/${slug}.astro`]?.default;
