import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { formatRouteData } from '../../../tools/route-data/pipeline/lib/format.mjs';
import { decodeLegs as referenceDecode } from '../../../tools/route-data/pipeline/lib/legs.mjs';
import type { PackedLegs, RouteData } from '../src/lib/route-lab/data';
import { DEFAULT_DAY, days } from '../src/lib/route-lab/days';
import { decodeLegs, networkPath, pathData, routeLine } from '../src/lib/route-lab/legs';
import { loadSolver } from '../src/lib/route-lab/node-solver';
import {
  bakeryLabelAt,
  clearOfPlaces,
  contours,
  inside,
  labelBox,
  overlaps,
  rings,
} from '../src/lib/route-lab/contours';
import type { Basemap, Isochrones } from '../src/lib/route-lab/data';
import {
  capacityFor,
  dealtInTurn,
  explorationFor,
  formatDuration,
  formatMiles,
  fromVroom,
  measure,
  percentLess,
  shareCapacity,
  solveTime,
  vroomInput,
} from '../src/lib/route-lab/plan';
import {
  backLine,
  backText,
  bandsSentence,
  esc,
  isRound,
  mapTitle,
  NUMBERED,
  placesMarkup,
  planLine,
  roomText,
  savedText,
  tableMarkup,
  tipLines,
  vanLine,
} from '../src/lib/route-lab/render';
import { app } from './support/dist';

// The Route Lab's domain core (lib/route-lab/), with known answers: the leg decoder against the
// pipeline's own reference, the dealt-in-turn plan and the figures the page leads with, VROOM's
// input and output, and the markup both the build and the browser draw. The figures are the ones
// the page states: a busy Saturday dealt in turn drives 5 h 34 min and 148.8 mi; VROOM, solved
// here from the files in apps/web/public, plans it in 3 h 12 min and 74.8 mi.

const text = readFileSync(join(app, '../../tools/route-data/out/route-data.json'), 'utf8');
const data = JSON.parse(text) as RouteData;
const n = data.points.length;
const NBSP = '\u00a0';
const busy = days(data).find((d) => d.id === DEFAULT_DAY);
if (!busy) throw new Error('no default day');

/** The lines of a JSON text, counted from 1, that hold more than one number outside its strings. */
function crowdedLines(json: string): number[] {
  return json.split('\n').flatMap((line, k) => {
    const outside = line.replace(/"(?:[^"\\]|\\.)*"/g, '""');
    return (outside.match(/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g) ?? []).length > 1 ? [k + 1] : [];
  });
}

// route-data.json is written one value per line (tools/route-data/pipeline/lib/format.mjs says
// why): on one line, adjacent numbers run together, and a run can read by chance as one longer
// number, such as a phone number or an ID.
describe('the route data file', () => {
  test('parses, and no line holds two numbers', () => {
    expect(() => JSON.parse(text)).not.toThrow();
    expect(crowdedLines(text)).toEqual([]);
  });

  test('is exactly what the pipeline writes from its contents', () => {
    expect(formatRouteData(JSON.parse(text))).toBe(text);
  });

  test('known answers: an array on one line fails; one value per line passes; a string is text', () => {
    expect(crowdedLines('{"d":[1,2]}')).toEqual([1]);
    expect(crowdedLines('{"x": 7, "y": 8}')).toEqual([1]);
    // The same data on one line, as JSON.stringify writes it and as the pipeline wrote it
    // until this change.
    expect(crowdedLines(JSON.stringify(data))).toEqual([1]);
    const formatted = formatRouteData({ d: [1, 2], p: { x: 7, y: 8 }, s: 'run 1,2 "3"' });
    expect(formatted).toBe(
      '{\n"d": [\n1,\n2\n],\n"p": {\n"x": 7,\n"y": 8\n},\n"s": "run 1,2 \\"3\\""\n}\n',
    );
    expect(crowdedLines(formatted)).toEqual([]);
  });
});

describe('legs', () => {
  test('every one of the 4,032 legs decodes exactly as the pipeline’s reference decoder does', () => {
    const leg = decodeLegs(data.legs);
    const reference = referenceDecode(data.legs) as (i: number, j: number) => number[][];
    let legs = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        expect(leg(i, j), `${i} to ${j}`).toEqual(reference(i, j).flat());
        legs++;
      }
    }
    expect(legs).toBe(4_032);
  });

  // A graph small enough to follow by hand: three vertices, two segments, and at the middle
  // vertex two ways on, so each leg needs one digit.
  const tiny: PackedLegs = {
    verts: [0, 0, 10, 0, 0, 10],
    segs: [0, 1, 3, 0, 1, 2, 3, 1, -5, 5],
    starts: [0, 2],
    legs: '1,0',
  };

  test('known answers: a leg follows its digits; a route joins its legs end to end', () => {
    const leg = decodeLegs(tiny);
    expect(leg(0, 1)).toEqual([0, 0, 10, 0, 5, 5, 10, 10]);
    expect(leg(1, 0)).toEqual([10, 10, 5, 5, 10, 0, 0, 0]);
    expect(routeLine(leg, [0, 1, 0])).toEqual([0, 0, 10, 0, 5, 5, 10, 10, 5, 5, 10, 0, 0, 0]);
    expect(() => decodeLegs({ ...tiny, legs: '9,0' })(0, 1)).toThrow(/does not arrive/);
  });

  test('known answers: path data is integers, the first point in full and then each step', () => {
    expect(pathData([0, 0, 3, 4, 3, 4, 1, -2])).toBe('M0 0l3 4-2-6');
    expect(pathData([5, 5])).toBe('');
    expect(pathData([5, 5, 5, 5])).toBe('');
    expect(networkPath(tiny)).toBe('M0 0l10 0m0 0l-5 5 5 5');
  });
});

describe('the two plans', () => {
  const capacity = capacityFor(data, busy.orders, busy.vans);

  test('a busy Saturday: 20 orders, 3 vans of 19 boxes, the pipeline’s own day', () => {
    expect([busy.orders.length, busy.vans, capacity]).toEqual([20, 3, 19]);
    const scenario = data.scenarios.find((s) => s.id === 'busy');
    expect(busy.orders).toEqual(scenario?.stops);
    expect(capacity).toBe(scenario?.capacity);
  });

  test('dealt in turn, it drives 5 h 34 min and 148.8 mi', () => {
    const plan = dealtInTurn(data, busy.orders, busy.vans, capacity);
    expect(plan.routes).toEqual([
      [31, 39, 7, 40, 33, 13, 2],
      [43, 1, 55, 50, 22, 46, 23],
      [25, 30, 38, 8, 4, 12],
    ]);
    const m = measure(data, plan);
    expect([m.drive, m.metres]).toEqual([20_038, 239_390]);
    // The day is done when the slowest van is back: its driving and three minutes an order.
    expect(m.back).toBe(Math.max(...m.vans.map((v) => v.back)));
    expect(formatDuration(m.back)).toBe(`2${NBSP}h 53${NBSP}min`);
    expect([formatDuration(m.drive), formatMiles(m.metres)]).toEqual([
      `5${NBSP}h 34${NBSP}min`,
      `148.8${NBSP}mi`,
    ]);
  });

  test('known answers: an order goes to the next van with room, and one that fits nowhere is left', () => {
    const toy = {
      ...data,
      points: [
        { i: 0, label: 'b', kind: 'depot', x: 0, y: 0 },
        ...[3, 1, 1, 4].map((qty, k) => ({
          i: k + 1,
          label: `p${k}`,
          kind: 'park',
          qty,
          x: 0,
          y: 0,
        })),
      ],
    } as RouteData;
    expect(dealtInTurn(toy, [1, 2, 3, 4], 2, 3)).toEqual({
      routes: [[1], [2, 3]],
      unassigned: [4],
    });
    expect(capacityFor(toy, [1], 4)).toBe(3);
    expect(capacityFor(toy, [1, 2, 3], 2)).toBe(4);
  });

  test('known answers: the vans grow until the orders dealt in turn all fit, so both plans serve every order', () => {
    // 2, 2 and 2 boxes, then 3, in 3 vans: the share rule gives 4 a van, and dealing then leaves the
    // 3 with no room though the vans hold 12 between them. One more box a van places it.
    const toy = {
      ...data,
      points: [
        { i: 0, label: 'b', kind: 'depot', x: 0, y: 0 },
        ...[2, 2, 2, 3].map((qty, k) => ({
          i: k + 1,
          label: `p${k}`,
          kind: 'park',
          qty,
          x: 0,
          y: 0,
        })),
      ],
    } as RouteData;
    const orders = [1, 2, 3, 4];
    expect(shareCapacity(toy, orders, 3)).toBe(4);
    expect(dealtInTurn(toy, orders, 3, 4).unassigned).toEqual([4]);
    expect(capacityFor(toy, orders, 3)).toBe(5);
    expect(dealtInTurn(toy, orders, 3, 5)).toEqual({ routes: [[1, 4], [2], [3]], unassigned: [] });
    expect(roomText(toy, orders, 3, 5)).toBe(
      'Each van takes at most 5 of the 9 boxes: room for every order, dealt in turn.',
    );
    // The ready-made days need no raise: the pipeline's share rule already deals every order.
    for (const day of data.scenarios)
      expect(capacityFor(data, day.stops, day.vans), day.id).toBe(day.capacity);
  });

  test('VROOM, from the files the site serves, plans it in 3 h 12 min and 74.8 mi', async () => {
    const solver = await loadSolver(app);
    const output = solver.solve(vroomInput(data, busy.orders, busy.vans, capacity), {
      explorationLevel: explorationFor(busy.orders.length),
    }) as Parameters<typeof fromVroom>[0] & {
      summary: { cost: number; duration: number; distance: number };
    };
    expect(output.summary.cost).toBe(11_504);
    const plan = fromVroom(output, busy.vans);
    expect(plan.unassigned).toEqual([]);
    expect([...plan.routes.flat()].sort((a, b) => a - b)).toEqual(
      [...busy.orders].sort((a, b) => a - b),
    );
    // The page measures VROOM's plan on the same matrices VROOM used: the figures agree with its own.
    const m = measure(data, plan);
    expect([m.drive, m.metres]).toEqual([output.summary.duration, output.summary.distance]);
    expect([formatDuration(m.drive), formatMiles(m.metres)]).toEqual([
      `3${NBSP}h 12${NBSP}min`,
      `74.8${NBSP}mi`,
    ]);
  });

  test('known answers: VROOM’s input is cut to the bakery and the orders, and its errors throw', () => {
    const input = vroomInput(data, [5, 9], 2, 4);
    expect(input.vehicles).toEqual([
      { id: 1, start_index: 0, end_index: 0, capacity: [4] },
      { id: 2, start_index: 0, end_index: 0, capacity: [4] },
    ]);
    expect(input.jobs.map((j) => [j.id, j.location_index, j.service])).toEqual([
      [5, 1, 180],
      [9, 2, 180],
    ]);
    expect(input.matrices.car.durations).toEqual([
      [0, data.durations[5], data.durations[9]],
      [data.durations[5 * n], 0, data.durations[5 * n + 9]],
      [data.durations[9 * n], data.durations[9 * n + 5], 0],
    ]);
    expect(() => fromVroom({ code: 2, error: 'Invalid input.' }, 2)).toThrow(/Invalid input/);
    expect(
      fromVroom(
        {
          code: 0,
          routes: [
            { vehicle: 2, steps: [{ type: 'start' }, { type: 'job', id: 9 }, { type: 'end' }] },
          ],
        },
        3,
      ),
    ).toEqual({ routes: [[], [9], []], unassigned: [] });
  });

  test('known answers: exploration 5 up to 40 orders, 3 above', () => {
    expect([explorationFor(1), explorationFor(40), explorationFor(41), explorationFor(63)]).toEqual(
      [5, 5, 3, 3],
    );
  });

  test('known answers: times in whole minutes, distances in tenths of a mile, savings in percent', () => {
    expect(formatDuration(0)).toBe(`0${NBSP}min`);
    expect(formatDuration(29)).toBe(`0${NBSP}min`);
    expect(formatDuration(3_569)).toBe(`59${NBSP}min`);
    expect(formatDuration(3_570)).toBe(`1${NBSP}h 0${NBSP}min`);
    expect(formatDuration(3_600)).toBe(`1${NBSP}h 0${NBSP}min`);
    expect(formatMiles(1_609.344)).toBe(`1.0${NBSP}mi`);
    expect(percentLess(20_038, 11_504)).toBe(43);
    expect([solveTime(0.2), solveTime(62.4), solveTime(999.4), solveTime(1_254)]).toEqual([
      `1${NBSP}ms`,
      `62${NBSP}ms`,
      `999${NBSP}ms`,
      `1.25${NBSP}s`,
    ]);
    expect(percentLess(0, 0)).toBe(0);
  });
});

describe('the days', () => {
  test('each lists real orders once, with one to four vans, and the default is among them', () => {
    const all = days(data);
    expect(all.map((d) => d.id)).toEqual(['quiet', 'busy', 'libraries', 'lake', 'everything']);
    for (const day of all) {
      expect(new Set(day.orders).size, day.id).toBe(day.orders.length);
      for (const order of day.orders)
        expect(data.points[order]?.order, `${day.id}: ${order}`).toBeDefined();
      expect(day.vans).toBeGreaterThanOrEqual(1);
      expect(day.vans).toBeLessThanOrEqual(4);
    }
    const libraries = all.find((d) => d.id === 'libraries');
    expect(libraries?.orders.every((o) => data.points[o]?.kind === 'library')).toBe(true);
    expect(libraries?.orders).toHaveLength(data.points.filter((p) => p.kind === 'library').length);
  });
});

describe('the markup both the build and the browser draw', () => {
  const plan = { routes: [[3, 9], [], [12]], unassigned: [40] };
  const m = measure(data, plan);

  test('every place is on the map once: idle, a van’s stop, left over, or the bakery', () => {
    const markup = placesMarkup(data, plan);
    // Each van's casing draws its stops twice, on purpose; every other place is one mark.
    const marks = markup.replace(/<path class="rl-stop-casing[^"]*"[^>]*>/g, '');
    expect([...marks.matchAll(/M(-?\d+) (-?\d+)h0/g)]).toHaveLength(n);
    expect(markup).toContain('class="rl-stop van-a rl-big"');
    expect(markup).not.toContain('van-b');
    expect(markup).toContain('class="rl-stop van-c rl-big rl-round"');
    expect(markup).toContain('data-rl-left');
    expect(markup).not.toContain('style=');
  });

  test('known answers: stops carry their numbers up to 30 in all, and B and C are round', () => {
    const numbers = (markup: string) =>
      [...markup.matchAll(/<text class="rl-num"[^>]*>(\d+)<\/text>/g)].map(([, k]) => Number(k));
    expect(numbers(placesMarkup(data, plan))).toEqual([1, 2, 1]);
    const many = { routes: [busy.orders, [...data.points.keys()].slice(30, 41)], unassigned: [] };
    expect(many.routes.flat().length).toBeGreaterThan(NUMBERED);
    const crowded = placesMarkup(data, many);
    expect(numbers(crowded)).toEqual([]);
    expect(crowded).not.toContain('rl-big');
    expect([0, 1, 2, 3].map(isRound)).toEqual([false, true, true, false]);
  });

  test('the table counts from leaving the bakery, never a time of day, and says when a van stays', () => {
    const table = tableMarkup(data, m, 'A <plan>');
    expect(table).toContain('<caption>A &lt;plan&gt;</caption>');
    expect(table).toContain('Van B stays at the bakery.');
    expect(table).not.toMatch(/\d:\d\d/);
    // Each stop is a row header, named as the map numbers it, with its distance from the bakery.
    expect([...table.matchAll(/<th scope="row">([A-D]\d+)<\/th>/g)].map(([, k]) => k)).toEqual([
      'A1',
      'A2',
      'C1',
    ]);
    expect(table).toContain(`${formatDuration(data.durations[3] ?? 0)} from the bakery`);
    const arrivals = m.vans[0]?.stops.map((s) => s.arrives) ?? [];
    expect(arrivals).toEqual([...arrivals].sort((a, b) => a - b));
    const [first] = m.vans;
    if (!first) throw new Error('no van');
    expect(vanLine(first, 0)).toMatch(/^Van A: 2 stops, \d+ boxes, /);
  });

  test('known answers: text is escaped; the readout words agree with the plan', () => {
    expect(esc('<a href="x">&</a>')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
    // In words, with no middle dot (ADR 0025): "148.8 mi · 3 vans" until then.
    expect(planLine(plan, m)).toMatch(/mi, 2 vans$/);
    const none = measure(data, { routes: [[], []], unassigned: [] });
    expect([planLine({ routes: [[], []], unassigned: [] }, none), backLine(none)]).toEqual([
      'No stops',
      '',
    ]);
    expect(backLine(m)).toBe(`Last van back after ${formatDuration(m.back)}`);
    const bands = bandsSentence([5, 10, 15, 20, 25, 30], [10, 20]);
    expect(bands).toBe(
      'Shaded bands show driving time from the bakery, 5 to 30 minutes, with a line at 10 and 20.',
    );
    expect(mapTitle('before', 1, 1, bands)).toBe(
      `Map of the bakery and 1 order, with the routes of 1 van dealt the orders as they came in. ${bands}`,
    );
    expect(mapTitle('after', 11, 2, bands, true)).toMatch(
      /^Map of the bakery and the previous 11 orders, with the routes VROOM planned for 2 vans\. /,
    );
    expect(savedText(m, m)).toBe('These orders came in an order VROOM could not beat.');
    // One order is one route in both plans: nothing to beat, and the headline says why.
    const single = measure(data, { routes: [[3], []], unassigned: [] });
    expect(savedText(single, single)).toBe('With one order, both plans are the same route.');
    const shorter = { ...m, drive: m.drive - 600, metres: m.metres - 1_609 };
    expect(savedText(m, shorter)).toMatch(
      new RegExp(`^VROOM saves 10${NBSP}min of driving and 1.0${NBSP}mi, \\d+% less\\.$`),
    );
    // The headline is the difference of the totals as shown: 3 h 0 min (10,770 s) and 2 h 28 min
    // (8,890 s) are 32 min apart on the page, though 1,880 s rounds to 31.
    const shown = (drive: number, metres: number) => ({ ...m, drive, metres });
    expect(formatDuration(10_770)).toBe(`3${NBSP}h 0${NBSP}min`);
    expect(formatDuration(8_890)).toBe(`2${NBSP}h 28${NBSP}min`);
    expect(savedText(shown(10_770, 40_000), shown(8_890, 40_000))).toMatch(
      new RegExp(`^VROOM saves 32${NBSP}min of driving and 0.0${NBSP}mi, `),
    );
    // Miles too: 24.9 and 24.8 mi on the page (40,152 m and 39,985 m) are 0.1 apart.
    expect([formatMiles(40_152), formatMiles(39_985)]).toEqual([`24.9${NBSP}mi`, `24.8${NBSP}mi`]);
    expect(savedText(shown(10_770, 40_152), shown(8_890, 39_985))).toMatch(
      new RegExp(`and 0.1${NBSP}mi, `),
    );
    expect(backText({ ...m, back: 7_200 }, { ...m, back: 5_400 })).toBe(
      `The last van is back after 2${NBSP}h 0${NBSP}min as the orders came in, and after 1${NBSP}h 30${NBSP}min with VROOM.`,
    );
  });

  test('known answers: a van’s room is a share of the day’s boxes, said as one', () => {
    // A busy Saturday: 42 boxes, 3 vans of 19, 1.3 times a third of 42 rounded up.
    expect(roomText(data, busy.orders, 3, 19)).toBe(
      'Each van takes at most 19 of the 42 boxes: 1.3 times its share.',
    );
    expect(roomText(data, busy.orders, 1, capacityFor(data, busy.orders, 1))).toBe(
      'One van takes all 42 boxes.',
    );
    // One order has no share to speak of: before 2026-10-25 one order of 3 boxes and 4 vans read
    // "Each van takes at most 3 of the 3 boxes: the largest order", and one box "1 of the 1 box".
    const three = data.points.find((p) => p.qty === 3)?.i ?? 0;
    expect(roomText(data, [three], 4, capacityFor(data, [three], 4))).toBe(
      'One order: one van takes its 3 boxes.',
    );
    const one = data.points.find((p) => p.qty === 1)?.i ?? 0;
    expect(roomText(data, [one], 2, capacityFor(data, [one], 2))).toBe(
      'One order: one van takes its 1 box.',
    );
    // Two orders that are together the largest: the room is the largest order, more than the share.
    const two = [three, one];
    expect(roomText(data, two, 4, capacityFor(data, two, 4))).toBe(
      'Each van takes at most 3 of the 4 boxes: the largest order.',
    );
    expect(roomText(data, [], 2, 1)).toBe('');
  });

  test('known answers: the tip names the place, its order and where it falls in this plan', () => {
    const [stop, idle, left] = [3, 5, 40].map((i) => data.points[i]);
    expect(tipLines(data, plan, 3)).toEqual([
      stop?.label,
      `${stop?.order}, ${stop?.qty} ${stop?.qty === 1 ? 'box' : 'boxes'}`,
      `Van A, stop 1, ${formatDuration(data.durations[3] ?? 0)} from the bakery`,
    ]);
    expect(tipLines(data, plan, 5)).toEqual([
      idle?.label,
      `No order today, ${formatDuration(data.durations[5] ?? 0)} from the bakery`,
    ]);
    expect(tipLines(data, plan, 40)[2]).toMatch(/^No van has room, /);
    expect(left).toBeDefined();
  });
});

describe('the isochrones’ lines (build only)', () => {
  const iso = JSON.parse(
    readFileSync(join(app, '../../tools/route-data/out/isochrones.json'), 'utf8'),
  ) as Isochrones;
  const base = JSON.parse(
    readFileSync(join(app, '../../tools/route-data/out/basemap.json'), 'utf8'),
  ) as Basemap;

  test('known answers: path data reads as rings, and a point is inside by the even-odd rule', () => {
    const square = rings('M0 0l10 0 0 10-10 0zm3 3l4 0 0 4-4 0z');
    expect(square).toEqual([
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [3, 3],
        [7, 3],
        [7, 7],
        [3, 7],
      ],
    ]);
    expect([inside(square, 1, 1), inside(square, 5, 5), inside(square, 11, 5)]).toEqual([
      true,
      false,
      false,
    ]);
  });

  test('the 10 and 20 minute lines run on land only, each with a label on land, clear of the map’s own', () => {
    const water = rings(base.water);
    const lines = contours(iso, base, base.labels, [10, 20]);
    expect(lines.map((l) => l.minutes)).toEqual([10, 20]);
    for (const line of lines) {
      expect(line.d.length, `${line.minutes}`).toBeGreaterThan(500);
      expect(line.labels.length, `${line.minutes}`).toBeGreaterThan(0);
      for (const at of line.labels) {
        expect(inside(water, at.x, at.y), `${line.minutes} at ${at.x},${at.y}`).toBe(false);
        for (const l of base.labels)
          expect(
            Math.abs(l.x - at.x) > 210 || Math.abs(l.y - at.y) > 70,
            `${line.minutes} min and ${l.text}`,
          ).toBe(true);
      }
      // No point of a line lies in the water: an edge along the shore is the shore, not a time.
      const points = rings(`${line.d.replace(/M/g, 'zM')}z`).flat();
      const wet = points.filter(([x, y]) => inside(water, x, y));
      expect(wet.length / points.length, `${line.minutes}`).toBeLessThan(0.02);
    }
    expect(() => contours(iso, base, [], [7])).toThrow(/no isochrone at 7/);
  });

  test('no contour label and not the bakery’s covers a place, so every stop’s number reads whole', () => {
    // Before 2026-10-25 "20 min" sat on Carkeek Park and "10 min" on Judkins Park, a stop on the
    // default day, and "The bakery" covered International Fountain, another.
    const places = data.points.slice(1);
    const lines = contours(iso, base, base.labels, [10, 20], data.points);
    for (const line of lines)
      for (const at of line.labels)
        expect(
          clearOfPlaces(labelBox(at.x, at.y, 6, 'middle', 41), places),
          `${line.minutes} min at ${at.x},${at.y}`,
        ).toBe(true);
    const bakery = data.points[0] ?? { x: 0, y: 0 };
    const label = bakeryLabelAt(bakery, data.points);
    expect(clearOfPlaces(labelBox(label.x, label.y, 10, label.anchor, 37), places)).toBe(true);
  });

  test('known answers: a label box, a place under it, and the bakery’s label moving right', () => {
    expect(labelBox(100, 200, 10, 'end', 37)).toEqual({
      left: -270,
      right: 100,
      top: 148,
      bottom: 217,
    });
    expect(labelBox(100, 200, 6, 'middle', 41)).toEqual({
      left: -23,
      right: 223,
      top: 148,
      bottom: 217,
    });
    const box = labelBox(100, 200, 4, 'start', 25);
    expect(clearOfPlaces(box, [{ x: 150, y: 190 }])).toBe(false);
    expect(clearOfPlaces(box, [{ x: 150, y: 260 }])).toBe(true);
    expect(overlaps(box, labelBox(150, 210, 4, 'start', 25))).toBe(true);
    expect(overlaps(box, labelBox(400, 210, 4, 'start', 25))).toBe(false);
    const at = { x: 1000, y: 1000 };
    expect(bakeryLabelAt(at, [at]).anchor).toBe('end');
    expect(bakeryLabelAt(at, [at, { x: 900, y: 990 }])).toEqual({
      x: 1024,
      y: 1011,
      anchor: 'start',
    });
  });
});
