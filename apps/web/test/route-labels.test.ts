import { describe, expect, test } from 'vitest';
import { contours } from '../src/lib/route-lab/contours';
import {
  drawnAt,
  inkBox,
  LABEL_SIZES,
  mapLabels,
  marksUnder,
  placeBakeryLabel,
  placeLabels,
  type MapLabel,
} from '../src/lib/route-lab/labels';
import { basemap, isochrones, routeData } from '../src/lib/route-lab/picture';

// Where the Route Lab's names go (lib/route-lab/labels.ts; review RTE-2, 2026-10-31). The maps
// draw the names over the routes and the stops, so a name must keep off the places' marks: each
// moves to the nearest spot clear of every mark at every size the maps draw it. Known answers on
// a small map, then the real one, whose few names that cannot clear a mark are listed by name.

const name = (text: string, x: number, y: number, kind: MapLabel['kind'] = 'area'): MapLabel => ({
  text,
  x,
  y,
  kind,
  anchor: 'middle',
});

/** A square of water from (0,0) to (2000,2000) cut out of nothing: land is outside it. */
const LAKE = 'M0 0L2000 0L2000 2000L0 2000Z';
const FRAME = [4000, 4000] as const;

/** How much of the marks a name covers, by size, where it covers any. */
const covered = (label: MapLabel, places: readonly { x: number; y: number }[]) =>
  LABEL_SIZES.filter((at) => drawnAt(label, at))
    .map((at) => marksUnder(inkBox(label, at), at, places))
    .filter((amount) => amount > 0);

describe('placing a name', () => {
  test('a name with no mark under it stays at its own point', () => {
    const [placed] = placeLabels([name('Medina', 3000, 3000)], [], LAKE, FRAME);
    expect(placed).toMatchObject({ x: 3000, y: 3000 });
  });

  test('a name over a place moves to the nearest spot that clears it at every size', () => {
    const place = { x: 3000, y: 2980 };
    const [placed] = placeLabels([name('Medina', 3000, 3000)], [place], LAKE, FRAME);
    expect(placed).not.toMatchObject({ x: 3000, y: 3000 });
    expect(covered(placed as MapLabel, [place])).toEqual([]);
    expect(Math.hypot((placed?.x ?? 0) - 3000, (placed?.y ?? 0) - 3000)).toBeLessThanOrEqual(130);
  });

  test('a water name stays on the water, and a land name on the land', () => {
    // Each has a place under it near the lake's edge, at x = 2000: the water name may not step out
    // of the lake to clear it, nor the land name in.
    const middle = (label: MapLabel | undefined) => {
      const smallest = LABEL_SIZES.filter((at) => label && drawnAt(label, at)).sort(
        (a, b) => a.font - b.font,
      )[0];
      const box = label && smallest ? inkBox(label, smallest) : { left: 0, right: 0 };
      return (box.left + box.right) / 2;
    };
    const [lake, shore] = placeLabels(
      [name('Lake', 1900, 500, 'water'), name('Shore', 2100, 1500)],
      [
        { x: 1900, y: 490 },
        { x: 2100, y: 1490 },
      ],
      LAKE,
      FRAME,
    );
    expect(lake).not.toMatchObject({ x: 1900, y: 500 });
    expect(shore).not.toMatchObject({ x: 2100, y: 1500 });
    expect(middle(lake)).toBeLessThan(2000);
    expect(middle(shore)).toBeGreaterThan(2000);
  });

  test('a name keeps off the names placed before it, and the result keeps the order given', () => {
    const placed = placeLabels(
      [name('Bellevue', 3000, 3000, 'place'), name('Kirkland', 3000, 3000)],
      [],
      LAKE,
      FRAME,
    );
    expect(placed.map((l) => l.text)).toEqual(['Bellevue', 'Kirkland']);
    // The town, which a phone shows too, chose first and kept its point; the neighbourhood moved.
    expect(placed[1]).toMatchObject({ x: 3000, y: 3000 });
    expect(placed[0]).not.toMatchObject({ x: 3000, y: 3000 });
  });

  test('where no spot within reach is clear, the name covers as little as it can', () => {
    const ring = [-160, -80, 0, 80, 160].flatMap((dx) =>
      [-160, -80, 0, 80, 160].map((dy) => ({ x: 3000 + dx * 2, y: 3000 + dy })),
    );
    const [placed] = placeLabels([name('Medina', 3000, 3000)], ring, LAKE, FRAME);
    expect(placed).toBeDefined();
    expect(covered(placed as MapLabel, ring).length).toBeGreaterThan(0);
  });

  test('the bakery’s name sits beside its mark, on the side where no place is', () => {
    const bakery = { x: 2000, y: 2000 };
    expect(placeBakeryLabel(bakery, [bakery], FRAME).anchor).toBe('end');
    const east = placeBakeryLabel(bakery, [bakery, { x: 1900, y: 1980 }], FRAME);
    expect(east).toMatchObject({ anchor: 'start', x: 2024 });
  });
});

describe('the Route Lab’s own map', () => {
  const { bakeryLabel, labels, fits } = mapLabels(basemap, routeData.points);
  const places = routeData.points;

  test('every name but five clears every place’s mark at every size the maps draw it', () => {
    // The five that cannot, and where: the dense middle of the city and its two small lakes,
    // which a phone's names are wider than; Belltown grazes a corner at the widest size. They are
    // drawn over the stop's edge with their halo (e2e/routes-layout.spec.ts measures how much).
    const crowded = [...labels, bakeryLabel]
      .map((label) => {
        const others = label.kind === 'bakery' ? places.slice(1) : places;
        const sizes = LABEL_SIZES.flatMap((at, k) =>
          drawnAt(label, at) && marksUnder(inkBox(label, at), at, others) > 0.02 ? [k] : [],
        );
        return { text: label.text, sizes };
      })
      .filter(({ sizes }) => sizes.length > 0);
    expect(crowded).toEqual([
      { text: 'Belltown', sizes: [4] },
      { text: 'Lake Washington', sizes: [0] },
      { text: 'Lake Union', sizes: [0] },
      { text: 'Green Lake', sizes: [0, 1, 2, 3, 4] },
      { text: 'The bakery', sizes: [0, 1, 3] },
    ]);
  });

  test('no name touches another at a size that draws both', () => {
    const all = [...labels, bakeryLabel];
    for (const at of LABEL_SIZES)
      for (const [k, a] of all.entries())
        for (const b of all.slice(k + 1)) {
          if (!drawnAt(a, at) || !drawnAt(b, at)) continue;
          const [p, q] = [inkBox(a, at), inkBox(b, at)];
          const apart =
            p.right <= q.left || q.right <= p.left || p.bottom <= q.top || q.bottom <= p.top;
          expect(apart, `${a.text} and ${b.text} at ${at.font}`).toBe(true);
        }
  });

  test('the 10 and 20 minute labels clear every mark and every name at every size', () => {
    const lines = contours(isochrones, basemap, [...labels, bakeryLabel], [10, 20], places, fits);
    for (const line of lines) {
      expect(line.labels.length, `${line.minutes}`).toBeGreaterThan(0);
      for (const at of line.labels) expect(fits(at.x, at.y), `${line.minutes} min`).toBe(true);
    }
  });
});
