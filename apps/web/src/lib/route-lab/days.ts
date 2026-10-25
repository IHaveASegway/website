import type { RouteData } from './data';

// The days a visitor can load with one press: the three the data pipeline made (a quiet Tuesday,
// a busy Saturday, every order at once) and two more drawn from the same places. Each lists its
// orders in the order they came in, which is what the dealt-in-turn plan follows. The two extra
// days are written out, not generated, so a reader can check them against the places in
// tools/route-data/out/README.md; test/route-lab.test.ts holds every index to a real order.

export interface Day {
  readonly id: string;
  readonly name: string;
  readonly vans: number;
  readonly orders: readonly number[];
}

/** The day the page opens on, and draws without JavaScript. */
export const DEFAULT_DAY = 'busy';

/** Every Seattle Public Library branch on the map, and Mercer Island's, in a shuffled order. */
const LIBRARY_DAY: Day = {
  id: 'libraries',
  name: 'Library day',
  vans: 2,
  orders: [52, 16, 19, 55, 44, 17, 28, 53, 20, 7, 46],
};

/** Nine places east of Lake Washington and four on its west shore: dealt in turn, both vans cross
 *  the bridges again and again. */
const LAKE_DAY: Day = {
  id: 'lake',
  name: 'Across the lake',
  vans: 2,
  orders: [55, 58, 62, 54, 60, 56, 37, 42, 61, 59, 29, 57, 36],
};

/** The days in the order the page lists them: by size, the pipeline's own first and last. */
export function days(data: RouteData): Day[] {
  const scenario = (id: string): Day => {
    const s = data.scenarios.find((c) => c.id === id);
    if (!s) throw new Error(`route-data.json has no scenario ${id}`);
    return { id: s.id, name: s.name, vans: s.vans, orders: s.stops };
  };
  return [scenario('quiet'), scenario('busy'), LIBRARY_DAY, LAKE_DAY, scenario('everything')];
}
