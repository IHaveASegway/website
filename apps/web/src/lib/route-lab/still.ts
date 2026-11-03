import type { RouteData } from './data';
import { formatDuration } from './format';
import { BAKERY } from './plan';
import { backLine, casedRoute, PLAN_NAMES, PREVIOUS, shape, vanClass, type Which } from './render';
import {
  DEFAULT_VIEW,
  hourLabels,
  hourMarks,
  project,
  screenLine,
  screenPath,
  type Box,
} from './space-time';
import type { Track } from './timeline';

// The space-time cube's still picture and its words, as lib/route-lab/render.ts holds the maps':
// one owner for both places they are drawn. The build writes them for the day the page opens on, and
// the browser writes the same strings for the plan on show (components/route-lab/still.ts). No DOM
// and no three.js here. A plan moves only what this module draws: the time axis stands as tall
// whatever it spans (space-time.ts, boxFor), so the floor, the box's edges and the picture's own
// size stay as the build drew them, and nothing below the picture moves.

/** The line over a cube, as under a map: when its plan's last van is back, nothing when no van
 *  leaves, and in its place, once the orders have changed, that the plan is for the previous ones. */
export const cubeLine = (back: number, stale = false): string =>
  stale ? PREVIOUS : backLine({ back });

/** A cube's name for assistive technology, on its picture and on its canvas: what it shows. */
export const cubeName = (which: Which, back: number, stale = false): string => {
  const shown = `${PLAN_NAMES[which]}${stale ? `, ${PREVIOUS.toLowerCase()}` : ''}, in time: the map lies flat`;
  return back > 0
    ? `${shown}, time rises from it, and each van’s line climbs as its day goes on. The last van is back after ${formatDuration(back)}.`
    : `${shown} and time rises from it. No van leaves.`;
};

/** What a plan draws in its cube's picture: the hours on the bakery's pillar, each van's line
 *  through the day, and its stops. */
export function stillMarkup(data: RouteData, drawn: readonly Track[], box: Box): string {
  const at = (x: number, t: number, y: number) => {
    const [u, v] = project(DEFAULT_VIEW, box, [x, t * box.scale, y]);
    return [Math.round(u), Math.round(-v)] as const;
  };
  const bakery = data.points[BAKERY] ?? { x: 0, y: 0 };
  const labelled = hourLabels(box);
  const hours = hourMarks(box).map((seconds) => {
    const [u, v] = at(bakery.x, seconds, bakery.y);
    const word = `<text class="rl-cube-hour" x="${u - 36}" y="${v}">${seconds / 3600} h</text>`;
    return `<path class="rl-cube-tick" d="M${u} ${v}l-24 0"/>${labelled.includes(seconds) ? word : ''}`;
  });
  const lines = drawn.map((track) => {
    const d = screenPath(screenLine(DEFAULT_VIEW, box, track, 3));
    const casing = casedRoute(track.van) ? `<path class="rl-route-casing" d="${d}"/>` : '';
    return `${casing}<path class="rl-route van-${vanClass(track.van)}" d="${d}"/>`;
  });
  const stops = drawn.flatMap(({ van, stops: each }) =>
    each.map((stop) => {
      const [u, v] = at(stop.x, stop.arrives, stop.y);
      return `<path class="rl-stop van-${vanClass(van)}${shape(van)}" d="M${u} ${v}h.01"/>`;
    }),
  );
  return [...hours, ...lines, ...stops].join('');
}
