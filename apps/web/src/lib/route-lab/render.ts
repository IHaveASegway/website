import type { Point, RouteData } from './data';
import type { Line } from './legs';
import { pathData, routeLine } from './legs';
import {
  BAKERY,
  SHARE,
  shareCapacity,
  boxesOf,
  formatDuration,
  formatMiles,
  fromBakery,
  percentLess,
  vanName,
  type Measured,
  type Plan,
} from './plan';

// The markup and the words of the parts of the Route Lab that change with a plan: the routes and
// stops on each map, each plan's table, the readout and the tip over a place. One owner for both
// places they are drawn: the build writes them into the page for the picture without JavaScript,
// and the browser writes the same strings after a visitor changes the orders. Every value comes
// from route-data.json and the plan; text is escaped anyway. No style attribute: the page policy
// refuses them (security.md), so color comes from classes that read tokens.css.

/** A van's class suffix: a, b, c, d, read by tokens.css's --map-van-a to --map-van-d. */
export const vanClass = (van: number): string => vanName(van).toLowerCase();

/** Vans B and C mark their stops with circles, A and D with squares, so the pairs that share a
 *  shape are the ones whose colors stay apart under every color-vision deficiency
 *  (test/tokens.test.ts). Routes also differ by dash pattern. */
export const isRound = (van: number): boolean => van === 1 || van === 2;
const shape = (van: number) => (isRound(van) ? ' rl-round' : '');

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
};
export const esc = (text: string): string => text.replace(/[&<>"]/g, (c) => ESCAPES[c] ?? c);

/** A plan numbers its stops on the map up to this many in all; past it the numbers would cover
 *  each other, and the tables still count every stop. */
export const NUMBERED = 30;

/** A mark at each point: a zero-length subpath that a line cap draws at any map scale. */
const dots = (points: readonly Pick<Point, 'x' | 'y'>[]): string =>
  points.map((p) => `M${p.x} ${p.y}h0`).join('');

/** Each van's route on the roads, from the bakery and back. A van with no stops draws nothing. */
export function routesMarkup(leg: (i: number, j: number) => Line, plan: Plan): string {
  return plan.routes
    .map((route, van) =>
      route.length === 0
        ? ''
        : `<path class="rl-route van-${vanClass(van)}" d="${pathData(routeLine(leg, [BAKERY, ...route, BAKERY]))}"/>`,
    )
    .join('');
}

/** The places on a map: every place with no order as a small square; each van's stops in its
 *  color and shape over a casing, numbered in the order the van drives them while the plan has
 *  few enough; an order no van could take as a hollow mark; and the bakery. */
export function placesMarkup(data: RouteData, plan: Plan): string {
  const at = (i: number) => data.points[i] ?? { x: 0, y: 0 };
  const ordered = new Set([...plan.routes.flat(), ...plan.unassigned]);
  const idle = data.points.filter((p) => p.i !== BAKERY && !ordered.has(p.i));
  const numbered = plan.routes.flat().length <= NUMBERED;
  const big = numbered ? ' rl-big' : '';
  const each = (draw: (route: readonly number[], van: number) => string) =>
    plan.routes.map((route, van) => (route.length ? draw(route, van) : ''));
  return [
    `<path class="rl-place" d="${dots(idle)}"/>`,
    ...each(
      (route, van) =>
        `<path class="rl-stop-casing${big}${shape(van)}" d="${dots(route.map(at))}"/>`,
    ),
    ...each(
      (route, van) =>
        `<path class="rl-stop van-${vanClass(van)}${big}${shape(van)}" d="${dots(route.map(at))}"/>`,
    ),
    ...(numbered
      ? each((route) =>
          route
            .map(
              (place, k) =>
                `<text class="rl-num" x="${at(place).x}" y="${at(place).y}">${k + 1}</text>`,
            )
            .join(''),
        )
      : []),
    plan.unassigned.length ? `<path data-rl-left d="${dots(plan.unassigned.map(at))}"/>` : '',
    `<path class="rl-bakery" d="${dots([at(BAKERY)])}"/>`,
  ].join('');
}

/** "Van A: 7 stops, 14 boxes, 1 h 52 min of driving, 42.1 mi", or that it stays home. */
export function vanLine(day: Measured['vans'][number], van: number): string {
  const stops = day.stops.length;
  if (stops === 0) return `Van ${vanName(van)} stays at the bakery.`;
  return `Van ${vanName(van)}: ${stops} ${stops === 1 ? 'stop' : 'stops'}, ${day.boxes} ${day.boxes === 1 ? 'box' : 'boxes'}, ${formatDuration(day.drive)} of driving, ${formatMiles(day.metres)}`;
}

/** How far a place is from the bakery, by the fastest road: "19 min from the bakery". */
export const away = (data: RouteData, place: number): string =>
  `${formatDuration(fromBakery(data, place))} from the bakery`;

/** A plan stop by stop: one row group per van, then a row per stop, in the order it drives them:
 *  the stop's name (A1, A2, as the map numbers them), the place, its order and how far it is from
 *  the bakery in one cell, so the table fits a 320 px screen, and when the van arrives, counted
 *  from leaving the bakery. Never a time of day. */
export function tableMarkup(data: RouteData, measured: Measured, caption: string): string {
  const body = measured.vans
    .map(
      (day, van) =>
        `<tbody><tr><th scope="rowgroup" colspan="4"><span class="rl-key van-${vanClass(van)}${shape(van)}" aria-hidden="true"></span>${esc(vanLine(day, van))}</th></tr>${day.stops
          .map(({ place, arrives }, k) => {
            const p = data.points[place];
            return `<tr><th scope="row">${vanName(van)}${k + 1}</th><td><span class="rl-cell-place">${esc(p?.label ?? '')}</span> ${esc(p?.order ?? '')}, ${away(data, place)}</td><td>${p?.qty ?? 0}</td><td>${formatDuration(arrives)}</td></tr>`;
          })
          .join('')}</tbody>`,
    )
    .join('');
  return `<table class="rl-table"><caption>${esc(caption)}</caption><thead><tr><th scope="col">Stop</th><th scope="col">Place and order</th><th scope="col">Boxes</th><th scope="col">Arrives after</th></tr></thead>${body}</table>`;
}

/** The vans a plan sends out: those with at least one stop. */
export const vansUsed = (plan: Plan): number => plan.routes.filter((r) => r.length > 0).length;

/** A plan's small print under its time: "148.8 mi, 3 vans", or that nothing leaves. */
export function planLine(plan: Plan, measured: Measured): string {
  const vans = vansUsed(plan);
  if (vans === 0) return 'No stops';
  return `${formatMiles(measured.metres)}, ${vans} ${vans === 1 ? 'van' : 'vans'}`;
}

/** When the plan's day is done: "Last van back after 2 h 53 min", handing over every order
 *  included; nothing when no van leaves. */
export const backLine = (measured: Measured): string =>
  measured.back > 0 ? `Last van back after ${formatDuration(measured.back)}` : '';

/** When the last van is back in each plan, in a sentence: what a second or third van buys,
 *  which total driving alone does not show. */
export const backText = (before: Measured, after: Measured): string =>
  `The last van is back after ${formatDuration(before.back)} as the orders came in, and after ${formatDuration(after.back)} with VROOM.`;

/** What a map shows, for assistive technology: the map is one image with this name. `bands` is
 *  the sentence about the isochrones, which the build writes from isochrones.json. A VROOM plan
 *  for orders that have changed since says so. */
export function mapTitle(
  which: 'before' | 'after',
  orders: number,
  vans: number,
  bands: string,
  stale = false,
): string {
  const what = `${orders} ${orders === 1 ? 'order' : 'orders'}`;
  const fleet = `${vans} ${vans === 1 ? 'van' : 'vans'}`;
  const plan =
    which === 'before'
      ? `Map of the bakery and ${what}, with the routes of ${fleet} dealt the orders as they came in.`
      : `Map of the bakery and ${stale ? 'the previous' : 'the same'} ${what}, with the routes VROOM planned for ${fleet}.`;
  return `${plan} ${bands}`;
}

/** The isochrones in a sentence, for the maps' names: "Shaded bands show driving time from the
 *  bakery, 5 to 30 minutes, with a line at 10 and 20." */
export function bandsSentence(minutes: readonly number[], lines: readonly number[]): string {
  const range = `${minutes[0] ?? 0} to ${minutes[minutes.length - 1] ?? 0} minutes`;
  const at = lines.length ? `, with a line at ${lines.join(' and ')}` : '';
  return `Shaded bands show driving time from the bakery, ${range}${at}.`;
}

/** The headline under the controls: what VROOM saves against the order the orders came in. One
 *  order is one route in both plans, so there is no order to beat. */
export function savedText(before: Measured, after: Measured): string {
  if (before.vans.reduce((stops, van) => stops + van.stops.length, 0) === 1)
    return 'With one order, both plans are the same route.';
  // The difference of the totals as the page shows them, so the headline and the two big figures
  // agree: whole minutes and tenths of a mile, each rounded before subtracting.
  const time = (Math.round(before.drive / 60) - Math.round(after.drive / 60)) * 60;
  if (time < 60) return 'These orders came in an order VROOM could not beat.';
  const tenths = (metres: number) => Math.round(metres / 160.9344);
  const metres = Math.max(0, tenths(before.metres) - tenths(after.metres)) * 160.9344;
  return `VROOM saves ${formatDuration(time)} of driving and ${formatMiles(metres)}, ${percentLess(before.drive, after.drive)}% less.`;
}

/** Why the vans hold what they hold: a share of the day's boxes, so changing the vans changes it.
 *  Nothing when there is no order, and no share when there is one: one van takes it. */
export function roomText(
  data: RouteData,
  orders: readonly number[],
  vans: number,
  capacity: number,
): string {
  const boxes = boxesOf(data, orders);
  if (orders.length === 0) return '';
  const all = `${boxes} ${boxes === 1 ? 'box' : 'boxes'}`;
  if (orders.length === 1) return `One order: one van takes its ${all}.`;
  if (vans === 1) return `One van takes all ${all}.`;
  const share = shareCapacity(data, orders, vans);
  const why =
    capacity > share
      ? 'room for every order, dealt in turn'
      : capacity > Math.ceil((boxes / vans) * SHARE)
        ? 'the largest order'
        : `${SHARE} times its share`;
  return `Each van takes at most ${capacity} of the ${all}: ${why}.`;
}

/** The tip over a place on a map, line by line: its name, its order, and where it falls in this
 *  map's plan, with how far it is from the bakery. */
export function tipLines(data: RouteData, plan: Plan, place: number): string[] {
  const p = data.points[place];
  if (!p) return [];
  const far = away(data, place);
  const van = plan.routes.findIndex((route) => route.includes(place));
  const what = `${p.order ?? ''}, ${p.qty ?? 0} ${p.qty === 1 ? 'box' : 'boxes'}`;
  if (van >= 0) {
    const stop = (plan.routes[van]?.indexOf(place) ?? 0) + 1;
    return [p.label, what, `Van ${vanName(van)}, stop ${stop}, ${far}`];
  }
  if (plan.unassigned.includes(place)) return [p.label, what, `No van has room, ${far}`];
  return [p.label, `No order today, ${far}`];
}
