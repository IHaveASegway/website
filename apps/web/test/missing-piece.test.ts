import { gzipSync } from 'node:zlib';
import { expect, test } from 'vitest';
import { missingPiece, project } from '../src/lib/missing-piece';
import { read } from './support/dist';

// The 404's drawing (lib/missing-piece.ts; ADR 0027): the system with one solid missing, drawn at
// build. It replaces lib/ground.ts's end of the line and About's wheels, which went with the signal
// box (docs/design/overhaul.md, "404"). e2e/not-found.spec.ts checks it on the page.

const markup = () => {
  const d = missingPiece();
  return JSON.stringify(d);
};

test('known answers: the projection is isometric, 30° each side, height straight up', () => {
  const [x0, y0] = project(0, 0);
  expect([x0, y0]).toEqual([0, 0]);
  const [x1, y1] = project(1, 0);
  const [x2, y2] = project(0, 1);
  // One cell along x goes right and down, along y left and down, at the same slope.
  expect(x1).toBeCloseTo(-x2);
  expect(y1).toBeCloseTo(y2);
  expect(Math.atan2(y1, x1)).toBeCloseTo(Math.PI / 6);
  // Up is straight up, one cell as tall as a cell is long.
  const [x3, y3] = project(0, 0, 1);
  expect(x3).toBe(0);
  expect(y3).toBeCloseTo(-Math.hypot(x1, y1));
});

test('the same call draws the same picture, byte for byte, small enough to inline', () => {
  expect(markup()).toBe(markup());
  expect(gzipSync(markup(), { level: 9 }).length).toBeLessThanOrEqual(2_500);
});

test('exactly one solid is missing, drawn as a contour, and the request is lit once', () => {
  const { paths, labels } = missingPiece();
  expect(paths.filter((p) => p.role === 'missing')).toHaveLength(1);
  expect(paths.filter((p) => p.role === 'lit')).toHaveLength(1);
  // The labs that stand are named; the missing one is not, so no word sits in an empty contour.
  expect(labels.map((l) => l.text)).toEqual(['Routes', 'Raft', 'Cache', 'Database', 'Backfill']);
  expect(labels.map((l) => l.text)).not.toContain('Queue');
});

test('everything drawn lies inside the viewBox', () => {
  const { box, paths, labels } = missingPiece();
  const numbers = paths.flatMap((p) =>
    [...p.d.matchAll(/-?\d+(\.\d+)?/g)].map((m) => Number(m[0])),
  );
  expect(numbers.length).toBeGreaterThan(0);
  for (const label of labels) {
    expect(label.y).toBeGreaterThan(box.y);
    expect(label.y).toBeLessThan(box.y + box.height);
  }
  // Path coordinates come in x y pairs except arc radii and flags; check the move and line pairs.
  for (const p of paths.filter((p) => !p.d.includes('A'))) {
    const pairs = [...p.d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
    for (const [x = 0, y = 0] of pairs) {
      expect(x).toBeGreaterThanOrEqual(box.x);
      expect(x).toBeLessThanOrEqual(box.x + box.width);
      expect(y).toBeGreaterThanOrEqual(box.y);
      expect(y).toBeLessThanOrEqual(box.y + box.height);
    }
  }
});

test('the built 404 carries the drawing once, hidden from assistive technology, and its words', () => {
  const page = read('404.html');
  const svgs = [...page.matchAll(/<svg class="missing-piece"[^>]*>/g)].map(([tag]) => tag);
  expect(svgs).toHaveLength(1);
  expect(svgs[0]).toContain('aria-hidden="true"');
  expect(page).toContain('Page not found');
  expect(page).toContain('There is no page at this address.');
  expect(page).toMatch(/<a class="btn btn-primary" href="\/">\s*Go to the home page\s*<\/a>/);
  // The old drawings are gone: no end of the line, no background drawing.
  expect(page).not.toMatch(/class="(line-end|ground)"/);
});
