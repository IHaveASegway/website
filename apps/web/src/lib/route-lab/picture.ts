import basemapJson from '../../../../../tools/route-data/out/basemap.json';
import isochronesJson from '../../../../../tools/route-data/out/isochrones.json';
import routeDataJson from '../../../../../tools/route-data/out/route-data.json';
import type { Basemap, Isochrones, RouteData } from './data';
import { DEFAULT_DAY, days, type Day } from './days';
import { decodeLegs } from './legs';
import { loadSolver } from './node-solver';
import {
  capacityFor,
  dealtInTurn,
  explorationFor,
  fromVroom,
  measure,
  vroomInput,
  type Measured,
  type Plan,
} from './plan';

// The Route Lab as the page draws it before anyone presses anything, worked out at build: the
// default day dealt in turn, and the same day planned by VROOM, run in Node from the files the site
// serves. The page without JavaScript is this picture, and so are the lead's figures: none is typed.
// The data is tools/route-data's output, imported where the pipeline writes it, so it has one copy.

export const routeData = routeDataJson as unknown as RouteData;
export const basemap = basemapJson as unknown as Basemap;
export const isochrones = isochronesJson as unknown as Isochrones;

export interface Picture {
  readonly day: Day;
  readonly capacity: number;
  readonly before: { readonly plan: Plan; readonly measured: Measured };
  readonly after: { readonly plan: Plan; readonly measured: Measured };
}

let picture: Promise<Picture> | undefined;

async function draw(app: string): Promise<Picture> {
  const day = days(routeData).find((d) => d.id === DEFAULT_DAY);
  if (!day) throw new Error(`route-lab: no day ${DEFAULT_DAY}`);
  const capacity = capacityFor(routeData, day.orders, day.vans);
  const before = dealtInTurn(routeData, day.orders, day.vans, capacity);
  const solver = await loadSolver(app);
  const output = solver.solve(vroomInput(routeData, day.orders, day.vans, capacity), {
    explorationLevel: explorationFor(day.orders.length),
  });
  const after = fromVroom(output, day.vans);
  if (after.unassigned.length > 0)
    throw new Error('route-lab: VROOM left an order of the default day');
  return {
    day,
    capacity,
    before: { plan: before, measured: measure(routeData, before) },
    after: { plan: after, measured: measure(routeData, after) },
  };
}

/** The default day's two plans, solved once per build. `app` is apps/web (lib/route-lab/node-solver.ts). */
export function routeLabPicture(app: string): Promise<Picture> {
  picture ??= draw(app);
  return picture;
}

/** Leg geometry for the build's drawing, decoded once. */
export const leg = decodeLegs(routeData.legs);
