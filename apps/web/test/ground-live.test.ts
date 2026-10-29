import { describe, expect, test } from 'vitest';
import {
  CYCLE_S,
  ease,
  HOLD_S,
  MAX_RATIO,
  nextRatio,
  shares,
  SLOW_S,
  TURN_S,
  VIEWS,
  viewFor,
} from '../src/scripts/ground-live.js';

// Home's living ground (ADR 0021): the parts that run without a GPU. The shader itself runs in
// e2e/living-ground.spec.ts, in a real WebGL2 context.

describe('the pictures take turns', () => {
  test('each holds alone, then hands over smoothly, and the shares always add up to 1', () => {
    for (let t = -CYCLE_S; t < 2 * CYCLE_S; t += 0.25) {
      const w = shares(t);
      expect(w.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
      for (const share of w) expect(share).toBeGreaterThanOrEqual(0);
    }
    expect(shares(1)).toEqual([1, 0, 0]);
    expect(shares(HOLD_S + TURN_S + 1)).toEqual([0, 1, 0]);
    expect(shares(2 * (HOLD_S + TURN_S) + 1)).toEqual([0, 0, 1]);
    const half = shares(HOLD_S + TURN_S / 2);
    expect(half[0]).toBeCloseTo(0.5, 12);
    expect(half[1]).toBeCloseTo(0.5, 12);
    // The last picture hands back to the first, so the cycle has no seam.
    const back = shares(CYCLE_S - TURN_S / 2);
    expect(back[2]).toBeCloseTo(0.5, 12);
    expect(back[0]).toBeCloseTo(0.5, 12);
    expect(shares(CYCLE_S + 1)).toEqual(shares(1));
  });

  test('no share jumps: a 30 fps frame moves each one by less than a tenth', () => {
    for (let t = 0; t < CYCLE_S; t += 1 / 30) {
      const [a, b] = [shares(t), shares(t + 1 / 30)];
      for (let i = 0; i < 3; i++) expect(Math.abs((a[i] ?? 0) - (b[i] ?? 0))).toBeLessThan(0.1);
    }
  });

  test("the camera stands at each picture's view while it holds, and between them while it turns", () => {
    VIEWS.forEach((view, i) => {
      const w = [0, 0, 0];
      w[i] = 1;
      expect(viewFor(w)).toEqual(view);
    });
    const mid = viewFor([0.5, 0.5, 0]);
    expect(mid.tilt).toBeCloseTo(((VIEWS[0]?.tilt ?? 0) + (VIEWS[1]?.tilt ?? 0)) / 2, 12);
  });

  test('every view keeps the horizon above the top of the drawing', () => {
    // The ray through the top edge, half a height above the middle, must still meet the plane:
    // with the shader's lens (0.73), a tilt t keeps it below the horizon while cot(t)/0.73 > 0.5.
    for (const { tilt } of VIEWS) expect(1 / Math.tan(tilt + 0.04) / 0.73).toBeGreaterThan(0.5);
  });
});

test('easing is the same at any frame rate, and lands on its target', () => {
  const run = (fps: number) => {
    let v = 0;
    for (let i = 0; i < fps; i++) v = ease(v, 1, 4, 1 / fps, 0);
    return v;
  };
  expect(run(30)).toBeCloseTo(run(120), 10);
  expect(ease(0.9995, 1, 4, 0.001)).toBe(1);
  expect(ease(0, 1, 4, 0)).toBe(0);
});

test('the governor keeps the ratio while frames keep up, drops to 1, then gives up', () => {
  expect(nextRatio(1 / 30, MAX_RATIO)).toBe(MAX_RATIO);
  expect(nextRatio(SLOW_S, MAX_RATIO)).toBe(MAX_RATIO);
  expect(nextRatio(SLOW_S + 0.01, MAX_RATIO)).toBe(1);
  expect(nextRatio(SLOW_S + 0.01, 1)).toBe(0);
  expect(nextRatio(1 / 30, 1)).toBe(1);
});
