import { inside, overlaps, rings, type Box } from './contours';
import type { Basemap } from './data';

// Where the Route Lab's map names go: the bakery's, then each neighbourhood, town and body of
// water, moved from the point the pipeline gave it to the nearest spot where no place's mark lies
// under it, at every size the maps draw it; the 10 and 20 minute labels use the same test
// (contours.ts). The maps draw the names over the routes and the stops (RouteLab.astro), as the
// site's rule has words over pictures; this is what keeps a name off a stop, so neither hides the
// other. Until 2026-10-31 the names lay under the routes and stops, and a stop or a route hid
// parts of "Lake Union", "Green Lake" and "Elliott Bay" (review RTE-2).
//
// The places are fixed (route-data.json): every order a visitor can add is at one of them, so a
// spot clear of every place stays clear whatever the plan, and the build places the names once,
// with no script. Build-time only: nothing here reaches the browser.

/** A name as the page draws it: `x` and `y` are its anchor and baseline, in the map's units. */
export interface MapLabel {
  readonly text: string;
  readonly x: number;
  readonly y: number;
  readonly kind: 'place' | 'area' | 'water' | 'contour' | 'bakery';
  readonly anchor: 'start' | 'middle' | 'end';
  /** A small bay, which a phone's map leaves out (route-lab.css, .rl-label-minor). */
  readonly minor?: boolean;
}

/** One step of the names' size (route-lab.css, ".rl-label" and its media queries), in the map's
 *  units: the face's size, the halo's width, which names it shows, and the half side of the
 *  largest mark a place carries there, a numbered stop's casing, 21 px across on screen, at the
 *  map's width at the start of the step. A map unit is 2,000 over the map's width in pixels. */
export interface LabelSize {
  readonly font: number;
  /** A neighbourhood's name, where it is smaller than the others. */
  readonly placeFont?: number;
  readonly halo: number;
  readonly mark: number;
  readonly places: boolean;
  readonly minor: boolean;
  readonly contours: boolean;
}

export const LABEL_SIZES: readonly LabelSize[] = [
  // A phone: a 390 px screen's map is 318 px wide. At 320 px a stop is a quarter larger against
  // the map, and a name can touch one; it is drawn over it, with its halo.
  { font: 68, halo: 18, mark: 66, places: false, minor: false, contours: false },
  // From 30rem: 408 px.
  { font: 44, halo: 8, mark: 52, places: false, minor: false, contours: true },
  // From 48rem: 580 px, and the neighbourhoods show.
  { font: 32, halo: 7, mark: 36, places: true, minor: true, contours: true },
  // From 64rem: two maps side by side, 404 px each.
  { font: 46, halo: 9, mark: 52, places: false, minor: true, contours: true },
  // From 94rem: 532 px; a neighbourhood's name is a step smaller.
  { font: 36, placeFont: 32, halo: 8, mark: 40, places: true, minor: true, contours: true },
];

/** The ink of a name at a size, its halo included: Barlow Semi Condensed averages 0.47 of its size
 *  a character, rises 0.78 of it over the baseline and drops 0.22 under (measured in Chromium on
 *  the map's own names, 2026-10-31). */
export function inkBox(label: MapLabel, at: LabelSize): Box {
  const font = label.kind === 'place' ? (at.placeFont ?? at.font) : at.font;
  const width = label.text.length * 0.47 * font;
  const left =
    label.anchor === 'start'
      ? label.x
      : label.anchor === 'end'
        ? label.x - width
        : label.x - width / 2;
  const pad = at.halo / 2;
  return {
    left: left - pad,
    right: left + width + pad,
    top: label.y - 0.78 * font - pad,
    bottom: label.y + 0.22 * font + pad,
  };
}

/** Whether a size draws a name: a phone leaves out the neighbourhoods, the small bays and the
 *  minutes, and two maps side by side below 94rem the neighbourhoods. */
export const drawnAt = (label: MapLabel, at: LabelSize): boolean =>
  (label.kind !== 'place' || at.places) &&
  (label.kind !== 'contour' || at.contours) &&
  (!label.minor || at.minor);

/** How much of the places' marks a box covers at one size, in marks: a mark it covers whole
 *  counts 1, one it grazes a little. So where no spot is clear, the one chosen covers least. */
export function marksUnder(box: Box, at: LabelSize, places: readonly { x: number; y: number }[]) {
  const side = 2 * at.mark;
  return places.reduce((sum, p) => {
    const w = Math.min(box.right, p.x + at.mark) - Math.max(box.left, p.x - at.mark);
    const h = Math.min(box.bottom, p.y + at.mark) - Math.max(box.top, p.y - at.mark);
    return w > 0 && h > 0 ? sum + (w * h) / (side * side) : sum;
  }, 0);
}

/** How far a name may move from its own point, in the map's units: up to 120, about two lines of
 *  a phone's names, so it still names what it named. The nearest spot wins; a step up or down
 *  counts half as much again as one sideways, since names sit side by side in a row. */
const MOVES = [0, -40, 40, -80, 80, -120, 120]
  .flatMap((dy) => [0, -60, 60, -120, 120].map((dx) => [dx, dy] as const))
  .sort(([ax, ay], [bx, by]) => Math.hypot(ax, ay * 1.5) - Math.hypot(bx, by * 1.5));

/** What a spot costs a name: how much of the marks it covers, a hundred if it leaves the frame,
 *  and ten for each name already placed that it touches, summed over the sizes that draw both.
 *  Nought is a clear spot. */
function cost(
  label: MapLabel,
  places: readonly { x: number; y: number }[],
  frame: readonly [number, number],
  placed: readonly MapLabel[],
): number {
  const [width, height] = frame;
  let sum = 0;
  for (const at of LABEL_SIZES.filter((size) => drawnAt(label, size))) {
    const box = inkBox(label, at);
    if (box.left < 0 || box.right > width || box.top < 0 || box.bottom > height) sum += 100;
    sum += marksUnder(box, at, places);
    sum += 10 * placed.filter((o) => drawnAt(o, at) && overlaps(box, inkBox(o, at))).length;
  }
  return sum;
}

/** The cheapest of some spots, the first among equals. */
function cheapest(spots: readonly MapLabel[], price: (label: MapLabel) => number): MapLabel {
  let best: { label: MapLabel; cost: number } | null = null;
  for (const label of spots) {
    const c = price(label);
    if (!best || c < best.cost) best = { label, cost: c };
    if (c === 0) break;
  }
  return (best ?? { label: spots[0] as MapLabel }).label;
}

/** Where "The bakery" goes: beside its mark, left as before, else right, else a line up or down,
 *  wherever the fewest marks are under it. International Fountain, a stop on the default day, is
 *  under its left side, and Volunteer Park and the Seattle Center to the east and south. */
export function placeBakeryLabel(
  bakery: { readonly x: number; readonly y: number },
  places: readonly { x: number; y: number }[],
  frame: readonly [number, number],
): MapLabel {
  const others = places.filter((p) => p.x !== bakery.x || p.y !== bakery.y);
  const at = (dx: number, dy: number, anchor: MapLabel['anchor']): MapLabel => ({
    text: 'The bakery',
    x: bakery.x + dx,
    y: bakery.y + dy,
    kind: 'bakery',
    anchor,
  });
  const spots = [11, -40, 62].flatMap((dy) => [at(-24, dy, 'end'), at(24, dy, 'start')]);
  return cheapest(spots, (label) => cost(label, others, frame, []));
}

/**
 * Each name at the nearest spot where, at every size that draws it, no place's mark is under it,
 * it lies inside the frame, it touches no name placed before it, those in `before` (the bakery's)
 * included, and a water name stays on the water and a land name on the land. Where no spot within
 * reach is clear, the name goes where it covers least of any mark, nearest first, and is drawn
 * over it with its halo. The names drawn at the most sizes choose first, the water and the towns,
 * which a phone shows too, before the neighbourhoods, which only two sizes show; the order of the
 * result is the order of `labels`.
 */
export function placeLabels(
  labels: readonly MapLabel[],
  places: readonly { x: number; y: number }[],
  water: string,
  frame: readonly [number, number],
  before: readonly MapLabel[] = [],
): MapLabel[] {
  const wet = rings(water);
  const placed: MapLabel[] = [...before];
  const sizes = (label: MapLabel) => LABEL_SIZES.filter((at) => drawnAt(label, at)).length;
  const order = [...labels].sort((a, b) => sizes(b) - sizes(a));
  for (const label of order) {
    const spots = MOVES.filter(([dx]) => label.anchor === 'middle' || dx === 0)
      .map(([dx, dy]) => ({ ...label, x: label.x + dx, y: label.y + dy }))
      .filter((spot) => {
        // Its middle at the smallest size that draws it, on the water for a water name, else on
        // land: at a phone's size "Green Lake" is wider than the lake.
        const smallest = LABEL_SIZES.filter((at) => drawnAt(label, at)).sort(
          (a, b) => a.font - b.font,
        )[0];
        const box = inkBox(spot, smallest ?? (LABEL_SIZES[0] as LabelSize));
        const wetHere = inside(wet, (box.left + box.right) / 2, (box.top + box.bottom) / 2);
        return wetHere === (label.kind === 'water');
      });
    placed.push(
      spots.length ? cheapest(spots, (spot) => cost(spot, places, frame, placed)) : label,
    );
  }
  const at = new Map(placed.slice(before.length).map((label, k) => [order[k], label]));
  return labels.map((label) => at.get(label) ?? label);
}

/** Names the maps leave out: South Lake Union sits under the bakery, which has its own name, and
 *  Interbay and Wallingford overlap Queen Anne and the University District. */
const UNDRAWN = new Set(['South Lake Union', 'Interbay', 'Wallingford']);
/** The small bays, which a phone's map leaves out with the neighbourhoods, as they would overlap
 *  Lake Union there. */
const MINOR = new Set(['Union Bay', 'Portage Bay']);
/** A name whose point lies nearer the left edge than this starts at the edge instead of centring,
 *  so it is never cut off. */
const EDGE = 240;

/**
 * The Route Lab's names, placed: the bakery's beside its mark, then the basemap's, each moved as
 * little as it takes, and a test for the 10 and 20 minute labels' spots (contours.ts) that holds
 * them to the same sizes and keeps them off every name. A name that would still cover the
 * bakery's is left out: the bakery's wins.
 */
export function mapLabels(
  base: Pick<Basemap, 'viewBox' | 'labels' | 'water'>,
  places: readonly { x: number; y: number }[],
): { bakeryLabel: MapLabel; labels: MapLabel[]; fits: (x: number, y: number) => boolean } {
  const [, , width, height] = base.viewBox;
  const frame = [width, height] as const;
  const bakery = places[0] ?? { x: 0, y: 0 };
  const bakeryLabel = placeBakeryLabel(bakery, places, frame);
  const labels = placeLabels(
    base.labels
      .filter((l) => !UNDRAWN.has(l.text))
      .map((l) => ({
        ...l,
        x: l.x < EDGE ? 24 : l.x,
        anchor: l.x < EDGE ? ('start' as const) : ('middle' as const),
        minor: MINOR.has(l.text),
      })),
    places,
    base.water,
    frame,
    [bakeryLabel],
  ).filter(
    (l) =>
      !LABEL_SIZES.some((at) => drawnAt(l, at) && overlaps(inkBox(l, at), inkBox(bakeryLabel, at))),
  );
  const named = [...labels, bakeryLabel];
  const fits = (x: number, y: number) =>
    cost({ text: '20 min', x, y, kind: 'contour', anchor: 'middle' }, places, frame, named) === 0;
  return { bakeryLabel, labels, fits };
}
