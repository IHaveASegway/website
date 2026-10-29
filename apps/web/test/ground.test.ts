import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { closed, groundFor, groundKindFor, seeded, type GroundKind } from '../src/lib/ground';
import { html, read } from './support/dist';

// Page geometry (design-system.md, "Page geometry"; lib/ground.ts): each section's drawing, fixed
// by its seed, small, and on every page but the résumé. e2e/ground.spec.ts keeps its one mark
// clear of text and checks it is hidden in print.

const KINDS: GroundKind[] = ['writing', 'lab', 'about', 'lost'];
const markup = (kind: GroundKind, seed: string) => {
  const g = groundFor(kind, seed);
  return [...g.paths, ...(g.clipped ?? [])].map((p) => p.d).join('') + (g.clip ?? '');
};

test('known answers: which drawing a path carries, and none on Home or the résumé', () => {
  expect(groundKindFor('/')).toBeNull();
  expect(groundKindFor('/writing/')).toBe('writing');
  expect(groundKindFor('/writing/a-post/')).toBe('writing');
  expect(groundKindFor('/notes/')).toBe('writing');
  expect(groundKindFor('/lab/')).toBe('lab');
  expect(groundKindFor('/lab/routes/')).toBe('lab');
  expect(groundKindFor('/about/')).toBe('about');
  expect(groundKindFor(undefined)).toBe('lost');
  expect(groundKindFor('/colophon/')).toBeNull();
});

test('known answers: the seeded generator and the path writer', () => {
  const a = seeded('x');
  const b = seeded('x');
  const first = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(first);
  expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
  expect(seeded('y')()).not.toBe(first[0]);
  expect(
    closed([
      [0, 0],
      [10, 0],
      [10, 5.4],
    ]),
  ).toBe('M0 0l10 0l0 5z');
  expect(closed([])).toBe('');
});

describe.each(KINDS)('%s', (kind) => {
  test('the same seed draws the same picture, byte for byte', () => {
    expect(markup(kind, '/a/')).toBe(markup(kind, '/a/'));
  });

  test('it weighs at most 2.5 KB gzip, and has at most one accent mark', () => {
    expect(gzipSync(markup(kind, '/a/'), { level: 9 }).length).toBeLessThanOrEqual(2_500);
    expect(
      groundFor(kind, '/a/').paths.filter((p) => p.kind === 'mark').length,
    ).toBeLessThanOrEqual(1);
  });

  test('every coordinate is a whole number, so the markup stays small', () => {
    expect(markup(kind, '/a/')).not.toMatch(/\d\.\d/);
  });
});

for (const file of html) {
  test(`${file}: carries its section's drawing once, or none on the résumé`, () => {
    const page = read(file);
    const found = [...page.matchAll(/<svg class="ground" data-ground="([a-z]+)"/g)].map(
      (m) => m[1],
    );
    const path = file === '404.html' ? undefined : `/${file.replace(/index\.html$/, '')}`;
    const kind = groundKindFor(path);
    expect(found).toEqual(kind ? [kind] : []);
    if (kind) expect(page).toMatch(/<svg class="ground"[^>]*aria-hidden="true"/);
  });
}
