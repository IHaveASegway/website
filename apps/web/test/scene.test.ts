import { describe, expect, test } from 'vitest';
import { DEFAULT_DAY, days } from '../src/lib/route-lab/days';
import { leg, routeData } from '../src/lib/route-lab/picture';
import { capacityFor, dealtInTurn, measure } from '../src/lib/route-lab/plan';
import {
  cameraAt,
  dayPlaces,
  extent,
  fit,
  floorMatrix,
  focusOf,
  LIFTED,
  projector,
  readScene,
  sceneOf,
  sceneSeconds,
  sceneText,
  simplify3,
  START,
  unpack,
  where,
} from '../src/lib/route-lab/scene';
import { tracks } from '../src/lib/route-lab/timeline';
import {
  dayClock,
  DAY_S,
  HOLD_S,
  liftFor,
  nextRatio,
  progress,
  rising,
  served,
} from '../src/scripts/route-scene';
import { files, read } from './support/dist';

// Home's scene (ADR 0024): the camera the build's picture and the canvas share, the tracks the
// data file carries, and the clock and the scroll that drive it. Known answers first, then the
// real day, whose data must agree with the timeline and with measure(), as the cube's does.

const close = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe('the camera', () => {
  test('known answers: the camera eases from START to LIFTED, and clamps outside 0 to 1', () => {
    expect(cameraAt(0)).toEqual(START);
    expect(cameraAt(-1)).toEqual(START);
    const lifted = cameraAt(1);
    expect(close(lifted.azimuth, LIFTED.azimuth) && close(lifted.elevation, LIFTED.elevation)).toBe(
      true,
    );
    expect(lifted.lift).toBe(1);
    expect(cameraAt(0.5).lift).toBe(0.5);
  });

  test('the floor matrix is the projection at time 0, through the same fit', () => {
    const focus = [100, 200, 900, 1000] as const;
    for (const camera of [START, cameraAt(0.4), LIFTED]) {
      const at = fit(extent(focus, 3600, camera), { x: 10, y: 20, width: 640, height: 480 });
      const [a, b, c, d, e, f] = floorMatrix(focus, 3600, camera, at);
      const p = projector(focus, 3600, camera);
      for (const [x, y] of [
        [100, 200],
        [900, 1000],
        [450, 730],
      ] as const) {
        const [u, v] = p(x, y, 0);
        expect(close(a * x + c * y + e, u * at.scale + at.x, 1e-6)).toBe(true);
        expect(close(b * x + d * y + f, v * at.scale + at.y, 1e-6)).toBe(true);
      }
    }
  });

  test('fit sets the extent in the middle of the box, as large as it fits', () => {
    const at = fit(
      { x: -50, y: -25, width: 100, height: 50 },
      { x: 0, y: 0, width: 400, height: 400 },
    );
    expect(at.scale).toBe(4);
    // The extent's middle, its point (0, 0), lands on the box's middle.
    expect([at.x, at.y]).toEqual([200, 200]);
  });

  test('lifted, the extent holds the cube: taller than the flat floor seen from the same angle', () => {
    const focus = [0, 0, 1000, 1000] as const;
    const flat = extent(focus, 3600, { ...LIFTED, lift: 0 });
    const cube = extent(focus, 3600, LIFTED);
    expect(cube.height).toBeGreaterThan(flat.height);
    expect(close(cube.width, flat.width, 1e-6)).toBe(true);
  });

  test('the focus is a square around the places, padded, and holds every one', () => {
    const places = [100, 100, 300, 500, 200, 250];
    const [x0, y0, x1, y1] = focusOf(places, 0.1);
    expect(x1 - x0).toBe(y1 - y0);
    for (let k = 0; k < places.length; k += 2) {
      expect((places[k] ?? 0) > x0 && (places[k] ?? 0) < x1).toBe(true);
      expect((places[k + 1] ?? 0) > y0 && (places[k + 1] ?? 0) < y1).toBe(true);
    }
  });
});

describe('a track', () => {
  test('known answers: simplify3 drops points on a straight drive and keeps a stop', () => {
    // A van drives straight along x for 100 s, stands 60 s, then drives on.
    const points = [0, 0, 0, 25, 0, 25, 50, 0, 50, 100, 0, 100, 100, 0, 160, 200, 0, 260];
    expect(simplify3(points)).toEqual([0, 0, 0, 100, 0, 100, 100, 0, 160, 200, 0, 260]);
  });

  test('known answers: where interpolates, and stands at the ends before and after', () => {
    const points = [0, 0, 0, 100, 0, 100, 100, 50, 150];
    expect(where(points, -5)).toEqual([0, 0]);
    expect(where(points, 50)).toEqual([50, 0]);
    expect(where(points, 125)).toEqual([100, 25]);
    expect(where(points, 999)).toEqual([100, 50]);
  });

  test('unpack reads what the data file writes: numbers with spaces between them', () => {
    expect(unpack('1 -2 30')).toEqual([1, -2, 30]);
    expect(unpack('')).toEqual([]);
  });
});

describe('the clock and the scroll', () => {
  test('known answers: the day runs in DAY_S, holds HOLD_S at its end, then starts again', () => {
    expect(dayClock(0, 8000)).toBe(0);
    expect(dayClock(DAY_S / 2, 8000)).toBe(4000);
    expect(dayClock(DAY_S + HOLD_S / 2, 8000)).toBe(8000);
    expect(close(dayClock(DAY_S + HOLD_S + 1, 8000), 8000 / DAY_S)).toBe(true);
  });

  test('known answers: progress, rising and the lift', () => {
    expect(progress(0, 1800, 900)).toBe(0);
    expect(progress(-450, 1800, 900)).toBe(0.5);
    expect(progress(-2000, 1800, 900)).toBe(1);
    expect(progress(0, 800, 900)).toBe(0);
    expect(rising(900, 900)).toBe(0);
    expect(rising(450, 900)).toBe(0.5);
    expect(rising(-10, 900)).toBe(1);
    // The hero stands still through the first fifth, and the day is up by nine tenths.
    expect(liftFor(0.2)).toBe(0);
    expect(liftFor(0.9)).toBe(1);
    expect(close(liftFor(0.55), 0.5)).toBe(true);
  });

  test('known answers: the governor keeps the ratio while frames keep up, then sheds load', () => {
    expect(nextRatio(8, 1.5)).toBe(1.5);
    expect(nextRatio(20, 1.5)).toBe(1);
    expect(nextRatio(20, 1)).toBe(0);
  });
});

describe('the real day', () => {
  const day = days(routeData).find((d) => d.id === DEFAULT_DAY);
  if (!day) throw new Error('no default day');
  const capacity = capacityFor(routeData, day.orders, day.vans);
  // The dealt-in-turn plan stands in for VROOM's here: the scene reads any plan the same way, and
  // the build's own solve is checked through the data file below.
  const plan = dealtInTurn(routeData, day.orders, day.vans, capacity);
  const measured = measure(routeData, plan);
  const scene = sceneOf(routeData, leg, { plan, measured });

  test('every order is a stop on some track, and the readout counts them all by day’s end', () => {
    expect(scene.orders).toBe(day.orders.length);
    expect(served(scene.tracks, scene.back)).toBe(day.orders.length);
    expect(served(scene.tracks, -1)).toBe(0);
  });

  test('each track ends when measure() says its van is back, at the bakery', () => {
    const full = tracks(routeData, leg, plan);
    for (const track of scene.tracks) {
      const { points } = track;
      expect(points.at(-1)).toBe(Math.round(full.find((t) => t.van === track.van)?.back ?? -1));
      expect(where(points, track.back)).toEqual([...scene.bakery]);
    }
    expect(scene.back).toBe(measured.back);
    expect(scene.seconds).toBe(sceneSeconds(measured.back));
    expect(scene.seconds % 3600).toBe(0);
  });

  test('simplified, a track keeps every stop it stands at', () => {
    for (const track of scene.tracks) {
      const { points, stops } = track;
      for (let k = 0; k < stops.length; k += 3) {
        const [x, y] = where(points, (stops[k + 2] ?? 0) + 1);
        expect(Math.hypot(x - (stops[k] ?? 0), y - (stops[k + 1] ?? 0))).toBeLessThan(3);
      }
    }
  });

  test('the focus holds the bakery and every stop', () => {
    const [x0, y0, x1, y1] = scene.focus;
    const places = dayPlaces(routeData, plan);
    for (let k = 0; k < places.length; k += 2) {
      expect((places[k] ?? 0) >= x0 && (places[k] ?? 0) <= x1).toBe(true);
      expect((places[k + 1] ?? 0) >= y0 && (places[k + 1] ?? 0) <= y1).toBe(true);
    }
  });

  // The data file's wire format: every list of numbers as one string, so no two numbers in the
  // file stand with a comma between them, which a content scan reads as a figure.
  test('the data file reads back as the scene it was written from, with no comma between numbers', () => {
    const text = sceneText(scene);
    expect(readScene(text)).toEqual(JSON.parse(JSON.stringify(scene)));
    expect(text).not.toMatch(/\d,-?\d/);
  });

  test('the data file the build writes is a scene of the same day, in that format', () => {
    if (!files.includes('lab/routes/scene.json')) return;
    const text = read('lab/routes/scene.json');
    expect(text).not.toMatch(/\d,-?\d/);
    const built = readScene(text);
    expect(built.orders).toBe(day.orders.length);
    expect(built.tracks.length).toBeGreaterThan(0);
  });
});
