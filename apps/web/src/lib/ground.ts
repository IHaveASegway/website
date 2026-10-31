// Page geometry (design-system.md, "Page geometry"): a background symbol behind a page's top right,
// drawn once at build from the page's own subject, in --ground, a step off the enamel (ADR 0025):
// two wheels on About, and on the 404 a line that ends in a buffer stop. Writing's ruled sheet and
// the Lab's street plans are gone with the rest of the faint drawings: a rule is functional or a
// lab's line, and the labs' own lines are their pictures now. The drawing is generated, so it costs
// a few hundred bytes. This module is pure: the same kind gives the same paths, byte for byte, so a
// page's markup changes only when its drawing does.

/** Which drawing a page carries: About's wheels and the 404's buffer stop. Every other page carries
 *  none: Home's picture is the Route Lab's scene (ADR 0024), and a lab's is its line. */
export type GroundKind = 'about' | 'lost';

/** One shape: a line in --ground, a heavier line (a wheel's rim, the handlebar), a filled shape in
 *  --ground (the track and the buffer stop), or the one mark in the lamp's color, which
 *  e2e/ground.spec.ts keeps clear of every line of text. */
export interface GroundPath {
  readonly d: string;
  readonly kind: 'line' | 'index' | 'block' | 'mark';
}

export interface Ground {
  readonly kind: GroundKind;
  readonly paths: readonly GroundPath[];
}

/** The drawing's box: anchored to the page's top right corner and never scaled up. */
export const GROUND_BOX = { width: 1200, height: 900 } as const;

/** A coordinate in whole units, so the markup stays small. */
const r = (value: number) => Math.round(value);

/** Two wheels with 36 spokes each and the T of a handlebar: the site's scooter, as geometry. */
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
  wheel(780, 640, 135);
  wheel(1060, 640, 135);
  paths.push({ d: 'M920 640V240M830 240H1010', kind: 'index' });
  return { kind: 'about', paths };
}

/** The end of the line: a track running in from the page's text side, under the words and below
 *  the way home, and stopping near the right edge at a buffer stop, a beam across the track with
 *  the stop's body behind it and its lamp lit on top, the one mark: the page a visitor reached is
 *  where the line ends. Filled shapes, not strokes, so the drawing keeps its weight as the box
 *  scales: the track is 4 units, about 2.6 px on a phone. The lamp sits where it touches no word
 *  from 320 px up (e2e/ground.spec.ts). */
function lost(): Ground {
  const [y, end] = [520, 1060];
  return {
    kind: 'lost',
    paths: [
      {
        d: `M0 ${y - 2}H${end}v4H0zM${end} ${y - 32}h6v64h-6zM${end + 6} ${y - 20}h18v40h-18z`,
        kind: 'block',
      },
      { d: `M${end - 5} ${y - 42}a8 8 0 1 0 16 0a8 8 0 1 0 -16 0`, kind: 'mark' },
    ],
  };
}

/** The drawing for a kind. */
export function groundFor(kind: GroundKind): Ground {
  return kind === 'about' ? about() : lost();
}

/** The drawing a page path carries: the wheels on /about/, the buffer stop on the 404 (which has no
 *  path), and none anywhere else. */
export function groundKindFor(path: string | undefined): GroundKind | null {
  if (path === undefined) return 'lost';
  if (path.startsWith('/about/')) return 'about';
  return null;
}
