import { gzipSync } from 'node:zlib';
import { describe, expect, test } from 'vitest';
import { GROUND_BOX, groundFor, groundKindFor, type GroundKind } from '../src/lib/ground';
import { html, read } from './support/dist';

// Page geometry (design-system.md, "Page geometry"; lib/ground.ts): the two background symbols,
// About's wheels and the 404's buffer stop (ADR 0025), each fixed and small. e2e/ground.spec.ts
// keeps the one mark clear of text and checks the drawing is hidden in print.

const KINDS: GroundKind[] = ['about', 'lost'];
const markup = (kind: GroundKind) =>
  groundFor(kind)
    .paths.map((p) => p.d)
    .join('');

// Writing's ruled sheet and the Lab's street plans went with ADR 0025: a rule is functional or a
// lab's line. On main at f65dcc1 those pages carried them.
test('known answers: which drawing a path carries: the wheels on /about/, the stop on the 404', () => {
  expect(groundKindFor('/about/')).toBe('about');
  expect(groundKindFor(undefined)).toBe('lost');
  for (const path of ['/', '/writing/', '/writing/a-post/', '/notes/', '/lab/', '/lab/routes/'])
    expect(groundKindFor(path), path).toBeNull();
  expect(groundKindFor('/colophon/')).toBeNull();
});

// The 404's drawing (ADR 0025): one track that ends in a buffer stop, the track, the beam and the
// stop's body filled in the ground color, and its lamp the one mark. The field of stops it replaced
// had no track to end.
test('known answer: the 404 draws a line that ends in a buffer stop, with its lamp lit', () => {
  const { paths } = groundFor('lost');
  expect(paths.map((p) => p.kind)).toEqual(['block', 'mark']);
  const [stop, lamp] = paths;
  // The track from the box's left edge to the beam, then the beam across its end.
  const [, y, end] = /^M0 (\d+)H(\d+)v4H0z/.exec(stop?.d ?? '') ?? [];
  expect(Number(end)).toBeGreaterThan(GROUND_BOX.width / 2);
  expect(stop?.d).toContain(`M${end} ${Number(y) - 30}h6v64h-6z`);
  // The lamp stands over the beam, above the track.
  expect(lamp?.d).toMatch(new RegExp(`^M${Number(end) - 5} (\\d+)a8 8 `));
});

describe.each(KINDS)('%s', (kind) => {
  test('the same kind draws the same picture, byte for byte', () => {
    expect(markup(kind)).toBe(markup(kind));
  });

  test('it weighs at most 2.5 KB gzip, and has at most one accent mark', () => {
    expect(gzipSync(markup(kind), { level: 9 }).length).toBeLessThanOrEqual(2_500);
    expect(groundFor(kind).paths.filter((p) => p.kind === 'mark').length).toBeLessThanOrEqual(1);
  });

  test('every coordinate is a whole number, so the markup stays small', () => {
    expect(markup(kind)).not.toMatch(/\d\.\d/);
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
