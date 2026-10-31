// Page geometry (design-system.md, "Page geometry"): a background symbol behind a page's top right,
// drawn once at build from the page's own subject, in --ground, a step off the enamel (ADR 0025):
// two wheels on About. Writing's ruled sheet and the Lab's street plans are gone with the rest of
// the faint drawings: a rule is functional or a lab's line, and the labs' own lines are their
// pictures now. The 404's line, which ends in a buffer stop, left the background on 2026-10-30
// for the page's own flow under its words (END_OF_LINE): anchored to the window's corner it could
// end neither at the column's edge nor clear of the button at every width. The drawing is
// generated, so it costs a few hundred bytes. This module is pure: the same kind gives the same
// paths, byte for byte, so a page's markup changes only when its drawing does.

/** Which drawing a page carries: About's wheels. Every other page carries none: Home's picture is
 *  the Route Lab's scene (ADR 0024), a lab's is its line, and the 404's is its end of the line. */
export type GroundKind = 'about';

/** One shape: a line in --ground, a heavier line (a wheel's rim, the handlebar), or a mark in the
 *  lamp's color. */
export interface GroundPath {
  readonly d: string;
  readonly kind: 'line' | 'index' | 'mark';
}

export interface Ground {
  readonly kind: GroundKind;
  readonly paths: readonly GroundPath[];
}

/** The drawing's box: anchored to the page's top right corner and never scaled up. */
export const GROUND_BOX = { width: 1200, height: 900 } as const;

/** A coordinate in whole units, so the markup stays small. */
const r = (value: number) => Math.round(value);

/** Two wheels with 36 spokes each and the T of a handlebar: the site's scooter, as geometry. Its
 *  right rim stands 70 units inside the box, the page's gutter at the box's natural size, so it
 *  never touches the window's edge; until 2026-10-30 it reached within 5 px of it at 1440. */
function about(): Ground {
  const paths: GroundPath[] = [];
  const wheel = (cx: number, cy: number, radius: number) => {
    const circle = (rr: number) =>
      `M${cx - rr} ${cy}a${rr} ${rr} 0 1 0 ${2 * rr} 0a${rr} ${rr} 0 1 0 ${-2 * rr} 0`;
    paths.push({ d: circle(radius), kind: 'index' });
    paths.push({ d: circle(r(radius * 0.86)) + circle(r(radius * 0.12)), kind: 'line' });
    let spokes = '';
    for (let k = 0; k < 36; k++) {
      const a = (k / 36) * Math.PI * 2;
      const b = a + 0.9;
      spokes += `M${r(cx + radius * 0.12 * Math.cos(a))} ${r(cy + radius * 0.12 * Math.sin(a))}`;
      spokes += `L${r(cx + radius * 0.86 * Math.cos(b))} ${r(cy + radius * 0.86 * Math.sin(b))}`;
    }
    paths.push({ d: spokes, kind: 'line' });
  };
  wheel(760, 640, 120);
  wheel(1010, 640, 120);
  paths.push({ d: 'M885 640V240M795 240H975', kind: 'index' });
  return { kind: 'about', paths };
}

/**
 * The 404's drawing, under its words in the page's flow (pages/404.astro): a track across the
 * column from its left edge, ending at its right edge in a buffer stop, a beam across the track
 * with the stop's body behind it, and its lamp lit on top, the one mark: the page a visitor reached
 * is where the line ends. The track and the stop are the functional rule's colour, so they read,
 * and the lamp the lit lamp's. The track runs the column's width, so the stop's coordinates are
 * measured leftward from the column's right edge (a nested drawing at 100%), and keep their size.
 */
export const END_OF_LINE = {
  height: 84,
  track: 50,
  stop: 'M-24 18h6v64h-6zM-18 30h18v40h-18z',
  lamp: 'M-29 8a8 8 0 1 0 16 0a8 8 0 1 0 -16 0',
} as const;

const DRAWINGS: Record<GroundKind, () => Ground> = { about };

/** The drawing for a kind. */
export function groundFor(kind: GroundKind): Ground {
  return DRAWINGS[kind]();
}

/** The drawing a page path carries: the wheels on /about/, and none anywhere else, the 404 (which
 *  has no path) included, whose line is in its own markup. */
export function groundKindFor(path: string | undefined): GroundKind | null {
  if (path?.startsWith('/about/')) return 'about';
  return null;
}
