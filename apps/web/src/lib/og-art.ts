import { labGlyph } from './iso/lab-glyphs';
import type { Glyph, Mark, Paint } from './iso/glyph';
import type { OgArt } from './og';
import { cardSvg, edge, field, fill, n, OG_SIZE, stroke, svgPng } from './og-field';
import {
  ORBIT_BOX,
  ORBIT_CENTRE,
  ORBIT_RADIUS,
  openingServers,
  orbitPlaces,
  type OrbitPoint,
  type OrbitServer,
} from './orbit';

// What Home's link preview and the Lab index's stand on, so each looks like the page it opens
// (ADR 0029): the field that every page stands on (styles/field.css), with Home's cluster in the one
// accent, or the Lab index's own pictures, each lab's glyph in its lab's colour. Each is a PNG with
// no word in it, so a card's only text is still its two strings (lib/og.ts). The colours are the
// night theme's tokens, as the card's are. Build-time only.

/** The name's column on Home's card: two lines, as the hero sets it, left of the cluster. */
const HOME_TITLE_COLUMN = 640;

/** Where the cluster stands on Home's card, and how large: the ring's centre, and px per pixel of
 *  its drawing. */
const ORBIT_AT = { x: 890, y: 276, scale: 1.5 } as const;

/** The page lays the ring back by rotateX(58deg) under a perspective of 70rem, and sizes the ring's
 *  square at up to 36rem (styles/home.css): that perspective, as a share of the square. */
const TILT = (58 * Math.PI) / 180;
const DEPTH = 70 / 36;

/** A point of the drawing as the card shows it: laid back, the near side larger. */
function laidBack([x, y]: OrbitPoint): OrbitPoint {
  const across = (x - ORBIT_CENTRE) * ORBIT_AT.scale;
  const down = (y - ORBIT_CENTRE) * ORBIT_AT.scale;
  const eye = DEPTH * ORBIT_BOX * ORBIT_AT.scale;
  const near = eye / (eye - down * Math.sin(TILT));
  return [ORBIT_AT.x + across * near, ORBIT_AT.y + down * Math.cos(TILT) * near];
}

/** A circle of the drawing, laid back: no longer a circle, so a path through points on it. */
function disc(centre: OrbitPoint, r: number, paint: string): string {
  const points = Array.from({ length: 96 }, (_, i) => {
    const a = (i / 96) * 2 * Math.PI;
    return laidBack([centre[0] + r * Math.cos(a), centre[1] + r * Math.sin(a)]);
  });
  return `<path d="M${points.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z" ${paint}/>`;
}

const segment = (from: OrbitPoint, to: OrbitPoint, paint: string) => {
  const [a, b] = [laidBack(from), laidBack(to)];
  return `<path d="M${n(a[0])} ${n(a[1])}L${n(b[0])} ${n(b[1])}" ${paint}/>`;
};

/** The box the cluster's servers and logs take on Home's card, in px: words stay out of it. */
export function clusterBox(servers: readonly OrbitServer[]): {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
} {
  const points = orbitPlaces(servers).flatMap((p) => [p.xy, ...p.beads].map(laidBack));
  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
}

/** Home's card: the field, and the cluster as Home's opening draws it, in its one accent. */
async function homePicture(servers: readonly OrbitServer[]): Promise<Buffer> {
  const places = orbitPlaces(servers);
  const lead = places.find((p) => p.server.leader);
  const middle: OrbitPoint = [ORBIT_CENTRE, ORBIT_CENTRE];
  const [x, y] = laidBack(middle);
  const { defs, shapes } = field(x, y, 620);
  const blur = `<filter id="glow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="14"/></filter><filter id="beat" x="-100%" y="-100%" width="300%" height="300%"><feGaussianBlur stdDeviation="4"/></filter>`;
  shapes.push(
    disc(middle, ORBIT_RADIUS + 6, fill('primary', 0.05)),
    disc(middle, ORBIT_RADIUS, stroke('input', 1.5)),
    disc(middle, ORBIT_RADIUS - 52, `${stroke('border', 1.25)} stroke-dasharray="2 9"`),
  );
  if (lead)
    for (const p of places.filter((place) => !place.server.leader)) {
      shapes.push(segment(lead.xy, p.xy, stroke('border', 2)));
      // A heartbeat on its way out along each wire, as the page runs them.
      const at = (share: number): OrbitPoint => [
        lead.xy[0] + (p.xy[0] - lead.xy[0]) * share,
        lead.xy[1] + (p.xy[1] - lead.xy[1]) * share,
      ];
      const beat = (blurred: boolean) =>
        segment(
          at(0.46),
          at(0.58),
          `${stroke('primary', blurred ? 8 : 4)} stroke-linecap="round"${blurred ? ' filter="url(#beat)"' : ''}`,
        );
      shapes.push(beat(true), beat(false));
    }
  for (const p of places) {
    const leader = p.server.leader;
    for (const bead of p.beads) shapes.push(disc(bead, 3, fill(leader ? 'primary' : 'foreground')));
    if (leader) {
      shapes.push(
        disc(p.xy, 44, `${fill('primary', 0.5)} filter="url(#glow)"`),
        disc(p.xy, 24, stroke('primary', 1.5, 0.35)),
      );
    }
    shapes.push(
      disc(
        p.xy,
        leader ? 18 : 15,
        leader ? fill('primary') : `${fill('surface-1')} ${edge('foreground', 2.5)}`,
      ),
    );
  }
  return svgPng(cardSvg(shapes, defs + blur));
}

/** A mark of a lab's glyph as styles/iso-glyph.css paints it, in the night theme. */
function glyphMark(mark: Mark, slug: string, scale: number): string {
  const line = `line-${slug}`;
  const ink = (width: number) => edge('foreground', width);
  const dashed = `stroke-dasharray="${n(3 * scale)} ${n(3 * scale)}"`;
  const paints: Record<Paint, string> = {
    plane: stroke('input', 1),
    mesh: stroke('iso-grid', 1),
    top: `${fill('iso-top')} ${ink(1.25)}`,
    left: `${fill('iso-left')} ${ink(1.25)}`,
    right: `${fill('iso-right')} ${ink(1.25)}`,
    lit: `${fill(line)} ${ink(1.25)}`,
    off: `${stroke('input', 1.25)} ${dashed}`,
    ghost: `${stroke(line, 1.25)} ${dashed}`,
    band: `fill="none" ${ink(1)}`,
    wire: stroke(line, 2.25),
    cut: `${stroke('input', 1.25)} ${dashed}`,
    node: fill(line),
  };
  return `<path d="${mark.d}" ${paints[mark.paint]} stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>`;
}

function glyphAt(glyph: Glyph, slug: string, x: number, y: number, scale: number): string {
  const marks = [...glyph.ground, ...glyph.wires, ...glyph.solids.flatMap((s) => s.marks)];
  return `<g transform="translate(${n(x - glyph.box[0] * scale)} ${n(y - glyph.box[1] * scale)}) scale(${scale})">${marks.map((mark) => glyphMark(mark, slug, scale)).join('')}</g>`;
}

/** The Lab index's picture, across the card's top: as tall as a one-line title leaves it. */
export const OG_GLYPHS = { width: OG_SIZE.width, height: 362 } as const;

/** The Lab index's card: the glyph of each lab the page lists, each in its own lab's colour,
 *  their tiles interlocked in two rows, so they stand on one floor. */
async function labIndexPicture(slugs: readonly string[]): Promise<Buffer | undefined> {
  const glyphs = (
    await Promise.all(slugs.map(async (slug) => [slug, await labGlyph(slug)] as const))
  ).filter((pair): pair is readonly [string, Glyph] => pair[1] !== undefined);
  if (glyphs.length === 0) return undefined;
  const scale = 1.2;
  const shapes = glyphs.map(([slug, glyph], i) => {
    const across = 72 + i * 183;
    const down = i % 2 === 0 ? 8 : 132;
    return glyphAt(glyph, slug, across, down, scale);
  });
  return svgPng(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${OG_GLYPHS.width}" height="${OG_GLYPHS.height}">${shapes.join('')}</svg>`,
  );
}

/** What Home's card carries beside its strings: its cluster on the field, where this build holds
 *  the Raft Lab; the field alone in a build with no lab. */
export async function homeArt(slugs: readonly string[]): Promise<OgArt> {
  return slugs.includes('raft')
    ? { behind: await homePicture(openingServers()), titleColumn: HOME_TITLE_COLUMN }
    : {};
}

/** What the Lab index's card carries beside its strings. */
export async function labIndexArt(slugs: readonly string[]): Promise<OgArt> {
  return { picture: await labIndexPicture(slugs) };
}
